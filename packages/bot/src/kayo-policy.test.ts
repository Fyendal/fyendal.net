import { cardData, decklists, findPrinting, precon, scripts, validatePresentation } from "@fyendal/cards";
import { applyIntent, createGame, legalIntents, projectStateFor } from "@fyendal/engine";
import type { GameIntent } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import { chooseKayoIntent, chooseKayoIntentWithTrace } from "./kayo-policy.js";
import { kayoPresentationFor } from "./sideboard.js";

function game(names: readonly [string, number][], turn = 2) {
  const pool = precon("bot-kayo-sage")!.pool;
  const state = createGame({
    decklists: [{ heroId: pool.heroId, ...kayoPresentationFor(decklists.dorinthea) }, decklists.dorinthea],
    cards: cardData, scripts, seed: 721, startPlayer: 0,
  });
  state.turn = turn;
  state.players[0]!.hand = names.map(([name, pitch]) => ({
    instanceId: state.nextInstanceId++, cardId: findPrinting(name, pitch)!.id, owner: 0,
  }));
  return state;
}

function input(state: ReturnType<typeof game>, seat: 0 | 1 = 0) {
  return { seat, view: projectStateFor(state, seat), legal: legalIntents(state, seat), cards: cardData, state };
}

function opponentPass(state: ReturnType<typeof game>, seat: 0 | 1): GameIntent {
  const legal = legalIntents(state, seat);
  const intent = legal.find((candidate) => candidate.kind === "defend" && candidate.instanceIds.length === 0)
    ?? legal.find((candidate) => candidate.kind === "pass");
  if (!intent) throw new Error(`No opponent pass in ${state.phase}`);
  return intent;
}

function cardName(intent: GameIntent, state: ReturnType<typeof game>): string | undefined {
  const id = intent.kind === "activate-ability" ? intent.sourceInstanceId
    : "instanceId" in intent ? intent.instanceId : undefined;
  const player = state.players[0]!;
  const card = [...player.hand, ...player.arsenal, ...player.weapons, ...Object.values(player.equipment)]
    .find((candidate) => candidate?.instanceId === id);
  return card && cardData[card.cardId]?.name;
}

