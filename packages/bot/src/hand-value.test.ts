import { cardData, decklists, scripts } from "@fyendal/cards";
import { createGame, projectStateFor } from "@fyendal/engine";
import { describe, expect, it } from "vitest";
import { decklistsFromState } from "./deck-knowledge.js";
import { cardOpportunity, type HeroRulesFactory } from "./hand-value.js";
import type { BotPolicyInput } from "./policy.js";

const genericRules: HeroRulesFactory = () => ({ name: "generic" });

describe("hand value cache", () => {
  it("misses when a decklist changes content but not length", () => {
    const state = createGame({
      decklists: [decklists.dorinthea, decklists.rhinar], cards: cardData, scripts, seed: 77, startPlayer: 0,
    });
    const { own = [], opponent } = decklistsFromState(state, 0);
    const card = projectStateFor(state, 0).players[0].hand[0]!;
    // Opportunity is the card's value over the average draw, so a deck of one repeated id isolates that draw.
    const opportunityWith = (id: string) => cardOpportunity(card, {
      seat: 0, view: projectStateFor(state, 0), legal: [], cards: cardData,
      decklists: { own: own.map(() => id), opponent },
    } satisfies BotPolicyInput, genericRules);
    const ids = [...new Set(own)];
    const values = ids.map(opportunityWith);
    const weakestDraw = ids[values.indexOf(Math.max(...values))]!;
    const strongestDraw = ids[values.indexOf(Math.min(...values))]!;

    expect(opportunityWith(strongestDraw)).toBeLessThan(opportunityWith(weakestDraw));
  });
});
