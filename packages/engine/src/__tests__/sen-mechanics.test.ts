import { engineRuntime } from "../engineRuntime.js";
import { describe, expect, it } from "vitest";
import type { CardData, Decklist, EquipmentSlot, GameIntent } from "@fyendal/shared";
import { actionCandidates, applyIntent, legalIntents, projectStateFor } from "../index.js";
import type { CardScript } from "../scripts.js";
import { createGame as createGameState, type GameStateInternal } from "../runtimeState.js";
import type { CardInstance, PlayerState } from "../state.js";
import { destroyPermanent } from "../zoneMoves.js";
import { drawUpTo, startTurn } from "../turn.js";

// ── fixture cards ────────────────────────────────────────────────────────────

const cards: Record<string, CardData> = {
  HERO_A: { id: "HERO_A", name: "Hero A", cardType: "hero", classes: ["warrior"], intellect: 4, life: 20, text: "" },
  HERO_B: { id: "HERO_B", name: "Hero B", cardType: "hero", classes: ["brute"], intellect: 4, life: 20, text: "" },
  HERO_CHI: { id: "HERO_CHI", name: "Chi Hero", cardType: "hero", classes: ["mystic"], intellect: 4, life: 20, text: "Instant — {c}{c}{c}: Gain 1 life" },
  HERO_DISCOUNT: { id: "HERO_DISCOUNT", name: "Discount Hero", cardType: "hero", classes: ["mystic"], intellect: 4, life: 20, text: "Your ward aura attacks cost {r} less" },
  SWORD: { id: "SWORD", name: "Test Sword", cardType: "weapon", subtypes: ["sword", "1h"], attack: 3, text: "" },
  SCROLL: { id: "SCROLL", name: "Test Scroll", cardType: "weapon", subtypes: ["scroll", "2h"], text: "Auras you control with ward are weapons" },
  CHI3: { id: "CHI3", name: "Test Inner Chi", cardType: "resource", subtypes: ["chi"], classes: ["mystic"], pitch: 3, text: "" },
  RED1: { id: "RED1", name: "Red One", cardType: "action", subtypes: [], classes: ["generic"], pitch: 1, cost: 0, attack: 0, defense: 3, text: "" },
  BLUE3: { id: "BLUE3", name: "Blue Three", cardType: "action", subtypes: [], classes: ["generic"], pitch: 3, cost: 0, attack: 0, defense: 3, text: "" },
  COST2: { id: "COST2", name: "Costly Trick", cardType: "action", subtypes: [], classes: ["generic"], pitch: 1, cost: 2, attack: 0, defense: 2, text: "" },
  COST4: { id: "COST4", name: "Big Trick", cardType: "action", subtypes: [], classes: ["generic"], pitch: 1, cost: 4, attack: 0, defense: 2, text: "" },
  ATK5: { id: "ATK5", name: "Attack Five", cardType: "action", subtypes: ["attack"], classes: ["generic"], pitch: 1, cost: 0, attack: 5, defense: 3, text: "" },
  ATK2: { id: "ATK2", name: "Attack Two", cardType: "action", subtypes: ["attack"], classes: ["generic"], pitch: 1, cost: 0, attack: 2, defense: 3, text: "" },
  BIG6: { id: "BIG6", name: "Big Six", cardType: "action", subtypes: ["attack"], classes: ["generic"], pitch: 1, cost: 0, attack: 6, defense: 2, text: "" },
  ILL6: { id: "ILL6", name: "Illusion Six", cardType: "action", subtypes: ["attack"], classes: ["illusionist"], pitch: 1, cost: 0, attack: 6, defense: 2, text: "" },
  PHANT: { id: "PHANT", name: "Phantasm Attack", cardType: "action", subtypes: ["attack"], classes: ["illusionist"], pitch: 3, cost: 0, attack: 5, defense: 3, keywords: ["Phantasm"], text: "Phantasm" },
  OVER: { id: "OVER", name: "Overpower Attack", cardType: "action", subtypes: ["attack"], classes: ["generic"], pitch: 1, cost: 0, attack: 4, defense: 3, keywords: ["Overpower"], text: "Overpower" },
  OVERFLAG: { id: "OVERFLAG", name: "Granted Overpower", cardType: "action", subtypes: ["attack"], classes: ["generic"], pitch: 1, cost: 0, attack: 4, defense: 3, text: "Gains overpower when played" },
  BLOCK3: { id: "BLOCK3", name: "Blocker", cardType: "action", subtypes: [], classes: ["generic"], pitch: 3, cost: 0, attack: 0, defense: 3, text: "" },
  BLOCKCARD: { id: "BLOCKCARD", name: "Block Card", cardType: "block", classes: ["generic"], pitch: 3, defense: 3, text: "" },
  GUARDMAX: { id: "GUARDMAX", name: "Small Guard", cardType: "defense-reaction", classes: ["generic"], pitch: 3, cost: 0, defense: 3, text: "This can only defend an attack with 3 or less base {p}" },
  TRANSC: { id: "TRANSC", name: "Test Transcend", cardType: "instant", classes: ["mystic"], pitch: 3, cost: 0, keywords: ["Transcend"], backId: "CHI3", text: "Transcend" },
  ZAP3: { id: "ZAP3", name: "Test Zap", cardType: "instant", classes: ["generic"], pitch: 3, cost: 0, text: "Deal 3 damage to the opposing hero" },
  ARCZAP3: { id: "ARCZAP3", name: "Test Arcane Zap", cardType: "instant", classes: ["generic"], pitch: 3, cost: 0, text: "Deal 3 arcane damage to the opposing hero" },
  MAKER: { id: "MAKER", name: "Test Maker", cardType: "instant", classes: ["generic"], pitch: 3, cost: 0, text: "Create a Test Token" },
  TOKEN: { id: "TOKEN", name: "Test Token", cardType: "token", classes: ["generic"], text: "" },
  WARD1: { id: "WARD1", name: "Ward Aura One", cardType: "token", classes: ["illusionist"], keywords: ["Ward 1"], text: "Ward 1" },
  WARD2: { id: "WARD2", name: "Ward Aura Two", cardType: "token", classes: ["illusionist"], keywords: ["Ward 2"], text: "Ward 2" },
  HELM: { id: "HELM", name: "Test Helm", cardType: "equipment", subtypes: ["head"], defense: 1, keywords: ["Blade Break"], text: "Blade Break" },
  CHEST: { id: "CHEST", name: "Test Chest", cardType: "equipment", subtypes: ["chest"], defense: 0, text: "" },
  ARMS: { id: "ARMS", name: "Test Arms", cardType: "equipment", subtypes: ["arms"], defense: 1, text: "" },
  LEGS: { id: "LEGS", name: "Test Legs", cardType: "equipment", subtypes: ["legs"], defense: 1, text: "" },
  BUCKLER: { id: "BUCKLER", name: "Test Buckler", cardType: "equipment", subtypes: ["off-hand"], defense: 2, text: "" },
  CLOAK: { id: "CLOAK", name: "Cloaked Arms", cardType: "equipment", subtypes: ["arms"], defense: 2, keywords: ["Cloaked", "Ward 2"], text: "Cloaked. Instant — {r}, turn this face-up: gain 1 life. Ward 2" },
  WATCHER: { id: "WATCHER", name: "Watcher Legs", cardType: "equipment", subtypes: ["legs"], defense: 0, text: "Reacts to lost attacks" },
  BARRIER: { id: "BARRIER", name: "Barrier Helm", cardType: "equipment", subtypes: ["head"], defense: 1, keywords: ["Arcane Barrier 1"], text: "Arcane Barrier 1" },
  ALLY: { id: "ALLY", name: "Test Ally", cardType: "action", subtypes: ["ally"], classes: ["generic"], cost: 0, attack: 2, defense: 3, life: 3, text: "Action — {t}: Attack" },
  ZAPAL: { id: "ZAPAL", name: "Test Ally Zap", cardType: "instant", classes: ["generic"], pitch: 3, cost: 0, text: "Deal 2 damage to an opposing ally" },
  ZAPALARC: { id: "ZAPALARC", name: "Test Ally Arcane Zap", cardType: "instant", classes: ["generic"], pitch: 3, cost: 0, text: "Deal 2 arcane damage to an opposing ally" },
  DIM: { id: "DIM", name: "Diminish", cardType: "instant", classes: ["generic"], pitch: 3, cost: 0, text: "A defending attack action card gets -1 power" },
  ALLYZAP: { id: "ALLYZAP", name: "Test Zapping Ally", cardType: "action", subtypes: ["ally"], classes: ["generic"], cost: 0, life: 3, text: "When this enters, deal 1 damage to an opposing ally" },
};

