import type { GameView } from "@fyendal/shared";
import { useIntl } from "react-intl";
import { DeckCardToast, type useDeckCardFeedback } from "../DeckCardToast.js";
import { GameOver } from "../GameOver.js";
import { HoverCardPreview, type BoardPreview } from "../HoverCardPreview.js";
import { MobileCardInspect } from "../MobileCardInspect.js";
import type { StandingOrderPanelModel } from "../StandingOrderPanel.js";
import { PostGameFriendAction } from "../../social/PostGameFriendAction.js";
import type { BoardOverlay } from "./BoardPrimitives.js";
import { ZoneOverlay } from "./ZoneOverlay.js";

export type { BoardPreview } from "../HoverCardPreview.js";

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
  replayAtEnd,
  gameOverDismissed,
  getRecordedViews,
  replayViews,
  replayAvailable,
  onWatchReplay,
  onDownloadReplay,
  onLeave,
  onPlayAgain,
  onCloseReplay,
  onDismissGameOver,
  onCloseOverlay,
  onInspectCard,
  opponentUsername,
  botGame,
  drawOfferSeat,
  onAcceptDraw,
  onDeclineDraw,
  standingOrders = null,
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
  replayAtEnd: boolean;
  gameOverDismissed: boolean;
  getRecordedViews: () => GameView[];
  replayViews: GameView[] | null;
  replayAvailable: boolean;
  onWatchReplay: () => void;
  onDownloadReplay: () => void;
  onLeave: () => void;
  onPlayAgain: (() => void) | null;
  onCloseReplay: () => void;
  onDismissGameOver: () => void;
  onCloseOverlay: () => void;
  onInspectCard: (cardId: string | null) => void;
  opponentUsername: string | null;
  botGame: boolean;
  drawOfferSeat: number | undefined;
  onAcceptDraw: (() => void) | null;
  onDeclineDraw: (() => void) | null;
  /** The inspected card's repeating questions. */
  standingOrders?: StandingOrderPanelModel | null;
}) {
  const intl = useIntl();
  return (
    <>
      {preview ? <HoverCardPreview preview={preview} owner={seat} /> : null}
      {overlay ? (
        <ZoneOverlay
          overlay={overlay}
          yourSeat={yourSeat}
          onClose={onCloseOverlay}
          onInspectCard={onInspectCard}
        />
      ) : null}
      <MobileCardInspect
        cardId={inspectedCardId}
        owner={seat}
        onClose={() => onInspectCard(null)}
        standingOrders={standingOrders}
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
            {intl.formatMessage(
              { id: "game.idle.claimPrompt" },
              { hero: opponentHeroName, minutes: Math.floor(opponentIdleMs / 60_000) },
            )}
          </span>
          <button className="btn-primary" onClick={onClaimVictory}>
            {intl.formatMessage({ id: "game.idle.claim" })}
          </button>
          <button className="linklike" onClick={onDismissIdleVictory}>
            {intl.formatMessage({ id: "common.dismiss" })}
          </button>
        </div>
      ) : null}
      {drawOfferSeat !== undefined && drawOfferSeat !== yourSeat && onAcceptDraw && onDeclineDraw ? (
        <div className="idle-toast" role="status">
          <span>{intl.formatMessage({ id: "settings.draw.received" })}</span>
          <button className="btn-primary" onClick={onAcceptDraw}>
            {intl.formatMessage({ id: "settings.draw.accept" })}
          </button>
          <button className="linklike" onClick={onDeclineDraw}>
            {intl.formatMessage({ id: "settings.draw.decline" })}
          </button>
        </div>
      ) : null}
      {(!replaying || replayAtEnd) && gameView.phase === "game-over" && !gameOverDismissed ? (
        <GameOver
          view={gameView}
          seat={seat}
          spectating={spectating}
          recordedViews={replaying ? replayViews ?? [gameView] : getRecordedViews()}
          onWatchReplay={!replaying && replayAvailable ? onWatchReplay : null}
          onDownloadReplay={replaying || replayAvailable ? onDownloadReplay : null}
          onBackToLobby={replaying ? onCloseReplay : onLeave}
          onPlayAgain={replaying ? null : onPlayAgain}
          replaying={replaying}
          onClose={onDismissGameOver}
          friendAction={!replaying && !botGame && !spectating && opponentUsername
            ? <PostGameFriendAction username={opponentUsername} />
            : null}
        />
      ) : null}
    </>
  );
}
