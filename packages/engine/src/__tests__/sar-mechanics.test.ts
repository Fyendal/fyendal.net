import { engineRuntime } from "../engineRuntime.js";
import { describe, expect, it } from "vitest";
import type { CardData, Decklist, EquipmentSlot, GameIntent } from "@fyendal/shared";
import { applyIntent, legalIntents } from "../index.js";
import type { CardScript } from "../scripts.js";
import { createGame as createGameState, type GameStateInternal } from "../runtimeState.js";
import type { CardInstance, PlayerState } from "../state.js";
import { drawUpTo, startTurn } from "../turn.js";

// ── SAR mechanics: becomeHero/onBecomeHero, ActivatedAbility.discardCost,
// equipToken, modifyPlayCost + costMoreThisTurn, defense reactions from the
// banished zone, putOnDeckTop's top→bottom replacement, tempDefense.

const cards: Record<string, CardData> = {
  HERO_A: { id: "HERO_A", name: "Hero A", cardType: "hero", classes: ["warrior"], intellect: 4, life: 20, text: "" },
  HERO_B: { id: "HERO_B", name: "Hero B", cardType: "hero", classes: ["brute"], intellect: 4, life: 20, text: "" },
  HERO_V1: { id: "HERO_V1", name: "Brood Hero", cardType: "hero", classes: ["chaos"], intellect: 4, life: 20, text: "At the beginning of your end phase, you become an Agent" },
  HERO_V2: { id: "HERO_V2", name: "Agent of Chaos", cardType: "hero", classes: ["chaos"], intellect: 4, text: "When you become this, mark the occasion. Instant: Gain 1 life" },
  BROOD: { id: "BROOD", name: "Discard Hero", cardType: "hero", classes: ["chaos", "assassin"], intellect: 4, life: 20, text: "Instant — Discard an Assassin card: Gain 1 life" },
  TAX: { id: "TAX", name: "Ability Tax", cardType: "equipment", subtypes: ["head"], text: "Activated abilities cost opposing heroes an additional resource" },
  SWORD: { id: "SWORD", name: "Test Sword", cardType: "weapon", subtypes: ["sword", "1h"], attack: 3, text: "" },
  ATK4: { id: "ATK4", name: "Attack Four", cardType: "action", subtypes: ["attack"], classes: ["generic"], pitch: 1, cost: 0, attack: 4, defense: 3, text: "" },
  BLOCK3: { id: "BLOCK3", name: "Blocker", cardType: "action", subtypes: [], classes: ["generic"], pitch: 3, cost: 0, attack: 0, defense: 3, text: "" },
  REACT: { id: "REACT", name: "Test Defense Reaction", cardType: "defense-reaction", classes: ["generic"], pitch: 3, cost: 0, defense: 3, text: "" },
  TRAP: { id: "TRAP", name: "Test Trap", cardType: "defense-reaction", classes: ["assassin"], subtypes: ["trap"], pitch: 3, cost: 0, defense: 3, text: "A trap" },
  ASSASSIN_CARD: { id: "ASSASSIN_CARD", name: "Assassin Fodder", cardType: "action", subtypes: [], classes: ["assassin"], pitch: 3, cost: 0, attack: 0, defense: 3, text: "" },
  GENERIC_CARD: { id: "GENERIC_CARD", name: "Generic Fodder", cardType: "action", subtypes: [], classes: ["generic"], pitch: 1, cost: 0, attack: 0, defense: 3, text: "" },
  WTOKEN: { id: "WTOKEN", name: "Token Dagger", cardType: "weapon", subtypes: ["dagger", "1h"], attack: 1, text: "" },
  MAKER: { id: "MAKER", name: "Test Equipper", cardType: "instant", classes: ["generic"], pitch: 3, cost: 0, text: "Equip a Token Dagger" },
  LOADER: { id: "LOADER", name: "Test Trap Loader", cardType: "instant", classes: ["generic"], pitch: 3, cost: 0, text: "Banish a trap face-down; you may play it" },
  COSTLY_REACT: { id: "COSTLY_REACT", name: "Test Discount Reaction", cardType: "attack-reaction", classes: ["generic"], pitch: 1, cost: 1, defense: 2, text: "This costs {r} less to play" },
  ZAPTOP: { id: "ZAPTOP", name: "Test Top Mover", cardType: "instant", classes: ["generic"], pitch: 3, cost: 0, text: "Put a card from your graveyard on top of your deck" },
  REPEAT_SHIELD: { id: "REPEAT_SHIELD", name: "Repeat Shield", cardType: "instant", classes: ["generic"], pitch: 3, cost: 0, text: "Prevent 1 from each of the next 3 damage events" },
  THREE_HITS: { id: "THREE_HITS", name: "Three Hits", cardType: "instant", classes: ["generic"], pitch: 3, cost: 0, text: "Deal 2 damage three times" },
};

