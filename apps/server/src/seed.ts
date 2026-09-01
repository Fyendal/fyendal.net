/**
 * Seed local development data:
 *
 *   alice
 *   bob   (password for both: password123)
 *
 * plus the demo room DEMO00 — a GC-exempt classic-battles match already in
 * progress (Rhinar vs Dorinthea, both seats phantom) that anyone can spectate
 * from the lobby's room list or via /DEMO00, and HUNTED — a private CC
 * practice room owned by alice against the standard Hala bot, with Arakni
 * starting with two copies of Hunter or Hunted?. These fixtures count as 4
 * "players in game" in the lobby stats — dev only. Alice also receives one
 * fixed, undismissed bug-report notification for exercising the lobby UI.
 *
 * Idempotent — existing users are skipped and the disposable demo room is
 * recreated. Runs pending migrations first, so it also works against a
 * freshly started docker Postgres:
 *
 *   docker run -d --name fyendal-dev-db -p 5432:5432 \
 *     -e POSTGRES_USER=fyendal -e POSTGRES_PASSWORD=fyendal postgres:16-alpine
 *   pnpm --filter @fyendal/server seed
 *
 * DATABASE_URL is honored; defaults to the local dev database.
 */
import { randomBytes } from "node:crypto";
import { botDefinition } from "@fyendal/bot";
import { applyIntent, createGame, legalIntents, rngNext, type GameState } from "@fyendal/engine";
import { cardData, decklists, precon, scripts } from "@fyendal/cards";
import { hashPassword } from "./auth.js";
import { hashReconnectToken } from "./store.js";
import { createPool } from "./db.js";
import { DEMO_ROOM_CODE, dehydrateState } from "./store.js";
import { assertSafeToSeed } from "./seedGuard.js";

assertSafeToSeed();

const PASSWORD = "password123";
const DEVELOPMENT_RULESET_VERSION = "development-seed";
const USERS = [{ username: "alice" }, { username: "bob" }];
const HUNTER_TEST_ROOM_CODE = "HUNTED";

/**
 * A lived-in mid-game board for the demo room: fixed seeds, random legal
 * intents (same driving style as the golden matches), capped well before
 * either side can deck out. Best-effort — any hiccup just yields an earlier
 * board state, which is still spectatable.
 */
function demoGameState(): GameState {
  let s = createGame({
    decklists: [decklists.rhinar, decklists.dorinthea],
    seed: 42,
    cards: cardData,
    scripts,
    startPlayer: 0,
  });
  const carrier = { rngState: 7 };
  for (let i = 0; i < 80 && s.winner === null; i++) {
    const seat = s.pendingDecision?.player ?? s.priorityPlayer;
    const options = legalIntents(s, seat).filter((i) => i.kind !== "concede");
    if (options.length === 0) break;
    const r = applyIntent(s, seat, options[Math.floor(rngNext(carrier) * options.length)]!);
    if (!r.ok) break;
    s = r.state;
  }
  return s;
}

/** Ordinary Hala practice match with a Huntsman test deck. Arakni starts with
 * two blue Hunter or Hunted? copies so one can pay for the other. The human
 * takes the first turn and can immediately end it; every later Hala action is
 * driven by the normal registered bot policy and recorded in room history. */
function hunterTestGameState(): GameState {
  const arakniPool = precon("precon-sar")?.pool;
  const hala = botDefinition("hala");
  const halaPool = precon(hala?.deckId ?? "")?.pool;
  if (!arakniPool || !hala || !halaPool) throw new Error("Hunter test fixture decks are unavailable");
  const arakni = {
    heroId: "DYN113",
    weaponIds: [...arakniPool.weaponIds],
    equipment: {},
    deck: [
      ...arakniPool.deck,
      "SUP245", "SUP245", "SUP245",
      ...arakniPool.deck.slice(0, 11),
    ],
  };
  const halaPresentation = hala.presentationFor(arakni, "second");
  const state = createGame({
    decklists: [{ heroId: halaPool.heroId, ...halaPresentation }, arakni],
    seed: 245,
    cards: cardData,
    scripts,
    startPlayer: 1,
  });
  const huntsman = state.players[1]!;
  while (huntsman.hand.filter((card) => card.cardId === "SUP245").length < 2) {
    const hunterIndex = huntsman.deck.findIndex((card) => card.cardId === "SUP245");
    const replaceIndex = huntsman.hand.findIndex((card) => card.cardId !== "SUP245");
    if (hunterIndex < 0 || replaceIndex < 0) {
      throw new Error("Hunter test fixture could not stock Arakni's hand");
    }
    [huntsman.hand[replaceIndex], huntsman.deck[hunterIndex]] = [
      huntsman.deck[hunterIndex]!,
      huntsman.hand[replaceIndex]!,
    ];
  }
  return state;
}

