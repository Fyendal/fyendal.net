import type { EffectLifetime, OngoingEffectView } from "@fyendal/shared";
import { useEffect, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { ModalSurface } from "../../components/ModalSurface.js";
import { UiIcon } from "../../components/UiIcon.js";
import {
  EFFECT_LIFETIMES,
  effectCount,
  effectImposed,
  effectLifetime,
  effectSourceName,
  effectText,
  lifetimeIcon,
  sentenceCase,
  sortByLifetime,
  stackOngoingEffects,
} from "./effectModel.js";
import { effectSourceHero, useEffectHeroes } from "./effectHeroes.js";
import { EffectArt } from "./EffectSlot.js";

export interface EffectLedgerTarget {
  seat: number;
  /** Section to scroll to, e.g. rest of game when opened from a hero pin. */
  lifetime?: EffectLifetime;
}

/** Every lingering effect on both heroes, grouped on a timeline by when each
 *  effect ends. A bottom sheet on phones and a modal on larger screens. */
export function EffectLedger({
  effects,
  target,
  onClose,
  onInspectCard,
}: {
  effects: readonly OngoingEffectView[];
  target: EffectLedgerTarget;
  onClose: () => void;
  onInspectCard: (cardId: string) => void;
}) {
  const intl = useIntl();
  const heroes = useEffectHeroes();
  const [seat, setSeat] = useState(target.seat);
  const sectionRefs = useRef(new Map<EffectLifetime, HTMLElement>());
  const stacksFor = (forSeat: number) =>
    sortByLifetime(stackOngoingEffects(effects.filter((effect) => effect.seat === forSeat)));
  const stacks = stacksFor(seat);
  const heroName = (forSeat: number) => heroes.find((hero) => hero.seat === forSeat)?.label ?? "";
  const sections = EFFECT_LIFETIMES
    .map((lifetime) => ({ lifetime, rows: stacks.filter(({ effect }) => effectLifetime(effect) === lifetime) }))
    .filter(({ rows }) => rows.length > 0);

  useEffect(() => {
    if (target.lifetime) sectionRefs.current.get(target.lifetime)?.scrollIntoView?.({ block: "nearest" });
  }, [target.lifetime]);

  return (
    <ModalSurface
      title={intl.formatMessage({ id: "game.effects.lingering" })}
      className="effect-ledger"
      onClose={onClose}
    >
      <div className="effect-ledger-tabs" role="tablist">
        {heroes.map((hero) => (
          <button
            key={hero.seat}
            type="button"
            role="tab"
            aria-selected={hero.seat === seat}
            className={hero.seat === seat ? "selected" : undefined}
            onClick={() => setSeat(hero.seat)}
          >
            <span className="effect-ledger-tab-name">{hero.label}</span>
            <span className="effect-ledger-tab-count">{effectCount(stacksFor(hero.seat))}</span>
          </button>
        ))}
      </div>
      <div className="effect-ledger-body" role="tabpanel">
        {sections.length === 0 ? (
          <p className="effect-ledger-empty">
            {intl.formatMessage({ id: "game.effects.empty" }, { hero: heroName(seat) })}
          </p>
        ) : sections.map(({ lifetime, rows }) => {
          const heading = intl.formatMessage({ id: `game.effects.lifetime.${lifetime}` });
          return (
          <section
            key={lifetime}
            className="effect-ledger-section"
            ref={(node) => {
              if (node) sectionRefs.current.set(lifetime, node);
              else sectionRefs.current.delete(lifetime);
            }}
          >
            <h3 className="effect-ledger-heading">
              <span className="effect-ledger-node"><UiIcon name={lifetimeIcon(lifetime)} /></span>
              {heading}
            </h3>
            <ul>
              {rows.map(({ effect, count }) => {
                const text = effectText(intl, effect);
                const imposed = effectImposed(effect);
                const sourceHero = effectSourceHero(effect, heroes);
                const source = effectSourceName(intl, effect, heroes);
                // A hero source shows that hero; its name already says who.
                const artCardId = effect.cardId || sourceHero?.heroCardId;
                return (
                  <li
                    key={JSON.stringify([effect.cardId, effect.label, effect.sourceSeat ?? null])}
                    className={`effect-ledger-row${imposed ? " effect-imposed" : ""}${effect.inactive ? " effect-inactive" : ""}`}
                  >
                    {artCardId ? (
                      <button
                        type="button"
                        className="effect-ledger-art"
                        data-cardid={artCardId}
                        aria-label={source}
                        onClick={() => onInspectCard(artCardId)}
                      >
                        <EffectArt effect={effect} />
                      </button>
                    ) : (
                      <span className="effect-ledger-art"><EffectArt effect={effect} /></span>
                    )}
                    <span className="effect-ledger-text">
                      <span className="effect-ledger-byline">
                        <span
                          className={artCardId ? "effect-ledger-source" : "effect-ledger-source effect-ledger-source-generic"}
                        >
                          {source}
                        </span>
                        {imposed && !sourceHero && effect.sourceSeat !== undefined ? (
                          <span className="effect-ledger-imposed">
                            {intl.formatMessage({ id: "game.effects.imposed" }, { hero: heroName(effect.sourceSeat) })}
                          </span>
                        ) : null}
                      </span>
                      <span className="effect-summary">{sentenceCase(text.summary)}</span>
                      {text.duration.toLocaleLowerCase() === heading.toLocaleLowerCase() ? null : (
                        <span className="effect-ledger-duration">{sentenceCase(text.duration)}</span>
                      )}
                    </span>
                    {count > 1 ? (
                      <span
                        className="effect-count"
                        aria-label={intl.formatMessage({ id: "game.effects.identical" }, { count })}
                      >
                        ×{count}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
          );
        })}
      </div>
    </ModalSurface>
  );
}
