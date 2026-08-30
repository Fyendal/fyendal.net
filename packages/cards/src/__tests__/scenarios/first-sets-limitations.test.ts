import { describe, expect, it } from "vitest";
import { legalIntents } from "@fyendal/engine";
import { cardData } from "../../index.js";
import { scenario } from "../harness.js";

const NO_EQUIPMENT = { head: null, chest: null, arms: null, legs: null } as const;

function withCard(key: string) {
  return scenario({
    seats: [
      { hero: "rhinar", hand: [key], resources: 20, equipment: NO_EQUIPMENT },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ],
  });
}

describe("first-set rules regression coverage", () => {
  it("Eye of Ophidia puts its Opt 2 trigger above the card being paid for", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", hand: ["eye of ophidia|3", "blessing of deliverance|3"], deck: ["head jab|1", "head jab|2"], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });
    g.play("blessing of deliverance|3", { pitch: ["eye of ophidia|3"], settle: false });
    expect(g.state.stack[0]?.label).toBe("Opt 2");
    expect(g.state.pendingDecision?.chooseHook).toBeUndefined();
    g.passPriority().passPriority();
    expect(g.state.pendingDecision?.prompt.toLowerCase()).toContain("opt");
    // the looked cards are carried by the decision itself (top/bottom per card)
    const [a, b] = g.state.players[0]!.deck.slice(0, 2).map((card) => card.instanceId);
    expect(g.state.pendingDecision?.options).toEqual([
      `top:${a}`, `bottom:${a}`, `top:${b}`, `bottom:${b}`, "pass",
    ]);
  });

  it("Cranial Crush prohibits draws in the next action phase", () => {
    const g = withCard("cranial crush|3");
    g.play("cranial crush|3").blockWith().settle();
    expect(g.state.players[1]!.flags.cannotDrawNextActionPhase).toBe(true);
  });

  it("Forged for War gives defending equipment plus one defense", () => {
    const g = withCard("forged for war|2");
    g.play("forged for war|2");
    expect(g.state.modifiers.some((modifier) => modifier.sourceInstanceId === g.state.players[0]!.board[0]?.instanceId && modifier.defense === 1)).toBe(true);
  });

  it("Pounding Gale doubles its combo damage", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", hand: ["head jab|3", "open the center|3", "pounding gale|1"], resources: 20, equipment: NO_EQUIPMENT },
      { hero: "dorinthea", life: 30, equipment: NO_EQUIPMENT },
    ] });
    g.play("head jab|3").blockWith().settle();
    g.play("open the center|3").blockWith().settle();
    const before = g.state.players[1]!.life;
    g.play("pounding gale|1").blockWith().settle();
    expect(before - g.state.players[1]!.life).toBe(10);
  });

  it("Art of War allows attack actions to defend from arsenal", () => {
    const art = withCard("art of war|2");
    art.play("art of war|2").chooseOption("defend from arsenal").chooseOption("power");
    expect(art.state.players[0]!.flags.attackActionsDefendFromArsenal).toBe(true);

    const g = scenario({ active: 1, seats: [
      { hero: "rhinar", arsenalFaceDown: ["raging onslaught|3"], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", hand: ["head jab|3"], equipment: NO_EQUIPMENT },
    ] });
    g.state.players[0]!.flags.attackActionsDefendFromArsenal = true;
    g.play("head jab|3");
    const arsenal = g.state.players[0]!.arsenal[0]!;
    g.doRaw({ kind: "stage-defenders", instanceIds: [arsenal.instanceId] });
    expect(legalIntents(g.state, 0).some((intent) =>
      intent.kind === "defend" && intent.instanceIds.includes(arsenal.instanceId)
    )).toBe(true);
    g.blockWith("raging onslaught|3");
    expect(g.state.chain.at(-1)!.defendingCards).toContainEqual(expect.objectContaining({ instanceId: arsenal.instanceId }));
  });

  it("Three of a Kind restricts plays to arsenal", () => {
    const g = withCard("three of a kind|1");
    g.play("three of a kind|1");
    expect(g.state.players[0]!.flags.playsRestrictedToArsenal).toBe(true);
  });

  it("Arcanite Skullcap conditionally has Arcane Barrier 3", () => {
    const g = scenario({ active: 1, seats: [
      { hero: "rhinar", heroKey: "briar|0", life: 10, resources: 3, equipment: { ...NO_EQUIPMENT, head: "arcanite skullcap|0" } },
      { hero: "rhinar", heroKey: "briar|0", life: 20, hand: ["path of same ends|1"], equipment: NO_EQUIPMENT },
    ] });
    g.play("path of same ends|1");
    expect(g.state.pendingDecision?.prompt).toContain("Arcane Barrier");
    expect(g.state.pendingDecision?.options).toContain("pay 3");
  });

  it("Chains of Eminence prohibits every use of the named card", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", hand: ["chains of eminence|1", "head jab|3", "raging onslaught|3"], resources: 20, equipment: NO_EQUIPMENT },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });
    g.play("chains of eminence|1").chooseName("Head Jab");
    const named = g.state.players[0]!.hand.find((card) => cardData[card.cardId]!.name === "Head Jab")!;
    const intents = legalIntents(g.state, 0);
    expect(intents.some((intent) => "instanceId" in intent && intent.instanceId === named.instanceId)).toBe(false);
    expect(intents.some((intent) => "pitchInstanceIds" in intent && intent.pitchInstanceIds?.includes(named.instanceId))).toBe(false);
  });

  it("Stamp Authority suppresses attack-action hit effects", () => {
    const g = withCard("stamp authority|3");
    g.play("stamp authority|3");
    expect(g.state.players[0]!.flags.suppressAttackActionHitEffects).toBe(true);
  });

  it("Shiyana copies a hero and grants its class to owned cards", () => {
    const g = scenario({ active: 1, seats: [
      { hero: "rhinar", heroKey: "shiyana, diamond gemini|0", hand: ["head jab|3"], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });
    g.endTurn().doRaw({ kind: "choose", optionId: String(g.state.players[1]!.hero.instanceId) }).settle();
    expect(g.state.players[0]!.heroCardId).toBe(g.state.players[1]!.heroCardId);
    expect(g.state.players[0]!.hand[0]!.grantedTypes).toContain("warrior");
  });

  it("Meganetic Shockwave mandates equipment defenders", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", heroKey: "dash, inventor extraordinaire|0", hand: ["meganetic shockwave|3"], resources: 20, equipment: NO_EQUIPMENT },
      { hero: "dorinthea", equipment: { ...NO_EQUIPMENT, head: "ironrot helm|0", chest: "ironrot plate|0" } },
    ] });
    g.state.players[0]!.flags.boostCountThisTurn = 1;
    g.play("meganetic shockwave|3");
    const equipmentIds = new Set(Object.values(g.state.players[1]!.equipment).filter(Boolean).map((card) => card!.instanceId));
    g.doRaw({ kind: "stage-defenders", instanceIds: [[...equipmentIds][0]!] });
    const defends = legalIntents(g.state, 1).filter((intent) => intent.kind === "defend");
    expect(defends.length).toBeGreaterThan(0);
    expect(defends.every((intent) => intent.instanceIds.filter((id) => equipmentIds.has(id)).length >= 1)).toBe(true);
  });

  it("Remorseless punishes action plays through the next turn", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", heroKey: "azalea|0", weapons: ["death dealer|0"], arsenal: ["remorseless|1"], resources: 20, equipment: NO_EQUIPMENT },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });
    g.play("remorseless|1", { fromArsenal: true }).blockWith().settle();
    expect(g.state.players[1]!.flags.loseLifeOnActionThroughNextTurn).toBe(true);
  });

  it("Absorption Dome spends steam to replace damage", () => {
    const g = scenario({ active: 1, seats: [
      { hero: "rhinar", life: 20, board: ["absorption dome|2"], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", hand: ["head jab|1"], equipment: NO_EQUIPMENT },
    ] });
    g.state.players[0]!.board[0]!.counters = { steam: 2, damageReplacement: 2 };
    g.play("head jab|1").blockWith().settle();
    expect(g.state.players[0]!.life).toBe(19);
    expect(g.state.players[0]!.board).toHaveLength(0);
  });

  it("Runeblood Barrier replaces damage with Runechant destruction", () => {
    const g = scenario({ active: 1, seats: [
      { hero: "rhinar", life: 20, board: ["runeblood barrier|2", "runechant|0", "runechant|0", "runechant|0", "runechant|0"], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", hand: ["head jab|1"], equipment: NO_EQUIPMENT },
    ] });
    g.play("head jab|1").blockWith().settle();
    expect(g.state.players[0]!.life).toBe(20);
    expect(g.state.players[0]!.board.filter((card) => cardData[card.cardId]!.name === "Runechant")).toHaveLength(1);
  });

  it("Aetherize negates a low-cost instant on the stack", () => {
    const g = scenario({ active: 1, seats: [
      { hero: "rhinar", heroKey: "kano|0", hand: ["aetherize|3"], resources: 1, equipment: NO_EQUIPMENT },
      { hero: "dorinthea", hand: ["snag|3"], equipment: NO_EQUIPMENT },
    ] });
    g.play("snag|3", { settle: false }).passPriority().react("aetherize|3", { targetCard: "snag|3" });
    expect(g.state.players[1]!.graveyard.some((card) => cardData[card.cardId]!.name === "Snag")).toBe(true);
    expect(g.state.players[0]!.flags.suppressAttackPowerEffectGains).not.toBe(true);
  });

  it("Gambler's Gloves replaces a die roll with a reroll", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", board: ["crazy brew|3"], equipment: { ...NO_EQUIPMENT, arms: "gambler's gloves|0" } },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });
    g.activate("crazy brew|3");
    expect(g.state.pendingDecision?.prompt).toContain("reroll");
    g.chooseOption("reroll");
    expect(g.state.players[0]!.equipment.arms).toBeUndefined();
    expect(g.state.players[0]!.flags.rolledDieThisTurn).toBe(true);
  });

  it("Snag suppresses self and attack-reaction power gains", () => {
    const g = withCard("snag|3");
    g.play("snag|3");
    expect(g.state.players[0]!.flags.suppressAttackPowerEffectGains).toBe(true);
  });
});
