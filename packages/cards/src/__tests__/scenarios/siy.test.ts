import { describe, expect, it } from "vitest";
import { legalIntents, projectStateFor } from "@fyendal/engine";
import { scenario } from "../harness.js";

const IYSLANDER = "iyslander|0";
const BLUE = "raging onslaught|3";

function iyslander(overrides: Record<string, unknown> = {}) {
  return {
    hero: "rhinar" as const,
    heroKey: IYSLANDER,
    weapons: ["crucible of aetherweave|0"],
    ...overrides,
  };
}

describe("SIY — Iyslander and Frostbite", () => {
  it("plays a face-down blue action from arsenal during her own turn", () => {
    const s = scenario({
      seats: [
        iyslander({ hand: [BLUE], arsenalFaceDown: ["aether hail|3"] }),
        { hero: "dorinthea", hand: [] },
      ],
    });

    const arsenal = s.state.players[0]!.arsenal[0]!;
    expect(arsenal.faceDown).toBe(true);
    expect(
      legalIntents(s.state, 0).some(
        (intent) =>
          intent.kind === "play-from-arsenal" &&
          intent.instanceId === arsenal.instanceId &&
          intent.asInstant !== true,
      ),
    ).toBe(true);

    s.play("aether hail|3", { fromArsenal: true, pitch: [BLUE] })
      .chooseOption("opposing hero")
      .expectLife(1, 18);
  });

  it("Ice Eternal announces X and pitches for it before the card is played", () => {
    const s = scenario({
      seats: [
        iyslander({ hand: ["ice eternal|3", BLUE, BLUE] }),
        { hero: "dorinthea", hand: [] },
      ],
    });
    s.play("ice eternal|3", { settle: false })
      .chooseOption("X = 3")
      .chooseOption("pitch")
      .settle()
      .chooseOption("opposing hero")
      .expectZoneSize(1, "board", 3)
      .expectZoneSize(0, "pitch", 2);
  });

  it("plays a blue Ice action from arsenal during the opponent's turn and creates Frostbite", () => {
    const s = scenario({
      active: 1,
      seats: [
        iyslander({ arsenal: ["frosting|3"] }),
        { hero: "dorinthea", hand: ["wounded bull|1", BLUE] },
      ],
    });

    s.play("wounded bull|1", { pitch: [BLUE], settle: false });
    s.passPriority(); // the attacking player yields the layer window
    s.react("frosting|3", { settle: false });
    s.passPriority().passPriority(); // resolve Iyslander's card-play trigger
    s.expectInZone(1, "frostbite|0", "board");
    s.passPriority().passPriority();
    s.chooseOption("opposing hero");
    s.expectLife(1, 19).blockWith().settle();
  });

  it("each Frostbite increases a card's cost, then destroys itself on that play", () => {
    const s = scenario({
      seats: [
        iyslander({ hand: ["frosting|3", BLUE], board: ["frostbite|0"] }),
        { hero: "dorinthea" },
      ],
    });

    s.play("frosting|3", { pitch: [BLUE] }).chooseOption("opposing hero");
    s.expectResources(0, 2)
      .expectZoneSize(0, "board", 0)
      .expectLife(1, 19);
  });

  it("destroys Frostbite at the beginning of its controller's end phase", () => {
    const s = scenario({
      seats: [
        iyslander({ board: ["frostbite|0"] }),
        { hero: "dorinthea" },
      ],
    });
    s.endTurn().expectZoneSize(0, "board", 0);
  });

  it("also taxes a from-hand Amp ability before destroying itself", () => {
    const s = scenario({
      seats: [
        iyslander({ hand: ["arcane twining|3", BLUE], board: ["frostbite|0"] }),
        { hero: "dorinthea" },
      ],
    });
    s.activate("arcane twining|3", { pitch: [BLUE] })
      .expectResources(0, 2)
      .expectZoneSize(0, "board", 0)
      .expectInZone(0, "arcane twining|3", "graveyard");
  });
});

