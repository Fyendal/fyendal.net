import type { CardScript } from "@fyendal/engine";
import {
  lessonCounter,
  mentorFlipTrigger,
  mentorSpecializationPayoff,
  resolveMentorSpecializationChoice,
} from "./shared-helpers.js";

const SEARCH_HOOK = "librarian-specialization";

export const psm: Record<string, CardScript> = {
  "the librarian|0": {
    activeWhileFaceUpInArsenal: true,
    triggers: [mentorFlipTrigger()],
    onFriendlyTokenCreated(ctx, token) {
      if (
        ctx.cardData(token.cardId).name !== "Spectral Shield" ||
        ctx.getPlayerFlag(ctx.seat, "librarianTriggeredThisTurn") === true
      ) return;
      ctx.setPlayerFlag(ctx.seat, "librarianTriggeredThisTurn", true);
      ctx.drawCards(ctx.seat, 1);
      if (lessonCounter(ctx) >= 3) mentorSpecializationPayoff(ctx, SEARCH_HOOK);
    },
    onChoose(ctx, hook, option) {
      resolveMentorSpecializationChoice(ctx, SEARCH_HOOK, hook, option);
    },
  },
};
