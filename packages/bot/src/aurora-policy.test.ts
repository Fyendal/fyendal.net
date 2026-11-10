import { cardData, decklists, precon, scripts } from "@fyendal/cards";
import { applyIntent, createGame, legalIntents, projectStateFor } from "@fyendal/engine";
import type { Decklist, GameIntent } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import { chooseAuroraIntent } from "./aurora-policy.js";
import { auroraPresentationFor } from "./sideboard.js";

type Game = ReturnType<typeof createGame>;

function auroraDeck(opponent: Decklist): Decklist {
  const pool = precon("bot-aurora-tempest")!.pool;
  return { heroId: pool.heroId, ...auroraPresentationFor(opponent) };
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

describe("Aurora policy", () => {
  it("opens the turn with Arc Lightning and chains go-again attacks into its pings", () => {
    let state = createGame({
      decklists: [auroraDeck(decklists.rhinar), decklists.rhinar],
      cards: cardData,
      scripts,
      seed: 4242,
      startPlayer: 0,
    });
    state.turn = 2;
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
      const result = applyIntent(state, seat, intent);
      expect(result.ok, result.ok ? "" : result.error).toBe(true);
      if (!result.ok) return;
      state = result.state;
    }
    expect(played[0]).toBe("AST022");
    expect(played).toEqual(expect.arrayContaining(["GEM155", "ROS101", "LGS368"]));
    // Path 3+1 arcane, Second Strike 4, Fry 3 and an Arc ping on each go again.
    expect(startLife - state.players[1]!.life).toBeGreaterThanOrEqual(13);
  });

  function defendAgainst(attackId: string, seed: number): { state: Game; defense: GameIntent } {
    let state = createGame({
      decklists: [auroraDeck(decklists.rhinar), decklists.rhinar],
      cards: cardData,
      scripts,
      seed,
      startPlayer: 1,
    });
    state.turn = 2;
    replaceHand(state, 0, ["GEM155", "ROS101", "LGS368", "SBA016"]);
    replaceHand(state, 1, [attackId, "WTR205"]);
    const attack = legalIntents(state, 1).find((intent) =>
      intent.kind === "play-card" &&
      state.players[1]!.hand.find((card) => card.instanceId === intent.instanceId)?.cardId === attackId
    );
    expect(attack).toBeDefined();
    let result = applyIntent(state, 1, attack!);
    if (!result.ok) throw new Error(result.error);
    state = result.state;
    for (let step = 0; step < 10 && state.pendingDecision?.kind !== "defend"; step++) {
      result = applyIntent(state, actor(state), passive(state, actor(state)));
      if (!result.ok) throw new Error(result.error);
      state = result.state;
    }
    expect(state.pendingDecision?.kind).toBe("defend");
    return { state, defense: choose(state, 0) };
  }

  it("takes a non-lethal hit instead of blocking with its attacks", () => {
    const { defense } = defendAgainst("WTR203", 4243);
    expect(defense).toEqual({ kind: "defend", instanceIds: [] });
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

  function reactionWindowAfter(attackId: string, seed: number): Game {
    let state = createGame({
      decklists: [auroraDeck(decklists.rhinar), decklists.rhinar],
      cards: cardData,
      scripts,
      seed,
      startPlayer: 0,
    });
    state.turn = 2;
    replaceHand(state, 0, [attackId, "ROS101", "GEM155"]);
    const attack = legalIntents(state, 0).find((intent) =>
      intent.kind === "play-card" &&
      state.players[0]!.hand.find((card) => card.instanceId === intent.instanceId)?.cardId === attackId &&
      intent.pitchInstanceIds.length === 0
    );
    expect(attack).toBeDefined();
    let result = applyIntent(state, 0, attack!);
    expect(result.ok, result.ok ? "" : result.error).toBe(true);
    if (!result.ok) throw new Error(result.error);
    state = result.state;
    for (let step = 0; step < 20; step++) {
      if (state.pendingDecision?.kind === "attack-reaction" && actor(state) === 0) return state;
      const seat = actor(state);
      result = applyIntent(state, seat, passive(state, seat));
      if (!result.ok) throw new Error(result.error);
      state = result.state;
    }
    throw new Error("no attack reaction window");
  }

  const activatesSnapdragon = (state: Game) => {
    const intent = choose(state, 0);
    const legs = state.players[0]!.equipment.legs!;
    return intent.kind === "activate-ability" && intent.sourceInstanceId === legs.instanceId;
  };

  it("keeps Snapdragon Scalers when the attack already has go again", () => {
    expect(activatesSnapdragon(reactionWindowAfter("LGS368", 4246))).toBe(false);
  });

  it("spends Snapdragon Scalers to continue from an attack without go again", () => {
    expect(activatesSnapdragon(reactionWindowAfter("ANQ031", 4247))).toBe(true);
  });

  it("aims Arc Lightning's ping at the opposing hero", () => {
    const state = createGame({
      decklists: [auroraDeck(decklists.rhinar), decklists.rhinar],
      cards: cardData,
      scripts,
      seed: 4244,
      startPlayer: 0,
    });
    const view = projectStateFor(state, 0);
    const opponentHero = String(view.players[1].heroInstanceId);
    const ownHero = String(view.players[0].heroInstanceId);
    view.pendingDecision = {
      player: 0,
      kind: "choose-target",
      prompt: "Arc Lightning: deal 1 arcane damage to any target",
      options: [ownHero, opponentHero],
    } as typeof view.pendingDecision;
    const intent = chooseAuroraIntent({
      seat: 0,
      view,
      legal: [{ kind: "choose", optionId: ownHero }, { kind: "choose", optionId: opponentHero }],
      cards: cardData,
    });
    expect(intent).toEqual({ kind: "choose", optionId: opponentHero });
  });
});
