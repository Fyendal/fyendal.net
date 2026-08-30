#!/usr/bin/env node
/**
 * Live E2E: two websocket clients play a full match against a running server.
 * Registers + verifies two throwaway users via the HTTP auth API first —
 * playing requires a verified account.
 * Usage: node scripts/e2e-match.mjs [port]   (server must already be running)
 */
import WebSocket from "ws";

const PORT = Number(process.argv[2] ?? 8080);
const url = `ws://localhost:${PORT}`;
const API = `http://localhost:${PORT}/api`;

/** register + verify + login a fresh user; returns { token, username, verified } */
async function makeUser(prefix) {
  const username = `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const password = "e2e-match-pass-1";
  const reg = await fetch(`${API}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, email: `${username}@example.com`, password }),
  }).then((r) => r.json());
  if (!reg.ok) throw new Error(`register failed: ${reg.error}`);
  if (!reg.devVerifyUrl) throw new Error("no devVerifyUrl — is the server in dev mode (SMTP_URL unset)?");
  const verifyToken = new URL(reg.devVerifyUrl).searchParams.get("token");
  const ver = await fetch(`${API}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: verifyToken }),
  }).then((r) => r.json());
  if (!ver.ok) throw new Error(`verify failed: ${ver.error}`);
  const login = await fetch(`${API}/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  }).then((r) => r.json());
  if (!login.ok) throw new Error(`login failed: ${login.error}`);
  return login;
}

/** parse one ws frame; a malformed frame must not kill the run */
function parseMsg(raw) {
  try {
    return JSON.parse(String(raw));
  } catch {
    console.warn("ignoring unparseable ws frame");
    return null;
  }
}

function bot(name) {
  const ws = new WebSocket(url);
  const state = { ws, name, code: null, token: null, seat: null, view: null, legal: [] };
  ws.on("message", (raw) => {
    const msg = parseMsg(raw);
    if (!msg) return;
    if (msg.type === "room-created" || msg.type === "joined") {
      state.code = msg.code;
      state.token = msg.token;
      state.seat = msg.seat;
    }
    if (msg.type === "state") {
      state.view = msg.view;
      state.legal = msg.legal;
      maybeAct(state);
    }
  });
  return new Promise((res, rej) => {
    ws.on("open", () => res(state));
    ws.on("error", rej);
  });
}

let acting = false;
function maybeAct(state) {
  if (acting) return;
  const { view, legal } = state;
  if (!view || view.winner !== null) return;
  const options = legal.filter((i) => i.kind !== "concede");
  if (options.length === 0) return;
  // prefer attacks over pass so the game actually progresses
  const attacks = options.filter((i) => i.kind === "play-card" || i.kind === "activate-ability");
  const pool = attacks.length > 0 && Math.random() < 0.8 ? attacks : options;
  const intent = pool[Math.floor(Math.random() * pool.length)];
  acting = true;
  setTimeout(() => {
    acting = false;
    state.ws.send(JSON.stringify({ type: "intent", intent }));
  }, 5);
}

const userA = await makeUser("e2ea");
const userB = await makeUser("e2eb");

const a = await bot("A");
a.ws.send(JSON.stringify({ type: "auth", token: userA.token }));
await new Promise((r) => setTimeout(r, 200));
a.ws.send(JSON.stringify({ type: "create-room", format: "classic-battles", hero: "dorinthea" }));
await new Promise((r) => setTimeout(r, 200));
if (!a.code) throw new Error("no room code");
const b = await bot("B");
b.ws.send(JSON.stringify({ type: "auth", token: userB.token }));
await new Promise((r) => setTimeout(r, 200));
b.ws.send(JSON.stringify({ type: "join-room", code: a.code }));

const deadline = Date.now() + 60000;
let winner = null;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 250));
  const w = a.view?.winner ?? b.view?.winner;
  if (w !== null && w !== undefined) {
    winner = w;
    break;
  }
}
if (winner === null) {
  console.error("E2E FAILED: match did not finish in 60s");
  console.error("last log:", (a.view?.log ?? []).slice(-8));
  process.exit(1);
}
const view = winner === a.seat ? a.view : b.view;
console.log(`E2E OK: seat ${winner} (${winner === 0 ? "Dorinthea" : "Rhinar"}) won on turn ${view.turn}`);
console.log("final log lines:");
for (const l of view.log.slice(-6)) console.log("  " + l);
a.ws.close();
b.ws.close();
process.exit(0);
