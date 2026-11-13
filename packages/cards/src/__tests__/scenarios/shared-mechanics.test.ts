import { describe, expect, it } from "vitest";
import type { ScriptCtx } from "@fyendal/engine";
import { cardData } from "../../index.js";
import { chargeAttack, requestAnyTargetChoice } from "../../scripts/shared-helpers.js";
import { scenario } from "../harness.js";

const BLUE = "raging onslaught|3";
const EARTH = "autumn's touch|3";
const LIGHTNING = "heaven's claws|3";
const ALLY = "limpit, hop-a-long|2";

function frostbites(g: ReturnType<typeof scenario>, seat: number): number {
  return g.state.players[seat]!.board.filter((card) => cardData[card.cardId]?.name === "Frostbite").length;
}

describe("shared fusion", () => {
  it("Fulminate fuses with Earth and Lightning in one reveal and records each element", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", weapons: [], hand: ["fulminate|2", EARTH, LIGHTNING], resources: 2 },
        { hero: "dorinthea" },
      ],
    });

    g.play("fulminate|2", { settle: false });
    expect(g.state.pendingDecision).toMatchObject({ chooseHook: "elemental-fusion" });
    g.chooseOption("both:");

    expect(g.state.players[0]!.flags).toMatchObject({
      fusedThisTurn: true,
      earthFusedThisTurn: true,
      lightningFusedThisTurn: true,
    });
    expect(g.state.modifiers).toEqual(expect.arrayContaining([
      expect.objectContaining({ attack: 3, appliesTo: "attack-action" }),
      expect.objectContaining({ goAgain: true, appliesTo: "attack-action" }),
    ]));
    g.expectLog("reveals");
  });

  it("Fulminate fused with Earth alone grants only the Earth bonus", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", weapons: [], hand: ["fulminate|2", EARTH, LIGHTNING], resources: 2 },
        { hero: "dorinthea" },
      ],
    });

    g.play("fulminate|2", { settle: false }).chooseOption("earth:");

    expect(g.state.players[0]!.flags.lightningFusedThisTurn).toBeFalsy();
    expect(g.state.modifiers).toEqual(expect.arrayContaining([
      expect.objectContaining({ attack: 3, appliesTo: "attack-action" }),
    ]));
    expect(g.state.modifiers.some((modifier) => modifier.goAgain === true)).toBe(false);
  });

  it("Blossoming Spellblade (Earth and Lightning Fusion) is not fused by an Earth card alone", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", weapons: [], hand: ["blossoming spellblade|1", EARTH, LIGHTNING], resources: 2 },
        { hero: "dorinthea" },
      ],
    });

    g.play("blossoming spellblade|1", { settle: false });
    expect(g.state.pendingDecision).toMatchObject({ chooseHook: "earth-fusion" });
    g.chooseCard(EARTH);
    expect(g.state.pendingDecision).toMatchObject({ chooseHook: "lightning-fusion" });
    g.chooseOption("no");

    expect(g.state.players[0]!.flags.fusedThisTurn).toBeFalsy();
    expect(g.state.chain.at(-1)?.attackingCard.scriptState?.fused).toBeUndefined();
  });

  it("Isenhowl Weathervane's Frostbites come from an Ice fusion of any set", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: [],
          hand: ["isenhowl weathervane|3", "AJV020", "AJV018"],
          resources: 5,
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("isenhowl weathervane|3").chooseOption("opposing hero");
    expect(frostbites(g, 1)).toBe(0);
    g.play("AJV020", { settle: false }).chooseCard("AJV018");

    expect(frostbites(g, 1)).toBe(2);
  });
});

describe("shared reload", () => {
  it("Over Flex reloads a hand card face down into an empty arsenal", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", weapons: [], hand: ["over flex|1", BLUE], resources: 1 },
        { hero: "dorinthea" },
      ],
    });

    g.play("over flex|1");
    expect(g.state.pendingDecision).toMatchObject({
      chooseHook: "reload",
      promptMessage: { id: "card.common.reload" },
    });
    g.chooseCard(BLUE)
      .expectInZone(0, BLUE, "arsenal")
      .expectFaceDown(0, BLUE, true);
  });
});

