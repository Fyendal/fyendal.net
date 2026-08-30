import { describe, expect, it } from "vitest";
import { legalIntents, projectStateFor } from "@fyendal/engine";
import { printingId, scenario } from "../harness.js";

const bravo = {
  hero: "rhinar" as const,
  heroKey: "bravo, flattering showman|0",
  weapons: [] as string[],
};

describe("SBR — Bravo and equipment", () => {
  it("Bravo turns a crush card in arsenal face up with +2 and dominate", () => {
    const g = scenario({
      seats: [
        {
          ...bravo,
          hand: ["thunder quake|3"],
          arsenal: ["boulder drop|1"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.state.players[0]!.arsenal[0]!.faceDown = true;

    g.activate("bravo, flattering showman|0", { pitch: ["thunder quake|3"] })
      .chooseCard("boulder drop|1")
      .expectFaceDown(0, "boulder drop|1", false)
      .expectAP(0, 1);

    const card = g.state.players[0]!.arsenal[0]!;
    expect(g.state.players[0]!.hero.tapped).toBe(true);
    expect(card.tempPower).toBe(2);
    expect(card.grantedKeywords).toContain("dominate");
  });

  it("Sledge attacks for 6 and Basalt Boots gets +1 defense with a Seismic Surge", () => {
    const sledge = scenario({
      seats: [
        { ...bravo, weapons: ["sledge of anvilheim|0"], hand: ["thunder quake|3", "macho grande|3"] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    sledge.attackWithWeapon("sledge of anvilheim|0", {
      pitch: ["thunder quake|3", "macho grande|3"],
    }).expectAttackValue(6);

    const boots = scenario({
      active: 1,
      seats: [
        {
          ...bravo,
          board: ["seismic surge|0"],
          hand: [],
          equipment: { legs: "basalt boots|0" },
        },
        { hero: "dorinthea", hand: [], resources: 1 },
      ],
    });
    boots.attackWithWeapon("dawnblade, resplendent|0").blockWith("basalt boots|0").settle().expectFinalDefense(2);
  });

  it("Magmatic Carapace pays a floating resource and taps when an aura is played", () => {
    const g = scenario({
      seats: [
        {
          ...bravo,
          hand: ["edge of their seats|3", "thunder quake|3"],
          resources: 1,
          equipment: { chest: "magmatic carapace|0" },
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("edge of their seats|3", { pitch: ["thunder quake|3"], settle: false })
      .passPriority()
      .passPriority()
      .chooseOption("pay 1")
      .expectInZone(0, "seismic surge|0", "board")
      .expectResources(0, 0);
    expect(g.state.players[0]!.equipment.chest?.tapped).toBe(true);
  });

  it("Thunder Quake Heave pitches during the end-phase trigger and creates 3 Seismic Surges", () => {
    const g = scenario({
      seats: [
        { ...bravo, hand: ["thunder quake|3", "edge of their seats|3"] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.settle().doRaw({ kind: "pass" }).settle();
    g.chooseOption("pitch Edge of Their Seats");
    g.expectInZone(0, "thunder quake|3", "arsenal").expectZoneSize(0, "board", 3);
    expect(g.state.players[0]!.arsenal[0]?.faceDown).not.toBe(true);
  });
});

describe("SBR — crush attacks", () => {
  it("Boulder Drop makes the defending hero put a chosen hand card on top", () => {
    const g = scenario({
      seats: [
        { ...bravo, hand: ["boulder drop|1", "thunder quake|3"] },
        { hero: "dorinthea", hand: ["head jab|1"] },
      ],
    });

    g.play("boulder drop|1", { pitch: ["thunder quake|3"] })
      .blockWith()
      .settle()
      .chooseCard("head jab|1")
      .expectDeckTop(1, "head jab|1");
  });

  it("Chokeslam prevents opposing attack-action power gains next action phase", () => {
    const g = scenario({
      seats: [
        { ...bravo, hand: ["chokeslam|1", "thunder quake|3", "macho grande|3"] },
        { hero: "dorinthea", hand: ["nimblism|1", "head jab|1"] },
      ],
    });

    g.play("chokeslam|1", { pitch: ["thunder quake|3", "macho grande|3"] })
      .blockWith()
      .settle()
      .endTurn()
      .play("nimblism|1")
      .play("head jab|1")
      .expectAttackValue(3);
  });

  it("Fault Line gets +1 with an arsenal and bottoms every arsenal on crush", () => {
    const g = scenario({
      seats: [
        {
          ...bravo,
          hand: ["fault line|1", "thunder quake|3"],
          arsenal: ["head jab|1"],
        },
        { hero: "dorinthea", hand: [], arsenal: ["raging onslaught|1"] },
      ],
    });

    g.play("fault line|1", { pitch: ["thunder quake|3"] })
      .expectAttackValue(8)
      .blockWith()
      .settle()
      .expectZoneSize(0, "arsenal", 0)
      .expectZoneSize(1, "arsenal", 0)
      .expectDeckBottom(0, "head jab|1")
      .expectDeckBottom(1, "raging onslaught|1");
  });

  it("Crush the Weak blocks low-base-power attack actions next action phase", () => {
    const g = scenario({
      seats: [
        { ...bravo, hand: ["crush the weak|3", "thunder quake|3"] },
        { hero: "dorinthea", hand: ["head jab|1", "raging onslaught|1", "raging onslaught|3"] },
      ],
    });

    g.play("crush the weak|3", { pitch: ["thunder quake|3"] })
      .blockWith()
      .settle()
      .endTurn();

    const plays = legalIntents(g.state, 1).filter((intent) => intent.kind === "play-card");
    const headJab = g.state.players[1]!.hand.find((card) => card.cardId === printingId("head jab|1"))!;
    const onslaught = g.state.players[1]!.hand.find(
      (card) => card.cardId === printingId("raging onslaught|1"),
    )!;
    expect(plays.some((intent) => intent.kind === "play-card" && intent.instanceId === headJab.instanceId)).toBe(false);
    expect(plays.some((intent) => intent.kind === "play-card" && intent.instanceId === onslaught.instanceId)).toBe(true);
  });

  it("Flatten the Field destroys an opposing Seismic Surge on crush", () => {
    const g = scenario({
      seats: [
        { ...bravo, hand: ["flatten the field|3", "thunder quake|3", "macho grande|3"] },
        { hero: "dorinthea", hand: [], board: ["seismic surge|0"] },
      ],
    });

    g.play("flatten the field|3", { pitch: ["thunder quake|3", "macho grande|3"] })
      .blockWith()
      .settle()
      .expectNotInZone(1, "seismic surge|0", "board");
  });
});

describe("SBR — defensive and token effects", () => {
  it("Crash and Bash reveals crush to create a Seismic Surge", () => {
    const g = scenario({
      active: 1,
      seats: [
        { ...bravo, hand: ["crash and bash|1", "boulder drop|1"] },
        { hero: "dorinthea", hand: [], resources: 1 },
      ],
    });

    g.attackWithWeapon("dawnblade, resplendent|0")
      .blockWith("crash and bash|1")
      .passPriority()
      .passPriority()
      .chooseCard("boulder drop|1")
      .expectLog("Crash and Bash reveals Boulder Drop from hand")
      .expectInZone(0, "seismic surge|0", "board");
  });

  it("Clash of Vigor creates Vigor for the clash winner", () => {
    const g = scenario({
      active: 1,
      seats: [
        { ...bravo, hand: ["clash of vigor|3"], deck: ["thunder quake|3"] },
        { hero: "dorinthea", hand: [], deck: ["head jab|1"], resources: 1 },
      ],
    });

    g.attackWithWeapon("dawnblade, resplendent|0")
      .blockWith("clash of vigor|3")
      .passPriority()
      .passPriority()
      .expectInZone(0, "vigor|0", "board");
  });

  it("Seismic Surge breaks at the action phase and discounts the next Guardian attack", () => {
    const g = scenario({
      active: 1,
      seats: [
        {
          ...bravo,
          board: ["seismic surge|0"],
          hand: ["boulder drop|1", "thunder quake|3"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.endTurn().expectNotInZone(0, "seismic surge|0", "board");
    expect(projectStateFor(g.state, 0).ongoing).toContainEqual({
      seat: 0,
      cardId: printingId("seismic surge|0"),
      label: "attack costs 1 less · next attack",
    });
    g.play("boulder drop|1", { pitch: ["thunder quake|3"] })
      .expectResources(0, 1);
    expect(projectStateFor(g.state, 0).ongoing).not.toContainEqual(
      expect.objectContaining({ cardId: printingId("seismic surge|0") }),
    );
  });

  it("gives priority over Seismic Surge after assigning the turn action point", () => {
    const g = scenario({
      active: 1,
      seats: [
        {
          ...bravo,
          board: ["seismic surge|0", "diamond amulet|3"],
          hand: ["sigil of solace|1"],
        },
        { hero: "dorinthea", hand: ["sigil of solace|1"] },
      ],
    });

    g.doRaw({ kind: "pass" });
    if (g.state.stackResume === "end-action-phase") {
      g.passPriority();
    }
    if (g.state.pendingDecision?.kind === "arsenal") {
      g.doRaw({ kind: "choose", optionId: "pass" });
    }

    expect(g.state.stackResume).toBe("grant-turn-action");
    expect(g.state.stack[0]?.label).toContain("Destroy Seismic Surge");
    expect(g.state.pendingDecision).toMatchObject({ kind: "priority-window", player: 0 });
    g.expectAP(0, 1).expectInZone(0, "seismic surge|0", "board");
    expect(legalIntents(g.state, 0)).toContainEqual(expect.objectContaining({
      kind: "play-card",
      instanceId: g.state.players[0]!.hand.find(
        (card) => card.cardId === printingId("sigil of solace|1"),
      )!.instanceId,
    }));

    g.passPriority();
    expect(g.state.pendingDecision).toMatchObject({ kind: "priority-window", player: 1 });
    expect(legalIntents(g.state, 1)).toContainEqual(expect.objectContaining({
      kind: "play-card",
      instanceId: g.state.players[1]!.hand.find(
        (card) => card.cardId === printingId("sigil of solace|1"),
      )!.instanceId,
    }));
    g.passPriority();

    g.expectNotInZone(0, "seismic surge|0", "board").expectAP(0, 1);
  });

  it("does not reset action points gained while a beginning trigger is pending", () => {
    const g = scenario({
      active: 1,
      seats: [
        { ...bravo, board: ["seismic surge|0"], hand: ["blink|3"] },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.doRaw({ kind: "pass" });
    expect(g.state.stackResume).toBe("end-action-phase");
    g.passPriority();
    expect(g.state.pendingDecision).toMatchObject({ kind: "priority-window", player: 0 });
    g.react("blink|3", { settle: false }).settle();

    g.expectAP(0, 2).expectNotInZone(0, "seismic surge|0", "board");
  });

  it("Zealous Belting gains go again only with a higher-power pitch card", () => {
    const yes = scenario({
      seats: [
        { ...bravo, hand: ["zealous belting|1", "thunder quake|3"] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    yes.play("zealous belting|1", { pitch: ["thunder quake|3"] })
      .blockWith()
      .settle()
      .expectAP(0, 1);

    const no = scenario({
      seats: [
        { ...bravo, hand: ["zealous belting|1", "head jab|3", "raging onslaught|3"] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    no.play("zealous belting|1", { pitch: ["head jab|3"] })
      .blockWith()
      .settle()
      .expectAP(0, 0);
  });

  it("Thunder Quake remains a playable 8-power attack", () => {
    const g = scenario({
      seats: [
        { ...bravo, hand: ["thunder quake|3", "macho grande|3", "crush the weak|3"] },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("thunder quake|3", { pitch: ["macho grande|3", "crush the weak|3"] })
      .expectAttackValue(8);
  });
});
