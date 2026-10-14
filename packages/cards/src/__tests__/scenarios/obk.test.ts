import { describe, expect, it } from "vitest";
import { legalIntents, projectStateFor } from "@fyendal/engine";
import type { GameIntent } from "@fyendal/shared";
import { cardData } from "../../index.js";
import { printingId, scenario, type SeatSpec } from "../harness.js";

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
const BLOODROT_POX = "bloodrot pox|0";
const FRAILTY = "frailty|0";

function boardNames(game: ReturnType<typeof scenario>, seat: number): string[] {
  return game.state.players[seat]!.board.map((card) => cardData[card.cardId]!.name);
}

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

  describe("α-01, First Cogwarden", () => {
    const ALPHA = "α-01, first cogwarden|0";
    const alphaGame = (seat: Partial<SeatSpec>) => scenario({ seats: [
      { hero: "rhinar", heroKey: ALPHA, weapons: [DEATH_DEALER], equipment: NO_EQUIPMENT, ...seat },
      { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
    ] });
    const arsenalArrow = (game: ReturnType<typeof scenario>) =>
      game.state.players[0]!.arsenal.find((card) => card.cardId === printingId(RUSTY_HARPOON));

    it("arsenals an arrow banished from boosting with two +1 power counters that later get go again", () => {
      const game = alphaGame({
        hand: [ZERO_TO_SIXTY],
        deck: [RUSTY_HARPOON, FILLER, FILLER, FILLER, FILLER],
        resources: 1,
      });

      game.play(ZERO_TO_SIXTY, { boost: true }).blockWith().settle().expectLife(1, 16);
      game.activate(ALPHA, { ability: 0 });

      game.expectInZone(0, RUSTY_HARPOON, "arsenal").expectFaceDown(0, RUSTY_HARPOON, false);
      expect(arsenalArrow(game)?.counters?.power).toBe(2);
      expect(game.state.players[0]!.hero.tapped).toBe(true);
      expect(game.state.players[0]!.resources).toBe(0);
      game.expectLog("gets two +1 power counters");

      game.endTurn().endTurn();
      game.activate(ALPHA, { ability: 1, pitch: [FILLER] });
      game.play(RUSTY_HARPOON, { fromArsenal: true }).expectAttackValue(3).blockWith().settle();

      game.expectLife(1, 13).expectAP(0, 1);
    });

    it("ignores an arrow that was not banished from boosting this turn", () => {
      const game = alphaGame({ banish: [RUSTY_HARPOON], resources: 1 });

      game.activate(ALPHA, { ability: 0 });

      game.expectInZone(0, RUSTY_HARPOON, "banish");
      expect(game.state.players[0]!.arsenal).toEqual([]);
    });

    it("does not give go again to an arrow without a +1 power counter", () => {
      const game = alphaGame({ arsenal: [RUSTY_HARPOON], resources: 1 });

      game.activate(ALPHA, { ability: 1 });
      game.play(RUSTY_HARPOON, { fromArsenal: true }).expectAttackValue(1).blockWith().settle();

      game.expectLife(1, 19).expectAP(0, 0);
    });
  });

  describe("Mortimer, Living Virus", () => {
    const MORTIMER = "mortimer, living virus|0";
    const mortimerGame = (board: string[], active: 0 | 1 = 0) => scenario({
      active,
      seats: [
        { hero: "rhinar", heroKey: MORTIMER, board, resources: 1, weapons: [], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", hand: [PROWL], weapons: [], equipment: NO_EQUIPMENT },
      ],
    });

    it("creates a token copy of your disease token under the opponent's control", () => {
      const game = mortimerGame([FRAILTY]).activate(MORTIMER);

      expect(boardNames(game, 0)).toEqual(["Frailty"]);
      expect(boardNames(game, 1)).toEqual(["Frailty"]);
      expect(game.state.players[0]!.hero.tapped).toBe(true);
      expect(game.state.players[0]!.resources).toBe(0);
    });

    it("lets you choose which disease token to copy", () => {
      const game = mortimerGame([FRAILTY, BLOODROT_POX]).activate(MORTIMER).chooseCard(BLOODROT_POX);

      expect(boardNames(game, 0)).toEqual(["Frailty", "Bloodrot Pox"]);
      expect(boardNames(game, 1)).toEqual(["Bloodrot Pox"]);
    });

    it("creates nothing without a disease token", () => {
      const game = mortimerGame([]).activate(MORTIMER);

      expect(boardNames(game, 1)).toEqual([]);
    });

    it("cannot be activated during an opponent's turn", () => {
      const game = mortimerGame([FRAILTY], 1);

      game.play(PROWL).blockWith().passPriority();

      expect(game.state.priorityPlayer).toBe(0);
      const mortimer = game.state.players[0]!.hero.instanceId;
      expect(legalIntents(game.state, 0)).not.toContainEqual(
        expect.objectContaining({ kind: "activate-ability", sourceInstanceId: mortimer }),
      );
    });
  });
});

