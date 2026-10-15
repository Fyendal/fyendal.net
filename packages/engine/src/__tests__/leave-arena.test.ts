import { describe, expect, it } from "vitest";
import { engineRuntime } from "../engineRuntime.js";
import type { TriggerEventContext } from "../index.js";
import type { GameStateInternal } from "../runtimeState.js";
import type { CardInstance } from "../state.js";
import { makeGame, player } from "./fixtures.js";

/** Give `cardId` a self leave-arena trigger whose condition records each event. */
function recordLeaves(s: GameStateInternal, cardId: string): (TriggerEventContext | undefined)[] {
  const events: (TriggerEventContext | undefined)[] = [];
  s.scriptsRef = {
    ...s.scriptsRef,
    [cardId]: {
      triggers: [{
        event: "card-left-arena",
        sourceZone: "self",
        label: "Left the arena",
        condition: (_ctx, _card, event) => {
          events.push(event);
          return false;
        },
        effect: () => {},
      }],
    },
  };
  return events;
}

function attackWith(s: GameStateInternal, seat: number, cardId: string): CardInstance {
  const card: CardInstance = { instanceId: s.nextInstanceId++, cardId, owner: seat };
  s.chain.push({
    attacker: seat,
    attackingCard: card,
    attackCardType: "action",
    defendingCards: [],
    defendingEquipment: [],
    reactions: [],
    goAgain: false,
    damage: 0,
    hit: false,
    resolved: false,
    flags: {},
  });
  return card;
}

describe("cards returned to hand leave the arena", () => {
  it("moveToHand on an attacking action card ends the attack and raises leave-arena as attacking", () => {
    const s = makeGame();
    const events = recordLeaves(s, "ATK4");
    const attack = attackWith(s, 0, "ATK4");

    expect(engineRuntime.makeCtx(s, 1, player(s, 1).hero).moveToHand(attack.instanceId)).toBe(true);

    expect(player(s, 0).hand.some((card) => card.instanceId === attack.instanceId)).toBe(true);
    expect(s.chain[0]!.flags.attackGone).toBe(true);
    expect(s.chain[0]!.attackingCard).not.toBe(attack);
    expect(events).toEqual([expect.objectContaining({ to: "hand", combatRole: "attacking" })]);
  });

  it("returnSelfToHand on a permanent raises leave-arena from its arena zone", () => {
    const s = makeGame();
    const events = recordLeaves(s, "AURA");
    const aura: CardInstance = { instanceId: s.nextInstanceId++, cardId: "AURA", owner: 0 };
    player(s, 0).board.push(aura);

    expect(engineRuntime.makeCtx(s, 0, aura).returnSelfToHand()).toBe(true);

    expect(player(s, 0).board).toEqual([]);
    expect(player(s, 0).hand.some((card) => card.instanceId === aura.instanceId)).toBe(true);
    expect(events).toEqual([expect.objectContaining({ to: "hand" })]);
    expect(events[0]?.combatRole).toBeUndefined();
  });

  it("returnSelfToHand on a token permanent makes it cease to exist", () => {
    const s = makeGame();
    const events = recordLeaves(s, "RUNECHANT");
    const token: CardInstance = { instanceId: s.nextInstanceId++, cardId: "RUNECHANT", owner: 0 };
    player(s, 0).board.push(token);

    expect(engineRuntime.makeCtx(s, 0, token).returnSelfToHand()).toBe(true);

    expect(player(s, 0).board).toEqual([]);
    expect(player(s, 0).hand.some((card) => card.instanceId === token.instanceId)).toBe(false);
    expect(events).toEqual([expect.objectContaining({ to: "cease-to-exist" })]);
  });

  it("returnSelfToHand on a defending card raises leave-arena as defending", () => {
    const s = makeGame();
    const events = recordLeaves(s, "BLOCK3");
    attackWith(s, 0, "ATK4");
    const blocker: CardInstance = { instanceId: s.nextInstanceId++, cardId: "BLOCK3", owner: 1 };
    s.chain[0]!.defendingCards.push(blocker);

    expect(engineRuntime.makeCtx(s, 1, blocker).returnSelfToHand()).toBe(true);

    expect(s.chain[0]!.defendingCards).toEqual([]);
    expect(player(s, 1).hand.some((card) => card.instanceId === blocker.instanceId)).toBe(true);
    expect(events).toEqual([expect.objectContaining({ to: "hand", combatRole: "defending" })]);
  });
});
