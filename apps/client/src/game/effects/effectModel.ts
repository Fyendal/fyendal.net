import { cardData } from "@fyendal/cards/client";
import type { EffectLifetime, OngoingEffectView } from "@fyendal/shared";
import type { IntlShape } from "react-intl";
import type { UiIconName } from "../../components/UiIcon.js";
import { formatGameMessage } from "../../i18n/GameMessage.js";
import { effectSourceHero, type EffectHero } from "./effectHeroes.js";

/** Soonest first: the order of the ledger's timeline sections. */
export const EFFECT_LIFETIMES: readonly EffectLifetime[] = ["once", "chain", "turn", "later", "game"];

export interface OngoingEffectStack {
  effect: OngoingEffectView;
  count: number;
}

/** Preserve projection order while collapsing only publicly identical effects. */
export function stackOngoingEffects(effects: readonly OngoingEffectView[]): OngoingEffectStack[] {
  const stacks = new Map<string, OngoingEffectStack>();

  for (const effect of effects) {
    const key = JSON.stringify([effect.seat, effect.cardId, effect.label, effect.sourceSeat ?? null]);
    const stack = stacks.get(key);
    if (stack) {
      stack.count += 1;
    } else {
      stacks.set(key, { effect, count: 1 });
    }
  }

  return [...stacks.values()];
}

/** Older servers and replays send only "<summary> · <duration>". */
function legacyParts(effect: OngoingEffectView): { summary: string; duration: string } {
  const split = effect.label.lastIndexOf(" · ");
  return split < 0
    ? { summary: effect.label, duration: "" }
    : { summary: effect.label.slice(0, split), duration: effect.label.slice(split + 3) };
}

export function effectLifetime(effect: OngoingEffectView): EffectLifetime {
  if (effect.lifetime) return effect.lifetime;
  const duration = legacyParts(effect).duration;
  if (duration === "this combat chain") return "chain";
  if (/^(?:next turn|next action phase|through next turn)$/.test(duration)) return "later";
  if (duration.startsWith("next ")) return "once";
  return "turn";
}

/** Effects the opponent put on this hero, usually restrictions. */
export function effectImposed(effect: OngoingEffectView): boolean {
  return effect.sourceSeat !== undefined && effect.sourceSeat !== effect.seat;
}

export function effectIcon(effect: OngoingEffectView): UiIconName {
  return effect.recurring ? "effect-recurring" : lifetimeIcon(effectLifetime(effect));
}

export function lifetimeIcon(lifetime: EffectLifetime): UiIconName {
  return `effect-${lifetime}`;
}

/** Soonest-ending first; the sort is stable, so projection order breaks ties. */
export function sortByLifetime(stacks: readonly OngoingEffectStack[]): OngoingEffectStack[] {
  const rank = (stack: OngoingEffectStack) => EFFECT_LIFETIMES.indexOf(effectLifetime(stack.effect));
  return [...stacks].sort((a, b) => rank(a) - rank(b));
}

/** Rest-of-game effects live on the hero as pins; everything else in the slot. */
export function splitByPlacement(effects: readonly OngoingEffectView[]): {
  slot: OngoingEffectStack[];
  pins: OngoingEffectStack[];
} {
  const stacks = sortByLifetime(stackOngoingEffects(effects));
  return {
    slot: stacks.filter(({ effect }) => effectLifetime(effect) !== "game"),
    pins: stacks.filter(({ effect }) => effectLifetime(effect) === "game"),
  };
}

export const effectCount = (stacks: readonly OngoingEffectStack[]): number =>
  stacks.reduce((total, stack) => total + stack.count, 0);

const cardName = (cardId: string): string => cardData[cardId]?.name ?? cardId;

export function effectText(intl: IntlShape, effect: OngoingEffectView): { summary: string; duration: string } {
  const legacy = legacyParts(effect);
  const resolvers = { card: cardName };
  return {
    summary: effect.summaryMessage
      ? formatGameMessage(intl, effect.summaryMessage, resolvers)
      : effect.summary ?? legacy.summary,
    duration: effect.durationMessage
      ? formatGameMessage(intl, effect.durationMessage, resolvers)
      : effect.duration ?? legacy.duration,
  };
}

/** Display sentence case without changing the engine's lowercase fallbacks. */
export function sentenceCase(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

export function effectSourceName(
  intl: IntlShape,
  effect: OngoingEffectView,
  heroes: readonly EffectHero[],
): string {
  if (effect.cardId) return cardName(effect.cardId);
  const hero = effectSourceHero(effect, heroes);
  if (hero) return hero.label;
  return intl.formatMessage({
    id: effect.sourceHidden ? "game.effects.source.hidden" : "game.effects.source.hero",
  });
}
