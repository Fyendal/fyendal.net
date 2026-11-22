import { engineRuntime } from "../engineRuntime.js";
import { describe, expect, it } from "vitest";
import { makeCtx } from "../scriptContext.js";
import { giveCard, makeGame, player } from "./fixtures.js";

describe("ScriptCtx.hasKeyword", () => {
  function setup() {
    const state = makeGame(7);
    const id = giveCard(state, 0, "DOM");
    const card = player(state, 0).hand.find((candidate) => candidate.instanceId === id)!;
    return { state, card, ctx: makeCtx(state, engineRuntime, 0, card) };
  }

  it("reads printed keywords case-insensitively", () => {
    const { card, ctx } = setup();
    expect(ctx.hasKeyword(card, "dominate")).toBe(true);
    expect(ctx.hasKeyword(card, "Go again")).toBe(false);
  });

  it("honors granted and suppressed keywords", () => {
    const { card, ctx } = setup();
    card.grantedKeywords = ["Go again"];
    card.suppressedKeywords = ["Dominate"];
    expect(ctx.hasKeyword(card, "go again")).toBe(true);
    expect(ctx.hasKeyword(card, "Dominate")).toBe(false);
  });

  it("resolves a stale snapshot to the live instance", () => {
    const { card, ctx } = setup();
    const snapshot = { ...card };
    card.grantedKeywords = ["Go again"];
    expect(ctx.hasKeyword(snapshot, "go again")).toBe(true);
  });

  it("drops printed keywords when the card's abilities are suppressed", () => {
    const { state, card, ctx } = setup();
    card.grantedKeywords = ["Go again"];
    player(state, 0).hero.scriptState = { ownedCardAbilitiesDisabledTurn: state.turn };
    expect(ctx.hasKeyword(card, "Dominate")).toBe(false);
    expect(ctx.hasKeyword(card, "Go again")).toBe(true);
  });
});
