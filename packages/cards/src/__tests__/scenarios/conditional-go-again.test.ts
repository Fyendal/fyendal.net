import { describe, it } from "vitest";
import { scenario } from "../harness.js";

/**
 * Cards listed in KEYWORD_OVERRIDES must not have printed go again; their
 * scripts grant it only when the printed condition holds.
 */
describe("Conditional go again — condition met vs not met", () => {
  it("Tooth and Claw: no go again with 0 Crouching Tigers in hand", () => {
    scenario({
      seats: [
        { hero: "dorinthea", hand: ["tooth and claw|1"]},
        { hero: "rhinar", hand: [] },
      ],
    })
      .play("tooth and claw|1")
      .blockWith()
      .settle()
      .expectAP(0, 0);
  });

  it("Tooth and Claw: go again with a Crouching Tiger in hand", () => {
    scenario({
      seats: [
        { hero: "dorinthea", hand: ["tooth and claw|1", "crouching tiger|0"]},
        { hero: "rhinar", hand: [] },
      ],
    })
      .play("tooth and claw|1")
      .blockWith()
      .settle()
      .expectAP(0, 1);
  });
    it("Tooth and Claw: go again, +1 {p} with two Crouching Tiger in hand", () => {
    scenario({
      seats: [
        { hero: "dorinthea", hand: ["tooth and claw|1", "crouching tiger|0", "crouching tiger|0"]},
        { hero: "rhinar", hand: [] },
      ],
    })
      .play("tooth and claw|1")
      .expectAttackValue(5) // 4 + 1 for two Crouching Tigers
      .blockWith()
      .settle()
      .expectAP(0, 1);
  });
  it("Tooth and Claw: go again, +1{p}, on-hit draw with three Crouching Tiger in hand", () => {
    scenario({
      seats: [
        { hero: "dorinthea", hand: ["tooth and claw|1", "crouching tiger|0", "crouching tiger|0", "crouching tiger|0"], deck:["raging onslaught|2"]},
        { hero: "rhinar", hand: [] },
      ],
    })
      .play("tooth and claw|1")
      .expectAttackValue(5)
      .blockWith()
      .settle()
      .expectAP(0, 1)
      .expectHandSize(0, 4) // three Tigers + the drawn card
      .expectInZone(0, "raging onslaught|2", "hand");
  });


  it("Rising Knee Thrust: no go again without Leg Tap, go again after it", () => {
    scenario({
      seats: [
        { hero: "dorinthea", hand: ["rising knee thrust|1"] },
        { hero: "rhinar", hand: [] },
      ],
    })
      .play("rising knee thrust|1")
      .blockWith()
      .settle()
      .expectAP(0, 0);

    scenario({
      seats: [
        { hero: "dorinthea", hand: ["leg tap|1", "rising knee thrust|1", "raging onslaught|2"] },
        { hero: "rhinar", hand: [] },
      ],
    })
      .play("leg tap|1", { pitch: ["raging onslaught|2"] })
      .blockWith()
      .settle()
      .play("rising knee thrust|1")
      .blockWith()
      .settle()
      .expectAP(0, 1);
  });

  it("Open the Center: no go again without Head Jab, go again after it", () => {
    scenario({
      seats: [
        { hero: "dorinthea", hand: ["open the center|1", "raging onslaught|2"] },
        { hero: "rhinar", hand: [] },
      ],
    })
      .play("open the center|1", { pitch: ["raging onslaught|2"] })
      .blockWith()
      .settle()
      .expectAP(0, 0);

    scenario({
      seats: [
        { hero: "dorinthea", hand: ["head jab|1", "open the center|1", "raging onslaught|2"] },
        { hero: "rhinar", hand: [] },
      ],
    })
      .play("head jab|1")
      .blockWith()
      .settle()
      .play("open the center|1", { pitch: ["raging onslaught|2"] })
      .blockWith()
      .settle()
      .expectAP(0, 1);
  });

  it("Whelming Gustwave: no go again without Surging Strike, go again after it", () => {
    scenario({
      seats: [
        { hero: "dorinthea", hand: ["whelming gustwave|1"] },
        { hero: "rhinar", hand: [] },
      ],
    })
      .play("whelming gustwave|1")
      .blockWith()
      .settle()
      .expectAP(0, 0);

    scenario({
      seats: [
        { hero: "dorinthea", hand: ["surging strike|1", "whelming gustwave|1", "raging onslaught|2"] },
        { hero: "rhinar", hand: [] },
      ],
    })
      .play("surging strike|1", { pitch: ["raging onslaught|2"] })
      .blockWith()
      .settle()
      .play("whelming gustwave|1")
      .blockWith()
      .settle()
      .expectAP(0, 1);
  });

  it("Hurricane Technique: go again only directly after Rising Knee Thrust", () => {
    scenario({
      seats: [
        { hero: "dorinthea", hand: ["hurricane technique|2", "raging onslaught|2"] },
        { hero: "rhinar", hand: [] },
      ],
    })
      .play("hurricane technique|2", { pitch: ["raging onslaught|2"] })
      .blockWith()
      .settle()
      .expectAP(0, 0);

    scenario({
      seats: [
        { hero: "dorinthea", hand: ["leg tap|1", "rising knee thrust|1", "hurricane technique|2", "raging onslaught|2", "raging onslaught|2"] },
        { hero: "rhinar", hand: [] },
      ],
    })
      .play("leg tap|1", { pitch: ["raging onslaught|2"] })
      .blockWith()
      .settle()
      .play("rising knee thrust|1")
      .blockWith()
      .settle()
      .play("hurricane technique|2")
      .blockWith()
      .settle()
      .expectAP(0, 1);
  });

  it("Mugenshi: Release: go again only directly after Whelming Gustwave", () => {
    scenario({
      seats: [
        { hero: "dorinthea", hand: ["mugenshi: release|2"], resources: 10 },
        { hero: "rhinar", hand: [] },
      ],
    })
      .play("mugenshi: release|2")
      .blockWith()
      .settle()
      .expectAP(0, 0);

    scenario({
      seats: [
        { hero: "dorinthea", hand: ["surging strike|1", "whelming gustwave|1", "mugenshi: release|2"], resources: 10 },
        { hero: "rhinar", hand: [] },
      ],
    })
      .play("surging strike|1")
      .blockWith()
      .settle()
      .play("whelming gustwave|1")
      .blockWith()
      .settle()
      .play("mugenshi: release|2")
      .blockWith()
      .settle()
      .expectAP(0, 1);
  });

  it("Tiger Swipe: go again only directly after Crouching Tiger", () => {
    scenario({
      seats: [
        { hero: "dorinthea", hand: ["tiger swipe|1"], resources: 10 },
        { hero: "rhinar", hand: [] },
      ],
    })
      .play("tiger swipe|1")
      .blockWith()
      .settle()
      .expectAP(0, 0);

    scenario({
      seats: [
        { hero: "dorinthea", hand: ["crouching tiger|0", "tiger swipe|1"], resources: 10 },
        { hero: "rhinar", hand: [] },
      ],
    })
      .play("crouching tiger|0")
      .blockWith()
      .settle()
      .play("tiger swipe|1")
      .blockWith()
      .settle()
      .expectAP(0, 1);
  });

  it("Scour the Battlescape: go again only when played from arsenal", () => {
    scenario({
      seats: [
        { hero: "dorinthea", hand: ["scour the battlescape|1"], resources: 10 },
        { hero: "rhinar", hand: [] },
      ],
    })
      .play("scour the battlescape|1")
      .chooseOption("pass")
      .blockWith()
      .settle()
      .expectAP(0, 0);

    scenario({
      seats: [
        { hero: "dorinthea", hand: [], arsenal: ["scour the battlescape|1"], resources: 10 },
        { hero: "rhinar", hand: [] },
      ],
    })
      .play("scour the battlescape|1", { fromArsenal: true })
      .chooseOption("pass")
      .blockWith()
      .settle()
      .expectAP(0, 1);
  });

  it("Flood of Force: go again only after Rushing River and a revealed Combo card", () => {
    scenario({
      seats: [
        { hero: "dorinthea", hand: ["flood of force|2"], deck: ["open the center|1"], resources: 10 },
        { hero: "rhinar", hand: [] },
      ],
    })
      .play("flood of force|2")
      .blockWith()
      .settle()
      .expectAP(0, 0);

    // Torrent of Tempo (go again on hit) -> Rushing River (combo) -> Flood of Force.
    scenario({
      seats: [
        {
          hero: "dorinthea",
          hand: ["torrent of tempo|1", "rushing river|1", "flood of force|2", "open the center|1", "raging onslaught|2"],
          resources: 10,
        },
        { hero: "rhinar", hand: [] },
      ],
    })
      .play("torrent of tempo|1")
      .blockWith()
      .settle()
      .play("rushing river|1")
      .blockWith()
      .settle()
      .chooseCard("raging onslaught|2") // Rushing River puts two cards on top; the last one chosen ends on top
      .chooseCard("open the center|1") // so Flood of Force reveals a Combo card
      .settle()
      .expectAP(0, 1)
      .play("flood of force|2")
      .blockWith()
      .settle()
      .expectAP(0, 1);
  });

  it("Douse in Runeblood: go again only after three non-attack actions this turn", () => {
    scenario({
      seats: [
        { hero: "dorinthea", hand: ["douse in runeblood|1"], resources: 10 },
        { hero: "rhinar", hand: [] },
      ],
    })
      .play("douse in runeblood|1")
      .blockWith()
      .settle()
      .expectAP(0, 0);

    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["douse in runeblood|1"], resources: 10 },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.state.players[0]!.flags.nonAttackActionsPlayedThisTurn = 3;
    g.play("douse in runeblood|1").blockWith().settle().expectAP(0, 1);
  });

  it("Levels of Enlightenment: go again only after pitching three blue cards", () => {
    scenario({
      seats: [
        { hero: "dorinthea", hand: ["levels of enlightenment|3"], resources: 10 },
        { hero: "rhinar", hand: [] },
      ],
    })
      .play("levels of enlightenment|3")
      .blockWith()
      .settle()
      .expectAP(0, 0);

    for (const [blues, goAgain] of [[2, 0], [3, 1]] as const) {
      const g = scenario({
        seats: [
          { hero: "dorinthea", hand: ["levels of enlightenment|3"], resources: 10 },
          { hero: "rhinar", hand: [] },
        ],
      });
      g.state.players[0]!.flags["pitchedPitch:3"] = blues;
      g.play("levels of enlightenment|3").blockWith().settle().expectAP(0, goAgain);
    }
  });

  it("Swarming Gloomveil: go again only after two auras played or created", () => {
    for (const [auras, goAgain] of [[1, 0], [2, 1]] as const) {
      const g = scenario({
        seats: [
          { hero: "dorinthea", hand: ["swarming gloomveil|1"], resources: 10 },
          { hero: "rhinar", hand: [] },
        ],
      });
      g.state.players[0]!.flags["playedSubtypeCount:aura"] = auras;
      g.play("swarming gloomveil|1").blockWith().settle().expectAP(0, goAgain);
    }
  });

  it("Emissary of Wind: go again only if a card is put on the bottom of the deck", () => {
    scenario({
      seats: [
        { hero: "dorinthea", hand: ["emissary of wind|1", "raging onslaught|2"], resources: 10 },
        { hero: "rhinar", hand: [] },
      ],
    })
      .play("emissary of wind|1")
      .chooseOption("pass")
      .blockWith()
      .settle()
      .expectAP(0, 0);

    scenario({
      seats: [
        { hero: "dorinthea", hand: ["emissary of wind|1", "raging onslaught|2"], resources: 10 },
        { hero: "rhinar", hand: [] },
      ],
    })
      .play("emissary of wind|1")
      .chooseCard("raging onslaught|2")
      .blockWith()
      .settle()
      .expectAP(0, 1);
  });

  it("Shadow of Ursur: go again only if a Blood Debt card is banished from hand", () => {
    scenario({
      seats: [
        { hero: "dorinthea", hand: ["shadow of ursur|3", "ghostly visit|1"], resources: 10 },
        { hero: "rhinar", hand: [] },
      ],
    })
      .play("shadow of ursur|3")
      .chooseOption("no")
      .blockWith()
      .settle()
      .expectAP(0, 0);

    scenario({
      seats: [
        { hero: "dorinthea", hand: ["shadow of ursur|3", "ghostly visit|1"], resources: 10 },
        { hero: "rhinar", hand: [] },
      ],
    })
      .play("shadow of ursur|3")
      .chooseCard("ghostly visit|1")
      .blockWith()
      .settle()
      .expectAP(0, 1);
  });

  it("Bingo: go again only if the revealed card is an attack", () => {
    for (const [revealed, goAgain] of [["blink|3", 0], ["raging onslaught|2", 1]] as const) {
      scenario({
        seats: [
          { hero: "dorinthea", hand: ["bingo|1"], resources: 10 },
          { hero: "rhinar", hand: [revealed] },
        ],
      })
        .play("bingo|1")
        .blockWith()
        .settle()
        .chooseCard(revealed)
        .settle()
        .expectAP(0, goAgain);
    }
  });

  it("Soul Reaping: go again only if the defending hero has a card in soul", () => {
    scenario({
      seats: [
        { hero: "dorinthea", hand: ["soul reaping|1"], resources: 10 },
        { hero: "rhinar", hand: [] },
      ],
    })
      .play("soul reaping|1")
      .blockWith()
      .settle()
      .expectAP(0, 0);

    scenario({
      seats: [
        { hero: "dorinthea", hand: ["soul reaping|1"], resources: 10 },
        { hero: "rhinar", hand: [], soul: ["raging onslaught|2"] },
      ],
    })
      .play("soul reaping|1")
      .blockWith()
      .settle()
      .expectAP(0, 1);
  });
});

