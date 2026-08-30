import { describe, expect, it } from "vitest";
import { legalIntents } from "@fyendal/engine";
import { printingId, scenario } from "../harness.js";
import { cardData } from "../../index.js";

const NO_EQUIPMENT = { head: null, chest: null, arms: null, legs: null } as const;

describe("Monarch, Tales of Aria, and Everfest rules regression coverage", () => {
  it("registers every printing imported from the three complete sets", () => {
    expect(Object.keys(cardData).filter((id) => id.startsWith("MON"))).toHaveLength(307);
    expect(Object.keys(cardData).filter((id) => id.startsWith("ELE"))).toHaveLength(238);
    expect(Object.keys(cardData).filter((id) => id.startsWith("EVR"))).toHaveLength(198);
  });
  it("Korshem observes another hero's reveal event", () => {
    const g = scenario({ active: 1, seats: [
      { hero: "rhinar", board: ["korshem, crossroad of elements|0"], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", hand: ["flashfreeze|1", "blizzard|3", "blink|3"], resources: 1, equipment: NO_EQUIPMENT },
    ] });
    g.play("flashfreeze|1");
    expect(g.state.resolving).toEqual(expect.arrayContaining([
      expect.objectContaining({ instanceId: g.state.pendingDecision?.sourceInstanceId }),
    ]));
    g.chooseOption("both");
    expect(g.state.pendingDecision).toMatchObject({ player: 1, chooseHook: "korshem-benefit" });
    g.chooseOption("resource");
    expect(g.state.players[1]!.resources).toBe(1);
  });
  it("Endless Winter persists its activation trigger through the opponent's next turn", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", hand: ["endless winter|1", "blizzard|3"], resources: 4, equipment: NO_EQUIPMENT },
      { hero: "dorinthea", weapons: ["hatchet of body|0"], hand: ["raging onslaught|3"], equipment: NO_EQUIPMENT },
    ] });
    g.play("endless winter|1").chooseCard("blizzard|3").blockWith().settle().endTurn()
      .activate("hatchet of body|0", { pitch: ["raging onslaught|3"], settle: false });
    expect(g.state.players[1]!.board.some((card) => cardData[card.cardId]?.name === "Frostbite")).toBe(true);
  });
  it("New Horizon creates a distinct second arsenal slot", () => {
    const zones = scenario({ seats: [
      { hero: "rhinar", heroKey: "lexi, livewire|0", weapons: ["shiver|0"], equipment: { ...NO_EQUIPMENT, head: "new horizon|0" }, arsenal: ["head shot|1"], hand: ["head shot|2"], resources: 1 },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });
    zones.activate("shiver|0").chooseCard("head shot|2").chooseOption("power");
    expect(zones.state.players[0]!.arsenal).toHaveLength(2);
    expect(zones.state.players[0]!.arsenal[1]?.arsenalSlot).toBe(1);

    const destroyed = scenario({ active: 1, seats: [
      { hero: "rhinar", equipment: { ...NO_EQUIPMENT, head: "new horizon|0" }, arsenal: ["head shot|1"], arsenalFaceDown: ["head shot|2"] },
      { hero: "dorinthea", hand: ["swing big|1"], resources: 2, equipment: NO_EQUIPMENT },
    ] });
    destroyed.play("swing big|1").blockWith("new horizon|0").settle()
      .doRaw({ kind: "close-chain" });
    expect(destroyed.state.players[0]!.arsenal).toHaveLength(0);
    expect(destroyed.state.players[0]!.graveyard.filter((card) => cardData[card.cardId]?.name === "Head Shot")).toHaveLength(2);
  });
  it("Arc Light Sentinel becomes the mandatory attack target", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", hand: ["head jab|1"], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", board: ["arc light sentinel|2"], equipment: NO_EQUIPMENT },
    ] });
    const attack = g.state.players[0]!.hand[0]!;
    const sentinel = g.state.players[1]!.board[0]!;
    const intents = legalIntents(g.state, 0).filter(
      (intent): intent is Extract<ReturnType<typeof legalIntents>[number], { kind: "play-card" }> =>
        intent.kind === "play-card" && intent.instanceId === attack.instanceId,
    );
    expect(intents).not.toHaveLength(0);
    expect(intents.every((intent) => intent.targetAllyId === sentinel.instanceId)).toBe(true);
    g.play("head jab|1", { targetAlly: "arc light sentinel|2" });
    expect(g.state.players[1]!.board).not.toEqual(expect.arrayContaining([expect.objectContaining({ instanceId: sentinel.instanceId })]));
  });
  it("Beacon of Victory pays a chosen nonzero X from soul", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", hand: ["head jab|1", "beacon of victory|2"], soul: ["soul food|2", "tome of divinity|2"], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });
    g.play("head jab|1").blockWith().react("beacon of victory|2")
      .chooseOption("x:2").chooseCard("soul food|2").chooseCard("tome of divinity|2").settle();
    expect(g.state.players[0]!.soul).toHaveLength(0);
    expect(g.state.players[0]!.banish).toHaveLength(2);
    expect(g.state.chain.at(-1)?.finalAttack).toBe(5);
  });

  it("Celestial Cataclysm pays its fixed three-card soul cost", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", hand: ["celestial cataclysm|2"], soul: ["soul food|2", "tome of divinity|2", "beacon of victory|2"], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });
    g.play("celestial cataclysm|2").chooseCard("soul food|2").chooseCard("tome of divinity|2")
      .chooseCard("beacon of victory|2").blockWith().settle();
    expect(g.state.players[0]!.soul).toHaveLength(0);
    expect(g.state.players[0]!.banish).toHaveLength(3);
  });

  it("Sonata Arcanix resolves its X-sized reveal and constrained picks", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", hand: ["sonata arcanix|1"], deck: ["nimblism|1", "head jab|1", "this round's on me|3"], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", life: 20, equipment: NO_EQUIPMENT },
    ] });
    g.play("sonata arcanix|1").chooseOption("X = 0").settle()
      .chooseCard("head jab|1");
    g.expectInZone(0, "head jab|1", "hand").expectInZone(0, "sonata arcanix|1", "banish");
    expect(g.state.players[1]!.life).toBe(19);
  });

  it("Rouse the Ancients reveals a qualifying group for its bonus", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", hand: ["rouse the ancients|3", "swing big|1", "raging onslaught|1"], resources: 3, equipment: NO_EQUIPMENT },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });
    g.play("rouse the ancients|3").chooseOption("reveal:");
    g.expectAttackValue(7);
  });

  it("Exude Confidence suppresses responses until sufficiently defended", () => {
    const locked = scenario({ seats: [
      { hero: "rhinar", hand: ["exude confidence|1"], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", hand: ["oasis respite|1"], resources: 1, equipment: NO_EQUIPMENT },
    ] });
    locked.play("exude confidence|1").blockWith().passPriority();
    expect(legalIntents(locked.state, 1).some((intent) => intent.kind === "play-card")).toBe(false);

    const unlocked = scenario({ seats: [
      { hero: "rhinar", hand: ["exude confidence|1"], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", hand: ["raging onslaught|1", "oasis respite|1"], resources: 1, equipment: NO_EQUIPMENT },
    ] });
    unlocked.play("exude confidence|1").blockWith("raging onslaught|1").passPriority();
    expect(legalIntents(unlocked.state, 1).some((intent) => intent.kind === "play-card")).toBe(true);
  });
  it("Soul Shield settles into its hero's soul", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", hand: ["head jab|1"], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", hand: ["soul shield|2"], resources: 2, equipment: NO_EQUIPMENT },
    ] });
    g.play("head jab|1").blockWith().passPriority().react("soul shield|2").settle()
      .doRaw({ kind: "close-chain" });
    g.expectInZone(1, "soul shield|2", "soul");
  });
  it("Guardian of the Shadowrealm activates from banish", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", banish: ["guardian of the shadowrealm|1"], resources: 2, equipment: NO_EQUIPMENT },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });
    g.activate("guardian of the shadowrealm|1");
    g.expectInZone(0, "guardian of the shadowrealm|1", "hand");
  });
  it("Ready to Roll replaces another source's die roll", () => {
    const g = scenario({ seed: 9, seats: [
      { hero: "rhinar", hand: ["ready to roll|3", "rolling thunder|1"], resources: 1, equipment: NO_EQUIPMENT },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });
    g.play("ready to roll|3").play("rolling thunder|1");
    const finalRolls = Object.keys(g.state.players[0]!.flags).filter((key) => /^rolledDie:\d+$/.test(key));
    expect(finalRolls).toHaveLength(1);
    const result = Number(finalRolls[0]!.split(":")[1]);
    expect(g.state.modifiers).toEqual(expect.arrayContaining([expect.objectContaining({ attack: result })]));
  });
  it("Bravo reveals three elemental cards as one cost", () => {
    const g = scenario({ active: 1, seats: [
      { hero: "rhinar", heroKey: "bravo, star of the show|0", hand: ["pulse of candlehold|2", "blizzard|3", "blink|3"], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });
    g.endTurn().chooseOption("yes");
    const reveal = g.state.pendingDecision?.options?.[0];
    expect(reveal).toBeDefined();
    g.chooseOption(reveal!);
    expect(g.state.modifiers).toEqual(expect.arrayContaining([
      expect.objectContaining({ attack: 2, dominate: true, goAgain: true, minCost: 3 }),
    ]));
  });
  it("Earthlore Bounty identifies action-effect draws", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", hand: ["tome of fyendal|2"], deck: ["head jab|1", "head jab|2"], resources: 1, equipment: { ...NO_EQUIPMENT, chest: "earthlore bounty|0" } },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });
    g.play("tome of fyendal|2");
    expect(g.state.players[0]!.board.filter((card) => cardData[card.cardId]?.name === "Seismic Surge")).toHaveLength(2);
  });
  it("Shatter replaces weapon damage with equipment destruction", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", weapons: ["dawnblade|0"], hand: ["shatter|2"], resources: 1, equipment: NO_EQUIPMENT },
      { hero: "dorinthea", life: 20, equipment: { ...NO_EQUIPMENT, arms: "ironrot gauntlet|0" } },
    ] });
    g.activate("dawnblade|0").blockWith("ironrot gauntlet|0")
      .react("shatter|2", { targetCard: "dawnblade|0" }).chooseCard("ironrot gauntlet|0");
    expect(g.state.players[1]!.life).toBe(20);
    expect(g.state.players[1]!.equipment.arms).toBeUndefined();
    g.expectInZone(1, "ironrot gauntlet|0", "graveyard");
    expect(g.state.chain.at(-1)?.damage).toBe(0);
  });
  it("Blood on Her Hands pays a chosen number of Copper tokens", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", weapons: ["hatchet of body|0", "hatchet of mind|0"], board: ["copper|0", "copper|0"], hand: ["blood on her hands|2"], resources: 1, equipment: NO_EQUIPMENT },
      { hero: "dorinthea", hand: ["sigil of solace|1"], equipment: NO_EQUIPMENT },
    ] });
    const bodyId = g.state.players[0]!.weapons.find(
      (weapon) => cardData[weapon.cardId]?.name === "Hatchet of Body",
    )!.instanceId;

    g.play("blood on her hands|2");
    expect(g.state.pendingDecision?.prompt).toBe("How many Copper do you want to destroy?");
    expect(g.state.pendingDecision?.options).toEqual(["0", "1", "2"]);
    expect(g.state.pendingDecision?.cardOptions).toBeUndefined();
    expect(g.state.stack).toHaveLength(0);
    expect(g.state.players[0]!.hand.some((card) => cardData[card.cardId]?.name === "Blood on Her Hands")).toBe(false);

    g.chooseOption("2");
    expect(g.state.players[0]!.board.filter((card) => cardData[card.cardId]?.name === "Copper")).toHaveLength(0);
    expect(g.state.pendingDecision?.prompt).toBe("Assign 2 Blood on Her Hands modes");
    expect(g.state.stack).toHaveLength(0);
    expect(g.state.resolving.some((card) => cardData[card.cardId]?.name === "Blood on Her Hands")).toBe(true);
    expect(legalIntents(g.state, 0).some((intent) => intent.kind === "pass")).toBe(false);

    g.chooseOption(`increment:power:${bodyId}`);
    const incompleteConfirm = g.state.pendingDecision?.options?.find((option) => option.includes("confirm:1:2"));
    expect(incompleteConfirm).toBeDefined();
    g.doRaw({ kind: "choose", optionId: incompleteConfirm! });
    expect(g.state.pendingDecision?.prompt).toBe("Assign 2 Blood on Her Hands modes");
    expect(g.state.stack).toHaveLength(0);
    expect(legalIntents(g.state, 0).some((intent) => intent.kind === "pass")).toBe(false);

    g.chooseOption(`decrement:power:${bodyId}`)
      .chooseOption(`increment:power:${bodyId}`)
      .chooseOption(`increment:go-again:${bodyId}`);
    expect(g.state.stack).toHaveLength(0);
    expect(g.state.pendingDecision?.kind).toBe("choose-target");
    expect(legalIntents(g.state, 0).some((intent) => intent.kind === "pass")).toBe(false);

    const confirm = g.state.pendingDecision?.options?.find((option) => option.includes("confirm:2:2"));
    expect(confirm).toBeDefined();
    g.doRaw({ kind: "choose", optionId: confirm! });
    const bloodLayer = g.state.stack.find((layer) => cardData[layer.card?.cardId ?? ""]?.name === "Blood on Her Hands");
    expect(bloodLayer).toBeDefined();
    expect(bloodLayer?.card?.counters).toMatchObject({
      bloodPaid: 2,
      [`bloodAllocation:power:${bodyId}`]: 1,
      [`bloodAllocation:go-again:${bodyId}`]: 1,
    });
    expect(g.state.pendingDecision?.kind).toBe("priority-window");
    expect(legalIntents(g.state, 0)).toContainEqual({ kind: "pass" });
    expect(g.state.players[0]!.graveyard.some((card) => cardData[card.cardId]?.name === "Blood on Her Hands")).toBe(false);
    expect(g.state.modifiers.filter((modifier) => modifier.attack === 1)).toHaveLength(0);

    g.settle();
    expect(g.state.modifiers.filter((modifier) => modifier.attack === 1)).toHaveLength(1);
    g.activate("hatchet of body|0").blockWith().settle();
    expect(g.state.chain.at(-1)?.finalAttack).toBe(3);
    expect(g.state.players[0]!.actionPoints).toBe(1);
  });

  it("Hatchets gain power only after the paired Hatchet was the last attack", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        weapons: ["hatchet of body|0", "hatchet of mind|0"],
        hand: ["hit and run|1", "raging onslaught|3"],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });

    g.play("hit and run|1")
      .activate("hatchet of mind|0", { pitch: ["raging onslaught|3"] })
      .blockWith()
      .settle()
      .expectFinalAttack(2)
      .activate("hatchet of body|0")
      .expectAttackValue(3);
  });

  it("Knick Knack repeats its item search for destroyed money", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", board: ["copper|0", "copper|0", "copper|0", "copper|0"], hand: ["knick knack bric-a-brac|1"], deck: ["amulet of assertiveness|2", "healing potion|3", "head jab|1"], resources: 3, equipment: NO_EQUIPMENT },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });
    g.play("knick knack bric-a-brac|1")
      .chooseCard("copper|0").chooseCard("copper|0").chooseCard("copper|0").chooseCard("copper|0")
      .chooseOption("done").chooseCard("amulet of assertiveness|2").chooseCard("healing potion|3");
    expect(g.state.players[0]!.board.map((card) => cardData[card.cardId]?.name)).toEqual(
      expect.arrayContaining(["Amulet of Assertiveness", "Healing Potion"]),
    );
  });
  it("Signal Jammer caps each hero at one non-attack action", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", board: ["signal jammer|3"], hand: ["this round's on me|3", "nimblism|1"], resources: 2, equipment: NO_EQUIPMENT },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });
    g.play("this round's on me|3");
    const nimblism = g.state.players[0]!.hand.find((card) => card.cardId === printingId("nimblism|1"));
    expect(legalIntents(g.state, 0).some((intent) => intent.kind === "play-card" && intent.instanceId === nimblism?.instanceId)).toBe(false);
  });
  it("Fractal Replication combines all base abilities and stats", () => {
    const attacking = scenario({ seats: [
      { hero: "rhinar", weapons: ["luminaris|0"], hand: ["enigma chimera|1", "fractal replication|1", "beacon of victory|2"], resources: 1, equipment: NO_EQUIPMENT },
      { hero: "dorinthea", hand: ["raging onslaught|1"], equipment: NO_EQUIPMENT },
    ] });
    attacking.play("enigma chimera|1", { pitch: ["beacon of victory|2"] }).blockWith().settle()
      .play("fractal replication|1");
    attacking.expectAttackValue(8);
    expect(attacking.state.chain.at(-1)?.attackingCard.grantedBaseAbilitiesCardId).toBe(printingId("enigma chimera|1"));
    attacking.blockWith("raging onslaught|1").settle();
    attacking.expectInZone(0, "fractal replication|1", "graveyard");

    const defending = scenario({ active: 1, seats: [
      { hero: "rhinar", hand: ["enigma chimera|1", "fractal replication|1"], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", hand: ["swing big|1"], resources: 2, equipment: NO_EQUIPMENT },
    ] });
    defending.play("swing big|1").blockWith("enigma chimera|1", "fractal replication|1").settle();
    expect(defending.state.chain.at(-1)?.finalDefense).toBe(6);
  });
  it("This Round's on Me persists its attack penalty through the next turn", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", hand: ["this round's on me|3"], resources: 1, equipment: NO_EQUIPMENT },
      { hero: "dorinthea", hand: ["head jab|1"], equipment: NO_EQUIPMENT },
    ] });
    g.play("this round's on me|3").endTurn().play("head jab|1").blockWith().settle();
    expect(g.state.chain.at(-1)?.finalAttack).toBe(2);
  });

  it("Channel Lake Frigid taxes only opposing cards and abilities", () => {
    const locked = scenario({ active: 1, seats: [
      { hero: "rhinar", board: ["channel lake frigid|3"], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", hand: ["nimblism|1"], equipment: NO_EQUIPMENT },
    ] });
    expect(legalIntents(locked.state, 1).some((intent) => intent.kind === "play-card")).toBe(false);
    const paid = scenario({ active: 1, seats: [
      { hero: "rhinar", board: ["channel lake frigid|3"], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", hand: ["nimblism|1"], resources: 1, equipment: NO_EQUIPMENT },
    ] });
    expect(legalIntents(paid.state, 1).some((intent) => intent.kind === "play-card")).toBe(true);
  });
  it("Flashfreeze grants its conditional effects to every attack", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", hand: ["flashfreeze|1", "blizzard|3", "blink|3", "head jab|1"], resources: 1, equipment: NO_EQUIPMENT },
      { hero: "dorinthea", life: 20, equipment: NO_EQUIPMENT },
    ] });
    g.play("flashfreeze|1").chooseOption("both");
    expect(g.state.modifiers).toEqual(expect.arrayContaining([
      expect.objectContaining({ seat: 0, scope: "until-end-of-turn", onHitDealDamage: 3 }),
    ]));
    g.play("head jab|1").blockWith().settle();
    expect(g.state.chain.at(-1)?.finalAttack).toBe(3);
    expect(g.state.players[1]!.life).toBe(14);
  });
  it("Blossoming Spellblade grants both play and zone-replacement permissions", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", hand: ["blossoming spellblade|1", "pulse of candlehold|2", "blink|3"], graveyard: ["nimblism|1"], resources: 3, equipment: NO_EQUIPMENT },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });
    g.play("blossoming spellblade|1").chooseOption("both").chooseCard("nimblism|1");
    expect(g.state.players[0]!.banish).toEqual(expect.arrayContaining([
      expect.objectContaining({ playableAsInstant: true, temporaryGraveyardReplacement: "banish" }),
    ]));
    g.blockWith().react("nimblism|1").settle().doRaw({ kind: "close-chain" });
    const locations = (["hand", "deck", "arsenal", "pitch", "graveyard", "banish", "soul", "board"] as const)
      .filter((zone) => g.state.players[0]![zone].some((card) => cardData[card.cardId]?.name === "Nimblism"));
    expect(locations).toEqual(["banish"]);
  });
  it("Ice Storm creates Frostbites for each damage event", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", weapons: ["death dealer|0"], hand: ["ice storm|1", "blizzard|3", "blink|3"], arsenal: ["head shot|1"], resources: 1, equipment: NO_EQUIPMENT },
      { hero: "dorinthea", life: 20, equipment: NO_EQUIPMENT },
    ] });
    g.play("ice storm|1").chooseOption("both").play("head shot|1", { fromArsenal: true }).blockWith().settle();
    expect(g.state.players[1]!.life).toBe(12);
    expect(g.state.players[1]!.board.filter((card) => cardData[card.cardId]?.name === "Frostbite")).toHaveLength(8);
  });
});
