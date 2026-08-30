import type { CardScript } from "@fyendal/engine";
import {
  lessonCounter,
  mentorFlipTrigger,
  mentorSpecializationPayoff,
  resolveMentorSpecializationChoice,
} from "./shared-helpers.js";

const SEARCH_HOOK = "sutcliffe-specialization";

export const chn: Record<string, CardScript> = {
  "lord sutcliffe|0": {
    activeWhileFaceUpInArsenal: true,
    triggers: [mentorFlipTrigger(), {
      event: "card-played",
      label: "Deal 1 arcane damage to each hero",
      condition: (ctx, played) => ctx.self.faceDown !== true && !!played &&
        ctx.hasCardType(played, "action") &&
        !ctx.cardTypes(played).includes("attack"),
      effect(ctx) {
        for (const player of ctx.state.players) ctx.dealDamage(player.seat, 1, { arcane: true });
      },
    }],
    onDamageDealt(ctx, _target, amount, arcane) {
      if (!arcane || amount <= 0) return;
      if (lessonCounter(ctx) >= 3) mentorSpecializationPayoff(ctx, SEARCH_HOOK);
    },
    onChoose(ctx, hook, option) {
      resolveMentorSpecializationChoice(ctx, SEARCH_HOOK, hook, option);
    },
  },
};
