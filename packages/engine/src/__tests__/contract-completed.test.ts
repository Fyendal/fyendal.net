import { describe, expect, it } from "vitest";
import type { CardData, Decklist, GameIntent } from "@fyendal/shared";
import { engineRuntime } from "../engineRuntime.js";
import { applyIntent, legalIntents } from "../index.js";
import { createGame, type GameStateInternal } from "../runtimeState.js";
import type { CardScript } from "../scripts.js";
import type { CardInstance, PlayerState } from "../state.js";
import { startTurn } from "../turn.js";

const cards: Record<string, CardData> = {
  HERO: { id: "HERO", name: "Hero", cardType: "hero", classes: ["generic"], intellect: 4, life: 20, text: "" },
  PAYER: { id: "PAYER", name: "Payer", cardType: "hero", classes: ["generic"], intellect: 4, life: 20, text: "" },
  FILLER: { id: "FILLER", name: "Filler", cardType: "action", subtypes: [], classes: ["generic"], pitch: 3, cost: 0, defense: 3, text: "" },
  AURA_TOKEN: { id: "AURA_TOKEN", name: "Aura Token", cardType: "token", subtypes: ["aura"], text: "" },
  ITEM_TOKEN: { id: "ITEM_TOKEN", name: "Item Token", cardType: "token", subtypes: ["item"], text: "" },
  AURA_CARD: { id: "AURA_CARD", name: "Aura Card", cardType: "action", subtypes: ["aura"], classes: ["generic"], pitch: 3, cost: 0, text: "" },
  CONTRACT: { id: "CONTRACT", name: "Contract", cardType: "instant", classes: ["generic"], pitch: 3, cost: 0, text: "" },
  WATCHER: { id: "WATCHER", name: "Watcher", cardType: "action", subtypes: ["item"], classes: ["generic"], pitch: 3, cost: 0, text: "" },
};

const scripts: Record<string, CardScript> = {
  PAYER: {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      effectCardCosts: [{
        zone: "arena",
        move: "destroy",
        count: 1,
        tokenOnly: true,
        types: ["aura"],
        prompt: { fallback: "Destroy an aura token", message: { id: "test.cost" } },
      }],
      onActivate(ctx) {
        ctx.gainLife(ctx.seat, 1);
      },
    },
  },
  CONTRACT: {
    onPlay(ctx) {
      ctx.completeContract();
      ctx.completeContract();
    },
  },
  WATCHER: {
    triggers: [{
      event: "contract-completed",
      sourceZone: "arena",
      label: "Gain 1 life",
      labelMessage: { id: "test.watcher" },
      effect(ctx) {
        ctx.gainLife(ctx.seat, 1);
      },
    }],
  },
};

function makeGame(heroId = "HERO"): GameStateInternal {
  const decklist = (id: string): Decklist => ({
    heroId: id,
    weaponIds: [],
    equipment: {},
    deck: Array.from({ length: 40 }, () => "FILLER"),
  });
  const state = createGame({
    decklists: [decklist(heroId), decklist("HERO")],
    seed: 1,
    cards,
    scripts,
  }) as GameStateInternal;
  startTurn(state, engineRuntime);
  return state;
}

function player(state: GameStateInternal, seat: number): PlayerState {
  return state.players[seat] as PlayerState;
}

function add(state: GameStateInternal, seat: number, zone: "board" | "hand" | "graveyard", cardId: string): number {
  const card: CardInstance = { instanceId: state.nextInstanceId++, cardId, owner: seat };
  player(state, seat)[zone].push(card);
  return card.instanceId;
}

function apply(state: GameStateInternal, seat: number, intent: GameIntent): GameStateInternal {
  const result = applyIntent(state, seat, intent);
  if (!result.ok) throw new Error(result.error);
  return result.state as GameStateInternal;
}

/** Pass until the played card's layer has left the stack. */
function resolveFirstLayer(state: GameStateInternal): GameStateInternal {
  const played = state.stack[0]!.sourceInstanceId;
  let current = state;
  for (let i = 0; i < 4 && current.stack.some((layer) => layer.sourceInstanceId === played); i++) {
    current = apply(current, current.pendingDecision!.player, { kind: "pass" });
  }
  return current;
}

function resolveStack(state: GameStateInternal): GameStateInternal {
  let current = state;
  for (let i = 0; i < 20 && current.stack.length > 0; i++) {
    current = apply(current, current.pendingDecision!.player, { kind: "pass" });
  }
  return current;
}

describe("ActivatedEffectCardCost.tokenOnly", () => {
  const offered = (state: GameStateInternal) => legalIntents(state, 0).filter(
    (intent) => intent.kind === "activate-ability" && intent.sourceInstanceId === player(state, 0).hero.instanceId,
  );

  it("isn't offered without a controlled token matching the other filters", () => {
    const state = makeGame("PAYER");
    add(state, 0, "board", "AURA_CARD");
    add(state, 0, "board", "ITEM_TOKEN");
    add(state, 1, "board", "AURA_TOKEN");

    expect(offered(state)).toEqual([]);
  });

  it("selects only the matching token", () => {
    const state = makeGame("PAYER");
    add(state, 0, "board", "AURA_CARD");
    add(state, 0, "board", "ITEM_TOKEN");
    add(state, 1, "board", "AURA_TOKEN");
    const token = add(state, 0, "board", "AURA_TOKEN");
    const other = add(state, 0, "board", "AURA_TOKEN");

    const paying = apply(state, 0, offered(state)[0]!);

    expect(paying.pendingDecision?.options?.sort()).toEqual([String(token), String(other)].sort());
  });
});

describe("contract-completed", () => {
  const playContract = (state: GameStateInternal) => {
    const instanceId = add(state, 0, "hand", "CONTRACT");
    return apply(state, 0, { kind: "play-card", instanceId, pitchInstanceIds: [] });
  };

  it("counts completions and triggers once per completion, on the stack", () => {
    const state = makeGame();
    add(state, 0, "board", "WATCHER");

    const played = resolveFirstLayer(playContract(state));

    expect(player(played, 0).flags.completedContractThisTurn).toBe(true);
    expect(player(played, 0).flags.contractCompletionsThisTurn).toBe(2);
    expect(played.stack.map((layer) => layer.label)).toEqual(["Gain 1 life", "Gain 1 life"]);
    expect(player(played, 0).life).toBe(20);
    expect(player(resolveStack(played), 0).life).toBe(22);
  });

  it("is limited to the completing seat's arena", () => {
    const state = makeGame();
    add(state, 1, "board", "WATCHER");
    add(state, 0, "hand", "WATCHER");
    add(state, 0, "graveyard", "WATCHER");

    const resolved = resolveStack(playContract(state));

    expect(player(resolved, 0).life).toBe(20);
    expect(player(resolved, 1).life).toBe(20);
    expect(player(resolved, 1).flags.completedContractThisTurn).toBeUndefined();
  });
});
