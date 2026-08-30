#!/usr/bin/env tsx
/**
 * Live E2E for the cc prep room: a headed-browser user and a ws bot queue for
 * Classic Constructed, land in the prep room (opponent hero + die roll), both
 * ready up, the die winner picks first, and the game starts. Screenshots to
 * /tmp/fyendal-prep*.png. Expects the server on :8080 and vite on :5173.
 * Usage: npx tsx scripts/e2e-prep.mts
 */
import { chromium } from "playwright";
import WebSocket from "ws";
import { cardData } from "../packages/cards/src/index.js";

const API = "http://localhost:8080/api";

/** register + verify + login a fresh user; returns { token, username, verified } */
async function makeUser(prefix: string) {
  const username = `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const password = "prep-e2e-pass-1";
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

/** import a legal 60-card cc deck; returns the deck id */
async function importCcDeck(token: string, name: string): Promise<string> {
  const printings = Object.values(cardData);
  const hero = printings.find((c) => c.cardType === "hero" && c.name.includes("Rhinar"))!;
  const weapon = printings.find((c) => c.cardType === "weapon")!;
  const deckCards = printings.filter(
    (c) => !["hero", "weapon", "equipment", "token"].includes(c.cardType),
  );
  const text = [
    `Hero: ${hero.name}`,
    `1x ${weapon.name}`,
    ...deckCards.slice(0, 20).map((c) => `3x ${c.name}`),
  ].join("\n");
  const r = await fetch(`${API}/decks/import`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ name, format: "cc", text }),
  }).then((r) => r.json());
  if (!r.ok) throw new Error(`import failed: ${JSON.stringify(r)}`);
  return r.deck.id;
}

/** full registered pool (for building the ws bot's presentation) */
async function fetchPool(token: string, deckId: string) {
  const r = await fetch(`${API}/decks/${deckId}`, {
    headers: { authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  if (!r.ok) throw new Error(`deck fetch failed: ${r.error}`);
  return r.deck.decklist;
}

const pageUser = await makeUser("preppage");
const botUser = await makeUser("prepbot");
const pageDeck = await importCcDeck(pageUser.token, "page cc");
const botDeck = await importCcDeck(botUser.token, "bot cc");
console.log("users + decks ready");

// ── ws bot: queue for cc, then drive the prep protocol ──────────────────────
/** parse one ws frame; a malformed frame must not kill the run */
function parseMsg(raw: unknown): any {
  try {
    return JSON.parse(String(raw));
  } catch {
    console.warn("ignoring unparseable ws frame");
    return null;
  }
}

const bot = { ws: new WebSocket("ws://localhost:8080"), prep: null as any, started: false, activePlayer: -1 };
bot.ws.on("message", (raw) => {
  const msg = parseMsg(raw);
  if (!msg) return;
  if (msg.type === "prep-state") bot.prep = msg.prep;
  if (msg.type === "game-started") bot.started = true;
  if (msg.type === "state") bot.activePlayer = msg.view.activePlayer;
});
await new Promise((res, rej) => {
  bot.ws.on("open", res);
  bot.ws.on("error", rej);
});
bot.ws.send(JSON.stringify({ type: "auth", token: botUser.token }));
await new Promise((r) => setTimeout(r, 200));

// ── browser: log in, pick Classic Constructed, Find Match ───────────────────
const browser = await chromium.launch({ channel: "chrome", args: ["--no-proxy-server"] });
const context = await browser.newContext({ viewport: { width: 1680, height: 945 } });
await context.addInitScript((auth) => {
  localStorage.setItem("fyendal-auth", JSON.stringify(auth));
}, { token: pageUser.token, username: pageUser.username, verified: pageUser.verified });
const page = await context.newPage();
await page.goto("http://localhost:5173");
await page.waitForSelector(".lobby-grid", { timeout: 5000 });
await page.click(".format-card:has-text('Classic Constructed')");
await page.selectOption(".play-choice select", pageDeck);
await page.click("button:text('Find Match')");
// prep screen while waiting for an opponent
await page.waitForSelector(".prep-page", { timeout: 5000 });
await page.screenshot({ path: "/tmp/fyendal-prep-waiting.png" });
console.log("screenshot: /tmp/fyendal-prep-waiting.png");

// bot joins the queue → pairing: prep-state with the die roll on both sides
bot.ws.send(JSON.stringify({ type: "queue-join", format: "cc", deckId: botDeck }));
await page.waitForSelector(".prep-hero", { timeout: 5000 });
await new Promise((r) => setTimeout(r, 400));
if (!bot.prep?.die) throw new Error("bot got no prep-state with a die roll");
console.log(`die roll: ${bot.prep.die.rolls.join(" vs ")}, winner seat ${bot.prep.die.winner}`);
await page.screenshot({ path: "/tmp/fyendal-prep-paired.png" });
console.log("screenshot: /tmp/fyendal-prep-paired.png");

// both ready up: browser via the Ready button, bot via present-deck
const pool = await fetchPool(botUser.token, botDeck);
bot.ws.send(
  JSON.stringify({
    type: "present-deck",
    deck: { weaponIds: pool.weaponIds, equipment: {}, deck: pool.deck },
  }),
);
await page.click(".prep-actions .btn-primary");
await new Promise((r) => setTimeout(r, 400));

// die winner picks who goes first
const botIsWinner = bot.prep.die.winner === bot.prep.yourSeat;
if (botIsWinner) {
  bot.ws.send(JSON.stringify({ type: "choose-first", first: true }));
} else {
  await page.click(".prep-pick .btn-primary"); // "Go first"
}

// game starts on both sides
await page.waitForSelector(".table", { timeout: 8000 });
await new Promise((r) => setTimeout(r, 500));
if (!bot.started) throw new Error("bot never got game-started");
const expectedFirst = botIsWinner ? bot.prep.yourSeat : 1 - bot.prep.yourSeat;
if (bot.activePlayer !== expectedFirst) {
  throw new Error(`wrong start player: active ${bot.activePlayer}, expected ${expectedFirst}`);
}
console.log(`game started, first player: seat ${bot.activePlayer} (as chosen)`);
await page.screenshot({ path: "/tmp/fyendal-prep-game.png" });
console.log("screenshot: /tmp/fyendal-prep-game.png");

await browser.close();
bot.ws.close();
console.log("PREP E2E PASS");
process.exit(0);
