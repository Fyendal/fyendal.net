import { engineRuntime } from "../engineRuntime.js";
import type { CardData, Decklist } from "@fyendal/shared";
import type { CardScript } from "../index.js";
import { createGame as createGameState, type GameStateInternal } from "../runtimeState.js";
import { drawUpTo, startTurn } from "../turn.js";
import type { PlayerState } from "../state.js";

export const cards: Record<string, CardData> = {
  HERO_A: { id: "HERO_A", name: "Hero A", cardType: "hero", classes: ["warrior"], intellect: 4, life: 20, text: "" },
  HERO_B: { id: "HERO_B", name: "Hero B", cardType: "hero", classes: ["brute"], intellect: 4, life: 20, text: "" },
  SWORD: { id: "SWORD", name: "Test Sword", cardType: "weapon", subtypes: ["sword", "1h"], attack: 3, text: "Action — {r}: Attack. Go again" },
  BLADE: { id: "BLADE", name: "Test Blade", cardType: "weapon", subtypes: ["sword", "1h"], attack: 3, text: "Once per Turn Action — {r}: Attack. When this hits, it gains go again" },
  CLUB: { id: "CLUB", name: "Test Club", cardType: "weapon", subtypes: ["club", "2h"], attack: 4, text: "Action — {r}{r}: Attack" },
  ATK6: { id: "ATK6", name: "Attack Six", cardType: "action", subtypes: ["attack"], classes: ["generic"], pitch: 1, cost: 0, attack: 6, defense: 3, keywords: ["Go again"], text: "Go again" },
  ATK4: { id: "ATK4", name: "Attack Four", cardType: "action", subtypes: ["attack"], classes: ["generic"], pitch: 2, cost: 0, attack: 4, defense: 3, text: "" },
  BIG: { id: "BIG", name: "Big Swing", cardType: "action", subtypes: ["attack"], classes: ["brute"], pitch: 1, cost: 2, attack: 7, defense: 2, text: "" },
  DOM: { id: "DOM", name: "Dominator", cardType: "action", subtypes: ["attack"], classes: ["brute"], pitch: 1, cost: 0, attack: 6, defense: 2, keywords: ["Dominate"], text: "Dominate" },
  INTIM: { id: "INTIM", name: "Intimidator", cardType: "action", subtypes: ["attack"], classes: ["brute"], pitch: 1, cost: 0, attack: 5, defense: 2, keywords: ["Intimidate"], text: "Intimidate" },
  BLOCK3: { id: "BLOCK3", name: "Blocker", cardType: "action", subtypes: [], classes: ["generic"], pitch: 3, cost: 0, attack: 0, defense: 3, text: "" },
  REACT: { id: "REACT", name: "Pump Up", cardType: "attack-reaction", classes: ["warrior"], pitch: 1, cost: 0, defense: 3, text: "The attack gains +2 attack" },
  DREACT: { id: "DREACT", name: "Sinker", cardType: "defense-reaction", classes: ["generic"], pitch: 3, cost: 0, defense: 3, text: "Draw a card" },
  HELM: { id: "HELM", name: "Test Helm", cardType: "equipment", subtypes: ["head"], defense: 1, keywords: ["Blade Break"], text: "Blade Break" },
  BW: { id: "BW", name: "Test Battleworn", cardType: "equipment", subtypes: ["chest"], defense: 2, keywords: ["Battleworn"], text: "Battleworn" },
  BUCKLER: { id: "BUCKLER", name: "Test Buckler", cardType: "equipment", subtypes: ["off-hand"], defense: 2, keywords: ["Temper"], text: "Temper" },
  BLUE: { id: "BLUE", name: "Blue Resource", cardType: "action", subtypes: [], classes: ["generic"], pitch: 3, cost: 0, attack: 0, defense: 3, text: "" },
  YEL: { id: "YEL", name: "Yellow Resource", cardType: "action", subtypes: [], classes: ["generic"], pitch: 2, cost: 0, attack: 0, defense: 3, text: "" },
  INSTANT: { id: "INSTANT", name: "Test Sigil", cardType: "instant", classes: ["generic"], pitch: 3, cost: 0, text: "Gain 1 life" },
  IDOL: { id: "IDOL", name: "Test Idol", cardType: "instant", subtypes: ["item"], classes: ["generic"], pitch: 3, cost: 0, text: "Instant — {t}: Gain 1 life" },
  CHOICE_ITEM: { id: "CHOICE_ITEM", name: "Choice Item", cardType: "action", subtypes: ["item"], classes: ["generic"], pitch: 3, cost: 0, defense: 3, keywords: ["Go again"], text: "Choose yes or no. Go again." },
  GADGET: { id: "GADGET", name: "Test Gadget", cardType: "instant", subtypes: ["item"], classes: ["generic"], pitch: 3, cost: 0, text: "Instant — gain 1 life / once per turn gain 2 life" },
  ROT: { id: "ROT", name: "Test Rot", cardType: "instant", classes: ["generic"], pitch: 3, cost: 0, text: "Your first board card is destroyed at the beginning of the end phase" },
  TWIDDLE: { id: "TWIDDLE", name: "Test Twiddle", cardType: "instant", classes: ["generic"], pitch: 3, cost: 0, text: "Untap your first board card" },
  HEX: { id: "HEX", name: "Test Hex", cardType: "instant", classes: ["generic"], pitch: 3, cost: 0, text: "Tap the opposing hero" },
  MENTOR: { id: "MENTOR", name: "Test Mentor", cardType: "mentor", classes: ["generic"], text: "Start of turn: turn face up" },
  BELLOW: { id: "BELLOW", name: "Test Bellow", cardType: "action", subtypes: [], classes: ["brute"], pitch: 2, cost: 0, defense: 3, keywords: ["Intimidate", "Go again"], text: "Intimidate. Go again" },
  PUMP: { id: "PUMP", name: "Test Pump", cardType: "action", subtypes: [], classes: ["generic"], pitch: 1, cost: 0, defense: 2, keywords: ["Go again"], text: "Go again. Your next attack action gets +2{p}" },
  TOKEN: { id: "TOKEN", name: "Test Token", cardType: "token", classes: ["generic"], text: "" },
  AURA: { id: "AURA", name: "Test Aura", cardType: "action", subtypes: ["aura"], classes: ["generic"], cost: 0, defense: 3, text: "Enters with 2 charge counters. Destroyed at 0." },
  ZAP: { id: "ZAP", name: "Test Zap", cardType: "instant", classes: ["generic"], pitch: 3, cost: 0, text: "Remove a charge counter from your first board card" },
  SPLIT: { id: "SPLIT", name: "Test Split // Test Half", cardType: "instant", classes: ["generic"], pitch: 3, cost: 2, keywords: ["Meld"], text: "Meld" },
  RUNE_GATE: { id: "RUNE_GATE", name: "Test Rune Gate", cardType: "action", classes: ["runeblade"], subtypes: ["shadow", "attack"], pitch: 1, cost: 2, attack: 5, defense: 3, keywords: ["Rune Gate"], text: "Rune Gate" },
  RUNECHANT: { id: "RUNECHANT", name: "Test Runechant", cardType: "token", classes: ["runeblade"], subtypes: ["aura"], text: "" },
};