describe("shared charge", () => {
  it("MON Bolt of Courage charges a hand card as its additional cost and draws on hit", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", heroKey: "prism|0", weapons: [], hand: ["bolt of courage|3", BLUE], deck: [BLUE, BLUE] },
        { hero: "dorinthea" },
      ],
    });

    g.play("bolt of courage|3", { settle: false });
    expect(g.state.pendingDecision).toMatchObject({
      chooseHook: "charge-cost",
      promptMessage: { id: "card.common.charge.choose" },
    });
    g.chooseCard(BLUE).expectInZone(0, BLUE, "soul");
    expect(g.state.chain.at(-1)?.attackingCard.scriptState?.chargedPitch).toBe(3);

    g.blockWith().settle().expectHandSize(0, 1);
  });

  it("asks for the charge before the extra additional cost and passes other choices on", () => {
    const calls: string[] = [];
    const script = chargeAttack({
      additionalCost: () => void calls.push("extra cost"),
      onChoose: (_ctx, hook) => void calls.push(`extra ${hook}`),
    });
    const ctx = {
      seat: 0,
      data: { name: "Test" },
      self: { cardId: "TEST" },
      player: () => ({ hand: [{ instanceId: 7 }] }),
      requestCardChoice: (hook: string) => void calls.push(`request ${hook}`),
    } as unknown as ScriptCtx;

    script.additionalCost!(ctx);
    script.onChoose!(ctx, "charge-cost", "pass");
    script.onChoose!(ctx, "other", "1");

    expect(calls).toEqual(["request charge-cost", "extra cost", "extra other"]);
  });
});

describe("shared any-target choice", () => {
  it("SBZ Voltic Bolt targets heroes only while Photon Splicing may target an ally", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", weapons: [], hand: ["voltic bolt|1"], resources: 2 },
        { hero: "dorinthea", board: [ALLY] },
      ],
    });

    g.play("voltic bolt|1");
    expect(g.state.pendingDecision).toMatchObject({
      options: ["opposing hero", "your hero"],
      promptMessage: { id: "card.common.arcane.hero.choose", values: { amount: 5 } },
    });
    g.chooseOption("opposing hero").expectLife(1, 15);

    const any = scenario({
      seats: [
        { hero: "rhinar", weapons: [], hand: ["photon splicing|3"], resources: 1 },
        { hero: "dorinthea", board: [ALLY] },
      ],
    });
    any.play("photon splicing|3");
    const allyId = any.state.players[1]!.board[0]!.instanceId;
    expect(any.state.pendingDecision).toMatchObject({
      options: ["opposing hero", "your hero", `ally:1:${allyId}`],
      promptMessage: { id: "card.common.arcane.target.choose", values: { amount: 2 } },
    });
    any.chooseOption("ally").expectInZone(1, ALLY, "graveyard");
  });

  it("offers an optional, opposing-only choice", () => {
    const requests: { options: string[]; cardOptions: (number | null)[] }[] = [];
    const ctx = {
      seat: 0,
      data: { name: "Test" },
      self: { cardId: "TEST" },
      state: {
        players: [
          { seat: 0, hero: { instanceId: 1 }, board: [{ instanceId: 2 }] },
          { seat: 1, hero: { instanceId: 3 }, board: [{ instanceId: 4 }] },
        ],
      },
      cardTypes: () => ["ally"],
      previewArcaneDamage: (amount: number) => amount + 1,
      requestChoice: (...args: [string, unknown, string[], number, (number | null)[]]) =>
        void requests.push({ options: args[2], cardOptions: args[4] }),
    } as unknown as ScriptCtx;

    requestAnyTargetChoice(ctx, "hook", 1, { opposing: true, optional: true });

    expect(requests).toEqual([{ options: ["no", "opposing hero", "ally:1:4"], cardOptions: [null, null, 4] }]);
  });
});
