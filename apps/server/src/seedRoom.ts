/** Persist a temporary, hand-authored manual test fixture in local Postgres. */
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { botDefinition } from "@fyendal/bot";
import { cardData, precon, scripts } from "@fyendal/cards";
import type { GameState } from "@fyendal/engine";
import type { BotOpponent, Format } from "@fyendal/shared";
import { createPool, defaultConnectionString, withTransaction } from "./db.js";
import { decodePersistedState } from "./persistedState.js";
import { assertSafeToSeed } from "./seedGuard.js";
import { dehydrateState, hashReconnectToken } from "./store.js";

type ManualSeat =
  | { controller: "human"; username: string }
  | { controller: "bot"; opponent: BotOpponent };

export interface ManualRoomFixture {
  code: string;
  title: string;
  format: Format;
  state: GameState;
  seats: [ManualSeat, ManualSeat];
}

const MANUAL_DECK_PREFIX = "[manual seed] ";

function validateFixture(value: unknown): asserts value is ManualRoomFixture {
  if (!value || typeof value !== "object") throw new Error("fixture must export a room object");
  const fixture = value as Record<string, unknown>;
  if (typeof fixture.code !== "string" || !/^[A-Z0-9]{6}$/.test(fixture.code)) {
    throw new Error("fixture code must be six uppercase letters or digits");
  }
  if (typeof fixture.title !== "string" || !fixture.title.trim() || fixture.title.length > 80) {
    throw new Error("fixture title must be 1–80 characters");
  }
  if (!["classic-battles", "cc", "silver-age"].includes(String(fixture.format))) {
    throw new Error("fixture format is invalid");
  }
  if (!Array.isArray(fixture.seats) || fixture.seats.length !== 2 ||
    !fixture.seats.some((seat) => seat?.controller === "human")) {
    throw new Error("fixture needs two seats and at least one human");
  }
  for (const seat of fixture.seats) {
    if (seat?.controller === "human" &&
      (typeof seat.username !== "string" || !/^[a-z0-9_-]+$/i.test(seat.username))) {
      throw new Error("human seat needs an existing local username");
    }
    if (seat?.controller === "bot" &&
      (typeof seat.opponent !== "string" || !botDefinition(seat.opponent))) {
      throw new Error("bot seat needs a registered opponent");
    }
    if (seat?.controller !== "human" && seat?.controller !== "bot") {
      throw new Error("seat controller must be human or bot");
    }
  }
  const state = fixture.state as GameState | undefined;
  if (!state || !Array.isArray(state.players) || state.players.length !== 2 ||
    state.winner !== null || state.players.some((player) => !player?.hero?.cardId)) {
    throw new Error("fixture needs an unfinished two-player game state");
  }
}

const databaseUrl = defaultConnectionString();
assertSafeToSeed({ ...process.env, DATABASE_URL: databaseUrl });
const fixturePath = process.argv[2] === "--" ? process.argv[3] : process.argv[2];
if (!fixturePath) throw new Error("usage: pnpm --filter @fyendal/server seed:room -- <fixture.ts>");
const imported: unknown = await import(pathToFileURL(resolve(fixturePath)).href);
const fixture: unknown = (imported as { default?: unknown }).default;
validateFixture(fixture);

const pool = await createPool(databaseUrl);
try {
  const { rows: runtimeRows } = await pool.query(
    "SELECT active_ruleset_version FROM runtime_config WHERE singleton = TRUE",
  );
  const rulesetVersion: unknown = runtimeRows[0]?.active_ruleset_version;
  if (typeof rulesetVersion !== "string" || !rulesetVersion) {
    throw new Error("activate a local ruleset before seeding a manual room");
  }
  const persistedState = dehydrateState(fixture.state, rulesetVersion);
  decodePersistedState(persistedState, fixture.code, cardData, scripts, rulesetVersion);

  await withTransaction(pool, async (tx) => {
    const { rows: existing } = await tx.query(
      `SELECT r.code, s.deck_name
       FROM rooms r LEFT JOIN room_seats s ON s.room_code = r.code AND s.seat = 0
       WHERE r.code = $1`,
      [fixture.code],
    );
    if (existing.length > 0 &&
      (typeof existing[0]?.deck_name !== "string" ||
        !existing[0].deck_name.startsWith(MANUAL_DECK_PREFIX))) {
      throw new Error(`${fixture.code} already belongs to a room outside the manual seeder`);
    }
    if (existing.length > 0) {
      const { rows: presence } = await tx.query(
        "SELECT lease_id FROM room_presence WHERE room_code = $1 LIMIT 1",
        [fixture.code],
      );
      if (presence.length > 0) throw new Error(`leave ${fixture.code} before replacing it`);
    }

    const seatRows = [];
    for (const [seatNumber, seat] of fixture.seats.entries()) {
      let userId: number | null = null;
      let username: string;
      let deckId: string | null = null;
      let deckName = `${MANUAL_DECK_PREFIX}${fixture.title}`;
      if (seat.controller === "human") {
        const { rows } = await tx.query("SELECT id, username FROM users WHERE username_lc = $1", [seat.username.toLowerCase()]);
        userId = Number(rows[0]?.id);
        if (!Number.isSafeInteger(userId)) throw new Error(`local user ${seat.username} is missing; run the base seed first`);
        username = String(rows[0]!.username);
      } else {
        const definition = botDefinition(seat.opponent);
        const pool = precon(definition?.deckId ?? "")?.pool;
        if (!definition || !pool) throw new Error(`bot ${seat.opponent} has no registered deck`);
        if (fixture.state.players[seatNumber]?.hero.cardId !== pool.heroId) {
          throw new Error(`seat ${seatNumber} hero does not match bot ${seat.opponent}`);
        }
        username = definition.username;
        deckId = definition.deckId;
        deckName = seatNumber === 0 ? deckName : definition.deckName;
      }
      seatRows.push({
        seatNumber, userId, username, deckId, deckName,
        heroId: fixture.state.players[seatNumber]!.hero.cardId,
        controller: seat.controller,
      });
    }

    if (existing.length > 0) await tx.query("DELETE FROM rooms WHERE code = $1", [fixture.code]);
    await tx.query(
      `INSERT INTO rooms
         (code, format, spectators, state, prep, ruleset_version, version, created_at, gc_at,
          status, winner, is_private)
       VALUES ($1, $2, '[]', $3, $4, $5, 0, $6, NULL, 'active', NULL, TRUE)`,
      [
        fixture.code,
        fixture.format,
        JSON.stringify(persistedState),
        JSON.stringify({ rolls: [6, 1], dieWinner: 0, startPlayer: 0, arenas: [null, null] }),
        rulesetVersion,
        Date.now(),
      ],
    );
    for (const seat of seatRows) {
      await tx.query(
        `INSERT INTO room_seats
           (room_code, seat, user_id, token_hash, username, hero_id, deck_id, deck_name,
            from_queue, ready, controller)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, FALSE, TRUE, $9)`,
        [
          fixture.code, seat.seatNumber, seat.userId,
          hashReconnectToken(randomBytes(12).toString("hex")),
          seat.username, seat.heroId, seat.deckId, seat.deckName, seat.controller,
        ],
      );
    }
  });
  console.log(`seeded ${fixture.code} — open /${fixture.code} as ${
    fixture.seats.filter((seat) => seat.controller === "human").map((seat) => seat.username).join(" or ")
  }`);
} finally {
  await pool.end();
}