const scripts: Record<string, CardScript> = {
  HERO_CHI: {
    activated: {
      cost: 0,
      chiCost: 3,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      oncePerTurn: true,
      onActivate(ctx) {
        ctx.gainLife(ctx.seat, 1);
      },
    },
  },
  HERO_DISCOUNT: {
    modifyAttackActivationCost(ctx, attacker, baseCost) {
      const data = ctx.cardData(attacker.cardId);
      const isWardAura = (data.keywords ?? []).some((k) => /^ward \d+$/i.test(k.trim()));
      return isWardAura ? baseCost - 1 : baseCost;
    },
  },
  SCROLL: {
    grantsAuraAttack: { cost: 1, goAgainWithPowerCounter: true },
  },
  TRANSC: {
    onPlay(ctx) {
      ctx.transcend();
    },
  },
  ZAP3: {
    onPlay(ctx) {
      ctx.dealDamage(ctx.seat === 0 ? 1 : 0, 3);
    },
  },
  ARCZAP3: {
    onPlay(ctx) {
      ctx.dealDamage(ctx.seat === 0 ? 1 : 0, 3, { arcane: true });
    },
  },
  MAKER: {
    onPlay(ctx) {
      ctx.createToken("TOKEN");
    },
  },
  OVERFLAG: {
    onAttackDeclared(ctx) {
      ctx.setFlag("link", "overpower", true);
    },
  },
  GUARDMAX: {
    canDefend(ctx) {
      const link = ctx.link;
      if (!link) return false;
      return (ctx.cardData(link.attackingCard.cardId).attack ?? 0) <= 3;
    },
  },
  WATCHER: {
    onFriendlyAttackLost(ctx, card, cause) {
      ctx.setFlag("player", `lost:${cause}`, true);
      ctx.setFlag("player", `lostCard:${card.cardId}`, true);
    },
  },
  CLOAK: {
    activated: {
      cost: 1,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      turnsFaceUp: true,
      onActivate(ctx) {
        ctx.gainLife(ctx.seat, 1);
      },
    },
  },
  ALLY: {
    activated: { cost: 0, isAttack: true, goAgain: false, tap: true },
  },
  ZAPAL: {
    onPlay(ctx) {
      const opp = ctx.state.players[ctx.seat === 0 ? 1 : 0]!;
      const ally = opp.board.find((c) => c.cardId === "ALLY");
      if (ally) ctx.dealDamage(opp.seat, 2, { targetAllyId: ally.instanceId });
    },
  },
  ZAPALARC: {
    onPlay(ctx) {
      const opp = ctx.state.players[ctx.seat === 0 ? 1 : 0]!;
      const ally = opp.board.find((c) => c.cardId === "ALLY");
      if (ally) ctx.dealDamage(opp.seat, 2, { targetAllyId: ally.instanceId, arcane: true });
    },
  },
  DIM: {
    onPlay(ctx) {
      const defender = ctx.link?.defendingCards.find((card) => card.cardId === "BIG6");
      if (defender) ctx.addCardTempPower(defender.instanceId, -1);
    },
  },
  ALLYZAP: {
    onPlay(ctx) {
      const opp = ctx.state.players[ctx.seat === 0 ? 1 : 0]!;
      const ally = opp.board.find((c) => c.cardId === "ALLY");
      if (ally) ctx.dealDamage(opp.seat, 1, { targetAllyId: ally.instanceId });
    },
  },
};

// ── harness ──────────────────────────────────────────────────────────────────

interface GameOpts {
  heroes?: [string, string];
  weapons?: [string, string];
  p0equipment?: Partial<Record<EquipmentSlot, string>>;
  p1equipment?: Partial<Record<EquipmentSlot, string>>;
  deck?: string[];
}

function makeGame(opts: GameOpts = {}): GameStateInternal {
  const d = opts.deck ?? Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? "ATK2" : "BLOCK3"));
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

