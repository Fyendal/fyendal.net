import { cardData, decklists, scripts } from "@fyendal/cards";
import { applyIntent, createGame, legalIntents, projectStateFor, type GameState } from "@fyendal/engine";
import type { GameIntent } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import { botDefinitions, type BotDefinition } from "./registry.js";

/** The bot (seat 0) controls an opponent-owned Bait from Take the Bait. */
function baited(): GameState {
  const state = createGame({
    decklists: [decklists.dorinthea, decklists.rhinar], cards: cardData, scripts,
    seed: 58_259, startPlayer: 0,
  });
  state.turn = 6;
  state.players[0]!.board.push({ instanceId: state.nextInstanceId++, cardId: "SUP259", owner: 1 });
  return state;
}

/** Plays until Bait's chain link resolves; the opponent never blocks or responds. */
function playOutBait(state: GameState, bot: BotDefinition): GameState {
  let current = state;
  for (let step = 0; step < 30 && !current.chain[0]?.resolved; step++) {
    const seat = current.pendingDecision?.player ?? current.priorityPlayer ?? current.activePlayer;
    const legal = legalIntents(current, seat);
    const intent: GameIntent = seat === 0
      ? bot.chooseIntent({ seat, view: projectStateFor(current, seat), legal, cards: cardData, state: current })
      : legal.find((candidate) =>
        candidate.kind === "pass" || (candidate.kind === "defend" && candidate.instanceIds.length === 0)
      )!;
    const result = applyIntent(current, seat, intent);
    if (!result.ok) throw new Error(result.error);
    current = result.state;
  }
  return current;
}

describe("Bait under the bot's control", () => {
  for (const bot of botDefinitions) {
    it(`${bot.id} attacks with and pumps Bait to get rid of it`, () => {
      const state = baited();
      const life = state.players[1]!.life;
      const after = playOutBait(state, bot);
      expect(after.players[0]!.board.some((card) => card.cardId === "SUP259")).toBe(false);
      expect(after.chain[0]).toMatchObject({ attackingCard: { cardId: "SUP259" }, resolved: true, goAgain: true });
      expect(after.players[1]!.life).toBe(life - 1);
    });
  }
});
