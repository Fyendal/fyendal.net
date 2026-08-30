import { cardData, decklists, precon, scripts } from "@fyendal/cards";
import { createGame, legalIntents, projectStateFor } from "@fyendal/engine";
import type { CardView, Decklist, GameIntent } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import { chooseBravoIntent } from "./bravo-policy.js";
import { bravoPresentationFor } from "./sideboard.js";

function bravoDeck(opponent: Decklist = decklists.dorinthea): Decklist {
  const pool = precon("bot-bravo-flarvo")!.pool;
  return { heroId: pool.heroId, ...bravoPresentationFor(opponent) };
}

function replaceHand(
  state: ReturnType<typeof createGame>,
  seat: 0 | 1,
  cardIds: readonly string[],
): void {
  state.players[seat]!.hand = cardIds.map((cardId) => ({
    instanceId: state.nextInstanceId++,
    cardId,
    owner: seat,
  }));
}

function inputFor(
  state: ReturnType<typeof createGame>,
  legal: readonly GameIntent[] = legalIntents(state, 0),
) {
  return {
    seat: 0 as const,
    view: projectStateFor(state, 0),
    legal,
    cards: cardData,
    state,
  };
}

describe("Bravo policy", () => {
  it("passes on the opening turn to preserve its four-card hand", () => {
    const state = createGame({
      decklists: [bravoDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9601,
      startPlayer: 0,
    });
    replaceHand(state, 0, ["SBR013", "SBR023", "SBR022", "MPG047"]);

    expect(chooseBravoIntent(inputFor(state))).toEqual({ kind: "pass" });
  });

  it.each([
    [40, "defend"],
    [20, "stage-defenders"],
  ] as const)("times two-block Temper equipment at %s life", (life, expectedKind) => {
    const state = createGame({
      decklists: [bravoDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9600 + life,
      startPlayer: 1,
    });
    state.turn = 3;
    const view = projectStateFor(state, 0);
    view.players[0].life = life;
    const steps = view.players[0].equipment.legs!;
    expect(cardData[steps.cardId]?.name).toBe("Civic Steps");
    view.phase = "defend";
    view.priorityPlayer = 0;
    view.pendingDecision = { player: 0, kind: "defend", prompt: "Choose defenders" };
    view.chain = [{
      attackingCard: { instanceId: 96_001, cardId: "WTR159", owner: 1 },
      defendingCards: [],
      attackValue: 2,
      defenseValue: 0,
      damage: 2,
      resolved: false,
      reactions: [],
    }];
    const legal: GameIntent[] = [
      { kind: "defend", instanceIds: [] },
      { kind: "stage-defenders", instanceIds: [steps.instanceId] },
    ];

    expect(chooseBravoIntent({ seat: 0, view, legal, cards: cardData }).kind).toBe(expectedKind);
  });

  it("uses a blue to send the largest available two-card attack", () => {
    const state = createGame({
      decklists: [bravoDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9602,
      startPlayer: 0,
    });
    state.turn = 2;
    replaceHand(state, 0, ["SBR013", "SBR023", "SBR022", "MPG047"]);
    const redBoulder = state.players[0]!.hand[0]!;
    const blueBoulder = state.players[0]!.hand[1]!;

    const intent = chooseBravoIntent(inputFor(state));
    expect(intent).toMatchObject({
      kind: "play-card",
      instanceId: redBoulder.instanceId,
      pitchInstanceIds: [blueBoulder.instanceId],
    });
  });

  it("uses two blues from hand to set up a dominated arsenal crush", () => {
    const state = createGame({
      decklists: [bravoDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9605,
      startPlayer: 0,
    });
    state.turn = 2;
    replaceHand(state, 0, ["SBR023", "SBR024", "SBR022", "MPG047"]);
    state.players[0]!.arsenal = [{
      instanceId: state.nextInstanceId++,
      cardId: "SBR013",
      owner: 0,
      faceDown: true,
    }];

    const intent = chooseBravoIntent(inputFor(state));
    expect(intent.kind).toBe("activate-ability");
    if (intent.kind !== "activate-ability") return;
    expect(intent.sourceInstanceId).toBe(state.players[0]!.hero.instanceId);
    expect(intent.pitchInstanceIds).toHaveLength(1);
  });

  it("blocks with the rest of its hand and sacrifices offense to stop a threatening on-hit", () => {
    const state = createGame({
      decklists: [bravoDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9603,
      startPlayer: 1,
    });
    replaceHand(state, 0, ["SBR013", "SBR023", "SBR022", "MPG047"]);
    const view = projectStateFor(state, 0);
    view.players[0].arsenal = [];
    view.players[0].arsenalCount = 0;
    const [attack, pitch, crash, clash] = view.players[0].hand as [CardView, CardView, CardView, CardView];
    view.phase = "defend";
    view.priorityPlayer = 0;
    view.pendingDecision = { player: 0, kind: "defend", prompt: "Choose defenders" };
    view.chain = [{
      attackingCard: { instanceId: 96_031, cardId: "SBR013", owner: 1 },
      defendingCards: [],
      attackValue: 7,
      defenseValue: 0,
      onHitEffects: [{ sourceCardId: "SBR013", text: "Put a card from hand on top of deck" }],
      damage: 7,
      resolved: false,
      reactions: [],
    }];
    const legal: GameIntent[] = [
      { kind: "defend", instanceIds: [] },
      { kind: "defend", instanceIds: [crash.instanceId] },
      { kind: "defend", instanceIds: [clash.instanceId] },
      { kind: "defend", instanceIds: [crash.instanceId, clash.instanceId] },
      { kind: "defend", instanceIds: [attack.instanceId, crash.instanceId] },
      { kind: "defend", instanceIds: [pitch.instanceId, crash.instanceId] },
    ];

    const intent = chooseBravoIntent({ seat: 0, view, legal, cards: cardData });
    expect(intent.kind).toBe("defend");
    if (intent.kind !== "defend") return;
    expect(intent.instanceIds).toHaveLength(2);
    expect(intent.instanceIds).toContain(crash.instanceId);
    expect(intent.instanceIds).not.toContain(attack.instanceId);
  });

  it("blocks Static Shock for three instead of saving that card to pitch for AB1", () => {
    const state = createGame({
      decklists: [bravoDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9606,
      startPlayer: 1,
    });
    replaceHand(state, 0, ["SBR022", "SBR023", "SBR024", "MPG047"]);
    const view = projectStateFor(state, 0);
    const blocker = view.players[0].hand[1]!;
    expect(blocker.defense ?? cardData[blocker.cardId]?.defense).toBe(3);
    view.phase = "defend";
    view.priorityPlayer = 0;
    view.pendingDecision = { player: 0, kind: "defend", prompt: "Choose defenders" };
    view.chain = [{
      attackingCard: { instanceId: 96_061, cardId: "SBA022", owner: 1 },
      defendingCards: [],
      attackValue: 4,
      defenseValue: 0,
      onHitEffects: [{
        sourceCardId: "SBA022",
        text: "When this hits, deal 1 arcane damage.",
        impact: { damage: 1 },
      }],
      damage: 4,
      resolved: false,
      reactions: [],
    }];
    const legal: GameIntent[] = [
      { kind: "defend", instanceIds: [] },
      { kind: "stage-defenders", instanceIds: [blocker.instanceId] },
    ];

    expect(chooseBravoIntent({ seat: 0, view, legal, cards: cardData })).toEqual({
      kind: "stage-defenders",
      instanceIds: [blocker.instanceId],
    });
  });

  it("uses Pummel when +4 secures a crush hit", () => {
    const state = createGame({
      decklists: [bravoDeck(), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 9604,
      startPlayer: 0,
    });
    replaceHand(state, 0, ["SBR020", "SBR023"]);
    state.turn = 2;
    const view = projectStateFor(state, 0);
    const [pummel, blue] = view.players[0].hand;
    view.phase = "reaction";
    view.priorityPlayer = 0;
    view.pendingDecision = { player: 0, kind: "attack-reaction", prompt: "Attack reactions" };
    view.chain = [{
      attackingCard: { instanceId: 96_041, cardId: "SBR013", owner: 0 },
      defendingCards: [],
      attackValue: 7,
      defenseValue: 7,
      damage: 0,
      resolved: false,
      reactions: [],
    }];
    const legal: GameIntent[] = [
      { kind: "pass" },
      { kind: "play-card", instanceId: pummel!.instanceId, pitchInstanceIds: [blue!.instanceId] },
    ];

    const intent = chooseBravoIntent({ seat: 0, view, legal, cards: cardData });
    expect(intent).toMatchObject({ kind: "play-card", instanceId: pummel!.instanceId });

  });
});
