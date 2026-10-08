import { cardData, decklists, precon, scripts, validatePresentation } from "@fyendal/cards";
import { applyIntent, createGame, legalIntents, projectStateFor } from "@fyendal/engine";
import type { Decklist, GameIntent } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import { chooseLeviaIntent, chooseLeviaIntentWithTrace } from "./levia-policy.js";
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

  it("keeps the guide's cut twin hero in inventory and redeems at critical life", () => {
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
    hand(state, ["IAR020", "IAR026", "MON140", "ROS218"]);
    const decide = () => chooseLeviaIntentWithTrace({
      seat: 0, view: projectStateFor(state, 0), legal: legalIntents(state, 0), cards: cardData, state,
    });
    expect(decide().macro.goal).toBe("engine");
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

  it("creates a Gate before spending the attack hand", () => {
    const state = game();
    hand(state, ["IAR020", "IAR026", "MON140", "ROS218"]);
    const selected = choice(state);
    expect(selected).toMatchObject({ kind: "activate-ability" });
    if (selected.kind !== "activate-ability") return;
    const card = state.players[0]!.hand.find((item) => item.instanceId === selected.sourceInstanceId);
    expect(card?.cardId).toBe("IAR020");
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

  it("blocks a visible Snatch on-hit with a four-block card", () => {
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
    const selected = choice(state);
    expect(selected).toMatchObject({ kind: "stage-defenders" });
    if (selected.kind === "stage-defenders") expect(selected.instanceIds).toContain(dam.instanceId);
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
});
