import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import { decisionPrompt } from "./shared-helpers.js";

function isYellowAura(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.cardColor(card) === 2 &&
    ctx.hasCardType(card, "action") &&
    ctx.cardTypes(card).includes("aura");
}

export const apr: Record<string, CardScript> = {
  "halo of lumina light|0": {
    onDestroyed(ctx) {
      const auras = ctx.player(ctx.seat).banish.filter((card) => !card.faceDown && isYellowAura(ctx, card));
      if (auras.length) {
        ctx.requestCardChoice(
          "halo-lumina-aura",
          decisionPrompt(
            "Halo of Lumina Light: put a yellow aura from banish into the arena?",
            "card.apr.halo.aura.return",
          ),
          ["pass", ...auras.map((card) => card.instanceId)],
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook === "halo-lumina-aura" && option !== "pass") ctx.settleCard(Number(option));
    },
  },
};