describe("Outbreak cards", () => {
  const BOOTLEGGER = "bootlegger bust-up|1";
  const MAX_TENSION = "max-tension shot|1";
  const CURE_ALL = "cure-all elixir|0";
  const PAUPERS_KNIFE = "pauper's knife|0";
  const PINPOINTER = "one-click pinpointer|0";
  const DUELING_PISTOL = "cogwerx dueling pistol|0";
  const INCITE = "incite aggression|1";
  const EXTINCTION = "extinction level event|1";
  const SWAP_SPIT = "swap spit|1";
  const BLUE = "raging onslaught|3";

  describe("Bootlegger Bust-Up", () => {
    const boosted = (deckTop: string) => {
      const game = scenario({ seats: [
        { hero: "rhinar", hand: [BOOTLEGGER], deck: [deckTop], resources: 3, weapons: [], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
      ] });
      return game.play(BOOTLEGGER, { boost: true });
    };

    it("gets +2 power when boosting banishes a non-Mechanologist card", () => {
      boosted(FILLER).expectAttackValue(8).blockWith().settle().expectLife(1, 12).expectAP(0, 0);
    });

    it("gets go again instead when boosting banishes a Mechanologist card", () => {
      boosted(ZIPPER_HIT).expectAttackValue(6).blockWith().settle().expectLife(1, 14).expectAP(0, 1);
    });

    it("gains nothing without boosting", () => {
      const game = scenario({ seats: [
        { hero: "rhinar", hand: [BOOTLEGGER], deck: [FILLER], resources: 3, weapons: [], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
      ] });
      game.play(BOOTLEGGER, { boostCount: 0 }).expectAttackValue(6);
      game.expectDeckTop(0, FILLER);
    });
  });

  describe("Max-Tension Shot", () => {
    const shot = (deckTop: string) => {
      const game = scenario({ seats: [
        {
          hero: "rhinar",
          arsenal: [MAX_TENSION],
          deck: [deckTop],
          resources: 1,
          weapons: [DEATH_DEALER],
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
      ] });
      return game.play(MAX_TENSION, { fromArsenal: true }).blockWith().settle();
    };

    it("gets go again when the revealed top card is red", () => {
      shot(FILLER).expectLife(1, 15).expectAP(0, 1).expectDeckTop(0, FILLER).expectLog("reveals");
    });

    it("does not get go again when the revealed top card is not red", () => {
      shot(BLUE).expectLife(1, 15).expectAP(0, 0).expectDeckTop(0, BLUE);
    });
  });

  describe("Cure-All Elixir", () => {
    const elixir = () => scenario({ seats: [
      {
        hero: "rhinar",
        hand: [CURE_ALL, ZERO_TO_SIXTY],
        board: [FRAILTY],
        life: 30,
        resources: 1,
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
    ] });

    it("cures a disease you control to gain 1 life, and gives the next attack +3 power", () => {
      const game = elixir().play(CURE_ALL).chooseCard(FRAILTY);

      expect(game.state.players[0]!.board).toEqual([]);
      game.expectLife(0, 31).expectAP(0, 1);
      game.play(ZERO_TO_SIXTY).expectAttackValue(7);
    });

    it("may decline the cure", () => {
      const game = elixir().play(CURE_ALL).chooseOption("no");

      expect(boardNames(game, 0)).toEqual(["Frailty"]);
      game.expectLife(0, 30);
    });
  });

  describe("Pauper's Knife", () => {
    it("taps for a go-again 1 power attack", () => {
      const game = scenario({ seats: [
        { hero: "rhinar", resources: 2, weapons: [PAUPERS_KNIFE], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
      ] });

      game.attackWithWeapon(PAUPERS_KNIFE).expectAttackValue(1).blockWith().settle();

      game.expectLife(1, 19).expectAP(0, 1).expectResources(0, 0);
      expect(game.state.players[0]!.weapons[0]!.tapped).toBe(true);
    });
  });

  describe("Cogwerx Dueling Pistol", () => {
    it("loads a steam counter with go again, then attacks by removing it on a later turn", () => {
      const game = scenario({ seats: [
        { hero: "rhinar", resources: 1, weapons: [DUELING_PISTOL], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
      ] });
      const pistol = () => game.state.players[0]!.weapons[0]!;
      const attackIntents = () => legalIntents(game.state, 0).filter((intent) =>
        intent.kind === "activate-ability" && intent.sourceInstanceId === pistol().instanceId &&
        (intent.abilityIndex ?? 0) === 0
      );
      expect(attackIntents()).toEqual([]);

      game.activate(DUELING_PISTOL, { ability: 1 });
      expect(pistol().counters?.steam).toBe(1);
      expect(pistol().tapped).toBe(true);
      game.expectAP(0, 1).expectResources(0, 0);

      game.endTurn().endTurn();
      game.activate(DUELING_PISTOL, { ability: 0 }).expectAttackValue(2).blockWith().settle();
      game.expectLife(1, 18).expectAP(0, 0);
      expect(pistol().counters?.steam ?? 0).toBe(0);
    });
  });

  describe("One-Click Pinpointer", () => {
    it("bottoms the arsenal and loads an arrow from hand face-up", () => {
      const game = scenario({ seats: [
        {
          hero: "rhinar",
          hand: [MAX_TENSION],
          arsenalFaceDown: [FILLER],
          deck: [BLUE],
          weapons: [PINPOINTER],
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
      ] });

      game.activate(PINPOINTER);
      game.chooseCard(MAX_TENSION);

      game.expectInZone(0, MAX_TENSION, "arsenal").expectFaceDown(0, MAX_TENSION, false);
      game.expectDeckBottom(0, FILLER).expectAP(0, 1);
      expect(game.state.players[0]!.weapons[0]!.tapped).toBe(true);
    });

    it("lets the controller order several arsenal cards on the bottom", () => {
      const game = scenario({ seats: [
        {
          hero: "rhinar",
          hand: [MAX_TENSION],
          arsenal: [FILLER, "raging onslaught|2"],
          deck: [BLUE],
          weapons: [PINPOINTER],
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
      ] });

      game.activate(PINPOINTER).chooseCard(FILLER);
      game.chooseCard(MAX_TENSION);

      const deck = game.state.players[0]!.deck.map((card) => card.cardId);
      expect(deck.slice(-2)).toEqual([printingId(FILLER), printingId("raging onslaught|2")]);
      expect(game.state.players[0]!.arsenal.map((card) => card.cardId)).toEqual([printingId(MAX_TENSION)]);
    });

    it("costs {r} more while you control another tapped bow", () => {
      const game = scenario({ seats: [
        {
          hero: "rhinar",
          hand: [MAX_TENSION, MAX_TENSION],
          weapons: [PINPOINTER, PINPOINTER],
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
      ] });
      const weapons = () => game.state.players[0]!.weapons;
      const untappedBowActivations = () => legalIntents(game.state, 0).filter((intent) =>
        intent.kind === "activate-ability" &&
        weapons().some((weapon) => weapon.instanceId === intent.sourceInstanceId && !weapon.tapped)
      );
      const pitchCount = (intent: GameIntent) =>
        ("pitchInstanceIds" in intent ? intent.pitchInstanceIds?.length : 0) ?? 0;
      // With no tapped bow, the {t}-only cost needs no payment.
      expect(untappedBowActivations().some((intent) => pitchCount(intent) === 0)).toBe(true);

      game.activate(PINPOINTER);
      game.chooseCard(MAX_TENSION);
      expect(weapons().filter((weapon) => weapon.tapped)).toHaveLength(1);

      // The remaining hand card is the only pitch source for the extra {r}.
      const secondIntents = untappedBowActivations();
      expect(secondIntents).not.toEqual([]);
      expect(secondIntents.every((intent) => pitchCount(intent) > 0)).toBe(true);
    });
  });

  describe("Incite Aggression", () => {
    const incite = (myTop: string, theirTop: string) => {
      const game = scenario({ seats: [
        {
          hero: "rhinar",
          hand: [INCITE, ZERO_TO_SIXTY],
          deck: [myTop],
          resources: 1,
          weapons: [],
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea", deck: [theirTop], weapons: [], equipment: NO_EQUIPMENT },
      ] });
      game.play(INCITE);
      game.expectInZone(0, myTop, "arsenal").expectFaceDown(0, myTop, false);
      game.expectInZone(1, theirTop, "arsenal").expectFaceDown(1, theirTop, false);
      return game.play(ZERO_TO_SIXTY).blockWith().settle();
    };

    it("gives the next attack go again when your red card enters an arsenal", () => {
      incite(FILLER, BLUE).expectAP(0, 1);
    });

    it("also counts a red card put into an opponent's arsenal", () => {
      incite(BLUE, FILLER).expectAP(0, 1);
    });

    it("gives nothing when no red card enters an arsenal", () => {
      incite(BLUE, BLUE).expectAP(0, 0);
    });
  });

  describe("Extinction Level Event", () => {
    const extinction = (named: string) => {
      const game = scenario({ seats: [
        { hero: "rhinar", hand: [EXTINCTION], board: [BLOODROT_POX], weapons: [], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
      ] });
      return game.play(EXTINCTION).chooseOption(named);
    };

    it("strips abilities from disease tokens with the chosen name", () => {
      const game = extinction("Bloodrot Pox").expectLog("Bloodrot Pox tokens lose");
      const life = game.state.players[0]!.life;

      game.endTurn();

      game.expectLife(0, life);
      expect(boardNames(game, 0)).toEqual(["Bloodrot Pox", "Extinction Level Event"]);
    });

    it("leaves disease tokens with another name functional", () => {
      const game = extinction("Frailty");
      const life = game.state.players[0]!.life;

      game.endTurn();

      game.expectLife(0, life - 2);
      expect(boardNames(game, 0)).toEqual(["Extinction Level Event"]);
    });

    const atStartOfTurn = (tokens: number) => {
      const game = scenario({
        active: 1,
        seats: [
          {
            hero: "rhinar",
            board: [EXTINCTION, ...Array<string>(tokens).fill(FRAILTY)],
            weapons: [],
            equipment: NO_EQUIPMENT,
          },
          { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
        ],
      });
      return game.endTurn();
    };

    it("wins the game at the start of your turn with 33 disease tokens in the arena", () => {
      atStartOfTurn(33).expectWinner(0);
    });

    it("does not win with fewer than 33 disease tokens", () => {
      const game = atStartOfTurn(32);
      expect(game.state.winner).toBeNull();
    });
  });

  describe("Swap Spit", () => {
    it("exchanges a random disease token with the attacking opponent when it defends", () => {
      const game = scenario({
        active: 1,
        seats: [
          { hero: "rhinar", hand: [SWAP_SPIT], board: [BLOODROT_POX], weapons: [], equipment: NO_EQUIPMENT },
          { hero: "dorinthea", hand: [PROWL], board: [FRAILTY], weapons: [], equipment: NO_EQUIPMENT },
        ],
      });

      game.play(PROWL).blockWith().passPriority().react(SWAP_SPIT);

      expect(boardNames(game, 0)).toEqual(["Frailty"]);
      expect(boardNames(game, 1)).toEqual(["Bloodrot Pox"]);
      expect(game.state.players[1]!.board[0]!.owner).toBe(0);
    });

    it("still gives your disease when the opponent controls none", () => {
      const game = scenario({
        active: 1,
        seats: [
          { hero: "rhinar", hand: [SWAP_SPIT], board: [BLOODROT_POX], weapons: [], equipment: NO_EQUIPMENT },
          { hero: "dorinthea", hand: [PROWL], weapons: [], equipment: NO_EQUIPMENT },
        ],
      });

      game.play(PROWL).blockWith().passPriority().react(SWAP_SPIT);

      expect(boardNames(game, 0)).toEqual([]);
      expect(boardNames(game, 1)).toEqual(["Bloodrot Pox"]);
    });
  });
  describe("Incite Resolve", () => {
    const INCITE_RESOLVE = "incite resolve|3";
    const resolve = (myTop: string, theirTop: string) => {
      const game = scenario({ seats: [
        {
          hero: "rhinar",
          hand: [INCITE_RESOLVE, ZERO_TO_SIXTY],
          deck: [myTop],
          resources: 1,
          weapons: [],
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea", deck: [theirTop], weapons: [], equipment: NO_EQUIPMENT },
      ] });
      game.play(INCITE_RESOLVE);
      game.expectInZone(0, myTop, "arsenal").expectFaceDown(0, myTop, false);
      game.expectInZone(1, theirTop, "arsenal").expectFaceDown(1, theirTop, false);
      game.expectAP(0, 1);
      return game.play(ZERO_TO_SIXTY);
    };

    it("gives the next attack +2 power when a blue card enters either arsenal", () => {
      resolve(FILLER, BLUE).expectAttackValue(6);
      resolve(BLUE, FILLER).expectAttackValue(6);
    });

    it("gives nothing when no blue card enters an arsenal", () => {
      resolve(FILLER, FILLER).expectAttackValue(4);
    });
  });

  describe("Exertion Bloom and Exertion", () => {
    const EXERTION_BLOOM = "exertion bloom|2";
    const EXERTION = "exertion|0";

    it("costs nothing during your turn and gives each hero an Exertion", () => {
      const game = scenario({ seats: [
        { hero: "rhinar", hand: [EXERTION_BLOOM], resources: 0, weapons: [], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
      ] });

      game.play(EXERTION_BLOOM);

      expect(boardNames(game, 0)).toEqual(["Exertion"]);
      expect(boardNames(game, 1)).toEqual(["Exertion"]);
      game.expectLife(0, 20).expectLife(1, 20);
    });

    it("makes its controller lose 1 life per card played from hand, then is destroyed in their end phase", () => {
      const game = scenario({ seats: [
        { hero: "rhinar", hand: [ZERO_TO_SIXTY], board: [EXERTION], weapons: [], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", board: [EXERTION], weapons: [], equipment: NO_EQUIPMENT },
      ] });

      game.play(ZERO_TO_SIXTY).expectLife(0, 19).expectLife(1, 20);
      game.blockWith().settle().endTurn();

      expect(boardNames(game, 0)).toEqual([]);
      expect(boardNames(game, 1)).toEqual(["Exertion"]);
    });

    it("is a disease token", () => {
      const game = scenario({ seats: [
        { hero: "rhinar", hand: [CURE_ALL], board: [EXERTION], resources: 1, weapons: [], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
      ] });

      game.play(CURE_ALL).chooseCard(EXERTION);

      expect(boardNames(game, 0)).toEqual([]);
    });
  });

  describe("Patient Zero", () => {
    const PATIENT_ZERO = "patient zero|1";
    const hitWith = (board: string[]) => scenario({ seats: [
      { hero: "rhinar", hand: [PATIENT_ZERO], board, weapons: [], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
    ] }).play(PATIENT_ZERO).blockWith().settle();

    it("gives the hit hero your only disease token", () => {
      const game = hitWith([FRAILTY]);

      game.expectLife(1, 17);
      expect(boardNames(game, 0)).toEqual([]);
      expect(boardNames(game, 1)).toEqual(["Frailty"]);
    });

    it("lets you choose which disease token to give", () => {
      const game = hitWith([FRAILTY, BLOODROT_POX]).chooseCard(BLOODROT_POX);

      expect(boardNames(game, 0)).toEqual(["Frailty"]);
      expect(boardNames(game, 1)).toEqual(["Bloodrot Pox"]);
    });

    it("does nothing on hit without a disease token", () => {
      hitWith([]).expectLife(1, 17);
    });
  });

  describe("Curative Ceremony", () => {
    const CEREMONY = "curative ceremony|1";
    const ceremony = (mine: string[], theirs: string[]) => scenario({ seats: [
      { hero: "rhinar", hand: [CEREMONY], board: mine, weapons: [], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", board: theirs, weapons: [], equipment: NO_EQUIPMENT },
    ] });

    it("cures a disease from each hero and grants one distinct mode per cure", () => {
      const game = ceremony([FRAILTY], [BLOODROT_POX]).play(CEREMONY);

      expect(boardNames(game, 0)).toEqual([]);
      expect(boardNames(game, 1)).toEqual([]);
      expect(game.state.pendingDecision?.options).toEqual(["power", "go again", "veil"]);
      game.chooseOption("power");
      expect(game.state.pendingDecision?.options).toEqual(["go again", "veil"]);
      game.chooseOption("go again");

      game.expectAttackValue(6).blockWith().settle().expectLife(1, 14).expectAP(0, 1);
    });

    it("lets each hero choose which of their diseases to cure", () => {
      const game = ceremony([], [FRAILTY, BLOODROT_POX]).play(CEREMONY);

      expect(game.state.pendingDecision?.player).toBe(1);
      game.chooseCard(BLOODROT_POX).chooseOption("veil");

      expect(boardNames(game, 1)).toEqual(["Frailty"]);
      const attack = game.state.chain[0]!.attackingCard;
      expect(attack.grantedKeywords).toContain("veil");
      game.expectAttackValue(4);
    });

    it("can be played without any diseases to cure", () => {
      ceremony([], []).play(CEREMONY).expectAttackValue(4).blockWith().settle().expectAP(0, 0);
    });
  });

  describe("Couriers", () => {
    const COURIERS = [
      ["bloodrot courier|1", 2, "Bloodrot Pox"],
      ["exertion courier|2", 3, "Exertion"],
      ["inertia courier|3", 4, "Inertia"],
    ] as const;
    const courierGame = (courier: string, cost: number) => scenario({ seats: [
      { hero: "rhinar", hand: [courier], resources: cost, weapons: [], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", hand: [FILLER, FILLER], weapons: [], equipment: NO_EQUIPMENT },
    ] });

    for (const [courier, cost, token] of COURIERS) {
      it(`creates ${token} under both heroes' control when ${courier} hits, with go again`, () => {
        const game = courierGame(courier, cost).play(courier).blockWith().settle();

        game.expectLife(1, 16).expectAP(0, 1);
        expect(boardNames(game, 0)).toEqual([token]);
        expect(boardNames(game, 1)).toEqual([token]);
      });
    }

    it("creates no tokens when it does not hit", () => {
      const game = courierGame(COURIERS[0][0], COURIERS[0][1])
        .play(COURIERS[0][0]).blockWith(FILLER, FILLER).settle()
        .expectLife(1, 20);
      expect(boardNames(game, 0)).toEqual([]);
      expect(boardNames(game, 1)).toEqual([]);
    });
  });

  describe("Quiet Streets and Raging Streets", () => {
    const QUIET_STREETS = "quiet streets|2";
    const RAGING_STREETS = "raging streets|2";
    const TUNIC = "fyendal's spring tunic|0";

    // Rhinar's undefended action attack, with `streets` in Rhinar's hand.
    const actionAttack = (streets: string) => scenario({ seats: [
      { hero: "rhinar", hand: [FILLER, streets], resources: 3, weapons: [], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
    ] }).play(FILLER).blockWith();

    // Dawnblade attack defended by a card and equipment; Rhinar holds `streets`
    // and gets priority after Dorinthea passes.
    const weaponAttack = (streets: string) => scenario({
      active: 1,
      seats: [
        { hero: "rhinar", hand: [FILLER, streets], weapons: [], equipment: { ...NO_EQUIPMENT, chest: TUNIC } },
        { hero: "dorinthea", resources: 1, weapons: ["dawnblade|0"], equipment: NO_EQUIPMENT },
      ],
    }).attackWithWeapon("dawnblade|0").blockWith(FILLER, TUNIC).passPriority();

    it("gives the only card on the active chain link -3 or +3 power", () => {
      actionAttack(QUIET_STREETS).expectAttackValue(7).react(QUIET_STREETS)
        .expectFinalAttack(4).expectLog("Quiet Streets").expectLife(1, 16);
      actionAttack(RAGING_STREETS).react(RAGING_STREETS)
        .expectFinalAttack(10).expectLog("Raging Streets").expectLife(1, 10);
    });

    it("never chooses a weapon attack's proxy or defending equipment", () => {
      weaponAttack(QUIET_STREETS).react(QUIET_STREETS)
        .expectFinalAttack(3).expectFinalDefense(1).expectLife(0, 18);
      weaponAttack(RAGING_STREETS).react(RAGING_STREETS)
        .expectFinalAttack(3).expectFinalDefense(7).expectLife(0, 20);
    });

    it("attributes the change to itself in the attack and defense breakdowns", () => {
      const raging = { sourceCardId: printingId(RAGING_STREETS), amount: 3 };
      // Resolve Raging Streets but leave its chain link open.
      const resolveStreets = (game: ReturnType<typeof scenario>) =>
        projectStateFor(game.react(RAGING_STREETS, { settle: false }).passPriority().passPriority().state, 0)
          .chain.at(-1);

      expect(resolveStreets(actionAttack(RAGING_STREETS))?.attackModifiers).toEqual([raging]);
      expect(resolveStreets(weaponAttack(RAGING_STREETS))?.defenseModifiers).toEqual([raging]);
    });

    it("does nothing without an active chain link", () => {
      scenario({ seats: [
        { hero: "rhinar", hand: [QUIET_STREETS], weapons: [], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
      ] }).play(QUIET_STREETS).expectNoLog("gets -3 power");
    });
  });
});
