import { cardData, decklists, precon, scripts, validatePresentation } from "@fyendal/cards";
import { applyIntent, createGame, legalIntents, projectStateFor } from "@fyendal/engine";
import type { Decklist, GameIntent } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import { chooseLeviaIntent, chooseLeviaIntentWithTrace, leviaEngineValue, leviaSolverRules } from "./levia-policy.js";
import { handDamage } from "./hand-value.js";
import { leviaMacroPositionBonus } from "./levia-macros.js";
import { leviaPresentationFor } from "./sideboard.js";

const opponent = decklists.dorinthea;

function game() {
  const pool = precon("bot-levia-gates")!.pool;
  const validated = validatePresentation(pool, leviaPresentationFor(opponent), "cc", { cardPoolMode: "open" });
  if (!validated.ok) throw new Error(validated.error);
  const levia: Decklist = validated.decklist;
  const state = createGame({ decklists: [levia, opponent], cards: cardData, scripts, seed: 1717, startPlayer: 0 });
  state.turn = 3;
  return state;
}

function hand(state: ReturnType<typeof game>, cardIds: readonly string[]) {
  state.players[0]!.hand = cardIds.map((cardId) => ({
    instanceId: state.nextInstanceId++, cardId, owner: 0,
  }));
}

function choice(state: ReturnType<typeof game>): GameIntent {
  const legal = legalIntents(state, 0);
  const intent = chooseLeviaIntent({ seat: 0, view: projectStateFor(state, 0), legal, cards: cardData, state });
  expect(legal).toContainEqual(intent);
  expect(applyIntent(state, 0, intent).ok).toBe(true);
  return intent;
}

function playAndResolve(state: ReturnType<typeof game>, intent: GameIntent): ReturnType<typeof game> {
  expect(legalIntents(state, state.priorityPlayer)).toContainEqual(intent);
  const result = applyIntent(state, state.priorityPlayer, intent);
  if (!result.ok) throw new Error(JSON.stringify(result));
  state = result.state;
  for (let step = 0; step < 20; step++) {
    if (state.phase === "action" && state.priorityPlayer === 0 && state.stack.length === 0 && !state.pendingDecision) return state;
    const passed = applyIntent(state, state.priorityPlayer, { kind: "pass" });
    if (!passed.ok) throw new Error(JSON.stringify(passed));
    state = passed.state;
  }
  throw new Error("Action did not resolve");
}

function bloodrushTurn(draws: string[]) {
  const state = game();
  hand(state, ["WTR007", "MON140", "MST236"]);
  state.players[0]!.deck = draws.map((cardId) => ({ instanceId: state.nextInstanceId++, cardId, owner: 0 }));
  const [bellow, blue] = state.players[0]!.hand;
  const play = legalIntents(state, 0).find((intent) => intent.kind === "play-card" &&
    intent.instanceId === bellow!.instanceId && intent.pitchInstanceIds.includes(blue!.instanceId));
  expect(play).toBeDefined();
  return playAndResolve(state, play!);
}

function defending(state: ReturnType<typeof game>) {
  state.activePlayer = 1;
  state.priorityPlayer = 1;
  state.players[0]!.actionPoints = 0;
  state.players[1]!.actionPoints = 1;
  const attack = { instanceId: state.nextInstanceId++, cardId: "WTR203", owner: 1 };
  state.players[1]!.hand = [attack];
  const play = legalIntents(state, 1).find((intent) => intent.kind === "play-card" && intent.instanceId === attack.instanceId)!;
  let applied = applyIntent(state, 1, play);
  if (!applied.ok) throw new Error(JSON.stringify(applied));
  state = applied.state;
  for (let step = 0; step < 10; step++) {
    if (state.priorityPlayer === 0 && legalIntents(state, 0).some((intent) => intent.kind === "stage-defenders")) return state;
    applied = applyIntent(state, state.priorityPlayer, { kind: "pass" });
    if (!applied.ok) throw new Error(JSON.stringify(applied));
    state = applied.state;
  }
  throw new Error("Attack did not reach defense");
}

