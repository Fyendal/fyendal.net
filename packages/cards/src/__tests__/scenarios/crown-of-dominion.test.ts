import { describe, expect, it } from "vitest";
import { scenario } from "../harness.js";

describe("Crown of Dominion and Tome of Imperial Flame", () => {
  it.each([
    { name: "a Crown-equipped Dromai", crown: true, opposingCrown: false, buriedCrown: false, royalHero: false, draw: 2 },
    { name: "Dromai without a Crown", crown: false, opposingCrown: false, buriedCrown: false, royalHero: false, draw: 1 },
    { name: "Dromai facing an opposing Crown", crown: false, opposingCrown: true, buriedCrown: false, royalHero: false, draw: 1 },
    { name: "Dromai with a Crown in the graveyard", crown: false, opposingCrown: false, buriedCrown: true, royalHero: false, draw: 1 },
    { name: "a naturally Royal hero", crown: false, opposingCrown: false, buriedCrown: false, royalHero: true, draw: 2 },
  ])("draws $draw for $name and still requires pitching two reds", ({ crown, opposingCrown, buriedCrown, royalHero, draw }) => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: royalHero ? "emperor, dracai of aesir|0" : "dromai, ash artist|0",
          equipment: { head: crown ? "crown of dominion|0" : null },
          graveyard: buriedCrown ? ["crown of dominion|0"] : [],
          hand: ["tome of imperial flame|1", "head jab|1", "snatch|1"],
          deck: ["raging onslaught|1", "raging onslaught|1", "raging onslaught|1"],
        },
        { hero: "dorinthea", equipment: { head: opposingCrown ? "crown of dominion|0" : null } },
      ],
    });

    g.play("tome of imperial flame|1").expectHandSize(0, 2 + draw);
    expect(g.state.players[0]!.deck).toHaveLength(3 - draw);
    expect(g.state.pendingDecision?.chooseHook).toBe("tome-red-1");
    g.chooseCard("head jab|1").chooseCard("snatch|1")
      .expectHandSize(0, draw)
      .expectResources(0, 2)
      .expectInZone(0, "head jab|1", "pitch")
      .expectInZone(0, "snatch|1", "pitch");
    expect(g.state.players[0]!.actionPoints).toBe(1);
  });
});
