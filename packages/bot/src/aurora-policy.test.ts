import { cardData, decklists, precon, scripts } from "@fyendal/cards";
import { applyIntent, createGame, legalIntents, projectStateFor } from "@fyendal/engine";
import type { Decklist, GameIntent, PendingDecision } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import { chooseAuroraIntent, chooseAuroraIntentWithTrace } from "./aurora-policy.js";
import { decklistsFromState } from "./deck-knowledge.js";
import { auroraPresentationFor } from "./sideboard.js";

type Game = ReturnType<typeof createGame>;

function auroraDeck(opponent: Decklist): Decklist {
  const pool = precon("bot-aurora-tempest")!.pool;
  return { heroId: pool.heroId, ...auroraPresentationFor(opponent) };
}

/** Aurora (seat 0) against Rhinar, past the opening turn. */
function newGame(seed: number, startPlayer: 0 | 1): Game {
  const state = createGame({
    decklists: [auroraDeck(decklists.rhinar), decklists.rhinar],
    cards: cardData,
    scripts,
    seed,
    startPlayer,
  });
  state.turn = 2;
  return state;
}

function replaceHand(state: Game, seat: 0 | 1, cardIds: readonly string[]): void {
  state.players[seat]!.hand = cardIds.map((cardId) => ({
    instanceId: state.nextInstanceId++,
    cardId,
    owner: seat,
  }));
}

function choose(state: Game, seat: 0 | 1): GameIntent {
  const legal = legalIntents(state, seat).filter((intent) =>
    intent.kind !== "concede" && !intent.kind.endsWith("-draw")
  );
  return chooseAuroraIntent({ seat, view: projectStateFor(state, seat), legal, cards: cardData, state });
}

/** The opponent never blocks or responds. */
function passive(state: Game, seat: 0 | 1): GameIntent {
  const legal = legalIntents(state, seat);
  return legal.find((intent) => intent.kind === "defend" && intent.instanceIds.length === 0) ??
    legal.find((intent) => intent.kind === "pass") ?? legal[0]!;
}

