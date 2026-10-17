import type { IntlShape } from "react-intl";
import type { UiIconName } from "../../components/UiIcon.js";
import { effectSourceHero, type EffectHero } from "./effectHeroes.js";
import {
  EFFECT_LIFETIMES,
  effectIcon,
  effectImposed,
  effectText,
  lifetimeIcon,
  sentenceCase,
  type OngoingEffectStack,
} from "./effectModel.js";

const HINT_ICONS: readonly UiIconName[] = ["effect-recurring", ...EFFECT_LIFETIMES.map(lifetimeIcon)];

/** What a hovered effect chip spells out beside its source preview. */
export interface EffectHint {
  summary: string;
  duration: string;
  icon: UiIconName;
  count: number;
  /** The opposing hero who imposed it, when the source does not already say. */
  imposedBy?: string;
  inactive: boolean;
}

export function effectHint(
  intl: IntlShape,
  { effect, count }: OngoingEffectStack,
  heroes: readonly EffectHero[],
): EffectHint {
  const text = effectText(intl, effect);
  const imposer = effectImposed(effect) && !effectSourceHero(effect, heroes)
    ? heroes.find((hero) => hero.seat === effect.sourceSeat)
    : undefined;
  return {
    summary: sentenceCase(text.summary),
    duration: sentenceCase(text.duration),
    icon: effectIcon(effect),
    count,
    ...(imposer ? { imposedBy: imposer.label } : {}),
    inactive: effect.inactive === true,
  };
}

/** The chip carries its hint as data attributes, so the board's single hover
 *  handler can render it without reaching back into effect state. */
export function effectHintAttributes(hint: EffectHint): Record<string, string> {
  return {
    "data-effect-summary": hint.summary,
    "data-effect-duration": hint.duration,
    "data-effect-icon": hint.icon,
    "data-effect-count": String(hint.count),
    ...(hint.imposedBy ? { "data-effect-imposed-by": hint.imposedBy } : {}),
    ...(hint.inactive ? { "data-effect-inactive": "" } : {}),
  };
}

export function readEffectHint(dataset: DOMStringMap): EffectHint | undefined {
  const { effectSummary: summary, effectDuration: duration } = dataset;
  const icon = HINT_ICONS.find((name) => name === dataset.effectIcon);
  if (summary === undefined || duration === undefined || icon === undefined) return undefined;
  const count = Number(dataset.effectCount);
  return {
    summary,
    duration,
    icon,
    count: Number.isSafeInteger(count) && count > 0 ? count : 1,
    ...(dataset.effectImposedBy ? { imposedBy: dataset.effectImposedBy } : {}),
    inactive: dataset.effectInactive !== undefined,
  };
}

export const sameEffectHint = (a?: EffectHint, b?: EffectHint): boolean =>
  a === b || (a !== undefined && b !== undefined &&
    a.summary === b.summary && a.duration === b.duration && a.icon === b.icon &&
    a.count === b.count && a.imposedBy === b.imposedBy && a.inactive === b.inactive);
