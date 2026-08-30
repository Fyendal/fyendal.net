import { describe, expect, it } from "vitest";
import { cardData, scripts } from "../../index.js";
import { functionalKeyOf } from "../../functional.js";
import { scenario } from "../harness.js";

function silverCount(game: ReturnType<typeof scenario>, seat = 0): number {
  return game.state.players[seat]!.board.filter(
    (card) => functionalKeyOf(cardData[card.cardId]!) === "silver|0",
  ).length;
}

const STANDARD_CONTRACT_CASES = [
  ["annihilate the armed|1", "head jab|1", "pay day|3"],
  ["fleece the frail|1", "flex claws|1", "raging onslaught|1"],
  ["nix the nimble|1", "lunging press|3", "head jab|1"],
  ["plunder the poor|1", "head jab|1", "raging onslaught|1"],
  ["plunder the poor|1", "sonata arcanix|1", "heart of fyendal|3"],
  ["rob the rich|1", "raging onslaught|1", "head jab|1"],
  ["sack the shifty|1", "head jab|1", "wrecker romp|1"],
  ["slay the scholars|1", "pay day|3", "head jab|1"],
] as const;

describe("Contract", () => {
  it("registers a banish observer for every Contract that creates Silver", () => {
    const silverContracts = Object.values(cardData).filter((card) =>
      (card.keywords ?? []).some((keyword) => keyword.toLowerCase() === "contract") &&
      /create a Silver token/i.test(card.text)
    );

    for (const card of silverContracts) {
      expect(scripts[card.id]?.onFriendlyBanishesOpponentCard, card.id).toBeTypeOf("function");
    }
  });

  it.each(STANDARD_CONTRACT_CASES)(
    "%s rewards a matching banish but not a non-matching banish",
    (contract, matching, nonMatching) => {
      const completed = scenario({
        seats: [
          { hero: "rhinar", hand: [contract], resources: 3 },
          { hero: "dorinthea", deck: [matching] },
        ],
      });
      completed.play(contract).blockWith().settle();
      expect(silverCount(completed)).toBe(1);
      expect(completed.state.players[0]!.flags.completedContractThisTurn).toBe(true);

      const missed = scenario({
        seats: [
          { hero: "rhinar", hand: [contract], resources: 3 },
          { hero: "dorinthea", deck: [nonMatching] },
        ],
      });
      missed.play(contract).blockWith().settle();
      expect(silverCount(missed)).toBe(0);
      expect(missed.state.players[0]!.flags.completedContractThisTurn).not.toBe(true);
    },
  );

  it("each active Contract rewards every matching card banished on a later chain link", () => {
    const game = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["leave no witnesses|1", "excessive bloodloss|1"],
          arsenalFaceDown: ["the hand that pulls the strings|0"],
          resources: 1,
        },
        {
          hero: "dorinthea",
          deck: ["wrecker romp|3", "head jab|1", "flex claws|1"],
        },
      ],
    });

    game.play("leave no witnesses|1")
      .blockWith()
      .activate("the hand that pulls the strings|0")
      .settle()
      .play("excessive bloodloss|1")
      .blockWith()
      .settle();

    // Both red Contracts are active for both red cards banished by Bloodloss.
    expect(silverCount(game)).toBe(4);
  });

  it("Eradicate completes once for each yellow card it banishes", () => {
    const game = scenario({
      seats: [
        { hero: "rhinar", hand: ["eradicate|2"], resources: 1 },
        {
          hero: "dorinthea",
          deck: ["head jab|2", "flex claws|2", "wrecker romp|2", "head jab|1"],
        },
      ],
    });

    game.play("eradicate|2").blockWith().settle();
    expect(silverCount(game)).toBe(3);
  });

  it("Surgical Extraction completes for blue cards banished from deck and hand", () => {
    const game = scenario({
      seats: [
        { hero: "rhinar", hand: ["surgical extraction|3"], resources: 2 },
        { hero: "dorinthea", hand: ["snatch|3"], deck: ["wrecker romp|3"] },
      ],
    });

    game.play("surgical extraction|3")
      .blockWith()
      .settle()
      .chooseCard("snatch|3");
    expect(silverCount(game)).toBe(2);
  });

  it("Coercive Tendency gives Assassin attacks go again when its banish completes a Contract", () => {
    const game = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "arakni, solitary confinement|0",
          hand: ["fleece the frail|1", "coercive tendency|3", "infect|1"],
        },
        {
          hero: "dorinthea",
          deck: ["wrecker romp|1", "flex claws|1", "raging onslaught|1"],
        },
      ],
    });

    game.play("fleece the frail|1")
      .blockWith()
      .react("coercive tendency|3")
      .chooseCard("flex claws|1")
      .chooseCard("wrecker romp|1")
      .expectAP(0, 1)
      .play("infect|1")
      .blockWith()
      .settle()
      .expectAP(0, 1);
  });

  it("Coercive Tendency ignores a Contract completed before its non-matching banish", () => {
    const game = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "arakni, solitary confinement|0",
          hand: ["fleece the frail|1", "coercive tendency|3"],
        },
        {
          hero: "dorinthea",
          deck: ["flex claws|1", "wrecker romp|1", "raging onslaught|1"],
        },
      ],
    });
    game.state.players[0]!.flags.completedContractThisTurn = true;
    game.state.players[0]!.flags.contractCompletionsThisTurn = 1;

    game.play("fleece the frail|1")
      .blockWith()
      .react("coercive tendency|3")
      .chooseCard("wrecker romp|1")
      .chooseCard("raging onslaught|1")
      .expectAP(0, 0);
  });

  it("Already Dead completes when it banishes a non-action card", () => {
    const game = scenario({
      seats: [
        { hero: "rhinar", hand: ["already dead|1"], resources: 2 },
        { hero: "dorinthea", deck: ["heart of fyendal|3"] },
      ],
    });

    game.play("already dead|1").blockWith().settle();
    expect(silverCount(game)).toBe(1);
  });

  it("Mist Hunter completes once for each blue Inner Chi it banishes", () => {
    const game = scenario({
      seats: [
        { hero: "rhinar", hand: ["mist hunter|1"] },
        {
          hero: "dorinthea",
          heroKey: "nuu|0",
          deck: ["inner chi|3", "inner chi|3"],
        },
      ],
    });

    game.play("mist hunter|1").blockWith().settle();
    expect(silverCount(game)).toBe(2);
  });
});
