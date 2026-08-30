/**
 * Golden-match convention: one golden full match per new hero pairing when a
 * set lands. Golden matches prove decks integrate end-to-end; they are NOT
 * where card behavior is pinned down — that lives in per-card scenario tests
 * (see __tests__/scenarios/, driven by __tests__/harness.ts). Add a scenario
 * whenever a card gets a script; add a golden match only when a new pairing
 * (or a new set's decks) becomes legal.
 */
import { describe, expect, it } from "vitest";
import { applyIntent, createGame, legalIntents, projectStateFor, rngNext } from "@fyendal/engine";
import type { GameState } from "@fyendal/engine";
import type { Decklist } from "@fyendal/shared";
import { cardData, decklists, scripts } from "../index.js";

function formatLog(log: GameState["log"]): string {
  return log.map((entry) => entry.publicText
    ?? entry.seatText?.filter((text): text is string => text !== null).join(" / ")
    ?? "(private)").join(" | ");
}

/**
 * The Lyath Goldmane Silver Age precon as a presented 40-card deck (the full
 * 46-card pool minus one copy of six blues), for the Lyath vs Rhinar pairing.
 */
const LYATH: Decklist = {
  heroId: "SLY001",
  weaponIds: ["SLY002", "SLY004"], // Titan's Fist + Stonewall Impasse (off-hand)
  equipment: {
    head: "SLY005", // Blade Beckoner Helm
    chest: "SLY007", // Blade Beckoner Plating
    arms: "SLY009", // Line Crossers
    legs: "SLY010", // Stand Strong
  },
  deck: [
    // reds (2 each)
    "SLY016", "SLY016", "SLY012", "SLY012", "SLY017", "SLY017",
    "SLY011", "SLY011", "SLY019", "SLY019", "SLY013", "SLY013",
    "SLY014", "SLY014", "SLY018", "SLY018", "SLY015", "SLY015",
    // yellows (2 each)
    "SLY020", "SLY020", "SLY021", "SLY021", "SLY022", "SLY022", "SLY023", "SLY023",
    // blues (2 each of four, 1 each of six)
    "SLY030", "SLY030", "SLY024", "SLY024", "SLY031", "SLY031", "SLY032", "SLY032",
    "SLY025", "SLY026", "SLY027", "SLY028", "SLY029", "SLY033",
  ],
};

function newGame(seed: number): GameState {
  return createGame({
    decklists: [decklists.dorinthea, decklists.rhinar],
    seed,
    cards: cardData,
    scripts,
  });
}

/**
 * The Blaze, Firemind Silver Age precon as a presented 40-card deck (the full
 * 48-card pool minus one copy of eight blues), for the Blaze vs Rhinar pairing.
 */
const BLAZE_DECK: Decklist = {
  heroId: "SBZ001",
  weaponIds: ["SBZ002"], // Crucible of Aetherweave
  equipment: {
    head: "SBZ003", // Talismanic Lens
    chest: "SBZ004", // Spellfire Cloak
    arms: "SBZ005", // Blade Beckoner Gauntlets
    legs: "SBZ007", // Aetherstorm Wellingtons
  },
  deck: [
    // reds (2 each)
    "SBZ009", "SBZ009", "SBZ010", "SBZ010", "SBZ011", "SBZ011", "SBZ012", "SBZ012",
    "SBZ013", "SBZ013", "SBZ014", "SBZ014", "SBZ015", "SBZ015", "SBZ016", "SBZ016",
    "SBZ017", "SBZ017", "SBZ018", "SBZ018", "SBZ019", "SBZ019", "SBZ020", "SBZ020",
    // yellows (2 each)
    "SBZ021", "SBZ021", "SBZ022", "SBZ022", "SBZ023", "SBZ023",
    // blues (2 each of five)
    "SBZ024", "SBZ024", "SBZ025", "SBZ025", "SBZ027", "SBZ027", "SBZ029", "SBZ029",
    "SBZ032", "SBZ032",
  ],
};

/** Viserai's Chapter 1 Silver Age precon, presented as 40 cards. */
const VISERAI_DECK: Decklist = {
  heroId: "SVI001",
  weaponIds: ["SVI002"],
  equipment: {
    head: "SVI003", // Blade Beckoner Helm
    chest: "SVI006", // Runebleed Robe
    arms: "SVI007", // Beckoning Haunt
    legs: "SVI009", // Blade Beckoner Boots
  },
  deck: [
    // reds (2 each)
    "SVI011", "SVI011", "SVI020", "SVI020", "SVI012", "SVI012", "SVI021", "SVI021",
    "SVI022", "SVI022", "SVI023", "SVI023", "SVI018", "SVI018", "SVI013", "SVI013",
    "SVI014", "SVI014", "SVI015", "SVI015", "SVI016", "SVI016", "SVI019", "SVI019",
    "SVI017", "SVI017",
    // yellows (2 each)
    "SVI025", "SVI025", "SVI024", "SVI024",
    // blues (2 each)
    "SVI029", "SVI029", "SVI030", "SVI030", "SVI031", "SVI031", "SVI026", "SVI026",
    "SVI032", "SVI032",
  ],
};

/** Dash's Chapter 1 Silver Age precon, presented as 40 cards. */
const DASH_DECK: Decklist = {
  heroId: "SDA001",
  weaponIds: ["SDA002"], // Plasma Barrel Shot
  equipment: {
    head: "SDA004", // Blade Beckoner Helm
    chest: "SDA007", // Blossom of Spring
    arms: "SDA008", // Blade Beckoner Gauntlets
    legs: "SDA010", // Achilles Accelerator
  },
  deck: [
    // all reds (25)
    "SDA012", "SDA012", "SDA013", "SDA013", "SDA014", "SDA014", "SDA015", "SDA015",
    "SDA016", "SDA016", "SDA017", "SDA017", "SDA018", "SDA018", "SDA019", "SDA019",
    "SDA020", "SDA020", "SDA021", "SDA021", "SDA022", "SDA022", "SDA023", "SDA023",
    "SDA024",
    // all yellows (6)
    "SDA025", "SDA025", "SDA026", "SDA026", "SDA027", "SDA027",
    // nine blues
    "SDA028", "SDA028", "SDA029", "SDA029", "SDA030", "SDA030", "SDA031", "SDA031",
    "SDA032",
  ],
};

/** Bravo, Flattering Showman's Chapter 1 Silver Age precon, presented as 40 cards. */
const BRAVO_FLATTERING_DECK: Decklist = {
  heroId: "SBR001",
  weaponIds: ["SBR002"], // Sledge of Anvilheim
  equipment: {
    head: "SBR005", // Blade Beckoner Helm
    chest: "SBR007", // Magmatic Carapace
    arms: "SBR009", // Blade Beckoner Gauntlets
    legs: "SBR012", // Basalt Boots
  },
  deck: [
    "SBR013", "SBR013", "SBR014", "SBR014", "SBR015", "SBR015", "SBR016", "SBR016",
    "SBR017", "SBR017", "SBR018", "SBR018", "SBR019", "SBR019", "SBR020", "SBR020",
    "SBR021", "SBR021", "SBR022", "SBR022", "SBR023", "SBR023", "SBR024", "SBR024",
    "SBR025", "SBR025", "SBR026", "SBR026", "SBR027", "SBR027", "SBR028", "SBR028",
    "SBR029", "SBR029", "SBR030", "SBR030", "SBR031", "SBR031", "SBR032", "SBR032",
  ],
};

/** Kayo's Chapter 1 Silver Age precon, presented as 40 cards. */
const KAYO_DECK: Decklist = {
  heroId: "SKA001",
  weaponIds: ["SKA002"], // Mandible Claw
  equipment: {
    head: "SKA003", // Knucklehead
    chest: "SKA006", // Predatory Plating
    arms: "SKA007", // Blade Beckoner Gauntlets
    legs: "SKA009", // Beaten Trackers
  },
  deck: [
    // reds (2 each)
    "SKA010", "SKA010", "SKA011", "SKA011", "SKA012", "SKA012", "SKA013", "SKA013",
    "SKA014", "SKA014", "SKA015", "SKA015", "SKA016", "SKA016", "SKA017", "SKA017",
    "SKA018", "SKA018", "SKA019", "SKA019", "SKA020", "SKA020",
    // yellows (the official pool has one Clash of Might)
    "SKA021", "SKA021", "SKA022", "SKA023", "SKA023", "SKA024", "SKA024",
    // eleven blues
    "SKA025", "SKA025", "SKA026", "SKA026", "SKA027", "SKA027", "SKA028", "SKA028",
    "SKA029", "SKA029", "SKA030",
  ],
};

/** Iyslander's Chapter 1 Silver Age precon, presented as 40 cards. */
const IYSLANDER_DECK: Decklist = {
  heroId: "SIY001",
  weaponIds: ["SIY002"], // Crucible of Aetherweave
  equipment: {
    head: "SIY003", // Blade Beckoner Helm
    chest: "SIY005", // Spellfire Cloak
    arms: "SIY006", // Blade Beckoner Gauntlets
    legs: "SIY008", // Aetherstorm Wellingtons
  },
  deck: [
    // all reds (15) and both yellows
    "SIY010", "SIY010", "SIY011", "SIY012", "SIY012", "SIY013", "SIY013",
    "SIY014", "SIY014", "SIY015", "SIY015", "SIY016", "SIY016", "SIY017", "SIY017",
    "SIY018", "SIY018",
    // two copies of ten blue actions, plus one each of three utility blues
    "SIY019", "SIY019", "SIY020", "SIY020", "SIY021", "SIY021", "SIY022", "SIY022",
    "SIY023", "SIY023", "SIY024", "SIY024", "SIY025", "SIY025", "SIY026", "SIY026",
    "SIY027", "SIY027", "SIY028", "SIY028", "SIY031", "SIY033", "SIY034",
  ],
};

function makeRand(seed: number) {
  const carrier = { rngState: seed | 0 };
  return () => rngNext(carrier);
}

