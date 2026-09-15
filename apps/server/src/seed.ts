/**
 * Seed local development data:
 *
 *   alice
 *   bob
 *   charlie
 *   diana   (password for all: password123)
 *
 * plus the demo room DEMO00 — a GC-exempt classic-battles match already in
 * progress (Rhinar vs Dorinthea, both seats phantom) that alice can spectate
 * from the lobby's room list or via /DEMO00; HUNTED — a private CC practice
 * room owned by alice against the standard Hala bot, with Arakni starting with
 * two copies of Hunter or Hunted?; and SNAPBT — a private Silver Age practice
 * room against the Briar bot with Snap Shot already face up in arsenal and
 * Death Dealer unused; DMGFX1 — a private Silver Age room where alice controls
 * Briar with Arcanic Shockwave and Lightning fusion cards ready against an
 * empty-handed, unequipped bot while bob, charlie, and diana spectate; and
 * OKANAS — a private CC practice room against the
 * Hala bot with Ira ready to test Okana Scar Wraps after a Vengeance attack;
 * and RALLYC — a private Silver Age room with Rally the Coast Guard already
 * defending and two cards available to discard; and MARKS3 — a private CC
 * room for testing Restless Steed's on-hit go again, with Mark of Ushering in
 * hand and an undefended Hala bot; and NITRO8 — a private CC room where alice
 * can construct Nitro Mechanoid, play Hit the Gas for 3 action points, attack
 * repeatedly, then pass to the standard Hala bot; and FUNNEL — a private CC
 * room where Aurora can play Arc Lightning, red Rush of Power, then Current
 * Funnel into an empty-handed, unequipped Hala bot.
 * These fixtures count as 18 "players in game" in the
 * lobby stats — dev only.
 * Alice also receives one fixed, undismissed bug-report notification for
 * exercising the lobby UI.
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
const DEFAULT_DEVELOPMENT_RULESET_VERSION = "development-seed";
const USERS = [
  { username: "alice" },
  { username: "bob" },
  { username: "charlie" },
  { username: "diana" },
];
const PINNED_LOCAL_PRESENCE_AT = Date.UTC(3000, 0, 1);
const HUNTER_TEST_ROOM_CODE = "HUNTED";
const SNAP_ARC_TEST_ROOM_CODE = "SNAPBT";
const DAMAGE_FX_TEST_ROOM_CODE = "DMGFX1";
const OKANA_TEST_ROOM_CODE = "OKANAS";
const RALLY_TEST_ROOM_CODE = "RALLYC";
const MARKS_TEST_ROOM_CODE = "MARKS3";
const NITRO_TEST_ROOM_CODE = "NITRO8";
const CURRENT_FUNNEL_TEST_ROOM_CODE = "FUNNEL";
const RETIRED_TEST_ROOM_CODES = ["BASEMT"] as const;

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

/** Briar opens with two Arcanic Shockwaves and two Lightning cards. Revealing
 * Burn Up // Shock to fuse Arcanic Shockwave produces an arcane packet before
 * the physical attack resolves. The bot has neither hand cards nor equipment,
 * making both damage effects deterministic for presentation testing. */
function damageFxTestGameState(): GameState {
  const humanPool = precon("precon-sba")?.pool;
  const opponentBot = botDefinition("briar");
  const opponentPool = precon(opponentBot?.deckId ?? "")?.pool;
  if (!humanPool || !opponentBot || !opponentPool) {
    throw new Error("Damage-effects test fixture decks are unavailable");
  }
  const humanDeck = {
    heroId: humanPool.heroId,
    weaponIds: [humanPool.weaponIds[0]!],
    equipment: {},
    deck: [...humanPool.deck],
  };
  const opponentPresentation = opponentBot.presentationFor(humanDeck, "second");
  const state = createGame({
    decklists: [
      humanDeck,
      { heroId: opponentPool.heroId, ...opponentPresentation },
    ],
    seed: 6092026,
    cards: cardData,
    scripts,
    startPlayer: 0,
  });
  const player = state.players[0]!;
  const cards = [...player.hand, ...player.deck];
  const take = (cardId: string) => {
    const index = cards.findIndex((card) => card.cardId === cardId);
    if (index < 0) throw new Error(`Damage-effects test fixture is missing ${cardId}`);
    return cards.splice(index, 1)[0]!;
  };
  player.hand = [take("SBA011"), take("SBA011"), take("SBA025"), take("SBA025")];
  player.deck = cards;
  player.resources = 0;
  player.actionPoints = 1;

  const opponent = state.players[1]!;
  opponent.deck.push(...opponent.hand);
  opponent.hand = [];
  opponent.equipment = {};
  return state;
}

/** Aurora can play Arc Lightning, choose the opposing hero for its first
 * trigger, then play red Rush of Power with the granted go again. After Rush
 * resolves and Arc Lightning deals its second point, Current Funnel is ready
 * as the next card in hand. Hala cannot defend either attack. */
