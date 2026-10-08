import { cardData, decklists, precon, scripts } from "@fyendal/cards";
import { applyIntent, createGame, legalIntents, projectStateFor } from "@fyendal/engine";
import type { Decklist, GameIntent } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import { chooseLeviaIntent } from "./levia-policy.js";
import { leviaPresentationFor } from "./sideboard.js";

const opponent = decklists.dorinthea;

function game() {
  const heroId = precon("bot-levia-gates")!.pool.heroId;
  const levia: Decklist = { heroId, ...leviaPresentationFor(opponent) };
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

  it("accepts survivable Hexagore self-damage for a lethal attack", () => {
    const state = game();
    state.players[0]!.life = 7;
    state.players[1]!.life = 3;
    hand(state, ["PEN322", "MON140", "DTD107", "IAR214"]);
    const hexagore = state.players[0]!.weapons.find((weapon) => weapon.cardId === "MON121")!;
    expect(choice(state)).toMatchObject({ kind: "activate-ability", sourceInstanceId: hexagore.instanceId });
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
    expect(trace.some((entry) => entry.includes('"kind":"play-card"'))).toBe(true);
    expect(trace.some((entry) => entry.includes('"kind":"pass"'))).toBe(true);
  });
});
