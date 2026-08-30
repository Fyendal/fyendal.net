#!/usr/bin/env node
/**
 * Tiny TCP proxy used only by docker-compose.perf.yml. Each direction is
 * delayed independently, so 2 ms approximates a 4 ms database round trip.
 * It is deliberately outside the production image and code path.
 */
import net from "node:net";

function positiveInteger(name, fallback, { allowZero = false } = {}) {
  const raw = process.env[name] ?? String(fallback);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new Error(`${name} must be ${allowZero ? "a non-negative" : "a positive"} integer`);
  }
  return value;
}

const listenPort = positiveInteger("PERF_PROXY_LISTEN_PORT", 5432);
const targetPort = positiveInteger("PERF_PROXY_TARGET_PORT", 5432);
const delayMs = positiveInteger("PERF_DB_ONE_WAY_DELAY_MS", 2, { allowZero: true });
const targetHost = process.env.PERF_PROXY_TARGET_HOST ?? "db";

function delayedPipe(source, destination) {
  source.on("data", (chunk) => {
    source.pause();
    setTimeout(() => {
      if (destination.destroyed) return;
      if (destination.write(chunk)) source.resume();
      else destination.once("drain", () => source.resume());
    }, delayMs);
  });
  source.on("end", () => setTimeout(() => destination.end(), delayMs));
}

const sockets = new Set();
const server = net.createServer((client) => {
  const upstream = net.createConnection({ host: targetHost, port: targetPort });
  sockets.add(client);
  sockets.add(upstream);
  const closeBoth = () => {
    client.destroy();
    upstream.destroy();
    sockets.delete(client);
    sockets.delete(upstream);
  };
  client.on("error", closeBoth);
  upstream.on("error", closeBoth);
  client.on("close", () => sockets.delete(client));
  upstream.on("close", () => sockets.delete(upstream));
  delayedPipe(client, upstream);
  delayedPipe(upstream, client);
});

server.listen(listenPort, "0.0.0.0", () => {
  console.log(`database latency proxy listening on :${listenPort}, target ${targetHost}:${targetPort}, one-way delay ${delayMs} ms`);
});

function shutdown() {
  server.close();
  for (const socket of sockets) socket.destroy();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