function currentFunnelTestGameState(): GameState {
  const auroraPool = precon("precon-ast")?.pool;
  const hala = botDefinition("hala");
  const halaPool = precon(hala?.deckId ?? "")?.pool;
  if (!auroraPool || !hala || !halaPool) {
    throw new Error("Current Funnel test fixture decks are unavailable");
  }
  const auroraDeck = {
    heroId: auroraPool.heroId,
    weaponIds: [...auroraPool.weaponIds],
    equipment: {},
    deck: [...auroraPool.deck, "OMN068", "ROS074"],
  };
  const halaPresentation = hala.presentationFor(auroraDeck, "second");
  const state = createGame({
    decklists: [auroraDeck, { heroId: halaPool.heroId, ...halaPresentation }],
    seed: 9152026,
    cards: cardData,
    scripts,
    startPlayer: 0,
  });
  const player = state.players[0]!;
  const cards = [...player.hand, ...player.deck];
  const take = (cardId: string) => {
    const index = cards.findIndex((card) => card.cardId === cardId);
    if (index < 0) throw new Error(`Current Funnel test fixture is missing ${cardId}`);
    return cards.splice(index, 1)[0]!;
  };
  player.hand = [take("AST022"), take("OMN068"), take("ROS074")];
  player.deck = cards;
  player.resources = 0;
  player.actionPoints = 1;

  const opponent = state.players[1]!;
  opponent.deck.push(...opponent.hand);
  opponent.hand = [];
  opponent.equipment = {};
  return state;
}

/** Snap Shot starts face up in arsenal while Death Dealer is unused. Fuse it,
 * then use Death Dealer to load and play Arc Bending before using the granted
 * second activation to load the follow-up arrow. Pitching Heaven's Claws to
 * Arc Bending also exercises Lightning Bond. Briar's opening hand is returned
 * to its deck so the test attack can hit without a hand-card block. */
function snapArcTestGameState(): GameState {
  const briar = botDefinition("briar");
  const briarPool = precon(briar?.deckId ?? "")?.pool;
  if (!briar || !briarPool) throw new Error("Snap/Arc test fixture bot deck is unavailable");
  const lexi = {
    heroId: "ELE032",
    weaponIds: ["ARC040"],
    equipment: {},
    deck: [
      "ELE041", "ELE041", "ELE041",
      "PEN202", "PEN202", "PEN202",
      "ELE194", "ELE194", "ELE194",
      ...Array<string>(31).fill("RNR020"),
    ],
  };
  const briarPresentation = briar.presentationFor(lexi, "second");
  const state = createGame({
    decklists: [lexi, { heroId: briarPool.heroId, ...briarPresentation }],
    seed: 410202,
    cards: cardData,
    scripts,
    startPlayer: 0,
  });
  const player = state.players[0]!;
  const cards = [...player.hand, ...player.deck];
  const take = (cardId: string) => {
    const index = cards.findIndex((card) => card.cardId === cardId);
    if (index < 0) throw new Error(`Snap/Arc test fixture is missing ${cardId}`);
    return cards.splice(index, 1)[0]!;
  };
  const snapShot = take("ELE041");
  const arcBending = take("PEN202");
  const followupArrow = take("PEN202");
  const fusionLightning = take("ELE194");
  const bondLightning = take("ELE194");
  player.hand = [arcBending, followupArrow, fusionLightning, bondLightning];
  player.arsenal = [snapShot];
  player.deck = cards;
  // Death Dealer spends the only floating resource, forcing Heaven's Claws
  // to be pitched when Arc Bending is played and exercising Lightning Bond.
  player.resources = 1;
  player.actionPoints = 1;
  const opponent = state.players[1]!;
  opponent.deck.push(...opponent.hand);
  opponent.hand = [];
  return state;
}

/** Ira can attack with Edge of Autumn, then play Enact Vengeance and activate
 * Okana Scar Wraps. Hala has no cards or equipment available to defend, so
 * Enact reaches the hit trigger deterministically and offers the banished Edge
 * for re-equipping. */
function okanaTestGameState(): GameState {
  const ira = botDefinition("ira");
  const iraPool = precon(ira?.deckId ?? "")?.pool;
  const hala = botDefinition("hala");
  const halaPool = precon(hala?.deckId ?? "")?.pool;
  if (!ira || !iraPool || !hala || !halaPool) {
    throw new Error("Okana test fixture decks are unavailable");
  }
  const iraPresentation = ira.presentationFor({
    heroId: halaPool.heroId,
    weaponIds: [...halaPool.weaponIds],
    equipment: {},
    deck: [...halaPool.deck],
  }, "first");
  const iraDeck = { heroId: iraPool.heroId, ...iraPresentation };
  const halaPresentation = hala.presentationFor(iraDeck, "second");
  const state = createGame({
    decklists: [iraDeck, { heroId: halaPool.heroId, ...halaPresentation }],
    seed: 905202,
    cards: cardData,
    scripts,
    startPlayer: 0,
  });

  const player = state.players[0]!;
  const cards = [...player.hand, ...player.deck];
  const take = (cardId: string) => {
    const index = cards.findIndex((card) => card.cardId === cardId);
    if (index < 0) throw new Error(`Okana test fixture is missing ${cardId}`);
    return cards.splice(index, 1)[0]!;
  };
  player.hand = [take("ASR008")];
  player.deck = cards;
  player.resources = 3;

  const defender = state.players[1]!;
  defender.deck.push(...defender.hand);
  defender.hand = [];
  defender.equipment = { head: undefined, chest: undefined, arms: undefined, legs: undefined };
  return state;
}