export const scripts: Record<string, CardScript> = {
  SWORD: {
    activated: { cost: 1, isAttack: true, goAgain: true, oncePerTurn: true },
  },
  BLADE: {
    // once-per-turn weapon whose attack gains go again on hit (Hala pattern)
    activated: { cost: 1, isAttack: true, goAgain: false, oncePerTurn: true },
    onHit(ctx) {
      ctx.grantGoAgain();
    },
  },
  HERO_A: {
    // Dorinthea pattern: the first time BLADE's attack gets go again each
    // turn, re-enable its once-per-turn ability
    onGainGoAgain(ctx) {
      const link = ctx.link;
      if (!link || link.attackingCard.cardId !== "BLADE") return;
      if (ctx.getFlag("player", "extraAttack")) return;
      ctx.setFlag("player", "extraAttack", true);
      const p = ctx.state.players[ctx.seat]!;
      const blade = p.weapons.find((w) => w.cardId === "BLADE");
      if (blade) ctx.grantAdditionalActivation(blade.instanceId);
    },
  },
  CLUB: {
    activated: { cost: 2, isAttack: true, goAgain: false },
  },
  REACT: {
    onPlay(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: 2 });
    },
  },
  PUMP: {
    onPlay(ctx) {
      ctx.addModifier({ scope: "next-attack", attack: 2, appliesTo: "attack-action" });
    },
  },
  DREACT: {
    onPlay(ctx) {
      ctx.drawCards(ctx.seat, 1);
    },
  },
  INSTANT: {
    onPlay(ctx) {
      ctx.gainLife(ctx.seat, 1);
    },
  },
  IDOL: {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      tap: true, // {t}
      timing: "instant",
      onActivate(ctx) {
        ctx.gainLife(ctx.seat, 1);
      },
    },
  },
  CHOICE_ITEM: {
    onPlay(ctx) {
      ctx.requestChoice("choice-item", "Choose yes or no", ["yes", "no"]);
    },
    onChoose(ctx, hook, option) {
      if (hook === "choice-item") {
        ctx.setCounter("choice", option === "yes" ? 1 : 0);
        ctx.setFlag("player", "choiceItemResult", option === "yes");
      }
    },
    onEnterArena(ctx) {
      ctx.setFlag(
        "player",
        "choiceItemEnteredAfterResolution",
        ctx.getFlag("player", "choiceItemResult") === true && ctx.getCounter("choice") === 1,
      );
    },
  },
  GADGET: {
    // two activated abilities on one card: a repeatable one and a
    // once-per-turn one (per-ability flags, abilityIndex in intents)
    activated: [
      {
        cost: 0,
        isAttack: false,
        goAgain: false,
        timing: "instant",
        label: "Gain 1",
        onActivate(ctx) {
          ctx.gainLife(ctx.seat, 1);
        },
      },
      {
        cost: 0,
        isAttack: false,
        goAgain: false,
        timing: "instant",
        oncePerTurn: true,
        label: "Gain 2",
        onActivate(ctx) {
          ctx.gainLife(ctx.seat, 2);
        },
      },
    ],
  },
  ROT: {
    onPlay(ctx) {
      const first = ctx.state.players[ctx.seat]!.board[0];
      ctx.setFlag("player", "rotOk", first ? ctx.destroyAtEndPhase(first.instanceId) : false);
    },
  },
  TWIDDLE: {
    onPlay(ctx) {
      const first = ctx.state.players[ctx.seat]!.board[0];
      ctx.setFlag("player", "untapOk", first ? ctx.untap(first.instanceId) : false);
    },
  },
  HEX: {
    onPlay(ctx) {
      const opp = ctx.state.players[ctx.seat === 0 ? 1 : 0]!;
      ctx.setFlag("player", "tapOk", ctx.tap(opp.hero.instanceId));
    },
  },
  BELLOW: {
    onPlay(ctx) {
      const n = Number(ctx.getFlag("player", "pendingIntimidate")) || 0;
      ctx.setFlag("player", "pendingIntimidate", n + 1);
    },
  },
  MENTOR: {
    activeWhileFaceUpInArsenal: true,
    triggers: [
      {
        event: "start-of-turn",
        condition: (ctx) => ctx.self.faceDown === true,
        optional: true,
        defaultOption: "yes",
        label: "Turn face up?",
        onAccept(ctx) {
          ctx.flipFaceUp();
        },
      },
    ],
    onFriendlyPlay(ctx) {
      ctx.setFlag("player", "mentorFired", true);
    },
  },
  SPLIT: {
    meld: {
      leftName: "Test Split",
      rightName: "Test Half",
      leftCardType: "action",
      rightCardType: "instant",
    },
    onPlay(ctx) {
      const side = ctx.self.meldSide;
      if (side === "right") return ctx.gainLife(ctx.seat, 2);
      if (side === "both") {
        ctx.gainLife(ctx.seat, 2);
        return ctx.gainLife(ctx.seat, 1);
      }
      return ctx.gainLife(ctx.seat, 1);
    },
  },
  RUNE_GATE: { runeGate: true },
  RUNECHANT: { runechantToken: true },
  AURA: {
    destroyAtZeroCounter: "charge",
    onEnterArena(ctx) {
      ctx.setCounter("charge", 2);
    },
  },
  ZAP: {
    onPlay(ctx) {
      const first = ctx.state.players[ctx.seat]!.board[0];
      if (!first) return;
      ctx.setCardCounter(first.instanceId, "charge", Math.max(0, (first.counters?.charge ?? 0) - 1));
    },
  },
};

