import { describe, expect, it } from "vitest";
import { projectStateFor } from "@fyendal/engine";
import type { CardView } from "@fyendal/shared";
import { scenario } from "../harness.js";

const NO_EQUIPMENT = { head: null, chest: null, arms: null, legs: null };

function cogView(g: ReturnType<typeof scenario>, seat: number): CardView {
  return projectStateFor(g.state, seat).players[0]!.board[0]!;
}

describe("standing choices declared on turn triggers", () => {
  it("projects Copper Cog's maintenance choice as the decision it later raises", () => {
    const g = scenario({
      active: 1,
      seats: [
        { hero: "rhinar", board: ["copper cog|3"] },
        { hero: "dorinthea" },
      ],
    });
    g.state.players[0]!.board[0]!.counters = { steam: 1 };

    expect(cogView(g, 0).turnTriggers).toEqual([{
      event: "start-of-turn",
      label: "Remove a steam counter or destroy this",
      labelMessage: { id: "card.trigger.steam.maintain" },
      choices: [{
        hook: "sea-cog-maintenance",
        options: [
          { value: "remove", message: { id: "common.option.remove" } },
          { value: "destroy", message: { id: "common.option.destroy" } },
        ],
      }],
    }]);
    expect(cogView(g, 1).turnTriggers?.[0]?.choices?.[0]?.hook).toBe("sea-cog-maintenance");

    g.endTurn();
    const choice = cogView(g, 0).turnTriggers![0]!.choices![0]!;
    expect(g.state.pendingDecision).toMatchObject({
      player: 0,
      chooseHook: choice.hook,
      options: choice.options.map((option) => option.value),
      sourceInstanceId: g.state.players[0]!.board[0]!.instanceId,
    });
  });

  it("implies a yes/no trigger-choice for Fyendal's Spring Tunic's optional trigger", () => {
    const g = scenario({
      active: 1,
      seats: [
        { hero: "rhinar", equipment: { ...NO_EQUIPMENT, chest: "fyendal's spring tunic|0" } },
        { hero: "dorinthea" },
      ],
    });
    const tunic = () => projectStateFor(g.state, 0).players[0]!.equipment.chest!;

    expect(tunic().turnTriggers).toMatchObject([{
      event: "start-of-turn",
      optional: true,
      choices: [{
        hook: "trigger-choice",
        options: [
          { value: "yes", message: { id: "common.option.yes" } },
          { value: "no", message: { id: "common.option.no" } },
        ],
      }],
    }]);

    g.endTurn();
    expect(g.state.pendingDecision).toMatchObject({
      player: 0,
      chooseHook: "trigger-choice",
      options: ["yes", "no"],
      sourceInstanceId: tunic().instanceId,
    });
  });
});
