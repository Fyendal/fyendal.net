import { describe, expect, it } from "vitest";
import { applyIntent, legalIntents, projectStateFor } from "@fyendal/engine";
import { printingId, scenario } from "../harness.js";

const NO_EQUIPMENT = { head: null, chest: null, arms: null, legs: null } as const;

describe("Soulbond Resolve", () => {
  it.each([false, true])("prevents after Warpath charges, with chest defending: %s", (defendChest) => {
    const s = scenario({ seats: [
      { hero: "rhinar", resources: 3, hand: ["raging onslaught|1"] },
      { hero: "dorinthea", hand: ["wounding blow|2", "wounding blow|3"], equipment: {
        ...NO_EQUIPMENT, chest: "soulbond resolve|0", legs: "warpath of winged grace|0",
      } },
    ] });
    s.play("raging onslaught|1").blockWith("warpath of winged grace|0",
      ...(defendChest ? ["soulbond resolve|0"] : [])).settle();
    // Both equipment triggers are ordered with the legs resolving first.
    expect(s.state.pendingDecision?.chooseHook).toBe("grace-charge");
    s.chooseCard("wounding blow|2");
    if (defendChest) {
      expect(s.state.pendingDecision?.chooseHook).toBe("soulbond");
      s.chooseOption("no");
    }
    s.expectLife(1, defendChest ? 18 : 16);
    expect(s.state.players[1]!.flags.chargedThisTurn).toBe(true);
  });

  it("shows prevention after charging and uses it only on the first damage event", () => {
    const s = scenario({ seats: [
      { hero: "rhinar", resources: 2, hand: ["surging strike|1", "wounding blow|1"] },
      { hero: "dorinthea", hand: ["wounding blow|2"], equipment: {
        ...NO_EQUIPMENT, chest: "soulbond resolve|0", legs: "warpath of winged grace|0",
      } },
    ] });
    s.play("surging strike|1").blockWith("warpath of winged grace|0", "soulbond resolve|0").settle();
    const charge = s.state.players[1]!.hand[0]!;
    const choice = { kind: "choose", optionId: String(charge.instanceId) } as const;
    expect(legalIntents(s.state, 1)).toContainEqual(choice);
    s.doRaw(choice);
    expect(projectStateFor(s.state, 1).chain[0]?.damageToPrevent).toBe(1);
    s.settle().expectLife(1, 20);
    s.play("wounding blow|1").blockWith().settle().expectLife(1, 16);
  });

  it("does not prevent after taking damage before charging with the chest", () => {
    const s = scenario({ seats: [
      { hero: "rhinar", resources: 3, hand: ["head jab|3", "raging onslaught|1"] },
      { hero: "dorinthea", hand: ["wounding blow|2"], equipment: {
        ...NO_EQUIPMENT, chest: "soulbond resolve|0",
      } },
    ] });
    s.play("head jab|3").blockWith().settle().expectLife(1, 19);
    s.play("raging onslaught|1").blockWith("soulbond resolve|0").settle()
      .chooseCard("wounding blow|2").expectLife(1, 14);
  });

  it("resets prevention and charge eligibility each turn", () => {
    const s = scenario({ seats: [
      { hero: "rhinar", resources: 3, hand: ["raging onslaught|1"],
        deck: ["raging onslaught|1", "wrecker romp|3"] },
      { hero: "dorinthea", hand: ["wounding blow|2"], deck: ["wounding blow|3"], equipment: {
        ...NO_EQUIPMENT, chest: "soulbond resolve|0",
      } },
    ] });
    s.play("raging onslaught|1").blockWith("soulbond resolve|0").settle()
      .chooseCard("wounding blow|2").expectLife(1, 16);
    s.endTurn();
    expect(s.state.players[1]!.flags.chargedThisTurn).toBeUndefined();
    expect(s.state.players[1]!.flags.damageEventsThisTurn).toBeUndefined();
    s.endTurn();
    s.play("raging onslaught|1", { pitch: ["wrecker romp|3"] })
      .blockWith("soulbond resolve|0").settle().chooseCard("wounding blow|3")
      .expectLife(1, 11);
  });
});

describe("Tear Asunder's dominate", () => {
  function attack(arsenal = false, weapon = true) {
    const s = scenario({ seats: [
      { hero: "rhinar", heroKey: "bravo, showstopper|0", resources: 7,
        weapons: ["anothos|0"], hand: ["tear asunder|3", ...(!weapon ? ["cartilage crush|3"] : [])] },
      { hero: "dorinthea", equipment: NO_EQUIPMENT,
        hand: arsenal ? ["sigil of suffering|3"] : ["sigil of suffering|3", "unmovable|3"],
        arsenal: arsenal ? ["unmovable|3"] : [], resources: 3 },
    ] });
    s.play("tear asunder|3");
    if (weapon) s.attackWithWeapon("anothos|0");
    else s.play("cartilage crush|3");
    s.blockWith().passPriority();
    expect(projectStateFor(s.state, 1).chain[0]?.dominate).toBe(true);
    return s;
  }

  it.each([false, true])("rejects a second reaction from hand after the first resolves (weapon: %s)", (weapon) => {
    const s = attack(false, weapon);
    s.react("sigil of suffering|3", { settle: false }).passPriority().passPriority().passPriority();
    expect(s.state.priorityPlayer).toBe(1);
    const second = s.state.players[1]!.hand.find((c) => c.cardId === printingId("unmovable|3"))!;
    expect(legalIntents(s.state, 1).some((i) => i.kind === "play-card" && i.instanceId === second.instanceId)).toBe(false);
    expect(applyIntent(s.state, 1, {
      kind: "play-card", instanceId: second.instanceId, pitchInstanceIds: [],
    })).toMatchObject({ ok: false, error: expect.stringContaining("Dominate") });
    expect(s.state.chain[0]!.defendingCards).toHaveLength(1);
  });

  it("lets only one of two stacked reactions from hand resolve", () => {
    const s = attack();
    s.react("sigil of suffering|3", { settle: false }).react("unmovable|3", { settle: false });
    s.settle();
    expect(s.state.chain[0]!.defendingCards).toHaveLength(1);
    s.expectLog("fails to resolve (Dominate)");
  });

  it("allows a reaction from arsenal alongside one from hand", () => {
    const s = attack(true);
    s.react("sigil of suffering|3", { settle: false }).react("unmovable|3", { settle: false }).settle();
    expect(s.state.chain[0]!.defendingCards).toHaveLength(2);
  });
});