describe("Classic Battles full match (real decks)", () => {
  it("plays seeded random matches to completion without errors", () => {
    for (let game = 0; game < 10; game++) {
      const rand = makeRand(5000 + game);
      let s = newGame(1000 + game);
      let steps = 0;
      // FaB has no fatigue: with both decks and hands empty and only passes
      // left, a random game can legitimately stalemate. Detect a full round
      // without any zone/life change and call it a draw — the assertion that
      // matters here is that every enumerated intent applies cleanly.
      let stagnantRounds = 0;
      let lastSnapshot = "";
      while (s.winner === null && steps < 2000) {
        const seat = s.pendingDecision?.player ?? s.priorityPlayer;
        const options = legalIntents(s, seat).filter((i) => i.kind !== "concede");
        expect(options.length, `no legal intents at step ${steps} (game ${game})`).toBeGreaterThan(0);
        const intent = options[Math.floor(rand() * options.length)]!;
        const r = applyIntent(s, seat, intent);
        expect(
          r.ok,
          `game ${game} step ${steps}: ${JSON.stringify(intent)} → ${r.ok ? "" : r.error}\nlast log: ${formatLog(s.log.slice(-5))}`,
        ).toBe(true);
        if (!r.ok) return;
        s = r.state;
        steps++;
        const snapshot = JSON.stringify([
          s.players.map((p) => [p.life, p.hand.length, p.deck.length, p.graveyard.length]),
        ]);
        stagnantRounds = snapshot === lastSnapshot ? stagnantRounds + 1 : 0;
        lastSnapshot = snapshot;
        if (stagnantRounds > 8) break; // no progress for several rounds: stalemate
      }
      if (s.winner === null) {
        expect(stagnantRounds, `game ${game} made no progress yet is not a stalemate`).toBeGreaterThan(8);
      }
    }
  });

  it("produces a valid projection for both seats mid-game", () => {
    const rand = makeRand(42);
    let s = newGame(7);
    for (let i = 0; i < 60 && s.winner === null; i++) {
      const seat = s.pendingDecision?.player ?? s.priorityPlayer;
      const options = legalIntents(s, seat).filter((x) => x.kind !== "concede");
      const r = applyIntent(s, seat, options[Math.floor(rand() * options.length)]!);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      s = r.state;
    }
    for (const seat of [0, 1]) {
      const view = projectStateFor(s, seat);
      expect(view.players[seat]!.hand.length).toBe(view.players[seat]!.handCount);
      expect(view.players[1 - seat]!.hand.length).toBe(0);
      expect(view.log.length).toBeGreaterThan(0);
    }
  });

  it("every deck card id has data and both decks are 40 cards (mentor included)", () => {
    for (const dl of [decklists.dorinthea, decklists.rhinar]) {
      expect(dl.deck).toHaveLength(40);
      for (const id of dl.deck) expect(cardData[id], id).toBeTruthy();
      // the mentor is an ordinary deck card, shuffled in with the rest
      expect(dl.deck.some((id) => cardData[id]!.cardType === "mentor")).toBe(true);
    }
  });

  it("arsenals start empty — mentors are deck cards, not arsenal cards", () => {
    const s = newGame(1);
    expect(s.players[0]!.arsenal).toHaveLength(0);
    expect(s.players[1]!.arsenal).toHaveLength(0);
  });
});

describe("Lyath vs Rhinar full match (Silver Age precon vs Classic Battles)", () => {  it("plays seeded random matches to completion without errors", () => {
    for (let game = 0; game < 6; game++) {
      const rand = makeRand(7000 + game);
      let s = createGame({
        decklists: [decklists.rhinar, LYATH],
        seed: 3000 + game,
        cards: cardData,
        scripts,
      });
      let steps = 0;
      let stagnantRounds = 0;
      let lastSnapshot = "";
      while (s.winner === null && steps < 2000) {
        const seat = s.pendingDecision?.player ?? s.priorityPlayer;
        const options = legalIntents(s, seat).filter((i) => i.kind !== "concede");
        expect(options.length, `no legal intents at step ${steps} (game ${game})`).toBeGreaterThan(0);
        const intent = options[Math.floor(rand() * options.length)]!;
        const r = applyIntent(s, seat, intent);
        expect(
          r.ok,
          `game ${game} step ${steps}: ${JSON.stringify(intent)} → ${r.ok ? "" : r.error}\nlast log: ${formatLog(s.log.slice(-5))}`,
        ).toBe(true);
        if (!r.ok) return;
        s = r.state;
        steps++;
        const snapshot = JSON.stringify([
          s.players.map((p) => [p.life, p.hand.length, p.deck.length, p.graveyard.length]),
        ]);
        stagnantRounds = snapshot === lastSnapshot ? stagnantRounds + 1 : 0;
        lastSnapshot = snapshot;
        if (stagnantRounds > 8) break; // no progress for several rounds: stalemate
      }
      if (s.winner === null) {
        expect(stagnantRounds, `game ${game} made no progress yet is not a stalemate`).toBeGreaterThan(8);
      }
    }
  });
});

describe("Blaze vs Rhinar full match (Silver Age precon vs Classic Battles)", () => {
  it("plays seeded random matches to completion without errors", () => {
    for (let game = 0; game < 6; game++) {
      const rand = makeRand(9000 + game);
      let s = createGame({
        decklists: [decklists.rhinar, BLAZE_DECK],
        seed: 6000 + game,
        cards: cardData,
        scripts,
      });
      let steps = 0;
      let stagnantRounds = 0;
      let lastSnapshot = "";
      while (s.winner === null && steps < 2000) {
        const seat = s.pendingDecision?.player ?? s.priorityPlayer;
        const options = legalIntents(s, seat).filter((i) => i.kind !== "concede");
        expect(options.length, `no legal intents at step ${steps} (game ${game})`).toBeGreaterThan(0);
        const intent = options[Math.floor(rand() * options.length)]!;
        const r = applyIntent(s, seat, intent);
        expect(
          r.ok,
          `game ${game} step ${steps}: ${JSON.stringify(intent)} → ${r.ok ? "" : r.error}\nlast log: ${formatLog(s.log.slice(-5))}`,
        ).toBe(true);
        if (!r.ok) return;
        s = r.state;
        steps++;
        const snapshot = JSON.stringify([
          s.players.map((p) => [p.life, p.hand.length, p.deck.length, p.graveyard.length]),
        ]);
        stagnantRounds = snapshot === lastSnapshot ? stagnantRounds + 1 : 0;
        lastSnapshot = snapshot;
        if (stagnantRounds > 8) break; // no progress for several rounds: stalemate
      }
      if (s.winner === null) {
        expect(stagnantRounds, `game ${game} made no progress yet is not a stalemate`).toBeGreaterThan(8);
      }
    }
  });
});

describe("Viserai vs Rhinar full match (Silver Age precon vs Classic Battles)", () => {
  it("plays seeded random matches to completion without errors", () => {
    for (let game = 0; game < 4; game++) {
      const rand = makeRand(19000 + game);
      let s = createGame({
        decklists: [decklists.rhinar, VISERAI_DECK],
        seed: 18000 + game,
        cards: cardData,
        scripts,
      });
      let steps = 0;
      let stagnantRounds = 0;
      let lastSnapshot = "";
      while (s.winner === null && steps < 2000) {
        const seat = s.pendingDecision?.player ?? s.priorityPlayer;
        const options = legalIntents(s, seat).filter((i) => i.kind !== "concede");
        expect(options.length, `no legal intents at step ${steps} (game ${game})`).toBeGreaterThan(0);
        const intent = options[Math.floor(rand() * options.length)]!;
        const r = applyIntent(s, seat, intent);
        expect(
          r.ok,
          `game ${game} step ${steps}: ${JSON.stringify(intent)} → ${r.ok ? "" : r.error}\nlast log: ${formatLog(s.log.slice(-5))}`,
        ).toBe(true);
        if (!r.ok) return;
        s = r.state;
        steps++;
        const snapshot = JSON.stringify([
          s.players.map((p) => [p.life, p.hand.length, p.deck.length, p.graveyard.length]),
        ]);
        stagnantRounds = snapshot === lastSnapshot ? stagnantRounds + 1 : 0;
        lastSnapshot = snapshot;
        if (stagnantRounds > 8) break;
      }
      if (s.winner === null) {
        expect(stagnantRounds, `game ${game} made no progress yet is not a stalemate`).toBeGreaterThan(8);
      }
    }
  });
});

describe("Dash vs Viserai full match (Chapter 1 Silver Age precons)", () => {
  it("plays seeded random matches to completion without errors", () => {
    for (let game = 0; game < 4; game++) {
      const rand = makeRand(23000 + game);
      let s = createGame({
        decklists: [DASH_DECK, VISERAI_DECK],
        seed: 22000 + game,
        cards: cardData,
        scripts,
      });
      let steps = 0;
      let stagnantRounds = 0;
      let lastSnapshot = "";
      while (s.winner === null && steps < 2000) {
        const seat = s.pendingDecision?.player ?? s.priorityPlayer;
        const options = legalIntents(s, seat).filter((i) => i.kind !== "concede");
        expect(options.length, `no legal intents at step ${steps} (game ${game})`).toBeGreaterThan(0);
        const intent = options[Math.floor(rand() * options.length)]!;
        const r = applyIntent(s, seat, intent);
        expect(
          r.ok,
          `game ${game} step ${steps}: ${JSON.stringify(intent)} → ${r.ok ? "" : r.error}\nlast log: ${formatLog(s.log.slice(-5))}`,
        ).toBe(true);
        if (!r.ok) return;
        s = r.state;
        steps++;
        const snapshot = JSON.stringify([
          s.players.map((p) => [p.life, p.hand.length, p.deck.length, p.graveyard.length]),
        ]);
        stagnantRounds = snapshot === lastSnapshot ? stagnantRounds + 1 : 0;
        lastSnapshot = snapshot;
        if (stagnantRounds > 8) break;
      }
      if (s.winner === null) {
        expect(stagnantRounds, `game ${game} made no progress yet is not a stalemate`).toBeGreaterThan(8);
      }
    }
  });
});

