import type { CardScript } from "@fyendal/engine";
import {
  lessonCounter,
  mentorFlipTrigger,
  mentorSpecializationPayoff,
  resolveMentorSpecializationChoice,
} from "./shared-helpers.js";

const SEARCH_HOOK = "minerva-specialization";

export const bol: Record<string, CardScript> = {
  "minerva themis|0": {
    activeWhileFaceUpInArsenal: true,
    triggers: [mentorFlipTrigger()],
    onFriendlyAttackDeclared(ctx) {
      if (
        ctx.link?.attackCardType === "weapon" &&
        ctx.cardTypes(ctx.link.attackingCard).includes("1h")
      ) ctx.addModifier({ scope: "chain-link", attack: 1 });
    },
    canTriggerOnHit(ctx) {
      return ctx.link?.attackCardType === "weapon";
    },
    onHit(ctx) {
      if (lessonCounter(ctx) >= 3) mentorSpecializationPayoff(ctx, SEARCH_HOOK);
    },
    onChoose(ctx, hook, option) {
      resolveMentorSpecializationChoice(ctx, SEARCH_HOOK, hook, option);
    },
  },
};
