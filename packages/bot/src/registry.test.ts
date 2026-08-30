import { cardData, precon, scripts, validatePresentation } from "@fyendal/cards";
import { createGame, legalIntents, projectStateFor } from "@fyendal/engine";
import type { Decklist } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import {
  BOT_DEFINITIONS,
  botDefinition,
  botDefinitionForDeckId,
  botDefinitions,
} from "./registry.js";

const opponent: Decklist = {
  heroId: "RNR001",
  weaponIds: [],
  equipment: {},
  deck: Array(60).fill("WTR159") as string[],
};

describe("bot registry", () => {
  it("registers every bot with unique stable identity and deck mappings", () => {
    expect(botDefinitions).toHaveLength(6);
    expect(new Set(botDefinitions.map(({ id }) => id)).size).toBe(botDefinitions.length);
    expect(new Set(botDefinitions.map(({ deckId }) => deckId)).size).toBe(botDefinitions.length);
    expect(Object.keys(BOT_DEFINITIONS).sort()).toEqual(
      botDefinitions.map(({ id }) => id).sort(),
    );

    for (const definition of botDefinitions) {
      expect(botDefinition(definition.id)).toBe(definition);
      expect(botDefinitionForDeckId(definition.deckId)).toBe(definition);
      expect(definition.chooseIntent).toBeTypeOf("function");
      expect(definition.chooseDecision).toBeTypeOf("function");
      expect(definition.username).toMatch(/ Bot$/);
    }
    expect(botDefinition("unknown")).toBeUndefined();
    expect(botDefinitionForDeckId("unknown")).toBeUndefined();
  });

  it("produces a legal presentation for both possible turn orders", () => {
    for (const definition of botDefinitions) {
      const registered = precon(definition.deckId);
      expect(registered).toBeDefined();
      expect(registered?.format).toBe(definition.format);
      if (!registered) continue;
      for (const turnOrder of ["first", "second"] as const) {
        const presented = definition.presentationFor(opponent, turnOrder);
        expect(validatePresentation(registered.pool, presented, definition.format)).toMatchObject({
          ok: true,
        });
      }
    }
  });

  it("cannot distinguish changes to an opponent's hidden hand or deck order", () => {
    for (const definition of botDefinitions) {
      const registered = precon(definition.deckId)!;
      const botDeck: Decklist = {
        heroId: registered.pool.heroId,
        ...definition.presentationFor(opponent, "first"),
      };
      const state = createGame({
        decklists: [botDeck, opponent],
        cards: cardData,
        scripts,
        seed: 5_000 + definition.id.length,
        startPlayer: 0,
      });
      state.turn = 2;
      const { cardsRef: _cardsRef, scriptsRef: _scriptsRef, ...serializable } = state;
      const altered = JSON.parse(JSON.stringify(serializable)) as typeof state;
      altered.cardsRef = cardData;
      altered.scriptsRef = scripts;
      const hidden = altered.players[1]!;
      [hidden.hand[0], hidden.deck[0]] = [hidden.deck[0]!, hidden.hand[0]!];

      const firstView = projectStateFor(state, 0);
      const alteredView = projectStateFor(altered, 0);
      expect(alteredView, definition.id).toEqual(firstView);
      const legal = legalIntents(state, 0);
      const firstInput = {
        seat: 0,
        view: firstView,
        legal,
        cards: cardData,
        state,
      } as const;
      const alteredInput = {
        seat: 0,
        view: alteredView,
        legal,
        cards: cardData,
        state: altered,
      } as const;
      const firstDecision = definition.chooseDecision(firstInput);
      expect(firstDecision, definition.id).toEqual(definition.chooseDecision(alteredInput));
      expect(firstDecision.intent, definition.id).toEqual(definition.chooseIntent(firstInput));
    }
  }, 15_000);
});
