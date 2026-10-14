import { describe, expect, it } from "vitest";
import { legalIntents } from "@fyendal/engine";
import { cardData } from "../../index.js";
import { printingId, scenario } from "../harness.js";

const MIN = "min, genius|0";
const VYLE = "vyle, catalyst of collapse|0";
const HUXLEY = "huxley, racketeer|0";
const AZALEA = "azalea, ace of spades|0";
const DEATH_DEALER = "death dealer|0";
const RUSTY_HARPOON = "rusty harpoon|3";
const ZERO_TO_SIXTY = "zero to sixty|1";
const ZIPPER_HIT = "zipper hit|1";
const PROWL = "prowl|1";
const FILLER = "raging onslaught|1";
const NO_EQUIPMENT = { head: null, chest: null, arms: null, legs: null } as const;

function heroName(game: ReturnType<typeof scenario>, seat: number): string {
  return cardData[game.state.players[seat]!.heroCardId]!.name;
}

function banishedPlayIntents(game: ReturnType<typeof scenario>, seat: number, key: string) {
  const id = printingId(key);
  const instance = game.state.players[seat]!.banish.find((card) => card.cardId === id);
  return legalIntents(game.state, seat).filter((intent) =>
    intent.kind === "play-from-zone" && instance !== undefined && intent.instanceId === instance.instanceId,
  );
}

