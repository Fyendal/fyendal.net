import { describe, expect, it } from "vitest";
import { legalIntents, projectStateFor } from "@fyendal/engine";
import { cardData, scripts } from "../../index.js";
import { functionalKeyOf } from "../../functional.js";
import { printingId, scenario } from "../harness.js";

const BLUE = "wrecker romp|3";
const NO_EQUIPMENT = { head: null, chest: null, arms: null, legs: null } as const;

describe("DTD — registration and core mechanics", () => {
  it("registers the complete set", () => {
    expect(Object.keys(cardData).filter((id) => id.startsWith("DTD"))).toHaveLength(245);
    for (const id of ["DTD001", "DTD002", "DTD044", "DTD045", "DTD103", "DTD104", "DTD133", "DTD134"]) {
      expect(cardData[id]?.cardType).toBe("hero");
      expect(scripts[id]).toBeDefined();
    }
  });

  it("Star Struck limits attack plays and activations by damage dealt", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", resources: 7, hand: ["star struck|2"] },
        {
          hero: "dorinthea",
          hand: [
            "ravenous rabble|1",
            "star struck|2",
            "crippling crush|1",
            "nimblism|1",
            BLUE,
            BLUE,
            BLUE,
          ],
        },
      ],
    });

    s.play("star struck|2").blockWith().settle().endTurn();

    const defender = s.state.players[1]!;
    const legal = legalIntents(s.state, 1);
    const canPlay = (key: string): boolean => {
      const instance = defender.hand.find((card) => card.cardId === printingId(key));
      return !!instance && legal.some((intent) =>
        intent.kind === "play-card" && intent.instanceId === instance.instanceId
      );
    };
    expect(canPlay("ravenous rabble|1")).toBe(false);
    expect(canPlay("star struck|2")).toBe(false);
    expect(canPlay("crippling crush|1")).toBe(true);
    expect(canPlay("nimblism|1")).toBe(true);
    expect(legal.some((intent) =>
      intent.kind === "activate-ability" &&
      defender.weapons.some((weapon) => weapon.instanceId === intent.sourceInstanceId)
    )).toBe(false);
    expect(projectStateFor(s.state, 1).ongoing).toContainEqual(expect.objectContaining({
      seat: 1,
      label: expect.stringContaining("only attacks with base attack 11+ · this turn"),
    }));

    s.endTurn();
    expect(s.state.modifiers.some((modifier) => modifier.minimumAttackBasePower !== undefined)).toBe(false);
  });

  it("Rune Gate plays from banish without paying and Runechants still trigger", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", heroKey: "vynnset|0", banish: ["rift skitter|1"], board: ["runechant|0", "runechant|0", "runechant|0"] },
        { hero: "dorinthea" },
      ],
    });
    s.play("rift skitter|1", { fromZone: "banish" })
      .expectAttackValue(4)
      .expectZoneSize(0, "board", 0)
      .expectLife(1, 17);
  });

  it("Oblivion creates Nasreth rather than Reality Refractor", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["oblivion|3"],
          board: Array(6).fill("runechant|0") as string[],
        },
        { hero: "dorinthea" },
      ],
    });

    s.play("oblivion|3")
      .expectInZone(0, "nasreth, the soul harrower|0", "board")
      .expectNotInZone(0, "reality refractor|0", "board");
  });

  it("Flail of Agony pays 1 life and makes a banished Cull playable on the open chain", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "vynnset|0",
          life: 10,
          weapons: ["flail of agony|0"],
          hand: ["ravenous rabble|1"],
          deck: ["wounding blow|3"],
          banish: ["cull|1"],
        },
        { hero: "dorinthea", hand: ["wounding blow|3"] },
      ],
    });
    const cull = s.state.players[0]!.banish[0]!;
    const canPlayCullAsInstant = () => legalIntents(s.state, 0).some((intent) =>
      intent.kind === "play-from-zone" &&
      intent.instanceId === cull.instanceId &&
      intent.asInstant === true
    );

    s.play("ravenous rabble|1")
      .blockWith("wounding blow|3")
      .settle();
    expect(s.state.chain).toHaveLength(1);
    expect(s.state.players[0]!.actionPoints).toBe(1);
    expect(s.state.players[0]!.flags.lostLifeThisTurn).not.toBe(true);
    expect(canPlayCullAsInstant()).toBe(false);

    s.attackWithWeapon("flail of agony|0").expectLife(0, 9);
    expect(s.state.players[0]!.flags.lostLifeThisTurn).toBe(true);

    s.blockWith();
    expect(canPlayCullAsInstant()).toBe(true);
  });

  it("Poison the Well replaces the next life gain with equal life loss", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", life: 10, hand: ["poison the well|3", "sigil of solace|1"] },
        { hero: "dorinthea" },
      ],
    });

    s.play("poison the well|3")
      .play("sigil of solace|1")
      .expectLife(0, 7);
  });

  it("United We Stand creates Courage when Dorinthea defends with it and another hand card", () => {
    const s = scenario({
      seats: [
        { hero: "dorinthea", hand: ["united we stand|2", "wounding blow|3"] },
        { hero: "rhinar", hand: ["head jab|1"] },
      ],
      active: 1,
    });

    s.play("head jab|1")
      .blockWith("united we stand|2", "wounding blow|3")
      .settle()
      .expectInZone(0, "courage|0", "board");

    const rhinar = scenario({
      seats: [
        { hero: "rhinar", hand: ["united we stand|2", "wounding blow|3"] },
        { hero: "dorinthea", hand: ["head jab|1"] },
      ],
      active: 1,
    });
    rhinar.play("head jab|1")
      .blockWith("united we stand|2", "wounding blow|3")
      .settle();
    expect(rhinar.state.players[0]!.board).toHaveLength(0);
  });

  it("Expendable Limbs grants its banished 6-power card for the next action phase", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["expendable limbs|3", "gore belching|1"] },
        { hero: "dorinthea", hand: ["head jab|1"] },
      ],
      active: 1,
    });

    s.play("head jab|1")
      .blockWith()
      .passPriority()
      .react("expendable limbs|3")
      .endTurn();

    const banished = s.state.players[0]!.banish.find(
      (card) => card.cardId === printingId("gore belching|1"),
    );
    expect(banished).toBeDefined();
    expect(legalIntents(s.state, 0)).toContainEqual(expect.objectContaining({
      kind: "play-from-zone",
      zone: "banish",
      instanceId: banished!.instanceId,
    }));
  });

  it("Envelop in Darkness buffs only the next rune-gated attack", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar", heroKey: "vynnset|0", resources: 1,
          hand: ["envelop in darkness|1"], banish: ["rift skitter|1"],
          board: ["runechant|0", "runechant|0"],
        },
        { hero: "dorinthea" },
      ],
    });
    s.play("envelop in darkness|1").chooseOption("no")
      .play("rift skitter|1", { fromZone: "banish" })
      .expectAttackValue(7);
  });

  it("Solflare bannerets apply their next-defense and next-hit rewards", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", heroKey: "boltyn|0", hand: ["beaming bravado|3", "banneret of vigor|2"] },
        { hero: "dorinthea" },
      ],
    });
    s.play("beaming bravado|3").chooseCard("banneret of vigor|2")
      .blockWith().settle()
      .expectResources(0, 1);
  });

  it("random-banish attacks recognize a six-power card banished for their own cost", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", resources: 2, hand: ["tribute to demolition|1", "wrecker romp|3"] },
        { hero: "dorinthea" },
      ],
    });
    s.play("tribute to demolition|1").expectAttackValue(8);
  });

  it("Blood Debt triggers from banish and adult Levia suppresses it after a six-power banish", () => {
    const ordinary = scenario({
      seats: [
        { hero: "rhinar", banish: ["grim feast|1"] },
        { hero: "dorinthea" },
      ],
    });
    ordinary.endTurn().expectLife(0, 19);

    const levia = scenario({
      seats: [
        { hero: "rhinar", heroKey: "levia, shadowborn abomination|0", banish: ["grim feast|1"] },
        { hero: "dorinthea" },
      ],
    });
    levia.state.players[0]!.flags.banishedSixPlusThisTurn = true;
    levia.endTurn().expectLife(0, cardData["DTD103"]!.life!);
  });

  it("Levia does not erase Blood Debt already triggered before an end-phase six-power banish", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "levia, shadowborn abomination|0",
          life: 20,
          hand: ["shaden death hydra|2"],
          banish: ["grim feast|1"],
          board: ["blasmophet, the insatiable hunger|0"],
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });

    s.doRaw({ kind: "pass" });
    const order = s.state.pendingDecision;
    expect(order?.kind).toBe("order-triggers");
    const blasmophet = order?.options?.find((_, index) =>
      order.optionLabels?.[index] === "Banish a hand card, then check the hunger"
    );
    const bloodDebt = order?.options?.find((_, index) =>
      order.optionLabels?.[index] === "Blood Debt — lose 1 life"
    );
    expect(blasmophet).toBeDefined();
    expect(bloodDebt).toBeDefined();

    s.doRaw({ kind: "order-triggers", optionIds: [blasmophet!, bloodDebt!] })
      .chooseCard("shaden death hydra|2")
      .expectLife(0, 19);
  });

  it("pauses a counted Blood Debt layer when Levia reaches exactly 13 life", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "levia, shadowborn abomination|0",
          life: 14,
          deck: [BLUE],
          banish: ["grim feast|1", "ghostly visit|1"],
          inventory: ["blasmophet, levia consumed|0"],
        },
        { hero: "dorinthea" },
      ],
    });
    s.doRaw({ kind: "pass" }).expectLife(0, 13);
    expect(s.state.pendingDecision).toMatchObject({
      kind: "optional-effect",
      prompt: "Transform into Blasmophet, Levia Consumed?",
      options: ["yes", "no"],
    });
    // One occurrence was consumed before the transform choice opened.
    expect(s.state.stack).toHaveLength(1);
    expect(s.state.stack[0]).toMatchObject({
      label: "Blood Debt — lose 1 life",
    });
    expect(s.state.stack[0]?.triggerCount).toBe(1);
    expect(s.state.stack[0]?.triggerBatchStarted).toBe(true);
  });

  it("transforms Levia and replaces the remaining Blood Debt life loss", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "levia, shadowborn abomination|0",
          life: 14,
          deck: [BLUE],
          banish: ["grim feast|1", "ghostly visit|1"],
          inventory: ["blasmophet, levia consumed|0"],
        },
        { hero: "dorinthea" },
      ],
    });
    s.doRaw({ kind: "pass" });
    s.doRaw({ kind: "choose", optionId: "yes" }).expectLife(0, 13).expectTurn(2);
    expect(cardData[s.state.players[0]!.heroCardId]?.name).toBe("Blasmophet, Levia Consumed");
    expect(s.state.players[0]!.inventory).toEqual([]);
    expect(s.state.players[0]!.soul).toHaveLength(1);
    expect(cardData[s.state.players[0]!.soul[0]!.cardId]?.name)
      .toBe("Levia, Shadowborn Abomination");
    expect(s.state.players[0]!.deck).toEqual([]);
    expect(s.state.players[0]!.banish.find((card) => card.cardId === printingId(BLUE))?.faceDown)
      .toBe(true);
  });

  it("continues losing life when Levia declines the exact-13 transform", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "levia, shadowborn abomination|0",
          life: 14,
          banish: ["grim feast|1", "ghostly visit|1"],
          inventory: ["blasmophet, levia consumed|0"],
        },
        { hero: "dorinthea" },
      ],
    });
    s.doRaw({ kind: "pass" });
    s.doRaw({ kind: "choose", optionId: "no" }).expectLife(0, 12).expectTurn(2);
    expect(cardData[s.state.players[0]!.heroCardId]?.name)
      .toBe("Levia, Shadowborn Abomination");
    expect(s.state.players[0]!.inventory).toHaveLength(1);
    expect(s.state.players[0]!.soul).toEqual([]);
  });

  it("Blasmophet replaces every counted Blood Debt loss with a top-card banish", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "blasmophet, levia consumed|0",
          life: 13,
          deck: [BLUE, "raging onslaught|2"],
          banish: ["grim feast|1", "ghostly visit|1"],
        },
        { hero: "dorinthea" },
      ],
    });

    s.endTurn().expectLife(0, 13).expectTurn(2).expectZoneSize(0, "deck", 0);
    const replacements = s.state.players[0]!.banish.filter((card) =>
      card.cardId === printingId(BLUE) ||
      card.cardId === printingId("raging onslaught|2")
    );
    expect(replacements).toHaveLength(2);
    expect(replacements.every((card) => card.faceDown === true)).toBe(true);
  });

  it("Figment of Erudition creates Ponder when it enters the arena", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", resources: 4, hand: ["figment of erudition|2"] },
        { hero: "dorinthea" },
      ],
    });
    s.play("figment of erudition|2")
      .expectInZone(0, "figment of erudition|2", "board")
      .expectInZone(0, "ponder|0", "board");
  });

  it("Alluring Inducement presents the full revealed hand and only enables attacks", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", resources: 2, hand: ["alluring inducement|2"] },
        { hero: "dorinthea", hand: ["raging onslaught|1", "sigil of solace|1"] },
      ],
    });

    s.play("alluring inducement|2");
    const decision = s.state.pendingDecision;
    expect(decision?.chooseHook).toBe("inducement");
    expect(decision?.revealedCardIds).toHaveLength(2);
    expect(decision?.options).toHaveLength(2); // decline + the one attack
    expect(projectStateFor(s.state, 0).pendingDecision?.revealedCards).toHaveLength(2);
    s.chooseOption("no");
  });

  it("Alluring Inducement offers Close when the revealed hand has no attack", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", resources: 2, hand: ["alluring inducement|2"] },
        { hero: "dorinthea", hand: ["sigil of solace|1"] },
      ],
    });

    s.play("alluring inducement|2");
    expect(s.state.pendingDecision?.options).toEqual(["Close"]);
  });

  it("Warmonger's Diplomacy asks the opponent first and shows both chosen modes", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["warmonger's diplomacy|3"] },
        { hero: "dorinthea" },
      ],
    });

    s.play("warmonger's diplomacy|3");
    expect(s.state.pendingDecision).toMatchObject({
      player: 1,
      chooseHook: "diplomacy-opponent",
    });
    s.chooseOption("war");
    expect(s.state.pendingDecision).toMatchObject({
      player: 0,
      chooseHook: "diplomacy-self",
    });
    s.chooseOption("peace");

    expect(projectStateFor(s.state, 0).ongoing).toEqual(expect.arrayContaining([
      {
        seat: 1,
        cardId: printingId("warmonger's diplomacy|3"),
        label: "War · next turn",
      },
      {
        seat: 0,
        cardId: printingId("warmonger's diplomacy|3"),
        label: "Peace · next turn",
      },
    ]));
  });

  it.each(["war", "peace"] as const)(
    "Warmonger's Diplomacy still allows instant cards after choosing %s",
    (mode) => {
      const s = scenario({
        seats: [
          {
            hero: "rhinar",
            life: 17,
            hand: ["warmonger's diplomacy|3", "sigil of solace|1"],
          },
          { hero: "dorinthea" },
        ],
      });

      s.play("warmonger's diplomacy|3")
        .chooseOption("war")
        .chooseOption(mode)
        .play("sigil of solace|1")
        .expectLife(0, 20);
    },
  );

  it("Warmonger's Diplomacy war restricts equipment and board action abilities", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["warmonger's diplomacy|3"] },
        {
          hero: "dorinthea",
          hand: [BLUE],
          board: ["potion of strength|3", "barnacle|2"],
          equipment: { head: "helm of isen's peak|0" },
        },
      ],
    });

    s.play("warmonger's diplomacy|3")
      .chooseOption("war")
      .chooseOption("peace")
      .endTurn();

    expect(() => s.activate("helm of isen's peak|0", { pitch: [BLUE] })).toThrow(/no legal intent/);
    expect(() => s.activate("potion of strength|3")).toThrow(/no legal intent/);
    s.activate("barnacle|2");
  });

  it("Warmonger's Diplomacy peace restricts board attacks but allows non-attack permanents", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["warmonger's diplomacy|3"] },
        {
          hero: "dorinthea",
          hand: [BLUE],
          board: ["potion of strength|3", "barnacle|2"],
          equipment: { head: "helm of isen's peak|0" },
        },
      ],
    });

    s.play("warmonger's diplomacy|3")
      .chooseOption("peace")
      .chooseOption("peace")
      .endTurn();

    expect(() => s.activate("barnacle|2")).toThrow(/no legal intent/);
    s.activate("potion of strength|3")
      .activate("helm of isen's peak|0", { pitch: [BLUE] });
  });

  it("Scowling Flesh Bag intimidates a card out of the attacker's hand when it defends", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", equipment: { head: "scowling flesh bag|0" } },
        { hero: "dorinthea", hand: ["head jab|1", "raging onslaught|1", "raging onslaught|2"] },
      ],
      active: 1,
    });

    s.play("head jab|1")
      .blockWith("scowling flesh bag|0")
      .settle()
      .expectPendingReturn(1, 1) // a random hand card banished face down
      .expectHandSize(1, 1);
  });

  it("Blasmophet plays only face-up Blood Debt cards from the banished zone", () => {
    const banishPlays = (s: ReturnType<typeof scenario>) =>
      legalIntents(s.state, 0).filter((i) => i.kind === "play-from-zone" && i.zone === "banish");
    const faceUp = scenario({
      seats: [
        { hero: "rhinar", heroKey: "blasmophet, levia consumed|0", resources: 6, banish: ["shaden death hydra|2"] },
        { hero: "dorinthea" },
      ],
    });
    expect(banishPlays(faceUp)).toHaveLength(1);

    const faceDown = scenario({
      seats: [
        { hero: "rhinar", heroKey: "blasmophet, levia consumed|0", resources: 6, banishFaceDown: ["shaden death hydra|2"] },
        { hero: "dorinthea" },
      ],
    });
    expect(banishPlays(faceDown)).toEqual([]);
  });

  it("a face-down banished Funeral Moon cannot be played — face-down cards have no properties", () => {
    const banishPlays = (s: ReturnType<typeof scenario>) =>
      legalIntents(s.state, 0).filter((i) => i.kind === "play-from-zone" && i.zone === "banish");
    const faceUp = scenario({
      seats: [
        { hero: "rhinar", heroKey: "vynnset|0", banish: ["funeral moon|1"] },
        { hero: "dorinthea" },
      ],
    });
    expect(banishPlays(faceUp)).toHaveLength(1);

    const faceDown = scenario({
      seats: [
        { hero: "rhinar", heroKey: "vynnset|0", banishFaceDown: ["funeral moon|1"] },
        { hero: "dorinthea" },
      ],
    });
    expect(banishPlays(faceDown)).toEqual([]);
  });
});

