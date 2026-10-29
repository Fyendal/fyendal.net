import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectGatewayRuntimeMetric,
  createEventLoopLagSource,
  instrumentPoolAcquireWait,
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

  it("includes event-loop lag and acquire wait only when a source provides them", () => {
    const metric = collectGatewayRuntimeMetric({
      instanceId: "gateway-test",
      connections: () => connections,
      eventLoop: () => ({ lagP50Ms: 0.5, lagP99Ms: 12, lagMaxMs: 40 }),
      databaseAcquire: () => ({ count: 3, waitMeanMs: 1.5, waitP99Ms: 4, waitMaxMs: 4 }),
    });
    expect(metric.eventLoop).toEqual({ lagP50Ms: 0.5, lagP99Ms: 12, lagMaxMs: 40 });
    expect(metric.databaseAcquire).toEqual({ count: 3, waitMeanMs: 1.5, waitP99Ms: 4, waitMaxMs: 4 });
    expect(collectGatewayRuntimeMetric({
      instanceId: "gateway-test",
      connections: () => connections,
    })).not.toHaveProperty("eventLoop");
  });

  it("reports event-loop lag beyond the sampling resolution and resets each window", () => {
    const histogram = {
      enabled: false,
      resets: 0,
      values: { 50: 21_000_000, 99: 320_000_000 },
      max: 320_000_000,
      enable() { this.enabled = true; return true; },
      reset() { this.resets += 1; this.values = { 50: 0, 99: 0 }; this.max = 0; },
      percentile(p: number) { return this.values[p as 50 | 99]; },
    };
    const read = createEventLoopLagSource(histogram, 20);
    expect(histogram.enabled).toBe(true);
    expect(read()).toEqual({ lagP50Ms: 1, lagP99Ms: 300, lagMaxMs: 300 });
    expect(histogram.resets).toBe(1);
    expect(read()).toEqual({ lagP50Ms: 0, lagP99Ms: 0, lagMaxMs: 0 });
  });

  it("times pool checkouts through callbacks, promises, and query, then resets the window", async () => {
    let clock = 0;
    const pool = {
      connect(callback?: (error: Error | undefined, client?: unknown, release?: unknown) => void) {
        clock += 5;
        if (callback) {
          callback(undefined, "client", () => {});
          return undefined;
        }
        return Promise.resolve("client");
      },
      query() {
        return new Promise<string>((resolve) => {
          this.connect((_error, client) => resolve(String(client)));
        });
      },
    };
    const read = instrumentPoolAcquireWait(pool, () => clock);
    await expect(pool.connect()).resolves.toBe("client");
    await expect(pool.query()).resolves.toBe("client");
    await new Promise<void>((resolve) => pool.connect((error, client, release) => {
      expect(error).toBeUndefined();
      expect(client).toBe("client");
      expect(typeof release).toBe("function");
      resolve();
    }));
    expect(read()).toEqual({ count: 3, waitMeanMs: 5, waitP99Ms: 5, waitMaxMs: 5 });
    expect(read()).toEqual({ count: 0, waitMeanMs: 0, waitP99Ms: 0, waitMaxMs: 0 });
  });

  it("counts a failed checkout and rethrows its error", async () => {
    let clock = 0;
    const pool = {
      connect() {
        clock += 5_000;
        return Promise.reject(new Error("timeout exceeded when trying to connect"));
      },
    };
    const read = instrumentPoolAcquireWait(pool, () => clock);
    await expect(pool.connect()).rejects.toThrow("timeout exceeded");
    expect(read()).toEqual({ count: 1, waitMeanMs: 5000, waitP99Ms: 5000, waitMaxMs: 5000 });
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