function giveBoard(state: GameStateInternal, seat: number, cardId: string, counters?: Record<string, number>): number {
  const p = player(state, seat);
  const c: CardInstance = { instanceId: state.nextInstanceId++, cardId, owner: seat, ...(counters ? { counters } : {}) };
  // living permanents start at their base life (mirrors the arena stamping)
  const life = cards[cardId]?.life;
  if (life !== undefined) c.life = life;
  p.board.push(c);
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

/** Play a card from hand and pass through any priority windows until it resolved. */
function playAndResolve(s: GameStateInternal, seat: number, instanceId: number, pitch: number[] = []): GameStateInternal {
  let cur = apply(s, seat, { kind: "play-card", instanceId, pitchInstanceIds: pitch });
  for (let i = 0; i < 8 && cur.pendingDecision; i++) {
    const pd = cur.pendingDecision;
    if (pd.kind === "choose-target") break; // a prevention/scripted decision stays open
    cur = apply(cur, pd.player, { kind: "pass" });
  }
  return cur;
}

/** Declare an attack from hand; lands on the defender's defend decision
 *  (passing through any attack-declared priority windows first). */
function declareAttack(s: GameStateInternal, seat: number, cardId: string): GameStateInternal {
  const id = giveCard(s, seat, cardId);
  let next = apply(s, seat, { kind: "play-card", instanceId: id, pitchInstanceIds: [] });
  for (let i = 0; i < 6 && next.pendingDecision?.kind === "priority-window"; i++) {
    next = apply(next, next.pendingDecision.player, { kind: "pass" });
  }
  expect(next.pendingDecision?.kind).toBe("defend");
  return next;
}

/** Defend with nothing and pass both reaction windows; lands after link resolution (or on a ward decision). */
function noDefendResolve(s: GameStateInternal, defenderSeat: number): GameStateInternal {
  let cur = apply(s, defenderSeat, { kind: "defend", instanceIds: [] });
  for (let i = 0; i < 6 && cur.pendingDecision && cur.pendingDecision.kind !== "choose-target"; i++) {
    cur = apply(cur, cur.pendingDecision.player, { kind: "pass" });
  }
  return cur;
}

// ── chi ──────────────────────────────────────────────────────────────────────

describe("chi points", () => {
  it("pitching a chi-subtype card grants chi instead of resources, spent before resources", () => {
    let s = makeGame();
    const chi = giveCard(s, 0, "CHI3");
    const red = giveCard(s, 0, "RED1");
    const cost2 = giveCard(s, 0, "COST2");
    s = playAndResolve(s, 0, cost2, [red, chi]);
    // paid 2: chi first (3 chi in, 2 out), the red resource stays floating
    expect(player(s, 0).chi).toBe(1);
    expect(player(s, 0).resources).toBe(1);
    expect(player(s, 0).flags["pitchedPitch:3"]).toBe(1);
    expect(player(s, 0).flags["pitchedPitch:1"]).toBe(1);
    expect(player(s, 0).flags.pitchedChiCount).toBe(1);
    expect(s.log.some((l) =>
      l.publicText?.includes("pitches Test Inner Chi (3 chi)") && l.publicText.endsWith("⟦CHI3⟧")
    )).toBe(true);
  });

  it("chi and resources combine to pay a resource cost", () => {
    let s = makeGame();
    const chi = giveCard(s, 0, "CHI3");
    const red = giveCard(s, 0, "RED1");
    const cost4 = giveCard(s, 0, "COST4");
    s = playAndResolve(s, 0, cost4, [chi, red]);
    expect(player(s, 0).chi).toBe(0);
    expect(player(s, 0).resources).toBe(0);
  });

  it("a chi cost may only be pitched for with chi-subtype cards", () => {
    const s = makeGame({ heroes: ["HERO_CHI", "HERO_B"] });
    const red = giveCard(s, 0, "BLUE3"); // non-chi pitch-3
    const heroId = player(s, 0).hero.instanceId;
    // not offered in enumeration: only a non-chi pitch card is available
    const offered = legalIntents(s, 0).filter(
      (i) => i.kind === "activate-ability" && i.sourceInstanceId === heroId,
    );
    expect(offered).toHaveLength(0);
    expect(actionCandidates(s, 0).some(
      (i) => i.kind === "activate-ability" && i.sourceInstanceId === heroId,
    )).toBe(false);
    // and rejected in validation
    const r = applyIntent(s, 0, { kind: "activate-ability", sourceInstanceId: heroId, pitchInstanceIds: [red] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/chi/);
  });

  it("a chi cost is paid from chi pitched on the spot", () => {
    let s = makeGame({ heroes: ["HERO_CHI", "HERO_B"] });
    const chi = giveCard(s, 0, "CHI3");
    const heroId = player(s, 0).hero.instanceId;
    const offered = legalIntents(s, 0).filter(
      (i) => i.kind === "activate-ability" && i.sourceInstanceId === heroId,
    );
    expect(offered.some((i) => i.kind === "activate-ability" && i.pitchInstanceIds.includes(chi))).toBe(true);
    expect(actionCandidates(s, 0).some(
      (i) => i.kind === "activate-ability" && i.sourceInstanceId === heroId,
    )).toBe(true);
    s = apply(s, 0, { kind: "activate-ability", sourceInstanceId: heroId, pitchInstanceIds: [chi] });
    s = apply(s, s.priorityPlayer, { kind: "pass" });
    s = apply(s, s.priorityPlayer, { kind: "pass" });
    expect(player(s, 0).life).toBe(21);
    expect(player(s, 0).flags.lifeGainedThisTurn).toBe(1);
    expect(player(s, 0).chi).toBe(0);
    expect(player(s, 0).resources).toBe(0);
  });

  it("does not advertise an ability while its chi cost is unaffordable", () => {
    const s = makeGame({ heroes: ["HERO_CHI", "HERO_B"] });
    const heroId = player(s, 0).hero.instanceId;
    const advertised = () => actionCandidates(s, 0).some(
      (i) => i.kind === "activate-ability" && i.sourceInstanceId === heroId,
    );

    player(s, 0).chi = 2;
    expect(advertised()).toBe(false);

    player(s, 0).chi = 3;
    expect(advertised()).toBe(true);
  });

  it("floating chi resets with floating resources at end of turn", () => {
    let s = makeGame();
    player(s, 0).chi = 2;
    player(s, 0).resources = 1;
    s = apply(s, 0, { kind: "pass" }); // end phase
    if (s.pendingDecision?.kind === "arsenal") {
      s = apply(s, s.pendingDecision.player, { kind: "pass" });
    }
    expect(player(s, 0).chi).toBe(0);
    expect(player(s, 0).resources).toBe(0);
    expect(player(s, 1).chi).toBe(0);
  });
});

// ── transcend ────────────────────────────────────────────────────────────────

describe("transcend", () => {
  function transcend(s: GameStateInternal): GameStateInternal {
    const id = giveCard(s, 0, "TRANSC");
    return playAndResolve(s, 0, id);
  }

  it("puts the card into its owner's hand flipped and sets transcendedThisTurn", () => {
    let s = makeGame();
    s = transcend(s);
    const t = player(s, 0).hand.find((c) => c.cardId === "TRANSC");
    expect(t?.flipped).toBe(true);
    expect(player(s, 0).flags.transcendedThisTurn).toBe(true);
    expect(player(s, 0).graveyard.some((c) => c.cardId === "TRANSC")).toBe(false);
  });

  it("a flipped card projects as its back face and cannot be played", () => {
    let s = makeGame();
    s = transcend(s);
    const t = player(s, 0).hand.find((c) => c.cardId === "TRANSC")!;
    const view = projectStateFor(s, 0);
    const hv = view.players[0].hand.find((c) => c.instanceId === t.instanceId);
    expect(hv?.cardId).toBe("CHI3"); // back face is public information
    expect(legalIntents(s, 0).some((i) => i.kind === "play-card" && i.instanceId === t.instanceId)).toBe(false);
    const r = applyIntent(s, 0, { kind: "play-card", instanceId: t.instanceId, pitchInstanceIds: [] });
    expect(r.ok).toBe(false);
  });

  it("a transcended card pitches for 3 chi and keeps its back face active", () => {
    let s = makeGame();
    s = transcend(s);
    const t = player(s, 0).hand.find((c) => c.cardId === "TRANSC")!;
    const cost2 = giveCard(s, 0, "COST2");
    s = playAndResolve(s, 0, cost2, [t.instanceId]);
    expect(player(s, 0).chi).toBe(1); // 3 chi in, 2 spent on the cost
    expect(player(s, 0).resources).toBe(0);
    const pitched = player(s, 0).pitch.find((c) => c.cardId === "TRANSC");
    expect(pitched).toBeDefined();
    expect(pitched?.flipped).toBe(true);
    expect(projectStateFor(s, 0).players[0].pitch).toContainEqual(
      expect.objectContaining({ instanceId: t.instanceId, cardId: "CHI3", name: "Test Inner Chi" }),
    );
    expect(s.log.some((entry) => entry.publicText?.includes("pitches Test Inner Chi (3 chi)"))).toBe(true);
  });
});

// ── ward ─────────────────────────────────────────────────────────────────────

describe("typed prevention shields", () => {
  it("an arcane shield ignores physical damage and carries its unused amount", () => {
    let s = makeGame();
    player(s, 1).flags.preventNextArcaneDamage = 5;

    s = playAndResolve(s, 0, giveCard(s, 0, "ZAP3"));
    expect(player(s, 1).life).toBe(17);
    expect(player(s, 1).flags.preventNextArcaneDamage).toBe(5);

    s = playAndResolve(s, 0, giveCard(s, 0, "ARCZAP3"));
    expect(player(s, 1).life).toBe(17);
    expect(player(s, 1).flags.preventNextArcaneDamage).toBe(2);
  });
});

describe("ward", () => {
  it("offers destroy-to-prevent on combat damage; accepting prevents and destroys", () => {
    let s = makeGame();
    const aura = giveBoard(s, 1, "WARD2");
    s = declareAttack(s, 0, "ATK5");
    expect(player(s, 0).flags.attackedWithAttackActionThisTurn).toBe(true);
    expect(player(s, 0).flags["attackedNameCount:attack five"]).toBe(1);
    s = noDefendResolve(s, 1);
    expect(s.pendingDecision?.chooseHook).toBe("ward");
    expect(s.pendingDecision?.player).toBe(1);
    expect(s.pendingDecision?.options).toContain(`destroy ${aura}`);
    s = apply(s, 1, { kind: "choose", optionId: `destroy ${aura}` });
    expect(player(s, 1).life).toBe(17); // 5 - 2 prevented
    expect(player(s, 1).board.some((c) => c.instanceId === aura)).toBe(false);
    expect(s.phase).toBe("action"); // link resolution resumed and finished
  });

  it("ward is mandatory on combat damage: no decline, the source must be destroyed", () => {
    let s = makeGame();
    const aura = giveBoard(s, 1, "WARD2");
    s = declareAttack(s, 0, "ATK5");
    s = noDefendResolve(s, 1);
    expect(s.pendingDecision?.chooseHook).toBe("ward");
    expect(s.pendingDecision?.options).not.toContain("decline");
    // a decline attempt is rejected — ward must be used
    const declined = applyIntent(s, 1, { kind: "choose", optionId: "decline" });
    expect(declined.ok).toBe(false);
    expect(s.pendingDecision?.chooseHook).toBe("ward");
    s = apply(s, 1, { kind: "choose", optionId: `destroy ${aura}` });
    expect(player(s, 1).life).toBe(17); // 5 - 2 prevented
    expect(player(s, 1).board.some((c) => c.instanceId === aura)).toBe(false);
  });

  it("multiple ward sources are destroyed one at a time until the damage is prevented", () => {
    let s = makeGame();
    const a = giveBoard(s, 1, "WARD1");
    const b = giveBoard(s, 1, "WARD1");
    s = declareAttack(s, 0, "ATK5");
    s = noDefendResolve(s, 1);
    s = apply(s, 1, { kind: "choose", optionId: `destroy ${a}` });
    // 4 damage remains and another ward source is still there: re-offered
    expect(s.pendingDecision?.chooseHook).toBe("ward");
    s = apply(s, 1, { kind: "choose", optionId: `destroy ${b}` });
    // no ward sources remain: the rest applies immediately
    expect(s.pendingDecision).toBeNull();
    expect(player(s, 1).life).toBe(17); // 5 - 1 - 1
    expect(s.phase).toBe("action");
  });

  it("ward also applies to effect (non-arcane) damage", () => {
    let s = makeGame();
    const aura = giveBoard(s, 1, "WARD2");
    const zap = giveCard(s, 0, "ZAP3");
    s = playAndResolve(s, 0, zap);
    expect(s.pendingDecision?.chooseHook).toBe("ward");
    s = apply(s, 1, { kind: "choose", optionId: `destroy ${aura}` });
    expect(player(s, 1).life).toBe(19); // 3 - 2
    expect(player(s, 1).board).toHaveLength(0);
  });

  it("effect damage also forces ward: no decline, full prevention chain", () => {
    let s = makeGame();
    const aura = giveBoard(s, 1, "WARD2");
    const zap = giveCard(s, 0, "ZAP3");
    s = playAndResolve(s, 0, zap);
    expect(s.pendingDecision?.chooseHook).toBe("ward");
    expect(s.pendingDecision?.options).not.toContain("decline");
    s = apply(s, 1, { kind: "choose", optionId: `destroy ${aura}` });
    expect(player(s, 1).life).toBe(19); // 3 - 2 prevented
    expect(player(s, 1).board).toHaveLength(0);
  });
});

// ── phantasm ─────────────────────────────────────────────────────────────────

describe("phantasm", () => {
  it("Phantasm destruction is a respondable triggered layer", () => {
    let s = makeGame();
    s = declareAttack(s, 0, "PHANT");
    const diminish = giveCard(s, 0, "DIM");
    const big = giveCard(s, 1, "BIG6");
    s = apply(s, 1, { kind: "defend", instanceIds: [big] });
    expect(s.chain).toHaveLength(1);
    expect(player(s, 0).graveyard.some((card) => card.cardId === "PHANT")).toBe(false);
    expect(s.stack[0]?.engineEffect).toEqual({ kind: "phantasm-destroy" });
    expect(s.pendingDecision?.kind).toBe("priority-window");

    // A response lowers the defender below 6 power. Phantasm rechecks its
    // state condition, resolves without destruction, and combat continues.
    s = apply(s, 0, { kind: "play-card", instanceId: diminish, pitchInstanceIds: [] });
    s = apply(s, 0, { kind: "pass" });
    s = apply(s, 1, { kind: "pass" });
    // The response resolved, so the turn player receives priority over the
    // remaining Phantasm layer even though neither player can respond now.
    expect(s.stack[0]?.engineEffect).toEqual({ kind: "phantasm-destroy" });
    expect(s.pendingDecision?.kind).toBe("priority-window");
    s = apply(s, 0, { kind: "pass" });
    s = apply(s, 1, { kind: "pass" });
    expect(s.stack).toHaveLength(0);
    expect(player(s, 0).graveyard.some((card) => card.cardId === "PHANT")).toBe(false);
    expect(s.pendingDecision?.kind).toBe("attack-reaction");
  });

  it("a 6+ power non-Illusionist attack defender destroys the attack and closes the chain", () => {
    let s = makeGame({ p0equipment: { legs: "WATCHER" } });
    s = declareAttack(s, 0, "PHANT");
    const big = giveCard(s, 1, "BIG6");
    s = apply(s, 1, { kind: "defend", instanceIds: [big] });
    expect(s.stack[0]?.engineEffect).toEqual({ kind: "phantasm-destroy" });
    s = apply(s, 0, { kind: "pass" });
    s = apply(s, 1, { kind: "pass" });
    expect(player(s, 0).graveyard.some((c) => c.cardId === "PHANT")).toBe(true);
    expect(player(s, 1).graveyard.some((c) => c.cardId === "BIG6")).toBe(true);
    expect(s.chain).toHaveLength(0);
    expect(s.phase).toBe("action");
    expect(s.priorityPlayer).toBe(0);
    expect(player(s, 1).life).toBe(20); // no damage step
    expect(player(s, 0).actionPoints).toBe(0); // no go-again refund
    expect(player(s, 0).flags["lost:phantasm"]).toBe(true); // onFriendlyAttackLost
    expect(player(s, 0).flags["lostCard:PHANT"]).toBe(true);
  });

  it("defending equipment still processes its close-of-chain keywords", () => {
    let s = makeGame({ p1equipment: { head: "HELM" } });
    s = declareAttack(s, 0, "PHANT");
    const big = giveCard(s, 1, "BIG6");
    const helm = player(s, 1).equipment.head!;
    s = apply(s, 1, { kind: "defend", instanceIds: [big, helm.instanceId] });
    expect(s.stack[0]?.engineEffect).toEqual({ kind: "phantasm-destroy" });
    s = apply(s, 0, { kind: "pass" });
    s = apply(s, 1, { kind: "pass" });
    expect(player(s, 1).graveyard.some((c) => c.cardId === "HELM")).toBe(true); // blade break
    expect(player(s, 1).equipment.head).toBeUndefined();
  });

  it("an Illusionist attack defender does not trigger phantasm", () => {
    let s = makeGame();
    s = declareAttack(s, 0, "PHANT");
    const ill = giveCard(s, 1, "ILL6");
    s = apply(s, 1, { kind: "defend", instanceIds: [ill] });
    expect(s.pendingDecision?.kind).toBe("attack-reaction"); // normal flow continues
    s = noDefendResolveAfterDefend(s);
    expect(player(s, 0).graveyard.some((c) => c.cardId === "PHANT")).toBe(false);
  });

  it("an attacking ally dying mid-link fires onFriendlyAttackLost (ally-died)", () => {
    let s = makeGame({ p0equipment: { legs: "WATCHER" } });
    const allyId = giveBoard(s, 0, "ALLY");
    // the ally attacks (tap ability); while the link is open it is destroyed
    s = apply(s, 0, { kind: "activate-ability", sourceInstanceId: allyId, pitchInstanceIds: [] });
    expect(s.pendingDecision?.kind).toBe("defend");
    const ally = player(s, 0).board.find((c) => c.instanceId === allyId)!;
    destroyPermanent(s, engineRuntime, 0, ally);
    expect(player(s, 0).flags["lost:ally-died"]).toBe(true);
    expect(player(s, 0).flags["lostCard:ALLY"]).toBe(true);
  });
});

function noDefendResolveAfterDefend(s: GameStateInternal): GameStateInternal {
  let cur = s;
  for (let i = 0; i < 6 && cur.pendingDecision && cur.pendingDecision.kind !== "choose-target"; i++) {
    cur = apply(cur, cur.pendingDecision.player, { kind: "pass" });
  }
  return cur;
}

// ── overpower ────────────────────────────────────────────────────────────────

describe("overpower", () => {
  it("projects overpower before and after the attack resolves", () => {
    let s = makeGame();
    s = declareAttack(s, 0, "OVERFLAG");
    expect(projectStateFor(s, 0).chain[0]?.overpower).toBe(true);

    s = noDefendResolve(s, 1);
    expect(s.chain[0]?.flags.overpowerAtResolution).toBe(true);
    expect(projectStateFor(s, 0).chain[0]?.overpower).toBe(true);
  });

  it("an overpower attack can't be defended by more than one action card", () => {
    let s = makeGame();
    s = declareAttack(s, 0, "OVER");
    const b1 = giveCard(s, 1, "BLOCK3");
    const b2 = giveCard(s, 1, "BLUE3");
    const r = applyIntent(s, 1, { kind: "defend", instanceIds: [b1, b2] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Overpower/);
    // and the combo is not enumerated
    const combos = legalIntents(s, 1).filter(
      (i) => i.kind === "defend" && i.instanceIds.includes(b1) && i.instanceIds.includes(b2),
    );
    expect(combos).toHaveLength(0);
    // a single action defender is fine
    s = apply(s, 1, { kind: "defend", instanceIds: [b1] });
    expect(s.pendingDecision?.kind).toBe("attack-reaction");
  });

  it("action + equipment is allowed; the link flag grants overpower too", () => {
    let s = makeGame({ p1equipment: { head: "HELM" } });
    s = declareAttack(s, 0, "OVERFLAG"); // script grants overpower via link flag
    const b1 = giveCard(s, 1, "BLOCK3");
    const b2 = giveCard(s, 1, "BLUE3");
    const r = applyIntent(s, 1, { kind: "defend", instanceIds: [b1, b2] });
    expect(r.ok).toBe(false);
    const helm = player(s, 1).equipment.head!;
    s = apply(s, 1, { kind: "defend", instanceIds: [b1, helm.instanceId] });
    expect(s.pendingDecision?.kind).toBe("attack-reaction");
  });
});

// ── defender intents ───────────────────────────────────────────────────────────

describe("declarative defender selection", () => {
  it("advertises the exact staged hand selection when all equipment slots are filled", () => {
    let s = makeGame({
      p1equipment: { head: "HELM", chest: "CHEST", arms: "ARMS", legs: "LEGS" },
    });
    player(s, 1).hand = [];
    s = declareAttack(s, 0, "ATK5");
    const first = giveCard(s, 1, "BLOCK3");
    const second = giveCard(s, 1, "BLUE3");
    s = apply(s, 1, { kind: "stage-defenders", instanceIds: [first, second] });

    expect(
      legalIntents(s, 1).some(
        (intent) =>
          intent.kind === "defend" &&
          intent.instanceIds.length === 2 &&
          intent.instanceIds.includes(first) &&
          intent.instanceIds.includes(second),
      ),
    ).toBe(true);
  });

  it("advertises an arbitrary staged three-of-four equipment selection", () => {
    let s = makeGame({
      p1equipment: { head: "HELM", chest: "CHEST", arms: "ARMS", legs: "LEGS" },
    });
    s = declareAttack(s, 0, "ATK5");
    const equipment = player(s, 1).equipment;
    const selected = [
      equipment.head!.instanceId,
      equipment.arms!.instanceId,
      equipment.legs!.instanceId,
    ];
    s = apply(s, 1, { kind: "stage-defenders", instanceIds: selected });

    const offered = legalIntents(s, 1).find(
      (intent): intent is Extract<GameIntent, { kind: "defend" }> =>
        intent.kind === "defend" &&
        intent.instanceIds.length === selected.length &&
        selected.every((id) => intent.instanceIds.includes(id)),
    );

    expect(offered).toBeDefined();
    s = apply(s, 1, offered!);
    expect(s.chain.at(-1)?.defendingEquipment.map((card) => card.instanceId)).toEqual(selected);
  });

  it("does not enumerate hand × equipment combinations", () => {
    let s = makeGame({
      p1equipment: { head: "HELM", chest: "CHEST", arms: "ARMS", legs: "LEGS" },
    });
    player(s, 1).hand = [];
    for (let i = 0; i < 5; i++) giveCard(s, 1, "BLOCK3");
    player(s, 1).weapons.push({ instanceId: 998, cardId: "BUCKLER", owner: 1 });
    s = declareAttack(s, 0, "ATK5");

    const legal = legalIntents(s, 1);
    expect(legal.filter((intent) => intent.kind === "defend")).toEqual([
      { kind: "defend", instanceIds: [] },
    ]);
    expect(legal.filter((intent) => intent.kind === "stage-defenders")).toHaveLength(10);
    expect(legal).toHaveLength(12); // confirm + ten candidates + concede
  });

  it("rejects a third staged non-block defender but permits block cards", () => {
    let s = makeGame();
    player(s, 1).hand = [];
    s = declareAttack(s, 0, "ATK5");
    s.modifiers.push({
      id: s.nextModifierId++,
      sourceInstanceId: s.chain.at(-1)!.attackingCard.instanceId,
      seat: 0,
      scope: "chain-link",
      maxNonBlockDefenders: 2,
    });
    expect(projectStateFor(s, 1).chain.at(-1)?.maxNonBlockDefenders).toBe(2);
    const first = giveCard(s, 1, "BLOCK3");
    const second = giveCard(s, 1, "BLOCK3");
    const third = giveCard(s, 1, "BLOCK3");
    const blockCard = giveCard(s, 1, "BLOCKCARD");

    let result = applyIntent(s, 1, {
      kind: "stage-defenders",
      instanceIds: [first, second, third],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/more than 2 non-block cards/);

    result = applyIntent(s, 1, {
      kind: "stage-defenders",
      instanceIds: [first, second, blockCard],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    s = result.state;
    expect(legalIntents(s, 1)).toContainEqual({
      kind: "defend",
      instanceIds: [first, second, blockCard],
    });
  });

  it("does not offer equipment already defending on a previous chain link", () => {
    let s = makeGame({ p1equipment: { head: "HELM" } });
    s = declareAttack(s, 0, "ATK5");
    const helmId = player(s, 1).equipment.head!.instanceId;
    s = apply(s, 1, { kind: "defend", instanceIds: [helmId] });
    s = noDefendResolveAfterDefend(s);

    // Open a second link without closing the combat chain.
    player(s, 0).actionPoints = 1;
    s = declareAttack(s, 0, "ATK5");
    expect(s.chain).toHaveLength(2);
    expect(
      legalIntents(s, 1).some(
        (intent) =>
          (intent.kind === "defend" || intent.kind === "stage-defenders") &&
          intent.instanceIds.includes(helmId),
      ),
    ).toBe(false);

    const reused = applyIntent(s, 1, { kind: "defend", instanceIds: [helmId] });
    expect(reused.ok).toBe(false);
    if (!reused.ok) expect(reused.error).toContain("cannot defend");
  });
});

// ── cloaked ──────────────────────────────────────────────────────────────────

describe("cloaked", () => {
  it("cloaked equipment enters face-down and is hidden from the opponent", () => {
    const s = makeGame({ p1equipment: { arms: "CLOAK" } });
    const eq = player(s, 1).equipment.arms!;
    expect(eq.faceDown).toBe(true);
    const oppView = projectStateFor(s, 0).players[1].equipment.arms!;
    expect(oppView.hidden).toBe(true);
    expect(oppView.cardId).toBe("");
    const ownView = projectStateFor(s, 1).players[1].equipment.arms!;
    expect(ownView.cardId).toBe("CLOAK");
  });

  it("face-down equipment cannot defend and its ward is non-functional", () => {
    let s = makeGame({ p1equipment: { arms: "CLOAK" } });
    const eq = player(s, 1).equipment.arms!;
    s = declareAttack(s, 0, "ATK5");
    const defends = legalIntents(s, 1).filter(
      (i) => i.kind === "defend" && i.instanceIds.includes(eq.instanceId),
    );
    expect(defends).toHaveLength(0);
    const r = applyIntent(s, 1, { kind: "defend", instanceIds: [eq.instanceId] });
    expect(r.ok).toBe(false);
    // ward off: full damage, no ward decision
    s = noDefendResolve(s, 1);
    expect(player(s, 1).life).toBe(15);
  });

  it("a turnsFaceUp ability is activatable while face-down and flips it as cost", () => {
    let s = makeGame({ p1equipment: { arms: "CLOAK" }, heroes: ["HERO_A", "HERO_B"] });
    // give seat 1 the priority... simpler: activate on seat 1's turn
    s = passTurn(s, 0); // end turn 1 (seat 0)
    // now seat 1's turn? turn 1 end draws for both; active player is 1
    expect(s.activePlayer).toBe(1);
    const eq = player(s, 1).equipment.arms!;
    const red = giveCard(s, 1, "RED1");
    const intents = legalIntents(s, 1).filter(
      (i) => i.kind === "activate-ability" && i.sourceInstanceId === eq.instanceId,
    );
    expect(intents.length).toBeGreaterThan(0);
    s = apply(s, 1, { kind: "activate-ability", sourceInstanceId: eq.instanceId, pitchInstanceIds: [red] });
    expect(player(s, 1).equipment.arms?.faceDown).toBe(false);
    expect(player(s, 1).life).toBe(20); // turning face up is a cost; the effect resolves from the stack
    for (let i = 0; i < 4 && s.pendingDecision; i++) {
      s = apply(s, s.pendingDecision.player, { kind: "pass" });
    }
    expect(player(s, 1).life).toBe(21);
    // face up now: it can defend and its ward functions
    s = apply(s, 1, { kind: "pass" });
    if (s.pendingDecision?.kind === "arsenal") s = apply(s, s.pendingDecision.player, { kind: "pass" });
    expect(s.activePlayer).toBe(0);
    s = declareAttack(s, 0, "ATK5");
    const eqNow = player(s, 1).equipment.arms!;
    expect(legalIntents(s, 1)).toContainEqual({
      kind: "stage-defenders",
      instanceIds: [eqNow.instanceId],
    });
    s = noDefendResolve(s, 1);
    expect(s.pendingDecision?.chooseHook).toBe("ward"); // ward is back on
  });
});

// ── aura attacks ─────────────────────────────────────────────────────────────

describe("aura attacks", () => {
  function auraGame(counters?: Record<string, number>) {
    const s = makeGame({ weapons: ["SCROLL", "SWORD"] });
    const aura = giveBoard(s, 0, "WARD1", counters);
    return { s, aura };
  }

  it("a ward aura can attack for its ward value while the marker permanent is controlled", () => {
    const { s: s0, aura } = auraGame();
    let s = s0;
    const intents = legalIntents(s, 0).filter(
      (i) => i.kind === "activate-ability" && i.sourceInstanceId === aura,
    );
    expect(intents.length).toBeGreaterThan(0);
    const red = giveCard(s, 0, "RED1");
    s = apply(s, 0, { kind: "activate-ability", sourceInstanceId: aura, pitchInstanceIds: [red] });
    expect(s.pendingDecision?.kind).toBe("defend");
    const link = s.chain[s.chain.length - 1]!;
    expect(link.attackCardType).toBe("weapon");
    const view = projectStateFor(s, 0);
    expect(view.chain[view.chain.length - 1]!.attackValue).toBe(1); // ward 1
    s = noDefendResolve(s, 1);
    expect(player(s, 1).life).toBe(19);
    // the aura stays in play and doesn't tap
    expect(player(s, 0).board.some((c) => c.instanceId === aura)).toBe(true);
    expect(player(s, 0).actionPoints).toBe(0); // no go again without a counter
  });

  it("is once per turn per aura", () => {
    const { s: s0, aura } = auraGame();
    let s = s0;
    const red = giveCard(s, 0, "RED1");
    s = apply(s, 0, { kind: "activate-ability", sourceInstanceId: aura, pitchInstanceIds: [red] });
    s = noDefendResolve(s, 1);
    s = apply(s, 0, { kind: "close-chain" });
    player(s, 0).actionPoints = 1;
    const intents = legalIntents(s, 0).filter(
      (i) => i.kind === "activate-ability" && i.sourceInstanceId === aura,
    );
    expect(intents).toHaveLength(0);
  });

  it("has go again with a +1{p} counter, refunded at resolution", () => {
    const { s: s0, aura } = auraGame({ power: 1 });
    let s = s0;
    const red = giveCard(s, 0, "RED1");
    s = apply(s, 0, { kind: "activate-ability", sourceInstanceId: aura, pitchInstanceIds: [red] });
    const view = projectStateFor(s, 0);
    expect(view.chain[view.chain.length - 1]!.attackValue).toBe(2); // ward 1 + counter
    s = noDefendResolve(s, 1);
    expect(player(s, 0).actionPoints).toBe(1); // refunded
  });

  it("modifyAttackActivationCost discounts the activation", () => {
    let s = makeGame({ heroes: ["HERO_DISCOUNT", "HERO_B"], weapons: ["SCROLL", "SWORD"] });
    const aura = giveBoard(s, 0, "WARD1");
    const intents = legalIntents(s, 0).filter(
      (i) => i.kind === "activate-ability" && i.sourceInstanceId === aura,
    );
    // discounted to 0: an empty-pitch variant is offered
    expect(intents.some((i) => i.kind === "activate-ability" && i.pitchInstanceIds.length === 0)).toBe(true);
    s = apply(s, 0, { kind: "activate-ability", sourceInstanceId: aura, pitchInstanceIds: [] });
    expect(s.pendingDecision?.kind).toBe("defend");
  });

  it("fails to resolve when the attacking aura is destroyed mid-combat: no damage, no go again", () => {
    const { s: s0, aura } = auraGame({ power: 1 }); // would have go again
    let s = s0;
    const red = giveCard(s, 0, "RED1");
    s = apply(s, 0, { kind: "activate-ability", sourceInstanceId: aura, pitchInstanceIds: [red] });
    expect(s.pendingDecision?.kind).toBe("defend");
    // destroyed at instant speed before the link resolves
    destroyPermanent(s, engineRuntime, 0, player(s, 0).board.find((c) => c.instanceId === aura)!);
    s = noDefendResolve(s, 1);
    expect(player(s, 1).life).toBe(20); // no damage
    expect(player(s, 0).actionPoints).toBe(0); // no go-again refund
    expect(s.log.some((l) => l.publicText?.includes("fails to resolve"))).toBe(true);
  });
});

describe("destroyed attack sources", () => {
  it("an attacking ally destroyed mid-combat: its attack deals no damage", () => {
    let s = makeGame();
    const allyId = giveBoard(s, 0, "ALLY"); // attack 2, life 3
    s = apply(s, 0, { kind: "activate-ability", sourceInstanceId: allyId, pitchInstanceIds: [] });
    expect(s.pendingDecision?.kind).toBe("defend");
    expect(s.chain[s.chain.length - 1]!.attackCardType).toBe("ally");
    // killed by instant-speed damage before the link resolves
    destroyPermanent(s, engineRuntime, 0, player(s, 0).board.find((c) => c.instanceId === allyId)!);
    s = noDefendResolve(s, 1);
    expect(player(s, 1).life).toBe(20); // no damage
    expect(player(s, 0).graveyard.some((c) => c.cardId === "ALLY")).toBe(true);
  });
});

// ── created-this-turn tracking ───────────────────────────────────────────────

describe("created a card this turn", () => {
  it("createToken records createdThisTurn and createdName flags", () => {
    let s = makeGame();
    const maker = giveCard(s, 0, "MAKER");
    s = playAndResolve(s, 0, maker);
    expect(player(s, 0).flags.createdThisTurn).toBe(1);
    expect(player(s, 0).flags["createdName:test token"]).toBe(true);
  });
});

// ── controlled-this-turn tracking ────────────────────────────────────────────

describe("controlled a card this turn", () => {
  it("createToken stamps controlledName and startTurn re-stamps it after the flag wipe", () => {
    let s = makeGame();
    const maker = giveCard(s, 0, "MAKER");
    s = playAndResolve(s, 0, maker);
    expect(player(s, 0).flags["controlledName:test token"]).toBe(true);
    // per-turn flags are wiped during cleanup; everything still in play is
    // re-stamped when the next turn starts
    s = passTurn(s, 0);
    expect(player(s, 0).flags.createdThisTurn).toBeUndefined();
    expect(player(s, 0).flags["controlledName:test token"]).toBe(true);
  });
});

// ── canDefend ────────────────────────────────────────────────────────────────

describe("canDefend", () => {
  it("a scripted defense reaction can be restricted by the attack's base power", () => {
    let s = makeGame();
    s = declareAttack(s, 0, "ATK5"); // base 5 > 3
    const g = giveCard(s, 1, "GUARDMAX");
    s = apply(s, 1, { kind: "defend", instanceIds: [] });
    s = apply(s, 0, { kind: "pass" });
    const intents = legalIntents(s, 1).filter(
      (i) => i.kind === "play-card" && i.instanceId === g,
    );
    expect(intents).toHaveLength(0);
    const r = applyIntent(s, 1, { kind: "play-card", instanceId: g, pitchInstanceIds: [] });
    expect(r.ok).toBe(false);
  });

  it("allows a defense reaction to be played against a small attack", () => {
    let s = makeGame();
    s = declareAttack(s, 0, "ATK2");
    const g = giveCard(s, 1, "GUARDMAX");
    s = apply(s, 1, { kind: "defend", instanceIds: [] });
    s = apply(s, 0, { kind: "pass" });
    expect(
      legalIntents(s, 1).some((i) => i.kind === "play-card" && i.instanceId === g),
    ).toBe(true);
    s = apply(s, 1, { kind: "play-card", instanceId: g, pitchInstanceIds: [] });
    expect(s.pendingDecision?.kind).toBe("defense-reaction");
  });
});

// ── effect damage to allies (CR 8.2.8) ──────────────────────────────────────

describe("effect damage to allies", () => {
  it("reduces the ally's life — no Ward decision, no prevention-shield soak", () => {
    let s = makeGame();
    const ally = giveBoard(s, 1, "ALLY"); // base life 3 (stamped by giveBoard)
    giveBoard(s, 1, "WARD2"); // a ward source on the defender's board
    player(s, 1).flags.preventNextDamage = 5; // and a hero prevention shield
    const zap = giveCard(s, 0, "ZAPAL");
    s = playAndResolve(s, 0, zap);
    // hero-side defenses never engage for allies: no ward/barrier decision
    expect(s.pendingDecision).toBeNull();
    const live = player(s, 1).board.find((c) => c.instanceId === ally)!;
    expect(live.life).toBe(1); // full 2 damage through
    expect(player(s, 1).life).toBe(20); // the hero is untouched
    expect(player(s, 1).flags.preventNextDamage).toBe(5); // shield not consumed
    expect(player(s, 1).board.some((c) => c.cardId === "WARD2")).toBe(true); // ward source intact
    // The target's controller was not dealt damage, but the non-living source
    // card and its controller did deal it (CR 8.5.3a / 8.2.8f).
    expect(player(s, 0).flags.dealtDamageThisTurn).toBe(true);
  });

  it("destroys the ally at 0 life, like combat damage would", () => {
    let s = makeGame();
    giveBoard(s, 1, "ALLY"); // life 3
    const z1 = giveCard(s, 0, "ZAPAL");
    const z2 = giveCard(s, 0, "ZAPAL");
    s = playAndResolve(s, 0, z1); // 3 → 1
    expect(player(s, 1).board.some((c) => c.cardId === "ALLY")).toBe(true);
    s = playAndResolve(s, 0, z2); // 1 → destroyed
    expect(player(s, 1).board).toHaveLength(0);
    expect(player(s, 1).graveyard.some((c) => c.cardId === "ALLY")).toBe(true);
    expect(player(s, 1).life).toBe(20);
  });

  it("arcane damage to an ally ignores Arcane Barrier and Spellvoid", () => {
    let s = makeGame({ p1equipment: { head: "BARRIER" } });
    giveBoard(s, 1, "ALLY");
    const zap = giveCard(s, 0, "ZAPALARC");
    s = playAndResolve(s, 0, zap);
    // no Arcane Barrier decision opens; the damage applies in full
    expect(s.pendingDecision).toBeNull();
    const live = player(s, 1).board.find((c) => c.cardId === "ALLY")!;
    expect(live.life).toBe(1);
    expect(player(s, 1).equipment.head).toBeDefined(); // barrier equipment intact
    expect(player(s, 1).flags.arcaneDamageTakenThisTurn).not.toBe(true);
    expect(player(s, 0).flags.arcaneDamageDealtThisTurn).toBe(true);
    expect(player(s, 0).flags.arcaneDamageDealtToOpposingHeroThisTurn).not.toBe(true);
  });

  it("does not attribute damage dealt by an ally to its controller", () => {
    let s = makeGame();
    giveBoard(s, 1, "ALLY");
    const zapper = giveCard(s, 0, "ALLYZAP");
    s = playAndResolve(s, 0, zapper);
    expect(player(s, 1).board.find((c) => c.cardId === "ALLY")?.life).toBe(2);
    expect(player(s, 0).flags.dealtDamageThisTurn).not.toBe(true);
  });

  it("fizzles cleanly when the ally is gone", () => {
    let s = makeGame();
    const zap = giveCard(s, 0, "ZAPAL"); // no ally on either board
    s = playAndResolve(s, 0, zap);
    expect(s.pendingDecision).toBeNull();
    expect(player(s, 1).life).toBe(20);
  });
});
