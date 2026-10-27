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
  deck: { id: string; decklist: DeckPool; art?: DeckArt } | null,
  enabled: boolean,
): CardImageArt | null {
  const custom = enabled && !!deck && !deck.id.startsWith("precon-") && deckArtIsCustom(deck.art);
  const catalog = useCardArtCatalog(custom);
  const pool = deck?.decklist;
  const art = deck?.art;
  return useMemo(() => {
    if (!custom || !pool || !art) return NO_ART;
    return catalog ? catalog.resolveDeckArt(pool, art) : null;
  }, [custom, catalog, pool, art]);
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
