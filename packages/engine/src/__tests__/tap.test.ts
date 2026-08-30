import { engineRuntime } from "../engineRuntime.js";
import type { GameStateInternal } from "../runtimeState.js";
import { describe, expect, it } from "vitest";
import type { GameIntent } from "@fyendal/shared";
import { applyIntent, legalIntents } from "../index.js";
import { tapPermanent } from "../cardLifecycle.js";

import { giveCard, makeGame, player } from "./fixtures.js";

/** Play an instant from hand and pass it to resolution. */
function playInstant(s: GameStateInternal, seat: number, instanceId: number): GameStateInternal {
  let r = applyIntent(s, seat, { kind: "play-card", instanceId, pitchInstanceIds: [] });
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(r.error);
  let cur = r.state;
  // both players pass the stack window(s) until the layer resolves
  for (let i = 0; i < 4 && cur.pendingDecision; i++) {
    const who = cur.pendingDecision.player;
    r = applyIntent(cur, who, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    cur = r.state;
  }
  return cur;
}

/** End the active player's turn (pass + arsenal decision). */
function endTurn(s: GameStateInternal): GameStateInternal {
  const seat = s.activePlayer;
  let r = applyIntent(s, seat, { kind: "pass" });
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(r.error);
  let cur = r.state;
  if (cur.pendingDecision?.kind === "arsenal") {
    r = applyIntent(cur, seat, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    cur = r.state;
  }
  return cur;
}

function idolActivation(s: GameStateInternal, seat: number, idolId: number): GameIntent | undefined {
  return legalIntents(s, seat).find(
    (i) => i.kind === "activate-ability" && i.sourceInstanceId === idolId,
  );
}

describe("tap / untap", () => {
  it("an item instant settles to the board untapped; its {t} ability taps itself and can't be reused", () => {
    let s = makeGame(7);
    const idol = giveCard(s, 0, "IDOL");
    s = playInstant(s, 0, idol);
    const onBoard = player(s, 0).board.find((c) => c.cardId === "IDOL");
    expect(onBoard).toBeDefined();
    expect(onBoard!.tapped).toBeUndefined(); // permanents enter untapped

    const intent = idolActivation(s, 0, onBoard!.instanceId);
    expect(intent).toBeDefined();
    let r = applyIntent(s, 0, intent as GameIntent);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    s = r.state;
    for (let i = 0; i < 2; i++) {
      r = applyIntent(s, s.priorityPlayer, { kind: "pass" });
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error(r.error);
      s = r.state;
    }
    expect(player(s, 0).life).toBe(21);
    expect(player(s, 0).board[0]!.tapped).toBe(true);

    // no enumerated intent, and a forced attempt errors
    expect(idolActivation(s, 0, onBoard!.instanceId)).toBeUndefined();
    r = applyIntent(s, 0, {
      kind: "activate-ability",
      sourceInstanceId: onBoard!.instanceId,
      pitchInstanceIds: [],
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("should fail");
    expect(r.error).toMatch(/already tapped/);
  });

  it("the turn player untaps in their end phase (APUD); the non-turn player does not", () => {
    let s = makeGame(8);
    // seat 0 taps seat 1's hero via a resolving instant
    const hex = giveCard(s, 0, "HEX");
    s = playInstant(s, 0, hex);
    expect(player(s, 0).flags.tapOk).toBe(true);
    expect(player(s, 1).hero.tapped).toBe(true);

    // seat 0 ends their turn: only seat 0's permanents would untap
    s = endTurn(s);
    expect(s.activePlayer).toBe(1);
    expect(player(s, 1).hero.tapped).toBe(true); // still tapped on their own turn

    // seat 1 ends their turn: now their permanents untap
    s = endTurn(s);
    expect(s.activePlayer).toBe(0);
    expect(player(s, 1).hero.tapped).toBeUndefined();
  });

  it("ctx.untap untaps a tapped permanent and re-enables its {t} ability; it fails on an untapped one", () => {
    let s = makeGame(9);
    const idol = giveCard(s, 0, "IDOL");
    s = playInstant(s, 0, idol);
    const idolId = player(s, 0).board[0]!.instanceId;
    const r = applyIntent(s, 0, idolActivation(s, 0, idolId) as GameIntent);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    s = r.state;
    expect(player(s, 0).board[0]!.tapped).toBe(true);

    const twiddle = giveCard(s, 0, "TWIDDLE");
    s = playInstant(s, 0, twiddle);
    expect(player(s, 0).flags.untapOk).toBe(true);
    expect(player(s, 0).board[0]!.tapped).toBeUndefined();
    expect(idolActivation(s, 0, idolId)).toBeDefined(); // usable again

    // untapping an already-untapped permanent fails
    const twiddle2 = giveCard(s, 0, "TWIDDLE");
    s = playInstant(s, 0, twiddle2);
    expect(player(s, 0).flags.untapOk).toBe(false);
  });

  it("tapPermanent fails on non-permanents and on cards already in the requested state", () => {
    const s = makeGame(10);
    const handCard = player(s, 0).hand[0]!;
    expect(tapPermanent(s, engineRuntime, handCard.instanceId, true)).toBe(false); // not in the arena
    const heroId = player(s, 1).hero.instanceId;
    expect(tapPermanent(s, engineRuntime, heroId, true)).toBe(true);
    expect(tapPermanent(s, engineRuntime, heroId, true)).toBe(false); // already tapped
    expect(tapPermanent(s, engineRuntime, heroId, false)).toBe(true);
    expect(tapPermanent(s, engineRuntime, heroId, false)).toBe(false); // already untapped
  });
});
