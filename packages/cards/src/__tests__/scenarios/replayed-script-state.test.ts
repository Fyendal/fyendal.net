import { describe, expect, it } from "vitest";
import { printingId, scenario } from "../harness.js";

const NO_EQUIPMENT = { head: null, chest: null, arms: null, legs: null } as const;
const ATTACK = "mutually assured destruction|1";
const REACTION = "lunging press|3";
const INSTANT = "oasis respite|1";

function seedStaleState(game: ReturnType<typeof scenario>, seat: number, key: string): number {
  const cardId = printingId(key);
  const card = game.state.players[seat]!.hand.find((candidate) => candidate.cardId === cardId)!;
  card.scriptState = { stale: 1 };
  return card.instanceId;
}

function scriptStateOf(game: ReturnType<typeof scenario>, instanceId: number) {
  const onChain = game.state.chain.map((link) => link.attackingCard);
  const onStack = game.state.stack.flatMap((layer) => ("card" in layer && layer.card ? [layer.card] : []));
  const card = [...onChain, ...onStack].find((candidate) => candidate.instanceId === instanceId);
  expect(card).toBeDefined();
  return card!.scriptState;
}

describe("script state of a card being played", () => {
  it("starts fresh when played in the action phase", () => {
    const game = scenario({ seats: [
      { hero: "rhinar", hand: [ATTACK], resources: 2, weapons: [], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
    ] });
    const id = seedStaleState(game, 0, ATTACK);

    game.play(ATTACK);

    expect(scriptStateOf(game, id)?.stale).toBeUndefined();
  });

  it("starts fresh when played as a reaction", () => {
    const game = scenario({ seats: [
      { hero: "rhinar", hand: [ATTACK, REACTION], resources: 2, weapons: [], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
    ] });
    const id = seedStaleState(game, 0, REACTION);

    game.play(ATTACK).blockWith().react(REACTION, { settle: false });

    expect(scriptStateOf(game, id)?.stale).toBeUndefined();
  });

  it("starts fresh when played as an instant in a layer window", () => {
    const game = scenario({ seats: [
      { hero: "rhinar", hand: ["humble entrance|3"], weapons: [], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", hand: [INSTANT, "raging onslaught|3"], weapons: [], equipment: NO_EQUIPMENT },
    ] });
    const id = seedStaleState(game, 1, INSTANT);

    game.play("humble entrance|3").passPriority()
      .react(INSTANT, { pitch: ["raging onslaught|3"], settle: false });

    expect(game.stackLabels()).toContain("Oasis Respite");
    expect(scriptStateOf(game, id)?.stale).toBeUndefined();
  });
});
