import type { GameView } from "@fyendal/shared";
import { cardData } from "@fyendal/cards/client";
import {
  CARD_PREVIEW_HEIGHT,
  CARD_PREVIEW_WIDTH,
  CardFace,
  InactiveZoneCard,
} from "../Card.js";
import { DeckCardToast, type useDeckCardFeedback } from "../DeckCardToast.js";
import { GameOver } from "../GameOver.js";
import { MobileCardInspect } from "../MobileCardInspect.js";
import type { HoverSurfaceLayout } from "../hoverSurfaceLayout.js";
import type { BoardOverlay } from "./BoardPrimitives.js";

export interface BoardPreview {
  id: string | null;
  x: number;
  y: number;
  effectTooltip?: { label: string; position: HoverSurfaceLayout["tooltip"] };
}

export function BoardOverlays({
  preview,
  overlay,
  inspectedCardId,
  seat,
  yourSeat,
  deckCardFeedback,
  showIdleVictory,
  opponentHeroName,
  opponentIdleMs,
  onClaimVictory,
  onDismissIdleVictory,
  gameView,
  spectating,
  replaying,
  gameOverDismissed,
  getRecordedViews,
  replayAvailable,
  onWatchReplay,
  onDownloadReplay,
  onLeave,
  onDismissGameOver,
  onCloseOverlay,
  onInspectCard,
}: {
  preview: BoardPreview | null;
  overlay: BoardOverlay | null;
  inspectedCardId: string | null;
  seat: number;
  yourSeat: number | null;
  deckCardFeedback: ReturnType<typeof useDeckCardFeedback>;
  showIdleVictory: boolean;
  opponentHeroName: string;
  opponentIdleMs: number;
  onClaimVictory: () => void;
  onDismissIdleVictory: () => void;
  gameView: GameView;
  spectating: boolean;
  replaying: boolean;
  gameOverDismissed: boolean;
  getRecordedViews: () => GameView[];
  replayAvailable: boolean;
  onWatchReplay: () => void;
  onDownloadReplay: () => void;
  onLeave: () => void;
  onDismissGameOver: () => void;
  onCloseOverlay: () => void;
  onInspectCard: (cardId: string | null) => void;
}) {
  return (
    <>
      {preview?.id && cardData[preview.id] ? (
        <div
          className="card-preview"
          style={{
            left: preview.x,
            top: preview.y,
            width: CARD_PREVIEW_WIDTH,
            height: CARD_PREVIEW_HEIGHT,
          }}
        >
          <CardFace card={{ instanceId: -999, cardId: preview.id, owner: seat }} size="preview" />
        </div>
      ) : null}
      {preview?.effectTooltip ? (
        <div
          className="effect-tip effect-tip-floating"
          style={preview.effectTooltip.position}
          role="tooltip"
        >
          {preview.effectTooltip.label}
        </div>
      ) : null}
      {overlay ? (
        <div className="overlay zone-overlay" onClick={onCloseOverlay}>
          <div
            className="overlay-panel zone-overlay-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="zone-overlay-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="zone-overlay-header">
              <div className="overlay-title" id="zone-overlay-title">{overlay.title}</div>
              <button
                type="button"
                className="zone-overlay-close"
                aria-label={`Close ${overlay.title}`}
                onClick={onCloseOverlay}
              >
                ×
              </button>
            </div>
            <div
              className="overlay-cards"
              onClick={(event) => {
                if (!window.matchMedia("(max-width: 700px)").matches) return;
                const cardId = (event.target as HTMLElement)
                  .closest<HTMLElement>("[data-cardid]")
                  ?.dataset.cardid;
                if (cardId) onInspectCard(cardId);
              }}
            >
              {overlay.cards.map((card) => overlay.inactiveZone ? (
                <InactiveZoneCard
                  key={card.instanceId}
                  card={card}
                  revealOwnerIntimidated={yourSeat !== null && card.owner === yourSeat}
                />
              ) : <CardFace key={card.instanceId} card={card} size="zone" />)}
            </div>
          </div>
        </div>
      ) : null}
      <MobileCardInspect
        cardId={inspectedCardId}
        owner={seat}
        onClose={() => onInspectCard(null)}
      />
      <DeckCardToast
        event={deckCardFeedback.activeEvent}
        viewerSeat={seat}
        exiting={deckCardFeedback.exiting}
        onDismiss={deckCardFeedback.dismissActive}
        {...deckCardFeedback.toastHoverHandlers}
      />
      {showIdleVictory ? (
        <div className="idle-toast">
          <span>
            {opponentHeroName} hasn't acted in {Math.floor(opponentIdleMs / 60_000)} min — claim the win?
          </span>
          <button className="btn-primary" onClick={onClaimVictory}>Claim victory</button>
          <button className="linklike" onClick={onDismissIdleVictory}>Dismiss</button>
        </div>
      ) : null}
      {!replaying && gameView.winner !== null && !gameOverDismissed ? (
        <GameOver
          view={gameView}
          seat={seat}
          spectating={spectating}
          recordedViews={getRecordedViews()}
          onWatchReplay={replayAvailable ? onWatchReplay : null}
          onDownloadReplay={replayAvailable ? onDownloadReplay : null}
          onBackToLobby={onLeave}
          onClose={onDismissGameOver}
        />
      ) : null}
    </>
  );
}
