#!/usr/bin/env tsx
/**
 * One-off automated smoke test for the rail-driven lobby layout (requested for
 * the lobby revamp; not part of the test suite). Expects the dev stack running
 * (server :8080, vite :5173) and the seeded user alice/password123.
 *
 * Verifies: All Rooms selected by default, rail entries, Silver Age deck grid
 * with hero headshots + select → Find Match/Host Room, Classic Constructed
 * disabled ("coming soon"), classic-battles hero pick, My Decks management
 * view. Screenshots to /tmp/lobby-*.png.
 *
 * Usage: npx tsx scripts/lobby-smoke.mts
 */
import { chromium } from "playwright";
import { readdirSync, readFileSync } from "node:fs";

// Read the raw card JSON instead of importing @fyendal/cards — the package
// pulls in engine source, which may be mid-refactor when this script runs.
interface RawCard { name: string; cardType: string; subtypes?: string[] }
const cardData: RawCard[] = readdirSync(new URL("../packages/cards/src/data/cards/", import.meta.url))
  .flatMap((f) => JSON.parse(readFileSync(new URL(`../packages/cards/src/data/cards/${f}`, import.meta.url), "utf8")) as RawCard[]);

const API = "http://localhost:8080/api";
const APP = "http://localhost:5173";

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? "✓" : "✗"} ${name}`);
  if (!cond) failures += 1;
}

/** Valid cc export text (same shape as the server deck tests). */
function ccExportText(): string {
  const printings = Object.values(cardData);
  const hero = printings.find((c) => c.cardType === "hero" && c.name.includes("Rhinar"))!;
  const weapon = printings.find((c) => c.cardType === "weapon")!;
  const chest = printings.find((c) => c.cardType === "equipment" && c.subtypes?.includes("chest"))!;
  const pool = printings.filter(
    (c) => !["hero", "weapon", "equipment", "token"].includes(c.cardType),
  );
  const lines = [`Hero: ${hero.name}`, "", `1x ${weapon.name}`, `1x ${chest.name}`, ""];
  for (const c of pool.slice(0, 20)) lines.push(`3x ${c.name}`);
  return lines.join("\n");
}

async function login(): Promise<string> {
  const r = await fetch(`${API}/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "alice", password: "password123" }),
  });
  const data = (await r.json()) as { ok: boolean; token?: string };
  if (!data.ok || !data.token) throw new Error("alice login failed — run: pnpm --filter @fyendal/server seed");
  return data.token;
}

async function ensureCcDeck(token: string): Promise<void> {
  const r = await fetch(`${API}/decks`, { headers: { authorization: `Bearer ${token}` } });
  const data = (await r.json()) as { ok: boolean; decks?: { format: string }[] };
  if (data.ok && data.decks?.some((d) => d.format === "cc")) {
    console.log("• alice already has a cc deck");
    return;
  }
  const imp = await fetch(`${API}/decks/import`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: "Smoke CC", format: "cc", text: ccExportText() }),
  });
  const out = (await imp.json()) as { ok: boolean };
  if (!out.ok) throw new Error(`deck import failed: ${JSON.stringify(out)}`);
  console.log("• imported a cc deck for alice");
}

const token = await login();
await ensureCcDeck(token);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

await page.goto(APP);
await page.getByPlaceholder("username").fill("alice");
await page.getByPlaceholder("password").fill("password123");
await page.locator(".auth-form button.btn-primary").click();
await page.waitForSelector(".lobby-grid", { timeout: 10_000 });

// ── All Rooms (default) ──
const railCards = page.locator(".lobby-rail .format-card");
check("rail has 5 entries", (await railCards.count()) === 5);
const firstRail = railCards.first();
check("first rail entry is All Rooms", (await firstRail.textContent())?.includes("All Rooms") ?? false);
check("All Rooms selected by default", (await firstRail.getAttribute("class"))?.includes("selected") ?? false);
check("rail lists Classic Battles", (await page.locator(".lobby-rail .format-card:has-text('Classic Battles')").count()) === 1);
check("rail lists Classic Constructed", (await page.locator(".lobby-rail .format-card:has-text('Classic Constructed')").count()) === 1);
check("rail lists Silver Age", (await page.locator(".lobby-rail .format-card:has-text('Silver Age')").count()) === 1);
check("rail lists My Decks", (await page.locator(".lobby-rail .format-card:has-text('My Decks')").count()) === 1);
check("main shows All Rooms", await page.locator(".lobby-main .panel-title", { hasText: "All Rooms" }).isVisible());
check("join-by-code input present", await page.locator(".rooms-join .code-input").isVisible());
await page.screenshot({ path: "/tmp/lobby-all-rooms.png" });

// ── Classic Constructed: coming soon (disabled) ──
const ccCard = page.locator(".lobby-rail .format-card:has-text('Classic Constructed')");
check("cc card is disabled", await ccCard.isDisabled());
check("cc card says coming soon", (await ccCard.textContent())?.includes("coming soon") ?? false);

// ── Silver Age: deck grid ──
await page.locator(".lobby-rail .format-card:has-text('Silver Age')").click();
await page.waitForSelector(".deck-grid .deck-card", { timeout: 5_000 });
check("silver-age deck grid renders tiles", (await page.locator(".deck-grid .deck-card").count()) >= 1);
check("deck tile has hero headshot img", (await page.locator(".deck-card img.deck-card-img").count()) >= 1);
// headshots are hotlinked — give them a beat before the screenshot
await page
  .locator(".deck-card img.deck-card-img")
  .first()
  .evaluate((img) => (img as HTMLImageElement).complete || new Promise((r) => (img.onload = r)))
  .catch(() => {});
