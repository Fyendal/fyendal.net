import { cardData, decklists, precon, scripts } from "@fyendal/cards";
import { applyIntent, createGame, legalIntents, projectStateFor, type GameState } from "@fyendal/engine";
import type { Decklist } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import { BOT_DEFINITIONS } from "./registry.js";
import { jarlPresentationFor } from "./sideboard.js";

function jarlDeck(): Decklist {
  const pool = precon("bot-jarl")!.pool;
  return { heroId: pool.heroId, ...jarlPresentationFor(decklists.dorinthea) };
}

function inputFor(state: GameState, seat: 0 | 1 = 0) {
  return { seat, view: projectStateFor(state, seat), legal: legalIntents(state, seat), cards: cardData, state };
}

/** Jarl at 1 life under Bloodrot Pox, holding only the blue that pays it. */
function poxedJarl(life: number): GameState {
  const state = createGame({
    decklists: [jarlDeck(), decklists.dorinthea], cards: cardData, scripts,
    seed: 41_022, startPlayer: 0,
  });
  state.turn = 22;
  state.players[0]!.life = life;
  state.players[0]!.hand = [{ instanceId: state.nextInstanceId++, cardId: "IAR260", owner: 0 }];
  state.players[0]!.board.push({ instanceId: state.nextInstanceId++, cardId: "SAZ034", owner: 0 });
  return state;
}

function playOutTurn(state: GameState): GameState {
  let current = state;
  for (let step = 0; step < 40 && current.turn === state.turn && current.phase !== "game-over"; step++) {
    const seat = current.pendingDecision?.player ?? current.priority ?? current.activePlayer;
    const intent = seat === 0
      ? BOT_DEFINITIONS.jarl.chooseIntent(inputFor(current, 0))
      : legalIntents(current, 1).find((candidate) => candidate.kind === "pass") ?? legalIntents(current, 1)[0]!;
    const result = applyIntent(current, seat, intent);
    if (!result.ok) throw new Error(result.error);
    current = result.state;
  }
  return current;
}

describe("end-phase upkeep", () => {
  it("keeps the blue that pays a lethal Bloodrot Pox instead of swinging Titan's Fist", () => {
    const state = poxedJarl(1);
    expect(legalIntents(state, 0)).toContainEqual(expect.objectContaining({ kind: "activate-ability" }));
    expect(BOT_DEFINITIONS.jarl.chooseIntent(inputFor(state))).not.toMatchObject({ kind: "activate-ability" });

    const after = playOutTurn(state);
    expect(after.winner).toBeNull();
    expect(after.players[0]!.life).toBe(1);
    expect(after.players[0]!.board.some((card) => card.cardId === "SAZ034")).toBe(false);
  });

  it("pays a non-lethal Bloodrot Pox from the hand it is about to redraw", () => {
    const state = poxedJarl(10);
    state.players[0]!.weapons = [];
    const after = playOutTurn(state);
    expect(after.players[0]!.life).toBe(10);
  });
});
