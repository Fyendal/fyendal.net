import { describe, it } from "vitest";
import { scenario, type SeatSpec } from "../harness.js";

const NO_EQUIPMENT = { head: null, chest: null, arms: null, legs: null } as const;

function attacker(spec: Partial<SeatSpec> = {}): SeatSpec {
  return { hero: "rhinar", weapons: [], ...spec, equipment: { ...NO_EQUIPMENT, ...(spec.equipment ?? {}) } };
}

function defender(spec: Partial<SeatSpec> = {}): SeatSpec {
  return { hero: "dorinthea", weapons: [], ...spec, equipment: { ...NO_EQUIPMENT, ...(spec.equipment ?? {}) } };
}

// Each condition first becomes true during the reaction step, after the attack was declared.
describe("conditional go again is checked live until the attack resolves", () => {
  it("Flex Speed reaches 6 power from an attack reaction", () => {
    scenario({ seats: [attacker({ hand: ["flex speed|1", "lunging press|3"], resources: 2 }), defender()] })
      .play("flex speed|1", { pitch: [] })
      .blockWith()
      .react("lunging press|3")
      .expectAP(0, 1);
  });

  it("Blistering Assault sees a yellow card pitched by Tuffnut", () => {
    scenario({
      seats: [
        attacker({ heroKey: "tuffnut|0", hand: ["blistering assault|1"], deck: ["raging onslaught|2"], resources: 2 }),
        defender(),
      ],
    })
      .play("blistering assault|1")
      .blockWith()
      .activate("tuffnut|0")
      .expectAP(0, 1);
  });

  it("Rising Speed sees a card drawn by Ragamuffin's Hat", () => {
    scenario({
      seats: [
        attacker({
          hand: ["rising speed|1", "raging onslaught|3"],
          deck: ["raging onslaught|2"],
          equipment: { head: "ragamuffin's hat|0" },
          resources: 2,
        }),
        defender(),
      ],
    })
      .play("rising speed|1", { pitch: [] })
      .blockWith()
      .activate("ragamuffin's hat|0")
      .chooseOption("bottom")
      .expectAP(0, 1);
  });

  it("Blaze Headlong sees another red card played as an instant", () => {
    scenario({ seats: [attacker({ hand: ["blaze headlong|1", "pledge fealty|1"] }), defender()] })
      .play("blaze headlong|1")
      .blockWith()
      .react("pledge fealty|1")
      .expectAP(0, 1);
  });

  it("Runerager Swarm sees an aura played as an instant", () => {
    scenario({ seats: [attacker({ hand: ["runerager swarm|1", "runechant of pride|2"] }), defender()] })
      .play("runerager swarm|1")
      .blockWith()
      .react("runechant of pride|2")
      .expectAP(0, 1);
  });

  it("Aggressive Pounce sees an intimidate from Leave Them Hanging", () => {
    const g = scenario({
      seats: [
        attacker({ hand: ["aggressive pounce|1", "leave them hanging|1"], resources: 5 }),
        defender({ hand: ["raging onslaught|3"] }),
      ],
    })
      .play("aggressive pounce|1", { pitch: [] })
      .blockWith()
      .react("leave them hanging|1", { pitch: [] });
    g.doRaw({ kind: "choose", optionId: String(g.state.players[1]!.hero.instanceId) })
      .settle()
      .expectAP(0, 1);
  });

  it("March of Loyalty sees a Fealty created as an instant", () => {
    scenario({ seats: [attacker({ hand: ["march of loyalty|1", "pledge fealty|1"] }), defender()] })
      .play("march of loyalty|1")
      .blockWith()
      .react("pledge fealty|1")
      .expectAP(0, 1);
  });

  it("Murmur of i'Arathael sees a card banished by Blood Tribute", () => {
    scenario({
      seats: [
        attacker({ hand: ["murmur of i'arathael|1", "blood tribute|1"], deck: ["raging onslaught|2"], resources: 1 }),
        defender(),
      ],
    })
      .play("murmur of i'arathael|1", { pitch: [] })
      .blockWith()
      .react("blood tribute|1")
      .chooseOption("top")
      .expectAP(0, 1);
  });

  it("Soul Cleaver sees the defender put a card into their soul", () => {
    scenario({
      seats: [
        attacker({ hand: ["soul cleaver|1"], resources: 2 }),
        defender({ hand: ["raging onslaught|3"], equipment: { head: "halo of illumination|0" }, resources: 1 }),
      ],
    })
      .play("soul cleaver|1", { pitch: [] })
      .blockWith()
      .passPriority()
      .activate("halo of illumination|0", { pitch: [] })
      .chooseCard("raging onslaught|3")
      .expectAP(0, 1);
  });

  it("Second Tenet of Chi: Wind sees a transcend from A Drop in the Ocean", () => {
    scenario({
      seats: [attacker({ hand: ["second tenet of chi: wind|3", "a drop in the ocean|3"], resources: 3 }), defender()],
    })
      .play("second tenet of chi: wind|3", { pitch: [] })
      .blockWith()
      .react("a drop in the ocean|3")
      .expectAP(0, 1);
  });

  it("Soup Up sees an item destroyed for its instant ability", () => {
    scenario({ seats: [attacker({ hand: ["soup up|1"], board: ["amethyst amulet|3"] }), defender()] })
      .play("soup up|1")
      .blockWith()
      .activate("amethyst amulet|3")
      .expectAP(0, 1);
  });

  it("Unwavering Resolve counts a defense reaction as a third defender", () => {
    scenario({
      seats: [
        attacker({ hand: ["unwavering resolve|1"], resources: 3 }),
        defender({ hand: ["raging onslaught|1", "raging onslaught|2", "evasive leap|1"] }),
      ],
    })
      .play("unwavering resolve|1", { pitch: [] })
      .blockWith("raging onslaught|1", "raging onslaught|2")
      .passPriority()
      .react("evasive leap|1")
      .expectAP(0, 1);
  });
});
