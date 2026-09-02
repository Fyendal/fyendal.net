import { describe, expect, it } from "vitest";
import { applyIntent, legalIntents, projectStateFor } from "@fyendal/engine";
import { cardData } from "../../index.js";
import { printingId, scenario } from "../harness.js";

/** Scenarios for the SGB set (Silver Age: Gravy Bones precon). */

const GRAVY = {
  hero: "rhinar" as const,
  heroKey: "gravy bones|0",
  weapons: [] as string[],
  equipment: { head: null, chest: null, arms: null, legs: null } as Record<string, null>,
};

describe("SGB — High Tide", () => {
  it("Battalion Barque gets +2{p} with 2 blue cards in pitch", () => {
    const g = scenario({
      seats: [
        {
          ...GRAVY,
          hand: ["battalion barque|1", "jittery bones|3", "saltwater swell|3"],
          pitch: ["murderous rabble|3", "back alley breakline|3"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.play("battalion barque|1", { pitch: ["jittery bones|3", "saltwater swell|3"] })
      .expectAttackValue(9) // 7 + 2 (High Tide)
      .blockWith()
      .settle()
      .expectLife(1, 11);
  });

  it("Battalion Barque without High Tide is a plain 7", () => {
    const g = scenario({
      seats: [
        { ...GRAVY, hand: ["battalion barque|1", "golden tipple|2", "barnacle|2"] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    // pitched yellows: the pitch zone stays below High Tide
    g.play("battalion barque|1", { pitch: ["golden tipple|2", "barnacle|2"] })
      .expectAttackValue(7)
      .blockWith()
      .settle();
  });

  it("Swiftwater Sloop gets go again only at High Tide", () => {
    const g = scenario({
      seats: [
        {
          ...GRAVY,
          hand: ["swiftwater sloop|1", "titanium bauble|3"],
          pitch: ["murderous rabble|3", "back alley breakline|3"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.play("swiftwater sloop|1", { pitch: ["titanium bauble|3"] })
      .expectLog("gains go again (High Tide)")
      .blockWith()
      .settle()
      .expectAP(0, 1);

    const dry = scenario({
      seats: [
        { ...GRAVY, hand: ["swiftwater sloop|1", "titanium bauble|3"] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    dry.play("swiftwater sloop|1", { pitch: ["titanium bauble|3"] })
      .expectNoLog("gains go again (High Tide)")
      .blockWith()
      .settle()
      .expectAP(0, 0);
  });
});

describe("SGB — attack triggers", () => {
  it("Golden Tipple: discard a yellow card to draw and create a Gold", () => {
    const g = scenario({
      seats: [
        {
          ...GRAVY,
          hand: ["golden tipple|1", "barnacle|2", "saltwater swell|3"],
          deck: ["battalion barque|1"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.play("golden tipple|1", { pitch: ["saltwater swell|3"] })
      .chooseCard("barnacle|2") // yellow discard
      .expectInZone(0, "barnacle|2", "graveyard")
      .expectLog("creates Gold")
      .blockWith()
      .settle()
      .expectZoneSize(0, "board", 1) // the Gold token
      .expectHandSize(0, 1); // battalion drawn off the discard
  });

  it("Saltwater Swell pitches a revealed blue card off the deck", () => {
    const g = scenario({
      seats: [
        { ...GRAVY, hand: ["saltwater swell|1", "battalion barque|1"], deck: ["jittery bones|3"] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.play("saltwater swell|1", { pitch: ["battalion barque|1"] })
      .expectLog("reveals Jittery Bones")
      .expectInZone(0, "jittery bones|3", "pitch")
      .expectResources(0, 3)
      .blockWith()
      .settle();
  });

  it("Murderous Rabble gets +X{p} from the revealed card's pitch", () => {
    const g = scenario({
      seats: [
        { ...GRAVY, hand: ["murderous rabble|3"], deck: ["battalion barque|1"] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.play("murderous rabble|3").expectAttackValue(1).blockWith().settle();
  });

  it("Jittery Bones: discard a watery-grave card for go again (not innate)", () => {
    const g = scenario({
      seats: [
        { ...GRAVY, hand: ["jittery bones|3", "barnacle|2"] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.play("jittery bones|3", { settle: false })
      .chooseCard("barnacle|2")
      .expectLog("gains go again (Barnacle has watery grave)")
      .blockWith()
      .settle()
      .expectAP(0, 1);

    const passed = scenario({
      seats: [
        { ...GRAVY, hand: ["jittery bones|3", "titanium bauble|3"] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    passed
      .play("jittery bones|3", { settle: false })
      .chooseOption("pass")
      .blockWith()
      .settle()
      .expectAP(0, 0); // no go again without the watery grave discard
  });
});

describe("SGB — non-attack actions", () => {
  it("Portside Exchange: discard a yellow, draw, create a Gold", () => {
    const g = scenario({
      seats: [
        { ...GRAVY, hand: ["portside exchange|3", "golden tipple|2"], deck: ["battalion barque|1"] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.play("portside exchange|3", { settle: false })
      .passPriority()
      .passPriority()
      .chooseCard("golden tipple|2")
      .expectLog("creates Gold")
      .expectZoneSize(0, "board", 1)
      .expectHandSize(0, 1) // battalion drawn off the exchange
      .expectAP(0, 1); // go again
  });

  it("Flying High: next attack gets go again, +1{p} if blue", () => {
    const g = scenario({
      seats: [
        { ...GRAVY, hand: ["flying high|3", "back alley breakline|3", "titanium bauble|3"] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.play("flying high|3")
      .expectAP(0, 1) // its own go again
      .play("back alley breakline|3", { pitch: ["titanium bauble|3"] })
      .expectAttackValue(4) // 3 + 1 (blue)
      .blockWith()
      .settle()
      .expectAP(0, 1); // granted go again
  });

  it("Throw Caution to the Wind prevents the revealed pitch value of damage", () => {
    const g = scenario({
      seats: [
        { ...GRAVY, hand: ["throw caution to the wind|3"], deck: ["jittery bones|3"] },
        { hero: "rhinar", hand: ["raging onslaught|2", "titanium bauble|3"] },
      ],
      active: 1,
    });
    g.play("raging onslaught|2", { pitch: ["titanium bauble|3"] })
      .blockWith() // no defenders
      .passPriority() // attacker passes the reaction window
      .react("throw caution to the wind|3") // instant in the defender's window
      .expectLog("reveals Jittery Bones (prevent 3)")
      .expectLife(0, 17); // 6 - 3 prevented
  });
});

describe("SGB — equipment", () => {
  it("Mage Master Boots: next non-attack action gets go again", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          equipment: { legs: "mage master boots|0" },
          hand: ["timesnap potion|3", "titanium bauble|3"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.activate("mage master boots|0", { pitch: ["titanium bauble|3"] })
      .expectNoEquipment(0, "legs")
      .expectAP(0, 1) // the ability's own go again
      .play("timesnap potion|3")
      .expectZoneSize(0, "board", 1)
      .expectAP(0, 1); // go again granted by the boots
  });

  it("Carrion Crown: discard an ally, destroy, draw; go again", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", equipment: { head: "carrion crown|0" }, hand: ["barnacle|2"], deck: [] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.activate("carrion crown|0", { settle: false })
      .passPriority()
      .passPriority()
      .chooseCard("barnacle|2")
      .expectInZone(0, "barnacle|2", "graveyard")
      .expectNoEquipment(0, "head")
      .expectAP(0, 1);
  });

  it("Washed Up Wave and Mournful Casket: discard an ally when defending", () => {
    const g = scenario({
      seats: [
        {
          ...GRAVY,
          equipment: { head: null, chest: "mournful casket|0", arms: "washed up wave|0", legs: null },
          hand: ["barnacle|2"],
          deck: [],
        },
        { hero: "rhinar", hand: ["raging onslaught|2", "titanium bauble|3"] },
      ],
      active: 1,
    });
    g.play("raging onslaught|2", { pitch: ["titanium bauble|3"] })
      .blockWith("mournful casket|0", "washed up wave|0")
      .passPriority()
      .passPriority()
      .chooseCard("barnacle|2") // wave: discard the ally (it has watery grave)
      .expectFinalDefense(4) // casket 1 + 1 (ally to graveyard), wave 0 + 2 (watery grave)
      .expectLife(0, 18);
    g.endTurn(); // the casket's +1{d} applies to Temper; Blade Break destroys the wave
    g.expectEquipped(0, "chest", "mournful casket|0")
      .expectEquipmentDefense(0, "chest", 0)
      .expectNoEquipment(0, "arms");
    expect(g.state.players[0]!.equipment.chest?.defCounters).toBe(1);
  });

  it("Compass's look floats the card with a pass option, privately", () => {
    const g = scenario({
      seats: [
        { ...GRAVY, weapons: ["compass of sunken depths|0"], deck: ["battalion barque|1"], hand: [] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.activate("compass of sunken depths|0", { settle: false });
    g.passPriority();
    g.passPriority(); // the ability resolves and stops at the look

    const topId = g.state.players[0]!.deck[0]!.instanceId;
    expect(g.state.pendingDecision).toMatchObject({
      player: 0,
      kind: "choose-target",
      chooseHook: "engine-look",
      options: ["pass"],
      defaultOption: "pass",
      lookedCardIds: [topId],
    });
    // the card image is projected only to the looking player …
    const ownView = projectStateFor(g.state, 0);
    expect(ownView.pendingDecision?.lookedCards?.map((c) => c.cardId))
      .toEqual([printingId("battalion barque|1")]);
    const oppView = projectStateFor(g.state, 1);
    expect(oppView.pendingDecision?.lookedCards).toBeUndefined();
    expect(oppView.pendingDecision?.options).toBeUndefined();
    // … plus a private log line (tagged with the exact printing)
    const name = cardData[printingId("battalion barque|1")]!.name;
    expect(ownView.log.some((line) => line.includes(`You look at ${name}`))).toBe(true);
    expect(ownView.log.join("\n")).toContain(`⟦${printingId("battalion barque|1")}⟧`);
    expect(oppView.log.some((line) => line.includes(name))).toBe(false);

    // passing dismisses the float and play continues
    g.passPriority();
    expect(g.state.pendingDecision?.chooseHook).not.toBe("engine-look");
    expect(g.state.phase).toBe("action");
  });

  it("Compass of Sunken Depths looks at the top card (off-hand = weapon slot)", () => {
    const g = scenario({
      seats: [
        { ...GRAVY, weapons: ["compass of sunken depths|0"], deck: ["battalion barque|1"], hand: [] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.activate("compass of sunken depths|0").expectLog("looks at the top card of their deck");
    // the identity is private: logged for the controller's eyes only
    const name = cardData[printingId("battalion barque|1")]!.name;
    const ownView = projectStateFor(g.state, 0);
    expect(ownView.log.some((line) => line.includes(`You look at ${name}`))).toBe(true);
    const oppView = projectStateFor(g.state, 1);
    expect(oppView.log.some((line) => line.includes(name))).toBe(false);
  });

  it("Compass's instant ability waits on the stack before it resolves", () => {
    const g = scenario({
      seats: [
        { ...GRAVY, weapons: ["compass of sunken depths|0"], deck: ["battalion barque|1"], hand: [] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.activate("compass of sunken depths|0", { settle: false });

    expect(g.state.stack).toHaveLength(1);
    expect(g.state.stack[0]!.ability).toBe(true);
    expect(JSON.stringify(g.state.log)).not.toContain("You look at");
    expect(projectStateFor(g.state, 1).stack[0]!.card?.cardId).toBe(printingId("compass of sunken depths|0"));

    g.passPriority();
    g.passPriority();
    g.expectLog("looks at the top card of their deck");
  });

  it("Compass's instant ability is usable in a priority window (off-hand = weapon slot)", () => {
    // regression: window ability enumeration omitted the weapon slots, so
    // off-hand equipment was never clickable in a priority/reaction window
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["snatch|1"] },
        { ...GRAVY, hero: "dorinthea", weapons: ["compass of sunken depths|0"], deck: ["battalion barque|1"], hand: [] },
      ],
    });
    g.play("snatch|1", { settle: false }); // the Compass keeps the attack window open
    g.passPriority(); // attacker yields the window to the defender
    g.activate("compass of sunken depths|0", { settle: false }); // ability rides the stack
    g.passPriority(); // defender passes
    g.passPriority(); // attacker passes; the ability resolves
    g.expectLog("looks at the top card of their deck");
    expect(g.state.players[1]!.weapons[0]!.tapped).toBe(true);
  });

  it("Compass's instant ability is usable in a reaction priority window", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["snatch|1"] },
        { ...GRAVY, hero: "dorinthea", weapons: ["compass of sunken depths|0"], deck: ["battalion barque|1"], hand: [] },
      ],
    });
    g.play("snatch|1", { settle: false });
    g.passPriority();
    g.passPriority();
    g.passPriority();
    g.passPriority();
    g.blockWith();
    g.passPriority(); // attacker yields reaction priority to the defender
    g.activate("compass of sunken depths|0", { settle: false });

    expect(g.state.stack[0]!.ability).toBe(true);
    expect(JSON.stringify(g.state.log)).not.toContain("You look at");

    g.passPriority();
    g.passPriority();
    g.expectLog("looks at the top card of their deck");
  });

  it("Compass is usable when the opponent passes to end their action phase", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: [] },
        { ...GRAVY, hero: "dorinthea", weapons: ["compass of sunken depths|0"], deck: ["battalion barque|1"], hand: [] },
      ],
    });

    g.passPriority(); // turn-player passes an empty stack; opponent gets priority
    expect(g.state.pendingDecision).toMatchObject({ kind: "priority-window", player: 1 });
    expect(g.state.stack).toHaveLength(0);

    g.activate("compass of sunken depths|0", { settle: false });
    expect(g.state.stack[0]?.ability).toBe(true);
    g.passPriority();
    g.passPriority();

    g.expectLog("looks at the top card of their deck");
    // the look floats as an acknowledgment decision; passing it continues play
    expect(g.state.pendingDecision?.chooseHook).toBe("engine-look");
    g.passPriority();
    expect(g.state.phase).toBe("action");
    expect(g.state.priorityPlayer).toBe(0); // response reset the pass sequence
  });
});

describe("SGB — allies", () => {
  it("an ally attack cannot be activated over another unresolved action attack", () => {
    const g = scenario({
      seats: [
        { ...GRAVY, board: ["barnacle|2", "swabbie|2"] },
        // Keep the first attack unresolved in a real priority window.
        { hero: "dorinthea", hand: ["sigil of solace|1"] },
      ],
    });
    const swabbieId = g.state.players[0]!.board.find(
      (card) => card.cardId === printingId("swabbie|2"),
    )!.instanceId;
    g.activate("barnacle|2", { settle: false });
    const illegalResponse = legalIntents(g.state, 0).filter(
      (intent) => intent.kind === "activate-ability" && intent.sourceInstanceId === swabbieId,
    );
    // CR 8.1.1a: an Action ability can only be activated while the stack is
    // empty. Ally attacks do not bypass that rule or form a player-built queue.
    expect(g.state.phase).toBe("layer");
    expect(illegalResponse).toHaveLength(0);
  });

  it("played allies enter the arena and attack via their tap ability", () => {
    const g = scenario({
      seats: [
        { ...GRAVY, hand: ["barnacle|2", "titanium bauble|3"] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.play("barnacle|2", { pitch: ["titanium bauble|3"] })
      .expectZoneSize(0, "board", 1) // entered the arena instead of the graveyard
      .expectAP(0, 0); // no go again
    g.endTurn().endTurn();
    g.activate("barnacle|2") // {t}: Attack
      .blockWith()
      .settle()
      .expectLife(1, 16)
      // the chain closed: the ally stays in the arena (unlike an attack action)
      .expectInZone(0, "barnacle|2", "board")
      .expectNotInZone(0, "barnacle|2", "graveyard");
  });

  it("Avast Ye!: next ally attack gets go again and creates a Gold on hit", () => {
    const g = scenario({
      seats: [
        { ...GRAVY, board: ["barnacle|2"], hand: ["avast ye!|3"] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.play("avast ye!|3")
      .expectAP(0, 1)
      .activate("barnacle|2")
      .blockWith()
      .settle()
      .expectLog("created a Gold token on hit")
      .expectZoneSize(0, "board", 2) // barnacle + Gold
      .expectAP(0, 1) // the granted go again
      .expectLife(1, 16);
  });

  it("Avast Ye! only projects its on-hit effect on a Pirate ally attack targeting a hero", () => {
    const missesCondition = scenario({
      seats: [
        { ...GRAVY, hand: ["avast ye!|3", "murderous rabble|3"] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    missesCondition.play("avast ye!|3").play("murderous rabble|3");
    const ordinaryAttack = projectStateFor(missesCondition.state, 0).chain.find(
      (link) => !link.resolved,
    );
    expect(ordinaryAttack?.onHitEffects).toBeUndefined();

    const qualifies = scenario({
      seats: [
        { ...GRAVY, board: ["barnacle|2"], hand: ["avast ye!|3"] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    qualifies.play("avast ye!|3").activate("barnacle|2");
    const allyAttack = projectStateFor(qualifies.state, 0).chain.find(
      (link) => !link.resolved,
    );
    expect(allyAttack?.onHitEffects).toEqual([
      expect.objectContaining({
        sourceCardId: printingId("avast ye!|3"),
        text: expect.stringContaining("create a Gold token"),
      }),
    ]);

    const targetsAlly = scenario({
      seats: [
        { ...GRAVY, board: ["barnacle|2"], hand: ["avast ye!|3"] },
        { ...GRAVY, hero: "dorinthea", board: ["barnacle|2"], hand: [] },
      ],
    });
    targetsAlly.play("avast ye!|3").activate("barnacle|2", {
      targetAlly: "barnacle|2",
    });
    const allyTarget = projectStateFor(targetsAlly.state, 0).chain.find(
      (link) => !link.resolved,
    );
    expect(allyTarget?.onHitEffects).toBeUndefined();
  });

  it("Yo Ho Ho!: next ally attack gets +1{p} and creates a Gold on hit", () => {
    const g = scenario({
      seats: [
        { ...GRAVY, board: ["barnacle|2"], hand: ["yo ho ho!|3"] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.play("yo ho ho!|3")
      .activate("barnacle|2")
      .expectAttackValue(5) // 4 + 1
      .blockWith()
      .settle()
      .expectZoneSize(0, "board", 2)
      .expectAP(0, 0) // no go again granted
      .expectLife(1, 15);
  });

  it("next-ally-attack effect chip disappears once an ally attack consumes it", () => {
    const g = scenario({
      seats: [
        { ...GRAVY, board: ["barnacle|2"], hand: ["yo ho ho!|3"] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.play("yo ho ho!|3");
    // the pending effect shows as an ongoing-effect chip for its controller
    expect(projectStateFor(g.state, 0).ongoing.filter((e) => e.seat === 0)).not.toEqual([]);
    g.activate("barnacle|2"); // declares the ally attack — the effect is spent
    expect(projectStateFor(g.state, 0).ongoing.filter((e) => e.seat === 0)).toEqual([]);
    g.blockWith().settle().expectZoneSize(0, "board", 2); // the on-hit Gold still fires
  });

  it("two copies of Yo Ho Ho give the next ally attack exactly two on-hit effects", () => {
    const g = scenario({
      seats: [
        { ...GRAVY, board: ["barnacle|2"], hand: ["yo ho ho!|3", "yo ho ho!|3"] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.play("yo ho ho!|3");
    g.play("yo ho ho!|3");
    g.activate("barnacle|2")
      .expectAttackValue(6) // 4 + 1 + 1
      .blockWith()
      .settle()
      .expectZoneSize(0, "board", 3); // barnacle + exactly 2 Golds (not one per marker)
  });

  it("Loot the Arsenal: on hit destroys a card in the opposing arsenal", () => {
    const g = scenario({
      seats: [
        { ...GRAVY, board: ["barnacle|2"], hand: ["loot the arsenal|3"] },
        { hero: "dorinthea", hand: [], arsenal: ["dodge|3"] },
      ],
    });
    g.play("loot the arsenal|3")
      .activate("barnacle|2")
      .blockWith()
      .settle()
      .expectZoneSize(1, "arsenal", 0)
      .expectInZone(1, "dodge|3", "graveyard")
      .expectZoneSize(0, "board", 2); // Gold created

    const publicDestruction = projectStateFor(g.state, 1).logEntries?.find(
      (entry) => "message" in entry && entry.message.id === "card.log.sgb.arsenal.destroyed",
    );
    expect(publicDestruction).toMatchObject({
      event: { kind: "card-moved", ownerSeat: 1, from: "arsenal", to: "graveyard" },
    });
    expect(JSON.stringify(publicDestruction)).not.toContain(printingId("dodge|3"));
  });

  it("Loot the Hold: on hit the opponent discards a card", () => {
    const g = scenario({
      seats: [
        { ...GRAVY, board: ["barnacle|2"], hand: ["loot the hold|3"] },
        { hero: "dorinthea", hand: ["dodge|3"] },
      ],
    });
    g.play("loot the hold|3").activate("barnacle|2").blockWith().settle();
    g.chooseCard("dodge|3") // the opponent chooses their discard
      .expectHandSize(1, 0)
      .expectInZone(1, "dodge|3", "graveyard")
      .expectZoneSize(0, "board", 2); // Gold created
  });

  it("Scuttle Toes untaps an ally so it can attack again", () => {
    const g = scenario({
      seats: [
        {
          ...GRAVY,
          equipment: { legs: "scuttle toes|0" },
          board: ["limpit, hop-a-long|2"],
          hand: ["saltwater swell|3", "jittery bones|3", "murderous rabble|3"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });
    const limpitId = g.state.players[0]!.board[0]!.instanceId;
    g.activate("limpit, hop-a-long|2", { pitch: ["saltwater swell|3"] })
      .blockWith()
      .settle()
      .expectAP(0, 1); // attack had go again
    // tapped: no second attack until untapped
    const tapped = legalIntents(g.state, 0).filter(
      (i) => i.kind === "activate-ability" && i.sourceInstanceId === limpitId,
    );
    expect(tapped).toEqual([]);
    // floating resources from the first pitch cover the {r}{r} — no pitch pin
    g.activate("scuttle toes|0")
      .chooseOption(String(limpitId))
      .expectNoEquipment(0, "legs")
      .expectLog("will be destroyed at the beginning of the end phase");
    g.activate("limpit, hop-a-long|2", { pitch: ["murderous rabble|3"] })
      .blockWith()
      .settle()
      .expectLife(1, 16); // two 2-power hits
    g.endTurn(); // beginning of the end phase: the untapped ally is destroyed
    g.expectInZone(0, "limpit, hop-a-long|2", "graveyard").expectZoneSize(0, "board", 0);
  });

  it("Cutty Shark's pump is a second ability — once per turn, independent of the tap attack", () => {
    const g = scenario({
      seats: [
        {
          ...GRAVY,
          board: ["cutty shark, quick clip|2", "barnacle|2"],
          hand: ["saltwater swell|3", "jittery bones|3"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });
    const cuttyId = g.state.players[0]!.board[0]!.instanceId;
    g.activate("cutty shark, quick clip|2", { ability: 1, pitch: ["saltwater swell|3"] })
      .expectLog("your next ally attack this turn gets +1")
      .expectAP(0, 1); // action ability with go again: the AP is refunded
    // the pump is spent for the turn…
    const pump = legalIntents(g.state, 0).filter(
      (i) => i.kind === "activate-ability" && i.sourceInstanceId === cuttyId && i.abilityIndex === 1,
    );
    expect(pump).toEqual([]);
    // …but the {t} attack (index 0) is unaffected — the flags are per-ability
    const tapAttack = legalIntents(g.state, 0).filter(
      (i) =>
        i.kind === "activate-ability" &&
        i.sourceInstanceId === cuttyId &&
        (i.abilityIndex ?? 0) === 0,
    );
    expect(tapAttack.length).toBeGreaterThan(0);
    // the pump applies to the next ally attack: barnacle's 4{p} becomes 5
    g.activate("barnacle|2").blockWith().settle().expectLife(1, 15);
  });
});

describe("SGB — Gravy Bones hero", () => {
  it("destroys a Gold to draw then discard", () => {
    const g = scenario({
      seats: [
        { ...GRAVY, board: ["gold|0"], hand: ["jittery bones|3"], deck: ["battalion barque|1"] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.activate("gravy bones|0", { settle: false })
      .passPriority()
      .passPriority()
      .chooseCard("gold|0") // the controller chooses which Gold to destroy
      .chooseCard("battalion barque|1") // drew it, now discards it
      .expectZoneSize(0, "board", 0) // Gold destroyed (tokens cease to exist)
      .expectNotInZone(0, "gold|0", "graveyard")
      .expectHandSize(0, 1) // jittery bones remains
      .expectAP(0, 1); // instant ability, no AP spent
  });

  it("Gravy Bones: a blue action resolving into the graveyard unlocks allies", () => {
    const g = scenario({
      seats: [
        { ...GRAVY, hand: ["yo ho ho!|3"], graveyard: ["limpit, hop-a-long|2"] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.play("yo ho ho!|3"); // go again: resolves off the stack into the graveyard
    g.expectInZone(0, "yo ho ho!|3", "graveyard").expectAP(0, 1);
    const limpitId = g.state.players[0]!.graveyard.find(
      (c) => c.cardId === printingId("limpit, hop-a-long|2"),
    )!.instanceId;
    const legal = legalIntents(g.state, 0).filter(
      (i) => i.kind === "play-from-zone" && i.zone === "graveyard" && i.instanceId === limpitId,
    );
    expect(legal.length).toBeGreaterThan(0);
    const ownerView = projectStateFor(g.state, 0);
    expect(ownerView.players[0]!.graveyard.find((card) => card.instanceId === limpitId))
      .toMatchObject({ playableFromSourceCardId: g.state.players[0]!.hero.cardId });
    expect(projectStateFor(g.state, 1).players[0]!.graveyard)
      .not.toContainEqual(expect.objectContaining({ playableFromSourceCardId: expect.any(String) }));
    const r = applyIntent(g.state, 0, legal[0]!);
    expect(r.ok).toBe(true);
    if (r.ok) g.state = r.state;
    g.passPriority().passPriority();
    g.expectInZone(0, "limpit, hop-a-long|2", "board"); // allies settle into the arena
  });

  it("Gravy Bones: a discarded blue also unlocks watery-grave allies", () => {
    const g = scenario({
      seats: [
        {
          ...GRAVY,
          graveyard: ["barnacle|2"],
          hand: ["portside exchange|3", "saltwater swell|3", "jittery bones|3"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });
    // not yet: no blue card has entered the graveyard this turn
    expect(
      legalIntents(g.state, 0).filter((i) => i.kind === "play-from-zone"),
    ).toEqual([]);
    g.play("portside exchange|3", { settle: false })
      .passPriority()
      .passPriority()
      .chooseCard("saltwater swell|3"); // blue discard
    const barnacleId = g.state.players[0]!.graveyard.find(
      (c) => c.cardId === printingId("barnacle|2"),
    )!.instanceId;
    const legal = legalIntents(g.state, 0).filter(
      (i) =>
        i.kind === "play-from-zone" && i.zone === "graveyard" && i.instanceId === barnacleId,
    );
    expect(legal.length).toBeGreaterThan(0);
    const jittery = g.state.players[0]!.hand.find(
      (c) => c.cardId === printingId("jittery bones|3"),
    )!;
    const intent =
      legal.find((i) => i.kind === "play-from-zone" && i.pitchInstanceIds.includes(jittery.instanceId)) ??
      legal[0]!;
    const r = applyIntent(g.state, 0, intent);
    expect(r.ok).toBe(true);
    if (r.ok) g.state = r.state;
    g.passPriority().passPriority();
    g.expectInZone(0, "barnacle|2", "board");
  });

  it("Compass: the first watery-grave card played from the graveyard each turn gets go again", () => {
    const g = scenario({
      seats: [
        {
          ...GRAVY,
          weapons: ["compass of sunken depths|0"],
          graveyard: ["barnacle|2"],
          hand: ["portside exchange|3", "saltwater swell|3", "jittery bones|3"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.play("portside exchange|3", { settle: false });
    g.passPriority(); // Gravy Bones passes the window over his own card (the Compass is live)
    g.passPriority(); // Dorinthea passes; Portside Exchange resolves
    g.chooseCard("saltwater swell|3"); // unlocks graveyard play
    const barnacleId = g.state.players[0]!.graveyard.find(
      (c) => c.cardId === printingId("barnacle|2"),
    )!.instanceId;
    const jittery = g.state.players[0]!.hand.find(
      (c) => c.cardId === printingId("jittery bones|3"),
    )!;
    const legal = legalIntents(g.state, 0).filter(
      (i) => i.kind === "play-from-zone" && i.zone === "graveyard" && i.instanceId === barnacleId,
    );
    const intent =
      legal.find((i) => i.kind === "play-from-zone" && i.pitchInstanceIds.includes(jittery.instanceId)) ??
      legal[0]!;
    const r = applyIntent(g.state, 0, intent);
    expect(r.ok).toBe(true);
    if (r.ok) g.state = r.state;
    g.passPriority(); // the Compass keeps a window open over the Barnacle layer
    g.passPriority(); // both passed: Barnacle resolves into the arena
    g.expectLog("Compass of Sunken Depths: Barnacle gets go again")
      .expectInZone(0, "barnacle|2", "board")
      .expectAP(0, 1); // the play's action point was refunded
  });
});

describe("SGB — Back Alley Breakline", () => {
  it("gains an action point when destroyed off the top of the deck", () => {
    const g = scenario({
      seats: [
        { ...GRAVY, hand: ["jittery bones|3"], deck: ["back alley breakline|3"] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.play("jittery bones|3", { settle: false })
      .chooseOption("deck-top")
      .expectInZone(0, "back alley breakline|3", "graveyard")
      .expectLog("Back Alley Breakline triggers: Gain 1 action point")
      .blockWith()
      .settle()
      .expectAP(0, 1); // 0 after the attack + 1 from Breakline (no go again)
  });
});


describe("SGB — allies being attacked (CR 8.2.8)", () => {
  it("an attack can target an ally: no defend step, damage kills it at 0 life", () => {
    const g = scenario({
      seats: [
        { ...GRAVY, board: ["barnacle|2"] }, // life 3
        { hero: "rhinar", hand: ["raging onslaught|3"] },
      ],
      active: 1,
    });
    g.attackWithWeapon("bone basher|0", { pitch: ["raging onslaught|3"], targetAlly: "barnacle|2" })
      .expectLog("targeting Barnacle")
      .expectLog("hits Barnacle for 4")
      .expectLife(0, 20) // the hero is untouched
      .expectNotInZone(0, "barnacle|2", "board")
      .expectInZone(0, "barnacle|2", "graveyard");
    // 8.2.8e: the attacking hero is not considered to have dealt damage
    expect(g.state.players[1]!.flags.dealtDamageThisTurn ?? false).toBe(false);
  });

  it("attacks default to the hero even with allies in play", () => {
    const g = scenario({
      seats: [
        { ...GRAVY, board: ["barnacle|2"] },
        { hero: "rhinar", hand: ["raging onslaught|3"] },
      ],
      active: 1,
    });
    g.attackWithWeapon("bone basher|0", { pitch: ["raging onslaught|3"] })
      .blockWith() // hero target: the defend decision still opens
      .settle()
      .expectLife(0, 16)
      .expectInZone(0, "barnacle|2", "board");
  });

  it("the ally's controller gets no defend step and cannot play defense reactions", () => {
    const g = scenario({
      seats: [
        { ...GRAVY, board: ["barnacle|2"], hand: ["sink below|1"] },
        { hero: "rhinar", hand: ["raging onslaught|3"] },
      ],
      active: 1,
    });
    g.attackWithWeapon("bone basher|0", {
      pitch: ["raging onslaught|3"],
      targetAlly: "barnacle|2",
      settle: false,
    });
    expect(g.state.pendingDecision?.kind).not.toBe("defend");
    g.passPriority(); // attacker passes the reaction window
    expect(() => g.react("sink below|1")).toThrow(/no legal intent/);
    g.settle().expectLog("hits Barnacle for 4");
  });

  it("damage stays on the ally until the end phase resets its life (either player's)", () => {
    const g = scenario({
      seats: [
        { ...GRAVY, board: ["barnacle|2"] }, // life 3
        { hero: "rhinar", hand: ["head jab|2"] },
      ],
      active: 1,
    });
    g.play("head jab|2", { targetAlly: "barnacle|2" })
      .expectLog("hits Barnacle for 2 (1 life left)")
      .expectLife(0, 20);
    expect(g.state.players[0]!.board[0]!.life).toBe(1);
    g.endTurn() // Rhinar's end phase — the reset is not the controller's only
      .expectLog("Barnacle is restored to 3 life");
    expect(g.state.players[0]!.board[0]!.life).toBe(3);
  });

  it("Watery Grave turns an arena permanent face-down in its graveyard", () => {
    const g = scenario({
      seats: [
        { ...GRAVY, board: ["barnacle|2"], hand: ["sigil of solace|1"] },
        { hero: "rhinar", hand: ["raging onslaught|3"] },
      ],
      active: 1,
    });
    g.attackWithWeapon("bone basher|0", {
      pitch: ["raging onslaught|3"],
      targetAlly: "barnacle|2",
      settle: false,
    });
    // Pass the attack-declared window and then the reaction step. The death
    // queues Watery Grave, but the card stays face up until that layer resolves.
    g.passPriority().passPriority().passPriority().passPriority().passPriority().passPriority();
    expect(g.state.stack[0]?.engineEffect).toEqual({ kind: "watery-grave" });
    expect(g.state.players[0]!.graveyard[0]?.faceDown).not.toBe(true);

    g.settle();
    const drowned = g.state.players[0]!.graveyard.find(
      (card) => card.cardId === printingId("barnacle|2"),
    );
    expect(drowned?.faceDown).toBe(true);
    const opponentView = projectStateFor(g.state, 1);
    expect(opponentView.players[0]!.graveyard[0]).toMatchObject({
      cardId: "",
      faceDown: true,
      hidden: true,
    });
  });

  it("Oysten's 'when this dies' fires on a damage death: a Gold token is created", () => {
    const g = scenario({
      seats: [
        { ...GRAVY, board: ["oysten, heart of gold|2"] }, // life 1
        { hero: "rhinar", hand: ["head jab|2"] },
      ],
      active: 1,
    });
    g.play("head jab|2", { targetAlly: "oysten, heart of gold|2" })
      .expectLog("created a Gold token when it died")
      .expectNotInZone(0, "oysten, heart of gold|2", "board")
      .expectInZone(0, "gold|0", "board");
  });
});
