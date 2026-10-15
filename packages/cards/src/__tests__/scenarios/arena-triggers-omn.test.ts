import { describe, expect, it } from "vitest";
import { cardData, scripts } from "../../index.js";
import { printingId, scenario } from "../harness.js";

const NO_EQUIPMENT = { head: null, chest: null, arms: null, legs: null } as const;

type Game = ReturnType<typeof scenario>;

function boardNames(g: Game, seat: number): string[] {
  return g.state.players[seat]!.board.map((card) => cardData[card.cardId]!.name);
}

// OMN / AZS / IAR / HNT / OBK "enters / leaves the arena" abilities are
// triggered layers that wait on the stack for priority.
describe("OMN-group arena triggers use the stack", () => {
  it("Crackle from Afar declares its target attack as the trigger goes on the stack", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", heroKey: "zyggy|0", hand: ["snatch|1", "crackle from afar|3"], weapons: [], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
      ],
    });

    g.play("snatch|1").blockWith().react("crackle from afar|3", { settle: false });
    for (let i = 0; i < 6 && g.state.pendingDecision?.chooseHook !== "trigger-target"; i++) g.passPriority();

    const attack = g.state.chain.at(-1)!.attackingCard;
    expect(g.state.pendingDecision).toMatchObject({
      chooseHook: "trigger-target",
      options: ["pass", String(attack.instanceId)],
    });
    g.doRaw({ kind: "choose", optionId: String(attack.instanceId) });

    expect(g.stackLabels()).toEqual(["Up to 1 target attack gets +1 power"]);
    g.expectAttackValue(4);

    g.passPriority().passPriority();
    expect(g.state.stack).toEqual([]);
    g.expectAttackValue(5);
  });

  it("Fleeing Starbreeze may decline its target", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", heroKey: "zyggy|0", hand: ["snatch|1", "fleeing starbreeze|3"], weapons: [], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
      ],
    });

    g.play("snatch|1").blockWith().react("fleeing starbreeze|3", { settle: false });
    for (let i = 0; i < 6 && g.state.pendingDecision?.chooseHook !== "trigger-target"; i++) g.passPriority();
    expect(g.state.pendingDecision?.chooseHook).toBe("trigger-target");
    g.doRaw({ kind: "choose", optionId: "pass" });

    expect(g.stackLabels()).toEqual(["Up to 1 target attack gets go again"]);
    g.passPriority().passPriority();
    expect(g.state.stack).toEqual([]);
    expect(g.state.chain.at(-1)?.goAgain).toBe(false);
  });

  it("Nourishing Glow gains life only when its enter trigger resolves", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["nourishing glow|3"], life: 15, equipment: NO_EQUIPMENT },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });

    g.play("nourishing glow|3", { settle: false });
    while (g.state.stack[0]?.card) g.passPriority();

    expect(g.stackLabels()).toEqual(["Gain 1 life"]);
    g.expectInZone(0, "nourishing glow|3", "board").expectLife(0, 15);
    g.passPriority().passPriority();
    g.expectLife(0, 16);
  });

  it("Stardust Spike gains a resource and amp only when its leave trigger resolves", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", board: ["stardust spike|1"], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", hand: ["head jab|3"], equipment: NO_EQUIPMENT },
      ],
      active: 1,
    });

    g.play("head jab|3").blockWith();
    for (let i = 0; i < 12 && g.state.pendingDecision?.chooseHook !== "ward"; i++) g.passPriority();
    const destroy = g.state.pendingDecision?.options?.find((option) => option.startsWith("destroy"));
    g.doRaw({ kind: "choose", optionId: destroy! });
    g.passUntilLayer("Gain 1 resource and amp 1");

    g.expectInZone(0, "stardust spike|1", "graveyard").expectResources(0, 0);
    g.passPriority().passPriority();
    g.expectResources(0, 1);
    expect(g.state.players[0]!.flags.nextArcaneBonus).toBe(1);
  });

  it("Haven Veil keeps its beginning-of-phase trigger beside its enter trigger", () => {
    const script = scripts[printingId("haven veil|2")]!;
    expect(script.triggers?.map((trigger) => trigger.event)).toEqual(["card-entered-arena", "begin-action-phase"]);
    const sigil = scripts[printingId("sigil of astral flow|3")]!;
    expect(sigil.triggers?.map((trigger) => trigger.event)).toEqual(["card-left-arena", "begin-action-phase"]);
    expect(sigil.onLeaveArena).toBeUndefined();

    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["haven veil|2"], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.play("haven veil|2", { settle: false });
    while (g.state.stack[0]?.card) g.passPriority();
    expect(g.stackLabels()).toEqual(["Prevent the next 2 arcane damage to you this turn"]);
    g.passPriority().passPriority();
    expect(g.state.stack).toEqual([]);
  });

  it("Channel Stormgarden creates Lightning Flow on resolution and keeps Channel Lightning", () => {
    const script = scripts[printingId("channel stormgarden|2")]!;
    expect(script.triggers?.map((trigger) => trigger.event)).toEqual(["card-entered-arena", "end-of-turn"]);

    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["channel stormgarden|2"], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.play("channel stormgarden|2", { settle: false });
    while (g.state.stack[0]?.card) g.passPriority();
    expect(g.stackLabels()).toEqual(["Create a Lightning Flow token"]);
    expect(boardNames(g, 0)).not.toContain("Lightning Flow");
    g.passPriority().passPriority();
    expect(boardNames(g, 0)).toContain("Lightning Flow");
  });

  it("Arcbane Grasp creates Spellbane Aegis only when its equip trigger resolves", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["arcbane grasp|3"], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    g.play("arcbane grasp|3", { settle: false });
    while (g.state.stack[0]?.card) g.passPriority();
    expect(g.stackLabels()).toEqual(["Create a Spellbane Aegis token"]);
    expect(boardNames(g, 0)).not.toContain("Spellbane Aegis");
    g.passPriority().passPriority();
    expect(boardNames(g, 0)).toContain("Spellbane Aegis");
  });

  it("Null Time Zone enters with steam counters, then names a card from its trigger", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["null time zone|3"] },
        { hero: "dorinthea" },
      ],
    });
    g.play("null time zone|3", { settle: false }).passPriority().passPriority();
    expect(g.state.pendingDecision?.chooseHook).toBe("engine-crank");
    g.doRaw({ kind: "choose", optionId: "no" });

    expect(g.stackLabels()).toEqual(["Name a card"]);
    const zone = g.state.players[0]!.board.find((card) => cardData[card.cardId]!.name === "Null Time Zone");
    expect(zone?.counters?.steam).toBe(2);
    expect(g.state.pendingDecision?.chooseHook).not.toBe("null-name");

    g.passPriority().passPriority();
    expect(g.state.pendingDecision?.chooseHook).toBe("null-name");
  });

  it("Extinction Level Event names a disease token from its enter trigger", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["extinction level event|1"], weapons: [], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
      ],
    });
    g.play("extinction level event|1", { settle: false });
    while (g.state.stack[0]?.card) g.passPriority();

    expect(g.stackLabels()).toEqual(["Name a disease token"]);
    g.passPriority().passPriority();
    expect(g.state.pendingDecision?.options).toContain("Frailty");
  });
});
