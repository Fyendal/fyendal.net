import { describe, expect, it } from "vitest";
import { legalIntents } from "@fyendal/engine";
import { cardData } from "../../index.js";
import { printingId, scenario } from "../harness.js";

const MADNESS_SPIRAL = "madness spiral|3";
const REVERE = "revere the copper idol|3";
const PLASMA_PISTOL = "unstable plasma pistol|0";
const HUXLEY = "huxley, racketeer|0";
const BOOTLEGGER = "bootlegger bust-up|1";
const ZERO_TO_SIXTY = "zero to sixty|1";
const ZIPPER_HIT = "zipper hit|1";
const PROWL = "prowl|1";
const FILLER = "raging onslaught|1";
const NO_EQUIPMENT = { head: null, chest: null, arms: null, legs: null } as const;

type Game = ReturnType<typeof scenario>;

function zoneNames(game: Game, seat: number, zone: "banish" | "deck" | "graveyard"): string[] {
  return game.state.players[seat]![zone].map((card) => cardData[card.cardId]!.name);
}

// Seat 0 boosts Zero to Sixty into `ownTop`; seat 1's deck holds `opponentDeck`.
function boostGame(ownTop: string, opponentDeck: string[], seat0: { weapons?: string[]; resources?: number } = {}) {
  return scenario({ seats: [
    {
      hero: "rhinar",
      hand: [ZERO_TO_SIXTY],
      deck: [ownTop, FILLER],
      weapons: seat0.weapons ?? [],
      resources: seat0.resources ?? 0,
      equipment: NO_EQUIPMENT,
    },
    { hero: "dorinthea", deck: opponentDeck, weapons: [], equipment: NO_EQUIPMENT },
  ] });
}