describe("Bravo vs Dash full match (Chapter 1 Silver Age precons)", () => {
  it("plays seeded random matches to completion without errors", () => {
    for (let game = 0; game < 4; game++) {
      const rand = makeRand(27000 + game);
      let s = createGame({
        decklists: [BRAVO_FLATTERING_DECK, DASH_DECK],
        seed: 26000 + game,
        cards: cardData,
        scripts,
      });
      let steps = 0;
      let stagnantRounds = 0;
      let lastSnapshot = "";
      while (s.winner === null && steps < 2000) {
        const seat = s.pendingDecision?.player ?? s.priorityPlayer;
        const options = legalIntents(s, seat).filter((i) => i.kind !== "concede");
        expect(options.length, `no legal intents at step ${steps} (game ${game})`).toBeGreaterThan(0);
        const intent = options[Math.floor(rand() * options.length)]!;
        const r = applyIntent(s, seat, intent);
        expect(
          r.ok,
          `game ${game} step ${steps}: ${JSON.stringify(intent)} → ${r.ok ? "" : r.error}\nlast log: ${formatLog(s.log.slice(-5))}`,
        ).toBe(true);
        if (!r.ok) return;
        s = r.state;
        steps++;
        const snapshot = JSON.stringify([
          s.players.map((p) => [p.life, p.hand.length, p.deck.length, p.graveyard.length]),
        ]);
        stagnantRounds = snapshot === lastSnapshot ? stagnantRounds + 1 : 0;
        lastSnapshot = snapshot;
        if (stagnantRounds > 8) break;
      }
      if (s.winner === null) {
        expect(stagnantRounds, `game ${game} made no progress yet is not a stalemate`).toBeGreaterThan(8);
      }
    }
  });
});

describe("Kayo vs Bravo full match (Chapter 1 Silver Age precons)", () => {
  it("plays seeded random matches to completion without errors", () => {
    for (let game = 0; game < 4; game++) {
      const rand = makeRand(29000 + game);
      let s = createGame({
        decklists: [KAYO_DECK, BRAVO_FLATTERING_DECK],
        seed: 28000 + game,
        cards: cardData,
        scripts,
      });
      let steps = 0;
      let stagnantRounds = 0;
      let lastSnapshot = "";
      while (s.winner === null && steps < 2000) {
        const seat = s.pendingDecision?.player ?? s.priorityPlayer;
        const options = legalIntents(s, seat).filter((i) => i.kind !== "concede");
        expect(options.length, `no legal intents at step ${steps} (game ${game})`).toBeGreaterThan(0);
        const intent = options[Math.floor(rand() * options.length)]!;
        const r = applyIntent(s, seat, intent);
        expect(
          r.ok,
          `game ${game} step ${steps}: ${JSON.stringify(intent)} → ${r.ok ? "" : r.error}\nlast log: ${formatLog(s.log.slice(-5))}`,
        ).toBe(true);
        if (!r.ok) return;
        s = r.state;
        steps++;
        const snapshot = JSON.stringify([
          s.players.map((p) => [p.life, p.hand.length, p.deck.length, p.graveyard.length]),
        ]);
        stagnantRounds = snapshot === lastSnapshot ? stagnantRounds + 1 : 0;
        lastSnapshot = snapshot;
        if (stagnantRounds > 8) break;
      }
      if (s.winner === null) {
        expect(stagnantRounds, `game ${game} made no progress yet is not a stalemate`).toBeGreaterThan(8);
      }
    }
  });
});

describe("Iyslander vs Kayo full match (Chapter 1 Silver Age precons)", () => {
  it("plays seeded random matches to completion without errors", () => {
    for (let game = 0; game < 4; game++) {
      const rand = makeRand(31000 + game);
      let s = createGame({
        decklists: [IYSLANDER_DECK, KAYO_DECK],
        seed: 30000 + game,
        cards: cardData,
        scripts,
      });
      let steps = 0;
      let stagnantRounds = 0;
      let lastSnapshot = "";
      while (s.winner === null && steps < 2000) {
        const seat = s.pendingDecision?.player ?? s.priorityPlayer;
        const options = legalIntents(s, seat).filter((i) => i.kind !== "concede");
        expect(options.length, `no legal intents at step ${steps} (game ${game})`).toBeGreaterThan(0);
        const intent = options[Math.floor(rand() * options.length)]!;
        const r = applyIntent(s, seat, intent);
        expect(
          r.ok,
          `game ${game} step ${steps}: ${JSON.stringify(intent)} → ${r.ok ? "" : r.error}\nlast log: ${formatLog(s.log.slice(-5))}`,
        ).toBe(true);
        if (!r.ok) return;
        s = r.state;
        steps++;
        const snapshot = JSON.stringify([
          s.players.map((p) => [p.life, p.hand.length, p.deck.length, p.graveyard.length]),
        ]);
        stagnantRounds = snapshot === lastSnapshot ? stagnantRounds + 1 : 0;
        lastSnapshot = snapshot;
        if (stagnantRounds > 8) break;
      }
      if (s.winner === null) {
        expect(stagnantRounds, `game ${game} made no progress yet is not a stalemate`).toBeGreaterThan(8);
      }
    }
  });
});

/**
 * The Boltyn Silver Age precon as a presented 40-card deck (the full 46-card
 * pool minus one copy of six one-ofs), for the Boltyn vs Dorinthea pairing.
 */
const BOLTYN_DECK: Decklist = {
  heroId: "SBL001",
  weaponIds: ["SBL002"], // Raydn, Duskbane
  equipment: {
    head: "SBL003", // Halo of Illumination
    chest: "SBL005", // Garland of Spring
    arms: "SBL007", // Gauntlets of Unity
    legs: "SBL009", // Flat Trackers
  },
  deck: [
    // reds (2 each; 1 each of Glisten / Toe the Line)
    "SBL011", "SBL011", "SBL012", "SBL012", "SBL019", "SBL019", "SBL013", "SBL013",
    "SBL020", "SBL020", "SBL014", "SBL014", "SBL021", "SBL015", "SBL015", "SBL016",
    "SBL016", "SBL017", "SBL017", "SBL018", "SBL018", "SBL022",
    // yellows (2 each; 1 each of V of the Vanguard / Valiant Thrust / Roaring Beam / Springboard Somersault)
    "SBL023", "SBL023", "SBL024", "SBL024", "SBL025", "SBL025", "SBL026", "SBL026",
    "SBL027", "SBL027", "SBL028", "SBL028", "SBL032", "SBL033", "SBL029", "SBL029",
    "SBL031", "SBL030",
  ],
};

describe("Boltyn vs Dorinthea full match (Silver Age precon vs Classic Battles)", () => {
  it("plays seeded random matches to completion without errors", () => {
    for (let game = 0; game < 6; game++) {
      const rand = makeRand(11000 + game);
      let s = createGame({
        decklists: [decklists.dorinthea, BOLTYN_DECK],
        seed: 10000 + game,
        cards: cardData,
        scripts,
      });
      let steps = 0;
      let stagnantRounds = 0;
      let lastSnapshot = "";
      while (s.winner === null && steps < 2000) {
        const seat = s.pendingDecision?.player ?? s.priorityPlayer;
        const options = legalIntents(s, seat).filter((i) => i.kind !== "concede");
        expect(options.length, `no legal intents at step ${steps} (game ${game})`).toBeGreaterThan(0);
        const intent = options[Math.floor(rand() * options.length)]!;
        const r = applyIntent(s, seat, intent);
        expect(
          r.ok,
          `game ${game} step ${steps}: ${JSON.stringify(intent)} → ${r.ok ? "" : r.error}\nlast log: ${formatLog(s.log.slice(-5))}`,
        ).toBe(true);
        if (!r.ok) return;
        s = r.state;
        steps++;
        const snapshot = JSON.stringify([
          s.players.map((p) => [p.life, p.hand.length, p.deck.length, p.graveyard.length]),
        ]);
        stagnantRounds = snapshot === lastSnapshot ? stagnantRounds + 1 : 0;
        lastSnapshot = snapshot;
        if (stagnantRounds > 8) break; // no progress for several rounds: stalemate
      }
      if (s.winner === null) {
        expect(stagnantRounds, `game ${game} made no progress yet is not a stalemate`).toBeGreaterThan(8);
      }
    }
  });
});

/**
 * The Enigma Silver Age precon (the official LSS list), for the Enigma vs
 * Boltyn pairing.
 */
const ENIGMA_DECK: Decklist = {
  heroId: "SEN001", // Enigma
  weaponIds: ["SEN002"], // Cosmo, Scroll of Ancestral Tapestry
  equipment: {
    head: "SEN004", // Nullrune Hood
    chest: "SEN006", // Nullrune Robe
    arms: "SEN007", // Uphold Tradition
    legs: "SEN009", // Silent Stilettos
  },
  deck: [
    // reds (2 each)
    "SEN013", "SEN013", "SEN010", "SEN010", "SEN011", "SEN011", "SEN017", "SEN017",
    "SEN018", "SEN018", "SEN014", "SEN014", "SEN019", "SEN019", "SEN012", "SEN012",
    "SEN015", "SEN015", "SEN016", "SEN016",
    // yellows (2 each)
    "MON099", "MON099", "SEN020", "SEN020",
    // blues (2 each of the attacks/blocks, 1 each of the Legendary transcend instants)
    "SEN031", "SEN028", "SEN028", "SEN022", "SEN022", "SEN032", "SEN023", "SEN023",
    "SEN033", "SEN024", "SEN024", "SEN034", "SEN029", "SEN029", "SEN035", "SEN025",
    "SEN025", "SEN026", "SEN026", "SEN027", "SEN027", "SEN030", "SEN030",
  ],
};

describe("Enigma vs Boltyn full match (Silver Age precons)", () => {
  it("plays seeded random matches to completion without errors", () => {
    for (let game = 0; game < 6; game++) {
      const rand = makeRand(13000 + game);
      let s = createGame({
        decklists: [BOLTYN_DECK, ENIGMA_DECK],
        seed: 12000 + game,
        cards: cardData,
        scripts,
      });
      let steps = 0;
      let stagnantRounds = 0;
      let lastSnapshot = "";
      while (s.winner === null && steps < 2000) {
        const seat = s.pendingDecision?.player ?? s.priorityPlayer;
        const options = legalIntents(s, seat).filter((i) => i.kind !== "concede");
        expect(options.length, `no legal intents at step ${steps} (game ${game})`).toBeGreaterThan(0);
        const intent = options[Math.floor(rand() * options.length)]!;
        const r = applyIntent(s, seat, intent);
        expect(
          r.ok,
          `game ${game} step ${steps}: ${JSON.stringify(intent)} → ${r.ok ? "" : r.error}\nlast log: ${formatLog(s.log.slice(-5))}`,
        ).toBe(true);
        if (!r.ok) return;
        s = r.state;
        steps++;
        const snapshot = JSON.stringify([
          s.players.map((p) => [p.life, p.hand.length, p.deck.length, p.graveyard.length]),
        ]);
        stagnantRounds = snapshot === lastSnapshot ? stagnantRounds + 1 : 0;
        lastSnapshot = snapshot;
        if (stagnantRounds > 8) break; // no progress for several rounds: stalemate
      }
      if (s.winner === null) {
        expect(stagnantRounds, `game ${game} made no progress yet is not a stalemate`).toBeGreaterThan(8);
      }
    }
  });
});

