/**
 * Fabdex spike gauntlet (Phase 0 of the Fabdex Duel plan) — SPIKE-ONLY, not shipped.
 *
 * Feeds every deck of a Fabdex META-corpus export (one JSON object per line,
 * `{hostRef, format, cardPoolMode, lines}`) through the
 * same path a host-handed deck will take:
 *
 *   1. `validateDeck(lines, format)` — import: every line must resolve and be implemented.
 *   2. a presented deck carved from the pool, checked by `validatePresentation` under the
 *      deck's card-pool mode.
 *   3. K seeded games against every registered bot of the format. The bot seat runs its
 *      real policy (`chooseDecision`); the human seat plays uniformly random legal intents,
 *      as `packages/cards/src/__tests__/fullmatch.test.ts` does.
 *
 * It counts import failures (by card name), presentation failures, advertised intents the
 * engine REJECTS, exceptions, step-cap timeouts, stalemates, game lengths, and bot decision
 * latency (p50/p99/max; the server warns at 250 ms). GO needs 0 rejected intents and 0
 * exceptions.
 *
 *   pnpm --filter @fyendal/server exec node --import tsx ../../scripts/fabdex-gauntlet.mts \
 *     --corpus /path/to/fyendal_corpus.jsonl --games 2 [--bots ira,hala] [--limit 50] \
 *     [--out /path/to/summary.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { applyIntent, createGame, legalIntents, projectStateFor, rngNext } from "../packages/engine/src/index.js";
import type { GameState } from "../packages/engine/src/index.js";
import {
  cardData,
  equipmentFitsSlot,
  EXACT_DECK_SIZE,
  precon,
  scripts,
  validatePresentation,
  weaponSelectionError,
} from "../packages/cards/src/index.js";
import { botDefinitions, type BotDefinition } from "../packages/bot/src/index.js";
import type {
  CardPoolMode,
  Decklist,
  DeckPool,
  EquipmentSlot,
  Format,
  GameIntent,
  PresentedDeck,
} from "../packages/shared/src/index.js";
import { validateDeck } from "../apps/server/src/decks.js";

interface CorpusLine {
  qty: number;
  name: string;
  pitch?: number;
  section: "hero" | "deck" | "sideboard";
}

interface CorpusDeck {
  hostRef: string;
  format: Format;
  cardPoolMode: CardPoolMode;
  hero?: string;
  lines: CorpusLine[];
}

type Outcome = "win" | "stalemate" | "timeout" | "rejected" | "exception";

interface GameRecord {
  deck: string;
  bot: string;
  seed: number;
  humanFirst: boolean;
  outcome: Outcome;
  winner: number | null;
  turns: number;
  steps: number;
  detail?: string;
}

const { values: args } = parseArgs({
  options: {
    corpus: { type: "string" },
    games: { type: "string", default: "2" },
    bots: { type: "string" },
    limit: { type: "string" },
    "seed-base": { type: "string", default: "20260924" },
    "max-steps": { type: "string", default: "6000" },
    out: { type: "string" },
  },
});
if (!args.corpus) {
  console.error("--corpus <path to the Fabdex export JSONL> is required");
  process.exit(2);
}
const GAMES = Number(args.games);
const SEED_BASE = Number(args["seed-base"]);
const MAX_STEPS = Number(args["max-steps"]);
const BOT_FILTER = args.bots ? new Set(args.bots.split(",")) : null;
const EQUIPMENT_SLOTS: EquipmentSlot[] = ["head", "chest", "arms", "legs"];

const decks: CorpusDeck[] = readFileSync(args.corpus, "utf8")
  .split("\n")
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line) as CorpusDeck)
  .slice(0, args.limit ? Number(args.limit) : undefined);

function makeRand(seed: number) {
  const carrier = { rngState: seed | 0 };
  return () => rngNext(carrier);
}

/** The first presentable weapon selection from the pool: two compatible weapons if any
 * pair passes `weaponSelectionError`, else the first single one. */
function pickWeapons(pool: DeckPool): string[] {
  const ids = pool.weaponIds;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const pair = [ids[i]!, ids[j]!];
      if (weaponSelectionError(cardData, pair) === null) return pair;
    }
  }
  for (const id of ids) if (weaponSelectionError(cardData, [id]) === null) return [id];
  return [];
}

/** A deterministic presentation: weapons as above, the first fitting equipment per slot,
 * and the main deck from `deck` then `sideboard` up to the format's exact size (Silver Age)
 * or all of it (CC, which has a minimum only). */