const scripts: Record<string, CardScript> = {
  HERO_V1: {
    triggers: [
      {
        event: "end-of-turn",
        label: "Become an Agent of Chaos",
        effect(ctx) {
          ctx.becomeHero("HERO_V2");
        },
      },
    ],
  },
  HERO_V2: {
    onBecomeHero(ctx) {
      ctx.logPublic("the agent takes over");
    },
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      label: "Gain 1 life",
      onActivate(ctx) {
        ctx.gainLife(ctx.seat, 1);
      },
    },
  },
  BROOD: {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      discardCost: { count: 1, classes: ["assassin"] },
      label: "Discard an Assassin card: gain 1 life",
      onActivate(ctx) {
        ctx.gainLife(ctx.seat, 1);
      },
    },
  },
  TAX: { additionalCostToOpponents: 1 },
  MAKER: {
    onPlay(ctx) {
      ctx.equipToken("WTOKEN");
    },
  },
  LOADER: {
    onPlay(ctx) {
      const p = ctx.state.players[ctx.seat]!;
      const trap = p.deck.find((c) => c.cardId === "TRAP");
      if (!trap || !ctx.banish(trap.instanceId, { faceDown: true })) return;
      ctx.allowPlayFrom(trap.instanceId, "banish", { untilNextTurn: true });
    },
  },
  TRAP: {
    onSelfBanished(ctx) {
      ctx.setPlayerFlag(ctx.seat, "faceDownSelfBanishTriggered", true);
    },
  },
  COSTLY_REACT: {
    modifyPlayCost: (_ctx, base) => base - 1,
    onPlay(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: 1 });
    },
  },
  ZAPTOP: {
    onPlay(ctx) {
      const top = ctx.state.players[ctx.seat]!.graveyard.find((c) => c.cardId !== "ZAPTOP");
      if (top) ctx.putOnDeckTop(top.instanceId);
    },
  },
  REPEAT_SHIELD: {
    onPlay(ctx) {
      ctx.preventNextDamageEvents(ctx.seat, 1, 3);
    },
  },
  THREE_HITS: {
    onPlay(ctx) {
      for (let i = 0; i < 3; i++) ctx.dealDamage(ctx.seat, 2);
    },
  },
};

interface GameOpts {
  heroes?: [string, string];
  weapons?: [string, string];
  p0equipment?: Partial<Record<EquipmentSlot, string>>;
  p1equipment?: Partial<Record<EquipmentSlot, string>>;
  deck?: string[];
}

function makeGame(opts: GameOpts = {}): GameStateInternal {
  const d = opts.deck ?? Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? "ATK4" : "BLOCK3"));
  const decklist = (i: 0 | 1): Decklist => ({
    heroId: opts.heroes?.[i] ?? (i === 0 ? "HERO_A" : "HERO_B"),
    weaponIds: [opts.weapons?.[i] ?? "SWORD"],
    equipment: i === 0 ? (opts.p0equipment ?? {}) : (opts.p1equipment ?? {}),
    deck: d,
  });
  const state = createGameState({
    decklists: [decklist(0), decklist(1)],
    seed: 42,
    cards,
    scripts,
  }) as GameStateInternal;
  for (const p of state.players) drawUpTo(state, engineRuntime, p);
  startTurn(state, engineRuntime);
  return state;
}

function player(state: GameStateInternal, seat: number): PlayerState {
  return state.players[seat] as PlayerState;
}

function giveCard(state: GameStateInternal, seat: number, cardId: string): number {
  const p = player(state, seat);
  const c: CardInstance = { instanceId: state.nextInstanceId++, cardId, owner: seat };
  p.hand.push(c);
  return c.instanceId;
}