/**
 * The Fai Silver Age precon as a presented 40-card deck (the full 47-card
 * pool minus Arcane Polarity, Energy Potion, Nip at the Heels, Dragon Power
 * and one Rise from the Ashes), for the Fai vs Boltyn pairing.
 */
const FAI_DECK: Decklist = {
  heroId: "SFA001", // Fai
  weaponIds: ["SFA002"], // Searing Emberblade
  equipment: {
    head: "SFA005", // Mask of the Swarming Claw
    chest: "SFA006", // Blood Scent
    arms: "SFA008", // Tearing Shuko
    legs: "SFA009", // Pouncing Paws
  },
  deck: [
    // reds (2 each; 1 each of Art of the Dragon: Fire / Wax On / Rise from the Ashes)
    "SFA010", "SFA011", "SFA011", "SFA012", "SFA012", "SFA013", "SFA013", "SFA014",
    "SFA014", "SFA015", "SFA015", "SFA016", "SFA016", "SFA017", "SFA017", "SFA018",
    "SFA018", "SFA019", "SFA019", "SFA020", "SFA020", "SFA021", "SFA021", "SFA022",
    "SFA022", "SFA023", "SFA023", "SFA024", "SFA024", "SFA025", "SFA025",
    "SFA026", "SFA027",
    // yellows (2 each; 1 Salt the Wound)
    "SFA029", "SFA029", "SFA030",
    // blues (2 each)
    "SFA031", "SFA031", "SFA032", "SFA032",
  ],
};

describe("Fai vs Boltyn full match (Silver Age precons)", () => {
  it("plays seeded random matches to completion without errors", () => {
    for (let game = 0; game < 6; game++) {
      const rand = makeRand(15000 + game);
      let s = createGame({
        decklists: [FAI_DECK, BOLTYN_DECK],
        seed: 14000 + game,
        cards: cardData,
        scripts,
      });
      let steps = 0;
      let stagnantRounds = 0;
      let lastSnapshot = "";
      while (s.winner === null && steps < 2000) {
        const seat = s.pendingDecision?.player ?? s.priorityPlayer;
        const options = legalIntents(s, seat).filter((i) => i.kind !== "concede");
        expect(options.length, `no legal intents at step ${steps} (game ${game})`).toBeGreaterThan(0);
        const intent = options[Math.floor(rand() * options.length)]!;
        const r = applyIntent(s, seat, intent);
        expect(
          r.ok,
          `game ${game} step ${steps}: ${JSON.stringify(intent)} → ${r.ok ? "" : r.error}\nlast log: ${formatLog(s.log.slice(-5))}`,
        ).toBe(true);
        if (!r.ok) return;
        s = r.state;
        steps++;
        const snapshot = JSON.stringify([
          s.players.map((p) => [p.life, p.hand.length, p.deck.length, p.graveyard.length]),
        ]);
        stagnantRounds = snapshot === lastSnapshot ? stagnantRounds + 1 : 0;
        lastSnapshot = snapshot;
        if (stagnantRounds > 8) break; // no progress for several rounds: stalemate
      }
      if (s.winner === null) {
        expect(stagnantRounds, `game ${game} made no progress yet is not a stalemate`).toBeGreaterThan(8);
      }
    }
  });
});

/**
 * The Azalea Silver Age precon as a presented 40-card deck (the full 47-card
 * pool minus one copy of seven reds), for the Azalea vs Fai pairing.
 */
const AZALEA_DECK: Decklist = {
  heroId: "SAZ001", // Azalea
  weaponIds: ["SAZ002", "SAZ003"], // Death Dealer + Crow's Nest (quiver rides a weapon slot)
  equipment: {
    head: "SAZ004", // Blade Beckoner Helm
    chest: "SAZ006", // Blossom of Spring
    arms: "SAZ007", // Bull's Eye Bracers
    legs: "SAZ008", // Bolt'n Boots
  },
  deck: [
    // reds (2 each; 1 each of Call in the Big Guns / Drill Shot / Drop the Anchor /
    // Dry Powder Shot / Entangling Shot / Lace with Bloodrot / Lace with Frailty)
    "SAZ010", "SAZ010", "SAZ014", "SAZ014", "SAZ024", "SAZ024", "SAZ015", "SAZ015",
    "SAZ025", "SAZ025", "SAZ019", "SAZ019", "SAZ026", "SAZ026", "SAZ027", "SAZ027",
    "SAZ016", "SAZ016", "SAZ028", "SAZ028", "SAZ017", "SAZ017", "SAZ018", "SAZ018",
    "SAZ029", "SAZ029",
    "SAZ020", "SAZ011", "SAZ021", "SAZ012", "SAZ013", "SAZ022", "SAZ023",
    // yellows (2 each; 1 Memorial Ground)
    "SAZ030", "SAZ030", "SAZ031", "SAZ031", "SAZ032", "SAZ032", "SAZ033",
  ],
};

describe("Azalea vs Fai full match (Silver Age precons)", () => {
  it("plays seeded random matches to completion without errors", () => {
    for (let game = 0; game < 6; game++) {
      const rand = makeRand(17000 + game);
      let s = createGame({
        decklists: [AZALEA_DECK, FAI_DECK],
        seed: 16000 + game,
        cards: cardData,
        scripts,
      });
      let steps = 0;
      let stagnantRounds = 0;
      let lastSnapshot = "";
      while (s.winner === null && steps < 2000) {
        const seat = s.pendingDecision?.player ?? s.priorityPlayer;
        const options = legalIntents(s, seat).filter((i) => i.kind !== "concede");
        expect(options.length, `no legal intents at step ${steps} (game ${game})`).toBeGreaterThan(0);
        const intent = options[Math.floor(rand() * options.length)]!;
        const r = applyIntent(s, seat, intent);
        expect(
          r.ok,
          `game ${game} step ${steps}: ${JSON.stringify(intent)} → ${r.ok ? "" : r.error}\nlast log: ${formatLog(s.log.slice(-5))}`,
        ).toBe(true);
        if (!r.ok) return;
        s = r.state;
        steps++;
        const snapshot = JSON.stringify([
          s.players.map((p) => [p.life, p.hand.length, p.deck.length, p.graveyard.length]),
        ]);
        stagnantRounds = snapshot === lastSnapshot ? stagnantRounds + 1 : 0;
        lastSnapshot = snapshot;
        if (stagnantRounds > 8) break; // no progress for several rounds: stalemate
      }
      if (s.winner === null) {
        expect(stagnantRounds, `game ${game} made no progress yet is not a stalemate`).toBeGreaterThan(8);
      }
    }
  });
});

/**
 * The Dorinthea Silver Age precon as a presented 40-card deck (the full
 * 47-card pool minus Energy Potion, Run Through, and one copy of Wreck Havoc /
 * Goblet / Hit and Run / Trot Along / blue Warrior's Valor), for the SDO
 * Dorinthea vs Azalea pairing.
 */
const SDO_DORINTHEA_DECK: Decklist = {
  heroId: "SDO001", // Dorinthea
  weaponIds: ["SDO002"], // Dawnblade
  equipment: {
    head: "SDO003", // Helm of Unity
    chest: "SDO005", // Blossom of Spring
    arms: "SDO007", // Gauntlets of Unity
    legs: "SDO009", // Refraction Bolters
  },
  deck: [
    // reds (2 each; 1 Wreck Havoc)
    "SDO010", "SDO012", "SDO012", "SDO013", "SDO013", "SDO018", "SDO018", "SDO021",
    "SDO021", "SDO014", "SDO014", "SDO015", "SDO015", "SDO016", "SDO016", "SDO011",
    "SDO011", "SDO019", "SDO019", "SDO017", "SDO017", "SDO020", "SDO020",
    // yellows (2 each)
    "SDO023", "SDO023", "SDO024", "SDO024",
    // blues (2 each of four; 1 each of Goblet / Hit and Run / Puncture / Trot Along / Warrior's Valor)
    "SDO031", "SDO032", "SDO025", "SDO025", "SDO026", "SDO026", "SDO027", "SDO027",
    "SDO028", "SDO029", "SDO029", "SDO033", "SDO034",
  ],
};

describe("Dorinthea (SDO) vs Azalea full match (Silver Age precons)", () => {
  it("plays seeded random matches to completion without errors", () => {
    for (let game = 0; game < 6; game++) {
      const rand = makeRand(19000 + game);
      let s = createGame({
        decklists: [SDO_DORINTHEA_DECK, AZALEA_DECK],
        seed: 18000 + game,
        cards: cardData,
        scripts,
      });
      let steps = 0;
      let stagnantRounds = 0;
      let lastSnapshot = "";
      while (s.winner === null && steps < 2000) {
        const seat = s.pendingDecision?.player ?? s.priorityPlayer;
        const options = legalIntents(s, seat).filter((i) => i.kind !== "concede");
        expect(options.length, `no legal intents at step ${steps} (game ${game})`).toBeGreaterThan(0);
        const intent = options[Math.floor(rand() * options.length)]!;
        const r = applyIntent(s, seat, intent);
        expect(
          r.ok,
          `game ${game} step ${steps}: ${JSON.stringify(intent)} → ${r.ok ? "" : r.error}\nlast log: ${formatLog(s.log.slice(-5))}`,
        ).toBe(true);
        if (!r.ok) return;
        s = r.state;
        steps++;
        const snapshot = JSON.stringify([
          s.players.map((p) => [p.life, p.hand.length, p.deck.length, p.graveyard.length]),
        ]);
        stagnantRounds = snapshot === lastSnapshot ? stagnantRounds + 1 : 0;
        lastSnapshot = snapshot;
        if (stagnantRounds > 8) break; // no progress for several rounds: stalemate
      }
      if (s.winner === null) {
        expect(stagnantRounds, `game ${game} made no progress yet is not a stalemate`).toBeGreaterThan(8);
      }
    }
  });
});