export function decklist(hero: string, weapon: string, deck: string[]): Decklist {
  return { heroId: hero, weaponIds: [weapon], equipment: {}, deck };
}

export function makeGame(seed = 42, deck?: string[], mentorId?: string): GameStateInternal {
  const d = deck ?? Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? "ATK4" : "BLOCK3"));
  const state = createGameState({
    decklists: [decklist("HERO_A", "SWORD", d), decklist("HERO_B", "CLUB", d)],
    seed,
    cards,
    scripts,
  }) as GameStateInternal;
  // test setup: a mentor mid-game sits face down in the arsenal (placed via
  // the normal arsenal step in real play); its start-of-turn trigger flips it
  if (mentorId) {
    for (const p of state.players) {
      p.arsenal.push({
        instanceId: state.nextInstanceId++,
        cardId: mentorId,
        owner: p.seat,
        faceDown: true,
      });
    }
  }
  // opening hands, then the first turn starts (mirrors index.createGame)
  for (const p of state.players) drawUpTo(state, engineRuntime, p);
  startTurn(state, engineRuntime);
  return state;
}

export function player(state: GameStateInternal, seat: number): PlayerState {
  return state.players[seat] as PlayerState;
}

/** Move a card of cardId from the player's deck into their hand; if the deck has
 *  none, conjure a fresh instance (test setup helper). */
export function giveCard(state: GameStateInternal, seat: number, cardId: string): number {
  const p = player(state, seat);
  const idx = p.deck.findIndex((c) => c.cardId === cardId);
  if (idx >= 0) {
    const c = p.deck.splice(idx, 1)[0]!;
    p.hand.push(c);
    return c.instanceId;
  }
  const c = { instanceId: state.nextInstanceId++, cardId, owner: seat };
  p.hand.push(c);
  return c.instanceId;
}
