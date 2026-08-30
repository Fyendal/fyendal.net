import type { CardScript } from "@fyendal/engine";
import {
  isSixPlus,
  lessonCounter,
  mentorFlipTrigger,
  mentorSpecializationPayoff,
  resolveMentorSpecializationChoice,
} from "./shared-helpers.js";

const SEARCH_HOOK = "barthimont-specialization";

export const lev: Record<string, CardScript> = {
  "lady barthimont|0": {
    activeWhileFaceUpInArsenal: true,
    triggers: [mentorFlipTrigger(), {
      event: "card-played",
      label: "Banish the top card of your deck",
      condition: (ctx, played) => ctx.self.faceDown !== true && !!played &&
        ctx.hasCardType(played, "action") &&
        ctx.cardTypes(played).includes("attack"),
      effect(ctx, played) {
      if (!played) return;
      const top = ctx.player(ctx.seat).deck[0];
      if (!top || !ctx.banish(top.instanceId) || !isSixPlus(ctx, top)) return;
      if (ctx.link?.attackingCard.instanceId === played.instanceId) ctx.setFlag("link", "dominate", true);
      if (lessonCounter(ctx) >= 2) mentorSpecializationPayoff(ctx, SEARCH_HOOK);
      },
    }],
    onChoose(ctx, hook, option) {
      resolveMentorSpecializationChoice(ctx, SEARCH_HOOK, hook, option);
    },
  },
};