/** Malice starts with all three Marks (including Mark of Ushering) and Tome of
 * Necrosis in hand. Restless Steed and the I'Arathael Restless zombies are in
 * the graveyard for her activated ability, while Danse Macabre and Vox
 * Necropolis are ready. Hala cannot defend, making Steed's hit deterministic. */
function marksTestGameState(): GameState {
  const hala = botDefinition("hala");
  const halaPool = precon(hala?.deckId ?? "")?.pool;
  if (!hala || !halaPool) throw new Error("Restless Steed test fixture bot deck is unavailable");

  const malice = {
    heroId: "IAR054",
    weaponIds: ["IAR055"],
    equipment: { legs: "IAR091" },
    deck: [
      "IAR059",
      "IAR063",
      "IAR086",
      "IAR066",
      "IAR067",
      "IAR068",
      "IAR092",
      "AMA019",
      "ASB012",
      ...Array<string>(51).fill("RNR020"),
    ],
  };
  const halaPresentation = hala.presentationFor(malice, "second");
  const state = createGame({
    decklists: [malice, { heroId: halaPool.heroId, ...halaPresentation }],
    seed: 9032026,
    cards: cardData,
    scripts,
    startPlayer: 0,
  });

  const player = state.players[0]!;
  const cards = [...player.hand, ...player.deck];
  const take = (cardId: string) => {
    const index = cards.findIndex((card) => card.cardId === cardId);
    if (index < 0) throw new Error(`Restless Steed test fixture is missing ${cardId}`);
    return cards.splice(index, 1)[0]!;
  };
  player.hand = [take("IAR066"), take("IAR067"), take("IAR068"), take("IAR092")];
  player.graveyard = [take("AMA019"), take("IAR059"), take("IAR063"), take("IAR086")];
  player.banish = [take("ASB012")];
  player.deck = cards;
  player.resources = 9;
  player.actionPoints = 1;
  const defender = state.players[1]!;
  defender.deck.push(...defender.hand);
  defender.hand = [];
  defender.equipment = { head: undefined, chest: undefined, arms: undefined, legs: undefined };
  return state;
}

/** Maxx can immediately construct Nitro Mechanoid from four equipment pieces,
 * Banksy, and three live Hyper Drivers. Hit the Gas turns three more banished
 * Hyper Drivers face-down for 3 action points, allowing three Mechanoid attacks
 * before alice passes to the ordinary Hala bot turn. */
function nitroTestGameState(): GameState {
  const maxxPool = precon("precon-amx")?.pool;
  const hala = botDefinition("hala");
  const halaPool = precon(hala?.deckId ?? "")?.pool;
  if (!maxxPool || !hala || !halaPool) {
    throw new Error("Nitro test fixture decks are unavailable");
  }
  const maxxDeck = {
    heroId: maxxPool.heroId,
    weaponIds: [...maxxPool.weaponIds],
    equipment: {
      head: "AMX003",
      chest: "AMX004",
      arms: "AMX005",
      legs: "AMX006",
    },
    deck: [...maxxPool.deck, "DYN092", "SUP255"],
  };
  const halaPresentation = hala.presentationFor(maxxDeck, "second");
  const state = createGame({
    decklists: [maxxDeck, { heroId: halaPool.heroId, ...halaPresentation }],
    seed: 9082026,
    cards: cardData,
    scripts,
    startPlayer: 0,
  });

  const player = state.players[0]!;
  const cards = [...player.hand, ...player.deck];
  const take = (cardId: string) => {
    const index = cards.findIndex((card) => card.cardId === cardId);
    if (index < 0) throw new Error(`Nitro test fixture is missing ${cardId}`);
    return cards.splice(index, 1)[0]!;
  };
  const driver = (cardId: string, steam: number) => {
    const card = take(cardId);
    card.counters = { steam };
    return card;
  };
  player.hand = [take("DYN092"), take("SUP255")];
  player.board = [driver("AMX019", 3), driver("AMX023", 2), driver("AMX027", 1)];
  player.banish = [take("AMX019"), take("AMX023"), take("AMX027")];
  player.deck = cards;
  player.resources = 4;
  player.actionPoints = 1;
  return state;
}

