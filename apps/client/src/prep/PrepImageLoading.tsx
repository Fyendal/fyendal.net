import type { CSSProperties } from "react";
import { useIntl } from "react-intl";
import type { DeckPool } from "@fyendal/shared";
import { cardData } from "@fyendal/cards/client";
import { CardArtwork } from "../game/Card.js";
import type { CardImagePreload } from "../game/cardImagePreload.js";

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
  progress,
  onSkip,
  onCancel,
}: {
  heroId: string;
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
          <CardArtwork className="prep-image-loading-base" cardId={heroId} alt="" />
          <CardArtwork className="prep-image-loading-fill" cardId={heroId} alt="" />
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
