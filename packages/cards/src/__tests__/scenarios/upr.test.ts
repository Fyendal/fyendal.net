import { describe, expect, it } from "vitest";
import { legalIntents, projectStateFor } from "@fyendal/engine";
import { cardData, scripts } from "../../index.js";
import { printingId, scenario } from "../harness.js";

const BLUE = "wrecker romp|3";
const RED = "wrecker romp|1";

describe("UPR — registration and heroes", () => {
  it("registers every printing, invocation back, and hero", () => {
    expect(cardData.UPR002?.name).toBe("Dromai");
    expect(cardData.UPR045?.name).toBe("Fai");
    expect(cardData.UPR103?.name).toBe("Iyslander");
    expect(cardData.UPR009?.backId).toBe("UPR009B");
    expect(cardData.UPR009B?.name).toBe("Azvolai");
    expect(cardData.UPR003?.name).toBe("Storm of Sandikai");
    expect(Object.keys(cardData).filter((id) => id.startsWith("UPR"))).toHaveLength(237);
    expect(scripts.UPR002).toBeDefined();
    expect(scripts.UPR045).toBeDefined();
    expect(scripts.UPR103).toBeDefined();
  });

  it("Dromai creates an Ash whenever she pitches a red card", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", heroKey: "dromai|0", resources: 2, hand: ["raging onslaught|1", RED], weapons: ["storm of sandikai|0"] },
        { hero: "dorinthea" },
      ],
    });
    s.play("raging onslaught|1", { pitch: [RED] });
    s.expectInZone(0, "ash|0", "board");
  });

  it("an invocation transforms Ash into its linked Dragon back face", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", heroKey: "dromai|0", hand: ["invoke azvolai|1"], board: ["ash|0"], weapons: ["storm of sandikai|0"] },
        { hero: "dorinthea" },
      ],
    });
    s.play("invoke azvolai|1").chooseCard("ash|0");
    s.expectInZone(0, "azvolai|0", "board");
  });

  it("Storm of Sandikai grants a once-per-turn attack to Dragon allies", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", heroKey: "dromai|0", board: ["azvolai|0"], weapons: ["storm of sandikai|0"] },
        { hero: "dorinthea" },
      ],
    });
    s.activate("azvolai|0").chooseCard("DVR001").chooseOption("done").blockWith().settle();
    s.expectLife(1, 17);
  });

  it("Fai returns a Phoenix Flame from his graveyard", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", heroKey: "fai|0", hand: [BLUE], graveyard: ["phoenix flame|1"], weapons: ["searing emberblade|0"] },
        { hero: "dorinthea" },
      ],
    });
    s.activate("fai|0", { pitch: [BLUE] }).chooseCard("phoenix flame|1");
    s.expectInZone(0, "phoenix flame|1", "hand");
  });

  it("Iyslander plays a blue Ice action from arsenal on the opponent's turn and creates Frostbite", () => {
    const s = scenario({
      active: 1,
      seats: [
        { hero: "rhinar", heroKey: "iyslander|0", hand: [BLUE], arsenalFaceDown: ["cold snap|3"], weapons: [] },
        { hero: "dorinthea", hand: ["snatch|1"] },
      ],
    });
    s.play("snatch|1").blockWith().passPriority().react("cold snap|3", { pitch: [BLUE] }).chooseOption("opposing hero");
    s.expectInZone(1, "frostbite|0", "board");
  });
});