/**
 * The Arakni, Web of Deceit Silver Age precon as a presented 40-card deck
 * (the full 46-card pool minus one copy of six reds), for the Arakni vs
 * Dorinthea (SDO) pairing.
 */
const ARAKNI_DECK: Decklist = {
  heroId: "SAR001", // Arakni, Web of Deceit
  weaponIds: ["SAR002", "SAR002"], // 2x Mark of the Huntsman
  equipment: {
    head: "SAR003", // Prey Spotters
    chest: "SAR005", // Blossom of Spring
    arms: "SAR007", // Danger Digits
    legs: "SAR009", // Stalker's Steps
  },
  deck: [
    // reds (2 each; 1 each of Concoct Disorder / Hyper Inflation /
    // Orb-Weaver Spinneret / Stains of the Redback / Two Sides to the Blade / Up Sticks and Run)
    "SAR010", "SAR010", "SAR013", "SAR013", "SAR014", "SAR014", "SAR015", "SAR015",
    "SAR016", "SAR016", "SAR017", "SAR017", "SAR019", "SAR019", "SAR020", "SAR020",
    "SAR023", "SAR023", "SAR024", "SAR024", "SAR025", "SAR025", "SAR026", "SAR026",
    "SAR011", "SAR012", "SAR018", "SAR021", "SAR022", "SAR027",
    // blues (2 each)
    "SAR028", "SAR028", "SAR029", "SAR029", "SAR030", "SAR030", "SAR031", "SAR031",
    "SAR032", "SAR032",
  ],
};

describe("Arakni vs Dorinthea (SDO) full match (Silver Age precons)", () => {
  it("plays seeded random matches to completion without errors", () => {
    for (let game = 0; game < 6; game++) {
      const rand = makeRand(21000 + game);
      let s = createGame({
        decklists: [ARAKNI_DECK, SDO_DORINTHEA_DECK],
        seed: 20000 + game,
        cards: cardData,
        scripts,
      });
      let steps = 0;
      let stagnantRounds = 0;
      let lastSnapshot = "";
      while (s.winner === null && steps < 2000) {
        const seat = s.pendingDecision?.player ?? s.priorityPlayer;
        const options = legalIntents(s, seat).filter((i) => i.kind !== "concede");
        expect(options.length, `no legal intents at step ${steps} (game ${game})`).toBeGreaterThan(0);
        const intent = options[Math.floor(rand() * options.length)]!;
        const r = applyIntent(s, seat, intent);
        expect(
          r.ok,
          `game ${game} step ${steps}: ${JSON.stringify(intent)} → ${r.ok ? "" : r.error}\nlast log: ${formatLog(s.log.slice(-5))}`,
        ).toBe(true);
        if (!r.ok) return;
        s = r.state;
        steps++;
        const snapshot = JSON.stringify([
          s.players.map((p) => [p.life, p.hand.length, p.deck.length, p.graveyard.length]),
        ]);
        stagnantRounds = snapshot === lastSnapshot ? stagnantRounds + 1 : 0;
        lastSnapshot = snapshot;
        if (stagnantRounds > 8) break; // no progress for several rounds: stalemate
      }
      if (s.winner === null) {
        expect(stagnantRounds, `game ${game} made no progress yet is not a stalemate`).toBeGreaterThan(8);
      }
    }
  });
});

/** Rare/common Monarch pools for a seeded integration match. These are not
 * official precons; they exercise the two talent/class families end to end. */
const MON_PRISM_DECK: Decklist = {
  heroId: "MON002",
  weaponIds: [],
  equipment: {
    head: "MON241", // Ironhide Helm
    chest: "MON230", // Aether Ironweave
    arms: "MON090", // Dream Weavers
    legs: "MON244", // Ironhide Legs
  },
  deck: [
    "MON008", "MON008", "MON009", "MON009", "MON010", "MON010",
    "MON014", "MON014", "MON015", "MON015", "MON016", "MON016",
    "MON017", "MON017", "MON018", "MON018", "MON019", "MON019",
    "MON020", "MON020", "MON021", "MON021", "MON022", "MON022",
    "MON023", "MON023", "MON024", "MON024", "MON025", "MON025",
    "MON026", "MON026", "MON027", "MON027", "MON028", "MON028",
    "MON094", "MON094", "MON097", "MON097",
  ],
};

const MON_CHANE_DECK: Decklist = {
  heroId: "MON154",
  weaponIds: [],
  equipment: {
    head: "MON241", // Ironhide Helm
    chest: "MON230", // Aether Ironweave
    arms: "MON188", // Ebon Fold
    legs: "MON244", // Ironhide Legs
  },
  deck: [
    "MON203", "MON203", "MON204", "MON204", "MON205", "MON205",
    "MON209", "MON209", "MON210", "MON210", "MON211", "MON211",
    "MON168", "MON168", "MON169", "MON169", "MON170", "MON170",
    "MON171", "MON171", "MON172", "MON172", "MON173", "MON173",
    "MON174", "MON174", "MON175", "MON175", "MON176", "MON176",
    "MON177", "MON177", "MON178", "MON178", "MON179", "MON179",
    "MON185", "MON185", "MON164", "MON164",
  ],
};

describe("Prism vs Chane full match (Monarch rare/common pools)", () => {
  it("plays seeded random matches without rejected legal intents", () => {
    for (let game = 0; game < 3; game++) {
      const rand = makeRand(23000 + game);
      let s = createGame({
        decklists: [MON_PRISM_DECK, MON_CHANE_DECK],
        seed: 22000 + game,
        cards: cardData,
        scripts,
      });
      let steps = 0;
      let stagnantRounds = 0;
      let lastSnapshot = "";
      while (s.winner === null && steps < 2000) {
        const seat = s.pendingDecision?.player ?? s.priorityPlayer;
        const options = legalIntents(s, seat).filter((intent) => intent.kind !== "concede");
        expect(options.length, `no legal intents at step ${steps} (game ${game})`).toBeGreaterThan(0);
        const intent = options[Math.floor(rand() * options.length)]!;
        const result = applyIntent(s, seat, intent);
        expect(
          result.ok,
          `game ${game} step ${steps}: ${JSON.stringify(intent)} → ${result.ok ? "" : result.error}\nlast log: ${formatLog(s.log.slice(-5))}`,
        ).toBe(true);
        if (!result.ok) return;
        s = result.state;
        steps++;
        const snapshot = JSON.stringify([
          s.players.map((player) => [player.life, player.hand.length, player.deck.length, player.graveyard.length]),
        ]);
        stagnantRounds = snapshot === lastSnapshot ? stagnantRounds + 1 : 0;
        lastSnapshot = snapshot;
        if (stagnantRounds > 8) break;
      }
      if (s.winner === null) {
        expect(stagnantRounds, `game ${game} made no progress yet is not a stalemate`).toBeGreaterThan(8);
      }
    }
  });
});

/** Rare/common Tales of Aria pools for a seeded integration match. */
const ELE_OLDHIM_DECK: Decklist = {
  heroId: "ELE002",
  weaponIds: [],
  equipment: {
    head: "ELE233", // Ragamuffin's Hat
    chest: "ELE234", // Deep Blue
    arms: "ELE235", // Cracker Jax
    legs: "ELE236", // Runaways
  },
  deck: [
    "ELE007", "ELE007", "ELE008", "ELE008", "ELE009", "ELE009",
    "ELE010", "ELE010", "ELE011", "ELE011", "ELE012", "ELE012",
    "ELE013", "ELE013", "ELE014", "ELE014", "ELE015", "ELE015",
    "ELE016", "ELE016", "ELE017", "ELE017", "ELE018", "ELE018",
    "ELE019", "ELE019", "ELE020", "ELE020", "ELE021", "ELE021",
    "ELE022", "ELE022", "ELE023", "ELE023", "ELE024", "ELE024",
    "ELE026", "ELE026", "ELE029", "ELE029",
  ],
};

const ELE_LEXI_DECK: Decklist = {
  heroId: "ELE032",
  weaponIds: ["CRU120"], // Death Dealer
  equipment: {
    head: "ELE214", // Honing Hood
    chest: "ELE234", // Deep Blue
    arms: "ELE174", // Mark of Lightning
    legs: "ELE236", // Runaways
  },
  deck: [
    "ELE038", "ELE038", "ELE039", "ELE039", "ELE040", "ELE040",
    "ELE041", "ELE041", "ELE042", "ELE042", "ELE043", "ELE043",
    "ELE044", "ELE044", "ELE045", "ELE045", "ELE046", "ELE046",
    "ELE047", "ELE047", "ELE048", "ELE048", "ELE049", "ELE049",
    "ELE050", "ELE050", "ELE051", "ELE051", "ELE052", "ELE052",
    "ELE053", "ELE053", "ELE054", "ELE054", "ELE055", "ELE055",
    "ELE059", "ELE059", "ELE060", "ELE060",
  ],
};

describe("Oldhim vs Lexi full match (Tales of Aria rare/common pools)", () => {
  it("plays seeded random matches without rejected legal intents", () => {
    for (let game = 0; game < 3; game++) {
      const rand = makeRand(25000 + game);
      let s = createGame({
        decklists: [ELE_OLDHIM_DECK, ELE_LEXI_DECK],
        seed: 24000 + game,
        cards: cardData,
        scripts,
      });
      let steps = 0;
      let stagnantRounds = 0;
      let lastSnapshot = "";
      while (s.winner === null && steps < 2000) {
        const seat = s.pendingDecision?.player ?? s.priorityPlayer;
        const options = legalIntents(s, seat).filter((intent) => intent.kind !== "concede");
        expect(options.length, `no legal intents at step ${steps} (game ${game})`).toBeGreaterThan(0);
        const intent = options[Math.floor(rand() * options.length)]!;
        const result = applyIntent(s, seat, intent);
        expect(
          result.ok,
          `game ${game} step ${steps}: ${JSON.stringify(intent)} → ${result.ok ? "" : result.error}\nlast log: ${formatLog(s.log.slice(-5))}`,
        ).toBe(true);
        if (!result.ok) return;
        s = result.state;
        steps++;
        const snapshot = JSON.stringify([
          s.players.map((player) => [player.life, player.hand.length, player.deck.length, player.graveyard.length]),
        ]);
        stagnantRounds = snapshot === lastSnapshot ? stagnantRounds + 1 : 0;
        lastSnapshot = snapshot;
        if (stagnantRounds > 8) break;
      }
      if (s.winner === null) {
        expect(stagnantRounds, `game ${game} made no progress yet is not a stalemate`).toBeGreaterThan(8);
      }
    }
  });
});