function actor(state: Game): 0 | 1 {
  return (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1;
}

function apply(state: Game, seat: 0 | 1, intent: GameIntent): Game {
  const result = applyIntent(state, seat, intent);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

/** Play `cardId` from `seat`'s hand, paying from hand only if it costs anything. */
function playFromHand(state: Game, seat: 0 | 1, cardId: string): Game {
  const play = legalIntents(state, seat).find((intent) =>
    intent.kind === "play-card" &&
    state.players[seat]!.hand.find((card) => card.instanceId === intent.instanceId)?.cardId === cardId
  );
  if (!play) throw new Error(`${cardId} is not playable`);
  return apply(state, seat, play);
}

/** Both seats pass until `done` holds. */
function passUntil(state: Game, done: (state: Game) => boolean): Game {
  for (let step = 0; step < 20; step++) {
    if (done(state)) return state;
    state = apply(state, actor(state), passive(state, actor(state)));
  }
  throw new Error("state never reached");
}

/** Answer a synthetic decision on a fresh game view. */
function decide(
  decision: Omit<PendingDecision, "player">,
  hand: readonly string[] = [],
  arsenal: readonly string[] = [],
): GameIntent {
  const state = newGame(4244, 0);
  replaceHand(state, 0, hand);
  state.players[0]!.arsenal = arsenal.map((cardId, arsenalSlot) => ({
    instanceId: state.nextInstanceId++,
    cardId,
    owner: 0,
    faceDown: true,
    arsenalSlot,
  }));
  const view = projectStateFor(state, 0);
  view.pendingDecision = { player: 0, ...decision } as PendingDecision;
  return chooseAuroraIntent({
    seat: 0,
    view,
    legal: decision.options!.map((optionId) => ({ kind: "choose", optionId })),
    cards: cardData,
  });
}

describe("Aurora policy", () => {
  it("opens the turn with Arc Lightning and chains go-again attacks into its pings", () => {
    let state = newGame(4242, 0);
    // Arc Lightning, Path of Same Ends, Second Strike, Fry.
    replaceHand(state, 0, ["AST022", "GEM155", "ROS101", "LGS368"]);
    const startLife = state.players[1]!.life;

    const played: string[] = [];
    for (let step = 0; step < 80 && state.turn === 2 && state.winner === null; step++) {
      const seat = actor(state);
      const intent = seat === 0 ? choose(state, 0) : passive(state, 1);
      if (seat === 0 && intent.kind === "play-card") {
        const card = state.players[0]!.hand.find((candidate) => candidate.instanceId === intent.instanceId);
        if (card) played.push(card.cardId);
      }
      state = apply(state, seat, intent);
    }
    expect(played[0]).toBe("AST022");
    expect(played).toEqual(expect.arrayContaining(["GEM155", "ROS101", "LGS368"]));
    // Path 3+1 arcane, Second Strike 4, Fry 3 and an Arc ping on each go again.
    expect(startLife - state.players[1]!.life).toBeGreaterThanOrEqual(13);
  });

  it("keeps attacking the hero when an inactive Chum survives every attack", () => {
    let state = newGame(4242, 0);
    replaceHand(state, 0, ["AST022", "GEM155", "ROS101", "LGS368"]);
    const chum = { instanceId: state.nextInstanceId++, cardId: "SEA050", owner: 1 as const, life: 6 };
    state.players[1]!.board.push(chum);
    const startLife = state.players[1]!.life;

    const targets: Array<number | undefined> = [];
    for (let step = 0; step < 80 && state.turn === 2 && state.winner === null; step++) {
      const seat = actor(state);
      const intent = seat === 0 ? choose(state, 0) : passive(state, 1);
      if (seat === 0 && "targetAllyId" in intent) targets.push(intent.targetAllyId);
      state = apply(state, seat, intent);
    }
    expect(targets).not.toContain(chum.instanceId);
    expect(startLife - state.players[1]!.life).toBeGreaterThanOrEqual(13);
  });

  function firstPlay(hand: readonly string[], seed: number): string | undefined {
    const state = newGame(seed, 0);
    replaceHand(state, 0, hand);
    const intent = choose(state, 0);
    if (intent.kind !== "play-card") return undefined;
    return state.players[0]!.hand.find((card) => card.instanceId === intent.instanceId)?.cardId;
  }

  it("converts the rest of the hand through Enlightened Strike's go again instead of a weapon swing", () => {
    // Bug 37AB80: after Fry it swung Scorpio and held Enlightened Strike, Quick Succession and Snatch.
    let state = newGame(4255, 0);
    // Without Snapdragon Scalers, only Enlightened Strike's own mode can carry the turn on.
    delete state.players[0]!.equipment.legs;
    replaceHand(state, 0, ["LGS368", "WTR159", "OMN083", "ANQ031"]);
    state = playFromHand(state, 0, "LGS368");
    state = passUntil(state, (next) => next.phase === "action" && next.priorityPlayer === 0);
    const played: string[] = [];
    let weaponSwings = 0;
    for (let step = 0; step < 80 && state.turn === 2 && state.winner === null; step++) {
      const seat = actor(state);
      const intent = seat === 0 ? choose(state, 0) : passive(state, 1);
      if (seat === 0 && intent.kind === "play-card") {
        const card = state.players[0]!.hand.find((candidate) => candidate.instanceId === intent.instanceId);
        if (card) played.push(card.cardId);
      }
      if (seat === 0 && intent.kind === "activate-ability" &&
        state.players[0]!.weapons.some((weapon) => weapon.instanceId === intent.sourceInstanceId)) weaponSwings++;
      state = apply(state, seat, intent);
    }
    expect(played).toEqual(["WTR159", "ANQ031"]);
    expect(weaponSwings).toBe(0);
    expect(state.players[0]!.deck.at(-1)?.cardId).toBe("OMN083");
  });

  /** Bug 37AB80: Burn Up melded, Fry blocked, then Quick Succession and Snatch beside Scorpio. */
  function burnUpAfterBlockedFry(): Game {
    let state = newGame(4256, 0);
    state.players[1]!.life = 39;
    replaceHand(state, 0, ["ROS012", "LGS368", "OMN083", "ANQ031"]);
    const ready = (next: Game) => next.phase === "action" && next.priorityPlayer === 0 && next.stack.length === 0;
    const meld = legalIntents(state, 0).find((intent) =>
      intent.kind === "play-card" && "meldSide" in intent && intent.meldSide === "both"
    );
    state = passUntil(apply(state, 0, meld!), ready);
    state = playFromHand(state, 0, "LGS368");
    // Fry is blocked, so Burn Up still waits for the next hit.
    state = passUntil(state, (next) => next.pendingDecision?.kind === "defend");
    const blocker = state.players[1]!.hand.find((card) => (cardData[card.cardId]?.defense ?? 0) >= 3)!;
    state = apply(state, 1, { kind: "stage-defenders", instanceIds: [blocker.instanceId] });
    state = apply(state, 1, { kind: "defend", instanceIds: [blocker.instanceId] });
    return passUntil(state, ready);
  }

  it("counts Burn Up's arcane behind Snatch's on-hit draw over a Scorpio swing", () => {
    // The rollout stopped at Snatch's draw before Burn Up resolved.
    const state = burnUpAfterBlockedFry();
    const intent = choose(state, 0);
    expect(intent.kind).toBe("play-card");
    expect(state.players[0]!.hand.find((card) => intent.kind === "play-card" && card.instanceId === intent.instanceId)?.cardId)
      .toBe("ANQ031");
  });

  it("expects armor to stop a one-power Scorpio swing carrying Burn Up", () => {
    const state = burnUpAfterBlockedFry();
    const scorpio = state.players[0]!.weapons[0]!;
    const legal = legalIntents(state, 0).filter((intent) => intent.kind !== "concede" && !intent.kind.endsWith("-draw"));
    const { plan } = chooseAuroraIntentWithTrace({
      seat: 0, view: projectStateFor(state, 0), legal, cards: cardData, state, decklists: decklistsFromState(state, 0),
    });
    const swing = plan?.rootResults.find((root) =>
      root.intent.kind === "activate-ability" && root.intent.sourceInstanceId === scorpio.instanceId
    );
    expect(swing?.evaluation.damage).toBe(0);
  });

  /** Bug 2748D9: Quick Succession then Skyzyk, leaving Skyzyk and Lightning Surge beside Scorpio. */
  function afterFirstSkyzyk(seed: number, snapdragon: boolean): Game {
    let state = newGame(seed, 0);
    if (snapdragon) expect(state.players[0]!.equipment.legs?.cardId).toBe("WTR154");
    else delete state.players[0]!.equipment.legs;
    replaceHand(state, 0, ["OMN083", "AST013", "AST013", "ELE190"]);
    const ready = (next: Game) => next.phase === "action" && next.priorityPlayer === 0 && next.stack.length === 0;
    state = passUntil(playFromHand(state, 0, "OMN083"), ready);
    return passUntil(playFromHand(state, 0, "AST013"), ready);
  }

  it("plays a cheap attack Snapdragon Scalers can give go again over a Scorpio swing", () => {
    // It swung Scorpio and held Skyzyk and Lightning Surge.
    const state = afterFirstSkyzyk(4257, true);
    const intent = choose(state, 0);
    expect(intent.kind).toBe("play-card");
    expect(state.players[0]!.hand.find((card) => intent.kind === "play-card" && card.instanceId === intent.instanceId)?.cardId)
      .toBe("AST013");
  });

  it("explores the hand's attacks instead of two payments for one Grasp activation", () => {
    // Grasp pitching one card and Grasp pitching two filled both root slots.
    const state = afterFirstSkyzyk(4258, false);
    const legal = legalIntents(state, 0).filter((intent) => intent.kind !== "concede" && !intent.kind.endsWith("-draw"));
    const { plan } = chooseAuroraIntentWithTrace({ seat: 0, view: projectStateFor(state, 0), legal, cards: cardData, state });
    const hand = new Set(state.players[0]!.hand.map((card) => card.instanceId));
    expect(plan?.rootResults.some((root) => root.intent.kind === "play-card" && hand.has(root.intent.instanceId)))
      .toBe(true);
  });

  it("leads with Arc Lightning ahead of a Burn Up meld", () => {
    expect(firstPlay(["ROS012", "AST022", "LGS368"], 4248)).toBe("AST022");
  });

  it("leads with Arc Lightning when its grant is the only go again", () => {
    expect(firstPlay(["ANQ031", "ANQ029", "AST022"], 4249)).toBe("AST022");
  });

  it("keeps Arc Lightning for arsenal beside a single follow-up", () => {
    let state = newGame(4252, 0);
    replaceHand(state, 0, ["ANQ031", "AST022"]);
    const arc = state.players[0]!.hand[1]!;
    for (let step = 0; step < 80 && state.turn === 2 && state.winner === null; step++) {
      const seat = actor(state);
      state = apply(state, seat, seat === 0 ? choose(state, 0) : passive(state, 1));
    }
    expect(state.players[0]!.arsenal.map((card) => card.instanceId)).toEqual([arc.instanceId]);
  });

  it("spends Aether Ironweave on Grasp of the Arknight after Arc Lightning and an attack", () => {
    let state = newGame(4253, 0);
    replaceHand(state, 0, ["AST022", "GEM155", "ROS101"]);
    const { chest, arms } = state.players[0]!.equipment;
    expect([chest?.cardId, arms?.cardId]).toEqual(["MON230", "ARC078"]);
    const activated: string[] = [];
    for (let step = 0; step < 80 && state.turn === 2 && state.winner === null; step++) {
      const seat = actor(state);
      const intent = seat === 0 ? choose(state, 0) : passive(state, 1);
      if (intent.kind === "activate-ability") {
        const source = Object.values(state.players[0]!.equipment).find((card) => card?.instanceId === intent.sourceInstanceId);
        if (source) activated.push(source.cardId);
      }
      state = apply(state, seat, intent);
    }
    expect(activated).toEqual(expect.arrayContaining(["MON230", "ARC078"]));
  });

  it("saves Aether Ironweave for an Arc Lightning turn", () => {
    // Bug 8B059E: it spent the chest on a Grasp Runechant without Arc Lightning.
    let state = newGame(4254, 0);
    replaceHand(state, 0, ["GEM065", "ANQ029", "ROS012", "ELE189"]);
    state.players[0]!.arsenal = [{ instanceId: state.nextInstanceId++, cardId: "ANQ029", owner: 0 }];
    state.players[1]!.life = 40;
    const chest = state.players[0]!.equipment.chest!;
    expect(chest.cardId).toBe("MON230");
    for (let step = 0; step < 80 && state.turn === 2 && state.winner === null; step++) {
      const seat = actor(state);
      const intent = seat === 0 ? choose(state, 0) : passive(state, 1);
      expect(intent.kind === "activate-ability" && intent.sourceInstanceId === chest.instanceId).toBe(false);
      state = apply(state, seat, intent);
    }
    expect(state.turn).toBe(3);
  });

  interface DefenseSetup {
    hand?: readonly string[];
    arsenal?: readonly string[];
    onlyHeadAndLegs?: boolean;
  }

  /** Rhinar attacks with `attackId`; Aurora holds four Lightning attacks by default. */
  function defendAgainst(
    attackId: string,
    seed: number,
    { hand = ["GEM155", "ROS101", "LGS368", "SBA016"], arsenal = [], onlyHeadAndLegs = false }: DefenseSetup = {},
  ): { state: Game; defense: GameIntent } {
    let state = newGame(seed, 1);
    replaceHand(state, 0, hand);
    replaceHand(state, 1, [attackId, "WTR205"]);
    state.players[0]!.arsenal = arsenal.map((cardId) => ({ instanceId: state.nextInstanceId++, cardId, owner: 0 }));
    if (onlyHeadAndLegs) {
      delete state.players[0]!.equipment.chest;
      delete state.players[0]!.equipment.arms;
    }
    state = playFromHand(state, 1, attackId);
    state = passUntil(state, (current) => current.pendingDecision?.kind === "defend");
    return { state, defense: choose(state, 0) };
  }

  it("takes a non-lethal hit instead of blocking with its attacks", () => {
    const { defense } = defendAgainst("WTR203", 4243);
    expect(defense).toEqual({ kind: "defend", instanceIds: [] });
  });

  it("blocks with a hand that won't convert into damage", () => {
    // Burn Up // Shock and Current Funnel threaten little on their own.
    const { state, defense } = defendAgainst("WTR203", 4251, { hand: ["ROS012", "ROS074"] });
    const handIds = new Set(state.players[0]!.hand.map((card) => card.instanceId));
    expect("instanceIds" in defense && defense.instanceIds.some((id) => handIds.has(id))).toBe(true);
  });

  it("keeps a hand that threatens more than the attack even into a full blocking hand", () => {
    // Enlightened Strike (go again) and Nimblism into Nimby out-damage the hit.
    const { state, defense } = defendAgainst("WTR200", 4262, {
      hand: ["ROS074", "GEM062", "WTR159", "ELE189"],
      arsenal: ["GEM065"],
    });
    const [, nimby, strike] = state.players[0]!.hand;
    expect("instanceIds" in defense && defense.instanceIds.some((id) =>
      id === nimby!.instanceId || id === strike!.instanceId
    )).toBe(false);
  });

  it("blocks with Burn Up when too few attacks would carry it", () => {
    // Enlightened Strike is the only attack Burn Up could ride.
    const { state, defense } = defendAgainst("WTR203", 4254, { hand: ["ROS012", "WTR159", "AST022", "SEA239"] });
    const burnUp = state.players[0]!.hand[0]!;
    expect("instanceIds" in defense && defense.instanceIds.includes(burnUp.instanceId)).toBe(true);
  });

  it.each([
    { reaction: "ANQ034", name: "Sink Below" },
    { reaction: "ELE227", name: "Sigil of Suffering" },
  ])("keeps $name against a 1-power attack", ({ reaction }) => {
    let { state, defense } = defendAgainst("WTR196", 4255, { hand: [reaction, "GEM155", "ROS101", "LGS368"] });
    expect(state.players[0]!.life).toBeGreaterThan(4);
    const reactionCard = state.players[0]!.hand[0]!;
    let reactions = 0;
    for (let step = 0; step < 10 && state.chain.length > 0; step++) {
      const seat = actor(state);
      const intent = seat === 0 ? (step === 0 ? defense : choose(state, 0)) : passive(state, 1);
      if (seat === 0 && state.pendingDecision?.kind === "defense-reaction") {
        reactions++;
        expect(intent.kind === "play-card" && intent.instanceId === reactionCard.instanceId).toBe(false);
      }
      state = apply(state, seat, intent);
    }
    expect(reactions).toBeGreaterThan(0);
  });

  it("covers a card-drawing hit with armor rather than hand cards", () => {
    const { state, defense } = defendAgainst("WTR167", 4245);
    const handIds = new Set(state.players[0]!.hand.map((card) => card.instanceId));
    const armorIds = new Set(Object.values(state.players[0]!.equipment).flatMap((card) => card ? [card.instanceId] : []));
    // Armor is staged before the block is confirmed.
    expect(defense.kind).toBe("stage-defenders");
    if (defense.kind !== "stage-defenders") return;
    expect(defense.instanceIds.filter((id) => handIds.has(id))).toEqual([]);
    expect(defense.instanceIds.some((id) => armorIds.has(id))).toBe(true);
  });

  it("blocks with Crown of Providence to sink the arsenal card Command and Conquer would destroy", () => {
    let { state, defense } = defendAgainst("ANQ009", 4250, { arsenal: ["AST022"], onlyHeadAndLegs: true });
    const crown = state.players[0]!.equipment.head!;
    const arc = state.players[0]!.arsenal[0]!;
    const handIds = new Set(state.players[0]!.hand.map((card) => card.instanceId));
    expect(crown.cardId).toBe("PEN310");
    expect("instanceIds" in defense && defense.instanceIds.includes(crown.instanceId)).toBe(true);
    expect("instanceIds" in defense && defense.instanceIds.some((id) => handIds.has(id))).toBe(false);

    let sank = false;
    for (let step = 0; step < 20 && state.chain.length > 0; step++) {
      const seat = actor(state);
      const intent = seat === 0 ? choose(state, 0) : passive(state, 1);
      if (seat === 0 && state.pendingDecision?.kind === "choose-target" && intent.kind === "choose") {
        expect(intent.optionId).toBe(String(arc.instanceId));
        sank = true;
      }
      state = apply(state, seat, intent);
    }
    expect(sank).toBe(true);
    expect(state.players[0]!.arsenal).toEqual([]);
    expect(state.players[0]!.deck.at(-1)?.instanceId).toBe(arc.instanceId);
  });

  /** Aurora attacks with `attackId` and waits in its own reaction window. */
  function reactionWindowAfter(attackId: string, seed: number, rest = ["ROS101", "GEM155"]): Game {
    let state = newGame(seed, 0);
    replaceHand(state, 0, [attackId, ...rest]);
    state = playFromHand(state, 0, attackId);
    return passUntil(state, (current) =>
      current.pendingDecision?.kind === "attack-reaction" && actor(current) === 0
    );
  }

  const activatesSnapdragon = (state: Game) => {
    const intent = choose(state, 0);
    return intent.kind === "activate-ability" && intent.sourceInstanceId === state.players[0]!.equipment.legs!.instanceId;
  };

  it("plays Lightning Press only when its +3 gets damage past the defenders", () => {
    const state = reactionWindowAfter("ANQ030", 4247, ["FAB262"]);
    delete state.players[0]!.equipment.legs;
    const press = state.players[0]!.hand.find((card) => card.cardId === "FAB262")!;
    const view = projectStateFor(state, 0);
    const legal = legalIntents(state, 0).filter((intent) => intent.kind !== "concede" && !intent.kind.endsWith("-draw"));
    const playsPress = () => {
      const intent = chooseAuroraIntent({ seat: 0, view, legal, cards: cardData });
      return intent.kind === "play-card" && intent.instanceId === press.instanceId;
    };
    expect(playsPress()).toBe(true);

    view.chain[0] = { ...view.chain[0]!, defenseValue: 7, damage: 0 };
    expect(playsPress()).toBe(false);
  });

  it("keeps Snapdragon Scalers when the attack already has go again", () => {
    expect(activatesSnapdragon(reactionWindowAfter("LGS368", 4246))).toBe(false);
  });

  it("spends Snapdragon Scalers to continue from an attack without go again", () => {
    expect(activatesSnapdragon(reactionWindowAfter("ANQ031", 4247))).toBe(true);
  });

  it("keeps Snapdragon Scalers when the follow-up attack has its own go again", () => {
    // Bug 8B059E: Ravenous Rabble should have attacked before Lightning Surge.
    expect(activatesSnapdragon(reactionWindowAfter("ELE189", 4248, ["ANQ029"]))).toBe(false);
  });

  it("keeps Snapdragon Scalers rather than enable a weapon swing", () => {
    const state = reactionWindowAfter("ELE189", 4249, ["GEM065"]);
    expect(state.players[0]!.weapons.map((weapon) => weapon.cardId)).toContain("SBA002");
    expect(activatesSnapdragon(state)).toBe(false);
  });

  it("spends Snapdragon Scalers to open an Arc Lightning turn", () => {
    expect(activatesSnapdragon(reactionWindowAfter("ELE189", 4250, ["ROS010", "ANQ029"]))).toBe(true);
  });

  it("aims Arc Lightning's ping at the opposing hero", () => {
    const view = projectStateFor(newGame(4244, 0), 0);
    const ownHero = String(view.players[0].heroInstanceId);
    const opponentHero = String(view.players[1].heroInstanceId);
    expect(decide({ kind: "choose-target", prompt: "Arc Lightning", options: [ownHero, opponentHero] }))
      .toEqual({ kind: "choose", optionId: opponentHero });
  });

  it("takes Enlightened Strike's go again while attacks remain in hand", () => {
    expect(decide({ kind: "choose-target", prompt: "Choose a mode", options: ["draw", "+2", "go again"] }, ["LGS368"]))
      .toEqual({ kind: "choose", optionId: "go again" });
  });

  it("takes Enlightened Strike's +2 when the only follow-up needs a hand card it lacks", () => {
    // Bug AA53F2: an empty hand cannot pay the arsenal Enlightened Strike's additional cost.
    expect(decide({ kind: "choose-target", prompt: "Choose a mode", options: ["draw", "+2", "go again"] }, [], ["WTR159"]))
      .toEqual({ kind: "choose", optionId: "+2" });
  });
});