await page.locator(".deck-grid .deck-card").first().click();
check("tile select highlights", (await page.locator(".deck-card.selected").count()) === 1);
check("Find Match action visible", await page.locator(".deck-actions button.btn-primary:has-text('Find Match')").isVisible());
check("Host Room action visible", await page.locator(".deck-actions button:has-text('Host Room')").isVisible());
check("actions enabled for logged-in user", await page.locator(".deck-actions button.btn-primary").isEnabled());
await page.screenshot({ path: "/tmp/lobby-silver-age.png" });

// ── Classic Battles: unchanged hero pick ──
await page.locator(".lobby-rail .format-card:has-text('Classic Battles')").click();
check("cb hero pick renders", await page.locator(".lobby-main button:has-text('Rhinar')").isVisible());
check("cb second hero renders", await page.locator(".lobby-main button:has-text('Dorinthea')").isVisible());
check("cb Find Match renders", await page.locator(".play-actions button.btn-primary:has-text('Find Match')").isVisible());
check("cb Host Room renders", await page.locator(".play-actions button:has-text('Host Room')").isVisible());
await page.screenshot({ path: "/tmp/lobby-cb.png" });

// ── My Decks ──
await page.locator(".lobby-rail .format-card:has-text('My Decks')").click();
check("deck manager renders", await page.locator(".lobby-main .panel-title", { hasText: "My Decks" }).isVisible());
check("import form present", await page.locator(".deck-import summary").isVisible());
check("imported deck listed", (await page.locator(".room-table td:has-text('Smoke CC')").count()) >= 1);
await page.screenshot({ path: "/tmp/lobby-decks.png" });

// ── full rooms are spectate-only ──
await page.locator(".lobby-rail .format-card:has-text('All Rooms')").click();
const demoRow = page.locator('.room-table tr:has(button:has-text("Join"):disabled)').first();
check("demo match listed as spectate-only", (await demoRow.count()) === 1);
check("live dot next to the format", (await demoRow.locator(".live-dot").count()) === 1);
check("hero vs headshots shown", (await demoRow.locator(".hero-face").count()) === 2);
check("Join disabled on a full room", await demoRow.locator("button:has-text('Join')").isDisabled());
check("Spectate enabled on a full room", await demoRow.locator("button:has-text('Spectate')").isEnabled());

// ── spectating a room still in prep shows a holding screen ──
// alice hosts a classic-battles room, bob takes the second seat, an anonymous
// visitor opens the link — they must spectate, not steal a seat or dead-end
await page.locator(".lobby-rail .format-card:has-text('Classic Battles')").click();
await page.locator(".play-actions button:has-text('Host Room')").click();
await page.waitForURL(/\/[0-9A-Z]{6}/, { timeout: 5_000 });
const roomCode = page.url().split("/").pop()!;

const ctx2 = await browser.newContext();
const bob = await ctx2.newPage();
await bob.goto(APP);
await bob.getByPlaceholder("username").fill("bob");
await bob.getByPlaceholder("password").fill("password123");
await bob.locator(".auth-form button.btn-primary").click();
await bob.waitForSelector(".lobby-grid");
// rows carry no usernames anymore — alice's room is the one joinable row
// (the demo match is spectate-only)
const openRows = bob.locator('.room-table tr:has(button:has-text("Join"):not(:disabled))');
check("open room listed for the second player", (await openRows.count()) === 1);
await openRows.first().locator("button:has-text('Join')").click();
// joining a classic-battles room asks for a box hero first
await bob.locator(".deck-pick-modal button:has-text('Dorinthea')").click();
await bob.waitForURL(/\/[0-9A-Z]{6}/, { timeout: 5_000 });

const ctx3 = await browser.newContext();
const anon = await ctx3.newPage();
await anon.goto(`${APP}/${roomCode}`);
await anon.waitForSelector(".waiting-panel", { timeout: 10_000 });
check(
  "pre-game spectator gets the holding screen",
  await anon.locator(".waiting-panel .panel-title", { hasText: "Spectating" }).isVisible(),
);
await anon.screenshot({ path: "/tmp/lobby-spectate-waiting.png" });

// bob's lobby view: the room he seats moves to Your Games (Rejoin); other
// full rooms stay spectate-only
await bob.goto(APP);
await bob.waitForSelector(".lobby-grid");
const yourGames = bob.locator(".your-games .room-table tr");
check("seated room listed under Your Games", (await yourGames.count()) === 1);
check("own full room offers Rejoin", await yourGames.first().locator("button:has-text('Rejoin')").isEnabled());
const specOnly = bob.locator('.room-table tr:has(button:has-text("Join"):disabled)');
check("other full rooms stay spectate-only", (await specOnly.count()) === 1);

// teardown: both players leave so the room unlists and GCs
await bob.goto(`${APP}/${roomCode}`);
await bob.waitForSelector(".prep-room, .waiting-panel", { timeout: 10_000 }).catch(() => {});
await bob.locator("button:has-text('Leave'), button:has-text('Cancel')").first().click().catch(() => {});
await page.locator("button:has-text('Leave'), button:has-text('Cancel')").first().click().catch(() => {});

await browser.close();
console.log(failures === 0 ? "\nall lobby smoke checks passed" : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
