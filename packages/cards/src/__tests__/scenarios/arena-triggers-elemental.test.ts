import { describe, expect, it } from "vitest";
import { printingId, scenario } from "../harness.js";
import type { Scenario } from "../harness.js";
import { cardData } from "../../index.js";
import { functionalKeyOf } from "../../functional.js";

// Enter and leave arena abilities in the elemental and assorted sets are
// triggered layers: each waits on the stack for priority before it resolves.

const BLUE = "wrecker romp|3";
const YELLOW = "raging onslaught|2";
const EARTH = "autumn's touch|3";
const ICE = "winter's grasp|3";

function resolveTop(g: Scenario): Scenario {
  return g.passPriority().passPriority();
}

/** Answer the open choice without settling, using the option naming `key`. */
function chooseRaw(g: Scenario, key: string): Scenario {
  const pd = g.state.pendingDecision;
  const wanted = functionalKeyOf(cardData[printingId(key)]!);
  const ids = g.state.players.flatMap((player) => [...player.hand, ...player.graveyard, ...player.board, player.hero]);
  const card = ids.find(
    (candidate) =>
      functionalKeyOf(cardData[candidate.cardId]!) === wanted && pd?.options?.includes(String(candidate.instanceId)),
  );
  if (!card) throw new Error(`no option for "${key}" (options: ${pd?.options?.join(", ")})`);
  return g.doRaw({ kind: "choose", optionId: String(card.instanceId) });
}

function chooseFragment(g: Scenario, fragment: string): Scenario {
  const option = g.state.pendingDecision?.options?.find((o) => o.toLowerCase().includes(fragment));
  if (!option) throw new Error(`no option matching "${fragment}"`);
  return g.doRaw({ kind: "choose", optionId: option });
}