const pool = await createPool();
try {
  for (const u of USERS) {
    const { rows } = await pool.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (username_lc) DO NOTHING
       RETURNING id`,
      [u.username, u.username.toLowerCase(), await hashPassword(PASSWORD), Date.now()],
    );
    console.log(rows.length > 0 ? `seeded ${u.username}` : `${u.username} already exists — skipped`);
  }
  console.log(`\ntest login: alice / ${PASSWORD}  (or bob / ${PASSWORD})`);

  // phantom seats: random tokens nobody holds, so all joins are spectators
  const seats = [randomBytes(12).toString("hex"), randomBytes(12).toString("hex")];
  const prep = { rolls: [4, 2], dieWinner: 0, startPlayer: 0 };
  await pool.query("BEGIN");
  try {
    // These rooms are disposable local fixture data. Recreate them so rerunning
    // the seed also repairs stale ruleset envelopes and clears dependent history.
    await pool.query("DELETE FROM rooms WHERE code IN ($1, $2)", [DEMO_ROOM_CODE, HUNTER_TEST_ROOM_CODE]);
    await pool.query(
      `INSERT INTO rooms
        (code, format, spectators, state, prep, ruleset_version, version, created_at, gc_at, status, winner)
       VALUES ($1, 'classic-battles', '[]', $2, $3, $4, 0, $5, NULL, 'active', NULL)`,
      [
        DEMO_ROOM_CODE,
        JSON.stringify(dehydrateState(demoGameState(), DEVELOPMENT_RULESET_VERSION)),
        JSON.stringify(prep),
        DEVELOPMENT_RULESET_VERSION,
        Date.now(),
      ],
    );
    for (const [seat, token] of seats.entries()) {
      await pool.query(
        `INSERT INTO room_seats (room_code, seat, token_hash, username, hero, from_queue, ready)
         VALUES ($1,$2,$3,$4,$5,FALSE,TRUE)`,
        [DEMO_ROOM_CODE, seat, hashReconnectToken(token), seat === 0 ? "Rhinar" : "Dorinthea", seat === 0 ? "rhinar" : "dorinthea"],
      );
    }
    const { rows: aliceRows } = await pool.query(
      "SELECT id FROM users WHERE username_lc = 'alice'",
    );
    const aliceId = Number(aliceRows[0]?.id);
    if (!Number.isSafeInteger(aliceId)) throw new Error("seeded alice account is missing");
    const hunterPrep = { rolls: [2, 5], dieWinner: 1, startPlayer: 1 };
    await pool.query(
      `INSERT INTO rooms
        (code, format, spectators, state, prep, ruleset_version, version, created_at, gc_at,
         status, winner, is_private)
       VALUES ($1, 'cc', '[]', $2, $3, $4, 0, $5, NULL, 'active', NULL, TRUE)`,
      [
        HUNTER_TEST_ROOM_CODE,
        JSON.stringify(dehydrateState(hunterTestGameState(), DEVELOPMENT_RULESET_VERSION)),
        JSON.stringify(hunterPrep),
        DEVELOPMENT_RULESET_VERSION,
        Date.now(),
      ],
    );
    await pool.query(
      `INSERT INTO room_seats
        (room_code, seat, token_hash, username, hero_id, deck_id, deck_name,
         from_queue, ready, controller)
       VALUES ($1, 0, $2, 'Hala bot', 'MPW003', 'precon-hala-masterclass',
               'Masterclass: Hala, Bladesaint of the Vow', FALSE, TRUE, 'bot')`,
      [HUNTER_TEST_ROOM_CODE, hashReconnectToken(randomBytes(12).toString("hex"))],
    );
    await pool.query(
      `INSERT INTO room_seats
        (room_code, seat, user_id, token_hash, username, hero_id, deck_name,
         from_queue, ready, controller)
       VALUES ($1, 1, $2, $3, 'alice', 'DYN113', 'Hunter or Hunted? test',
               FALSE, TRUE, 'human')`,
      [
        HUNTER_TEST_ROOM_CODE,
        aliceId,
        hashReconnectToken(randomBytes(12).toString("hex")),
      ],
    );
    const fixedAt = Date.now();
    await pool.query(
      `INSERT INTO bug_reports
        (id, reporter_user_id, room_code, room_version, ruleset_version,
         description, trace, created_at, fixed_at, dismissed_at)
       VALUES ($1, $2, $3, 0, $4, $5, $6, $7, $7, NULL)
       ON CONFLICT (id) DO UPDATE SET
         reporter_user_id = EXCLUDED.reporter_user_id,
         fixed_at = EXCLUDED.fixed_at,
         dismissed_at = NULL`,
      [
        "local-fixed-bug-alice",
        aliceId,
        DEMO_ROOM_CODE,
        DEVELOPMENT_RULESET_VERSION,
        "Cards in the combat chain briefly appeared in the wrong order.",
        JSON.stringify({
          version: 1,
          capturedAt: fixedAt,
          room: {
            code: DEMO_ROOM_CODE,
            format: "classic-battles",
            rulesetVersion: DEVELOPMENT_RULESET_VERSION,
            version: 0,
            status: "active",
            winner: null,
            reporterSeat: 0,
            state: null,
          },
          history: [],
        }),
        fixedAt,
      ],
    );
    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }
  console.log(`seeded demo room ${DEMO_ROOM_CODE} — spectate from the room list or /${DEMO_ROOM_CODE}`);
  console.log(`seeded Hunter or Hunted? room ${HUNTER_TEST_ROOM_CODE} — log in as alice and open /${HUNTER_TEST_ROOM_CODE}`);
  console.log("seeded fixed bug notification for alice");
} finally {
  await pool.end();
}
