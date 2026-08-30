import { describe, expect, it } from "vitest";
import type { CardView, GameView, PlayerView } from "@fyendal/shared";
import {
  cardLegalityExplanation,
  causalStatus,
  gameHasPriority,
  gamePhaseLabel,
  gameTimingLabel,
} from "./causalExplanations.js";

function player(seat: number, heroName: string): PlayerView {
  return {
    seat,
    heroCardId: `hero-${seat}`,
    heroInstanceId: 100 + seat,
    heroName,
    life: 20,
    actionPoints: 1,
    resources: 0,
    hand: [],
    handCount: 0,
    deckCount: 30,
    arsenal: [],
    arsenalCount: 0,
    pitch: [],
    pitchCount: 0,
    graveyard: [],
    banish: [],
    soul: [],
    equipment: {},
    weapons: [],
    board: [],
  };
}

function view(overrides: Partial<GameView> = {}): GameView {
  return {
    gameId: "game",
    turn: 1,
    phase: "action",
    activePlayer: 0,
    priorityPlayer: 0,
    players: [player(0, "Rhinar"), player(1, "Dorinthea")],
    chain: [],
    stack: [],
    ongoing: [],
    pendingDecision: null,
    winner: null,
    log: [],
    ...overrides,
  };
}

describe("causalStatus", () => {
  it("describes a defend decision as a required choice rather than priority", () => {
    const state = view({
      phase: "defend",
      priorityPlayer: 1,
      chain: [{
        attackingCard: { instanceId: 1, cardId: "attack", owner: 0 },
        defendingCards: [],
        attackValue: 4,
        defenseValue: 0,
        damage: 4,
        resolved: false,
        reactions: [],
      }],
      pendingDecision: { player: 1, kind: "defend", prompt: "Defend" },
    });

    expect(causalStatus(state, 1)).toMatchObject({
      kind: "decision",
      heading: "ACTION PHASE · DEFEND STEP · YOU CHOOSING BLOCKS",
    });
    expect(causalStatus(state, 0)).toMatchObject({
      kind: "waiting",
      heading: "ACTION PHASE · DEFEND STEP · OPPONENT CHOOSING BLOCKS",
    });
  });

  it("keeps a stack priority label compact", () => {
    const state = view({
      phase: "layer",
      pendingDecision: { player: 0, kind: "priority-window", prompt: "Priority" },
      stack: [{ card: null, seat: 0, label: "Create a token", optional: false }],
    });

    expect(causalStatus(state, 0)).toEqual({
      kind: "priority",
      heading: "ACTION PHASE · YOUR PRIORITY",
    });
  });

  it("identifies damage-step stack priority and resolution-step action priority", () => {
    const link = {
      attackingCard: { instanceId: 1, cardId: "attack", owner: 0 },
      defendingCards: [],
      attackValue: 4,
      defenseValue: 0,
      damage: 4,
      resolved: false,
      reactions: [],
    };
    expect(causalStatus(view({
      phase: "layer",
      stackContext: "DAMAGE STEP · ON-HIT TRIGGERS",
      chain: [link],
      stack: [{ card: null, seat: 0, label: "On hit", optional: false }],
      pendingDecision: { player: 0, kind: "priority-window", prompt: "Priority" },
    }), 0).heading).toBe("ACTION PHASE · DAMAGE STEP · YOUR PRIORITY");

    expect(causalStatus(view({
      chain: [{ ...link, resolved: true }],
    }), 0).heading).toBe("ACTION PHASE · RESOLUTION STEP · YOUR PRIORITY");
  });
});