/** Kayo is already defending Ira's Edge of Autumn with Rally the Coast Guard.
 * The reaction window belongs to Kayo, whose two remaining hand cards are
 * both legal discard choices for Rally's once-per-turn instant ability. */
function rallyTestGameState(): GameState {
  const kayoPool = precon("precon-ska")?.pool;
  const ira = botDefinition("ira");
  const iraPool = precon(ira?.deckId ?? "")?.pool;
  if (!kayoPool || !ira || !iraPool) throw new Error("Rally test fixture decks are unavailable");

  const kayoDeck = {
    heroId: kayoPool.heroId,
    weaponIds: [...kayoPool.weaponIds],
    equipment: {},
    deck: [...kayoPool.deck],
  };
  const iraPresentation = ira.presentationFor(kayoDeck, "first");
  let state = createGame({
    decklists: [kayoDeck, { heroId: iraPool.heroId, ...iraPresentation }],
    seed: 9032026,
    cards: cardData,
    scripts,
    startPlayer: 1,
  });

  const kayo = state.players[0]!;
  const kayoCards = [...kayo.hand, ...kayo.deck];
  const take = (cardId: string) => {
    const index = kayoCards.findIndex((card) => card.cardId === cardId);
    if (index < 0) throw new Error(`Rally test fixture is missing ${cardId}`);
    return kayoCards.splice(index, 1)[0]!;
  };
  const rally = take("SKA028");
  kayo.hand = [rally, take("SKA029"), take("SKA029")];
  kayo.deck = kayoCards;

  const iraPlayer = state.players[1]!;
  iraPlayer.resources = 1;
  const applyLegal = (
    current: GameState,
    seat: number,
    label: string,
    predicate: (intent: ReturnType<typeof legalIntents>[number]) => boolean,
  ): GameState => {
    const intent = legalIntents(current, seat).find(predicate);
    if (!intent) throw new Error(`Rally test fixture cannot ${label}`);
    const result = applyIntent(current, seat, intent);
    if (!result.ok) throw new Error(`Rally test fixture cannot ${label}: ${result.error}`);
    return result.state;
  };

  const weaponInstanceId = iraPlayer.weapons[0]!.instanceId;
  state = applyLegal(state, 1, "attack with Edge of Autumn", (intent) =>
    intent.kind === "activate-ability" &&
    intent.sourceInstanceId === weaponInstanceId &&
    intent.pitchInstanceIds.length === 0
  );
  for (let guard = 0; guard < 4 && state.pendingDecision?.kind !== "defend"; guard++) {
    const actor = state.pendingDecision?.player ?? state.priorityPlayer;
    state = applyLegal(state, actor, "pass attack activation priority", (intent) => intent.kind === "pass");
  }
  if (state.pendingDecision?.kind !== "defend" || state.pendingDecision.player !== 0) {
    throw new Error("Rally test fixture did not reach Kayo's defend step");
  }
  state = applyLegal(state, 0, "stage Rally as a defender", (intent) =>
    intent.kind === "stage-defenders" && intent.instanceIds[0] === rally.instanceId
  );
  state = applyLegal(state, 0, "defend with Rally", (intent) =>
    intent.kind === "defend" && intent.instanceIds.length === 1 &&
    intent.instanceIds[0] === rally.instanceId
  );
  state = applyLegal(state, 1, "pass attacker reaction priority", (intent) => intent.kind === "pass");
  const reactionDecision = state.pendingDecision;
  if (reactionDecision?.kind !== "defense-reaction" || reactionDecision.player !== 0) {
    throw new Error("Rally test fixture did not reach Kayo's reaction priority");
  }
  return state;
}