describe("Levia Gates policy", () => {
  it.each([1, 3])("preserves its hand before the opponent may attack on turn %i", (turn) => {
    let state = game();
    state.turn = turn;
    state.activePlayer = 1;
    state.priorityPlayer = 1;
    state.players[0]!.actionPoints = 0;
    state.players[1]!.actionPoints = 1;
    hand(state, ["IAR009", "IAR005", "IAR022", "IAR218"]);
    const openingHandIds = state.players[0]!.hand.map((card) => card.instanceId);
    const toll = { instanceId: state.nextInstanceId++, cardId: "IAR080", owner: 1 };
    const blue = { instanceId: state.nextInstanceId++, cardId: "MON140", owner: 1 };
    state.players[1]!.hand = [toll, blue];
    const gate = { instanceId: state.nextInstanceId++, cardId: "IAR222", owner: 1 };
    state.players[1]!.board.push(gate);
    state.players[1]!.banish = [{ instanceId: state.nextInstanceId++, cardId: "IAR026", owner: 1 }];
    const setup = legalIntents(state, 1).find((intent) =>
      intent.kind === "activate-ability" && intent.sourceInstanceId === gate.instanceId &&
      intent.pitchInstanceIds.includes(blue.instanceId)
    );
    expect(setup).toBeDefined();
    if (!setup) return;
    const announced = applyIntent(state, 1, setup);
    expect(announced.ok).toBe(true);
    if (!announced.ok) return;
    state = announced.state;
    for (let step = 0; step < 4 && state.priorityPlayer !== 0; step++) {
      const passed = applyIntent(state, state.priorityPlayer as 0 | 1, { kind: "pass" });
      expect(passed.ok).toBe(true);
      if (!passed.ok) return;
      state = passed.state;
    }
    const beforeAttack = legalIntents(state, 0);
    expect(beforeAttack.some((intent) => intent.kind === "activate-ability" &&
      state.players[0]!.hand.some((card) => card.instanceId === intent.sourceInstanceId))).toBe(true);
    expect(choice(state)).toEqual({ kind: "pass" });
    const passed = applyIntent(state, 0, { kind: "pass" });
    expect(passed.ok).toBe(true);
    if (!passed.ok) return;
    state = passed.state;
    expect(state.players[0]!.hand.map((card) => card.instanceId)).toEqual(openingHandIds);
    expect(state.turn).toBe(turn);
    expect(state.players[1]!.hand).toContainEqual(toll);
  });

  it("keeps opening blockers while Malice's Ominous Toll awaits defense", () => {
    let state = game();
    state.turn = 1;
    state.activePlayer = 1;
    state.priorityPlayer = 1;
    state.players[0]!.actionPoints = 0;
    state.players[1]!.actionPoints = 1;
    state.players[1]!.heroCardId = "IAR053";
    state.players[1]!.hero.cardId = "IAR053";
    hand(state, ["IAR009", "IAR005", "IAR022", "IAR218"]);
    state.players[0]!.board.push({ instanceId: state.nextInstanceId++, cardId: "IAR222", owner: 0 });
    const openingHandIds = state.players[0]!.hand.map((card) => card.instanceId);
    const toll = { instanceId: state.nextInstanceId++, cardId: "IAR080", owner: 1 };
    state.players[1]!.hand = [toll];
    const attack = legalIntents(state, 1).find((intent) =>
      intent.kind === "play-card" && intent.instanceId === toll.instanceId
    );
    expect(attack).toBeDefined();
    if (!attack) return;
    const played = applyIntent(state, 1, attack);
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    state = played.state;

    for (let step = 0; step < 20; step++) {
      const actor = (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1;
      const legal = legalIntents(state, actor);
      if (actor === 0 && legal.some((intent) => intent.kind === "stage-defenders")) break;
      const intent = actor === 0
        ? chooseLeviaIntent({ seat: 0, view: projectStateFor(state, 0), legal, cards: cardData, state })
        : legal.find((candidate) => candidate.kind === "pass")!;
      if (actor === 0) expect(intent).toEqual({ kind: "pass" });
      const applied = applyIntent(state, actor, intent);
      expect(applied.ok).toBe(true);
      if (!applied.ok) return;
      state = applied.state;
    }
    expect(state.players[0]!.hand.map((card) => card.instanceId)).toEqual(openingHandIds);
    const selected = choice(state);
    expect(selected).toMatchObject({ kind: "stage-defenders" });
    if (selected.kind === "stage-defenders") {
      expect(selected.instanceIds.some((id) => openingHandIds.includes(id))).toBe(true);
    }
  });

  it("keeps the twin hero in inventory and redeems at critical life", () => {
    const state = game();
    expect((state.players[0]!.inventory ?? []).map((card) => card.cardId)).toContain("DTD164");
    state.players[0]!.life = 6;
    state.players[0]!.banish = Array.from({ length: 13 }, () => ({
      instanceId: state.nextInstanceId++, cardId: "MON126", owner: 0,
    }));
    hand(state, ["MON140", "PEN322", "DTD107", "IAR214"]);
    const heroId = state.players[0]!.hero.instanceId;
    const input = { seat: 0 as const, view: projectStateFor(state, 0), legal: legalIntents(state, 0), cards: cardData, state };
    expect(input.legal).toContainEqual(expect.objectContaining({ kind: "activate-ability", sourceInstanceId: heroId }));
    expect(chooseLeviaIntentWithTrace(input).macro.goal).toBe("redeem");
    expect(choice(state)).toMatchObject({ kind: "activate-ability", sourceInstanceId: heroId });
  });

  it("selects debt stabilization from the current-turn six-power fact", () => {
    const state = game();
    state.players[0]!.life = 5;
    state.players[0]!.banish = [{ instanceId: state.nextInstanceId++, cardId: "MON126", owner: 0 }];
    hand(state, ["ROS218", "MON140", "PEN322", "IAR214"]);
    const input = { seat: 0 as const, view: projectStateFor(state, 0), legal: legalIntents(state, 0), cards: cardData, state };
    const stabilizing = chooseLeviaIntentWithTrace(input);
    expect(stabilizing.macro.goal).toBe("stabilize");
    expect(stabilizing.intent).toMatchObject({ kind: "play-card", instanceId: state.players[0]!.hand[3]!.instanceId });
    choice(state);
    state.players[0]!.flags.banishedSixPlusThisTurn = true;
    const safe = chooseLeviaIntentWithTrace({ ...input, view: projectStateFor(state, 0) });
    expect(safe.macro.goal).not.toBe("stabilize");
    expect(safe.plan?.transitions).toBeLessThanOrEqual(72);
  });

  it("values suppression and excludes face-down Blood Debt from the risk estimate", () => {
    const state = game();
    state.players[0]!.life = 5;
    state.players[0]!.banish = [{ instanceId: state.nextInstanceId++, cardId: "MON126", owner: 0 }];
    const observe = () => ({
      seat: 0 as const, view: projectStateFor(state, 0), legal: legalIntents(state, 0), cards: cardData, state,
    });
    const root = observe();
    const macro = chooseLeviaIntentWithTrace(root).macro;
    const exposed = leviaMacroPositionBonus(macro, root, root, true);
    state.players[0]!.flags.banishedSixPlusThisTurn = true;
    const suppressed = leviaMacroPositionBonus(macro, root, observe(), true);
    expect(suppressed).toBeGreaterThan(exposed);
    state.players[0]!.flags.banishedSixPlusThisTurn = false;
    state.players[0]!.banish[0]!.faceDown = true;
    expect(leviaMacroPositionBonus(macro, root, observe(), true)).toBeGreaterThan(exposed);
  });

  it("changes matchup priors without reading an opponent's hidden hand", () => {
    const state = game();
    const heroId = (name: string) => Object.values(cardData).find((card) => card.name === name)!.id;
    const decide = () => chooseLeviaIntentWithTrace({
      seat: 0, view: projectStateFor(state, 0), legal: legalIntents(state, 0), cards: cardData, state,
    });
    state.players[1]!.heroCardId = heroId("Oscilio, Constella Intelligence");
    const wizard = decide().macro;
    expect(wizard.matchup).toBe("wizard");
    state.players[1]!.hand = [{ instanceId: state.nextInstanceId++, cardId: "WTR159", owner: 1 }];
    const first = decide().macro;
    state.players[1]!.hand[0]!.cardId = "WTR160";
    expect(decide().macro).toEqual(first);
    state.players[1]!.heroCardId = heroId("Levia, Shadowborn Abomination");
    expect(decide().macro.matchup).toBe("mirror");
    state.players[1]!.heroCardId = heroId("Fai, Rising Rebellion");
    expect(decide().macro.matchup).toBe("race");
    state.players[1]!.heroCardId = heroId("Riptide, Lurker of the Deep");
    expect(decide().macro.matchup).toBe("trap");
  });

  it("chooses setup, Bloodrush, and attrition goals from playable public positions", () => {
    const state = game();
    state.turn = 1;
    hand(state, ["IAR020", "IAR026", "MON140", "ROS218"]);
    const decide = () => chooseLeviaIntentWithTrace({
      seat: 0, view: projectStateFor(state, 0), legal: legalIntents(state, 0), cards: cardData, state,
    });
    expect(decide().macro.goal).toBe("engine");
    state.turn = 3;
    expect(decide().macro.goal).toBe("pressure");
    hand(state, ["WTR007", "IAR026", "MON140", "PEN322"]);
    expect(decide().macro.goal).toBe("bloodrush");
    state.players[1]!.heroCardId = "MPG000";
    hand(state, ["MON140", "PEN322", "DTD107", "IAR214"]);
    state.players[0]!.board.push({ instanceId: state.nextInstanceId++, cardId: "IAR222", owner: 0 });
    expect(decide().macro).toMatchObject({ goal: "attrition", matchup: "grindy" });
    state.players[0]!.board[0]!.cardId = "IAR221";
    expect(decide().macro).toMatchObject({ goal: "attrition", matchup: "grindy" });
  });

  it("plays Goremass as engine setup after a six-power banish this turn", () => {
    const state = game();
    state.players[0]!.flags.banishedSixPlusThisTurn = true;
    hand(state, ["IAR037", "MON140"]);
    const summoning = state.players[0]!.hand[0]!;
    expect(choice(state)).toMatchObject({ kind: "play-card", instanceId: summoning.instanceId });
  });

  it("passes instead of spending a blue on Goremass before its condition is met", () => {
    const state = game();
    hand(state, ["IAR037", "IAR037"]);
    state.players[0]!.weapons = [];
    state.players[0]!.equipment = {};
    const summoning = state.players[0]!.hand[0]!;
    expect(legalIntents(state, 0)).toContainEqual(expect.objectContaining({
      kind: "play-card", instanceId: summoning.instanceId,
    }));
    expect(choice(state)).toEqual({ kind: "pass" });
  });

  it.each([
    ["IAR026", "MON140"],
    ["MON140", "IAR026"],
  ])("opts a blue card to the top for blue Pull from Beyond from %s, %s", (first, second) => {
    let state = game();
    hand(state, ["IAR214"]);
    state.players[0]!.deck = [first, second].map((cardId) => ({
      instanceId: state.nextInstanceId++, cardId, owner: 0,
    }));
    const blue = state.players[0]!.deck.find((card) => card.cardId === "MON140")!;
    const red = state.players[0]!.deck.find((card) => card.cardId === "IAR026")!;
    const pull = state.players[0]!.hand[0]!;
    const play = legalIntents(state, 0).find((intent) =>
      intent.kind === "play-card" && intent.instanceId === pull.instanceId
    );
    expect(play).toBeDefined();
    if (!play) return;
    const played = applyIntent(state, 0, play);
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    state = played.state;
    for (let step = 0; step < 8 && state.pendingDecision?.promptMessage?.id !== "card.common.opt"; step++) {
      const actor = state.priorityPlayer as 0 | 1;
      const passed = applyIntent(state, actor, { kind: "pass" });
      expect(passed.ok).toBe(true);
      if (!passed.ok) return;
      state = passed.state;
    }
    expect(state.pendingDecision?.promptMessage?.id).toBe("card.common.opt");
    const view = projectStateFor(state, 0);
    expect(chooseLeviaIntent({ seat: 0, view, legal: legalIntents(state, 0), cards: cardData }))
      .toEqual({ kind: "choose", optionId: `bottom:${red.instanceId}` });
    expect(choice(state)).toEqual({ kind: "choose", optionId: `bottom:${red.instanceId}` });
    const bottomed = applyIntent(state, 0, { kind: "choose", optionId: `bottom:${red.instanceId}` });
    expect(bottomed.ok).toBe(true);
    if (!bottomed.ok) return;
    state = bottomed.state;
    expect(choice(state)).toEqual({ kind: "choose", optionId: "pass" });
    const kept = applyIntent(state, 0, { kind: "choose", optionId: "pass" });
    expect(kept.ok).toBe(true);
    if (!kept.ok) return;
    state = kept.state;
    expect(state.players[0]!.banish).toContainEqual(expect.objectContaining({ instanceId: blue.instanceId }));
    expect(state.players[0]!.board).toContainEqual(expect.objectContaining({ cardId: "IAR222" }));
  });

  it("keeps a Gate when its only banished attack cannot be paid for", () => {
    const state = game();
    hand(state, ["MON140"]);
    state.players[0]!.resources = 0;
    state.players[0]!.banish = [{ instanceId: state.nextInstanceId++, cardId: "MON126", owner: 0 }];
    const gate = { instanceId: state.nextInstanceId++, cardId: "IAR222", owner: 0 };
    state.players[0]!.board.push(gate);
    expect(choice(state)).not.toMatchObject({ kind: "activate-ability", sourceInstanceId: gate.instanceId });
  });

  it("keeps a Gate during an opponent's attack when its target is only playable on Levia's turn", () => {
    let state = game();
    state.activePlayer = 1;
    state.priorityPlayer = 1;
    state.players[0]!.actionPoints = 0;
    state.players[1]!.actionPoints = 1;
    hand(state, ["MON140"]);
    state.players[0]!.banish = [{ instanceId: state.nextInstanceId++, cardId: "IAR026", owner: 0 }];
    const gate = { instanceId: state.nextInstanceId++, cardId: "IAR222", owner: 0 };
    state.players[0]!.board.push(gate);
    const toll = { instanceId: state.nextInstanceId++, cardId: "IAR080", owner: 1 };
    state.players[1]!.hand = [toll];
    const attack = legalIntents(state, 1).find((intent) =>
      intent.kind === "play-card" && intent.instanceId === toll.instanceId
    );
    expect(attack).toBeDefined();
    if (!attack) return;
    const played = applyIntent(state, 1, attack);
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    state = played.state;
    for (let step = 0; step < 4 && state.priorityPlayer !== 0; step++) {
      const passed = applyIntent(state, state.priorityPlayer as 0 | 1, { kind: "pass" });
      expect(passed.ok).toBe(true);
      if (!passed.ok) return;
      state = passed.state;
    }
    expect(legalIntents(state, 0)).toContainEqual(expect.objectContaining({
      kind: "activate-ability", sourceInstanceId: gate.instanceId,
    }));
    expect(choice(state)).not.toMatchObject({ kind: "activate-ability", sourceInstanceId: gate.instanceId });
  });

  it("opens a Gate and plays an affordable Blood Debt attack from banish", () => {
    let state = game();
    hand(state, ["MON140"]);
    state.players[0]!.resources = 0;
    const feedingFrenzy = { instanceId: state.nextInstanceId++, cardId: "IAR026", owner: 0 };
    state.players[0]!.banish = [feedingFrenzy];
    const gate = { instanceId: state.nextInstanceId++, cardId: "IAR222", owner: 0 };
    state.players[0]!.board.push(gate);
    const activated = choice(state);
    expect(activated).toMatchObject({
      kind: "activate-ability", sourceInstanceId: gate.instanceId,
      targetCardInstanceId: feedingFrenzy.instanceId,
    });
    let applied = applyIntent(state, 0, activated);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    state = applied.state;
    for (let step = 0; step < 8; step++) {
      const legal = legalIntents(state, 0);
      if (legal.some((intent) => intent.kind === "play-from-zone" && intent.instanceId === feedingFrenzy.instanceId)) break;
      const actor = state.priorityPlayer as 0 | 1;
      applied = applyIntent(state, actor, { kind: "pass" });
      expect(applied.ok).toBe(true);
      if (!applied.ok) return;
      state = applied.state;
    }
    const selected = choice(state);
    expect(selected).toMatchObject({ kind: "play-from-zone", instanceId: feedingFrenzy.instanceId });
  });

  it("creates a Gate before spending the opening-turn attack hand", () => {
    const state = game();
    state.turn = 1;
    hand(state, ["IAR020", "IAR026", "MON140", "ROS218"]);
    const selected = choice(state);
    expect(selected).toMatchObject({ kind: "activate-ability" });
    if (selected.kind !== "activate-ability") return;
    const card = state.players[0]!.hand.find((item) => item.instanceId === selected.sourceInstanceId);
    expect(card?.cardId).toBe("IAR020");
  });

  it("keeps Cleave as pitch for an attack after the opening turn", () => {
    const state = game();
    hand(state, ["IAR022", "IAR026"]);
    const [cleave, frenzy] = state.players[0]!.hand;
    expect(choice(state)).toMatchObject({ kind: "play-card", instanceId: frenzy!.instanceId,
      pitchInstanceIds: [cleave!.instanceId] });
  });

  it("can bank an otherwise unconvertible hand as a Gate", () => {
    const state = game();
    hand(state, ["IAR020"]);
    expect(choice(state)).toMatchObject({ kind: "activate-ability", sourceInstanceId: state.players[0]!.hand[0]!.instanceId });
  });

  it("creates and uses a Gate for a two-cost banished attack backed by a spare blue", () => {
    let state = game();
    hand(state, ["IAR022", "MON140"]);
    const cleave = state.players[0]!.hand[0]!;
    const frenzy = { instanceId: state.nextInstanceId++, cardId: "IAR026", owner: 0 };
    state.players[0]!.banish = [frenzy];
    const setup = choice(state);
    expect(setup).toMatchObject({ kind: "activate-ability", sourceInstanceId: cleave.instanceId });
    state = playAndResolve(state, setup);
    const gate = state.players[0]!.board.find((card) => card.cardId === "IAR222")!;
    const access = choice(state);
    expect(access).toMatchObject({ kind: "activate-ability", sourceInstanceId: gate.instanceId,
      targetCardInstanceId: frenzy.instanceId });
    state = playAndResolve(state, access);
    expect(choice(state)).toMatchObject({ kind: "play-from-zone", instanceId: frenzy.instanceId });
  });

  it("does not create a Gate for a banished two-cost attack without a spare blue", () => {
    const state = game();
    hand(state, ["IAR022", "IAR026"]);
    state.players[0]!.banish = [{ instanceId: state.nextInstanceId++, cardId: "IAR026", owner: 0 }];
    expect(choice(state)).toMatchObject({ kind: "play-card", instanceId: state.players[0]!.hand[1]!.instanceId });
  });

  it.each([["IAR026", "IAR022"], ["IAR026", "IAR009"]])(
    "keeps the Bloodrush macro after resolving it and attacks with %s while holding %s", (...draws) => {
      const state = bloodrushTurn(draws);
      const frenzy = state.players[0]!.hand.find((card) => card.cardId === "IAR026")!;
      state.players[0]!.board.push({ instanceId: state.nextInstanceId++, cardId: "IAR222", owner: 0 });
      state.players[0]!.banish.push({ instanceId: state.nextInstanceId++, cardId: "IAR020", owner: 0 });
      const input = { seat: 0 as const, view: projectStateFor(state, 0), legal: legalIntents(state, 0), cards: cardData };
      expect(input.view.ongoing.some((effect) => cardData[effect.cardId]?.name === "Bloodrush Bellow")).toBe(true);
      expect(chooseLeviaIntentWithTrace(input).macro.goal).toBe("bloodrush");
      expect(chooseLeviaIntent(input)).toMatchObject({ kind: "play-card", instanceId: frenzy.instanceId });
      expect(choice(state)).toMatchObject({ kind: "play-card", instanceId: frenzy.instanceId });
    },
  );

  it("waits for Bloodrush to resolve instead of treating its priority window as an unconvertible hand", () => {
    let state = game();
    hand(state, ["WTR007", "MON140", "IAR020", "IAR020"]);
    const [bellow, blue] = state.players[0]!.hand;
    const play = legalIntents(state, 0).find((intent) => intent.kind === "play-card" &&
      intent.instanceId === bellow!.instanceId && intent.pitchInstanceIds.includes(blue!.instanceId))!;
    const applied = applyIntent(state, 0, play);
    if (!applied.ok) throw new Error(JSON.stringify(applied));
    state = applied.state;
    for (let step = 0; step < 5 && state.priorityPlayer !== 0; step++) {
      const passed = applyIntent(state, state.priorityPlayer, { kind: "pass" });
      if (!passed.ok) throw new Error(JSON.stringify(passed));
      state = passed.state;
    }
    expect(state.stack.length).toBeGreaterThan(0);
    expect(legalIntents(state, 0).some((intent) => intent.kind === "activate-ability" &&
      state.players[0]!.hand.some((card) => card.instanceId === intent.sourceInstanceId && card.cardId === "IAR020"))).toBe(true);
    expect(choice(state)).toEqual({ kind: "pass" });
  });

  it("opens a Gate during Bloodrush when its go-again attack enables a second attack", () => {
    let state = bloodrushTurn(["IAR020", "MON140", "MON140"]);
    const frenzy = { instanceId: state.nextInstanceId++, cardId: "IAR026", owner: 0 };
    state.players[0]!.banish.push(frenzy);
    const gate = { instanceId: state.nextInstanceId++, cardId: "IAR222", owner: 0 };
    state.players[0]!.board.push(gate);
    const selected = choice(state);
    expect(selected).toMatchObject({ kind: "activate-ability", sourceInstanceId: gate.instanceId,
      targetCardInstanceId: frenzy.instanceId });
    state = playAndResolve(state, selected);
    expect(choice(state)).toMatchObject({ kind: "play-from-zone", instanceId: frenzy.instanceId });
  });

  it("destroys Savage Sash to turn one blue into two six-power attacks", () => {
    let state = game();
    hand(state, ["IAR026", "IAR020", "MON140"]);
    state.players[0]!.flags.banishedSixPlusThisTurn = true;
    const sash = { instanceId: state.nextInstanceId++, cardId: "AKO004", owner: 0 };
    state.players[0]!.equipment.chest = sash;
    const selected = choice(state);
    expect(selected).toMatchObject({ kind: "activate-ability", sourceInstanceId: sash.instanceId });
    state = playAndResolve(state, selected);
    const frenzy = state.players[0]!.hand.find((card) => card.cardId === "IAR026")!;
    expect(choice(state)).toMatchObject({ kind: "play-card", instanceId: frenzy.instanceId });
  });

  it("preserves Savage Sash when the attacks are already affordable", () => {
    const state = game();
    hand(state, ["IAR026", "IAR020", "MON140"]);
    state.players[0]!.resources = 4;
    state.players[0]!.flags.banishedSixPlusThisTurn = true;
    const sash = { instanceId: state.nextInstanceId++, cardId: "AKO004", owner: 0 };
    state.players[0]!.equipment.chest = sash;
    expect(choice(state)).not.toMatchObject({ kind: "activate-ability", sourceInstanceId: sash.instanceId });
  });

  it.each([0, 1])("blocks with fresh Sash before its planned sacrifice, preserving worn Sash (counters=%i)", (defCounters) => {
    let state = game();
    hand(state, ["IAR026", "IAR020", "MON140"]);
    const sash = { instanceId: state.nextInstanceId++, cardId: "AKO004", owner: 0, defCounters };
    state.players[0]!.equipment.chest = sash;
    state = defending(state);
    const selected = choice(state);
    expect(["stage-defenders", "defend"]).toContain(selected.kind);
    if (selected.kind !== "stage-defenders" && selected.kind !== "defend") return;
    expect(selected.instanceIds.includes(sash.instanceId)).toBe(defCounters === 0);
    if (defCounters === 0) expect(selected.instanceIds).toEqual([sash.instanceId]);
  });

  it("preserves fresh Sash on defense when the remaining hand has no discounted second attack", () => {
    let state = game();
    hand(state, ["IAR026", "MON140"]);
    const sash = { instanceId: state.nextInstanceId++, cardId: "AKO004", owner: 0 };
    state.players[0]!.equipment.chest = sash;
    state = defending(state);
    const selected = choice(state);
    expect(["stage-defenders", "defend"]).toContain(selected.kind);
    if (selected.kind === "stage-defenders" || selected.kind === "defend") {
      expect(selected.instanceIds).not.toContain(sash.instanceId);
    }
  });

  it("uses Consuming Lash only when paying for it preserves two affordable attacks needing go again", () => {
    const state = game();
    hand(state, ["IAR009", "IAR020", "IAR020", "MON140"]);
    state.players[0]!.resources = 2;
    const lash = state.players[0]!.hand[0]!;
    expect(choice(state)).toMatchObject({ kind: "activate-ability", sourceInstanceId: lash.instanceId });
    state.players[0]!.resources = 0;
    expect(choice(state)).not.toMatchObject({ kind: "activate-ability", sourceInstanceId: lash.instanceId });
  });

  it("converts a resolved Bloodrush into two buffed Brute attacks using Savage Sash", () => {
    let state = bloodrushTurn(["IAR026", "IAR026", "MON140", "MON140"]);
    const sash = { instanceId: state.nextInstanceId++, cardId: "AKO004", owner: 0 };
    state.players[0]!.equipment.chest = sash;
    expect(state.players[0]!.resources).toBe(2);
    const selected = choice(state);
    expect(selected).toMatchObject({ kind: "activate-ability", sourceInstanceId: sash.instanceId });
    state = playAndResolve(state, selected);
    const attacks: number[] = [];
    for (let step = 0; step < 60 && attacks.length < 2 && state.turn === 3; step++) {
      const actor = state.priorityPlayer as 0 | 1;
      const legal = legalIntents(state, actor);
      const intent = actor === 0 ? choice(state) : legal.find((candidate) => candidate.kind === "pass")
        ?? legal.find((candidate) => candidate.kind === "defend" && candidate.instanceIds.length === 0)!;
      const applied = applyIntent(state, actor, intent);
      if (!applied.ok) throw new Error(JSON.stringify(applied));
      state = applied.state;
      if (actor === 0 && intent.kind === "play-card") attacks.push(intent.instanceId);
    }
    expect(attacks).toHaveLength(2);
    expect(new Set(attacks).size).toBe(2);
    expect(projectStateFor(state, 0).chain.map((link) => link.attackValue)).toEqual([8, 8]);
    expect(state.players[0]!.resources).toBe(0);
  });

  it("starts a Bloodrush turn when it has an attack and a blue", () => {
    const state = game();
    hand(state, ["WTR007", "IAR026", "MON140", "PEN322"]);
    const selected = choice(state);
    expect(selected.kind).toBe("play-card");
    if (selected.kind !== "play-card") return;
    const card = state.players[0]!.hand.find((item) => item.instanceId === selected.instanceId);
    expect(card?.cardId).toBe("WTR007");
  });

  it("uses an attack instead of early Hexagore self-damage at low life", () => {
    const state = game();
    state.players[0]!.life = 7;
    hand(state, ["IAR017", "PEN322", "MON140", "IAR014"]);
    const selected = choice(state);
    const hexagore = state.players[0]!.weapons.find((weapon) => weapon.cardId === "MON121");
    expect(selected).not.toMatchObject({ kind: "activate-ability", sourceInstanceId: hexagore?.instanceId });
  });

  it("uses a lethal attack line without unnecessary Hexagore self-damage", () => {
    const state = game();
    state.players[0]!.life = 7;
    state.players[1]!.life = 3;
    hand(state, ["PEN322", "MON140", "DTD107", "IAR214"]);
    const hexagore = state.players[0]!.weapons.find((weapon) => weapon.cardId === "MON121")!;
    expect(choice(state)).not.toMatchObject({ kind: "activate-ability", sourceInstanceId: hexagore.instanceId });
  });

  it("returns a legal move from an awkward blue hand", () => {
    const state = game();
    hand(state, ["MON140", "PEN322", "DTD107", "IAR214"]);
    choice(state);
  });

  it("stops a visible Snatch on-hit while keeping its Bloodrush pitch", () => {
    let state = game();
    state.activePlayer = 1;
    state.priorityPlayer = 1;
    state.players[1]!.actionPoints = 1;
    state.players[0]!.actionPoints = 0;
    state.players[0]!.life = 7;
    hand(state, ["IAR218", "WTR007", "IAR026", "MON140"]);
    const dam = state.players[0]!.hand[0]!;
    const snatch = { instanceId: state.nextInstanceId++, cardId: "ASB012", owner: 1 };
    state.players[1]!.hand = [snatch];
    const attack = legalIntents(state, 1).find((intent) =>
      intent.kind === "play-card" && intent.instanceId === snatch.instanceId
    )!;
    expect(attack).toBeDefined();
    let result = applyIntent(state, 1, attack);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    state = result.state;
    for (let step = 0; step < 8; step++) {
      const legal = legalIntents(state, 0);
      if (state.priorityPlayer === 0 && legal.some((intent) => intent.kind === "stage-defenders")) break;
      const actor = state.priorityPlayer as 0 | 1;
      result = applyIntent(state, actor, { kind: "pass" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      state = result.state;
    }
    // Legal intents enumerate single-card stages; combined stages are still
    // valid client intents, so check them through the rules engine instead.
    const selected = chooseLeviaIntent({
      seat: 0, view: projectStateFor(state, 0), legal: legalIntents(state, 0), cards: cardData, state,
    });
    expect(selected).toMatchObject({ kind: "stage-defenders" });
    if (selected.kind !== "stage-defenders") return;
    expect(applyIntent(state, 0, selected).ok).toBe(true);
    // Any four points of defense stop the hit. Dam the Shadowake is also the
    // pitch that funds next turn's Bloodrush Bellow, so an exact armor block
    // that keeps the whole hand is preferred over spending it.
    const me = projectStateFor(state, 0).players[0];
    const blockers = [...me.hand, ...Object.values(me.equipment).flatMap((card) => card ? [card] : [])]
      .filter((card) => selected.instanceIds.includes(card.instanceId));
    const defense = blockers.reduce((sum, card) => sum + (card.defense ?? cardData[card.cardId]?.defense ?? 0), 0);
    expect(defense).toBeGreaterThanOrEqual(4);
    expect(selected.instanceIds).not.toContain(dam.instanceId);
  });

  it("plays through action, response, and choice windows with legal intents", () => {
    let state = game();
    const trace: string[] = [];
    for (let step = 0; step < 100 && state.phase !== "game-over"; step++) {
      const seat = state.priorityPlayer as 0 | 1;
      const legal = legalIntents(state, seat);
      const intent = seat === 0
        ? chooseLeviaIntent({ seat, view: projectStateFor(state, seat), legal, cards: cardData, state })
        : legal.find((candidate) => candidate.kind === "pass")
          ?? legal.find((candidate) => candidate.kind !== "concede") ?? legal[0]!;
      trace.push(`${state.turn}:${seat}:${JSON.stringify(intent)}`);
      expect(legal, `step ${step}`).toContainEqual(intent);
      const result = applyIntent(state, seat, intent);
      expect(result.ok, `step ${step}: ${JSON.stringify(intent)}`).toBe(true);
      if (!result.ok) break;
      state = result.state;
    }
    expect(trace.some((entry) => entry.includes('"kind":"activate-ability"'))).toBe(true);
    expect(trace.some((entry) => entry.includes('"kind":"play-card"') || entry.includes('"kind":"play-from-zone"'))).toBe(true);
    expect(trace.some((entry) => entry.includes('"kind":"pass"'))).toBe(true);
  });

  describe("Hex Gauntlet", () => {
    function withHex(state: ReturnType<typeof game>) {
      const hex = { instanceId: state.nextInstanceId++, cardId: "IAR004", owner: 0 };
      state.players[0]!.equipment.arms = hex;
      return hex;
    }

    function banishDebt(state: ReturnType<typeof game>, count: number) {
      for (let index = 0; index < count; index++) {
        state.players[0]!.banish.push({ instanceId: state.nextInstanceId++, cardId: "IAR028", owner: 0 });
      }
    }

    it("is not spent at the start of a turn with attacks available", () => {
      const state = game();
      const hex = withHex(state);
      banishDebt(state, 4);
      hand(state, ["IAR026", "IAR026", "MON140", "MON140"]);
      expect(choice(state)).not.toMatchObject({ kind: "activate-ability", sourceInstanceId: hex.instanceId });
    });

    it("is not spent in a priority window during a non-Frenzy attack", () => {
      let state = game();
      const hex = withHex(state);
      banishDebt(state, 4);
      hand(state, ["WTR203", "IAR026", "MON140"]);
      const blow = state.players[0]!.hand[0]!;
      const play = legalIntents(state, 0).find((intent) => intent.kind === "play-card" &&
        intent.instanceId === blow.instanceId)!;
      let applied = applyIntent(state, 0, play);
      if (!applied.ok) throw new Error(JSON.stringify(applied));
      state = applied.state;
      for (let step = 0; step < 10; step++) {
        const view = projectStateFor(state, 0);
        if (state.priorityPlayer === 0 && view.stack.length === 0 && view.chain.some((link) => !link.resolved && !link.onStack)) break;
        applied = applyIntent(state, state.priorityPlayer, { kind: "pass" });
        if (!applied.ok) throw new Error(JSON.stringify(applied));
        state = applied.state;
      }
      expect(choice(state)).not.toMatchObject({ kind: "activate-ability", sourceInstanceId: hex.instanceId });
    });

    it("grants Feeding Frenzy go again after its own banish misses and another attack follows", () => {
      let state = game();
      const hex = withHex(state);
      hand(state, ["IAR026", "IAR026", "MON140", "MON140"]);
      state.players[0]!.deck = [{ instanceId: state.nextInstanceId++, cardId: "WTR203", owner: 0 }];
      const [frenzy, , blue] = state.players[0]!.hand;
      const play = legalIntents(state, 0).find((intent) => intent.kind === "play-card" &&
        intent.instanceId === frenzy!.instanceId && intent.pitchInstanceIds.includes(blue!.instanceId))!;
      let applied = applyIntent(state, 0, play);
      if (!applied.ok) throw new Error(JSON.stringify(applied));
      state = applied.state;
      for (let step = 0; step < 10; step++) {
        const view = projectStateFor(state, 0);
        if (state.priorityPlayer === 0 && view.stack.length === 0 && view.chain.some((link) => !link.resolved && !link.onStack)) break;
        applied = applyIntent(state, state.priorityPlayer, { kind: "pass" });
        if (!applied.ok) throw new Error(JSON.stringify(applied));
        state = applied.state;
      }
      expect(state.players[0]!.flags.banishedSixPlusThisTurn).not.toBe(true);
      expect(choice(state)).toMatchObject({ kind: "activate-ability", sourceInstanceId: hex.instanceId });
    });

    it("suppresses heavy blood debt once nothing else is left to do", () => {
      const state = game();
      const hex = withHex(state);
      banishDebt(state, 4);
      hand(state, []);
      state.players[0]!.actionPoints = 0;
      expect(choice(state)).toMatchObject({ kind: "activate-ability", sourceInstanceId: hex.instanceId });
    });

    it("keeps the Gauntlet for later when blood debt is light and life is healthy", () => {
      const state = game();
      const hex = withHex(state);
      banishDebt(state, 1);
      hand(state, []);
      state.players[0]!.actionPoints = 0;
      expect(choice(state)).not.toMatchObject({ kind: "activate-ability", sourceInstanceId: hex.instanceId });
    });

    it("is not spent once a 6 power card was already banished this turn", () => {
      const state = game();
      const hex = withHex(state);
      banishDebt(state, 4);
      hand(state, []);
      state.players[0]!.actionPoints = 0;
      state.players[0]!.flags.banishedSixPlusThisTurn = true;
      expect(choice(state)).not.toMatchObject({ kind: "activate-ability", sourceInstanceId: hex.instanceId });
    });
  });

  describe("Gates, Blood Debt, and matchup play", () => {
    const heroId = (name: string) => Object.values(cardData).find((card) => card.name === name)!.id;
    const input = (state: ReturnType<typeof game>, seat: 0 | 1 = 0) => ({
      seat, view: projectStateFor(state, seat), legal: legalIntents(state, seat), cards: cardData, state,
    });

    /** Drive the opponent's attack until Levia, having not blocked, holds the defense-reaction window. */
    function reactionWindow(cardIds: string[]) {
      let state = game();
      state.activePlayer = 1;
      state.priorityPlayer = 1;
      state.players[0]!.actionPoints = 0;
      state.players[1]!.actionPoints = 1;
      state.players[0]!.equipment = {};
      state.players[0]!.weapons = [];
      hand(state, cardIds);
      const attack = { instanceId: state.nextInstanceId++, cardId: "WTR203", owner: 1 };
      state.players[1]!.hand = [attack];
      const play = legalIntents(state, 1).find((intent) => intent.kind === "play-card" && intent.instanceId === attack.instanceId)!;
      let applied = applyIntent(state, 1, play);
      if (!applied.ok) throw new Error(JSON.stringify(applied));
      state = applied.state;
      for (let step = 0; step < 12; step++) {
        if (state.priorityPlayer === 0 && state.pendingDecision?.kind === "defense-reaction") return state;
        const seat = state.priorityPlayer as 0 | 1;
        const intent: GameIntent = seat === 0 && state.pendingDecision?.kind === "defend"
          ? { kind: "defend", instanceIds: [] }
          : { kind: "pass" };
        applied = applyIntent(state, seat, intent);
        if (!applied.ok) throw new Error(JSON.stringify(applied));
        state = applied.state;
      }
      throw new Error("Attack did not reach the defense-reaction window");
    }

    function passUntil(state: ReturnType<typeof game>, done: (state: ReturnType<typeof game>) => boolean) {
      for (let step = 0; step < 40; step++) {
        if (done(state)) return state;
        const seat = (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1;
        const legal = legalIntents(state, seat);
        const intent = legal.find((candidate) => candidate.kind === "pass") ??
          legal.find((candidate) => candidate.kind === "choose" && candidate.optionId === "no") ??
          legal.find((candidate) => candidate.kind === "defend") ??
          legal.find((candidate) => candidate.kind !== "concede" && candidate.kind !== "offer-draw")!;
        const applied = applyIntent(state, seat, intent);
        if (!applied.ok) throw new Error(JSON.stringify(applied));
        state = applied.state;
      }
      throw new Error("Condition was not reached");
    }

    it("attacks with Fallen Herald on its own turn instead of banishing it for nothing", () => {
      const state = game();
      hand(state, ["IAR165", "MON140"]);
      const [herald, blue] = state.players[0]!.hand;
      expect(choice(state)).toEqual(expect.objectContaining({
        kind: "play-card", instanceId: herald!.instanceId, pitchInstanceIds: [blue!.instanceId],
      }));
    });

    it.each([
      ["a redundant second copy", ["IAR165", "IAR165", "MON140"], 40],
      ["lethal damage", ["IAR165", "MON140", "IAR026"], 4],
    ])("prevents an unblocked attack with Fallen Herald against %s", (_case, cardIds, life) => {
      const state = reactionWindow(cardIds);
      state.players[0]!.life = life;
      const heralds = state.players[0]!.hand.filter((card) => card.cardId === "IAR165").map((card) => card.instanceId);
      const selected = choice(state);
      expect(selected.kind).toBe("activate-ability");
      if (selected.kind === "activate-ability") expect(heralds).toContain(selected.sourceInstanceId);
    });

    it("keeps Fallen Herald when it is next turn's only attack", () => {
      const state = reactionWindow(["IAR165", "ROS218", "IAR214"]);
      const herald = state.players[0]!.hand[0]!;
      expect(choice(state)).not.toMatchObject({ kind: "activate-ability", sourceInstanceId: herald.instanceId });
    });

    it("counts Gate-reachable banished attacks in next turn's hand value", () => {
      const state = game();
      state.activePlayer = 1;
      state.players[0]!.weapons = [];
      hand(state, ["MON140"]);
      state.players[0]!.banish = [{ instanceId: state.nextInstanceId++, cardId: "IAR026", owner: 0 }];
      const blue = state.players[0]!.hand;
      const without = handDamage(blue, input(state), leviaSolverRules);
      expect(leviaEngineValue(input(state))).toBe(0);
      state.players[0]!.board.push({ instanceId: state.nextInstanceId++, cardId: "IAR222", owner: 0 });
      expect(handDamage(blue, input(state), leviaSolverRules)).toBeGreaterThanOrEqual(without + 6);
      expect(leviaEngineValue(input(state))).toBeGreaterThan(0);
      state.players[0]!.banish[0]!.faceDown = true;
      expect(leviaEngineValue(input(state))).toBe(0);
    });

    it("trades a held six-power Cleave for another Gate once the turn's plays are done", () => {
      const state = game();
      state.players[0]!.resources = 0;
      state.players[0]!.actionPoints = 0;
      state.players[0]!.board.push({ instanceId: state.nextInstanceId++, cardId: "IAR222", owner: 0 });
      state.players[0]!.banish = [{ instanceId: state.nextInstanceId++, cardId: "IAR026", owner: 0 }];
      state.players[0]!.arsenal = [{ instanceId: state.nextInstanceId++, cardId: "MON140", owner: 0, faceDown: true }];
      hand(state, ["IAR020"]);
      const cleave = state.players[0]!.hand[0]!;
      expect(choice(state)).toMatchObject({ kind: "activate-ability", sourceInstanceId: cleave.instanceId });
    });

    it("tutors Beast Within with Call to the Grave", () => {
      let state = game();
      hand(state, ["ROS218", "IAR026"]);
      const call = state.players[0]!.hand[0]!;
      const play = legalIntents(state, 0).find((intent) => intent.kind === "play-card" && intent.instanceId === call.instanceId)!;
      expect(play).toBeDefined();
      const applied = applyIntent(state, 0, play);
      if (!applied.ok) throw new Error(JSON.stringify(applied));
      state = passUntil(applied.state, (current) =>
        current.pendingDecision?.promptMessage?.id === "card.agb.deck.card.graveyard");
      const selected = choice(state);
      expect(selected.kind).toBe("choose");
      if (selected.kind !== "choose") return;
      expect(state.players[0]!.deck.find((card) => card.instanceId === Number(selected.optionId))?.cardId).toBe("CRU007");
    });

    it.each([
      [["IAR026", "PEN322"], "IAR026"],
      [["PEN322"], "no"],
    ])("keeps Blasmophet only with a Blood Debt banish from %j", (cardIds, expected) => {
      let state = game();
      state.players[0]!.board.push({ instanceId: state.nextInstanceId++, cardId: "IAR221", owner: 0 });
      state.players[0]!.actionPoints = 0;
      hand(state, cardIds);
      state = passUntil(state, (current) =>
        current.pendingDecision?.promptMessage?.id === "card.iar.hand.banish.optional");
      const selected = choice(state);
      expect(selected.kind).toBe("choose");
      if (selected.kind !== "choose") return;
      const card = state.players[0]!.hand.find((held) => held.instanceId === Number(selected.optionId));
      expect(card?.cardId ?? selected.optionId).toBe(expected);
    });

    it.each([
      ["Dorinthea Ironsong", false, "yes"],
      ["Arakni, Marionette", false, "no"],
      ["Arakni, Marionette", true, "yes"],
    ])("transforms into Consumed against %s (Engulfing banished: %s): %s", (opponent, engulfing, expected) => {
      let state = game();
      state.players[1]!.heroCardId = heroId(opponent);
      state.players[0]!.life = 14;
      state.players[0]!.actionPoints = 0;
      state.players[0]!.banish = [{ instanceId: state.nextInstanceId++, cardId: "MON126", owner: 0 }];
      if (engulfing) state.players[0]!.banish.push({ instanceId: state.nextInstanceId++, cardId: "PEN194", owner: 0 });
      hand(state, ["MON140"]);
      state = passUntil(state, (current) => current.pendingDecision?.promptMessage?.id === "card.common.levia.transform");
      expect(choice(state)).toEqual({ kind: "choose", optionId: expected });
    });

    it("discounts a carried Gate by aura removal in the opponent's decklist", () => {
      const state = game();
      state.players[0]!.board.push({ instanceId: state.nextInstanceId++, cardId: "IAR222", owner: 0 });
      state.players[0]!.banish = [{ instanceId: state.nextInstanceId++, cardId: "IAR026", owner: 0 }];
      const withList = (opponent: string[]) => leviaEngineValue({ ...input(state), decklists: { own: [], opponent } });
      const filler = Array.from({ length: 30 }, () => "WTR203");
      const unknown = leviaEngineValue(input(state));
      expect(withList(filler)).toBe(unknown);
      expect(withList([...filler, "IAR228", "IAR228", "IAR228"])).toBeLessThan(unknown);
    });
  });
});