describe("elemental and assorted enter/leave arena triggers use the stack", () => {
  it("Embolden draws only when its conditional enter trigger resolves", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", resources: 5, board: ["embolden|1"], hand: ["embolden|2"], deck: [BLUE] },
        { hero: "dorinthea" },
      ],
    });

    g.play("embolden|2", { settle: false });
    g.passUntilLayer("Draw a card").expectHandSize(0, 0);
    resolveTop(g).expectHandSize(0, 1);
  });

  it("Embolden without another non-token aura puts no layer on the stack", () => {
    const g = scenario({
      seats: [{ hero: "rhinar", resources: 5, hand: ["embolden|2"] }, { hero: "dorinthea" }],
    });

    g.play("embolden|2");
    expect(g.state.stack).toEqual([]);
    g.expectInZone(0, "embolden|2", "board").expectHandSize(0, 0);
  });

  it("fused Strength of Sequoia creates its Seismic Surge from a stack layer", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", heroKey: "oldhim|0", weapons: [], hand: ["strength of sequoia|2", EARTH, EARTH] },
        { hero: "dorinthea" },
      ],
    });

    g.play("strength of sequoia|2", { pitch: [EARTH], settle: false });
    chooseRaw(g, EARTH);
    g.passUntilLayer("Create a Seismic Surge token");
    g.expectInZone(0, "strength of sequoia|2", "board").expectNotInZone(0, "seismic surge|0", "board");
    resolveTop(g).expectInZone(0, "seismic surge|0", "board");
  });

  it("unfused Strength of Sequoia has no enter trigger", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", heroKey: "oldhim|0", weapons: [], hand: ["strength of sequoia|2", EARTH, EARTH] },
        { hero: "dorinthea" },
      ],
    });

    g.play("strength of sequoia|2", { pitch: [EARTH] }).chooseOption("no");
    expect(g.state.stack).toEqual([]);
    g.expectInZone(0, "strength of sequoia|2", "board").expectNotInZone(0, "seismic surge|0", "board");
  });

  it("fused Emerging Avalanche asks for the Frostbite hero when its enter trigger resolves", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", heroKey: "oldhim|0", weapons: [], hand: ["emerging avalanche|2", ICE, ICE] },
        { hero: "dorinthea" },
      ],
    });

    g.play("emerging avalanche|2", { pitch: [ICE], settle: false });
    chooseRaw(g, ICE);
    g.passUntilTargetDeclaration();
    expect(g.stackLabels()[0]).toBe("Create a Frostbite");
    g.declareTargetRaw(1).expectNotInZone(1, "frostbite|0", "board");
    resolveTop(g);
    g.settle().expectInZone(1, "frostbite|0", "board");
  });

  it("Chains of Eminence names a card when its enter trigger resolves", () => {
    const g = scenario({
      seats: [{ hero: "rhinar", resources: 20, hand: ["chains of eminence|1"] }, { hero: "dorinthea" }],
    });

    g.play("chains of eminence|1", { settle: false });
    g.passUntilLayer("Name a card");
    expect(g.state.pendingDecision?.kind).not.toBe("choose-name");
    resolveTop(g);
    expect(g.state.pendingDecision?.kind).toBe("choose-name");
    g.chooseName("Head Jab");
  });

  it("Channel the Millennium Tree amps only when its enter trigger resolves", () => {
    const g = scenario({
      seats: [{ hero: "rhinar", resources: 5, hand: ["channel the millennium tree|1"] }, { hero: "dorinthea" }],
    });

    g.play("channel the millennium tree|1", { settle: false });
    g.passUntilLayer("Amp 3");
    expect(g.state.players[0]!.flags.nextArcaneBonus ?? 0).toBe(0);
    resolveTop(g);
    expect(g.state.players[0]!.flags.nextArcaneBonus).toBe(3);
  });

  it("Draw a Crowd makes each hero draw only when its enter trigger resolves", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", resources: 5, hand: ["draw a crowd|3"], deck: [BLUE] },
        { hero: "dorinthea", hand: [], deck: [BLUE] },
      ],
    });

    g.play("draw a crowd|3", { settle: false });
    g.passUntilLayer("Each hero draws a card").expectHandSize(0, 0).expectHandSize(1, 0);
    resolveTop(g).expectHandSize(0, 1).expectHandSize(1, 1);
  });

  it("Clap 'em in Irons declares its Pirate target as the trigger goes on the stack", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", resources: 5, hand: ["clap 'em in irons|3"] },
        { hero: "dorinthea", heroKey: "puffin|0" },
      ],
    });

    g.play("clap 'em in irons|3", { settle: false });
    while (g.state.stack[0]?.card) g.passPriority();

    expect(g.state.pendingDecision?.chooseHook).toBe("trigger-target");
    const puffin = g.state.players[1]!.hero.instanceId;
    g.doRaw({ kind: "choose", optionId: String(puffin) });
    expect(g.stackLabels().includes("Tap target Pirate hero or ally")).toBe(true);
    expect(g.state.players[1]!.hero.tapped).toBeFalsy();

    resolveTop(g);
    expect(g.state.players[1]!.hero.tapped).toBe(true);
  });

  it("Clap 'em in Irons' trigger ceases to exist without a Pirate target", () => {
    const g = scenario({
      seats: [{ hero: "rhinar", resources: 5, hand: ["clap 'em in irons|3"] }, { hero: "dorinthea" }],
    });

    g.play("clap 'em in irons|3");
    expect(g.state.stack).toEqual([]);
    g.expectInZone(0, "clap 'em in irons|3", "board");
  });

  it("Sigil of Sanctuary creates its Embodiment from a leave trigger", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["chorus of the amphitheater|1", BLUE] },
        { hero: "dorinthea", board: ["sigil of sanctuary|3"] },
      ],
    });

    g.play("chorus of the amphitheater|1", { pitch: [BLUE] }).chooseOption("opposing hero");
    chooseFragment(g, "use");
    g.passUntilLayer("Create Embodiment of Earth");
    g.expectInZone(1, "sigil of sanctuary|3", "graveyard").expectNotInZone(1, "embodiment of earth|0", "board");
    resolveTop(g);
    g.settle().expectInZone(1, "embodiment of earth|0", "board");
  });

  it("Arcane Cussing creates Runechants from a leave trigger during your turn", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", board: ["arcane cussing|1"], hand: ["chorus of the amphitheater|3", BLUE] },
        { hero: "dorinthea" },
      ],
    });

    g.play("chorus of the amphitheater|3", { pitch: [BLUE] });
    chooseFragment(g, "opposing hero");
    g.passUntilLayer("Create 3 Runechants");
    g.expectInZone(0, "arcane cussing|1", "graveyard").expectZoneSize(0, "board", 0);
    resolveTop(g).expectZoneSize(0, "board", 3);
  });

  it("Waning Vengeance creates a Spectral Shield from a conditional leave trigger", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["enigma chimera|1", YELLOW] },
        { hero: "dorinthea", board: ["waning vengeance|1"], hand: ["unmovable|3", "big blue sky|3"] },
      ],
    });

    g.play("enigma chimera|1", { pitch: [YELLOW] }).blockWith();
    for (let i = 0; i < 12 && g.state.pendingDecision?.player !== 1; i++) g.passPriority();
    g.react("unmovable|3", { pitch: ["big blue sky|3"], settle: false }).settle();
    chooseFragment(g, "destroy");
    g.passUntilLayer("Create a Spectral Shield token");
    g.expectInZone(1, "waning vengeance|1", "graveyard").expectNotInZone(1, "spectral shield|0", "board");
    resolveTop(g);
    g.settle().expectInZone(1, "spectral shield|0", "board");
  });

  it("Sigil of Silphidae offers its banish from a leave trigger", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar" },
        { hero: "dorinthea", board: ["sigil of silphidae|3"], graveyard: ["malefic incantation|1"] },
      ],
    });

    g.settle().passActionPhase();
    g.passUntilLayer("You may banish another aura from your graveyard");
    g.expectInZone(1, "sigil of silphidae|3", "graveyard").expectLife(0, 20);
    resolveTop(g);
    chooseRaw(g, "malefic incantation|1").settle();
    g.expectInZone(1, "malefic incantation|1", "banish").expectLife(0, 19);
  });
});