describe("CR phase and combat-step labels", () => {
  it("never presents an ordinary stack window as a phase", () => {
    const state = view({
      phase: "layer",
      pendingDecision: { player: 1, kind: "priority-window", prompt: "Priority" },
    });

    expect(gamePhaseLabel(state)).toBe("ACTION PHASE");
    expect(gameTimingLabel(state)).toBe("ACTION PHASE");
  });

  it("uses the rules phase for non-decision fallback states", () => {
    expect(causalStatus(view({ phase: "layer" }), 0).heading).toBe("ACTION PHASE · WAITING");
  });

  it("shows combat steps beneath the action phase", () => {
    expect(gameTimingLabel(view({
      phase: "layer",
      stackContext: "LAYER STEP · ATTACK",
    }))).toBe("ACTION PHASE · LAYER STEP");
    expect(gameTimingLabel(view({
      phase: "reaction",
      pendingDecision: { player: 0, kind: "attack-reaction", prompt: "React" },
    }))).toBe("ACTION PHASE · REACTION STEP");
  });

  it("keeps the combat step visible during mandatory effect decisions", () => {
    expect(gameTimingLabel(view({
      phase: "reaction",
      pendingDecision: {
        player: 0,
        kind: "choose-target",
        prompt: "Choose a target",
        options: ["1"],
      },
    }))).toBe("ACTION PHASE · REACTION STEP");

    expect(gameTimingLabel(view({
      phase: "layer",
      stackContext: "DAMAGE STEP · EFFECTS",
      pendingDecision: {
        player: 0,
        kind: "optional-effect",
        prompt: "Use this effect?",
        options: ["yes", "no"],
      },
    }))).toBe("ACTION PHASE · DAMAGE STEP");
  });

  it("distinguishes start and end phases while triggers resolve", () => {
    expect(gamePhaseLabel(view({
      phase: "layer",
      stackContext: "START PHASE · START-OF-TURN TRIGGERS",
    }))).toBe("START PHASE");
    expect(gamePhaseLabel(view({
      phase: "layer",
      stackContext: "END PHASE · TRIGGERS",
    }))).toBe("END PHASE");
  });
});

describe("gameHasPriority", () => {
  it("includes either player's action and explicit reaction priority", () => {
    expect(gameHasPriority(view())).toBe(true);
    expect(gameHasPriority(view({ activePlayer: 1, priorityPlayer: 1 }))).toBe(true);
    expect(gameHasPriority(view({
      phase: "reaction",
      pendingDecision: { player: 1, kind: "defense-reaction", prompt: "React" },
      priorityPlayer: 1,
    }))).toBe(true);
  });

  it("excludes mandatory decisions and completed games", () => {
    expect(gameHasPriority(view({
      phase: "defend",
      pendingDecision: { player: 1, kind: "defend", prompt: "Defend" },
      priorityPlayer: 1,
    }))).toBe(false);
    expect(gameHasPriority(view({ winner: 0 }))).toBe(false);
  });
});

describe("cardLegalityExplanation", () => {
  const card: CardView = { instanceId: 7, cardId: "card", owner: 0 };

  it("uses the authoritative legal list for a legal card", () => {
    expect(cardLegalityExplanation(
      view(),
      0,
      [{ kind: "play-card", instanceId: 7, pitchInstanceIds: [] }],
      card,
    )).toMatchObject({ legal: true });
  });

  it("does not show a redundant tooltip while the opponent decides", () => {
    const state = view({
      pendingDecision: { player: 1, kind: "choose-target", prompt: "", options: undefined },
    });
    const explanation = cardLegalityExplanation(state, 0, [], card);
    expect(explanation.legal).toBe(false);
    expect(explanation.text).toBeUndefined();
  });

  it("omits basic turn and card-type timing explanations", () => {
    const action: CardView = { instanceId: 8, cardId: "SBA027", owner: 0 };
    expect(cardLegalityExplanation(view({ activePlayer: 1, priorityPlayer: 1 }), 0, [], action).text)
      .toBeUndefined();
    expect(cardLegalityExplanation(view({
      phase: "layer",
      pendingDecision: { player: 0, kind: "priority-window", prompt: "Priority" },
    }), 0, [], action).text).toBeUndefined();
  });

  it("omits vague explanations when a card matches the window but remains illegal", () => {
    const instant: CardView = { instanceId: 9, cardId: "SBA030", owner: 0 };
    const explanation = cardLegalityExplanation(view({
      phase: "layer",
      pendingDecision: { player: 0, kind: "priority-window", prompt: "Priority" },
    }), 0, [], instant);
    expect(explanation.text).toBeUndefined();
  });

  it("keeps concrete timing explanations", () => {
    const defenseReaction: CardView = { instanceId: 10, cardId: "SBA023", owner: 0 };
    const explanation = cardLegalityExplanation(view({
      phase: "defend",
      pendingDecision: { player: 0, kind: "defend", prompt: "Defend" },
    }), 0, [], defenseReaction);
    expect(explanation.text).toContain("later defense reaction window");
  });
});
