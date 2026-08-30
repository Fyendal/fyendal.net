#!/usr/bin/env tsx
/**
 * One-off e2e for the idle-claim feature: a browser player and a silent ws bot
 * start a classic-battles game; the bot never acts, so ~2 minutes later the
 * browser must show the idle toast, and clicking "Claim victory" must end the
 * game with the end-game screen. Expects server :8080 + vite :5173.
 * Usage: cd apps/server && npx tsx ../../scripts/e2e-idle.mts
 */
import { chromium } from "playwright";
import WebSocket from "ws";
import { deckPoolForHero } from "../packages/cards/src/index.js";

const API = "http://localhost:8080/api";
const APP = "http://localhost:5173";
const IDLE_MS = 2 * 60 * 1000;

/** register + verify + login a fresh user (dev server logs verification links) */
async function makeUser(prefix: string) {
  const username = `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const password = "idle-e2e-pass-1";
  const reg = await fetch(`${API}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, email: `${username}@example.com`, password }),
  }).then((r) => r.json());
  if (!reg.ok) throw new Error(`register failed: ${reg.error}`);
  const verifyToken = new URL(reg.devVerifyUrl).searchParams.get("token");
  await fetch(`${API}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: verifyToken }),
  });
  const login = await fetch(`${API}/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  }).then((r) => r.json());
  if (!login.ok) throw new Error(`login failed: ${login.error}`);
  return login;
}

const pageUser = await makeUser("idlepage");
const botUser = await makeUser("idlebot");
console.log("users ready");

// ── silent ws bot: queues, readies up, picks first if it wins — then idles ──
const bot = { ws: new WebSocket("ws://localhost:8080"), prep: null as any, started: false };
bot.ws.on("message", (raw) => {
  try {
    const msg = JSON.parse(String(raw));
    if (msg.type === "prep-state") bot.prep = msg.prep;
    if (msg.type === "game-started") bot.started = true;
  } catch { /* ignore malformed frames */ }
});
await new Promise((res, rej) => {
  bot.ws.on("open", res);
  bot.ws.on("error", rej);
});
bot.ws.send(JSON.stringify({ type: "auth", token: botUser.token }));
await new Promise((r) => setTimeout(r, 200));

// ── browser: log in, Classic Battles (Rhinar), Find Match ──
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await context.addInitScript((auth) => {
  localStorage.setItem("fyendal-auth", JSON.stringify(auth));
}, { token: pageUser.token, username: pageUser.username, verified: pageUser.verified });
const page = await context.newPage();
await page.goto(APP);
await page.waitForSelector(".lobby-grid", { timeout: 5000 });
await page.click(".format-card:has-text('Classic Battles')");
await page.click(".play-actions .btn-primary"); // Find Match (hero defaults to Rhinar)
await page.waitForSelector(".prep-page", { timeout: 5000 });

// bot pairs (FIFO — any hero pairs, mirrors included)
bot.ws.send(JSON.stringify({ type: "queue-join", format: "classic-battles", hero: "dorinthea" }));
await page.waitForSelector(".prep-hero", { timeout: 5000 });
await new Promise((r) => setTimeout(r, 400));
if (!bot.prep?.die) throw new Error("bot got no prep-state with a die roll");

// both ready up; die winner picks first
const pool = deckPoolForHero("dorinthea");
bot.ws.send(
  JSON.stringify({
    type: "present-deck",
    deck: { weaponIds: pool.weaponIds, equipment: {}, deck: pool.deck },
  }),
);
await page.click(".prep-actions .btn-primary"); // Ready
await new Promise((r) => setTimeout(r, 400));
const botIsWinner = bot.prep.die.winner === bot.prep.yourSeat;
if (botIsWinner) {
  bot.ws.send(JSON.stringify({ type: "choose-first", first: true }));
} else {
  // the idle bot must be the seat the game waits on (only the non-active
  // seat may claim) — so the browser player goes second
  await page.click(".prep-pick button:not(.btn-primary)"); // Go second
}
await page.waitForSelector(".table", { timeout: 8000 });
if (!bot.started) throw new Error("bot never got game-started");
console.log("game started — bot goes silent now");

// ── the wait: no intents from the bot → idle toast must appear ~2 min in ──
const t0 = Date.now();
await page.waitForSelector(".idle-toast", { timeout: IDLE_MS + 45_000 });
console.log(`idle toast appeared after ${Math.round((Date.now() - t0) / 1000)}s`);
await page.screenshot({ path: "/tmp/idle-toast.png" });

// dismiss → stays hidden; re-show check would need another 2 min, skip
await page.click(".idle-toast .linklike");
await page.waitForTimeout(300);
if (await page.locator(".idle-toast").isVisible().catch(() => false)) {
  throw new Error("toast did not dismiss");
}
// wait it out again (dismissal is per-stamp; the stamp hasn't changed, so the
// toast must NOT come back) — then claim via a fresh prompt is impossible;
// instead re-arm by waiting for the remaining idle window to pass again…
// simpler: the toast won't return on its own, so just wait 20s to confirm
await page.waitForTimeout(20_000);
if (await page.locator(".idle-toast").isVisible().catch(() => false)) {
  throw new Error("toast reappeared after dismiss without new opponent activity");
}
console.log("dismiss works and sticks");

// claim: reload re-arms the prompt (dismissal is local state), then claim
await page.reload();
await page.waitForSelector(".idle-toast", { timeout: 30_000 });
await page.click(".idle-toast .btn-primary");
await page.waitForSelector(".gameover-panel", { timeout: 8000 });
await page.waitForTimeout(500);
await page.screenshot({ path: "/tmp/idle-claimed.png" });
const headline = (await page.locator(".gameover-headline").textContent()) ?? "";
console.log(`end-game screen: "${headline.trim()}"`);

await browser.close();
bot.ws.close();
const won = headline.includes("Victory");
console.log(won ? "IDLE E2E PASS" : "IDLE E2E FAIL");
process.exit(won ? 0 : 1);