function presentFromPool(pool: DeckPool, format: Format): PresentedDeck {
  const equipment: Partial<Record<EquipmentSlot, string>> = {};
  const used = new Set<number>();
  for (const slot of EQUIPMENT_SLOTS) {
    const idx = pool.equipmentPool.findIndex(
      (id, i) => !used.has(i) && equipmentFitsSlot(cardData[id], slot),
    );
    if (idx >= 0) {
      used.add(idx);
      equipment[slot] = pool.equipmentPool[idx]!;
    }
  }
  const mainPool = [...pool.deck, ...(pool.sideboard ?? [])];
  const exact = EXACT_DECK_SIZE[format];
  const deck = exact ? mainPool.slice(0, exact) : mainPool;
  return { weaponIds: pickWeapons(pool), equipment, deck };
}

function percentile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

const importFailures: { deck: string; errors: string[]; missing: string[]; unimplemented: string[] }[] = [];
const presentationFailures: { deck: string; side: string; error: string }[] = [];
const missingByName = new Map<string, number>();
const games: GameRecord[] = [];
const botMs: number[] = [];
const botMsByBot = new Map<string, number[]>();

function playOne(deck: CorpusDeck, human: Decklist, bot: BotDefinition, botDeck: Decklist, seed: number, humanFirst: boolean): GameRecord {
  const humanSeat = 0;
  const botSeat = 1;
  const rand = makeRand(seed ^ 0x5a17);
  const base = { deck: deck.hostRef, bot: bot.id, seed, humanFirst };
  let state: GameState;
  try {
    state = createGame({
      decklists: [human, botDeck],
      seed,
      cards: cardData,
      scripts,
      startPlayer: humanFirst ? 0 : 1,
    });
  } catch (err) {
    return { ...base, outcome: "exception", winner: null, turns: 0, steps: 0, detail: `createGame: ${String(err)}` };
  }
  let steps = 0;
  let stagnant = 0;
  let last = "";
  try {
    while (state.winner === null && steps < MAX_STEPS) {
      const seat = state.pendingDecision?.player ?? state.priorityPlayer;
      const legal = legalIntents(state, seat).filter((intent) => intent.kind !== "concede");
      if (!legal.length) {
        return { ...base, outcome: "rejected", winner: null, turns: state.turn, steps, detail: `no legal intents for seat ${seat}` };
      }
      let intent: GameIntent;
      if (seat === botSeat) {
        const t0 = performance.now();
        intent = bot.chooseDecision({
          seat: botSeat,
          view: projectStateFor(state, botSeat),
          legal,
          cards: cardData,
          state,
        }).intent;
        const ms = performance.now() - t0;
        botMs.push(ms);
        const list = botMsByBot.get(bot.id) ?? [];
        list.push(ms);
        botMsByBot.set(bot.id, list);
      } else {
        intent = legal[Math.floor(rand() * legal.length)]!;
      }
      const result = applyIntent(state, seat, intent);
      if (!result.ok) {
        const who = seat === humanSeat ? "random" : `bot:${bot.id}`;
        return {
          ...base,
          outcome: "rejected",
          winner: null,
          turns: state.turn,
          steps,
          detail: `${who} ${JSON.stringify(intent)} → ${result.error}`,
        };
      }
      state = result.state;
      steps++;
      const snapshot = JSON.stringify(
        state.players.map((p) => [p.life, p.hand.length, p.deck.length, p.graveyard.length]),
      );
      stagnant = snapshot === last ? stagnant + 1 : 0;
      last = snapshot;
      if (stagnant > 40) {
        return { ...base, outcome: "stalemate", winner: null, turns: state.turn, steps };
      }
    }
  } catch (err) {
    const stack = err instanceof Error ? (err.stack ?? err.message) : String(err);
    return { ...base, outcome: "exception", winner: null, turns: state.turn, steps, detail: stack.split("\n").slice(0, 6).join(" | ") };
  }
  if (state.winner === null) {
    return { ...base, outcome: "timeout", winner: null, turns: state.turn, steps };
  }
  return { ...base, outcome: "win", winner: state.winner, turns: state.turn, steps };
}

