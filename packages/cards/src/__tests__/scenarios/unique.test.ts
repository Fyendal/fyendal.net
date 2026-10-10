import { describe, expect, it } from "vitest";
import { scenario } from "../harness.js";

const INSATIABLE = "IAR221";
const SOUL_HARVESTER = "MON219";
const BLOOD_DEBT = Array.from({ length: 6 }, () => "ghostly visit|1");

function leviaSeat(extra: Record<string, unknown> = {}) {
  return { hero: "rhinar" as const, heroKey: "levia|0", resources: 3, ...extra };
}

function boardIds(g: ReturnType<typeof scenario>): string[] {
  return g.state.players[0]!.board.map((card) => card.cardId).sort();
}

describe("Unique (CR 8.3.48)", () => {
  it("lets the controller keep Blasmophet, the Insatiable Hunger over a Soul Harvester", () => {
    const g = scenario({ seats: [
      leviaSeat({ hand: ["doomsday|3"], banish: BLOOD_DEBT, board: ["blasmophet, the insatiable hunger|0"] }),
      { hero: "dorinthea" },
    ] });

    g.play("doomsday|3");
    expect(g.state.pendingDecision?.chooseHook).toBe("engine-unique-clear");
    expect(boardIds(g)).toEqual([INSATIABLE, SOUL_HARVESTER]);

    g.chooseCard(INSATIABLE).expectLog("Blasmophet, the Soul Harvester is cleared");
    expect(boardIds(g)).toEqual([INSATIABLE]);
    expect(g.state.pendingDecision).toBeNull();
  });

  it("lets the controller clear the Unique Blasmophet and keep the Soul Harvester", () => {
    const g = scenario({ seats: [
      leviaSeat({ hand: ["doomsday|3"], banish: BLOOD_DEBT, board: ["blasmophet, the insatiable hunger|0"] }),
      { hero: "dorinthea" },
    ] });

    g.play("doomsday|3").chooseOption("clear-unique");
    expect(boardIds(g)).toEqual([SOUL_HARVESTER]);
  });

  it("clears Blasmophet, the Insatiable Hunger while the hero is Blasmophet, Levia Consumed", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        heroKey: "blasmophet, levia consumed|0",
        hand: ["goremass summoning|3"],
        resources: 3,
      },
      { hero: "dorinthea" },
    ] });
    g.state.players[0]!.flags.banishedSixPlusThisTurn = true;

    g.play("goremass summoning|3").expectLog("Blasmophet, the Insatiable Hunger is cleared");
    expect(boardIds(g)).toEqual([]);
    expect(g.state.pendingDecision).toBeNull();
  });

  it("allows several non-Unique Blasmophets", () => {
    const g = scenario({ seats: [
      leviaSeat({ hand: ["doomsday|3"], banish: BLOOD_DEBT, board: ["blasmophet, the soul harvester|0"] }),
      { hero: "dorinthea" },
    ] });

    g.play("doomsday|3");
    expect(boardIds(g)).toEqual([SOUL_HARVESTER, SOUL_HARVESTER]);
  });
});