// Huxley boosts Zero to Sixty into `deckTop`; the opponent has no blockers.
function huxleyGame(deckTop: string) {
  return scenario({ seats: [
    { hero: "rhinar", heroKey: HUXLEY, hand: [ZERO_TO_SIXTY], deck: [deckTop], weapons: [], equipment: NO_EQUIPMENT },
    { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
  ] });
}

describe("Outbreak heroes", () => {
  describe("Vyle, Catalyst of Collapse", () => {
    it("puts each hero's top card face up into their arsenal during Vyle's turn", () => {
      const game = scenario({ seats: [
        { hero: "rhinar", heroKey: VYLE, deck: [RUSTY_HARPOON], resources: 2, equipment: NO_EQUIPMENT },
        { hero: "dorinthea", deck: [PROWL], equipment: NO_EQUIPMENT },
      ] });

      game.activate(VYLE);

      game.expectInZone(0, RUSTY_HARPOON, "arsenal").expectFaceDown(0, RUSTY_HARPOON, false);
      game.expectInZone(1, PROWL, "arsenal").expectFaceDown(1, PROWL, false);
      expect(game.state.players[0]!.hero.tapped).toBe(true);
      expect(game.state.players[0]!.resources).toBe(0);
    });

    it("cannot be activated during an opponent's turn", () => {
      const game = scenario({
        active: 1,
        seats: [
          { hero: "rhinar", heroKey: VYLE, resources: 2, equipment: NO_EQUIPMENT },
          { hero: "dorinthea", hand: [PROWL], weapons: [], equipment: NO_EQUIPMENT },
        ],
      });

      game.play(PROWL).blockWith().passPriority();

      expect(game.state.phase).toBe("reaction");
      expect(game.state.priorityPlayer).toBe(0);
      const vyle = game.state.players[0]!.hero.instanceId;
      expect(legalIntents(game.state, 0)).not.toContainEqual(
        expect.objectContaining({ kind: "activate-ability", sourceInstanceId: vyle }),
      );
    });

    it("gives arrow attacks +1 power only while an opponent has a face-up arsenal card", () => {
      const faceUp = scenario({ seats: [
        { hero: "rhinar", heroKey: VYLE, arsenal: [RUSTY_HARPOON], weapons: [DEATH_DEALER], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", arsenal: [FILLER], weapons: [], equipment: NO_EQUIPMENT },
      ] });
      faceUp.play(RUSTY_HARPOON, { fromArsenal: true }).expectAttackValue(2);

      const faceDown = scenario({ seats: [
        { hero: "rhinar", heroKey: VYLE, arsenal: [RUSTY_HARPOON], weapons: [DEATH_DEALER], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", arsenalFaceDown: [FILLER], weapons: [], equipment: NO_EQUIPMENT },
      ] });
      faceDown.play(RUSTY_HARPOON, { fromArsenal: true }).expectAttackValue(1);
    });
  });

  describe("Huxley, Racketeer", () => {
    it("taps to let a stealth action banished by boost be played as an instant this turn", () => {
      const game = huxleyGame(PROWL);

      game.play(ZERO_TO_SIXTY, { boost: true });
      expect(game.state.pendingDecision?.kind).toBe("optional-effect");
      game.chooseOption("yes").blockWith().settle();

      expect(game.state.players[0]!.hero.tapped).toBe(true);
      game.expectLife(1, 16).expectAP(0, 0);
      expect(banishedPlayIntents(game, 0, PROWL)).toContainEqual(
        expect.objectContaining({ zone: "banish", asInstant: true }),
      );

      game.play(PROWL, { fromZone: "banish", asInstant: true }).blockWith().settle();

      game.expectLife(1, 13);
      expect(game.state.chain.map((link) => link.attackingCard.cardId)).toContain(printingId(PROWL));
    });

    it("grants nothing when Huxley is not tapped", () => {
      const game = huxleyGame(PROWL);

      game.play(ZERO_TO_SIXTY, { boost: true }).chooseOption("no").blockWith().settle();

      expect(game.state.players[0]!.hero.tapped).not.toBe(true);
      expect(banishedPlayIntents(game, 0, PROWL)).toEqual([]);
    });

    it("does not trigger for a banished card without stealth", () => {
      const game = huxleyGame(FILLER);

      game.play(ZERO_TO_SIXTY, { boost: true });

      expect(game.state.pendingDecision?.kind).not.toBe("optional-effect");
    });

    it("queues a stealth attack played during the boosted attack's reaction step behind that attack", () => {
      const game = huxleyGame(PROWL);

      game.play(ZERO_TO_SIXTY, { boost: true }).chooseOption("yes").blockWith();
      expect(game.state.phase).toBe("reaction");
      expect(banishedPlayIntents(game, 0, PROWL)).toContainEqual(expect.objectContaining({ asInstant: true }));

      game.play(PROWL, { fromZone: "banish", asInstant: true, settle: false });
      game.passPriority().passPriority();
      game.expectLog("put into the attack queue");
      expect(game.state.chain).toHaveLength(1);

      // Zero to Sixty resolves first; Prowl then becomes the next chain link.
      game.settle();
      expect(game.state.chain.map((link) => link.attackingCard.cardId)).toEqual([
        printingId(ZERO_TO_SIXTY),
        printingId(PROWL),
      ]);
      game.blockWith().settle();
      game.expectLife(1, 13).expectAP(0, 0);
    });

    it("queues a stealth attack played while the boosted attack is still a layer behind that attack", () => {
      const game = huxleyGame(PROWL);

      game.play(ZERO_TO_SIXTY, { boost: true }).doRaw({ kind: "choose", optionId: "yes" });
      // Resolve Huxley's trigger; Zero to Sixty is still an unresolved attack layer.
      for (let guard = 0; guard < 6 && banishedPlayIntents(game, 0, PROWL).length === 0; guard++) {
        game.passPriority();
      }
      expect(game.state.phase).toBe("layer");
      expect(game.state.chain[0]?.flags.attackStepBegan).not.toBe(true);
      game.play(PROWL, { fromZone: "banish", asInstant: true, settle: false });
      game.passPriority().passPriority();
      game.expectLog("put into the attack queue");

      game.settle().blockWith().settle();
      expect(game.state.chain.map((link) => link.attackingCard.cardId)).toEqual([
        printingId(ZERO_TO_SIXTY),
        printingId(PROWL),
      ]);
      game.blockWith().settle();
      game.expectLife(1, 13);
    });
  });

  describe("Min, Genius", () => {
    it("makes owned cards Mechanologist, then flips to Min, Mad at the beginning of Min's end phase", () => {
      const game = scenario({ seats: [
        {
          hero: "rhinar",
          heroKey: MIN,
          hand: [ZERO_TO_SIXTY],
          deck: [PROWL, FILLER, FILLER, FILLER, FILLER, FILLER, ZIPPER_HIT, FILLER],
          weapons: [],
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
      ] });

      // Prowl is an Assassin card, but Genius makes it Mechanologist.
      game.play(ZERO_TO_SIXTY, { boost: true }).blockWith().settle();
      game.expectAP(0, 1);

      game.endTurn();
      expect(heroName(game, 0)).toBe("Min, Mad");
      game.endTurn();
      expect(heroName(game, 0)).toBe("Min, Mad");
    });

    it("Min, Mad strips class types until it flips back to Min, Genius", () => {
      const game = scenario({ seats: [
        {
          hero: "rhinar",
          heroKey: MIN,
          hand: [ZERO_TO_SIXTY],
          deck: [FILLER, FILLER, FILLER, ZIPPER_HIT, FILLER, FILLER, FILLER, FILLER],
          weapons: [],
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
      ] });

      game.endTurn().endTurn();
      expect(game.state.activePlayer).toBe(0);
      expect(heroName(game, 0)).toBe("Min, Mad");

      // Zipper Hit is printed Mechanologist, but Mad removes the class.
      game.play(ZERO_TO_SIXTY, { boost: true }).blockWith().settle();
      game.expectAP(0, 0);

      game.endTurn();
      expect(heroName(game, 0)).toBe("Min, Genius");
    });
  });

  describe("Azalea, Ace of Spades", () => {
    it("swaps the arsenal card for a stealth deck top with +1 power and go again", () => {
      const game = scenario({ seats: [
        { hero: "rhinar", heroKey: AZALEA, arsenal: [FILLER], deck: [PROWL], weapons: [], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
      ] });

      game.activate(AZALEA).chooseCard(FILLER);

      expect(game.state.players[0]!.hero.tapped).toBe(true);
      game.expectInZone(0, PROWL, "arsenal").expectFaceDown(0, PROWL, false).expectDeckBottom(0, FILLER);

      game.play(PROWL, { fromArsenal: true }).expectAttackValue(4).blockWith().settle();
      game.expectLife(1, 16).expectAP(0, 1);
    });

    it("gives an arrow veil, so it can't be defended by two cards of one color", () => {
      const setup = () => {
        const game = scenario({ seats: [
          {
            hero: "rhinar",
            heroKey: AZALEA,
            arsenal: [FILLER],
            deck: [RUSTY_HARPOON],
            weapons: [DEATH_DEALER],
            equipment: NO_EQUIPMENT,
          },
          {
            hero: "dorinthea",
            hand: [FILLER, FILLER, "raging onslaught|2", "evasive leap|1"],
            weapons: [],
            equipment: NO_EQUIPMENT,
          },
        ] });
        game.activate(AZALEA).chooseCard(FILLER);
        const arrow = game.state.players[0]!.arsenal.find((card) => card.cardId === printingId(RUSTY_HARPOON));
        expect(arrow?.grantedKeywords).toContain("veil");
        expect(arrow?.tempPower ?? 0).toBe(0);
        return game.play(RUSTY_HARPOON, { fromArsenal: true });
      };

      expect(() => setup().blockWith(FILLER, FILLER)).toThrow(/Veil/);

      const game = setup().blockWith(FILLER, "raging onslaught|2").passPriority();
      expect(game.state.priorityPlayer).toBe(1);
      const evasiveLeap = game.state.players[1]!.hand.find((card) => card.cardId === printingId("evasive leap|1"))!;
      expect(legalIntents(game.state, 1)).not.toContainEqual(
        expect.objectContaining({ instanceId: evasiveLeap.instanceId }),
      );

      const control = scenario({ seats: [
        { hero: "rhinar", arsenal: [RUSTY_HARPOON], weapons: [DEATH_DEALER], equipment: NO_EQUIPMENT },
        {
          hero: "dorinthea",
          hand: [FILLER, FILLER, "raging onslaught|2", "evasive leap|1"],
          weapons: [],
          equipment: NO_EQUIPMENT,
        },
      ] });
      control.play(RUSTY_HARPOON, { fromArsenal: true }).blockWith(FILLER, "raging onslaught|2").passPriority();
      const controlLeap = control.state.players[1]!.hand.find((card) => card.cardId === printingId("evasive leap|1"))!;
      expect(legalIntents(control.state, 1)).toContainEqual(
        expect.objectContaining({ instanceId: controlLeap.instanceId }),
      );
    });

    it("cannot be activated with an empty arsenal", () => {
      const game = scenario({ seats: [
        { hero: "rhinar", heroKey: AZALEA, deck: [PROWL], weapons: [], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
      ] });

      const azalea = game.state.players[0]!.hero.instanceId;
      expect(legalIntents(game.state, 0)).not.toContainEqual(
        expect.objectContaining({ kind: "activate-ability", sourceInstanceId: azalea }),
      );
    });
  });
});