describe("SIY — Ice Fusion", () => {
  it("fused Polar Cap deals arcane damage and gives the damaged hero Frostbite", () => {
    const s = scenario({
      seats: [
        iyslander({ hand: ["polar cap|1", "winter's bite|3", BLUE] }),
        { hero: "dorinthea" },
      ],
    });

    s.play("polar cap|1", { pitch: [BLUE] })
      .chooseCard("winter's bite|3")
      .chooseOption("opposing hero")
      .expectLife(1, 16)
      .expectInZone(1, "frostbite|0", "board");
  });

  it("an any-target arcane spell can destroy an opposing ally", () => {
    const s = scenario({
      seats: [
        iyslander({ hand: ["frosting|3"] }),
        { hero: "dorinthea", board: ["limpit, hop-a-long|2"] },
      ],
    });
    s.play("frosting|3").chooseOption("ally");
    s.expectNotInZone(1, "limpit, hop-a-long|2", "board")
      .expectInZone(1, "limpit, hop-a-long|2", "graveyard");
  });

  it("fused Brain Freeze puts a cost-0 opposing action on top of its deck", () => {
    const s = scenario({
      seats: [
        iyslander({ hand: ["brain freeze|3", "winter's bite|3"] }),
        { hero: "dorinthea", hand: ["scar for a scar|1", "wounded bull|1"], deck: [BLUE] },
      ],
    });

    s.play("brain freeze|3").chooseCard("winter's bite|3");
    expect(s.state.pendingDecision?.chooseHook).toBe("brain-freeze-top");
    expect(s.state.pendingDecision?.revealedCardIds).toHaveLength(2);
    expect(projectStateFor(s.state, 1).pendingDecision?.revealedCards).toHaveLength(2);
    s.chooseCard("scar for a scar|1").expectDeckTop(1, "scar for a scar|1");
  });
});

describe("SIY — freeze, prevention, and Stir", () => {
  it("Cold Snap freezes an arsenal card until the start of Iyslander's next turn", () => {
    const s = scenario({
      seats: [
        iyslander({ hand: ["cold snap|3", BLUE] }),
        { hero: "dorinthea", arsenal: ["wounded bull|1"] },
      ],
    });

    s.play("cold snap|3", { pitch: [BLUE] })
      .chooseOption("opposing hero")
      .chooseOption("arsenal");

    const frozen = s.state.players[1]!.arsenal[0]!;
    expect(frozen.counters?.frozenUntilTurn).toBe(3);
    s.endTurn();
    expect(
      legalIntents(s.state, 1).some(
        (intent) =>
          intent.kind === "play-from-arsenal" &&
          intent.instanceId === frozen.instanceId,
      ),
    ).toBe(false);
  });

  it("Pyroglyphic Protection prevents 1 from each arcane source and expires next action phase", () => {
    const s = scenario({
      active: 1,
      seats: [
        iyslander({ board: ["pyroglyphic protection|3"] }),
        { hero: "dorinthea", hand: ["frosting|3"] },
      ],
    });

    s.play("frosting|3").chooseOption("opposing hero");
    s.expectLife(0, 18).expectInZone(0, "pyroglyphic protection|3", "board");
    s.endTurn().expectNotInZone(0, "pyroglyphic protection|3", "board");
  });

  it("Stir lets the next Wizard action ride an instant window and gives its arcane effect +1", () => {
    const s = scenario({
      seats: [
        iyslander({
          hand: ["stir the aetherwinds|3", BLUE, "frost spike|3", "frosting|3"],
          equipment: { head: null },
        }),
        { hero: "dorinthea" },
      ],
    });

    s.play("stir the aetherwinds|3", { pitch: [BLUE] });
    s.play("frost spike|3", { settle: false });
    s.react("frosting|3", { settle: false });
    s.passPriority().passPriority();
    s.chooseOption("opposing hero");
    s.expectLife(1, 18);
    expect(s.state.players[0]!.flags.nextWizardNonAttackAsInstant).toBe(false);
    // Frost Spike now resolves underneath the arcane action.
    s.chooseOption("0:head");
    s.expectInZone(0, "frostbite|0", "board");
  });
});