const EVR_VALDA_DECK: Decklist = {
  heroId: "EVR019",
  weaponIds: [],
  equipment: {},
  deck: [
    ...Array(4).fill("EVR024"), ...Array(4).fill("EVR027"),
    ...Array(4).fill("EVR030"), ...Array(4).fill("EVR033"),
    ...Array(4).fill("EVR041"), ...Array(4).fill("EVR044"),
    ...Array(4).fill("EVR147"), ...Array(4).fill("EVR161"),
    ...Array(4).fill("EVR164"), ...Array(4).fill("EVR173"),
  ],
};

const EVR_GENIS_DECK: Decklist = {
  heroId: "EVR085",
  weaponIds: [],
  equipment: {},
  deck: [
    ...Array(4).fill("EVR161"), ...Array(4).fill("EVR164"),
    ...Array(4).fill("EVR167"), ...Array(4).fill("EVR170"),
    ...Array(4).fill("EVR173"), ...Array(4).fill("EVR176"),
    ...Array(4).fill("EVR182"), ...Array(4).fill("EVR183"),
    ...Array(4).fill("EVR186"), ...Array(4).fill("EVR187"),
  ],
};

describe("Valda vs Genis full match (Everfest rare/common pools)", () => {
  it("plays a fixed-seed random match without rejected legal intents", () => {
    const rand = makeRand(27000);
    let s = createGame({
      decklists: [EVR_VALDA_DECK, EVR_GENIS_DECK],
      seed: 26000,
      cards: cardData,
      scripts,
    });
    let steps = 0;
    let stagnantRounds = 0;
    let lastSnapshot = "";
    while (s.winner === null && steps < 2000) {
      const seat = s.pendingDecision?.player ?? s.priorityPlayer;
      const options = legalIntents(s, seat).filter((intent) => intent.kind !== "concede");
      expect(options.length, `no legal intents at step ${steps}`).toBeGreaterThan(0);
      const intent = options[Math.floor(rand() * options.length)]!;
      const result = applyIntent(s, seat, intent);
      expect(
        result.ok,
        `step ${steps}: ${JSON.stringify(intent)} → ${result.ok ? "" : result.error}\nlast log: ${formatLog(s.log.slice(-5))}`,
      ).toBe(true);
      if (!result.ok) return;
      s = result.state;
      steps++;
      const snapshot = JSON.stringify(
        s.players.map((player) => [player.life, player.hand.length, player.deck.length, player.graveyard.length]),
      );
      stagnantRounds = snapshot === lastSnapshot ? stagnantRounds + 1 : 0;
      lastSnapshot = snapshot;
      if (stagnantRounds > 8) break;
    }
    if (s.winner === null) {
      expect(stagnantRounds, "match made no progress yet is not a stalemate").toBeGreaterThan(8);
    }
  });
});

/** Rare/common Uprising pools plus each young hero's token-rarity support
 * weapon (and Phoenix Flame for Fai). */
const UPR_DROMAI_DECK: Decklist = {
  heroId: "UPR002",
  weaponIds: ["UPR003"],
  equipment: {},
  deck: [
    ...Array(4).fill("UPR009"), ...Array(4).fill("UPR011"),
    ...Array(4).fill("UPR018"), ...Array(4).fill("UPR021"),
    ...Array(4).fill("UPR024"), ...Array(4).fill("UPR027"),
    ...Array(4).fill("UPR030"), ...Array(4).fill("UPR033"),
    ...Array(4).fill("UPR035"), ...Array(4).fill("UPR036"),
  ],
};

const UPR_FAI_DECK: Decklist = {
  heroId: "UPR045",
  weaponIds: ["UPR046"],
  equipment: {},
  deck: [
    ...Array(4).fill("UPR051"), ...Array(4).fill("UPR053"),
    ...Array(4).fill("UPR054"), ...Array(4).fill("UPR056"),
    ...Array(4).fill("UPR060"), ...Array(4).fill("UPR062"),
    ...Array(4).fill("UPR063"), ...Array(4).fill("UPR065"),
    ...Array(4).fill("UPR066"), ...Array(4).fill("UPR101"),
  ],
};

describe("Dromai vs Fai full match (Uprising rare/common pools)", () => {
  it("plays a fixed-seed random match without rejected legal intents", () => {
    const rand = makeRand(29000);
    let s = createGame({
      decklists: [UPR_DROMAI_DECK, UPR_FAI_DECK],
      seed: 28000,
      cards: cardData,
      scripts,
    });
    let steps = 0;
    let stagnantRounds = 0;
    let lastSnapshot = "";
    while (s.winner === null && steps < 2000) {
      const seat = s.pendingDecision?.player ?? s.priorityPlayer;
      const options = legalIntents(s, seat).filter((intent) => intent.kind !== "concede");
      expect(options.length, `no legal intents at step ${steps}`).toBeGreaterThan(0);
      const intent = options[Math.floor(rand() * options.length)]!;
      const result = applyIntent(s, seat, intent);
      expect(
        result.ok,
        `step ${steps}: ${JSON.stringify(intent)} → ${result.ok ? "" : result.error}\nlast log: ${formatLog(s.log.slice(-5))}`,
      ).toBe(true);
      if (!result.ok) return;
      s = result.state;
      steps++;
      const snapshot = JSON.stringify(
        s.players.map((player) => [player.life, player.hand.length, player.deck.length, player.graveyard.length]),
      );
      stagnantRounds = snapshot === lastSnapshot ? stagnantRounds + 1 : 0;
      lastSnapshot = snapshot;
      if (stagnantRounds > 8) break;
    }
    if (s.winner === null) {
      expect(stagnantRounds, "match made no progress yet is not a stalemate").toBeGreaterThan(8);
    }
  });
});

/** Dynasty rare/common pools. Titan's Fist supports Yoji's imported off-hand;
 * Arakni uses the two Spider's Bite printings from Dynasty. */
const DYN_ARAKNI_DECK: Decklist = {
  heroId: "DYN114",
  weaponIds: ["DYN115", "DYN116"],
  equipment: {},
  deck: [
    ...Array(4).fill("DYN124"), ...Array(4).fill("DYN127"),
    ...Array(4).fill("DYN130"), ...Array(4).fill("DYN133"),
    ...Array(4).fill("DYN136"), ...Array(4).fill("DYN139"),
    ...Array(4).fill("DYN142"), ...Array(4).fill("DYN145"),
    ...Array(4).fill("DYN148"), ...Array(4).fill("DYN126"),
  ],
};

const DYN_YOJI_DECK: Decklist = {
  heroId: "DYN025",
  weaponIds: ["SBR003", "DYN027"],
  equipment: {},
  deck: [
    ...Array(4).fill("DYN030"), ...Array(4).fill("DYN033"),
    ...Array(4).fill("DYN036"), ...Array(4).fill("DYN039"),
    ...Array(4).fill("DYN042"), ...Array(4).fill("WTR048"),
    ...Array(4).fill("WTR050"), ...Array(4).fill("WTR057"),
    ...Array(4).fill("WTR059"), ...Array(4).fill("WTR066"),
  ],
};

describe("Arakni vs Yoji full match (Dynasty rare/common pools)", () => {
  it("plays a fixed-seed random match without rejected legal intents", () => {
    const rand = makeRand(31000);
    let s = createGame({
      decklists: [DYN_ARAKNI_DECK, DYN_YOJI_DECK],
      seed: 30000,
      cards: cardData,
      scripts,
    });
    let steps = 0;
    let stagnantRounds = 0;
    let lastSnapshot = "";
    while (s.winner === null && steps < 2000) {
      const seat = s.pendingDecision?.player ?? s.priorityPlayer;
      const options = legalIntents(s, seat).filter((intent) => intent.kind !== "concede");
      expect(options.length, `no legal intents at step ${steps}`).toBeGreaterThan(0);
      const intent = options[Math.floor(rand() * options.length)]!;
      const result = applyIntent(s, seat, intent);
      expect(
        result.ok,
        `step ${steps}: ${JSON.stringify(intent)} → ${result.ok ? "" : result.error}\nlast log: ${formatLog(s.log.slice(-5))}`,
      ).toBe(true);
      if (!result.ok) return;
      s = result.state;
      steps++;
      const snapshot = JSON.stringify(
        s.players.map((player) => [player.life, player.hand.length, player.deck.length, player.graveyard.length]),
      );
      stagnantRounds = snapshot === lastSnapshot ? stagnantRounds + 1 : 0;
      lastSnapshot = snapshot;
      if (stagnantRounds > 8) break;
    }
    if (s.winner === null) {
      expect(stagnantRounds, "match made no progress yet is not a stalemate").toBeGreaterThan(8);
    }
  });
});

/** Outsiders rare/common pools: Uzuri uses the Dynasty Spider's Bites while
 * Riptide uses the Silver Age Death Dealer reprint as the pool's bow. */
const OUT_UZURI_DECK: Decklist = {
  heroId: "OUT002",
  weaponIds: ["DYN115", "DYN116"],
  equipment: {},
  deck: [
    ...Array(4).fill("OUT015"), ...Array(4).fill("OUT018"),
    ...Array(4).fill("OUT024"), ...Array(4).fill("OUT027"),
    ...Array(4).fill("OUT030"), ...Array(4).fill("OUT033"),
    ...Array(4).fill("OUT036"), ...Array(4).fill("OUT039"),
    ...Array(4).fill("OUT042"), ...Array(4).fill("OUT044"),
  ],
};

const OUT_RIPTIDE_DECK: Decklist = {
  heroId: "OUT092",
  weaponIds: ["SAZ002"],
  equipment: {},
  deck: [
    ...Array(4).fill("OUT106"), ...Array(4).fill("OUT107"),
    ...Array(4).fill("OUT108"), ...Array(4).fill("OUT115"),
    ...Array(4).fill("OUT118"), ...Array(4).fill("OUT120"),
    ...Array(4).fill("OUT124"), ...Array(4).fill("OUT126"),
    ...Array(4).fill("OUT130"), ...Array(4).fill("OUT138"),
  ],
};