describe("Min armory deck cards", () => {
  describe("Madness Spiral", () => {
    it("banishes itself and the top card of the opponent's deck when boosted away", () => {
      const game = boostGame(MADNESS_SPIRAL, [FILLER, PROWL]);

      game.play(ZERO_TO_SIXTY, { boost: true });

      expect(zoneNames(game, 0, "banish")).toEqual(["Madness Spiral"]);
      expect(zoneNames(game, 1, "banish")).toEqual(["Raging Onslaught"]);
      game.expectDeckTop(1, PROWL);
      expect(game.state.players[0]!.flags.boostBanishedOpponentCard).toBe(true);
      expect(game.state.players[0]!.flags["boostedSubtype:generic"]).toBe(true);
      // Madness Spiral is Mechanologist, so the boost still grants go again.
      game.blockWith().settle().expectLife(1, 16).expectAP(0, 1);
    });

    it("feeds every banished card to the booster's per-card bonuses", () => {
      const game = scenario({ seats: [
        {
          hero: "rhinar",
          hand: [BOOTLEGGER],
          deck: [MADNESS_SPIRAL],
          resources: 3,
          weapons: [],
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea", deck: [FILLER], weapons: [], equipment: NO_EQUIPMENT },
      ] });

      // Only the opponent's non-Mechanologist card adds +2.
      game.play(BOOTLEGGER, { boost: true }).expectAttackValue(8).blockWith().settle();

      game.expectLife(1, 12).expectAP(0, 1);
    });

    it("banishes only itself when the opponent's deck is empty", () => {
      const game = boostGame(MADNESS_SPIRAL, []);

      game.play(ZERO_TO_SIXTY, { boost: true });

      expect(zoneNames(game, 0, "banish")).toEqual(["Madness Spiral"]);
      expect(game.state.players[0]!.flags.boostBanishedOpponentCard).toBeUndefined();
    });

    it("lets Huxley play an opponent's stealth card banished by its replacement", () => {
      const game = scenario({ seats: [
        {
          hero: "rhinar",
          heroKey: HUXLEY,
          hand: [ZERO_TO_SIXTY],
          deck: [MADNESS_SPIRAL],
          weapons: [],
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea", deck: [PROWL], weapons: [], equipment: NO_EQUIPMENT },
      ] });

      game.play(ZERO_TO_SIXTY, { boost: true }).chooseOption("yes").blockWith().settle();

      const prowl = game.state.players[1]!.banish.find((card) => card.cardId === printingId(PROWL))!;
      expect(legalIntents(game.state, 0)).toContainEqual(
        expect.objectContaining({
          kind: "play-from-zone", instanceId: prowl.instanceId, zone: "banish", asInstant: true,
        }),
      );
    });
  });

  describe("Unstable Plasma Pistol", () => {
    it("gets +2 power after banishing an opponent's card from boosting this turn", () => {
      const game = boostGame(MADNESS_SPIRAL, [FILLER], { weapons: [PLASMA_PISTOL], resources: 2 });

      game.play(ZERO_TO_SIXTY, { boost: true }).blockWith().settle();
      game.attackWithWeapon(PLASMA_PISTOL).expectAttackValue(4).blockWith().settle();

      game.expectLife(1, 12);
    });

    it("attacks for its base power when only your own cards were boosted away", () => {
      const game = boostGame(ZIPPER_HIT, [FILLER], { weapons: [PLASMA_PISTOL], resources: 2 });

      game.play(ZERO_TO_SIXTY, { boost: true }).blockWith().settle();
      game.attackWithWeapon(PLASMA_PISTOL).expectAttackValue(2);
    });
  });

  describe("Revere the Copper Idol", () => {
    it("shuffles itself into its owner's deck when banished from boosting", () => {
      const game = boostGame(REVERE, []);

      game.play(ZERO_TO_SIXTY, { boost: true });

      expect(zoneNames(game, 0, "banish")).not.toContain("Revere the Copper Idol");
      expect(zoneNames(game, 0, "deck").sort()).toEqual(["Raging Onslaught", "Revere the Copper Idol"]);
      game.expectLog("Revere the Copper Idol is shuffled into").expectNoLog("put on the bottom");
    });

    it("returns to the opponent's deck when an opposing Madness Spiral banishes it", () => {
      const game = boostGame(MADNESS_SPIRAL, [REVERE, FILLER]);

      game.play(ZERO_TO_SIXTY, { boost: true });

      expect(zoneNames(game, 1, "banish")).toEqual([]);
      expect(zoneNames(game, 1, "deck").sort()).toEqual(["Raging Onslaught", "Revere the Copper Idol"]);
    });

    it("shuffles up to 3 differently named Mechanologist action cards from banish into the deck", () => {
      const game = scenario({ seats: [
        {
          hero: "rhinar",
          hand: [REVERE],
          deck: [FILLER],
          banish: [ZERO_TO_SIXTY, ZERO_TO_SIXTY, ZIPPER_HIT, FILLER, MADNESS_SPIRAL],
          weapons: [],
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
      ] });
      const optionNames = () =>
        game.state.pendingDecision!.options!
          .filter((option) => option !== "done")
          .map((option) => {
            const card = game.state.players[0]!.banish.find((candidate) => candidate.instanceId === Number(option))!;
            return cardData[card.cardId]!.name;
          })
          .sort();

      game.play(REVERE);
      expect(optionNames()).toEqual(["Madness Spiral", "Zero to Sixty", "Zero to Sixty", "Zipper Hit"]);
      game.chooseCard(ZERO_TO_SIXTY);
      expect(optionNames()).toEqual(["Madness Spiral", "Zipper Hit"]);
      game.chooseCard(ZIPPER_HIT).chooseCard(MADNESS_SPIRAL);

      expect(game.state.pendingDecision).toBeNull();
      expect(zoneNames(game, 0, "banish").sort()).toEqual(["Raging Onslaught", "Zero to Sixty"]);
      expect(zoneNames(game, 0, "deck").sort()).toEqual([
        "Madness Spiral",
        "Raging Onslaught",
        "Zero to Sixty",
        "Zipper Hit",
      ]);
      game.expectInZone(0, REVERE, "graveyard");
      game.expectLog("Zero to Sixty is shuffled into").expectLog("Zipper Hit is shuffled into")
        .expectLog("Madness Spiral is shuffled into").expectNoLog("put on the bottom");
    });

    it("may stop before choosing any card", () => {
      const game = scenario({ seats: [
        { hero: "rhinar", hand: [REVERE], banish: [ZIPPER_HIT], weapons: [], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
      ] });

      game.play(REVERE).chooseOption("done");

      game.expectInZone(0, ZIPPER_HIT, "banish");
    });
  });
});