const pool = await createPool();
try {
  const { rows: runtimeConfigRows } = await pool.query(
    "SELECT active_ruleset_version FROM runtime_config WHERE singleton = TRUE",
  );
  const activeRulesetVersion = runtimeConfigRows[0]?.active_ruleset_version;
  if (activeRulesetVersion !== null && typeof activeRulesetVersion !== "string") {
    throw new Error("local active ruleset configuration is invalid");
  }
  const seedRulesetVersion = activeRulesetVersion ??
    process.env.RULESET_VERSION ?? DEFAULT_DEVELOPMENT_RULESET_VERSION;
  console.log(`local seed ruleset: ${seedRulesetVersion}`);
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
  console.log(`\ntest login: alice / ${PASSWORD}  (or bob, charlie, diana / ${PASSWORD})`);

  // phantom seats: random tokens nobody holds, so all joins are spectators
  const seats = [randomBytes(12).toString("hex"), randomBytes(12).toString("hex")];
  const prep = { rolls: [4, 2], dieWinner: 0, startPlayer: 0 };
  await pool.query("BEGIN");
  try {
    // These rooms are disposable local fixture data. Recreate them so rerunning
    // the seed also repairs stale ruleset envelopes and clears dependent history.
    await pool.query("DELETE FROM rooms WHERE code IN ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)", [
      DEMO_ROOM_CODE,
      HUNTER_TEST_ROOM_CODE,
      SNAP_ARC_TEST_ROOM_CODE,
      DAMAGE_FX_TEST_ROOM_CODE,
      OKANA_TEST_ROOM_CODE,
      RALLY_TEST_ROOM_CODE,
      MARKS_TEST_ROOM_CODE,
      NITRO_TEST_ROOM_CODE,
      CURRENT_FUNNEL_TEST_ROOM_CODE,
      ...RETIRED_TEST_ROOM_CODES,
    ]);
    await pool.query(
      `INSERT INTO rooms
        (code, format, spectators, state, prep, ruleset_version, version, created_at, gc_at, status, winner)
       VALUES ($1, 'classic-battles', '[]', $2, $3, $4, 0, $5, NULL, 'active', NULL)`,
      [
        DEMO_ROOM_CODE,
        JSON.stringify(dehydrateState(demoGameState(), seedRulesetVersion)),
        JSON.stringify(prep),
        seedRulesetVersion,
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
    const crowd: Array<{ username: string; userId: number; tokenHash: string }> = [];
    for (const username of ["bob", "charlie", "diana"]) {
      const { rows } = await pool.query(
        "SELECT id FROM users WHERE username_lc = $1",
        [username],
      );
      const userId = Number(rows[0]?.id);
      if (!Number.isSafeInteger(userId)) {
        throw new Error(`seeded ${username} account is missing`);
      }
      crowd.push({
        username,
        userId,
        tokenHash: hashReconnectToken(randomBytes(12).toString("hex")),
      });
    }
    const damageFxPrep = { rolls: [6, 1], dieWinner: 0, startPlayer: 0 };
    const damageFxBot = botDefinition("briar");
    const damageFxBotPool = precon(damageFxBot?.deckId ?? "")?.pool;
    if (!damageFxBot || !damageFxBotPool) {
      throw new Error("Damage-effects test fixture room metadata is unavailable");
    }
    await pool.query(
      `INSERT INTO rooms
        (code, format, spectators, state, prep, ruleset_version, version, created_at, gc_at,
         status, winner, is_private)
       VALUES ($1, 'silver-age', $2, $3, $4, $5, 0, $6, NULL, 'active', NULL, TRUE)`,
      [
        DAMAGE_FX_TEST_ROOM_CODE,
        JSON.stringify(crowd.map(({ tokenHash }) => ({ tokenHash }))),
        JSON.stringify(dehydrateState(damageFxTestGameState(), seedRulesetVersion)),
        JSON.stringify(damageFxPrep),
        seedRulesetVersion,
        Date.now(),
      ],
    );
    await pool.query(
      `INSERT INTO room_seats
        (room_code, seat, user_id, token_hash, username, hero_id, deck_name,
         from_queue, ready, controller)
       VALUES ($1, 0, $2, $3, 'alice', 'SBA001', 'Combat / arcane damage effects test',
               FALSE, TRUE, 'human')`,
      [
        DAMAGE_FX_TEST_ROOM_CODE,
        aliceId,
        hashReconnectToken(randomBytes(12).toString("hex")),
      ],
    );
    await pool.query(
      `INSERT INTO room_seats
        (room_code, seat, token_hash, username, hero_id, deck_id, deck_name,
         from_queue, ready, controller)
       VALUES ($1, 1, $2, $3, $4, $5, $6, FALSE, TRUE, 'bot')`,
      [
        DAMAGE_FX_TEST_ROOM_CODE,
        hashReconnectToken(randomBytes(12).toString("hex")),
        damageFxBot.username,
        damageFxBotPool.heroId,
        damageFxBot.deckId,
        damageFxBot.deckName,
      ],
    );
    for (const spectator of crowd) {
      await pool.query(
        `INSERT INTO room_presence
          (room_code, lease_id, token_hash, seat, last_seen_at, user_id)
         VALUES ($1, $2, $3, NULL, $4, $5)`,
        [
          DAMAGE_FX_TEST_ROOM_CODE,
          `seed-spectator-${spectator.username}`,
          spectator.tokenHash,
          PINNED_LOCAL_PRESENCE_AT,
          spectator.userId,
        ],
      );
    }
    const currentFunnelPrep = { rolls: [6, 1], dieWinner: 0, startPlayer: 0 };
    const halaForCurrentFunnel = botDefinition("hala");
    const halaPoolForCurrentFunnel = precon(halaForCurrentFunnel?.deckId ?? "")?.pool;
    if (!halaForCurrentFunnel || !halaPoolForCurrentFunnel) {
      throw new Error("Current Funnel test fixture room metadata is unavailable");
    }
    await pool.query(
      `INSERT INTO rooms
        (code, format, spectators, state, prep, ruleset_version, version, created_at, gc_at,
         status, winner, is_private)
       VALUES ($1, 'cc', '[]', $2, $3, $4, 0, $5, NULL, 'active', NULL, TRUE)`,
      [
        CURRENT_FUNNEL_TEST_ROOM_CODE,
        JSON.stringify(dehydrateState(currentFunnelTestGameState(), seedRulesetVersion)),
        JSON.stringify(currentFunnelPrep),
        seedRulesetVersion,
        Date.now(),
      ],
    );
    await pool.query(
      `INSERT INTO room_seats
        (room_code, seat, user_id, token_hash, username, hero_id, deck_id, deck_name,
         from_queue, ready, controller)
       VALUES ($1, 0, $2, $3, 'alice', 'AST001', 'precon-ast',
               'Arc Lightning / Rush of Power / Current Funnel test', FALSE, TRUE, 'human')`,
      [
        CURRENT_FUNNEL_TEST_ROOM_CODE,
        aliceId,
        hashReconnectToken(randomBytes(12).toString("hex")),
      ],
    );
    await pool.query(
      `INSERT INTO room_seats
        (room_code, seat, token_hash, username, hero_id, deck_id, deck_name,
         from_queue, ready, controller)
       VALUES ($1, 1, $2, $3, $4, $5, $6, FALSE, TRUE, 'bot')`,
      [
        CURRENT_FUNNEL_TEST_ROOM_CODE,
        hashReconnectToken(randomBytes(12).toString("hex")),
        halaForCurrentFunnel.username,
        halaPoolForCurrentFunnel.heroId,
        halaForCurrentFunnel.deckId,
        halaForCurrentFunnel.deckName,
      ],
    );
    const marksPrep = { rolls: [6, 2], dieWinner: 0, startPlayer: 0 };
    const halaForMarks = botDefinition("hala");
    const halaPoolForMarks = precon(halaForMarks?.deckId ?? "")?.pool;
    if (!halaForMarks || !halaPoolForMarks) {
      throw new Error("Restless Steed test fixture room metadata is unavailable");
    }
    await pool.query(
      `INSERT INTO rooms
        (code, format, spectators, state, prep, ruleset_version, version, created_at, gc_at,
         status, winner, is_private)
       VALUES ($1, 'cc', '[]', $2, $3, $4, 0, $5, NULL, 'active', NULL, TRUE)`,
      [
        MARKS_TEST_ROOM_CODE,
        JSON.stringify(dehydrateState(marksTestGameState(), seedRulesetVersion)),
        JSON.stringify(marksPrep),
        seedRulesetVersion,
        Date.now(),
      ],
    );
    await pool.query(
      `INSERT INTO room_seats
        (room_code, seat, user_id, token_hash, username, hero_id, deck_name,
         from_queue, ready, controller)
       VALUES ($1, 0, $2, $3, 'alice', 'IAR054', 'Restless Steed / Mark of Ushering test',
               FALSE, TRUE, 'human')`,
      [
        MARKS_TEST_ROOM_CODE,
        aliceId,
        hashReconnectToken(randomBytes(12).toString("hex")),
      ],
    );
    await pool.query(
      `INSERT INTO room_seats
        (room_code, seat, token_hash, username, hero_id, deck_id, deck_name,
         from_queue, ready, controller)
       VALUES ($1, 1, $2, $3, $4, $5, $6, FALSE, TRUE, 'bot')`,
      [
        MARKS_TEST_ROOM_CODE,
        hashReconnectToken(randomBytes(12).toString("hex")),
        halaForMarks.username,
        halaPoolForMarks.heroId,
        halaForMarks.deckId,
        halaForMarks.deckName,
      ],
    );
    const nitroPrep = { rolls: [6, 2], dieWinner: 0, startPlayer: 0 };
    const halaForNitro = botDefinition("hala");
    const halaPoolForNitro = precon(halaForNitro?.deckId ?? "")?.pool;
    if (!halaForNitro || !halaPoolForNitro) {
      throw new Error("Nitro test fixture room metadata is unavailable");
    }
    await pool.query(
      `INSERT INTO rooms
        (code, format, spectators, state, prep, ruleset_version, version, created_at, gc_at,
         status, winner, is_private)
       VALUES ($1, 'cc', '[]', $2, $3, $4, 0, $5, NULL, 'active', NULL, TRUE)`,
      [
        NITRO_TEST_ROOM_CODE,
        JSON.stringify(dehydrateState(nitroTestGameState(), seedRulesetVersion)),
        JSON.stringify(nitroPrep),
        seedRulesetVersion,
        Date.now(),
      ],
    );
    await pool.query(
      `INSERT INTO room_seats
        (room_code, seat, user_id, token_hash, username, hero_id, deck_id, deck_name,
         from_queue, ready, controller)
       VALUES ($1, 0, $2, $3, 'alice', 'AMX001', 'precon-amx',
               'Nitro Mechanoid repeat attacks', FALSE, TRUE, 'human')`,
      [
        NITRO_TEST_ROOM_CODE,
        aliceId,
        hashReconnectToken(randomBytes(12).toString("hex")),
      ],
    );
    await pool.query(
      `INSERT INTO room_seats
        (room_code, seat, token_hash, username, hero_id, deck_id, deck_name,
         from_queue, ready, controller)
       VALUES ($1, 1, $2, $3, $4, $5, $6, FALSE, TRUE, 'bot')`,
      [
        NITRO_TEST_ROOM_CODE,
        hashReconnectToken(randomBytes(12).toString("hex")),
        halaForNitro.username,
        halaPoolForNitro.heroId,
        halaForNitro.deckId,
        halaForNitro.deckName,
      ],
    );
    const hunterPrep = { rolls: [2, 5], dieWinner: 1, startPlayer: 1 };
    await pool.query(
      `INSERT INTO rooms
        (code, format, spectators, state, prep, ruleset_version, version, created_at, gc_at,
         status, winner, is_private)
       VALUES ($1, 'cc', '[]', $2, $3, $4, 0, $5, NULL, 'active', NULL, TRUE)`,
      [
        HUNTER_TEST_ROOM_CODE,
        JSON.stringify(dehydrateState(hunterTestGameState(), seedRulesetVersion)),
        JSON.stringify(hunterPrep),
        seedRulesetVersion,
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
    const okanaPrep = { rolls: [6, 1], dieWinner: 0, startPlayer: 0 };
    const ira = botDefinition("ira");
    const halaForOkana = botDefinition("hala");
    if (!ira || !halaForOkana) throw new Error("Okana test fixture bots are unavailable");
    const iraPool = precon(ira.deckId)?.pool;
    const halaPoolForOkana = precon(halaForOkana.deckId)?.pool;
    if (!iraPool || !halaPoolForOkana) throw new Error("Okana test fixture bot decks are unavailable");
    await pool.query(
      `INSERT INTO rooms
        (code, format, spectators, state, prep, ruleset_version, version, created_at, gc_at,
         status, winner, is_private)
       VALUES ($1, 'cc', '[]', $2, $3, $4, 0, $5, NULL, 'active', NULL, TRUE)`,
      [
        OKANA_TEST_ROOM_CODE,
        JSON.stringify(dehydrateState(okanaTestGameState(), seedRulesetVersion)),
        JSON.stringify(okanaPrep),
        seedRulesetVersion,
        Date.now(),
      ],
    );
    await pool.query(
      `INSERT INTO room_seats
        (room_code, seat, user_id, token_hash, username, hero_id, deck_id, deck_name,
         from_queue, ready, controller)
       VALUES ($1, 0, $2, $3, 'alice', $4, $5, $6, FALSE, TRUE, 'human')`,
      [
        OKANA_TEST_ROOM_CODE,
        aliceId,
        hashReconnectToken(randomBytes(12).toString("hex")),
        iraPool.heroId,
        ira.deckId,
        "Okana Scar Wraps / Enact Vengeance test",
      ],
    );
    await pool.query(
      `INSERT INTO room_seats
        (room_code, seat, token_hash, username, hero_id, deck_id, deck_name,
         from_queue, ready, controller)
       VALUES ($1, 1, $2, $3, $4, $5, $6, FALSE, TRUE, 'bot')`,
      [
        OKANA_TEST_ROOM_CODE,
        hashReconnectToken(randomBytes(12).toString("hex")),
        halaForOkana.username,
        halaPoolForOkana.heroId,
        halaForOkana.deckId,
        halaForOkana.deckName,
      ],
    );
    const snapArcPrep = { rolls: [6, 2], dieWinner: 0, startPlayer: 0 };
    const briar = botDefinition("briar");
    if (!briar) throw new Error("Snap/Arc test fixture bot is unavailable");
    const briarPool = precon(briar.deckId)?.pool;
    if (!briarPool) throw new Error("Snap/Arc test fixture bot deck is unavailable");
    await pool.query(
      `INSERT INTO rooms
        (code, format, spectators, state, prep, ruleset_version, version, created_at, gc_at,
         status, winner, is_private)
       VALUES ($1, 'silver-age', '[]', $2, $3, $4, 0, $5, NULL, 'active', NULL, TRUE)`,
      [
        SNAP_ARC_TEST_ROOM_CODE,
        JSON.stringify(dehydrateState(snapArcTestGameState(), seedRulesetVersion)),
        JSON.stringify(snapArcPrep),
        seedRulesetVersion,
        Date.now(),
      ],
    );
    await pool.query(
      `INSERT INTO room_seats
        (room_code, seat, user_id, token_hash, username, hero_id, deck_name,
         from_queue, ready, controller)
       VALUES ($1, 0, $2, $3, 'alice', 'ELE032', 'Snap Shot starts in arsenal test',
               FALSE, TRUE, 'human')`,
      [
        SNAP_ARC_TEST_ROOM_CODE,
        aliceId,
        hashReconnectToken(randomBytes(12).toString("hex")),
      ],
    );
    await pool.query(
      `INSERT INTO room_seats
        (room_code, seat, token_hash, username, hero_id, deck_id, deck_name,
         from_queue, ready, controller)
       VALUES ($1, 1, $2, $3, $4, $5, $6, FALSE, TRUE, 'bot')`,
      [
        SNAP_ARC_TEST_ROOM_CODE,
        hashReconnectToken(randomBytes(12).toString("hex")),
        briar.username,
        briarPool.heroId,
        briar.deckId,
        briar.deckName,
      ],
    );
    const rallyPrep = { rolls: [2, 6], dieWinner: 1, startPlayer: 1 };
    const iraForRally = botDefinition("ira");
    const kayoPoolForRally = precon("precon-ska")?.pool;
    const iraPoolForRally = precon(iraForRally?.deckId ?? "")?.pool;
    if (!iraForRally || !kayoPoolForRally || !iraPoolForRally) {
      throw new Error("Rally test fixture room metadata is unavailable");
    }
    await pool.query(
      `INSERT INTO rooms
        (code, format, spectators, state, prep, ruleset_version, version, created_at, gc_at,
         status, winner, is_private)
       VALUES ($1, 'silver-age', '[]', $2, $3, $4, 0, $5, NULL, 'active', NULL, TRUE)`,
      [
        RALLY_TEST_ROOM_CODE,
        JSON.stringify(dehydrateState(rallyTestGameState(), seedRulesetVersion)),
        JSON.stringify(rallyPrep),
        seedRulesetVersion,
        Date.now(),
      ],
    );
    await pool.query(
      `INSERT INTO room_seats
        (room_code, seat, user_id, token_hash, username, hero_id, deck_id, deck_name,
         from_queue, ready, controller)
       VALUES ($1, 0, $2, $3, 'alice', $4, 'precon-ska',
               'Rally the Coast Guard test', FALSE, TRUE, 'human')`,
      [
        RALLY_TEST_ROOM_CODE,
        aliceId,
        hashReconnectToken(randomBytes(12).toString("hex")),
        kayoPoolForRally.heroId,
      ],
    );
    await pool.query(
      `INSERT INTO room_seats
        (room_code, seat, token_hash, username, hero_id, deck_id, deck_name,
         from_queue, ready, controller)
       VALUES ($1, 1, $2, $3, $4, $5, $6, FALSE, TRUE, 'bot')`,
      [
        RALLY_TEST_ROOM_CODE,
        hashReconnectToken(randomBytes(12).toString("hex")),
        iraForRally.username,
        iraPoolForRally.heroId,
        iraForRally.deckId,
        iraForRally.deckName,
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
        seedRulesetVersion,
        "Cards in the combat chain briefly appeared in the wrong order.",
        JSON.stringify({
          version: 1,
          capturedAt: fixedAt,
          room: {
            code: DEMO_ROOM_CODE,
            format: "classic-battles",
            rulesetVersion: seedRulesetVersion,
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
  console.log(`seeded demo room ${DEMO_ROOM_CODE} — log in as alice and spectate Rhinar vs Dorinthea from /${DEMO_ROOM_CODE}`);
  console.log(`seeded Hunter or Hunted? room ${HUNTER_TEST_ROOM_CODE} — log in as alice and open /${HUNTER_TEST_ROOM_CODE}`);
  console.log(`seeded Snap Shot / Arc Bending room ${SNAP_ARC_TEST_ROOM_CODE} — log in as alice and open /${SNAP_ARC_TEST_ROOM_CODE}`);
  console.log(`seeded damage-effects room ${DAMAGE_FX_TEST_ROOM_CODE} — log in as alice and open /${DAMAGE_FX_TEST_ROOM_CODE}; bob, charlie, and diana are spectating`);
  console.log(`seeded Okana Scar Wraps / Enact Vengeance room ${OKANA_TEST_ROOM_CODE} — log in as alice and open /${OKANA_TEST_ROOM_CODE}`);
  console.log(`seeded Rally the Coast Guard room ${RALLY_TEST_ROOM_CODE} — log in as alice and open /${RALLY_TEST_ROOM_CODE}`);
  console.log(`seeded Restless Steed / Mark of Ushering room ${MARKS_TEST_ROOM_CODE} — log in as alice and open /${MARKS_TEST_ROOM_CODE}`);
  console.log(`seeded Nitro Mechanoid room ${NITRO_TEST_ROOM_CODE} — log in as alice and open /${NITRO_TEST_ROOM_CODE}`);
  console.log(`seeded Current Funnel room ${CURRENT_FUNNEL_TEST_ROOM_CODE} — log in as alice and open /${CURRENT_FUNNEL_TEST_ROOM_CODE}`);
  console.log("seeded fixed bug notification for alice");
} finally {
  await pool.end();
}
