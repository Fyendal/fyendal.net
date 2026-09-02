import type { OngoingEffectView } from "@fyendal/shared";
import { useIntl } from "react-intl";
import { cardImageUrl } from "./Card.js";

interface OngoingEffectStack {
  effect: OngoingEffectView;
  count: number;
}

/** Preserve projection order while collapsing only publicly identical effects. */
export function stackOngoingEffects(effects: readonly OngoingEffectView[]): OngoingEffectStack[] {
  const stacks = new Map<string, OngoingEffectStack>();

  for (const effect of effects) {
    const key = JSON.stringify([effect.seat, effect.cardId, effect.label]);
    const stack = stacks.get(key);
    if (stack) {
      stack.count += 1;
    } else {
      stacks.set(key, { effect, count: 1 });
    }
  }

  return [...stacks.values()];
}

/** Lingering effects (next attack / this turn) as mini cards near the owner's
 *  legs. The pulsing bronze border marks them as active; hovering pops the
 *  effect label (and the full card via the board's data-cardid delegation). */
export function EffectChips({
  effects,
  area,
}: {
  effects: OngoingEffectView[];
  /** grid area on the mat half */
  area: string;
}) {
  const intl = useIntl();
  if (effects.length === 0) return null;
  const stacks = stackOngoingEffects(effects);

  return (
    <div
      className="effects-row"
      style={{ gridArea: area }}
      aria-label={intl.formatMessage({ id: "game.effects.lingering" })}
    >
      {stacks.map(({ effect, count }) => (
        <div
          key={JSON.stringify([effect.seat, effect.cardId, effect.label])}
          className={`effect-mini${count > 1 ? " effect-mini-stacked" : ""}`}
          data-effect-label={`${effect.label}${count > 1 ? ` ×${count}` : ""}`}
          {...(effect.cardId ? { "data-cardid": effect.cardId } : {})}
        >
          {effect.cardId ? (
            <img className="effect-mini-img" src={cardImageUrl(effect.cardId)} alt="" draggable={false} loading="eager" />
          ) : (
            <div className="effect-mini-img effect-back" />
          )}
          {count > 1 ? (
            <span
              className="effect-count"
              aria-label={intl.formatMessage({ id: "game.effects.identical" }, { count })}
            >
              ×{count}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
