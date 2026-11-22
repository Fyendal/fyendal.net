import type { CardScript, ScriptCtx } from "@fyendal/engine";
import { FROSTBITE, GOLD } from "../tokens.js";
import { opponentSeat } from "./state.js";

/** Clash; the winner creates the token. */
export function clashForToken(tokenId: string): CardScript {
  return {
    onDefend(ctx) {
      ctx.requestClash(opponentSeat(ctx), "create-token");
    },
    onClashResult(ctx, hook, winner) {
      if (hook === "create-token" && winner >= 0) ctx.heroCreatesTokens(winner, tokenId);
    },
  };
}

export function createFrostbites(ctx: ScriptCtx, seat: number, count = 1): void {
  ctx.createTokens(FROSTBITE, count, seat);
}

export function createGold(ctx: ScriptCtx, count = 1): void {
  ctx.createTokens(GOLD, count);
}

/** "You may destroy a Gold you control rather than pay this card's {r} cost." */
export function alternativeGold(): CardScript["alternativePlayCost"] {
  return { kind: "destroy-controlled-named", options: [{ name: "Gold", count: 1 }] };
}