function apply(s: GameStateInternal, seat: number, intent: GameIntent): GameStateInternal {
  const r = applyIntent(s, seat, intent);
  expect(r.ok && r.ok ? true : r.error).toBe(true);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

function passTurn(s: GameStateInternal, seat: number): GameStateInternal {
  let cur = apply(s, seat, { kind: "pass" });
  for (let i = 0; i < 12 && cur.activePlayer === seat; i++) {
    const pd = cur.pendingDecision;
    if (pd?.kind !== "priority-window" && pd?.kind !== "arsenal") break;
    cur = apply(cur, pd.player, { kind: "pass" });
  }
  return cur;
}

function playAndResolve(s: GameStateInternal, seat: number, instanceId: number): GameStateInternal {
  let cur = apply(s, seat, { kind: "play-card", instanceId, pitchInstanceIds: [] });
  for (let i = 0; i < 8 && cur.pendingDecision; i++) {
    const pd = cur.pendingDecision;
    if (pd.kind === "choose-target") break;
    cur = apply(cur, pd.player, { kind: "pass" });
  }
  return cur;
}

function declareAttackFromHand(s: GameStateInternal, seat: number, cardId: string): GameStateInternal {
  const id = giveCard(s, seat, cardId);
  let next = apply(s, seat, { kind: "play-card", instanceId: id, pitchInstanceIds: [] });
  for (let i = 0; i < 6 && next.pendingDecision?.kind === "priority-window"; i++) {
    next = apply(next, next.pendingDecision.player, { kind: "pass" });
  }
  expect(next.pendingDecision?.kind).toBe("defend");
  return next;
}

function openReactionWindow(s: GameStateInternal, seat: number): GameStateInternal {
  let cur = apply(s, seat, { kind: "defend", instanceIds: [] });
  cur = apply(cur, cur.pendingDecision!.player, { kind: "pass" });
  expect(cur.pendingDecision?.kind).toBe("defense-reaction");
  return cur;
}

// ── becomeHero / onBecomeHero ───────────────────────────────────────────────

describe("becomeHero", () => {
  it("swaps the hero card id, keeps life, and fires onBecomeHero", () => {
    let s = makeGame({ heroes: ["HERO_V1", "HERO_B"] });
    player(s, 0).life = 13;
    s = passTurn(s, 0); // end phase → trigger → become HERO_V2
    expect(player(s, 0).hero.cardId).toBe("HERO_V2");
    expect(player(s, 0).heroCardId).toBe("HERO_V2");
    expect(player(s, 0).hero.originalHeroCardId).toBe("HERO_V1");
    expect(player(s, 0).life).toBe(13); // life is player-level
    expect(s.log.some((l) => l.publicText?.includes("the agent takes over"))).toBe(true);
    expect(s.log.some((l) => l.publicText?.includes("becomes Agent of Chaos"))).toBe(true);
    // the new hero's script is live: its ability is offered on the next turn
    s = passTurn(s, 1);
    expect(s.activePlayer).toBe(0);
    const heroId = player(s, 0).hero.instanceId;
    expect(
      legalIntents(s, 0).some((i) => i.kind === "activate-ability" && i.sourceInstanceId === heroId),
    ).toBe(true);
  });
});

// ── ActivatedAbility.discardCost ────────────────────────────────────────────

describe("discardCost abilities", () => {
  it("requests and pays a valid discard separately from resource pitches", () => {
    let s = makeGame({ heroes: ["BROOD", "HERO_B"] });
    const fodder = giveCard(s, 0, "ASSASSIN_CARD");
    giveCard(s, 0, "GENERIC_CARD");
    const heroId = player(s, 0).hero.instanceId;
    const offered = legalIntents(s, 0).filter(
      (i) => i.kind === "activate-ability" && i.sourceInstanceId === heroId,
    );
    expect(offered).toHaveLength(1);
    expect(offered[0]).toMatchObject({ pitchInstanceIds: [] });
    s = apply(s, 0, { kind: "activate-ability", sourceInstanceId: heroId, pitchInstanceIds: [] });
    expect(s.pendingDecision).toMatchObject({
      chooseHook: "engine-activation-discard",
      options: [String(fodder)],
    });
    s = apply(s, 0, { kind: "choose", optionId: String(fodder) });
    s = apply(s, s.priorityPlayer, { kind: "pass" });
    s = apply(s, s.priorityPlayer, { kind: "pass" });
    expect(player(s, 0).life).toBe(21);
    expect(player(s, 0).graveyard.some((c) => c.cardId === "ASSASSIN_CARD")).toBe(true);
  });

  it("rejects a discard of the wrong class", () => {
    const s = makeGame({ heroes: ["BROOD", "HERO_B"] });
    giveCard(s, 0, "GENERIC_CARD");
    const heroId = player(s, 0).hero.instanceId;
    const r = applyIntent(s, 0, { kind: "activate-ability", sourceInstanceId: heroId, pitchInstanceIds: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/cannot pay discard cost/);
  });

  it("is not offered without a valid discard in hand", () => {
    const s = makeGame({ heroes: ["BROOD", "HERO_B"] });
    giveCard(s, 0, "GENERIC_CARD");
    const heroId = player(s, 0).hero.instanceId;
    expect(
      legalIntents(s, 0).some((i) => i.kind === "activate-ability" && i.sourceInstanceId === heroId),
    ).toBe(false);
  });

  it("pays a resource increase in addition to the discard effect-cost", () => {
    let s = makeGame({ heroes: ["BROOD", "HERO_B"], p1equipment: { head: "TAX" } });
    player(s, 0).hand = [];
    const discard = giveCard(s, 0, "ASSASSIN_CARD");
    const heroId = player(s, 0).hero.instanceId;
    expect(legalIntents(s, 0).some(
      (intent) => intent.kind === "activate-ability" && intent.sourceInstanceId === heroId,
    )).toBe(false);
    const pitch = giveCard(s, 0, "GENERIC_CARD");
    const offered = legalIntents(s, 0).filter(
      (intent) => intent.kind === "activate-ability" && intent.sourceInstanceId === heroId,
    );
    expect(offered).toEqual([
      expect.objectContaining({ pitchInstanceIds: [pitch], pitchRequired: 1 }),
    ]);
    s = apply(s, 0, offered[0]!);
    expect(s.pendingDecision).toMatchObject({ chooseHook: "engine-activation-discard" });
    s = apply(s, 0, { kind: "choose", optionId: String(discard) });
    expect(player(s, 0).resources).toBe(0);
    expect(player(s, 0).pitch.map((card) => card.instanceId)).toContain(pitch);
    expect(player(s, 0).graveyard.map((card) => card.instanceId)).toContain(discard);
  });
});

// ── equipToken ──────────────────────────────────────────────────────────────

describe("equipToken", () => {
  it("equips a weapon token to a weapon slot and fails when both are full", () => {
    let s = makeGame();
    const m1 = giveCard(s, 0, "MAKER");
    const m2 = giveCard(s, 0, "MAKER");
    s = playAndResolve(s, 0, m1);
    expect(player(s, 0).weapons.map((c) => c.cardId)).toEqual(["SWORD", "WTOKEN"]);
    expect(player(s, 0).board).toHaveLength(0);
    s = playAndResolve(s, 0, m2);
    expect(player(s, 0).weapons).toHaveLength(2); // no third weapon
    expect(player(s, 0).board).toHaveLength(0); // nothing left on the board
    expect(s.log.some((l) => l.publicText?.includes("no empty weapon zone"))).toBe(true);
  });
});

describe("repeating damage-event prevention", () => {
  it("prevents the stated amount from each of the next three events", () => {
    let s = makeGame();
    const shield = giveCard(s, 0, "REPEAT_SHIELD");
    const hits = giveCard(s, 0, "THREE_HITS");
    s = playAndResolve(s, 0, shield);
    s = playAndResolve(s, 0, hits);
    expect(player(s, 0).life).toBe(17);
    expect(s.modifiers.some((modifier) => modifier.preventDamagePerEvent === 1 && !modifier.consumed)).toBe(false);
  });
});

// ── modifyPlayCost / costMoreThisTurn ───────────────────────────────────────

describe("dynamic card play costs", () => {
  it("modifyPlayCost discounts a reaction's play cost", () => {
    let s = makeGame();
    const react = giveCard(s, 0, "COSTLY_REACT");
    s = declareAttackFromHand(s, 0, "ATK4");
    s = apply(s, 1, { kind: "defend", instanceIds: [] });
    // the discounted reaction is playable with no pitch
    const r = applyIntent(s, 0, { kind: "play-card", instanceId: react, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
  });

  it("costMoreThisTurn increases play costs (cards, incl. reactions)", () => {
    let s = makeGame();
    const atk = giveCard(s, 0, "ATK4"); // cost 0 → 1 with the flag
    const fodder = giveCard(s, 0, "GENERIC_CARD");
    player(s, 0).flags.costMoreThisTurn = 1;
    const r = applyIntent(s, 0, { kind: "play-card", instanceId: atk, pitchInstanceIds: [] });
    expect(r.ok).toBe(false);
    s = apply(s, 0, { kind: "play-card", instanceId: atk, pitchInstanceIds: [fodder] });
    expect(s.pendingDecision?.kind).toBe("defend");
    // and on the defending side's reaction window
    const react = giveCard(s, 1, "REACT"); // cost 0 → 1
    const generic1 = giveCard(s, 1, "GENERIC_CARD");
    player(s, 1).flags.costMoreThisTurn = 1;
    s = apply(s, 1, { kind: "defend", instanceIds: [] });
    s = apply(s, 0, { kind: "pass" });
    expect(s.pendingDecision?.kind).toBe("defense-reaction");
    const bad = applyIntent(s, 1, { kind: "play-card", instanceId: react, pitchInstanceIds: [] });
    expect(bad.ok).toBe(false);
    const good = applyIntent(s, 1, { kind: "play-card", instanceId: react, pitchInstanceIds: [generic1] });
    expect(good.ok).toBe(true);
  });
});

// ── defense reactions from the banished zone ────────────────────────────────

describe("defense reactions from banish", () => {
  it("a trap banished face-down with permission defends from the banished zone", () => {
    let s = makeGame({ deck: ["TRAP", ...Array.from({ length: 39 }, () => "BLOCK3")] });
    const loader = giveCard(s, 1, "LOADER");
    // seat 1 loads a trap into their banished zone first (on seat 0's turn? use their own turn)
    s = passTurn(s, 0);
    expect(s.activePlayer).toBe(1);
    s = playAndResolve(s, 1, loader);
    const trap = player(s, 1).banish.find((c) => c.cardId === "TRAP")!;
    expect(trap.faceDown).toBe(true);
    expect(s.log.some((entry) => entry.publicText?.includes("Test Trap is banished"))).toBe(false);
    expect(s.log.some((entry) => entry.publicText === "A face-down card is banished from deck"))
      .toBe(true);
    expect(player(s, 1).flags.faceDownSelfBanishTriggered).toBeUndefined();
    // seat 0's turn: attack; the trap is a legal defender from banish
    s = passTurn(s, 1);
    expect(s.activePlayer).toBe(0);
    s = declareAttackFromHand(s, 0, "ATK4");
    s = openReactionWindow(s, 1);
    const legal = legalIntents(s, 1);
    expect(legal.some((i) =>
      i.kind === "play-from-zone" && i.zone === "banish" && i.instanceId === trap.instanceId,
    )).toBe(true);
    s = apply(s, 1, {
      kind: "play-from-zone",
      zone: "banish",
      instanceId: trap.instanceId,
      pitchInstanceIds: [],
    });
    // resolves as a defending card, turned face up
    for (let i = 0; i < 6 && s.pendingDecision; i++) s = apply(s, s.pendingDecision.player, { kind: "pass" });
    expect(player(s, 1).life).toBe(19); // 4 − 3 = 1 through
    s = apply(s, 0, { kind: "close-chain" });
    expect(player(s, 1).graveyard.some((c) => c.cardId === "TRAP")).toBe(true);
  });
});

// ── putOnDeckTop replacement ────────────────────────────────────────────────

describe("putOnDeckTop", () => {
  it("puts on top normally, on the bottom under the topDeckToBottom flag", () => {
    let s = makeGame();
    player(s, 0).graveyard.push({ instanceId: s.nextInstanceId++, cardId: "BLOCK3", owner: 0 });
    const z1 = giveCard(s, 0, "ZAPTOP");
    const z2 = giveCard(s, 0, "ZAPTOP");
    s = playAndResolve(s, 0, z1);
    expect(player(s, 0).deck[0]?.cardId).toBe("BLOCK3");
    player(s, 0).flags.topDeckToBottom = true;
    player(s, 0).graveyard.push({ instanceId: s.nextInstanceId++, cardId: "ATK4", owner: 0 });
    s = playAndResolve(s, 0, z2);
    expect(player(s, 0).deck[0]?.cardId).toBe("BLOCK3"); // unchanged
    expect(player(s, 0).deck[player(s, 0).deck.length - 1]?.cardId).toBe("ATK4");
  });
});

// ── tempDefense ─────────────────────────────────────────────────────────────

describe("tempDefense", () => {
  it("applies per-card and expires when the chain closes", () => {
    let s = makeGame();
    const block = giveCard(s, 1, "BLOCK3");
    s = declareAttackFromHand(s, 0, "ATK4");
    const live = player(s, 1).hand.find((c) => c.instanceId === block)!;
    live.tempDefense = -2; // stamped setup
    s = apply(s, 1, { kind: "defend", instanceIds: [block] });
    for (let i = 0; i < 6 && s.pendingDecision; i++) s = apply(s, s.pendingDecision.player, { kind: "pass" });
    expect(player(s, 1).life).toBe(17); // 4 − (3 − 2) = 3 through
  });
});
