import { engineRuntime } from "../engineRuntime.js";
import { describe, expect, it } from "vitest";
import type { CardData, Decklist, EquipmentSlot, GameIntent } from "@fyendal/shared";
import { applyIntent, legalIntents, projectStateFor } from "../index.js";
import type { CardScript } from "../scripts.js";
import { createGame as createGameState, type GameStateInternal } from "../runtimeState.js";
import type { CardInstance, PlayerState } from "../state.js";
import { drawUpTo, startTurn } from "../turn.js";

// ── SAZ mechanics: arrows & bows, putIntoArsenal/onEnterArsenal, per-instance
// granted keywords/tempPower, fromArsenal links, unpreventable, and
// defense-reaction restrictions. Fixture style mirrors sen-mechanics.test.ts.

const cards: Record<string, CardData> = {
  HERO_A: { id: "HERO_A", name: "Hero A", cardType: "hero", classes: ["ranger"], intellect: 4, life: 20, text: "" },
  HERO_B: { id: "HERO_B", name: "Hero B", cardType: "hero", classes: ["brute"], intellect: 4, life: 20, text: "" },
  SWORD: { id: "SWORD", name: "Test Sword", cardType: "weapon", subtypes: ["sword", "1h"], attack: 3, text: "" },
  BOW: { id: "BOW", name: "Test Bow", cardType: "weapon", subtypes: ["bow", "2h"], text: "" },
  QUIVER: { id: "QUIVER", name: "Test Quiver", cardType: "equipment", subtypes: ["quiver"], defense: 0, text: "Whenever an arrow is put face up into your arsenal from your deck, put an aim counter on it" },
  ARROW: { id: "ARROW", name: "Test Arrow", cardType: "action", subtypes: ["arrow", "attack"], classes: ["ranger"], pitch: 1, cost: 0, attack: 3, defense: 2, text: "" },
  ARROW_ETB: { id: "ARROW_ETB", name: "Test Trigger Arrow", cardType: "action", subtypes: ["arrow", "attack"], classes: ["ranger"], pitch: 1, cost: 0, attack: 3, defense: 2, text: "When this is put face-up into your arsenal, it gets +2{p} this turn" },
  ATK4: { id: "ATK4", name: "Attack Four", cardType: "action", subtypes: ["attack"], classes: ["generic"], pitch: 1, cost: 0, attack: 4, defense: 3, text: "" },
  BLOCK3: { id: "BLOCK3", name: "Blocker", cardType: "action", subtypes: [], classes: ["generic"], pitch: 3, cost: 0, attack: 0, defense: 3, text: "" },
  REACT: { id: "REACT", name: "Test Defense Reaction", cardType: "defense-reaction", classes: ["generic"], pitch: 3, cost: 0, defense: 3, text: "" },
  WARD2: { id: "WARD2", name: "Ward Aura Two", cardType: "token", classes: ["illusionist"], keywords: ["Ward 2"], text: "Ward 2" },
  MELODY: { id: "MELODY", name: "Test Melody", cardType: "action", subtypes: ["aura"], classes: ["generic"], pitch: 1, cost: 0, defense: 2, text: "Destroy this and prevent 4 damage" },
  UNPREV: { id: "UNPREV", name: "Unpreventable Attack", cardType: "action", subtypes: ["attack"], classes: ["generic"], pitch: 1, cost: 0, attack: 5, defense: 3, text: "Damage that would be dealt by this can't be prevented" },
  NOREACT: { id: "NOREACT", name: "No Reactions Attack", cardType: "action", subtypes: ["attack"], classes: ["generic"], pitch: 1, cost: 0, attack: 4, defense: 3, text: "Defense reactions can't be played to this chain link" },
  LOADER: { id: "LOADER", name: "Test Loader", cardType: "weapon", subtypes: ["bow", "2h"], text: "Action: put the first arrow of your deck into your arsenal" },
  ARS_PUMP: { id: "ARS_PUMP", name: "Test Arsenal Pump", cardType: "instant", classes: ["generic"], pitch: 3, cost: 0, text: "The next attack action card you play from arsenal this turn gains +3{p}" },
  ARS_REACT_LOCK: { id: "ARS_REACT_LOCK", name: "Test Reaction Lock", cardType: "instant", classes: ["generic"], pitch: 3, cost: 0, text: "Your next attack this turn: defense reactions can't be played from arsenal this chain link" },
};