const started = performance.now();
for (const deck of decks) {
  const validation = validateDeck(deck.lines, deck.format);
  if (!validation.ok) {
    importFailures.push({ deck: deck.hostRef, errors: validation.errors, missing: validation.missing, unimplemented: validation.unimplemented });
    for (const name of [...validation.missing, ...validation.unimplemented]) {
      missingByName.set(name, (missingByName.get(name) ?? 0) + 1);
    }
    continue;
  }
  const pool = validation.decklist;
  const presented = validatePresentation(pool, presentFromPool(pool, deck.format), deck.format, {
    cardPoolMode: deck.cardPoolMode,
  });
  if (!presented.ok) {
    presentationFailures.push({ deck: deck.hostRef, side: "human", error: presented.error });
    continue;
  }
  const human = presented.decklist;
  const bots = botDefinitions.filter((b) => b.format === deck.format && (!BOT_FILTER || BOT_FILTER.has(b.id)));
  for (const bot of bots) {
    const registered = precon(bot.deckId);
    if (!registered) {
      presentationFailures.push({ deck: deck.hostRef, side: `bot:${bot.id}`, error: "bot precon missing" });
      continue;
    }
    for (let g = 0; g < GAMES; g++) {
      const humanFirst = g % 2 === 0;
      const botPresentation = bot.presentationFor(human, humanFirst ? "second" : "first");
      const botValidation = validatePresentation(registered.pool, botPresentation, deck.format, {
        cardPoolMode: bot.presentationCardPoolMode ?? deck.cardPoolMode,
      });
      if (!botValidation.ok) {
        presentationFailures.push({ deck: deck.hostRef, side: `bot:${bot.id}`, error: botValidation.error });
        break;
      }
      games.push(playOne(deck, human, bot, botValidation.decklist, SEED_BASE + games.length, humanFirst));
    }
  }
}
const elapsed = (performance.now() - started) / 1000;

const byOutcome = new Map<Outcome, number>();
for (const g of games) byOutcome.set(g.outcome, (byOutcome.get(g.outcome) ?? 0) + 1);
const imported = decks.length - importFailures.length;
const byFormat = new Map<string, { total: number; imported: number }>();
for (const deck of decks) {
  const row = byFormat.get(deck.format + "/" + deck.cardPoolMode) ?? { total: 0, imported: 0 };
  row.total++;
  if (!importFailures.some((f) => f.deck === deck.hostRef)) row.imported++;
  byFormat.set(deck.format + "/" + deck.cardPoolMode, row);
}
botMs.sort((a, b) => a - b);
const turns = games.filter((g) => g.outcome === "win").map((g) => g.turns).sort((a, b) => a - b);

const summary = {
  decks: decks.length,
  imported,
  importRate: decks.length ? imported / decks.length : 0,
  byFormat: Object.fromEntries(byFormat),
  presentationFailures: presentationFailures.length,
  games: games.length,
  outcomes: Object.fromEntries(byOutcome),
  turnsP50: percentile(turns, 0.5),
  turnsP90: percentile(turns, 0.9),
  botDecisionMs: { n: botMs.length, p50: percentile(botMs, 0.5), p99: percentile(botMs, 0.99), max: botMs.at(-1) ?? 0 },
  botDecisionMsByBot: Object.fromEntries(
    [...botMsByBot].map(([id, list]) => {
      const sorted = [...list].sort((a, b) => a - b);
      return [id, { n: sorted.length, p50: percentile(sorted, 0.5), p99: percentile(sorted, 0.99), max: sorted.at(-1) ?? 0 }];
    }),
  ),
  elapsedSeconds: elapsed,
  missingByName: Object.fromEntries([...missingByName].sort((a, b) => b[1] - a[1])),
  importFailures,
  presentationFailureList: presentationFailures,
  problemGames: games.filter((g) => g.outcome === "rejected" || g.outcome === "exception"),
};

console.log(`decks ${summary.decks} · imported ${imported} (${(100 * summary.importRate).toFixed(1)}%)`);
for (const [key, row] of byFormat) console.log(`  ${key}: ${row.imported}/${row.total}`);
console.log(`presentation failures ${presentationFailures.length}`);
console.log(`games ${games.length} · outcomes ${JSON.stringify(summary.outcomes)} · turns p50 ${summary.turnsP50} p90 ${summary.turnsP90}`);
console.log(`bot decision ms p50 ${summary.botDecisionMs.p50.toFixed(1)} p99 ${summary.botDecisionMs.p99.toFixed(1)} max ${summary.botDecisionMs.max.toFixed(1)} (n ${botMs.length})`);
console.log(`elapsed ${elapsed.toFixed(1)}s`);
for (const g of summary.problemGames.slice(0, 20)) console.log(`  ✗ ${g.outcome} ${g.deck} vs ${g.bot} seed ${g.seed}: ${g.detail}`);
if (args.out) {
  writeFileSync(args.out, JSON.stringify(summary, null, 2));
  console.log(`summary → ${args.out}`);
}
const gateRed = (byOutcome.get("rejected") ?? 0) + (byOutcome.get("exception") ?? 0);
process.exit(gateRed > 0 ? 1 : 0);
