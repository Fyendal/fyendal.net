import { cardData, decklists, findPrinting, precon, scripts } from "@fyendal/cards";
import { applyIntent, createGame, legalIntents, projectStateFor } from "@fyendal/engine";
import type { GameIntent } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import { chooseDorintheaIntent } from "./dorinthea-policy.js";
import { dorintheaSolverRules } from "./dorinthea-rules.js";
import { solveHand } from "./hand-value.js";
import { ownCards, responseEvaluation, scoreDefenseIntentWithTrace } from "./policy.js";
import { dorintheaSagePresentationFor } from "./sideboard.js";

type State = ReturnType<typeof createGame>;

function game(names: readonly [string, number][], turn = 2): State {
  const pool = precon("bot-dorinthea-sage")!.pool;
  const state = createGame({
    decklists: [{ heroId: pool.heroId, ...dorintheaSagePresentationFor(decklists.rhinar) }, decklists.rhinar],
    cards: cardData, scripts, seed: 311, startPlayer: 0,
  });
  state.turn = turn;
  state.players[0]!.hand = names.map(([name, pitch]) => ({
    instanceId: state.nextInstanceId++, cardId: findPrinting(name, pitch)!.id, owner: 0,
  }));
  return state;
}

function input(state: State, seat: 0 | 1 = 0) {
  return { seat, view: projectStateFor(state, seat), legal: legalIntents(state, seat), cards: cardData, state };
}

