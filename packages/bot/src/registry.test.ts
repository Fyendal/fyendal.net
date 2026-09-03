import { cardData, precon, scripts, validatePresentation } from "@fyendal/cards";
import { createGame, legalIntents, projectStateFor } from "@fyendal/engine";
import type { CardView, Decklist, GameIntent } from "@fyendal/shared";
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
    expect(botDefinitions).toHaveLength(7);
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
        expect(validatePresentation(registered.pool, presented, definition.format, {
          cardPoolMode: definition.presentationCardPoolMode,
        })).toMatchObject({
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

  it("makes every bot survive source-side damage increases", () => {
    for (const [index, definition] of botDefinitions.entries()) {
      const registered = precon(definition.deckId)!;
      const botDeck: Decklist = {
        heroId: registered.pool.heroId,
        ...definition.presentationFor(opponent, "second"),
      };
      const state = createGame({
        decklists: [botDeck, opponent],
        cards: cardData,
        scripts,
        seed: 5_100 + index,
        startPlayer: 1,
      });
      const blockers: CardView[] = [
        { instanceId: 510_000 + index * 2, cardId: "ASR007", owner: 0, defense: 2 },
        { instanceId: 510_001 + index * 2, cardId: "ASR012", owner: 0, defense: 3 },
      ];
      const view = projectStateFor(state, 0);
      view.turn = 2;
      view.activePlayer = 1;
      view.priorityPlayer = 0;
      view.phase = "defend";
      view.players[0].life = 4;
      view.players[0].hand = blockers;
      view.players[0].handCount = blockers.length;
      view.pendingDecision = { player: 0, kind: "defend", prompt: "Choose defenders" };
      view.chain = [{
        attackingCard: { instanceId: 519_000 + index, cardId: "PEN202", owner: 1 },
        defendingCards: [],
        attackValue: 5,
        defenseValue: 0,
        damage: 6,
        resolved: false,
        reactions: [],
      }];
      const legal: GameIntent[] = [
        { kind: "defend", instanceIds: [] },
        { kind: "stage-defenders", instanceIds: [blockers[0]!.instanceId] },
        { kind: "stage-defenders", instanceIds: [blockers[1]!.instanceId] },
      ];

      expect(definition.chooseIntent({ seat: 0, view, legal, cards: cardData }), definition.id)
        .toEqual({ kind: "stage-defenders", instanceIds: [blockers[1]!.instanceId] });
    }
  });
});