describe("DTD — Prism and Figments", () => {
  it("Prism searches for a Figment when a Herald enters her soul, then awakens it", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "prism, advent of thrones|0",
          hand: ["herald of protection|1"],
          deck: ["figment of protection|2"],
          resources: 4,
        },
        { hero: "dorinthea" },
      ],
    });
    s.play("herald of protection|1").blockWith().settle()
      .doRaw({ kind: "close-chain" })
      .chooseCard("figment of protection|2");
    expect(s.state.players[0]!.board.some((card) => card.cardId === "DTD007")).toBe(true);

    s.activate("prism, advent of thrones|0", { settle: false })
      .chooseCard("herald of protection|1")
      .chooseCard("figment of protection|2");
    expect(s.state.players[0]!.board.some((card) => card.cardId === "DTD007B")).toBe(true);
  });

  it("Aegis may banish a soul card on attack to create 2 Spectral Shields", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", board: ["aegis, archangel of protection|0"], soul: [BLUE], resources: 2 },
        { hero: "dorinthea" },
      ],
    });
    s.activate("aegis, archangel of protection|0", { settle: false })
      .chooseCard(BLUE)
      .blockWith()
      .settle();
    expect(s.state.players[0]!.board.filter(
      (card) => functionalKeyOf(cardData[card.cardId]!) === "spectral shield|0",
    )).toHaveLength(2);
  });

  it("Decimator Great Axe can halve a defending equipment card's base defense", () => {
    const s = scenario({
      seats: [
        {
          hero: "dorinthea",
          weapons: ["decimator great axe|0"],
          resources: 3,
          equipment: NO_EQUIPMENT,
        },
        {
          hero: "rhinar",
          hand: ["raging onslaught|3"],
          equipment: { head: null, chest: "tectonic plating|0", arms: null, legs: null },
        },
      ],
    });

    s.attackWithWeapon("decimator great axe|0")
      .blockWith("raging onslaught|3", "tectonic plating|0")
      .settle();

    const plating = s.state.chain.at(-1)?.defendingEquipment[0];
    expect(plating).toBeDefined();
    expect(s.state.pendingDecision?.options).toContain(String(plating!.instanceId));

    s.chooseCard("tectonic plating|0");
    expect(s.state.chain.at(-1)?.defendingEquipment[0]?.tempDefense).toBe(-1);
  });

  it("Reality Refractor makes an Illusionist aura attack for 5", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", heroKey: "prism, advent of thrones|0", weapons: ["reality refractor|0"], board: ["blessing of spirits|1"], resources: 2 },
        { hero: "dorinthea" },
      ],
    });
    const aura = s.state.players[0]!.board[0]!;
    expect(legalIntents(s.state, 0).some((intent) => intent.kind === "activate-ability" && intent.sourceInstanceId === aura.instanceId)).toBe(true);
    s.activate("blessing of spirits|1", { settle: false }).expectAttackValue(5);
  });

  it("Vynnset makes the next Runechant damage unpreventable", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", heroKey: "vynnset|0", resources: 1, hand: ["envelop in darkness|1"], banish: ["rift skitter|1"], board: ["runechant|0", "runechant|0"] },
        { hero: "dorinthea" },
      ],
    });
    s.state.players[1]!.flags.preventNextArcaneDamage = 3;
    s.play("envelop in darkness|1").chooseOption("yes")
      .play("rift skitter|1", { fromZone: "banish" });
    expect(s.state.players[1]!.life).toBe(19);
  });

  it("warns that Vynnset's Runechant stays unpreventable through Arcane Barrier and Ward", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "vynnset|0",
          resources: 1,
          hand: ["envelop in darkness|1", "head jab|3"],
          board: ["runechant|0"],
        },
        {
          hero: "dorinthea",
          hand: [BLUE],
          board: ["auric shards|1"],
          equipment: { head: null, chest: null, arms: null, legs: "blitz kicks|0" },
        },
      ],
    });

    s.play("envelop in darkness|1")
      .chooseOption("yes")
      .play("head jab|3");
    expect(s.state.pendingDecision).toMatchObject({
      player: 1,
      chooseHook: "arcane-barrier",
      arcane: { unpreventable: true },
      options: ["pay 0", "pay 1"],
    });
    expect(s.state.pendingDecision?.prompt).toBe("Warning: this damage cannot be prevented.");

    s.chooseOption("pay 1");
    expect(s.state.pendingDecision?.prompt).toBe("Warning: this damage cannot be prevented.");
    s.chooseCard(BLUE);
    expect(s.state.pendingDecision).toMatchObject({ player: 1, chooseHook: "ward" });

    s.chooseOption("destroy")
      .expectLife(1, 19)
      .expectNotInZone(1, "auric shards|1", "board")
      .expectZoneSize(1, "hand", 0);
  });

  it("Darkness equipment prevention may be declined", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["fervent forerunner|3"] },
        { hero: "dorinthea", equipment: { head: "shroud of darkness|0" } },
      ],
    });
    s.play("fervent forerunner|3").blockWith().settle().chooseOption("decline")
      .expectLife(1, 19)
      .expectEquipped(1, "head", "shroud of darkness|0");
  });

  it("Break of Dawn prevents a Shadow stack source", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", resources: 2, hand: ["envelop in darkness|1", "shaden swing|1", BLUE, BLUE] },
        { hero: "dorinthea", hand: ["break of dawn|1"] },
      ],
    });
    s.play("envelop in darkness|1", { settle: false }).passPriority()
      .react("break of dawn|1")
      .play("shaden swing|1")
      .blockWith().settle();
    expect(s.state.players[1]!.life).toBe(16);
  });
});
