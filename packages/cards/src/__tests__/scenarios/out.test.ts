import { describe, expect, it } from "vitest";
import { legalIntents, projectStateFor } from "@fyendal/engine";
import { cardData, scripts } from "../../index.js";
import { printingId, scenario } from "../harness.js";

const BLUE = "wrecker romp|3";
const NON_ATTACK = "nimblism|3";
const GRAPHENE = "graphene chelicera|0";

describe("OUT — registration and core mechanics", () => {
  it("registers every printing and all heroes", () => {
    expect(Object.keys(cardData).filter((id) => id.startsWith("OUT"))).toHaveLength(239);
    for (const id of ["OUT002", "OUT003", "OUT046", "OUT047", "OUT090", "OUT092"]) {
      expect(cardData[id]?.cardType).toBe("hero");
      expect(scripts[id]).toBeDefined();
    }
  });

  it("Trench of Sunken Treasure does not prevent arcane damage without payment", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", board: ["runechant|0"], hand: ["ravenous rabble|1"] },
        { hero: "dorinthea", hand: [], equipment: { chest: "trench of sunken treasure|0" } },
      ],
    });

    g.play("ravenous rabble|1").expectLife(1, 19);
    expect(g.state.pendingDecision?.kind).toBe("defend");
  });

  it("Looking for a Scrap gains +1 and go again only when its additional cost is paid", () => {
    const declined = scenario({
      seats: [
        { hero: "rhinar", resources: 2, hand: ["looking for a scrap|1"], graveyard: ["infect|3"] },
        { hero: "dorinthea" },
      ],
    });
    declined.play("looking for a scrap|1").chooseOption("pass").blockWith().settle().expectAP(0, 0);

    const paid = scenario({
      seats: [
        { hero: "rhinar", resources: 2, hand: ["looking for a scrap|1"], graveyard: ["infect|3"] },
        { hero: "dorinthea" },
      ],
    });
    const base = cardData[paid.state.players[0]!.hand[0]!.cardId]!.attack ?? 0;
    paid.play("looking for a scrap|1")
      .chooseCard("infect|3")
      .expectAttackValue(base + 1)
      .blockWith()
      .settle()
      .expectAP(0, 1);
  });

  it("Arakni gives only the first stealth attack go again and Prowl buffs the next one", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", heroKey: "arakni, solitary confinement|0", hand: ["prowl|1", "infect|1"] },
        { hero: "dorinthea" },
      ],
    });
    s.play("prowl|1").blockWith().settle().expectAP(0, 1)
      .play("infect|1").expectAttackValue(4).blockWith().settle().expectAP(0, 0)
      .expectInZone(1, "bloodrot pox|0", "board");
  });

  it.each([
    ["nerve scalpel|0", "ancestral empowerment|1", 2],
    ["orbitoclast|0", "bloodrush bellow|2", 2],
    ["scale peeler|0", "ironrot helm|0", 0],
  ] as const)("%s applies its delayed defense penalty when the matching card defends", (dagger, defender, expectedDefense) => {
    const defenderEquipment = defender === "ironrot helm|0"
      ? { head: defender }
      : undefined;
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "arakni, solitary confinement|0",
          resources: 2,
          hand: ["infect|1"],
          weapons: [dagger],
        },
        {
          hero: "dorinthea",
          ...(defenderEquipment ? { equipment: defenderEquipment } : { hand: [defender] }),
        },
      ],
    });

    s.attackWithWeapon(dagger).blockWith().settle()
      .play("infect|1")
      .blockWith(defender)
      .settle()
      .expectFinalDefense(expectedDefense);
  });

  it("an activated attack reaction enables Sneak Attack's +4 power", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", resources: 4, hand: ["sneak attack|1"], equipment: { arms: "fisticuffs|0" } },
        { hero: "dorinthea" },
      ],
    });
    s.play("sneak attack|1").blockWith()
      .activate("fisticuffs|0", { settle: false })
      .passPriority().passPriority()
      .expectAttackValue(8);
  });

  it("Spreading Plague counts defense reactions only after they resolve", () => {
    const responding = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "arakni, solitary confinement|0",
          resources: 2,
          hand: ["leave no witnesses|1", "spreading plague|2"],
        },
        { hero: "dorinthea", hand: ["flic flak|1"] },
      ],
    });

    responding.play("leave no witnesses|1")
      .blockWith()
      .passPriority() // defender's reaction window
      .react("flic flak|1", { settle: false })
      .passPriority() // defender passes priority after playing Flic Flak
      .react("spreading plague|2", { settle: false })
      .passPriority().passPriority(); // Spreading Plague resolves above Flic Flak

    responding.expectZoneSize(1, "board", 0);

    const afterResolution = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "arakni, solitary confinement|0",
          resources: 2,
          hand: ["leave no witnesses|1", "spreading plague|2"],
        },
        { hero: "dorinthea", hand: ["flic flak|1"] },
      ],
    });

    afterResolution.play("leave no witnesses|1")
      .blockWith()
      .passPriority() // defender's reaction window
      .react("flic flak|1", { settle: false })
      .passPriority().passPriority() // Flic Flak resolves and becomes defending
      .react("spreading plague|2")
      .expectInZone(1, "bloodrot pox|0", "board");
  });

  it("shows Flick Knives on the chain after its attack reaction resolves", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["infect|1"],
          equipment: { arms: "flick knives|0" },
          weapons: ["spider's bite|0", "nerve scalpel|0"],
        },
        { hero: "dorinthea" },
      ],
    });
    s.play("infect|1").blockWith()
      .activate("flick knives|0", { settle: false });

    expect(projectStateFor(s.state, 0).chain.at(-1)?.reactions).toEqual([]);
    s.passPriority().passPriority();
    expect(projectStateFor(s.state, 0).chain.at(-1)?.reactions).toEqual([]);
    s.chooseCard("spider's bite|0");
    expect(projectStateFor(s.state, 0).chain.at(-1)?.reactions).toContainEqual(
      expect.objectContaining({ cardId: "OUT139" }),
    );
  });

  it("Humble suppresses the defending hero through the end of their next turn", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["humble|1", BLUE] },
        { hero: "dorinthea" },
      ],
    });
    s.play("humble|1", { pitch: [BLUE] }).blockWith().settle();
    expect(s.state.modifiers).toContainEqual(expect.objectContaining({
      seat: 1,
      suppressesHeroAbilities: true,
      expiresAtEndOfSeatTurn: 1,
    }));
  });

  it("Toxicity makes the next Assassin or Ranger hit cause life loss", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", resources: 1, hand: ["toxicity|1", "infect|1"] },
        { hero: "dorinthea" },
      ],
    });
    s.play("toxicity|1").play("infect|1").blockWith().settle().expectLife(1, 12);
  });

  it("Codex of Frailty makes an opponent with an empty arsenal recover and discard an attack", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["codex of frailty|2", BLUE],
          graveyard: ["infect|1"],
        },
        {
          hero: "dorinthea",
          hand: [NON_ATTACK],
          graveyard: ["the weakest link|1"],
        },
      ],
    });

    s.play("codex of frailty|2")
      .chooseCard("infect|1")
      .chooseCard("the weakest link|1")
      .chooseCard(BLUE)
      .chooseCard(NON_ATTACK)
      .expectInZone(0, "infect|1", "arsenal")
      .expectInZone(1, "the weakest link|1", "arsenal")
      .expectInZone(1, NON_ATTACK, "graveyard")
      .expectLog("Infect is put face down into")
      .expectLog("The Weakest Link is put face down into")
      .expectNoLog("puts a card face down into arsenal");
    expect(s.state.players[1]!.arsenal[0]!.faceDown).toBe(true);
    const moves = s.state.log.flatMap((entry) =>
      entry.publicPayload?.event?.kind === "card-moved" ? [entry.publicPayload.event] : []);
    expect(moves).toContainEqual(expect.objectContaining({ from: "graveyard", to: "arsenal", ownerSeat: 1, faceDown: true }));
  });

  it("Codex of Frailty cannot recover a face-down graveyard attack", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["codex of frailty|2", BLUE] },
        {
          hero: "dorinthea",
          hand: [NON_ATTACK],
          graveyard: ["the weakest link|1"],
        },
      ],
    });
    s.state.players[1]!.graveyard[0]!.faceDown = true;

    s.play("codex of frailty|2")
      .expectInZone(1, "the weakest link|1", "graveyard")
      .expectInZone(1, NON_ATTACK, "hand");
    expect(s.state.players[1]!.arsenal).toHaveLength(0);
    expect(s.state.pendingDecision).toBeNull();
  });

  it("Codex of Inertia makes only heroes whose arsenal took the top card discard", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["codex of inertia|2", NON_ATTACK], deck: ["infect|1"] },
        {
          hero: "dorinthea",
          arsenal: ["head shot|1"],
          hand: [BLUE],
          deck: ["the weakest link|1"],
        },
      ],
    });

    s.play("codex of inertia|2")
      .chooseCard(NON_ATTACK)
      .expectInZone(0, "infect|1", "arsenal")
      .expectInZone(0, NON_ATTACK, "graveyard")
      .expectInZone(1, BLUE, "hand")
      .expectDeckTop(1, "the weakest link|1");
    expect(s.state.pendingDecision).toBeNull();
  });

  it("Codex of Frailty fills New Horizon's empty additional arsenal zone", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "lexi, livewire|0",
          equipment: { head: "new horizon|0" },
          arsenal: ["head shot|1"],
          hand: ["codex of frailty|2", BLUE],
          graveyard: ["infect|1"],
        },
        { hero: "dorinthea" },
      ],
    });

    s.play("codex of frailty|2")
      .chooseCard("infect|1")
      .chooseCard(BLUE)
      .expectInZone(0, "head shot|1", "arsenal")
      .expectInZone(0, "infect|1", "arsenal");
    expect(s.state.players[0]!.arsenal).toHaveLength(2);
    expect(s.state.players[0]!.arsenal[1]?.arsenalSlot).toBe(1);
  });

  it("Codex of Bloodrot fills New Horizon's empty additional arsenal zone", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "lexi, livewire|0",
          equipment: { head: "new horizon|0" },
          arsenal: ["head shot|1"],
          hand: ["codex of bloodrot|2", BLUE],
        },
        { hero: "dorinthea" },
      ],
    });

    s.play("codex of bloodrot|2")
      .chooseCard(BLUE)
      .expectInZone(0, "head shot|1", "arsenal")
      .expectInZone(0, BLUE, "arsenal");
    expect(s.state.players[0]!.arsenal).toHaveLength(2);
    expect(s.state.players[0]!.arsenal[1]?.arsenalSlot).toBe(1);
  });

  it("Hurl attributes its optional effect hit to the chosen dagger and destroys it", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", resources: 1, hand: ["hurl|1"], weapons: ["spider's bite|0"] },
        { hero: "dorinthea" },
      ],
    });
    s.play("hurl|1").chooseOption("pay").chooseCard("spider's bite|0")
      .expectLife(1, 19);
    expect(s.state.players[0]!.weapons).toHaveLength(0);
  });

  it("Flick Knives chooses an eligible dagger, including Kiss of Death on a prior link", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "arakni, solitary confinement|0",
          weapons: ["spider's bite|0"],
          equipment: { arms: "flick knives|0" },
          hand: ["kiss of death|1", "infect|1"],
        },
        { hero: "dorinthea", hand: [BLUE, BLUE] },
      ],
    });

    s.play("kiss of death|1").blockWith(BLUE).settle().expectAP(0, 1);
    const kissId = s.state.chain[0]!.attackingCard.instanceId;
    const weaponId = s.state.players[0]!.weapons[0]!.instanceId;

    s.play("infect|1").blockWith(BLUE).activate("flick knives|0");
    expect(s.state.pendingDecision?.options).toEqual(expect.arrayContaining([
      String(kissId),
      String(weaponId),
    ]));

    s.chooseCard("kiss of death|1").expectLife(1, 18);
    expect(s.state.players[0]!.weapons.map((card) => card.instanceId)).toContain(weaponId);
    expect(s.state.players[0]!.graveyard.map((card) => card.instanceId)).toContain(kissId);
    expect(s.state.chain[0]!.flags.attackGone).toBe(true);
  });

  it("Flick Knives applies Hunter's Klaive's on-hit effect", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["infect|1"],
          weapons: ["hunter's klaive|0"],
          equipment: { arms: "flick knives|0" },
        },
        { hero: "dorinthea" },
      ],
    });
    const klaiveId = s.state.players[0]!.weapons[0]!.instanceId;

    s.play("infect|1").blockWith()
      .activate("flick knives|0", { settle: false })
      .passPriority().passPriority()
      .doRaw({ kind: "choose", optionId: String(klaiveId) })
      .expectLife(1, 19);

    s.expectInZone(0, "hunter's klaive|0", "graveyard");
    expect(s.state.players[1]!.hero.scriptState?.marked ?? 0).toBe(0);
    expect(s.state.stack[0]?.engineEffect?.kind).toBe("on-effect-hit-hook");
    expect(s.state.pendingDecision?.kind).toBe("attack-reaction");

    s.passPriority().passPriority();
    expect(s.state.players[1]!.hero.scriptState?.marked).toBe(1);
  });

  it.each([
    ["spider's bite|0", "wounding blow|1", 2],
    ["nerve scalpel|0", "ancestral empowerment|1", 2],
    ["orbitoclast|0", "bloodrush bellow|2", 2],
    ["scale peeler|0", "ironrot helm|0", 0],
  ] as const)("Flick Knives applies %s's on-hit defense penalty", (dagger, defender, expectedDefense) => {
    const defenderEquipment = defender === "ironrot helm|0"
      ? { head: defender }
      : undefined;
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "arakni, solitary confinement|0",
          hand: ["infect|1", "infect|1"],
          weapons: [dagger],
          equipment: { arms: "flick knives|0" },
        },
        {
          hero: "dorinthea",
          hand: [BLUE, ...(defenderEquipment ? [] : [defender])],
          ...(defenderEquipment ? { equipment: defenderEquipment } : {}),
        },
      ],
    });

    s.play("infect|1").blockWith(BLUE)
      .activate("flick knives|0")
      .chooseCard(dagger)
      .play("infect|1")
      .blockWith(defender)
      .settle()
      .expectFinalDefense(expectedDefense);
  });

  it("Flick Knives keeps a fully defended link in Mask of Momentum's hit streak", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["head jab|1", "head jab|1", "head jab|1", "head jab|1"],
          deck: [BLUE],
          weapons: ["spider's bite|0"],
          equipment: { head: "mask of momentum|0", arms: "flick knives|0" },
        },
        { hero: "dorinthea", hand: [BLUE] },
      ],
    });

    s.play("head jab|1").blockWith().settle();
    s.play("head jab|1").blockWith().settle();
    s.play("head jab|1").blockWith(BLUE).activate("flick knives|0").chooseCard("spider's bite|0");

    expect(s.state.chain[2]).toMatchObject({ damage: 0, hit: true, resolved: true });
    s.expectHandSize(0, 1).expectZoneSize(0, "deck", 1);

    s.play("head jab|1").blockWith().settle()
      .expectInZone(0, BLUE, "hand");
  });

  it("Fletch weakens matching-pitch defenders when the arrow has an aim counter", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["fletch a red tail|1", BLUE], arsenal: ["falcon wing|1"], weapons: ["death dealer|0"] },
        { hero: "dorinthea", hand: ["wounding blow|1"] },
      ],
    });
    s.state.players[0]!.arsenal[0]!.counters = { aim: 1 };
    s.play("fletch a red tail|1", { pitch: [BLUE] })
      .play("falcon wing|1", { fromArsenal: true })
      .blockWith("wounding blow|1").settle()
      .expectLife(1, 14);
  });

  it("Tarpit Trap suppresses the next attack-action hit without being spent by a miss", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["head jab|1", "infect|1"] },
        { hero: "dorinthea", arsenal: ["tarpit trap|2"] },
      ],
    });
    s.play("head jab|1").blockWith().passPriority().react("tarpit trap|2").settle()
      .play("infect|1").blockWith().settle();
    expect(s.state.players[1]!.board.some((card) => cardData[card.cardId]?.name === "Bloodrot Pox")).toBe(false);
  });

  it("Shake Down presents the revealed hand and lets the attacker choose the named color", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 4,
          hand: ["shake down|1"],
          equipment: { arms: "fisticuffs|0" },
        },
        { hero: "dorinthea", hand: ["raging onslaught|1", "wrecker romp|3"] },
      ],
    });

    s.play("shake down|1").blockWith()
      .activate("fisticuffs|0")
      .chooseOption("red");
    expect(s.state.pendingDecision?.chooseHook).toBe("shake-banish");
    expect(s.state.pendingDecision?.revealedCardIds).toHaveLength(2);
    expect(s.state.pendingDecision?.options).toHaveLength(1);
    expect(projectStateFor(s.state, 1).pendingDecision?.revealedCards).toHaveLength(2);
    s.chooseCard("raging onslaught|1").expectInZone(1, "raging onslaught|1", "banish");
  });
});

