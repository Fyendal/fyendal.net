import { monitorEventLoopDelay, performance } from "node:perf_hooks";

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

export interface EventLoopMetrics {
  lagP50Ms: number;
  lagP99Ms: number;
  lagMaxMs: number;
}

export interface DatabaseAcquireMetrics {
  count: number;
  waitMeanMs: number;
  waitP99Ms: number;
  waitMaxMs: number;
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
  eventLoop?: EventLoopMetrics;
  databaseAcquire?: DatabaseAcquireMetrics;
}

interface RuntimeMetricSources {
  instanceId: string;
  connections: () => GatewayConnectionMetrics;
  databasePool?: () => DatabasePoolMetrics | undefined;
  eventLoop?: () => EventLoopMetrics | undefined;
  databaseAcquire?: () => DatabaseAcquireMetrics | undefined;
  memoryUsage?: () => NodeJS.MemoryUsage;
  uptime?: () => number;
}

export type RuntimeMetricLogger = (metric: GatewayRuntimeMetric) => void;

/** Collect a bounded process snapshot without retaining any room or socket state. */
export function collectGatewayRuntimeMetric(sources: RuntimeMetricSources): GatewayRuntimeMetric {
  const memory = (sources.memoryUsage ?? process.memoryUsage)();
  const databasePool = sources.databasePool?.();
  const eventLoop = sources.eventLoop?.();
  const databaseAcquire = sources.databaseAcquire?.();
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
    ...(eventLoop ? { eventLoop } : {}),
    ...(databaseAcquire ? { databaseAcquire } : {}),
  };
}

const EVENT_LOOP_RESOLUTION_MS = 20;
const MAX_ACQUIRE_SAMPLES = 4096;

function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}

interface DelayHistogram {
  enable(): boolean;
  reset(): void;
  percentile(percentile: number): number;
  readonly max: number;
}

/** Lag is how late the sampling timer fired beyond its own resolution, in ms;
 * the histogram holds nanoseconds and is reset on every read so each snapshot
 * covers one interval. */
export function createEventLoopLagSource(
  histogram: DelayHistogram = monitorEventLoopDelay({ resolution: EVENT_LOOP_RESOLUTION_MS }),
  resolutionMs = EVENT_LOOP_RESOLUTION_MS,
): () => EventLoopMetrics {
  histogram.enable();
  const lag = (nanoseconds: number): number =>
    roundMs(Math.max(0, nanoseconds / 1e6 - resolutionMs));
  return () => {
    const metrics = {
      lagP50Ms: lag(histogram.percentile(50)),
      lagP99Ms: lag(histogram.percentile(99)),
      lagMaxMs: lag(histogram.max),
    };
    histogram.reset();
    return metrics;
  };
}

type AcquireCallback = (error: Error | undefined, client?: unknown, release?: unknown) => void;

export interface InstrumentablePool {
  connect(callback?: AcquireCallback): unknown;
}

/** Time every client checkout by wrapping `pool.connect`; pg-pool's `query`
 * acquires through the same method, so timeouts and queueing both count. */
export function instrumentPoolAcquireWait(
  pool: InstrumentablePool,
  now: () => number = () => performance.now(),
): () => DatabaseAcquireMetrics {
  let samples: number[] = [];
  let count = 0;
  let sum = 0;
  let max = 0;
  const record = (startedAt: number): void => {
    const waited = now() - startedAt;
    count += 1;
    sum += waited;
    if (waited > max) max = waited;
    if (samples.length < MAX_ACQUIRE_SAMPLES) samples.push(waited);
  };
  const original = pool.connect;
  pool.connect = function (this: InstrumentablePool, callback?: AcquireCallback): unknown {
    const startedAt = now();
    if (callback) {
      return original.call(this, (error, client, release) => {
        record(startedAt);
        callback(error, client, release);
      });
    }
    return (original.call(this) as Promise<unknown>).then(
      (client) => {
        record(startedAt);
        return client;
      },
      (error: unknown) => {
        record(startedAt);
        throw error;
      },
    );
  };
  return () => {
    const sorted = samples.sort((a, b) => a - b);
    const p99 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))]! : 0;
    const metrics = {
      count,
      waitMeanMs: roundMs(count ? sum / count : 0),
      waitP99Ms: roundMs(p99),
      waitMaxMs: roundMs(max),
    };
    samples = [];
    count = 0;
    sum = 0;
    max = 0;
    return metrics;
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