function apply(state: State, seat: 0 | 1, intent: GameIntent): State {
  const result = applyIntent(state, seat, intent);
  expect(result.ok, result.ok ? "" : result.error).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

function cardName(intent: GameIntent, state: State): string | undefined {
  const id = intent.kind === "activate-ability" ? intent.sourceInstanceId
    : "instanceId" in intent ? intent.instanceId : undefined;
  const player = state.players[0]!;
  const card = [...player.hand, ...player.arsenal, ...player.weapons, ...Object.values(player.equipment)]
    .find((candidate) => candidate?.instanceId === id);
  return card && cardData[card.cardId]?.name;
}

/** Dorinthea's turn: play her choices, passing for the opponent, until `stop`. */
function playUntil(state: State, stop: (state: State) => boolean): { state: State; played: string[] } {
  const played: string[] = [];
  for (let step = 0; step < 30 && !stop(state) && state.activePlayer === 0; step++) {
    const seat = (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1;
    if (seat === 0) {
      const intent = chooseDorintheaIntent(input(state));
      const name = cardName(intent, state);
      if (name) played.push(name);
      state = apply(state, 0, intent);
    } else {
      const legal = legalIntents(state, 1);
      state = apply(state, 1, legal.find((intent) => intent.kind === "defend" && intent.instanceIds.length === 0)
        ?? legal.find((intent) => intent.kind === "pass")!);
    }
  }
  return { state, played };
}

/** The opponent plays `name` as an attack against Dorinthea. */
function attacked(state: State, name: string, pitch = 1): State {
  const attacker = state.players[1]!;
  const attack = { instanceId: state.nextInstanceId++, cardId: findPrinting(name, pitch)!.id, owner: 1 as const };
  attacker.hand = [attack];
  attacker.resources = 3;
  attacker.actionPoints = 1;
  state.activePlayer = 1;
  state.priorityPlayer = 1;
  return apply(state, 1, legalIntents(state, 1).find((intent) =>
    intent.kind === "play-card" && intent.instanceId === attack.instanceId
  )!);
}

/** Dorinthea answers the open attack until its link resolves, declaring no
 * blockers when `noBlock` is set. */
function resolveLink(state: State, noBlock = false): State {
  for (let step = 0; step < 20 && state.chain.at(-1)?.resolved !== true; step++) {
    const seat = (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1;
    const forced = seat === 0 && noBlock && projectStateFor(state, 0).pendingDecision?.kind === "defend"
      ? legalIntents(state, 0).find((intent) => intent.kind === "defend" && intent.instanceIds.length === 0)
      : undefined;
    state = apply(state, seat, forced ?? (seat === 0
      ? chooseDorintheaIntent(input(state))
      : legalIntents(state, 1).find((candidate) => candidate.kind === "pass")!));
  }
  expect(state.chain.at(-1)?.resolved).toBe(true);
  return state;
}

describe("Dorinthea policy", () => {
  it("sharpens the Axe before swinging it", () => {
    const { played } = playUntil(
      game([["Sharpen Steel", 1], ["Raging Onslaught", 3], ["On the Horizon", 1], ["Test of Strength", 1]]),
      (state) => state.chain.length > 0,
    );
    expect(played).toEqual(["Sharpen Steel", "Decimator Great Axe"]);
  });

  it("swings the Axe instead of a Felling Swing it could not follow up", () => {
    const state = game([["Felling Swing", 1], ["Hit and Run", 3]]);
    expect(cardName(chooseDorintheaIntent(input(state)), state)).toBe("Decimator Great Axe");
  });

  it("swings the Axe at the hero rather than an ally it cannot kill", () => {
    const state = game([["Felling Swing", 3]]);
    state.players[1]!.board.push({ instanceId: state.nextInstanceId++, cardId: "IAR221", owner: 1, life: 6 });
    const intent = chooseDorintheaIntent(input(state));
    expect(cardName(intent, state)).toBe("Decimator Great Axe");
    expect(intent).not.toHaveProperty("targetAllyId");
  });

  it("plays Felling Swing when two blues fund it and the Axe", () => {
    const { played } = playUntil(
      game([["Felling Swing", 1], ["Raging Onslaught", 3], ["Biting Blade", 3], ["On the Horizon", 1]]),
      (state) => state.chain.length > 0,
    );
    expect(played).toEqual(["Felling Swing", "Decimator Great Axe"]);
  });

  it("swings the Axe ahead of an attack action card", () => {
    const state = game([["Chest Puff", 1], ["Raging Onslaught", 3], ["Sirens of Safe Harbor", 3]]);
    expect(cardName(chooseDorintheaIntent(input(state)), state)).toBe("Decimator Great Axe");
  });

  it("keeps Hit and Run as pitch when the extra action point has no use", () => {
    const state = game([["Hit and Run", 3], ["On the Horizon", 1]]);
    expect(cardName(chooseDorintheaIntent(input(state)), state)).toBe("Decimator Great Axe");
  });

  it("uses Hit and Run to swing twice with the pitch for both", () => {
    const state = game([["Hit and Run", 3], ["Raging Onslaught", 3], ["Biting Blade", 3]]);
    expect(cardName(chooseDorintheaIntent(input(state)), state)).toBe("Hit and Run");
  });

  it("holds reprise reactions on an undefended swing and plays Display of Craftsmanship", () => {
    const start = game([["Ironsong Response", 1], ["Display of Craftsmanship", 3]]);
    start.players[0]!.resources = 5;
    const { state } = playUntil(
      start,
      (current) => projectStateFor(current, 0).pendingDecision?.kind === "attack-reaction",
    );
    expect(cardName(chooseDorintheaIntent(input(state)), state)).toBe("Display of Craftsmanship");
  });

  it("swings a second time after Hit and Run when the first swing hits", () => {
    const { played, state } = playUntil(
      game([["Hit and Run", 3], ["Raging Onslaught", 3], ["Display of Craftsmanship", 3], ["Ironsong Response", 1]]),
      () => false,
    );
    expect(played.filter((name) => name === "Decimator Great Axe")).toHaveLength(2);
    expect(state.players[1]!.life).toBe(12);
  });

  /** A red Raging Onslaught attacks Dorinthea's hand of `names`. */
  function defend(names: readonly [string, number][], noBlock = false): { state: State; blue: number } {
    const start = attacked(game(names), "Raging Onslaught");
    const blue = start.players[0]!.hand.find((card) => cardData[card.cardId]?.pitch === 3)?.instanceId ?? -1;
    return { state: resolveLink(start, noBlock), blue };
  }

  it("blocks a big attack while keeping the blue that funds the Axe", () => {
    const { state, blue } = defend([
      ["On the Horizon", 1], ["Test of Strength", 1], ["Raging Onslaught", 3], ["Chest Puff", 1],
    ]);
    expect(state.players[0]!.life).toBe(20);
    expect(state.players[0]!.hand.map((card) => card.instanceId)).toContain(blue);
  });

  it("pays for Steelblade Shunt with a red instead of the Axe's blue", () => {
    const { state, blue } = defend([["Steelblade Shunt", 1], ["Sharpen Steel", 1], ["Raging Onslaught", 3]], true);
    expect(state.players[0]!.life).toBe(19);
    expect(state.players[0]!.hand.map((card) => card.instanceId)).toContain(blue);
  });

  it("takes a small hit rather than block with the Axe's only pitch", () => {
    const { state, blue } = defend([["Raging Onslaught", 3], ["On the Horizon", 1]]);
    expect(state.players[0]!.hand.map((card) => card.instanceId)).toContain(blue);
  });
});

describe("Dorinthea hand value", () => {
  it("counts a Hit and Run second swing at the chance the first one hits", () => {
    const state = game([["Hit and Run", 3], ["Raging Onslaught", 3], ["Biting Blade", 3]]);
    const observed = input(state);
    const result = solveHand(observed.view.players[0].hand, observed, dorintheaSolverRules);
    expect(result.damage).toBeGreaterThan(4);
    expect(result.damage).toBeLessThan(8);
  });
});

describe("Unity blocks", () => {
  it("credits Unity's bonus to equipment defending beside a hand card", () => {
    const start = game([["On the Horizon", 1]]);
    // Armor is only worn when the hit matters, so make it lethal.
    start.players[0]!.life = 7;
    let state = attacked(start, "Raging Onslaught");
    for (let step = 0; step < 6 && projectStateFor(state, 0).pendingDecision?.kind !== "defend"; step++) {
      const seat = (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1;
      state = apply(state, seat, legalIntents(state, seat).find((candidate) => candidate.kind === "pass")!);
    }
    const observed = input(state);
    const model = {
      cardOpportunity: () => 0,
      offensiveCards: () => [],
      evaluateResponse: () => responseEvaluation({}),
    };
    const prevented = (ids: number[]) => scoreDefenseIntentWithTrace(
      { kind: "defend", instanceIds: ids }, observed, ownCards(observed), model,
    ).value.damagePrevented;
    const horizon = state.players[0]!.hand[0]!.instanceId;
    const helm = state.players[0]!.equipment.head!.instanceId;
    expect(prevented([horizon])).toBe(4);
    expect(prevented([horizon, helm])).toBe(6);
  });
});

describe("Dorinthea Arcane Barrier", () => {
  /** One arcane damage offered to Arcane Barrier 1 on the opponent's turn. */
  function barrier(names: readonly [string, number][], phase: "action" | "end") {
    const state = game(names);
    state.activePlayer = 1;
    const observed = input(state);
    observed.view.phase = phase;
    observed.view.pendingDecision = {
      player: 0,
      kind: "choose-target",
      prompt: "Arcane Barrier: you would be dealt 1 arcane damage — pay {r} to prevent that much?",
      promptMessage: { id: "engine.decision.damage.arcane.barrier", values: { amount: 1 } },
      options: ["pay 0", "pay 1"],
    };
    return {
      ...observed,
      state: undefined,
      legal: [{ kind: "choose", optionId: "pay 0" }, { kind: "choose", optionId: "pay 1" }] as GameIntent[],
    };
  }

  it("keeps a red to block with while the opponent can still attack", () => {
    const observed = barrier([["On the Horizon", 1], ["Raging Onslaught", 3]], "action");
    expect(chooseDorintheaIntent(observed)).toEqual({ kind: "choose", optionId: "pay 0" });
  });

  it("pitches a spare red once no more attacks can come", () => {
    const observed = barrier([["On the Horizon", 1], ["Raging Onslaught", 3]], "end");
    expect(chooseDorintheaIntent(observed)).toEqual({ kind: "choose", optionId: "pay 1" });
  });

  it("takes the arcane damage to turn on a held Arcane Polarity", () => {
    const observed = barrier([["Arcane Polarity", 1], ["On the Horizon", 1], ["Raging Onslaught", 3]], "end");
    expect(chooseDorintheaIntent(observed)).toEqual({ kind: "choose", optionId: "pay 0" });
  });

  /** Swap the hand's Arcane Polarity for the pool's own printing. */
  function withPoolPolarity<T extends ReturnType<typeof barrier>>(observed: T): T {
    for (const card of observed.view.players[0].hand) {
      if (cardData[card.cardId]?.name === "Arcane Polarity") card.cardId = "SBW023";
    }
    return observed;
  }

  it("reads the life gain of the deck's Arcane Polarity printing", () => {
    expect(cardData.SBW023?.text).toBe(cardData.SBA030?.text);
    const observed = withPoolPolarity(barrier([["Arcane Polarity", 1]], "end"));
    expect(chooseDorintheaIntent(observed)).toEqual({ kind: "choose", optionId: "pay 0" });
  });

  it("never pitches Arcane Polarity to the barrier after arcane damage has landed", () => {
    const observed = withPoolPolarity(barrier([["Arcane Polarity", 1]], "end"));
    observed.view.turnFacts!.players[0].arcaneDamageTaken = true;
    expect(chooseDorintheaIntent(observed)).toEqual({ kind: "choose", optionId: "pay 0" });
  });

  it("plays Arcane Polarity once arcane damage has been dealt", () => {
    const state = game([["Arcane Polarity", 1]]);
    state.players[0]!.life = 10;
    const observed = input(state);
    observed.view.turnFacts!.players[0].arcaneDamageTaken = true;
    expect(cardName(chooseDorintheaIntent({ ...observed, state: undefined }), state)).toBe("Arcane Polarity");
  });
});

describe("Dorinthea on-hit blocks", () => {
  it.each([["Overpower", 1], ["Sirens of Safe Harbor", 1]] as const)(
    "stops Snatch's draw with %s and one Unity piece",
    (name, pitch) => {
      const start = game([["Felling Swing", 3], [name, pitch]]);
      start.players[0]!.life = 9;
      const blue = start.players[0]!.hand[0]!.instanceId;
      const state = resolveLink(attacked(start, "Snatch"));
      const link = state.chain.at(-1)!;
      expect(link.hit).toBe(false);
      expect(state.players[0]!.life).toBe(9);
      expect(link.defendingEquipment).toHaveLength(1);
      expect(state.players[0]!.hand.map((card) => card.instanceId)).toEqual([blue]);
    },
  );
});