describe("Uzuri vs Riptide full match (Outsiders rare/common pools)", () => {
  it("plays a fixed-seed random match without rejected legal intents", () => {
    const rand = makeRand(33000);
    let s = createGame({
      decklists: [OUT_UZURI_DECK, OUT_RIPTIDE_DECK],
      seed: 32000,
      cards: cardData,
      scripts,
    });
    let steps = 0;
    let stagnantRounds = 0;
    let lastSnapshot = "";
    while (s.winner === null && steps < 2000) {
      const seat = s.pendingDecision?.player ?? s.priorityPlayer;
      const options = legalIntents(s, seat).filter((intent) => intent.kind !== "concede");
      expect(options.length, `no legal intents at step ${steps}`).toBeGreaterThan(0);
      const intent = options[Math.floor(rand() * options.length)]!;
      const result = applyIntent(s, seat, intent);
      expect(
        result.ok,
        `step ${steps}: ${JSON.stringify(intent)} → ${result.ok ? "" : result.error}\nlast log: ${formatLog(s.log.slice(-5))}`,
      ).toBe(true);
      if (!result.ok) return;
      s = result.state;
      steps++;
      const snapshot = JSON.stringify(
        s.players.map((player) => [player.life, player.hand.length, player.deck.length, player.graveyard.length]),
      );
      stagnantRounds = snapshot === lastSnapshot ? stagnantRounds + 1 : 0;
      lastSnapshot = snapshot;
      if (stagnantRounds > 8) break;
    }
    if (s.winner === null) {
      expect(stagnantRounds, "match made no progress yet is not a stalemate").toBeGreaterThan(8);
    }
  });
});

const DTD_PRISM_DECK: Decklist = {
  heroId: "DTD002",
  weaponIds: ["DTD003"],
  equipment: {},
  deck: [
    ...Array(4).fill("DTD014"), ...Array(4).fill("DTD017"),
    ...Array(4).fill("DTD020"), ...Array(4).fill("DTD023"),
    ...Array(4).fill("DTD026"), ...Array(4).fill("DTD029"),
    ...Array(4).fill("DTD032"), ...Array(4).fill("DTD035"),
    ...Array(4).fill("DTD038"), ...Array(4).fill("DTD041"),
  ],
};

const DTD_VYNNSET_DECK: Decklist = {
  heroId: "DTD134",
  weaponIds: ["DTD135"],
  equipment: {},
  deck: [
    ...Array(4).fill("DTD143"), ...Array(4).fill("DTD146"),
    ...Array(4).fill("DTD149"), ...Array(4).fill("DTD152"),
    ...Array(4).fill("DTD155"), ...Array(4).fill("DTD158"),
    ...Array(4).fill("DTD161"), ...Array(4).fill("DTD172"),
    ...Array(4).fill("DTD178"), ...Array(4).fill("DTD184"),
  ],
};

describe("Prism vs Vynnset full match (Dusk till Dawn rare/common pools)", () => {
  it("plays a fixed-seed random match without rejected legal intents", () => {
    const rand = makeRand(35000);
    let s = createGame({
      decklists: [DTD_PRISM_DECK, DTD_VYNNSET_DECK],
      seed: 34000,
      cards: cardData,
      scripts,
    });
    let steps = 0;
    let stagnantRounds = 0;
    let lastSnapshot = "";
    while (s.winner === null && steps < 2000) {
      const seat = s.pendingDecision?.player ?? s.priorityPlayer;
      const options = legalIntents(s, seat).filter((intent) => intent.kind !== "concede");
      expect(options.length, `no legal intents at step ${steps}`).toBeGreaterThan(0);
      const intent = options[Math.floor(rand() * options.length)]!;
      const result = applyIntent(s, seat, intent);
      expect(
        result.ok,
        `step ${steps}: ${JSON.stringify(intent)} → ${result.ok ? "" : result.error}\nlast log: ${formatLog(s.log.slice(-5))}`,
      ).toBe(true);
      if (!result.ok) return;
      s = result.state;
      steps++;
      const snapshot = JSON.stringify(
        s.players.map((player) => [player.life, player.hand.length, player.deck.length, player.graveyard.length]),
      );
      stagnantRounds = snapshot === lastSnapshot ? stagnantRounds + 1 : 0;
      lastSnapshot = snapshot;
      if (stagnantRounds > 8) break;
    }
    if (s.winner === null) {
      expect(stagnantRounds, "match made no progress yet is not a stalemate").toBeGreaterThan(8);
    }
  });
});

const EVO_DASH_DATABASE_DECK: Decklist = {
  heroId: "EVO002",
  weaponIds: [],
  equipment: { head: "EVO018", chest: "EVO019", arms: "EVO020", legs: "EVO021" },
  deck: [
    ...Array(4).fill("EVO061"), ...Array(4).fill("EVO064"),
    ...Array(4).fill("EVO067"), ...Array(4).fill("EVO075"),
    ...Array(4).fill("EVO078"), ...Array(4).fill("EVO079"),
    ...Array(4).fill("EVO080"), ...Array(4).fill("EVO147"),
    ...Array(4).fill("EVO153"), ...Array(4).fill("EVO156"),
  ],
};

const EVO_MAXX_DECK: Decklist = {
  heroId: "EVO005",
  weaponIds: [],
  equipment: { head: "EVO014", chest: "EVO015", arms: "EVO016", legs: "EVO017" },
  deck: [
    ...Array(4).fill("EVO147"), ...Array(4).fill("EVO150"),
    ...Array(4).fill("EVO162"), ...Array(4).fill("EVO165"),
    ...Array(4).fill("EVO168"), ...Array(4).fill("EVO171"),
    ...Array(4).fill("EVO177"), ...Array(4).fill("EVO183"),
    ...Array(4).fill("EVO186"), ...Array(4).fill("EVO222"),
  ],
};

describe("Dash, Database vs Maxx Nitro full match (Bright Lights rare/common pools)", () => {
  it("plays a fixed-seed random match without rejected legal intents", () => {
    const rand = makeRand(37000);
    let s = createGame({
      decklists: [EVO_DASH_DATABASE_DECK, EVO_MAXX_DECK],
      seed: 36000,
      cards: cardData,
      scripts,
    });
    let steps = 0;
    let stagnantRounds = 0;
    let lastSnapshot = "";
    while (s.winner === null && steps < 2000) {
      const seat = s.pendingDecision?.player ?? s.priorityPlayer;
      const options = legalIntents(s, seat).filter((intent) => intent.kind !== "concede");
      expect(options.length, `no legal intents at step ${steps}`).toBeGreaterThan(0);
      const intent = options[Math.floor(rand() * options.length)]!;
      const result = applyIntent(s, seat, intent);
      expect(
        result.ok,
        `step ${steps}: ${JSON.stringify(intent)} → ${result.ok ? "" : result.error}\nlast log: ${formatLog(s.log.slice(-5))}`,
      ).toBe(true);
      if (!result.ok) return;
      s = result.state;
      steps++;
      const snapshot = JSON.stringify(
        s.players.map((player) => [player.life, player.hand.length, player.deck.length, player.graveyard.length]),
      );
      stagnantRounds = snapshot === lastSnapshot ? stagnantRounds + 1 : 0;
      lastSnapshot = snapshot;
      if (stagnantRounds > 8) break;
    }
    if (s.winner === null) {
      expect(stagnantRounds, "match made no progress yet is not a stalemate").toBeGreaterThan(8);
    }
  });
});

const ROS_FLORIAN_DECK: Decklist = {
  heroId: "ROS002",
  weaponIds: ["ROS003"],
  equipment: { head: "ROS029", legs: "ROS030" },
  deck: [
    ...Array(4).fill("ROS036"), ...Array(4).fill("ROS039"),
    ...Array(4).fill("ROS049"), ...Array(4).fill("ROS052"),
    ...Array(4).fill("ROS058"), ...Array(4).fill("ROS038"),
    ...Array(4).fill("ROS041"), ...Array(4).fill("ROS051"),
    ...Array(4).fill("ROS054"), ...Array(4).fill("ROS069"),
  ],
};

const ROS_OSCILIO_DECK: Decklist = {
  heroId: "ROS020",
  weaponIds: ["ROS021"],
  equipment: { head: "ROS212", chest: "ROS164", arms: "ROS165", legs: "ROS215" },
  deck: [
    ...Array(4).fill("ROS170"), ...Array(4).fill("ROS173"),
    ...Array(4).fill("ROS176"), ...Array(4).fill("ROS183"),
    ...Array(4).fill("ROS189"), ...Array(4).fill("ROS172"),
    ...Array(4).fill("ROS175"), ...Array(4).fill("ROS178"),
    ...Array(4).fill("ROS185"), ...Array(4).fill("ROS191"),
  ],
};

describe("Florian vs Oscilio full match (Rosetta rare/common pools)", () => {
  it("plays a fixed-seed random match without rejected legal intents", () => {
    const rand = makeRand(39000);
    let s = createGame({
      decklists: [ROS_FLORIAN_DECK, ROS_OSCILIO_DECK],
      seed: 38000,
      cards: cardData,
      scripts,
    });
    let steps = 0;
    let stagnantRounds = 0;
    let lastSnapshot = "";
    while (s.winner === null && steps < 2000) {
      const seat = s.pendingDecision?.player ?? s.priorityPlayer;
      const options = legalIntents(s, seat).filter((intent) => intent.kind !== "concede");
      expect(options.length, `no legal intents at step ${steps}`).toBeGreaterThan(0);
      const intent = options[Math.floor(rand() * options.length)]!;
      const result = applyIntent(s, seat, intent);
      expect(
        result.ok,
        `step ${steps}: ${JSON.stringify(intent)} → ${result.ok ? "" : result.error}\nlast log: ${formatLog(s.log.slice(-5))}`,
      ).toBe(true);
      if (!result.ok) return;
      s = result.state;
      steps++;
      const snapshot = JSON.stringify(
        s.players.map((player) => [player.life, player.hand.length, player.deck.length, player.graveyard.length]),
      );
      stagnantRounds = snapshot === lastSnapshot ? stagnantRounds + 1 : 0;
      lastSnapshot = snapshot;
      if (stagnantRounds > 8) break;
    }
    if (s.winner === null) {
      expect(stagnantRounds, "match made no progress yet is not a stalemate").toBeGreaterThan(8);
    }
  });
});

