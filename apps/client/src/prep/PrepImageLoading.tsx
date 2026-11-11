import { useMemo, type CSSProperties } from "react";
import { useIntl } from "react-intl";
import type { DeckArt, DeckPool } from "@fyendal/shared";
import { cardData } from "@fyendal/cards/client";
import { CardArtwork } from "../game/Card.js";
import { deckArtIsCustom, useCardArtCatalog } from "../game/cardArtCatalog.js";
import type { CardImageArt, CardImagePreload } from "../game/cardImagePreload.js";

/** Card art gates entry to the room, but a slow CDN must not eat the deadlines. */
export const DECK_IMAGE_TIMEOUT_MS = 12_000;

export function deckPoolCardIds(pool: DeckPool): string[] {
  return [
    pool.heroId,
    ...pool.weaponIds,
    ...pool.equipmentPool,
    ...(pool.inventoryPool ?? []),
    ...pool.deck,
    ...(pool.sideboard ?? []),
  ];
}

const NO_ART: CardImageArt = {};

/** The deck's chosen art for preloading, or null while the art catalog loads. */
export function useDeckImageArt(
  deck: { id: string; decklist: DeckPool; art?: DeckArt; fabraryArt?: Record<string, string> } | null,
  enabled: boolean,
): CardImageArt | null {
  const custom = enabled && !!deck && !deck.id.startsWith("precon-") && deckArtIsCustom(deck.art, deck.fabraryArt);
  const catalog = useCardArtCatalog(custom);
  const pool = deck?.decklist;
  const art = deck?.art;
  const defaults = deck?.fabraryArt;
  return useMemo(() => {
    if (!custom || !pool || !art) return NO_ART;
    return catalog ? catalog.resolveDeckArt(pool, art, defaults) : null;
  }, [custom, catalog, pool, art, defaults]);
}

export function PrepDeckLoading({ onCancel }: { onCancel: () => void }) {
  const intl = useIntl();
  return (
    <div className="lobby-page">
      <div className="panel waiting-panel">
        <h2 className="panel-title">{intl.formatMessage({ id: "prep.loadingDeck" })}</h2>
        <button onClick={onCancel}>{intl.formatMessage({ id: "common.cancel" })}</button>
      </div>
    </div>
  );
}

/**
 * Shown before the prep room while the deck's card art downloads. The hero
 * fills with color as the deck arrives, so progress reads at a glance.
 */
export function PrepImageLoading({
  heroId,
  art,
  progress,
  onSkip,
  onCancel,
}: {
  heroId: string;
  /** Null hides the hero until its chosen art is known. */
  art: CardImageArt | null;
  progress: CardImagePreload;
  onSkip?: () => void;
  onCancel: () => void;
}) {
  const intl = useIntl();
  const ratio = progress.total > 0 ? progress.settled / progress.total : 0;
  const heroName = cardData[heroId]?.name ?? heroId;
  return (
    <div className="lobby-page prep-image-loading-page">
      <section
        className="panel prep-image-loading"
        aria-labelledby="prep-image-loading-title"
      >
        <div
          className="prep-image-loading-hero"
          style={{ "--prep-load-ratio": ratio } as CSSProperties}
          aria-hidden="true"
        >
          {art ? (
            <>
              <CardArtwork className="prep-image-loading-base" cardId={heroId} artImage={art[heroId]} alt="" />
              <CardArtwork className="prep-image-loading-fill" cardId={heroId} artImage={art[heroId]} alt="" />
            </>
          ) : null}
        </div>
        <h2 className="panel-title" id="prep-image-loading-title">
          {intl.formatMessage({ id: "prep.imageLoading.title" })}
        </h2>
        <p className="prep-image-loading-hero-name">{heroName}</p>
        <div
          className="prep-image-loading-meter"
          role="progressbar"
          aria-labelledby="prep-image-loading-title"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.settled}
        >
          <span style={{ transform: `scaleX(${ratio})` }} />
        </div>
        <p className="muted prep-image-loading-count" aria-live="polite">
          {intl.formatMessage(
            { id: "prep.imageLoading.progress" },
            { settled: progress.settled, total: progress.total },
          )}
        </p>
        <div className="prep-image-loading-actions">
          {onSkip ? (
            <button type="button" onClick={onSkip}>
              {intl.formatMessage({ id: "prep.imageLoading.skip" })}
            </button>
          ) : null}
          <button type="button" onClick={onCancel}>
            {intl.formatMessage({ id: "common.cancel" })}
          </button>
        </div>
      </section>
    </div>
  );
}

/**
 * A deck switch inside the room: the arena panel waits in place, so the open
 * seat and its invites stay on screen. The hero appears once the pool loads.
 */
export function PrepDeckSwitchLoading({
  deckName,
  heroId,
  art,
  progress,
  onSkip,
}: {
  deckName: string;
  /** Null while the server and pool requests are still in flight. */
  heroId: string | null;
  art: CardImageArt | null;
  progress: CardImagePreload | null;
  onSkip?: () => void;
}) {
  const intl = useIntl();
  const ratio = progress && progress.total > 0 ? progress.settled / progress.total : 0;
  return (
    <div className="prep-deck-switch" role="status">
      <div
        className={`prep-image-loading-hero prep-deck-switch-hero${heroId && art ? "" : " pending"}`}
        style={{ "--prep-load-ratio": ratio } as CSSProperties}
        aria-hidden="true"
      >
        {heroId && art ? (
          <>
            <CardArtwork className="prep-image-loading-base" cardId={heroId} artImage={art[heroId]} alt="" />
            <CardArtwork className="prep-image-loading-fill" cardId={heroId} artImage={art[heroId]} alt="" />
          </>
        ) : null}
      </div>
      <div className="prep-deck-switch-copy">
        <p className="prep-deck-switch-title">
          {intl.formatMessage({ id: "prep.deckSwitch.title" }, { deck: deckName })}
        </p>
        <div className={`prep-image-loading-meter${progress ? "" : " indeterminate"}`} aria-hidden="true">
          <span style={progress ? { transform: `scaleX(${ratio})` } : undefined} />
        </div>
        <p className="muted prep-deck-switch-count">
          {progress
            ? intl.formatMessage(
                { id: "prep.imageLoading.progress" },
                { settled: progress.settled, total: progress.total },
              )
            : intl.formatMessage({ id: "prep.deckSwitch.loadingDeck" })}
        </p>
        {onSkip ? (
          <button type="button" className="lobby-create-action" onClick={onSkip}>
            {intl.formatMessage({ id: "prep.deckSwitch.showNow" })}
          </button>
        ) : null}
      </div>
    </div>
  );
}