const scripts: Record<string, CardScript> = {
  QUIVER: {
    onEnterArsenal(ctx, card, from) {
      if (from !== "deck") return;
      if (!(ctx.cardData(card.cardId).subtypes ?? []).includes("arrow")) return;
      ctx.addCounter(card.instanceId, "aim", 1);
    },
  },
  ARROW_ETB: {
    onEnterArsenal(ctx) {
      ctx.addCardTempPower(ctx.self.instanceId, 2);
    },
  },
  UNPREV: {
    onAttackDeclared(ctx) {
      ctx.setFlag("link", "unpreventable", true);
    },
  },
  MELODY: {
    fixedDamagePrevention: { amount: 4, destroySource: true },
  },
  NOREACT: {
    onAttackDeclared(ctx) {
      ctx.setFlag("link", "noDefenseReactions", true);
    },
  },
  LOADER: {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      label: "Load the first arrow from the deck",
      onActivate(ctx) {
        const p = ctx.state.players[ctx.seat]!;
        const arrow = p.deck.find((c) => (ctx.cardData(c.cardId).subtypes ?? []).includes("arrow"));
        if (arrow) ctx.putIntoArsenal(arrow.instanceId, "deck");
      },
    },
  },
  ARS_PUMP: {
    onPlay(ctx) {
      ctx.addModifier({ scope: "next-attack", attack: 3, appliesTo: "attack-action", appliesToFromArsenal: true });
    },
  },
  ARS_REACT_LOCK: {
    onPlay(ctx) {
      ctx.addModifier({ scope: "next-attack", noDefenseReactionsFromArsenal: true });
    },
  },
};

interface GameOpts {
  weapons?: [string, string];
  p0equipment?: Partial<Record<EquipmentSlot, string>>;
  p1equipment?: Partial<Record<EquipmentSlot, string>>;
  deck?: string[];
}

