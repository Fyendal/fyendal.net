/** Reset one local room for checking draw-then-discard attack animations.
 * Run against the documented Docker development database:
 * DATABASE_URL=postgres://fyendal:fyendal@localhost:5432/fyendal \
 *   pnpm --filter @fyendal/server seed:draw-discard
 */
import { randomBytes } from "node:crypto";
import { botDefinition } from "@fyendal/bot";
import { cardData, precon, scripts } from "@fyendal/cards";
import { createGame, legalIntents } from "@fyendal/engine";
import { hashPassword } from "./auth.js";
import { createPool, defaultConnectionString, withTransaction } from "./db.js";
import { assertSafeToSeed } from "./seedGuard.js";
import { dehydrateState, hashReconnectToken } from "./store.js";

const ROOM_CODE = "AXEDRW";
const DECK_NAME = "Draw and discard animation test";
const LOCAL_DATABASE_URL = "postgres://fyendal:fyendal@localhost:5432/fyendal";

assertSafeToSeed();
if (defaultConnectionString() !== LOCAL_DATABASE_URL) {
  throw new Error("draw/discard seed requires the documented local Docker development database");
}

const hala = botDefinition("hala");
const halaPool = precon(hala?.deckId ?? "")?.pool;
if (!hala || !halaPool) throw new Error("Hala test deck is unavailable");

const rhinar = {
  heroId: "WTR001",
  weaponIds: ["MON221B"],
  equipment: {},
  deck: ["SKA019", ...Array<string>(59).fill("WTR188")],
};
const halaPresentation = hala.presentationFor(rhinar, "second");
const state = createGame({
  decklists: [rhinar, { heroId: halaPool.heroId, ...halaPresentation }],
  seed: 9282026,
  cards: cardData,
  scripts,
  startPlayer: 0,
});
const player = state.players[0]!;
const cards = [...player.hand, ...player.deck];
const take = (cardId: string) => {
  const index = cards.findIndex((card) => card.cardId === cardId);
  if (index < 0) throw new Error(`draw/discard test fixture is missing ${cardId}`);
  return cards.splice(index, 1)[0]!;
};
const wildRide = take("SKA019");
player.hand = [wildRide, take("WTR188"), take("WTR188"), take("WTR188")];
player.deck = cards;
player.resources = 4;
player.actionPoints = 2;

const opponent = state.players[1]!;
opponent.deck.push(...opponent.hand);
opponent.hand = [];
opponent.equipment = {};

const meataxeId = player.weapons.find((card) => card.cardId === "MON221B")?.instanceId;
const legal = legalIntents(state, 0);
if (
  meataxeId === undefined
  || !legal.some((intent) => intent.kind === "play-card" && intent.instanceId === wildRide.instanceId)
  || !legal.some((intent) => intent.kind === "activate-ability" && intent.sourceInstanceId === meataxeId)
) throw new Error("draw/discard test fixture cannot play Wild Ride or attack with Ravenous Meataxe");

const pool = await createPool(LOCAL_DATABASE_URL);
try {
  const { rows: rulesetRows } = await pool.query(
    "SELECT active_ruleset_version FROM runtime_config WHERE singleton = TRUE",
  );
  const rulesetVersion: unknown = rulesetRows[0]?.active_ruleset_version;
  if (typeof rulesetVersion !== "string" || !rulesetVersion) {
    throw new Error("activate a local ruleset before seeding the draw/discard room");
  }
  await withTransaction(pool, async (tx) => {
    const { rows: existingSeats } = await tx.query(
      "SELECT deck_name FROM room_seats WHERE room_code = $1 AND seat = 0",
      [ROOM_CODE],
    );
    if (existingSeats.length > 0 && existingSeats[0]?.deck_name !== DECK_NAME) {
      throw new Error(`${ROOM_CODE} is already used by another room`);
    }
    const { rows: insertedUsers } = await tx.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('alice', 'alice', $1, $2)
       ON CONFLICT (username_lc) DO NOTHING RETURNING id`,
      [await hashPassword("password123"), Date.now()],
    );
    const { rows: aliceRows } = insertedUsers.length > 0
      ? { rows: insertedUsers }
      : await tx.query("SELECT id FROM users WHERE username_lc = 'alice'");
    const aliceId = Number(aliceRows[0]?.id);
    if (!Number.isSafeInteger(aliceId)) throw new Error("local alice account is missing");

    await tx.query("DELETE FROM rooms WHERE code = $1", [ROOM_CODE]);
    await tx.query(
      `INSERT INTO rooms
        (code, format, spectators, state, prep, ruleset_version, version, created_at, gc_at,
         status, winner, is_private)
       VALUES ($1, 'cc', '[]', $2, $3, $4, 0, $5, NULL, 'active', NULL, TRUE)`,
      [
        ROOM_CODE,
        JSON.stringify(dehydrateState(state, rulesetVersion)),
        JSON.stringify({ rolls: [6, 1], dieWinner: 0, startPlayer: 0, arenas: [null, null] }),
        rulesetVersion,
        Date.now(),
      ],
    );
    await tx.query(
      `INSERT INTO room_seats
        (room_code, seat, user_id, token_hash, username, hero_id, deck_name,
         from_queue, ready, controller)
       VALUES ($1, 0, $2, $3, 'alice', 'WTR001', $4, FALSE, TRUE, 'human')`,
      [ROOM_CODE, aliceId, hashReconnectToken(randomBytes(12).toString("hex")), DECK_NAME],
    );
    await tx.query(
      `INSERT INTO room_seats
        (room_code, seat, token_hash, username, hero_id, deck_id, deck_name,
         from_queue, ready, controller)
       VALUES ($1, 1, $2, $3, $4, $5, $6, FALSE, TRUE, 'bot')`,
      [
        ROOM_CODE,
        hashReconnectToken(randomBytes(12).toString("hex")),
        hala.username,
        halaPool.heroId,
        hala.deckId,
        hala.deckName,
      ],
    );
  });
  console.log(`seeded ${ROOM_CODE} — log in as alice and open /${ROOM_CODE}`);
} finally {
  await pool.end();
}