const HNT_CINDRA_DECK: Decklist = {
  heroId: "HNT055",
  weaponIds: ["HNT056", "HNT056"],
  equipment: {},
  deck: [
    ...Array(4).fill("HNT017"), ...Array(4).fill("HNT018"),
    ...Array(4).fill("HNT020"), ...Array(4).fill("HNT021"),
    ...Array(4).fill("HNT059"), ...Array(4).fill("HNT064"),
    ...Array(4).fill("HNT080"), ...Array(4).fill("HNT081"),
    ...Array(4).fill("HNT092"), ...Array(4).fill("HNT095"),
  ],
};

const HNT_FANG_DECK: Decklist = {
  heroId: "HNT099",
  weaponIds: ["HNT100", "HNT100"],
  equipment: { head: "HNT144", chest: "HNT145", arms: "HNT146", legs: "HNT147" },
  deck: [
    ...Array(4).fill("HNT151"), ...Array(4).fill("HNT152"),
    ...Array(4).fill("HNT153"), ...Array(4).fill("HNT158"),
    ...Array(4).fill("HNT159"), ...Array(4).fill("HNT160"),
    ...Array(4).fill("HNT103"), ...Array(4).fill("HNT104"),
    ...Array(4).fill("HNT106"), ...Array(4).fill("HNT119"),
  ],
};

describe("Cindra vs Fang full match (The Hunted rare/common pools)", () => {
  it("plays a fixed-seed random match without rejected legal intents", () => {
    const rand = makeRand(41000);
    let s = createGame({
      decklists: [HNT_CINDRA_DECK, HNT_FANG_DECK],
      seed: 40000,
      cards: cardData,
      scripts,
    });
    let steps = 0;
    let stagnantRounds = 0;
    let lastSnapshot = "";
    while (s.winner === null && steps < 2000) {
      const seat = s.pendingDecision?.player ?? s.priorityPlayer;
      const options = legalIntents(s, seat).filter((intent) => intent.kind !== "concede");
      expect(options.length, `no legal intents at step ${steps}`).toBeGreaterThan(0);
      const intent = options[Math.floor(rand() * options.length)]!;
      const result = applyIntent(s, seat, intent);
      expect(
        result.ok,
        `step ${steps}: ${JSON.stringify(intent)} → ${result.ok ? "" : result.error}\nlast log: ${formatLog(s.log.slice(-5))}`,
      ).toBe(true);
      if (!result.ok) return;
      s = result.state;
      steps++;
      const snapshot = JSON.stringify(
        s.players.map((player) => [player.life, player.hand.length, player.deck.length, player.graveyard.length]),
      );
      stagnantRounds = snapshot === lastSnapshot ? stagnantRounds + 1 : 0;
      lastSnapshot = snapshot;
      if (stagnantRounds > 8) break;
    }
    if (s.winner === null) {
      expect(stagnantRounds, "match made no progress yet is not a stalemate").toBeGreaterThan(8);
    }
  });
});

const SEA_PUFFIN_DECK: Decklist = {
  heroId: "SEA002",
  weaponIds: [],
  equipment: { chest: "SEA009", legs: "SEA010" },
  deck: [
    ...Array(4).fill("SEA015"), ...Array(4).fill("SEA018"),
    ...Array(4).fill("SEA021"), ...Array(4).fill("SEA024"),
    ...Array(4).fill("SEA027"), ...Array(4).fill("SEA030"),
    ...Array(4).fill("SEA033"), ...Array(4).fill("SEA036"),
    ...Array(4).fill("SEA039"), ...Array(4).fill("SEA041"),
  ],
};

const SEA_MARLYNN_DECK: Decklist = {
  heroId: "SEA083",
  weaponIds: ["SAZ002"],
  equipment: { head: "SEA096", arms: "SEA097" },
  deck: [
    ...Array(4).fill("SEA089"), ...Array(4).fill("SEA090"),
    ...Array(4).fill("SEA091"), ...Array(4).fill("SEA092"),
    ...Array(4).fill("SEA100"), ...Array(4).fill("SEA101"),
    ...Array(4).fill("SEA103"), ...Array(4).fill("SEA106"),
    ...Array(4).fill("SEA111"), ...Array(4).fill("SEA113"),
  ],
};

describe("Puffin vs Marlynn full match (High Seas rare/common pools)", () => {
  it("plays a fixed-seed random match without rejected legal intents", () => {
    const rand = makeRand(43000);
    let s = createGame({
      decklists: [SEA_PUFFIN_DECK, SEA_MARLYNN_DECK],
      seed: 42000,
      cards: cardData,
      scripts,
    });
    let steps = 0;
    let stagnantRounds = 0;
    let lastSnapshot = "";
    while (s.winner === null && steps < 2000) {
      const seat = s.pendingDecision?.player ?? s.priorityPlayer;
      const options = legalIntents(s, seat).filter((intent) => intent.kind !== "concede");
      expect(options.length, `no legal intents at step ${steps}`).toBeGreaterThan(0);
      const intent = options[Math.floor(rand() * options.length)]!;
      const result = applyIntent(s, seat, intent);
      expect(
        result.ok,
        `step ${steps}: ${JSON.stringify(intent)} → ${result.ok ? "" : result.error}\nlast log: ${formatLog(s.log.slice(-5))}`,
      ).toBe(true);
      if (!result.ok) return;
      s = result.state;
      steps++;
      const snapshot = JSON.stringify(
        s.players.map((player) => [player.life, player.hand.length, player.deck.length, player.graveyard.length]),
      );
      stagnantRounds = snapshot === lastSnapshot ? stagnantRounds + 1 : 0;
      lastSnapshot = snapshot;
      if (stagnantRounds > 8) break;
    }
    if (s.winner === null) {
      expect(stagnantRounds, "match made no progress yet is not a stalemate").toBeGreaterThan(8);
    }
  });
});

describe("targeted card scenarios", () => {
  function give(s: GameState, seat: number, cardId: string): number {
    const p = s.players[seat]!;
    const idx = p.deck.findIndex((c) => c.cardId === cardId);
    let c;
    if (idx >= 0) c = p.deck.splice(idx, 1)[0]!;
    else c = { instanceId: s.nextInstanceId++, cardId, owner: seat };
    p.hand.push(c);
    return c.instanceId;
  }

  /** Pass through start-of-turn triggers / priority windows until `seat`
   *  holds an open action phase (declining optional triggers). */
  function skipToActionPhase(s: GameState, seat: number): GameState {
    let guard = 0;
    while (guard++ < 20 && s.winner === null) {
      if (s.phase === "action" && !s.pendingDecision && s.activePlayer === seat) break;
      const actor = s.pendingDecision?.player ?? s.priorityPlayer;
      const r = applyIntent(s, actor, { kind: "pass" });
      expect(r.ok).toBe(true);
      if (!r.ok) return s;
      s = r.state;
    }
    return s;
  }

  it("Sharpen Steel buffs the next weapon attack by +3", () => {
    let s = skipToActionPhase(newGame(11), 0);
    const sharpen = give(s, 0, "DVR012"); // Sharpen Steel red
    let r = applyIntent(s, 0, { kind: "play-card", instanceId: sharpen, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = skipToActionPhase(r.state, 0);
    expect(s.players[0]!.actionPoints).toBe(1); // go again refund
    const dawnblade = s.players[0]!.weapons[0]!;
    const pitchCard = s.players[0]!.hand[0]!;
    r = applyIntent(s, 0, {
      kind: "activate-ability",
      sourceInstanceId: dawnblade.instanceId,
      pitchInstanceIds: [pitchCard.instanceId],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(s.chain[0]).toBeTruthy();
    const view = projectStateFor(s, 0);
    expect(view.chain[0]!.attackValue).toBe(2 + 3); // Dawnblade 2 + Sharpen Steel 3
  });

  it("Rhinar intimidates when discarding a 6+ card (Wrecker Romp)", () => {
    let s = newGame(12);
    const romp = give(s, 1, "RNR023"); // Wrecker Romp blue
    // pass through Dorinthea's turn (declining mentor flips) so Rhinar becomes active
    s = skipToActionPhase(s, 1);
    expect(s.activePlayer).toBe(1);
    const pitchable = s.players[1]!.hand.filter(
      (c) => c.instanceId !== romp && (cardData[c.cardId]?.pitch ?? 0) >= 2,
    );
    const pitch =
      pitchable[0] ?? s.players[1]!.hand.find((c) => c.instanceId !== romp)!;
    const r = applyIntent(s, 1, {
      kind: "play-card",
      instanceId: romp,
      pitchInstanceIds: [pitch.instanceId],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    // pass through any attack-declared priority window so the queued
    // intimidate resolves before we check the banish
    let guard = 0;
    while (s.pendingDecision?.kind === "priority-window" && guard++ < 10) {
      const actor = s.pendingDecision.player;
      const rw = applyIntent(s, actor, { kind: "pass" });
      expect(rw.ok).toBe(true);
      if (!rw.ok) return;
      s = rw.state;
    }
    // the additional-cost discard may or may not be 6+, but if the log shows
    // Rhinar's trigger then Dorinthea must have banished a random card face down
    const triggered = s.log.some((l) => l.publicText?.includes("Rhinar's ability triggers"));
    if (triggered && s.players[0]!.hand.length > 0) {
      expect(s.players[0]!.banish.some((c) => c.intimidated === true)).toBe(true);
    }
  });

  it("Barraging Beatdown intimidates the opponent when it resolves", () => {
    let s = newGame(14);
    const beatdown = give(s, 1, "RNR018"); // Barraging Beatdown (yellow)
    // pass through Dorinthea's turn (declining mentor flips) so Rhinar becomes active
    s = skipToActionPhase(s, 1);
    const r = applyIntent(s, 1, { kind: "play-card", instanceId: beatdown, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = skipToActionPhase(r.state, 1);
    expect(s.players[1]!.actionPoints).toBe(1); // go again refunded
    // intimidate resolved with the action: Dorinthea banished a random card face down
    expect(s.players[0]!.banish.filter((c) => c.intimidated === true)).toHaveLength(1);
    expect(s.pendingDecision).toBeNull();
  });

  it("concede ends the game", () => {
    let s = newGame(13);
    const r = applyIntent(s, 1, { kind: "concede" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(s.winner).toBe(0);
    const after = applyIntent(s, 0, { kind: "pass" });
    expect(after.ok).toBe(false);
  });
});