describe("UPR — rules regression coverage", () => {
  it("Phoenix Form counts Phoenix Flames controlled on the combat chain", () => {
    const noFlames = scenario({
      seats: [
        { hero: "rhinar", hand: ["phoenix form|1"], weapons: [] },
        { hero: "dorinthea" },
      ],
    });
    noFlames.play("phoenix form|1").expectAttackValue(3);
    expect(noFlames.state.chain.at(-1)?.goAgain).toBe(false);

    const oneFlame = scenario({
      seats: [
        { hero: "rhinar", hand: ["phoenix flame|1", "phoenix form|1"], deck: [BLUE], weapons: [] },
        { hero: "dorinthea" },
      ],
    });
    oneFlame.play("phoenix flame|1").blockWith().settle()
      .play("phoenix form|1").expectAttackValue(3);
    expect(oneFlame.state.chain.at(-1)?.goAgain).toBe(true);
    oneFlame.blockWith().settle().expectHandSize(0, 0);

    const threeFlames = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["phoenix flame|1", "phoenix flame|1", "phoenix flame|1", "phoenix form|1"],
          deck: [BLUE, RED, BLUE],
          weapons: [],
        },
        { hero: "dorinthea" },
      ],
    });
    threeFlames.play("phoenix flame|1").blockWith().settle()
      .play("phoenix flame|1").blockWith().settle()
      .play("phoenix flame|1").blockWith().settle()
      .play("phoenix form|1").expectAttackValue(5)
      .blockWith().settle()
      .expectHandSize(0, 3);
  });

  it("Tiger Stripe Shuko counts Ignite by base power after Rise from the Ashes", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: [
            "rise from the ashes|1",
            "ignite|1",
            "spreading flames|1",
            "phoenix flame|1",
          ],
          equipment: { arms: "tiger stripe shuko|0" },
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    s.play("rise from the ashes|1")
      .play("ignite|1")
      .expectAttackValue(5)
      .blockWith()
      .settle();
    expect(s.state.players[0]!.flags.smallAttackCount).toBe(1);
    s
      .play("spreading flames|1")
      .expectAttackValue(3)
      .blockWith()
      .settle();
    expect(s.state.players[0]!.flags.smallAttackCount).toBe(1);
    s.play("phoenix flame|1");
    expect(s.state.players[0]!.flags.smallAttackCount).toBe(2);
    expect(s.state.chain.at(-1)?.attackingCard.tempPower).toBe(1);
    expect(s.state.chain.at(-1)?.flags.unpreventable).toBe(true);
    s.expectAttackValue(3);
  });

  it("That All You Got? draws only when the combat chain closes", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 1,
          weapons: ["harmonized kodachi|0"],
        },
        {
          hero: "dorinthea",
          hand: ["that all you got?|2"],
          deck: [BLUE],
        },
      ],
    });

    s.attackWithWeapon("harmonized kodachi|0")
      .blockWith()
      .passPriority()
      .react("that all you got?|2")
      .expectHandSize(1, 0)
      .doRaw({ kind: "close-chain" })
      .expectHandSize(1, 1)
      .expectZoneSize(1, "deck", 0);
  });

  it("Spreading Flames buffs every eligible Draconic attack on the combat chain", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["ignite|1", "spreading flames|1", "phoenix flame|1", "phoenix flame|1"],
          weapons: [],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    s.play("ignite|1").blockWith().settle()
      .play("spreading flames|1").blockWith().settle()
      .play("phoenix flame|1").expectAttackValue(2).blockWith().settle()
      .play("phoenix flame|1").expectAttackValue(2);
  });

  it("invocation transform retains its Ash material as a sub-card", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", heroKey: "dromai|0", hand: ["invoke azvolai|1"], board: ["ash|0"], weapons: ["storm of sandikai|0"] },
        { hero: "dorinthea" },
      ],
    });
    s.play("invoke azvolai|1").chooseCard("ash|0");
    const azvolai = s.state.players[0]!.board.find((card) => card.cardId === "UPR009B")!;
    expect(azvolai).toEqual(expect.objectContaining({
      subcards: [expect.objectContaining({ cardId: "UPR043" })],
    }));
  });

  it("Quell is not a proactive activated ability", () => {
    const s = scenario({
      active: 1,
      seats: [
        { hero: "rhinar", resources: 1, equipment: { legs: "quelling slippers|0" } },
        { hero: "dorinthea", hand: ["snatch|1"] },
      ],
    });
    s.play("snatch|1").blockWith().passPriority();
    const slippers = s.state.players[0]!.equipment.legs!;
    const proactive = legalIntents(s.state, 0).filter((intent) =>
      intent.kind === "activate-ability" && intent.sourceInstanceId === slippers.instanceId);
    expect(proactive).toEqual([]);
    s.passPriority();
    expect(s.state.pendingDecision).toEqual(expect.objectContaining({
      player: 0,
      chooseHook: "quell",
    }));
    s.chooseOption(`use ${slippers.instanceId}`).expectLife(0, 17);
    expect(s.state.pendingDestructions).toContainEqual({ seat: 0, instanceId: slippers.instanceId });
  });

  it("Themai removes opposing plays and activations during its controller's turn", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["snatch|1"], board: ["themai|0"], weapons: ["storm of sandikai|0"] },
        { hero: "dorinthea", hand: ["oasis respite|3", BLUE] },
      ],
    });
    s.play("snatch|1").blockWith().passPriority();
    const oasis = s.state.players[1]!.hand.find((card) => card.cardId === printingId("oasis respite|3"))!;
    const opposingPlays = legalIntents(s.state, 1).filter((intent) =>
      (intent.kind === "play-card" || intent.kind === "play-from-arsenal") && intent.instanceId === oasis.instanceId);
    expect(opposingPlays).toEqual([]);
  });

  it("Nekria triggers from damage dealt to it and keeps its life counter through reset", () => {
    const s = scenario({
      active: 1,
      seats: [
        { hero: "rhinar", board: ["nekria|0"], weapons: ["storm of sandikai|0"] },
        { hero: "dorinthea", hand: ["singe|3", BLUE] },
      ],
    });
    s.play("singe|3", { pitch: [BLUE] }).chooseOption("opponent").chooseCard("nekria|0").endTurn();
    const nekria = s.state.players[0]!.board.find((card) => card.cardId === printingId("nekria|0"))!;
    expect(nekria.life).toBe(6);
    s.expectInZone(0, "ash|0", "board");
  });

  it("Kyloria keeps control of the stolen item after the action phase", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", board: ["kyloria|0"], weapons: ["storm of sandikai|0"] },
        { hero: "dorinthea", board: ["talisman of recompense|2"] },
      ],
    });
    s.activate("kyloria|0").blockWith().settle().chooseCard("talisman of recompense|2").endTurn();
    s.expectInZone(0, "talisman of recompense|2", "board");
  });

  it("Yendurai consumes endurance during an incoming ally damage event", () => {
    const s = scenario({
      active: 1,
      seats: [
        { hero: "rhinar", board: ["yendurai|0"], weapons: ["storm of sandikai|0"] },
        { hero: "dorinthea", hand: ["singe|3", BLUE] },
      ],
    });
    s.play("singe|3", { pitch: [BLUE] }).chooseOption("opponent").chooseCard("yendurai|0");
    const yendurai = s.state.players[0]!.board.find((card) => card.cardId === printingId("yendurai|0"))!;
    expect(yendurai.life).toBe(3);
    expect(yendurai.counters?.endurance).toBeUndefined();
  });
});

describe("UPR — look-at floats", () => {
  it("Tome of Duplicity floats both looked cards in one decision", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["tome of duplicity|3", BLUE], deck: ["wrecker romp|1", "snatch|1"] },
        { hero: "dorinthea" },
      ],
    });
    s.play("tome of duplicity|3", { pitch: [BLUE] });
    // one float: both looked cards are the decision's card options
    const top2 = s.state.players[0]!.deck.slice(0, 2).map((card) => card.instanceId);
    expect(s.state.pendingDecision?.chooseHook).toBe("duplicity");
    expect(s.state.pendingDecision?.cardOptions).toEqual(top2);
    const ownView = projectStateFor(s.state, 0);
    expect(ownView.pendingDecision?.optionCards?.filter(Boolean)).toHaveLength(2);
    expect(ownView.pendingDecision?.lookedCards ?? []).toEqual([]);
    // private: the opponent sees neither the options nor any looked cards
    expect(projectStateFor(s.state, 1).pendingDecision?.optionCards).toBeUndefined();
    s.chooseCard("wrecker romp|1").expectInZone(0, "wrecker romp|1", "banish");
  });
});
