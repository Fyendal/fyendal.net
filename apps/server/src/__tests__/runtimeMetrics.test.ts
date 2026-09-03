import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectGatewayRuntimeMetric,
  startGatewayRuntimeMetrics,
  type GatewayRuntimeMetric,
} from "../runtimeMetrics.js";

const connections = {
  webSockets: 7,
  clients: 6,
  lobbyClients: 2,
  rooms: 2,
  authenticatedSessions: 4,
  queuedUsers: 1,
  clientIps: 5,
};

describe("gateway runtime metrics", () => {
  afterEach(() => vi.useRealTimers());

  it("collects process, connection, and pool counters as a bounded snapshot", () => {
    expect(collectGatewayRuntimeMetric({
      instanceId: "gateway-test",
      uptime: () => 12.6,
      memoryUsage: () => ({
        rss: 101,
        heapTotal: 102,
        heapUsed: 103,
        external: 104,
        arrayBuffers: 105,
      }),
      connections: () => connections,
      databasePool: () => ({ total: 5, idle: 3, waiting: 1 }),
    })).toEqual({
      severity: "INFO",
      message: "gateway runtime metrics",
      event: "gateway_runtime_metrics",
      instanceId: "gateway-test",
      uptimeSeconds: 13,
      memory: {
        rssBytes: 101,
        heapTotalBytes: 102,
        heapUsedBytes: 103,
        externalBytes: 104,
        arrayBuffersBytes: 105,
      },
      connections,
      databasePool: { total: 5, idle: 3, waiting: 1 },
    });
  });

  it("emits immediately, repeats on the interval, and stops cleanly", () => {
    vi.useFakeTimers();
    const seen: GatewayRuntimeMetric[] = [];
    const stop = startGatewayRuntimeMetrics({
      instanceId: "gateway-test",
      connections: () => connections,
    }, 30_000, (metric) => seen.push(metric));

    expect(seen).toHaveLength(1);
    vi.advanceTimersByTime(60_000);
    expect(seen).toHaveLength(3);
    stop();
    stop();
    vi.advanceTimersByTime(30_000);
    expect(seen).toHaveLength(3);
  });

  it("rejects invalid intervals", () => {
    expect(() => startGatewayRuntimeMetrics({
      instanceId: "gateway-test",
      connections: () => connections,
    }, 0)).toThrow("runtime metrics interval must be a positive safe integer");
  });
});