function makeGame(opts: GameOpts = {}): GameStateInternal {
  const d = opts.deck ?? Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? "ATK4" : "BLOCK3"));
  const decklist = (i: 0 | 1): Decklist => ({
    heroId: i === 0 ? "HERO_A" : "HERO_B",
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

function giveArsenal(state: GameStateInternal, seat: number, cardId: string): CardInstance {
  const c: CardInstance = { instanceId: state.nextInstanceId++, cardId, owner: seat };
  player(state, seat).arsenal.push(c);
  return c;
}

function giveBoard(state: GameStateInternal, seat: number, cardId: string): number {
  const p = player(state, seat);
  const c: CardInstance = { instanceId: state.nextInstanceId++, cardId, owner: seat };
  p.board.push(c);
  return c.instanceId;
}

function apply(s: GameStateInternal, seat: number, intent: GameIntent): GameStateInternal {
  const r = applyIntent(s, seat, intent);
  expect(r.ok && r.ok ? true : r.error).toBe(true);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

/** Play a card from hand and pass through any priority windows until it resolved. */
function playAndResolve(s: GameStateInternal, seat: number, instanceId: number): GameStateInternal {
  let cur = apply(s, seat, { kind: "play-card", instanceId, pitchInstanceIds: [] });
  for (let i = 0; i < 8 && cur.pendingDecision; i++) {
    const pd = cur.pendingDecision;
    if (pd.kind === "choose-target") break;
    cur = apply(cur, pd.player, { kind: "pass" });
  }
  return cur;
}

/** Declare an attack from hand; lands on the defender's defend decision. */
function declareAttackFromHand(s: GameStateInternal, seat: number, cardId: string): GameStateInternal {
  const id = giveCard(s, seat, cardId);
  let next = apply(s, seat, { kind: "play-card", instanceId: id, pitchInstanceIds: [] });
  for (let i = 0; i < 6 && next.pendingDecision?.kind === "priority-window"; i++) {
    next = apply(next, next.pendingDecision.player, { kind: "pass" });
  }
  expect(next.pendingDecision?.kind).toBe("defend");
  return next;
}

/** Declare an attack from the arsenal; lands on the defender's defend decision. */
function declareAttackFromArsenal(s: GameStateInternal, seat: number, card: CardInstance): GameStateInternal {
  let next = apply(s, seat, { kind: "play-from-arsenal", instanceId: card.instanceId, pitchInstanceIds: [] });
  for (let i = 0; i < 6 && next.pendingDecision?.kind === "priority-window"; i++) {
    next = apply(next, next.pendingDecision.player, { kind: "pass" });
  }
  expect(next.pendingDecision?.kind).toBe("defend");
  return next;
}

/** Defend with nothing and pass both reaction windows. */
function noDefendResolve(s: GameStateInternal, defenderSeat: number): GameStateInternal {
  let cur = apply(s, defenderSeat, { kind: "defend", instanceIds: [] });
  for (let i = 0; i < 6 && cur.pendingDecision && cur.pendingDecision.kind !== "choose-target"; i++) {
    cur = apply(cur, cur.pendingDecision.player, { kind: "pass" });
  }
  return cur;
}

function openReactionWindow(s: GameStateInternal, seat: number): GameStateInternal {
  // after the defend decision: attacker passes, defender's reaction window
  let cur = apply(s, seat, { kind: "defend", instanceIds: [] });
  cur = apply(cur, cur.pendingDecision!.player, { kind: "pass" });
  expect(cur.pendingDecision?.kind).toBe("defense-reaction");
  return cur;
}

// ── arrows (CR 8.2.6a) ─────────────────────────────────────────────────────

describe("arrows", () => {
  it("an arrow in hand cannot be played", () => {
    const s = makeGame({ weapons: ["BOW", "SWORD"] });
    const id = giveCard(s, 0, "ARROW");
    expect(legalIntents(s, 0).some((i) => i.kind === "play-card" && i.instanceId === id)).toBe(false);
    const r = applyIntent(s, 0, { kind: "play-card", instanceId: id, pitchInstanceIds: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/arsenal/);
  });

  it("an arrow in arsenal cannot be played without a bow", () => {
    const s = makeGame(); // SWORD, not a bow
    const arrow = giveArsenal(s, 0, "ARROW");
    expect(
      legalIntents(s, 0).some((i) => i.kind === "play-from-arsenal" && i.instanceId === arrow.instanceId),
    ).toBe(false);
    const r = applyIntent(s, 0, { kind: "play-from-arsenal", instanceId: arrow.instanceId, pitchInstanceIds: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/bow/);
  });

  it("an arrow in arsenal attacks while controlling a bow", () => {
    const s = makeGame({ weapons: ["BOW", "SWORD"] });
    const arrow = giveArsenal(s, 0, "ARROW");
    const next = declareAttackFromArsenal(s, 0, arrow);
    expect(next.chain).toHaveLength(1);
    expect(next.chain[0]!.attackingCard.cardId).toBe("ARROW");
    expect(projectStateFor(next, 0).chain[0]!.attackValue).toBe(3);
  });
});

// ── putIntoArsenal / onEnterArsenal ─────────────────────────────────────────

describe("putIntoArsenal", () => {
  it("moves the card and fires onEnterArsenal on the card and on permanents", () => {
    const s = makeGame({ weapons: ["LOADER", "SWORD"], deck: ["ARROW_ETB", ...Array.from({ length: 39 }, () => "BLOCK3")] });
    // the quiver lives in a weapon slot — swap it in alongside the loader
    const quiver: CardInstance = { instanceId: s.nextInstanceId++, cardId: "QUIVER", owner: 0 };
    player(s, 0).weapons.push(quiver);
    const loader = player(s, 0).weapons.find((c) => c.cardId === "LOADER")!;
    let next = apply(s, 0, { kind: "activate-ability", sourceInstanceId: loader.instanceId, pitchInstanceIds: [] });
    next = apply(next, next.priorityPlayer, { kind: "pass" });
    next = apply(next, next.priorityPlayer, { kind: "pass" });
    const arrow = player(next, 0).arsenal.find((c) => c.cardId === "ARROW_ETB");
    expect(arrow).toBeTruthy();
    expect(arrow!.tempPower).toBe(2); // the card's own onEnterArsenal
    expect(arrow!.counters?.aim).toBe(1); // the quiver's onEnterArsenal
    expect(player(next, 0).deck.some((c) => c.cardId === "ARROW_ETB")).toBe(false);
  });
});

// ── per-instance grants (grantedKeywords / tempPower) ──────────────────────

describe("per-instance grants", () => {
  it("granted dominate constrains the defend step", () => {
    const s = makeGame({ weapons: ["BOW", "SWORD"] });
    const arrow = giveArsenal(s, 0, "ARROW");
    arrow.grantedKeywords = ["dominate"];
    const next = declareAttackFromArsenal(s, 0, arrow);
    const b1 = giveCard(next, 1, "BLOCK3");
    const b2 = giveCard(next, 1, "BLOCK3");
    const r = applyIntent(next, 1, { kind: "defend", instanceIds: [b1, b2] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Dominate/);
  });

  it("tempPower adds to the attack and expires at end of turn", () => {
    let s = makeGame({ weapons: ["BOW", "SWORD"] });
    const arrow = giveArsenal(s, 0, "ARROW");
    arrow.tempPower = 2;
    s = declareAttackFromArsenal(s, 0, arrow);
    expect(projectStateFor(s, 0).chain[0]!.attackValue).toBe(5); // 3 + 2
    s = noDefendResolve(s, 1);
    // end the turn: the arrow is back... it attacked, so it is on the chain —
    // use a fresh unplayed arrow to check expiry
    const stashed = giveArsenal(s, 0, "ARROW_ETB");
    stashed.tempPower = 1;
    s = apply(s, 0, { kind: "pass" });
    if (s.pendingDecision?.kind === "arsenal") s = apply(s, s.pendingDecision.player, { kind: "pass" });
    const live = player(s, 0).arsenal.find((c) => c.instanceId === stashed.instanceId);
    expect(live?.tempPower).toBeUndefined();
  });
});

// ── fromArsenal links and appliesToFromArsenal ─────────────────────────────

describe("played from arsenal", () => {
  it("an appliesToFromArsenal modifier buffs arsenal plays only", () => {
    let s = makeGame({ weapons: ["BOW", "SWORD"] });
    const pump = giveCard(s, 0, "ARS_PUMP");
    const arrow = giveArsenal(s, 0, "ARROW");
    s = playAndResolve(s, 0, pump);
    // a hand attack does not pick it up (and does not consume it)
    s = declareAttackFromHand(s, 0, "ATK4");
    expect(projectStateFor(s, 0).chain[0]!.attackValue).toBe(4);
    expect(s.chain[0]!.flags.fromArsenal).toBeUndefined();
    s = noDefendResolve(s, 1);
    // the arsenal arrow does
    player(s, 0).actionPoints = 1; // the hand attack spent the turn's AP
    s = declareAttackFromArsenal(s, 0, arrow);
    expect(s.chain[1]!.flags.fromArsenal).toBe(true);
    expect(projectStateFor(s, 0).chain[1]!.attackValue).toBe(6); // 3 + 3
  });
});

// ── unpreventable ───────────────────────────────────────────────────────────

describe("unpreventable", () => {
  it("leaves prevention shields untouched but destroys Ward without reducing damage", () => {
    let s = makeGame();
    const firstWardId = giveBoard(s, 1, "WARD2");
    const secondWardId = giveBoard(s, 1, "WARD2");
    player(s, 1).flags.preventNextDamage = 5;
    s = declareAttackFromHand(s, 0, "UNPREV");
    s = noDefendResolve(s, 1);
    expect(s.pendingDecision).toMatchObject({
      player: 1,
      chooseHook: "ward",
      options: [`destroy ${firstWardId}`, `destroy ${secondWardId}`],
    });
    expect(s.pendingDecision?.prompt).toContain("can't be prevented");
    s = apply(s, 1, { kind: "choose", optionId: `destroy ${firstWardId}` });
    expect(s.pendingDecision).toMatchObject({
      player: 1,
      chooseHook: "ward",
      options: [`destroy ${secondWardId}`],
    });
    s = apply(s, 1, { kind: "choose", optionId: `destroy ${secondWardId}` });
    expect(player(s, 1).life).toBe(15); // full 5 still gets through
    expect(player(s, 1).flags.preventNextDamage).toBe(5); // shield untouched
    expect(player(s, 1).board.some((c) => c.cardId === "WARD2")).toBe(false);
  });

  it("still destroys a fixed-prevention source without reducing the damage", () => {
    let s = makeGame();
    giveBoard(s, 1, "MELODY");
    s = declareAttackFromHand(s, 0, "UNPREV");
    s = noDefendResolve(s, 1);
    expect(player(s, 1).life).toBe(15);
    expect(player(s, 1).board.some((c) => c.cardId === "MELODY")).toBe(false);
    expect(player(s, 1).graveyard.some((c) => c.cardId === "MELODY")).toBe(true);
  });
});

// ── defense-reaction restrictions ──────────────────────────────────────────

describe("defense-reaction restrictions", () => {
  it("noDefenseReactions blocks all defense reactions on the link", () => {
    let s = makeGame();
    const react = giveCard(s, 1, "REACT");
    s = declareAttackFromHand(s, 0, "NOREACT");
    s = openReactionWindow(s, 1);
    expect(
      legalIntents(s, 1).some((i) => i.kind === "play-card" && i.instanceId === react),
    ).toBe(false);
    const r = applyIntent(s, 1, { kind: "play-card", instanceId: react, pitchInstanceIds: [] });
    expect(r.ok).toBe(false);
  });

  it("noDefenseReactionsFromArsenal blocks arsenal defense reactions only", () => {
    let s = makeGame();
    const lock = giveCard(s, 0, "ARS_REACT_LOCK");
    const handReact = giveCard(s, 1, "REACT");
    const arsenalReact = giveArsenal(s, 1, "REACT");
    s = playAndResolve(s, 0, lock);
    s = declareAttackFromHand(s, 0, "ATK4");
    s = openReactionWindow(s, 1);
    const legal = legalIntents(s, 1);
    // the hand copy is still playable; the arsenal copy is not
    expect(legal.some((i) => i.kind === "play-card" && i.instanceId === handReact)).toBe(true);
    expect(legal.some((i) => i.kind === "play-from-arsenal" && i.instanceId === arsenalReact.instanceId)).toBe(false);
    const r = applyIntent(s, 1, { kind: "play-from-arsenal", instanceId: arsenalReact.instanceId, pitchInstanceIds: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/arsenal/);
  });
});
