#!/usr/bin/env tsx
/**
 * One-off e2e for the silver-age precons: two FRESH accounts (no imported
 * decks) queue for Silver Age with hardcoded precons (Briar vs Gravy Bones),
 * ready up with the default presentation, and the game starts. Expects the
 * server on :8080 and vite on :5173.
 * Usage: cd apps/server && npx tsx ../../scripts/e2e-precon.mts
 */
import { chromium } from "playwright";
import WebSocket from "ws";
import { silverAgePrecon } from "../packages/cards/src/index.js";

const API = "http://localhost:8080/api";
const APP = "http://localhost:5173";

async function makeUser(prefix: string) {
  const username = `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const password = "precon-e2e-pass-1";
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

const pageUser = await makeUser("pcp");
const botUser = await makeUser("pcb");
console.log("fresh users ready (no imported decks)");

// ── ws bot: queue with the Gravy Bones precon, then drive prep ──
const botPool = silverAgePrecon("precon-sgb")!.pool;
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

// ── browser: Silver Age → precon section → Briar Precon → Find Match ──
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await context.addInitScript((auth) => {
  localStorage.setItem("fyendal-auth", JSON.stringify(auth));
}, { token: pageUser.token, username: pageUser.username, verified: pageUser.verified });
const page = await context.newPage();
await page.goto(APP);
await page.waitForSelector(".lobby-grid", { timeout: 5000 });
await page.click(".format-card:has-text('Silver Age')");
await page.waitForSelector(".deck-grid .deck-card", { timeout: 5000 });

const tiles = await page.locator(".deck-card").allTextContents();
for (const want of ["Briar Precon", "Lyath Goldmane Precon", "Gravy Bones Precon"]) {
  if (!tiles.some((t) => t.includes(want))) throw new Error(`precon tile missing: ${want}`);
}
console.log("all three precon tiles render for a fresh account");
await page.screenshot({ path: "/tmp/precon-grid.png" });

await page.click(".deck-card:has-text('Briar Precon')");
await page.click(".deck-actions .btn-primary"); // Find Match
await page.waitForSelector(".prep-page", { timeout: 5000 });

bot.ws.send(JSON.stringify({ type: "queue-join", format: "silver-age", deckId: "precon-sgb" }));
await page.waitForSelector(".prep-hero", { timeout: 5000 });
await new Promise((r) => setTimeout(r, 400));
if (!bot.prep?.die) throw new Error("bot got no prep-state with a die roll");
console.log("paired via queue with precons only");

// both ready up with the default (full-pool) presentation
bot.ws.send(
  JSON.stringify({
    type: "present-deck",
    deck: { weaponIds: botPool.weaponIds.slice(0, 2), equipment: {}, deck: botPool.deck },
  }),
);
await page.click(".prep-actions .btn-primary"); // Ready
await new Promise((r) => setTimeout(r, 400));
const botIsWinner = bot.prep.die.winner === bot.prep.yourSeat;
if (botIsWinner) {
  bot.ws.send(JSON.stringify({ type: "choose-first", first: true }));
} else {
  await page.click(".prep-pick .btn-primary"); // Go first
}

await page.waitForSelector(".table", { timeout: 8000 });
if (!bot.started) throw new Error("bot never got game-started");
await page.waitForTimeout(500);
await page.screenshot({ path: "/tmp/precon-game.png" });
console.log("game started — Briar vs Gravy Bones, precon vs precon");

await browser.close();
bot.ws.close();
console.log("PRECON E2E PASS");
process.exit(0);
