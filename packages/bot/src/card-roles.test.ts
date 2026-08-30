import { cardData, decklists, scripts } from "@fyendal/cards";
import { createGame, projectStateFor } from "@fyendal/engine";
import type { CardView } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import { defaultCardRoles } from "./card-roles.js";
import type { BotPolicyInput } from "./policy.js";

describe("shared card roles", () => {
  it("prices an ordinary blue block-three below an equivalent red offense for pitching and blocking", () => {
    const state = createGame({
      decklists: [decklists.dorinthea, decklists.rhinar],
      cards: cardData,
      scripts,
      seed: 9_337,
      startPlayer: 0,
    });
    const blue: CardView = { instanceId: 93_371, cardId: "HVY209", owner: 0 };
    const red: CardView = { instanceId: 93_372, cardId: "HVY210", owner: 0 };
    const input: BotPolicyInput = {
      seat: 0,
      view: projectStateFor(state, 0),
      legal: [],
      cards: cardData,
    };

    const blueRoles = defaultCardRoles(blue, input);
    const redRoles = defaultCardRoles(red, input);
    expect(blueRoles.tags).toContain("blue-block-3");
    expect(redRoles.tags).toContain("red-offense");
    expect(blueRoles.pitchCost).toBeLessThan(redRoles.pitchCost);
    expect(blueRoles.blockCost).toBeLessThan(redRoles.blockCost);
    expect(blueRoles.retainValue).toBeLessThan(redRoles.retainValue);
  });
});