describe("OUT — rules regression coverage", () => {
  it("Quiver of Abyssal Depths shuffles in up to 3 chosen arrows with different names", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 3,
          deck: [BLUE],
          weapons: ["sandscour greatbow|0", "quiver of abyssal depths|0"],
          graveyard: ["infecting shot|1", "infecting shot|2", "falcon wing|1", "barbed undertow|1", NON_ATTACK],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });
    const graveyardId = (key: string) =>
      String(s.state.players[0]!.graveyard.find((c) => c.cardId === printingId(key))!.instanceId);

    s.activate("quiver of abyssal depths|0");
    while (s.state.pendingDecision?.chooseHook !== "abyssal-depths") s.passPriority();
    const pd = s.state.pendingDecision!;
    expect(pd.distinctCardNames).toBe(true);
    expect([pd.minimumSelections, pd.maximumSelections]).toEqual([0, 3]);
    expect(pd.options).toHaveLength(4);

    const offered = legalIntents(s.state, 0).flatMap((intent) => intent.kind === "choose-many" ? [intent.optionIds] : []);
    const infecting = [graveyardId("infecting shot|1"), graveyardId("infecting shot|2")];
    expect(offered[0]).toEqual([]);
    expect(offered.some((ids) => ids.length === 3)).toBe(true);
    expect(offered.every((ids) => ids.length <= 3 && !infecting.every((id) => ids.includes(id)))).toBe(true);

    expect(() =>
      s.doRaw({ kind: "choose-many", optionIds: infecting })
    ).toThrow(/different names/);
    s.chooseMany([graveyardId("infecting shot|2"), graveyardId("falcon wing|1")]);

    s.expectZoneSize(0, "deck", 3)
      .expectInZone(0, "infecting shot|2", "deck")
      .expectInZone(0, "falcon wing|1", "deck")
      .expectInZone(0, "infecting shot|1", "graveyard")
      .expectInZone(0, "barbed undertow|1", "graveyard")
      .expectInZone(0, NON_ATTACK, "graveyard");
  });

  it("Infiltrate's banished card stays playable until the end of the attacker's next turn", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["infiltrate|1"] },
        { hero: "dorinthea", hand: [], deck: ["cut through|1"] },
      ],
    });

    g.play("infiltrate|1").blockWith().settle().expectInZone(1, "cut through|1", "banish");
    g.endTurn().endTurn().expectTurn(3);
    g.play("cut through|1", { fromZone: "banish" }).expectNotInZone(1, "cut through|1", "banish");
    expect(g.state.chain.at(-1)?.attackingCard.cardId).toBe(printingId("cut through|1"));
  });

  it("Infiltrate's banished card expires after the attacker's next turn", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["infiltrate|1"] },
        { hero: "dorinthea", hand: [], deck: ["cut through|1"] },
      ],
    });

    g.play("infiltrate|1").blockWith().settle();
    g.endTurn().endTurn().endTurn().endTurn().expectTurn(5)
      .expectNoLegalPlay("cut through|1");
  });

  it("Redback Shroud reduces the next attack reaction's cost", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", resources: 3, hand: ["pummel|1"], equipment: { chest: "redback shroud|0" } },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.attackWithWeapon()
      .blockWith()
      .expectNoLegalPlay("pummel|1")
      .activate("redback shroud|0", { settle: false })
      .passPriority()
      .passPriority()
      .react("pummel|1")
      .expectResources(0, 0)
      .expectFinalAttack(8)
      .expectInZone(0, "redback shroud|0", "graveyard");
  });

  it("Premeditate creates a Ponder when the next attack action card hits a hero", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["premeditate|1", "scar for a scar|1"], deck: [BLUE] },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("premeditate|1")
      .play("scar for a scar|1")
      .expectAttackValue(4)
      .blockWith()
      .settle()
      .expectInZone(0, "ponder|0", "board");
  });

  it.each([
    "bonds of ancestry|1",
    "gustwave of the second wind|1",
  ])("%s does not have unconditional go again", (card) => {
    const s = scenario({
      seats: [
        { hero: "rhinar", resources: 2, hand: [card] },
        { hero: "dorinthea" },
      ],
    });

    s.play(card).blockWith().settle().expectAP(0, 0);
  });

  it("Bonds of Ancestry lets its searched same-name card be played this combat chain", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 2,
          hand: ["surging strike|1", "descendent gustwave|1", "bonds of ancestry|1"],
          graveyard: ["gustwave of the second wind|1"],
          deck: ["gustwave of the second wind|1"],
        },
        { hero: "dorinthea" },
      ],
    });

    s.play("surging strike|1")
      .blockWith()
      .settle()
      .play("descendent gustwave|1")
      .blockWith()
      .settle()
      .play("bonds of ancestry|1")
      .chooseCard("gustwave of the second wind|1")
      .chooseCard("gustwave of the second wind|1")
      .blockWith()
      .settle()
      .play("gustwave of the second wind|1", { fromZone: "banish" });
  });

  it.each([
    ["Bonds of Ancestry", 4],
    ["Bonds of Agony", 2],
  ] as const)(
    "Dishonor checks Retrace the Past named %s for its combo bonus",
    (chosenName, expectedAttack) => {
      const s = scenario({
        seats: [
          {
            hero: "rhinar",
            resources: 2,
            hand: [
              "surging strike|1",
              "descendent gustwave|1",
              "retrace the past|3",
              "dishonor|3",
            ],
          },
          { hero: "dorinthea" },
        ],
      });

      s.play("surging strike|1").blockWith().settle()
        .play("descendent gustwave|1").blockWith().settle()
        .play("retrace the past|3").chooseName(chosenName).blockWith().settle()
        .play("dishonor|3")
        .expectAttackValue(expectedAttack);
    },
  );

  it.each(["Crazy Brew", "Crouching Tiger", "Moon Wish"])(
    "Mask of Many Faces can name %s",
    (chosenName) => {
      const s = scenario({
        seats: [
          {
            hero: "rhinar",
            resources: 1,
            hand: ["head jab|1"],
            equipment: { head: "mask of many faces|0" },
          },
          { hero: "dorinthea" },
        ],
      });

      s.activate("mask of many faces|0");
      expect(s.state.pendingDecision).toMatchObject({
        kind: "choose-name",
        chooseHook: "mask-name",
      });

      s.chooseName(chosenName).play("head jab|1");
      expect(s.state.chain.at(-1)!.attackingCard.grantedNames).toContain(chosenName);
    },
  );
  it("Buzzsaw Trap prevents an attack from gaining power", () => {
    const s = scenario({
      active: 1,
      seats: [
        { hero: "rhinar", hand: ["buzzsaw trap|3"] },
        { hero: "dorinthea", hand: ["head jab|1", "nimblism|1", "razor reflex|1"], resources: 1 },
      ],
    });
    s.play("nimblism|1").settle();
    s.play("head jab|1").blockWith().expectAttackValue(6).passPriority()
      .react("buzzsaw trap|3", { settle: false })
      .passPriority().passPriority() // Resolve Buzzsaw Trap.
      .passPriority().passPriority() // Resolve its "when this defends" trigger.
      .expectAttackValue(3) // Buzzsaw Trap stops buffs that already happened
      .react("razor reflex|1", { settle: false })
      .passPriority().passPriority()
      .expectAttackValue(3); // Buzzsaw Trap stops future buffs from happening
  });

  it("Riptide deals damage when a controlled trap triggers", () => {
    const s = scenario({
      active: 1,
      seats: [
        { hero: "rhinar", heroKey: "riptide|0", arsenal: ["frailty trap|1"] },
        { hero: "dorinthea", hand: ["head jab|1", BLUE] },
      ],
    });
    s.play("head jab|1").blockWith().passPriority().react("frailty trap|1").settle();
    expect(s.state.players[1]!.life).toBe(19);
  });

  it.each(["chain reaction|2", "collapsing trap|3"])(
    "Riptide, Lurker of the Deep deals damage when %s triggers",
    (trap) => {
      const s = scenario({
        active: 1,
        seats: [
          { hero: "rhinar", heroKey: "riptide, lurker of the deep|0", arsenal: [trap] },
          { hero: "dorinthea", hand: ["head jab|1", BLUE] },
        ],
      });
      s.play("head jab|1").blockWith().passPriority().react(trap).settle();
      expect(s.state.players[1]!.life).toBe(19);
    },
  );

  describe("Riptide, Lurker of the Deep's arsenal trigger", () => {
    const lurker = (spec: { arsenal?: string[]; arsenalFaceDown?: string[]; head?: string } = {}) =>
      scenario({
        seats: [
          {
            hero: "rhinar",
            heroKey: "riptide, lurker of the deep|0",
            hand: ["wounded bull|1", BLUE, BLUE],
            resources: 3,
            ...(spec.arsenal ? { arsenal: spec.arsenal } : {}),
            ...(spec.arsenalFaceDown ? { arsenalFaceDown: spec.arsenalFaceDown } : {}),
            ...(spec.head ? { equipment: { head: spec.head } } : {}),
          },
          { hero: "dorinthea" },
        ],
      });

    it("offers hand cards directly and arsenals the picked one face down", () => {
      const g = lurker();
      g.play("wounded bull|1", { pitch: [] });
      const hand = g.state.players[0]!.hand;
      const blue = hand.find((card) => card.cardId === printingId(BLUE))!.instanceId;
      expect(g.state.pendingDecision).toMatchObject({ chooseHook: "riptide-arsenal", defaultOption: "pass" });
      expect(g.state.pendingDecision?.options).toEqual(["pass", ...hand.map((card) => String(card.instanceId))]);
      g.chooseOption(String(blue));
      expect(g.state.players[0]!.arsenal).toMatchObject([{ instanceId: blue, faceDown: true }]);
    });

    it("does not trigger with a full arsenal", () => {
      const g = lurker({ arsenalFaceDown: [BLUE] });
      g.play("wounded bull|1", { pitch: [] });
      expect(g.state.pendingDecision?.chooseHook).not.toBe("riptide-arsenal");
      expect(g.state.log.some((entry) => entry.publicText?.includes("face down into arsenal?"))).toBe(false);
    });

    it("triggers when New Horizon adds a second arsenal zone", () => {
      const g = lurker({ arsenal: ["falcon wing|1"], head: "new horizon|0" });
      g.play("wounded bull|1", { pitch: [] });
      expect(g.state.pendingDecision?.chooseHook).toBe("riptide-arsenal");
    });
  });

  it("Be Like Water's chosen name enables the matching Combo condition", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", resources: 1, hand: ["be like water|1", "descendent gustwave|1", BLUE] },
        { hero: "dorinthea" },
      ],
    });
    s.play("be like water|1").blockWith().settle()
      .chooseOption("pay 1").chooseOption("Surging Strike")
      .play("descendent gustwave|1")
      .expectAttackValue(5);
  });

  it("Back Heel Kick replaces an existing all-zone power gain", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["twin twisters|1", "back heel kick|1", BLUE] },
        { hero: "dorinthea" },
      ],
    });
    s.play("twin twisters|1", { pitch: [BLUE] })
      .chooseOption("next attack")
      .blockWith().settle()
      .play("back heel kick|1")
      .expectAttackValue(5);
  });

  it("Brush Off skips an oversized packet and prevents the next eligible packet", () => {
    const s = scenario({
      active: 1,
      seats: [
        { hero: "rhinar", hand: ["brush off|1"] },
        { hero: "dorinthea", hand: ["dust runner outlaw|1", "be like water|1", BLUE] },
      ],
    });
    s.play("dust runner outlaw|1", { pitch: [BLUE] }).blockWith()
      .passPriority().react("brush off|1").settle()
      .expectLife(0, 16)
      .play("be like water|1").blockWith().settle()
      .expectLife(0, 16);
  });

  it("Uzuri replaces the stealth attack with the same card banished for the cost", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", heroKey: "uzuri|0", hand: ["infect|1", "sneak attack|1", BLUE] },
        { hero: "dorinthea" },
      ],
    });
    s.play("infect|1").blockWith()
      .activate("uzuri|0")
      .chooseCard("sneak attack|1");
    expect(cardData[s.state.chain.at(-1)!.attackingCard.cardId]!.name).toBe("Sneak Attack");
    expect(s.state.players[0]!.hand.map((card) => cardData[card.cardId]?.name)).toContain("Wrecker Romp");
    expect(s.state.players[0]!.banish).toHaveLength(0);
    expect(s.state.log.find((entry) => entry.publicText?.includes("banished"))?.publicText)
      .toBe("A face-down card is banished");
  });

  it("Uzuri's replacement attack counts as not played from hand or arsenal", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", heroKey: "uzuri|0", hand: ["infect|1", "remember the mists|3"] },
        { hero: "dorinthea" },
      ],
    });
    s.play("infect|1").blockWith()
      .activate("uzuri|0")
      .chooseCard("remember the mists|3");
    expect(cardData[s.state.chain.at(-1)!.attackingCard.cardId]!.name).toBe("Remember the Mists");
    expect(s.state.chain.at(-1)!.damage).toBe(6);
  });

  it("Uzuri turns an ineligible cost card face up without replacing the attack", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", heroKey: "uzuri|0", hand: ["infect|1", NON_ATTACK] },
        { hero: "dorinthea" },
      ],
    });
    s.play("infect|1").blockWith()
      .activate("uzuri|0")
      .chooseCard(NON_ATTACK);
    expect(cardData[s.state.chain.at(-1)!.attackingCard.cardId]!.name).toBe("Infect");
    expect(s.state.players[0]!.banish).toHaveLength(1);
    expect(s.state.players[0]!.banish[0]!.faceDown).not.toBe(true);
  });

  it("Uzuri replaces an attacking Graphene Chelicera and the token ceases to exist", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "uzuri|0",
          weapons: [GRAPHENE],
          resources: 1,
          hand: ["sneak attack|1"],
        },
        { hero: "dorinthea" },
      ],
    });
    s.attackWithWeapon(GRAPHENE).blockWith()
      .activate("uzuri|0")
      .chooseCard("sneak attack|1");

    expect(cardData[s.state.chain.at(-1)!.attackingCard.cardId]!.name).toBe("Sneak Attack");
    expect(s.state.chain.at(-1)!.attackCardType).toBe("action");
    expect(s.state.players[0]!.weapons).toHaveLength(0);
    s.expectNotInZone(0, GRAPHENE, "deck")
      .expectNotInZone(0, GRAPHENE, "graveyard")
      .expectLog("Graphene Chelicera ceases to exist");
  });
});
