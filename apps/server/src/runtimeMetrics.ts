export interface GatewayConnectionMetrics {
  webSockets: number;
  clients: number;
  lobbyClients: number;
  rooms: number;
  authenticatedSessions: number;
  queuedUsers: number;
  clientIps: number;
}

export interface DatabasePoolMetrics {
  total: number;
  idle: number;
  waiting: number;
}

export interface GatewayRuntimeMetric {
  severity: "INFO";
  message: "gateway runtime metrics";
  event: "gateway_runtime_metrics";
  instanceId: string;
  uptimeSeconds: number;
  memory: {
    rssBytes: number;
    heapTotalBytes: number;
    heapUsedBytes: number;
    externalBytes: number;
    arrayBuffersBytes: number;
  };
  connections: GatewayConnectionMetrics;
  databasePool?: DatabasePoolMetrics;
}

interface RuntimeMetricSources {
  instanceId: string;
  connections: () => GatewayConnectionMetrics;
  databasePool?: () => DatabasePoolMetrics | undefined;
  memoryUsage?: () => NodeJS.MemoryUsage;
  uptime?: () => number;
}

export type RuntimeMetricLogger = (metric: GatewayRuntimeMetric) => void;

/** Collect a bounded process snapshot without retaining any room or socket state. */
export function collectGatewayRuntimeMetric(sources: RuntimeMetricSources): GatewayRuntimeMetric {
  const memory = (sources.memoryUsage ?? process.memoryUsage)();
  const databasePool = sources.databasePool?.();
  return {
    severity: "INFO",
    message: "gateway runtime metrics",
    event: "gateway_runtime_metrics",
    instanceId: sources.instanceId,
    uptimeSeconds: Math.round((sources.uptime ?? process.uptime)()),
    memory: {
      rssBytes: memory.rss,
      heapTotalBytes: memory.heapTotal,
      heapUsedBytes: memory.heapUsed,
      externalBytes: memory.external,
      arrayBuffersBytes: memory.arrayBuffers,
    },
    connections: sources.connections(),
    ...(databasePool ? { databasePool } : {}),
  };
}

/** Emit JSON that Cloud Logging promotes to jsonPayload fields. */
export const consoleRuntimeMetric: RuntimeMetricLogger = (metric) => {
  console.log(JSON.stringify(metric));
};

/** Start periodic snapshots and return an idempotent cleanup function. */
export function startGatewayRuntimeMetrics(
  sources: RuntimeMetricSources,
  intervalMs: number,
  log: RuntimeMetricLogger = consoleRuntimeMetric,
): () => void {
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1) {
    throw new Error("runtime metrics interval must be a positive safe integer");
  }
  const emit = (): void => log(collectGatewayRuntimeMetric(sources));
  emit();
  const timer = setInterval(emit, intervalMs);
  timer.unref?.();
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
  };
}
