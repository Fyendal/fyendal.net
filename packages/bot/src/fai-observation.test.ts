import { cardData, scripts } from "@fyendal/cards";
import { createGame, legalIntents, projectStateFor } from "@fyendal/engine";
import { describe, expect, it } from "vitest";
import type { BotPolicyInput } from "./policy.js";
import { faiAggroPresentation } from "./sideboard.js";
import { aggroSandbox, knownFaiDeck, observedAggro } from "./fai-aggro-planner.js";
import { createFaiSandbox, knownRemainingFaiDeck, observeFaiState } from "./fai-observation.js";
import { collectFaiRouteFacts } from "./fai-route-facts.js";

function fixture() {
  const deck = { heroId: "SFA001", ...faiAggroPresentation() };
  const state = createGame({ decklists: [deck, deck], cards: cardData, scripts, seed: 101 });
  const input = (): BotPolicyInput => ({ state, seat: 0, cards: cardData,
    view: projectStateFor(state, 0), legal: legalIntents(state, 0) });
  return { deck, state, input };
}

describe("shared Fai observation boundaries", () => {
  it("requires the caller's deck and does not fall back to Aggro or an unrelated input override", () => {
    const { state, input } = fixture();
    // These copies are all in the explicit starting pool, but none is visible.
    state.players[0].hand = []; state.players[0].graveyard = [];
    const selected = ["SFA035", "SFA035", "SFA016", "SFA016"];
    const observed = { ...input(), knownOwnDeck: faiAggroPresentation().deck };
    expect(knownRemainingFaiDeck(observed, selected)).toEqual([...selected].sort());
    expect(createFaiSandbox(observed, selected)!.players[0].deck.map((card) => card.cardId))
      .toEqual([...selected].sort());
    expect(knownRemainingFaiDeck(observed, [])).toEqual([]);
    expect(createFaiSandbox(observed, [])!.players[0].deck).toEqual([]);
  });

  it("subtracts each visible physical card once, preserving duplicate copies", () => {
    const { state, input } = fixture();
    state.players[0].hand = [{ cardId: "SFA035", instanceId: state.nextInstanceId++, owner: 0 }];
    state.players[0].graveyard = [];
    const deck = ["SFA035", "SFA035", "SFA016"];
    const original = [...deck];
    expect(knownRemainingFaiDeck(input(), deck)).toEqual(["SFA016", "SFA035"]);
    expect(deck).toEqual(original);
  });

  it("keeps Aggro adapters and their explicit-deck override identical to the shared helpers", () => {
    const { deck, input } = fixture();
    const observed = input();
    expect(knownFaiDeck(observed)).toEqual(knownRemainingFaiDeck(observed, deck.deck));
    expect(aggroSandbox(observed)).toEqual(createFaiSandbox(observed, deck.deck));
    const alternate = deck.deck.map((id) => id === "HNT151" ? "SFA035" : id);
    const custom = { ...observed, knownOwnDeck: alternate };
    expect(knownFaiDeck(custom)).toEqual(knownRemainingFaiDeck(custom, alternate));
    expect(aggroSandbox(custom)).toEqual(createFaiSandbox(custom, alternate));
    const state = createFaiSandbox(custom, alternate)!;
    expect(observedAggro(state, custom)).toEqual(observeFaiState(state, custom));
    expect(createFaiSandbox({ ...observed, state: undefined }, deck.deck)).toBeUndefined();
  });

  it("ignores real deck order and opposing private identities without mutating the game", () => {
    const { deck, state, input } = fixture();
    const before = JSON.stringify(state);
    const sandbox = createFaiSandbox(input(), deck.deck)!;
    expect(JSON.stringify(state)).toBe(before);
    expect(sandbox.players.map((player) => player.life)).toEqual(state.players.map((player) => player.life));
    expect(sandbox.scriptsRef).toBe(state.scriptsRef);
    state.players[0].deck.reverse();
    for (const zone of [state.players[1].hand, state.players[1].deck,
      state.players[1].arsenal, state.players[1].pitch]) {
      for (const card of zone) card.cardId = "SFA035";
    }
    const changed = createFaiSandbox(input(), deck.deck)!;
    expect(changed.players[0].deck).toEqual(sandbox.players[0].deck);
    for (const zone of ["hand", "deck", "arsenal", "pitch"] as const) {
      expect(changed.players[1][zone]).toEqual(sandbox.players[1][zone]);
    }
    const observed = observeFaiState(changed, input());
    expect(observed.view).toEqual(projectStateFor(changed, 0, input().view.gameId));
    expect(observed.legal).toEqual(legalIntents(changed, 0));
  });
});

describe("Fai route facts are not policy scores", () => {
  it("separates pitch, reserve and other locations, excluding next-hand draws from current hand", () => {
    const { state, input } = fixture();
    const card = () => ({ cardId: "SFA035", instanceId: state.nextInstanceId++, owner: 0 });
    const held = card(), drawn = card(), pitched = card(), reserved = card();
    const banished = card(), discarded = card(), inDeck = card();
    Object.assign(state.players[0], { hand: [held, drawn], pitch: [pitched], arsenal: [reserved],
      banish: [banished], graveyard: [discarded], deck: [inDeck] });
    const before = JSON.stringify(state);
    const facts = collectFaiRouteFacts(state, input(), {
      opponentLife: state.players[1].life + 7, deckIds: new Set([drawn.instanceId, inDeck.instanceId]),
    });
    expect(facts.damage).toBe(7);
    expect(facts.currentHand.map((entry) => entry.instanceId)).toEqual([held.instanceId]);
    expect(facts.locations).toEqual({
      hand: new Set([held.instanceId, drawn.instanceId]), pitch: new Set([pitched.instanceId]),
      arsenal: new Set([reserved.instanceId]), banish: new Set([banished.instanceId]),
      graveyard: new Set([discarded.instanceId]), deck: new Set([inDeck.instanceId]),
    });
    expect(facts).not.toHaveProperty("converted");
    expect(facts).not.toHaveProperty("score");
    expect(JSON.stringify(state)).toBe(before);
  });
});