function apply(state: ReturnType<typeof game>, seat: 0 | 1, intent: GameIntent) {
  const result = applyIntent(state, seat, intent);
  expect(result.ok, result.ok ? "" : result.error).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

describe("Kayo presentation", () => {
  it.each(["SFA001", "SKA001", "SBA001", "SBR001", "SEN001", "SIY001", "SLY001", "SDO001", "SBZ001", "unknown"])(
    "presents a legal forty against %s", (heroId) => {
      const presented = kayoPresentationFor({ heroId, weaponIds: [], equipment: {} });
      expect(presented.deck).toHaveLength(40);
      expect(validatePresentation(precon("bot-kayo-sage")!.pool, presented, "silver-age")).toMatchObject({ ok: true });
    },
  );
  it("uses setup Windups against slower decks and arcane equipment from the supplied pool against Wizards", () => {
    const slow = kayoPresentationFor({ heroId: "SDO001", weaponIds: [], equipment: {} });
    expect(slow.deck.filter((id) => cardData[id]?.name === "Agile Windup")).toHaveLength(4);
    const fast = kayoPresentationFor({ heroId: "SFA001", weaponIds: [], equipment: {} });
    expect(fast.deck.filter((id) => cardData[id]?.name === "Agile Windup")).toHaveLength(2);
    const wizard = kayoPresentationFor({ heroId: "SBZ001", weaponIds: [], equipment: {} });
    expect(Object.values(wizard.equipment).map((id) => cardData[id!]?.name)).toEqual([
      "Nullrune Hood", "Predatory Plating", "Skera Strapping", "Flat Trackers",
    ]);
    expect(cardData[kayoPresentationFor({ heroId: "SBR001", weaponIds: [], equipment: {} }).equipment.legs!]?.name)
      .toBe("Unflinching Foothold");
  });
});

describe("Kayo policy", () => {
  it.each([2, 3])("discards pitch-%s Agile Windup on turn zero before arsenaling Bare Fangs", (pitch) => {
    let state = game([["Agile Windup", pitch], ["Bare Fangs", 1], ["Bear Hug", 3], ["Rough Up", 1]], 1);
    const first = chooseKayoIntentWithTrace(input(state));
    expect(first.plan).toBeUndefined();
    expect(cardName(first.intent, state)).toBe("Agile Windup");
    state = apply(state, 0, first.intent);
    for (let step = 0; step < 30 && state.turn === 1; step++) {
      const seat = (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1;
      const intent = seat === 0
        ? chooseKayoIntent(input(state))
        : opponentPass(state, seat);
      state = apply(state, seat, intent);
    }
    expect(state.turn).toBe(2);
    expect(state.players[0]!.arsenal.map((card) => cardData[card.cardId]?.name)).toEqual(["Bare Fangs"]);
    expect(state.players[0]!.board.map((card) => cardData[card.cardId]?.name)).toContain("Agility");
  });

  it("pops Flat Trackers and reserves Bare Fangs for next turn", () => {
    let state = game([["Bare Fangs", 1], ["Bear Hug", 3]]);
    const first = chooseKayoIntent(input(state));
    expect(cardName(first, state)).toBe("Flat Trackers");
    state = apply(state, 0, first);
    for (let step = 0; step < 30 && state.turn === 2; step++) {
      const seat = (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1;
      const intent = seat === 0
        ? chooseKayoIntent(input(state))
        : opponentPass(state, seat);
      state = apply(state, seat, intent);
    }
    expect(state.players[0]!.arsenal.map((card) => cardData[card.cardId]?.name)).toEqual(["Bare Fangs"]);
    expect(state.players[0]!.board.map((card) => cardData[card.cardId]?.name)).toContain("Agility");
  });

  it("converts Wild Ride into Claw into a finisher", () => {
    let state = game([["Wild Ride", 1], ["Bear Hug", 3], ["Vigorous Smashup", 3], ["Rough Up", 1]]);
    // Every random draw is a blue six-power pitch card, so the hand can
    // afford Claw plus a finisher regardless of which card is discarded.
    state.players[0]!.deck.forEach((card) => { card.cardId = findPrinting("Bear Hug", 3)!.id; });
    // Boots are already spent, so this hand is dedicated to the current turn.
    delete state.players[0]!.equipment.legs;
    const attacks: string[] = [];
    for (let step = 0; step < 90 && state.turn === 2 && state.winner === null; step++) {
      const seat = (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1;
      const intent = seat === 0 ? chooseKayoIntent(input(state))
        : opponentPass(state, seat);
      expect(intent).toBeDefined();
      const name = seat === 0 ? cardName(intent, state) : undefined;
      if (name && (cardData[findPrinting(name)?.id ?? ""]?.subtypes?.includes("attack") ||
          name === "Mandible Claw")) attacks.push(name);
      state = apply(state, seat, intent);
    }
    expect(attacks[0]).toBe("Wild Ride");
    expect(attacks).toContain("Mandible Claw");
    expect(attacks.length).toBeGreaterThanOrEqual(3);
  });

  it("returns legal deterministic intents for awkward hands without simulation", () => {
    const state = game([["Bear Hug", 1], ["Strongest Survive", 2], ["Vigorous Smashup", 2]]);
    delete state.players[0]!.equipment.legs;
    const observed = { ...input(state), state: undefined };
    const intent = chooseKayoIntent(observed);
    expect(observed.legal).toContainEqual(intent);
    expect(chooseKayoIntent(observed)).toEqual(intent);
    apply(state, 0, intent);
  });
  it("leads with conditional go again and makes a two-attack turn without Claw", () => {
    let state = game([["Buckwild", 1], ["Bear Hug", 3], ["Vigorous Smashup", 3], ["Rough Up", 1]]);
    delete state.players[0]!.equipment.legs;
    const attacks: string[] = [];
    for (let step = 0; step < 60 && state.turn === 2; step++) {
      const seat = (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1;
      const intent = seat === 0 ? chooseKayoIntent(input(state))
        : opponentPass(state, seat);
      const name = seat === 0 ? cardName(intent, state) : undefined;
      if (intent.kind === "play-card" && name) attacks.push(name);
      state = apply(state, seat, intent);
    }
    expect(attacks[0]).toBe("Buckwild");
    expect(attacks.length).toBeGreaterThanOrEqual(2);
  });

  it("discards opening Windup while defending when its instant is legal", () => {
    const state = game([["Agile Windup", 3], ["Bear Hug", 3]], 1);
    state.activePlayer = 1;
    state.priorityPlayer = 0;
    const observed = input(state);
    const windup: GameIntent = {
      kind: "activate-ability", sourceInstanceId: state.players[0]!.hand[0]!.instanceId,
      pitchInstanceIds: [], pitchRequired: 0,
    };
    const decision = chooseKayoIntent({ ...observed, state: undefined, legal: [windup, { kind: "pass" }] });
    expect(decision).toEqual(windup);
  });

  it.each([20, 3])("protects an on-hit or survives lethal at %s life", (life) => {
    const state = game([["Wild Ride", 1], ["Bear Hug", 3], ["Clash of Agility", 1], ["Rough Up", 1]]);
    const view = projectStateFor(state, 0);
    view.activePlayer = 1;
    view.priorityPlayer = 0;
    view.phase = "defend";
    view.players[0].life = life;
    view.pendingDecision = { player: 0, kind: "defend", prompt: "Choose defenders" };
    view.chain = [{
      attackingCard: { instanceId: 99999, cardId: "WTR167", owner: 1 },
      defendingCards: [], attackValue: 4, defenseValue: 0, damage: 4,
      resolved: false, reactions: [], onHitEffects: [{ sourceCardId: "WTR167", text: "Draw a card" }],
    }];
    const equipment = Object.values(view.players[0].equipment).filter((card) => card !== undefined);
    const legal: GameIntent[] = [
      { kind: "defend", instanceIds: [] },
      ...[...view.players[0].hand, ...equipment].map((card): GameIntent => ({
        kind: "stage-defenders", instanceIds: [card.instanceId],
      })),
    ];
    const chosen = chooseKayoIntent({ seat: 0, view, legal, cards: cardData });
    expect(chosen.kind).toBe("stage-defenders");
    if (chosen.kind !== "stage-defenders") return;
    const own = [...view.players[0].hand, ...equipment];
    const defense = chosen.instanceIds.reduce(
      (sum, id) => sum + (own.find((card) => card.instanceId === id)?.defense ?? 0), 0,
    );
    expect(defense).toBeGreaterThanOrEqual(life === 3 ? 2 : 4);
  });

});
