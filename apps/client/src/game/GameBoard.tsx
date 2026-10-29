import { BrowserBotNotice } from "../bot/BrowserBotNotice.js";
import { useMatchAchievements } from "../achievements/useMatchAchievements.js";
import { AchievementToast } from "../achievements/AchievementToast.js";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";
import type { CardView, GameIntent, MeldSide } from "@fyendal/shared";
import { cardData } from "@fyendal/cards/client";
import { useStore } from "../store.js";
import { cardPreviewSize, CardArtProvider, CardBack, CardFace, SquareCardPresentation } from "./Card.js";
import { ChainFloat } from "./ChainFloat.js";
import { EndTurnPassToast } from "./EndTurnPassToast.js";
import { StatusFloat, type PrimaryAction } from "./StatusFloat.js";
import {
  ChainPriorityStatus,
  ChainTimingStatus,
  PriorityFloat,
  TurnTimingFloat,
} from "./PriorityFloat.js";
import { StackFloat } from "./StackFloat.js";
import { DecisionFloat } from "./DecisionFloat.js";
import { targetPlayPermissionNote } from "./decision/CardChoices.js";
import {
  CardSearchOverlay,
  isCardSearchOverlayDecision,
} from "./decision/CardSearchOverlay.js";
import { useDeckCardFeedback } from "./DeckCardToast.js";
import { SideRail } from "./SideRail.js";
import { ShareReplayDialog, savedReplayDaysLeft } from "../history/ShareReplayDialog.js";
import {
  canAddPaymentCard,
  canAddResourcePaymentPitch,
  offeredMeldSides,
  selectedDefendIntent,
  selectedResourcePaymentOption,
} from "./legalSelection.js";
import { arrangeBoundBoardCards, equipmentStackCards } from "./boardGroups.js";
import { chainDefenderIds, presentedHandCount as presentedDefenderHandCount } from "./defenderState.js";
import {
  passHotkeyIntent,
  shouldConfirmArsenalPass,
} from "./passHotkey.js";
import { causalStatus, gameHasPriority, gameTimingLabel } from "./causalExplanations.js";
import { visibleDeckTop } from "./visibleDeckTop.js";
import {
  abilityIndexes,
  handCardSelection,
  nonAttackActionPlayIds,
  useActionAnnouncement,
} from "./useActionAnnouncement.js";
import {
  boundedCardChoiceModel,
  boundedHandCardChoiceOptions,
  cardChoiceLocationLabels,
  handCardChoiceOptions,
  boundedCardChoiceKey,
  boundedCardChoiceSelectable,
  toggleBoundedCardChoice,
} from "./decisionPresentation.js";
import { shouldHidePriorityGuidance } from "./decisionPass.js";
import { hoverSurfaceLayout } from "./hoverSurfaceLayout.js";
import { readEffectHint, sameEffectHint } from "./effects/effectHint.js";
import { cardPreviewSurfaceSize } from "./cardPreviewFaces.js";
import { skippableTokenRun } from "./tokenSkip.js";
import { useStandingOrders } from "./useStandingOrders.js";
import { standingOrderKey } from "./standingOrders.js";
import { PlayerNameplate } from "./PlayerNameplate.js";
import { OpponentActions } from "../social/OpponentActions.js";
import { shouldShowIdleVictoryClaim } from "./idleVictory.js";
import { MobileHandToggle } from "./MobileHandToggle.js";
import { useMobileCardLongPress } from "./mobileCardLongPress.js";
import { EffectLedger, type EffectLedgerTarget } from "./effects/EffectLedger.js";
import { EffectHeroesContext, effectHeroes } from "./effects/effectHeroes.js";
import { abilityLabelForSource, deriveBoardLegalState } from "./board/boardModel.js";
import { useGameSettings } from "./board/useGameSettings.js";
import { PlaymatArt } from "./PlaymatArt.js";
import { PlaymatHintToast } from "./PlaymatHintToast.js";
import { usePlaymatHint } from "./board/usePlaymatHint.js";
import { useMatSeam } from "./board/useMatSeam.js";
import { resolvePlaymat, type PlaymatId } from "../playmats.js";
import { PriorityArrivalFlash } from "./board/priorityArrival.js";
import { useGameViewport } from "./board/useGameViewport.js";
import { isTouchBoardViewport } from "./board/viewportQueries.js";
import { useHudReserve } from "./board/useHudReserve.js";
import { useFullscreen } from "../components/useFullscreen.js";
import { FullscreenNudge } from "./FullscreenNudge.js";
import { useIdleVictoryPrompt } from "./board/useIdleVictoryPrompt.js";
import { useGameShortcuts } from "./board/useGameShortcuts.js";
import { shouldWarnBeforeEndTurn } from "./endTurnWarning.js";
import type { BoardOverlay } from "./board/BoardPrimitives.js";
import { heroCard } from "./board/heroCard.js";
import { PlayerHalf } from "./board/PlayerHalf.js";
import { PlayerHand } from "./board/PlayerHand.js";
import { handFanSlotStyle } from "./board/handFan.js";
import { handPlayWindow } from "./board/handOrder.js";
import { BoardOverlays, type BoardPreview } from "./board/BoardOverlays.js";
import { optimisticInteractionHiddenIds } from "./pendingInteraction.js";
import { optimisticDefenderView } from "./optimisticDefenderStaging.js";
import { optimisticInteractionView } from "./optimisticInteraction.js";
import {
  motionLocationKey,
  opaqueMotionPresentationKey,
  motionPresentationKey,
} from "./motion/motionTypes.js";
import { GameMotionLayer } from "./motion/GameMotionLayer.js";
import { useGameMotion } from "./motion/useGameMotion.js";
import { useGameSounds } from "./sound/useGameSounds.js";
import { handChoiceDismissal } from "./handChoiceDismissal.js";
import { hoverPreviewTarget } from "./hoverPreviewTarget.js";
import { renderedCardBadges } from "./cardBadges.js";
import { PitchFocus } from "./PitchFocus.js";
import { postPaymentPitchFocus, usePitchFocus } from "./usePitchFocus.js";
import { useOpponentPlayPresentation } from "./useOpponentPlayPresentation.js";

/** Priority signals shown on the board, held at the last settled motion. */
type PriorityPresentation = {
  gameId: string;
  /** Seat the game waits on: the pending decider, else the priority holder.
   * Its half of the mat is tinted for players, spectators, and replays. */
  holder: number | null;
  priorityPlayer: number | null;
  timingLabel: string;
};

const EMPTY_INSTANCE_IDS: ReadonlySet<number> = new Set();

export function GameBoard() {
  const intl = useIntl();
  const { view: authoritativeView, viewUpdate: authoritativeViewUpdate, playerProfiles, updateAccountCosmetics, cardArt, legal, actionCandidates, roomCommandPending, pendingInteraction, pendingDefenderStageIds, yourSeat, spectating, spectatorCount, spectatorUsernames, botGame, betaTester, sendIntent, sendPriorityMode, sendStandingOrders, sendTokenSkip, sendEmote, kickSpectator, latestEmote, undo, error, leave, opponentConnected, connected, connectionIssueVisible, roomCode, screen, replayFrames, replayViews, replayStep, replayNotes, setLiveReplayNote, watchReplay, downloadReplay, closeReplay, getRecordedViews, lastActionAt, claimVictory, reportBug, reportOpponent, backgroundSearching, stopBackgroundMatchmaking, authUser, authToken, setLobbyRail, unreadMessageCount, setSocialOpen } = useStore(
    useShallow((state) => ({
      view: state.view,
      viewUpdate: state.viewUpdate,
      playerProfiles: state.playerProfiles,
      updateAccountCosmetics: state.updateAccountCosmetics,
      cardArt: state.cardArt,
      legal: state.legal,
      actionCandidates: state.actionCandidates,
      roomCommandPending: state.roomCommandPending,
      pendingInteraction: state.pendingInteraction,
      pendingDefenderStageIds: state.pendingDefenderStageIds,
      yourSeat: state.yourSeat,
      spectating: state.spectating,
      spectatorCount: state.spectatorCount,
      spectatorUsernames: state.spectatorUsernames,
      botGame: state.botGame,
      betaTester: state.betaTester,
      sendIntent: state.sendIntent,
      sendPriorityMode: state.sendPriorityMode,
      sendStandingOrders: state.sendStandingOrders,
      sendTokenSkip: state.sendTokenSkip,
      sendEmote: state.sendEmote,
      kickSpectator: state.kickSpectator,
      latestEmote: state.latestEmote,
      undo: state.undo,
      error: state.error,
      leave: state.leave,
      opponentConnected: state.opponentConnected,
      connected: state.connected,
      connectionIssueVisible: state.connectionIssueVisible,
      roomCode: state.roomCode,
      screen: state.screen,
      replayFrames: state.replayFrames,
      replayViews: state.replayViews,
      replayStep: state.replayStep,
      replayNotes: state.replayNotes,
      setLiveReplayNote: state.setLiveReplayNote,
      watchReplay: state.watchReplay,
      downloadReplay: state.downloadReplay,
      closeReplay: state.closeReplay,
      getRecordedViews: state.getRecordedViews,
      lastActionAt: state.lastActionAt,
      claimVictory: state.claimVictory,
      reportBug: state.reportBug,
      reportOpponent: state.reportOpponent,
      backgroundSearching: state.backgroundMatchmaking.state === "searching",
      stopBackgroundMatchmaking: state.stopBackgroundMatchmaking,
      authUser: state.authUser,
      authToken: state.authToken,
      setLobbyRail: state.setLobbyRail,
      unreadMessageCount: state.friends.reduce((total, friend) => total + friend.unreadCount, 0),
      setSocialOpen: state.setSocialOpen,
    })),
  );
  // Only a saved copy the account owns can be shared; replays opened from a
  // file, another player's link, or straight from the room have no saved id.
  const savedReplayShare = useStore(useShallow((state) => {
    const replayId = state.screen === "replay" && !state.activeSharedReplay
      ? state.activeSavedReplayId
      : null;
    const saved = replayId ? state.savedReplays.find((replay) => replay.id === replayId) : undefined;
    return {
      replayId,
      expiresInDays: saved ? savedReplayDaysLeft(saved) : null,
      shared: saved?.share != null,
    };
  }));
  const [replayShareOpen, setReplayShareOpen] = useState(false);
  const { view, update: viewUpdate } = useOpponentPlayPresentation({
    view: authoritativeView,
    update: authoritativeViewUpdate,
    viewerSeat: spectating ? null : yourSeat,
    enabled: connected && screen !== "replay",
    scope: `${roomCode}:${authUser}:${screen}:${spectating}`,
  });
  const tableRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const fullscreen = useFullscreen();
  const [overlay, setOverlay] = useState<BoardOverlay | null>(null);
  const [inspectedCardId, setInspectedCardId] = useState<string | null>(null);
  const [effectLedger, setEffectLedger] = useState<EffectLedgerTarget | null>(null);
  const cardLongPressHandlers = useMobileCardLongPress((cardId, target) => {
    if (!view) return;
    const cardStackId = Number(
      target.closest<HTMLElement>("[data-card-stack-id]")?.dataset.cardStackId,
    );
    const stackedEntry = Number.isSafeInteger(cardStackId)
      ? view.players
        .flatMap((player) => {
          const arrangedBoard = arrangeBoundBoardCards(player.board);
          return [
            { card: heroCard(player), underCards: player.soul },
            ...Object.values(player.equipment).map((card) => ({ card, underCards: [] })),
            ...player.weapons.map((card) => ({ card, underCards: [] })),
            ...arrangedBoard.cards.map((card) => ({
              card,
              underCards: arrangedBoard.boundCardsByAlly.get(card.instanceId) ?? [],
            })),
          ];
        })
        .find((entry) => entry.card?.instanceId === cardStackId)
      : undefined;
    const stackedCards = stackedEntry?.card
      ? [...stackedEntry.underCards, ...equipmentStackCards(stackedEntry.card)]
      : undefined;
    if (stackedEntry?.card && stackedCards && stackedCards.length > 1) {
      setOverlay({
        title: `${cardData[stackedEntry.card.cardId]?.name ?? "Card"} Stack`,
        cards: stackedCards,
      });
    } else {
      setInspectedCardId(cardId);
    }
  });
  const [preview, setPreview] = useState<BoardPreview | null>(null);
  const previewTargetRef = useRef<HTMLElement | null>(null);
  // The preview sits above the ledger, so drop the chip preview that was
  // showing when the slot was clicked.
  const openEffectLedger = (target: EffectLedgerTarget) => {
    setPreview(null);
    setEffectLedger(target);
  };

  const {
    railCollapsed,
    setRailCollapsed,
    mobileLandscapeViewport,
    mobileFloatViewport,
    compactDesktopViewport,
    compactHudViewport,
    mobileHandIsHidden,
    toggleMobileHand,
    mobileCombatFloatVisibility,
  } = useGameViewport(boardRef);
  const compactBoard = compactDesktopViewport && !mobileFloatViewport && !mobileLandscapeViewport;
  const compactHud = compactHudViewport && !mobileFloatViewport && !mobileLandscapeViewport;
  const {
    lessGuidance,
    cardDisplayPreference,
    motionPreference,
    playabilityCuePreference,
    priorityWindowMode,
    skipPlayConfirmation,
    optionHotkeys,
    skipBotDelay,
    soundEffectsEnabled,
    soundEffectsVolume,
    playmat,
    botPlaymat,
    updatePriorityWindowMode,
    updateLessGuidance,
    updateCardDisplayPreference,
    updateMotionPreference,
    updatePlayabilityCuePreference,
    updateSkipPlayConfirmation,
    updateOptionHotkeys,
    updateSkipBotDelay,
    updateSoundEffectsEnabled,
    updateSoundEffectsVolume,
    updatePlaymat,
    updateBotPlaymat,
    standingOrders: standingOrderSettings,
    updateStandingOrder,
  } = useGameSettings({
    syncPriorityMode: connected && screen !== "replay" && !spectating && yourSeat !== null,
    sendPriorityMode,
    sendStandingOrders,
  });
  const standingOrders = useStandingOrders({
    view: authoritativeView,
    viewerSeat: spectating ? null : yourSeat,
    orders: standingOrderSettings,
    updateStandingOrder,
  });
  const inspectedStandingOrderKey = inspectedCardId ? standingOrderKey({ cardId: inspectedCardId }) : null;
  const inspectedStandingOrders = inspectedStandingOrderKey
    ? standingOrders.cards.get(inspectedStandingOrderKey)
    : undefined;
  const squareCardsEnabled = (cardDisplayPreference === "square" || mobileLandscapeViewport)
    && !mobileFloatViewport && !compactBoard;
  const presentedDefenderIds = screen === "replay" || spectating
    ? null
    : pendingDefenderStageIds;
  const presentedInteraction = screen === "replay" || spectating
    ? null
    : pendingInteraction;
  const interactionProjection = useMemo(
    () => optimisticInteractionView(view, yourSeat, presentedInteraction),
    [presentedInteraction, view, yourSeat],
  );
  const presentedView = useMemo(
    () => optimisticDefenderView(interactionProjection.view, yourSeat, presentedDefenderIds),
    [interactionProjection.view, presentedDefenderIds, yourSeat],
  );
  const gameMotion = useGameMotion({
    rootRef: tableRef,
    view: presentedView,
    viewUpdate,
    motionPreference,
    presentationKey: `${interactionProjection.key}:${presentedDefenderIds === null
      ? "defenders:authoritative"
      : `defenders:${presentedDefenderIds.join(",")}`}`,
    predictsSemanticTransition:
      interactionProjection.predictsSemanticTransition || presentedDefenderIds !== null,
  });
  const { combatPresentation } = gameMotion;
  // A priority hand-off that arrives while a card is still in flight waits
  // for it to land. Declared after useGameMotion so the effect runs after
  // that hook's layout effect has enqueued this commit's batches.
  const livePriorityRef = useRef<PriorityPresentation | null>(null);
  const settledPriorityRef = useRef<PriorityPresentation | null>(null);
  useLayoutEffect(() => {
    if (gameMotion.isMotionSettled()) settledPriorityRef.current = livePriorityRef.current;
  });
  // End-of-game popup can be dismissed to inspect the final board. Re-arm it
  // for a fresh result or after leaving and returning to the replay's last frame.
  const [gameOverDismissed, setGameOverDismissed] = useState(false);
  const [confirmSkipArsenal, setConfirmSkipArsenal] = useState(false);
  const [confirmEndTurn, setConfirmEndTurn] = useState(false);
  const [boundedChoiceSelection, setBoundedChoiceSelection] = useState<{
    decisionKey: string;
    optionIds: readonly string[];
  } | null>(null);
  const showDeckCardEvents = screen !== "replay";
  const deckCardFeedback = useDeckCardFeedback(view, showDeckCardEvents);
  const replayAtEnd = screen === "replay" && replayViews !== null
    && replayViews.length > 0 && replayStep === replayViews.length - 1;
  const winnerNow = view?.phase === "game-over" && (screen !== "replay" || replayAtEnd)
    ? view.winner ?? "draw"
    : null;
  const matchAchievements = useMatchAchievements({
    token: authToken,
    roomCode,
    gameOver: view?.phase === "game-over",
    live: screen !== "replay" && !spectating && yourSeat !== null,
    viewUpdate,
  });
  useGameSounds({
    view,
    viewUpdate,
    enabled: soundEffectsEnabled && screen !== "replay",
    volume: soundEffectsVolume,
    seat: spectating ? null : yourSeat,
    achievementToastVisible: matchAchievements.toast.length > 0,
  });
  const arsenalDecisionKey =
    view?.pendingDecision?.kind === "arsenal" && view.pendingDecision.player === yourSeat
      ? `${view.turn}:${view.pendingDecision.player}`
      : null;
  useEffect(() => setGameOverDismissed(false), [winnerNow]);
  useEffect(() => setConfirmSkipArsenal(false), [arsenalDecisionKey]);
  // Any authoritative update (including undo) dismisses a pending end-turn warning.
  useEffect(() => setConfirmEndTurn(false), [authoritativeView]);
  // the combat chain window's on-screen rect, reported by ChainFloat so the
  // status window can dock to its right edge
  const [chainRect, setChainRect] = useState<DOMRect | null>(null);
  const [splitLineMiniHost, setSplitLineMiniHost] = useState<HTMLDivElement | null>(null);
  const [hudHost, setHudHost] = useState<HTMLDivElement | null>(null);
  const dividerRef = useRef<HTMLDivElement>(null);
  useHudReserve({
    table: tableRef,
    board: boardRef,
    divider: dividerRef,
    hud: hudHost,
    layoutKey: `${compactBoard}|${squareCardsEnabled}`,
  });
  // idle-opponent prompt: no messages flow while the opponent is idle, so a
  // slow local tick re-evaluates their last-activity stamp
  const { now, dismissedFor: idleDismissedFor, dismiss: dismissIdleVictory } =
    useIdleVictoryPrompt();
  const derived = useMemo(
    () => deriveBoardLegalState(actionCandidates, legal, roomCommandPending),
    [actionCandidates, legal, roomCommandPending],
  );

  const playerView = view !== null && yourSeat !== null ? view.players[yourSeat] : undefined;
  const playerHand = playerView?.hand ?? [];
  const chainClosingPlayIds = derived.canCloseChain && playerView
    ? nonAttackActionPlayIds([
      ...playerView.hand,
      ...playerView.arsenal,
      ...playerView.graveyard,
      ...playerView.banish,
      ...(playerView.visibleDeckTop ? [playerView.visibleDeckTop] : []),
    ])
    : new Set<number>();
  const announcement = useActionAnnouncement({
    actionCandidates,
    legalIntents: legal,
    hand: playerHand,
    chainClosingPlayIds,
    skipPlayConfirmation,
    sendIntent,
  });
  const {
    sel,
    pitchSel,
    meldSide,
    playMethod,
    targetAllyId,
    targetCardInstanceId,
    alternativeCostCardInstanceIds,
    additionalCostConfirmed,
    actionStep,
    alternativeCostSets,
    stagedAdditionalCost: stagedAdditionalCostDefinition,
    stagedAdditionalCostCandidateIds,
    stagedAdditionalCostSelectedIds,
    canConfirmAdditionalCost,
    normalCostPayableWithoutPitch,
    playMethodChoiceRequired,
    paymentProgress,
    selectedAbilityIndexes,
    boostOptions,
    selectedBoostCount,
    selectedPaymentVariants,
    targetVariants,
    autoCommitPending,
    reset: resetSel,
    select: setSel,
    playHandFromDrop,
    togglePitch,
    clearPitch,
    selectAbility,
    selectMeld,
    selectPlayMethod,
    selectAllyTarget,
    selectCardTarget,
    selectBoost,
    confirmChainClose,
    confirmAction,
    selectAlternativeCost,
    toggleAdditionalCostCard,
    confirmAdditionalCost,
  } = announcement;
  const undoAndDismissAnnouncement: typeof undo = (target) => {
    resetSel();
    undo(target);
  };
  const localPitchPayment = sel.kind !== "none" && !autoCommitPending && actionStep === "payment" &&
    (!stagedAdditionalCostDefinition || additionalCostConfirmed) &&
    paymentProgress.kind === "resource" && paymentProgress.required > 0;
  const pendingPitchPayment = view?.pendingDecision?.player === yourSeat
    ? view.pendingDecision?.resourcePayment : undefined;
  const pitchFocusEnabled = !spectating && screen !== "replay";
  const choosingPitch = pitchFocusEnabled && (
    localPitchPayment || (pendingPitchPayment !== undefined &&
      pendingPitchPayment.cost > (playerView?.resources ?? 0) + (playerView?.chi ?? 0))
  );
  const pitchFocusRequested = choosingPitch || (
    pitchFocusEnabled && postPaymentPitchFocus(actionStep, pitchSel.length, paymentProgress.kind)
  );
  const submittedIntent = presentedInteraction?.intent;
  const submittedPitchSourceId = submittedIntent?.kind === "activate-ability" ? submittedIntent.sourceInstanceId
    : submittedIntent?.kind === "play-card" || submittedIntent?.kind === "play-from-arsenal" ||
      submittedIntent?.kind === "play-from-zone" ? submittedIntent.instanceId : undefined;
  const pitchSource = usePitchFocus(
    presentedView, yourSeat, sel, pitchFocusRequested, pitchFocusEnabled, submittedPitchSourceId,
  );
  const defaultBoostCount = boostOptions.find((count) => count > 0) ?? null;
  const actionShortcutReady =
    sel.kind !== "none" &&
    !autoCommitPending &&
    (
      actionStep === "confirm" ||
      actionStep === "close-chain" ||
      (actionStep === "boost" && defaultBoostCount !== null)
    );

  const skippableRun = skippableTokenRun(legal);

  const boundedChoiceKey = boundedCardChoiceKey(view?.pendingDecision ?? null);
  const boundedChoiceSelectedOptionIds =
    boundedChoiceKey !== null && boundedChoiceSelection?.decisionKey === boundedChoiceKey
      ? boundedChoiceSelection.optionIds
      : [];
  const hotkeyIntent = sel.kind === "none"
    ? passHotkeyIntent(legal, view?.pendingDecision ?? null, pitchSel, boundedChoiceSelectedOptionIds)
    : null;
  const passHotkeyEnabled =
    hotkeyIntent !== null &&
    !roomCommandPending &&
    connected &&
    view !== null &&
    screen !== "replay" &&
    !spectating &&
    yourSeat !== null;
  const warnBeforeEndTurn =
    screen !== "replay" &&
    !spectating &&
    shouldWarnBeforeEndTurn(authoritativeView, yourSeat, actionCandidates);
  // Choosing a card or ability instead also dismisses it.
  useEffect(() => {
    if (sel.kind !== "none") setConfirmEndTurn(false);
  }, [sel.kind]);
  useGameShortcuts({
    passEnabled: passHotkeyEnabled && !confirmEndTurn,
    hotkeyIntent,
    pendingDecision: view?.pendingDecision ?? null,
    setConfirmArsenalSkip: setConfirmSkipArsenal,
    warnBeforeEndTurn,
    setConfirmEndTurn,
    onSend: sendIntent,
    onReset: resetSel,
    actionShortcutEnabled: actionShortcutReady,
    actionStep,
    onSelectDefaultBoost: () => {
      if (defaultBoostCount !== null) selectBoost(defaultBoostCount);
    },
    onConfirmAction: confirmAction,
    onConfirmChainClose: confirmChainClose,
  });

  const replaying = screen === "replay";
  const [openSettingsSignal, setOpenSettingsSignal] = useState(0);
  // The account copy of our mat is what opponents see; the local setting is
  // what we see at once. A choice made here waits for the server to echo it
  // before the account copy may override it again.
  const ownsPlaymat = !spectating && !replaying && yourSeat !== null;
  const matSeat: 0 | 1 = yourSeat === 1 ? 1 : 0;
  const pendingPlaymatRef = useRef<PlaymatId | null>(null);
  const carriedPlaymatRef = useRef(false);
  const chooseOwnPlaymat = (next: PlaymatId) => {
    pendingPlaymatRef.current = next;
    updatePlaymat(next);
    void updateAccountCosmetics({ playmat: next === "leather" ? null : next });
  };
  const accountPlaymat = ownsPlaymat && playerProfiles ? playerProfiles[matSeat]?.playmat ?? null : undefined;
  useEffect(() => {
    if (accountPlaymat === undefined) return;
    const pending = pendingPlaymatRef.current;
    if (pending !== null) {
      if (accountPlaymat === (pending === "leather" ? null : pending)) pendingPlaymatRef.current = null;
      return;
    }
    if (accountPlaymat === null) {
      // A mat chosen before accounts kept one is carried over once.
      if (playmat !== "leather" && !carriedPlaymatRef.current) {
        carriedPlaymatRef.current = true;
        void updateAccountCosmetics({ playmat });
      }
      return;
    }
    const resolved = resolvePlaymat(accountPlaymat);
    if (resolved !== playmat) updatePlaymat(resolved);
  }, [accountPlaymat, playmat, updateAccountCosmetics, updatePlaymat]);
  const ownPlaymat = ownsPlaymat ? playmat : resolvePlaymat(playerProfiles?.[matSeat]?.playmat);
  const oppPlaymat = botGame && ownsPlaymat
    ? botPlaymat
    : resolvePlaymat(playerProfiles?.[1 - matSeat]?.playmat);
  const hasPlaymat = ownPlaymat !== "leather" || oppPlaymat !== "leather";
  useMatSeam(boardRef, dividerRef, hasPlaymat);
  const playmatHint = usePlaymatHint({
    eligible: ownsPlaymat && playmat === "leather" && view?.phase !== "game-over",
    resolved: playmat !== "leather",
    username: authUser,
    onChoose: () => setOpenSettingsSignal((count) => count + 1),
  });

  if (!view || !presentedView || (yourSeat === null && !spectating)) return null;
  const causal = causalStatus(view, spectating ? null : yourSeat);
  const seat: 0 | 1 = yourSeat === 1 ? 1 : 0; // spectators watch from seat 0's side of the table
  const liveNoteFrame = !replaying && replayFrames > 0 ? replayFrames - 1 : null;
  const liveNoteRoomVersion = !replaying && viewUpdate.source === "live"
    ? viewUpdate.roomVersion ?? null
    : null;
  const liveNoteText = liveNoteFrame === null
    ? null
    : replayNotes.find((note) =>
        note.roomVersion === liveNoteRoomVersion
        || (note.roomVersion === undefined && note.frame === liveNoteFrame))?.text ?? null;
  const canSendEmote = !spectating && !replaying && connected;
  const authoritativeMe = view.players[seat]!;
  const me = presentedView.players[seat]!;
  const opp = presentedView.players[seat === 0 ? 1 : 0]!;
  const arenaPaymentCandidateIds = new Set(
    sel.kind !== "none" &&
      actionStep === "payment" &&
      (!stagedAdditionalCostDefinition || additionalCostConfirmed)
      ? me.board
          .filter((card) =>
            pitchSel.includes(card.instanceId) ||
            canAddPaymentCard(selectedPaymentVariants, pitchSel, card.instanceId)
          )
          .map((card) => card.instanceId)
      : [],
  );
  const authoritativeVisibleDeckTop = !spectating
    ? visibleDeckTop(authoritativeMe, deckCardFeedback.shuffledSeats.has(authoritativeMe.seat))
    : undefined;
  const myVisibleDeckTop = !spectating
    ? visibleDeckTop(me, deckCardFeedback.shuffledSeats.has(me.seat))
    : undefined;
  const optimisticallyHiddenIds = optimisticInteractionHiddenIds(
    !spectating && !replaying ? (pendingInteraction?.intent ?? null) : null,
    authoritativeMe,
    authoritativeVisibleDeckTop,
  ) ?? EMPTY_INSTANCE_IDS;
  const hiddenHandIds = new Set(optimisticallyHiddenIds);
  if (pitchSource?.fromHand) hiddenHandIds.add(pitchSource.card.instanceId);
  const presentedHandCount = presentedDefenderHandCount(presentedView, seat, hiddenHandIds);
  const presentedOppHandCount = presentedDefenderHandCount(presentedView, opp.seat);
  const pd = presentedView.pendingDecision;
  const myDecision = !spectating && pd !== null && pd.player === seat;
  const showCardSearchOverlay = myDecision && isCardSearchOverlayDecision(pd);
  const pendingPreStackPlayId = (() => {
    const intent = !spectating && !replaying ? pendingInteraction?.intent : undefined;
    return intent && (
      intent.kind === "play-card" ||
      intent.kind === "play-from-arsenal" ||
      intent.kind === "play-from-zone"
    ) && intent.deferPlayPresentation
      ? intent.instanceId
      : null;
  })();
  const preStackSelectedInstanceId = pendingPreStackPlayId
    ?? (myDecision ? (pd.preStackSource?.card.instanceId ?? null) : null);
  const resourcePayment = myDecision ? pd.resourcePayment : undefined;
  const resourcePaymentSelected = resourcePayment
    ? pitchSel.reduce((total, instanceId) => {
        const card = me.hand.find((candidate) => candidate.instanceId === instanceId);
        return total + (card ? (cardData[card.cardId]?.pitch ?? 0) : 0);
      }, 0)
    : 0;
  const resourcePaymentRequired = resourcePayment
    ? Math.max(0, resourcePayment.cost - me.resources - (me.chi ?? 0))
    : 0;
  const livePriority: PriorityPresentation = {
    gameId: presentedView.gameId,
    holder: presentedView.phase === "game-over"
      ? null
      : pd !== null
        ? pd.player
        : gameHasPriority(presentedView) ? presentedView.priorityPlayer : null,
    priorityPlayer: gameHasPriority(view) ? view.priorityPlayer : null,
    timingLabel: gameTimingLabel(view),
  };
  livePriorityRef.current = livePriority;
  const settledPriority = settledPriorityRef.current;
  const presentedPriority = settledPriority === null
    || gameMotion.motionSettled
    || settledPriority.gameId !== livePriority.gameId
    ? livePriority
    : settledPriority;
  // Gate the viewer's affordances only while a hand-off to them is in flight;
  // their own plays never wait.
  const awaitingHandoff = presentedPriority !== livePriority
    && presentedPriority.holder !== seat
    && presentedPriority.priorityPlayer !== seat;
  // An open resource payment is a hand-card choice, rather than an invitation
  // to start another play or ability from the arena or inactive zones.
  const boardActionState = choosingPitch || awaitingHandoff
    ? deriveBoardLegalState([], legal, true)
    : derived;
  const myTurn = view.activePlayer === seat;
  const activeHeroName = view.players[view.activePlayer]?.heroName ?? "";
  const turnLabel = spectating
    ? intl.formatMessage({ id: "game.turn.named" }, { player: activeHeroName })
    : myTurn
      ? intl.formatMessage({ id: "game.turn.yours" })
      : intl.formatMessage({ id: "game.turn.opponent" });
  const hasActiveCombatChain = presentedView.chain.length > 0;
  const activeChainAttackerInstanceId = hasActiveCombatChain
    ? presentedView.chain[presentedView.chain.length - 1]!.attackingCard.instanceId
    : null;
  const optionCardLabels = cardChoiceLocationLabels(
    me.heroInstanceId,
    opp.heroInstanceId,
    me.weapons.map((weapon) => weapon.instanceId),
    {
      yourHero: intl.formatMessage(
        { id: "game.zone.mine" },
        { zone: intl.formatMessage({ id: "game.zone.hero" }) },
      ),
      opponentHero: intl.formatMessage(
        { id: "game.zone.opponent" },
        { zone: intl.formatMessage({ id: "game.zone.hero" }) },
      ),
      leftWeapon: intl.formatMessage({ id: "game.zone.weapon.left" }),
      rightWeapon: intl.formatMessage({ id: "game.zone.weapon.right" }),
    },
  );
  const showPriorityFloat = !spectating && !replaying && presentedPriority.priorityPlayer !== null;
  const hasOwnPriority = showPriorityFloat && presentedPriority.priorityPlayer === seat;
  const priorityHolder = presentedPriority.holder;
  const priorityHolderName = priorityHolder === null
    ? ""
    : (presentedView.players[priorityHolder]?.heroName ?? "");
  const priorityLabel = presentedPriority.priorityPlayer === seat ? "YOUR PRIORITY" : "OPPONENT'S PRIORITY";
  const priorityTimingLabel = presentedPriority.timingLabel;
  const showEndTurnPassToast =
    !spectating &&
    !replaying &&
    view.endTurnPassPending === true &&
    view.activePlayer !== seat;
  const timingFloat = showPriorityFloat ? (
    <PriorityFloat
      turn={view.turn}
      turnLabel={turnLabel}
      timingLabel={priorityTimingLabel}
      priorityLabel={priorityLabel}
    />
  ) : !spectating && !replaying && pd ? (
    <TurnTimingFloat
      turn={view.turn}
      turnLabel={turnLabel}
      timingLabel={priorityTimingLabel}
    />
  ) : null;
  const chainTimingStatus = showPriorityFloat ? (
    <ChainPriorityStatus
      timingLabel={priorityTimingLabel}
      priorityLabel={priorityLabel}
    />
  ) : pd ? (
    <ChainTimingStatus
      label={pd.kind === "defend" ? causal.heading : priorityTimingLabel}
    />
  ) : null;
  const winnerName = view.winner !== null ? (view.players[view.winner]?.heroName ?? "") : "";
  const committedDefenderIds = chainDefenderIds(presentedView.chain);

  // idle opponent: offer to claim the win (server re-validates the same rule).
  // Only the seat the game is NOT waiting on may claim — the idle player must
  // be the one holding up the game (their turn or their pending decision), so
  // you never see this off your own inaction.
  const waitingOnOpp = pd !== null ? pd.player !== seat : view.activePlayer !== seat;
  const oppLastAction = !spectating && yourSeat !== null ? (lastActionAt?.[1 - seat] ?? 0) : 0;
  const oppIdleMs = oppLastAction > 0 ? now - oppLastAction : 0;
  const showIdleToast = shouldShowIdleVictoryClaim({
    botGame,
    replaying,
    gameOver: view.phase === "game-over",
    waitingOnOpponent: waitingOnOpp,
    opponentLastAction: oppLastAction,
    opponentIdleMs: oppIdleMs,
    dismissedFor: idleDismissedFor,
  });

  /** Short authoritative UI label projected for one of a source's abilities. */
  const abilityLabel = (sourceInstanceId: number, index: number) =>
    abilityLabelForSource(me, view.chain, sourceInstanceId, index);

  const clickActivate = (sourceInstanceId: number) => () => {
    const indexes = abilityIndexes(actionCandidates, sourceInstanceId);
    if (indexes.length === 1) {
      setSel({ kind: "activate", sourceInstanceId, abilityIndex: indexes[0] });
    } else if (indexes.length > 1) {
      setSel({ kind: "activate", sourceInstanceId });
    }
  };

  const send = (intent: GameIntent) => {
    if (sendIntent(intent)) resetSel();
  };
  const requestPass = () => {
    if (roomCommandPending) return;
    const intent = { kind: "pass" } as const;
    if (shouldConfirmArsenalPass(pd, intent)) {
      setConfirmSkipArsenal(true);
      return;
    }
    if (warnBeforeEndTurn) {
      setConfirmEndTurn(true);
      return;
    }
    send(intent);
  };
  /** staged (uncommitted) defenders ride the defend decision in the view, so
   *  both players see the selection as it happens — the opponent sees hand
   *  cards face-down and a 0 defense total, staged equipment stays face-up */
  const defending = !replaying && myDecision && pd !== null && pd.kind === "defend";
  /** my arsenal decision: every hand card is a valid choice — highlight them */
  const choosingArsenal = !replaying && myDecision && pd !== null && pd.kind === "arsenal";
  /** scripted card-picks whose options all live in my hand (Death Dealer,
   *  Reload, …): the card is clicked in the hand row — instanceId → optionId */
  const handPick = replaying || !myDecision ? null : handCardChoiceOptions(pd, me.hand);
  const boundedCardChoice = replaying || !myDecision ? null : boundedCardChoiceModel(pd);
  const boundedHandPick = replaying || !myDecision
    ? null
    : boundedHandCardChoiceOptions(pd, me.hand);
  const toggleBoundedChoice = (optionId: string) => {
    if (!boundedCardChoice || boundedChoiceKey === null) return;
    setBoundedChoiceSelection((current) => {
      const selected = current?.decisionKey === boundedChoiceKey ? current.optionIds : [];
      if (!boundedCardChoiceSelectable(boundedCardChoice, selected, optionId)) return current;
      return {
        decisionKey: boundedChoiceKey,
        optionIds: toggleBoundedCardChoice(selected, optionId, boundedCardChoice.maximumSelections),
      };
    });
  };
  const selectedBoundedChoiceOptionIds = new Set(boundedChoiceSelectedOptionIds);
  const stagedDefenders: CardView[] = pd?.kind === "defend" ? (pd.stagedCards ?? []) : [];
  const stagedIds = new Set(stagedDefenders.map((c) => c.instanceId));
  /** live defense total of the staged defenders (0 for the opponent) */
  const stagedDefense = pd?.kind === "defend" ? (pd.stagedDefense ?? 0) : 0;
  const stagedAttack = pd?.kind === "defend" ? pd.stagedAttack : undefined;
  const stagedAttackModifiers = pd?.kind === "defend" ? pd.stagedAttackModifiers : undefined;
  /** declarative staging: send the full staged set (the server validates) */
  const stage = (ids: Iterable<number>) =>
    sendIntent({ kind: "stage-defenders", instanceIds: [...ids] });
  const unstage = (id: number) => stage([...stagedIds].filter((x) => x !== id));

  const onHandClick = (c: CardView) => {
    if (defending) {
      stage([...stagedIds, c.instanceId]);
      return;
    }
    if (myDecision && pd.kind === "arsenal") {
      send({ kind: "choose", optionId: String(c.instanceId) });
      return;
    }
    if (handPick) {
      const optionId = handPick.get(c.instanceId);
      if (optionId !== undefined) send({ kind: "choose", optionId });
      return;
    }
    if (boundedHandPick) {
      const optionId = boundedHandPick.get(c.instanceId);
      if (optionId !== undefined) toggleBoundedChoice(optionId);
      return;
    }
    if (resourcePayment) {
      if (pitchSel.includes(c.instanceId)) {
        togglePitch(c.instanceId);
        return;
      }
      if (!canAddResourcePaymentPitch(resourcePayment, pitchSel, c.instanceId)) return;
      const nextPitch = [...pitchSel, c.instanceId];
      const paymentOption = selectedResourcePaymentOption(resourcePayment, nextPitch);
      if (paymentOption) send({ kind: "choose", optionId: paymentOption.optionId });
      else togglePitch(c.instanceId);
      return;
    }
    if (sel.kind !== "none") {
      // clicking the selected card again deselects it — a card can never
      // pitch itself (the engine rejects it in payCost)
      if (
        ((sel.kind === "play-hand" || sel.kind === "choose-hand-action") &&
          c.instanceId === sel.instanceId) ||
        (sel.kind === "activate" && c.instanceId === sel.sourceInstanceId)
      ) {
        resetSel();
        return;
      }
      if (actionStep !== "payment") return;
      // This declared additional cost is chosen before any resource pitch.
      // Its cards are selected in the decision panel, not from the hand row.
      if (stagedAdditionalCostDefinition && !additionalCostConfirmed) return;
      if (
        pitchSel.includes(c.instanceId) ||
        canAddPaymentCard(
          selectedPaymentVariants,
          pitchSel,
          c.instanceId,
          (instanceId) => {
            const card = playerHand.find((candidate) => candidate.instanceId === instanceId);
            return card ? (cardData[card.cardId]?.pitch ?? 0) : 0;
          },
        )
      ) togglePitch(c.instanceId);
      return;
    }
    const selection = handCardSelection(actionCandidates, c.instanceId);
    if (selection) setSel(selection);
  };

  const selCardId: string | undefined = (() => {
    if (sel.kind === "play-hand" || sel.kind === "choose-hand-action") {
      return me.hand.find((x) => x.instanceId === sel.instanceId)?.cardId;
    }
    if (sel.kind === "play-arsenal") {
      return me.arsenal.find((x) => x.instanceId === sel.instanceId)?.cardId;
    }
    if (sel.kind === "play-zone") {
      return [
        ...presentedView.players.flatMap((player) => [
          ...player.banish,
          ...player.graveyard,
        ]),
        ...(myVisibleDeckTop ? [myVisibleDeckTop] : []),
      ].find((x) => x.instanceId === sel.instanceId)?.cardId;
    }
    if (sel.kind === "activate") {
      const id = sel.sourceInstanceId;
      if (id === me.heroInstanceId) return me.heroCardId;
      return [
        ...me.hand,
        ...me.arsenal,
        ...me.weapons,
        ...Object.values(me.equipment),
        ...me.board,
        ...me.graveyard,
        ...me.banish,
        ...view.chain.flatMap((link) => [
          link.attackingCard,
          ...link.defendingCards,
          ...link.reactions,
        ]),
      ].find(
        (x) => x?.instanceId === id,
      )?.cardId;
    }
    return undefined;
  })();

  /** Meld split cards: side buttons (names parsed from "Left // Right");
   *  "both" plays the whole card for twice the base cost (CR 8.3.38) */
  const meldChoices = (() => {
    if (!selCardId || sel.kind === "activate" || sel.kind === "choose-hand-action") return [];
    const d = cardData[selCardId];
    if (!d || !(d.keywords ?? []).some((k) => k.toLowerCase() === "meld")) return [];
    const [left = d.name, right = ""] = d.name.split(" // ");
    const offered = new Set(offeredMeldSides(actionCandidates, sel));
    return [
      { side: "left" as MeldSide, label: left },
      { side: "right" as MeldSide, label: right },
      { side: "both" as MeldSide, label: "Meld (both)" },
    ].filter((choice) => offered.has(choice.side));
  })();

  const boundNamesByTarget = new Map<number, string[]>();
  for (const card of view.players.flatMap((player) => player.board)) {
    if (card.boundToInstanceId === undefined) continue;
    const names = boundNamesByTarget.get(card.boundToInstanceId) ?? [];
    names.push(cardData[card.cardId]?.name ?? card.cardId);
    boundNamesByTarget.set(card.boundToInstanceId, names);
  }

  /** Attack-target choices for the current selection (CR 8.2.8d): the opposing
   *  hero plus each opposing ally — the legal intents carry one variant per
   *  target. Empty when no ally variants are offered. */
  const targetChoices = (() => {
    if (sel.kind === "none") return [];
    const allyIds = new Set<number>();
    let heroOffered = false;
    for (const i of targetVariants) {
      if (i.targetAllyId !== undefined) allyIds.add(i.targetAllyId);
      else heroOffered = true;
    }
    if (allyIds.size === 0) return [];
    return [
      ...(heroOffered
        ? [{ id: null as number | null, label: opp.heroName, card: heroCard(opp) }]
        : []),
      ...[...allyIds].flatMap((id) => {
        const card = opp.board.find((candidate) => candidate.instanceId === id);
        return card
          ? [{
              id: id as number | null,
              label: cardData[card.cardId]?.name ?? "an ally",
              card,
              life: card.life,
              boundCardNames: boundNamesByTarget.get(id),
            }]
          : [];
      }),
    ];
  })();

  /** Card targets announced by target-aware plays and activated abilities. */
  const cardTargetChoices = (() => {
    if (sel.kind === "none" || sel.kind === "choose-hand-action") return [];
    const ids = new Set<number>();
    for (const intent of targetVariants) {
      if (intent.targetCardInstanceId === undefined) continue;
      if (intent.kind === "activate-ability") {
        if (sel.kind === "activate" && intent.sourceInstanceId === sel.sourceInstanceId) {
          ids.add(intent.targetCardInstanceId);
        }
      } else if (sel.kind !== "activate" && intent.instanceId === sel.instanceId) {
        ids.add(intent.targetCardInstanceId);
      }
    }
    const combatCards = view.chain.flatMap((link) => [link.attackingCard, ...link.defendingCards]);
    const stackCards = view.stack.flatMap((layer) => (layer.card ? [layer.card] : []));
    const publicZoneCards = view.players.flatMap((player) => [
      ...player.banish,
      ...player.graveyard,
      ...player.board,
      ...player.weapons,
      ...Object.values(player.equipment).filter((card): card is CardView => card !== undefined),
    ]);
    const choices = [...ids].flatMap((id) => {
      const card = [...stackCards, ...combatCards, ...publicZoneCards]
        .find((candidate) => candidate.instanceId === id);
      if (!card) return [];
      const playPermission = targetPlayPermissionNote(intl, card);
      return [{
        id,
        label: cardData[card.cardId]?.name ?? "card",
        card,
        life: card.life,
        boundCardNames: boundNamesByTarget.get(id),
        ...(playPermission !== undefined ? { playPermission } : {}),
      }];
    });
    // Cards an effect already made playable are rarely the intended target;
    // list the fresh ones first.
    return [
      ...choices.filter((choice) => choice.playPermission === undefined),
      ...choices.filter((choice) => choice.playPermission !== undefined),
    ];
  })();
  const controlledCards = [
    ...me.hand,
    ...me.board,
    ...me.weapons,
    ...Object.values(me.equipment).filter((card): card is CardView => card !== undefined),
  ];
  const alternativeCostChoices = [...alternativeCostSets.entries()].map(([key, instanceIds]) => ({
    key,
    instanceIds,
    cards: instanceIds.map(
      (instanceId) => controlledCards.find((card) => card.instanceId === instanceId),
    ),
  }));
  const stagedAdditionalCost = stagedAdditionalCostDefinition ? (() => {
    const handCards = me.hand.filter((card) => stagedAdditionalCostCandidateIds.has(card.instanceId));
    const arenaCards = [
      ...me.board,
      ...me.weapons,
      ...Object.values(me.equipment).filter((card): card is CardView => card !== undefined),
    ].filter((card) => stagedAdditionalCostCandidateIds.has(card.instanceId));
    return {
      cardLabel: stagedAdditionalCostDefinition.cardLabel,
      minimum: stagedAdditionalCostDefinition.minimum,
      maximum: stagedAdditionalCostDefinition.maximum,
      selectedInstanceIds: stagedAdditionalCostSelectedIds,
      modes: stagedAdditionalCostDefinition.modes.flatMap((mode) => {
        const cards = mode.kind === "destroy" ? arenaCards : handCards;
        return cards.length > 0 ? [{ mode: mode.kind, maximum: mode.maximum, cards }] : [];
      }),
    };
  })() : undefined;
  const defendIntent = selectedDefendIntent(legal, [...stagedIds], pitchSel);
  const defendPitchIds = new Set(
    legal.flatMap((intent) =>
      intent.kind === "defend" &&
      intent.instanceIds.length === stagedIds.size &&
      intent.instanceIds.every((id) => stagedIds.has(id))
        ? (intent.pitchInstanceIds ?? [])
        : [],
    ),
  );

  // no available action at all → we're just waiting on the opponent
  const waitingForOpponent =
    view.phase !== "game-over" &&
    !myDecision &&
    sel.kind === "none" &&
    !derived.canPass &&
    derived.playableHand.size === 0 &&
    derived.playableZones.size === 0 &&
    derived.activatable.size === 0 &&
    derived.playableArsenal.size === 0;

  // Pass-only windows, defend confirmation, and the arsenal skip action live
  // in the status float. Arsenal confirmation still appears after Pass.
  const statusPassDecision =
    myDecision &&
    pd !== null &&
    (handPlayWindow(pd.kind) || pd.kind === "arsenal");
  // Priority/reaction cards remain highlighted and Pass stays exclusively in
  // the status float, so this guidance prompt can follow the preference. On a
  // mobile viewport, collapsing the hand also clears it off the battlefield.
  const hidePriorityGuidance = shouldHidePriorityGuidance(pd, {
    isMine: myDecision,
    lessGuidance,
    mobileHandIsHidden,
  });
  const primaryAction: PrimaryAction | null = sel.kind !== "none"
    ? null
    : defending
      ? stagedIds.size > 0 ? "confirm-blocks" : "confirm-no-blocks"
      : myDecision
        ? derived.canPass && statusPassDecision
          ? "pass"
          : null // button-choice decisions carry their own pass/decline button
        : spectating || replaying || view.phase === "game-over"
          ? null
          : view.phase === "action" && myTurn
            ? "end-turn"
            : "pass";
  const primaryActionDisabled =
    roomCommandPending ||
    awaitingHandoff ||
    !connected ||
    (defending ? defendIntent === null : !derived.canPass);
  const triggerPrimaryAction = defending
    ? () => {
        if (defendIntent) send(defendIntent);
      }
    : requestPass;

  // Require mouse movement: animations can fire mouseover when a card moves
  // under a stationary pointer, including Dash I/O's changing deck top.
  const onHoverCard = (e: React.MouseEvent) => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const target = e.target as HTMLElement;
    // Counter icons have their own focused tooltip. Suppress the large card
    // preview while the pointer is on one so the two surfaces never collide.
    if (target.closest(".c-ovl, .pitch-focus-card")) {
      setPreview(null);
      return;
    }
    const el = hoverPreviewTarget(target);
    if (!el) {
      setPreview(null);
      return;
    }
    const r = el.getBoundingClientRect();
    const cardId = el.dataset.cardid ?? null;
    const effect = readEffectHint(el.dataset);
    const badges = renderedCardBadges(el);
    // Moving within the same card should not rerender the whole board.
    if (
      preview && previewTargetRef.current === el && preview.id === cardId &&
      sameEffectHint(preview.effect, effect) && preview.badges === badges
    ) return;
    previewTargetRef.current = el;
    if (!cardId && effect) {
      // No source card: the hint floats over the chip, on its roomier side.
      const above = r.top >= window.innerHeight - r.bottom;
      const maxWidth = Math.min(340, window.innerWidth - 16);
      setPreview({
        id: null,
        x: 0,
        y: 0,
        effect,
        effectPosition: {
          left: Math.min(Math.max(r.left, 8), window.innerWidth - maxWidth - 8),
          maxWidth,
          ...(above
            ? { bottom: window.innerHeight - r.top + 8 }
            : { top: r.bottom + 8 }),
        },
      });
      return;
    }
    if (!cardId) {
      setPreview(null);
      return;
    }
    const previewSize = cardPreviewSize(window.innerHeight);
    const previewSurfaceSize = cardPreviewSurfaceSize(cardId, previewSize);
    // A ledger row previews its source beside the ledger rather than over it.
    const ledger = el.closest<HTMLElement>(".effect-ledger")?.getBoundingClientRect();
    const anchor = ledger ? new DOMRect(ledger.left, r.top, ledger.width, r.height) : r;
    const layout = hoverSurfaceLayout(
      anchor,
      { width: window.innerWidth, height: window.innerHeight },
      previewSurfaceSize,
      240, // keep the card preview clear of the side panel when space permits
    );
    // Contextual card explanations use the preview side.
    el.dataset.previewSide = layout.side;
    setPreview({
      id: cardId,
      x: layout.x,
      y: layout.y,
      size: previewSize,
      ...(badges ? { badges } : {}),
      ...(effect ? { effect } : {}),
    });
  };

  // Touch screens have no hover preview. Tapping an inert card or holding any
  // card opens the full-size sheet; a short tap on an actionable card acts.
  const onTableClick = (e: React.MouseEvent) => {
    if (!isTouchBoardViewport()) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, .card-clickable, .overlay")) return;
    const card = target.closest<HTMLElement>("[data-cardid]");
    const cardId = card?.dataset.cardid;
    if (cardId) setInspectedCardId(cardId);
  };

  const onTableClickCapture = (event: React.MouseEvent) => {
    const target = event.target as HTMLElement;
    // Modal and toast controls own the tap, including dismissal of a card inspection.
    // Capture runs before their close handlers and must not reset the action.
    if (target.closest(".modal-surface-backdrop, .achievement-toast")) return;
    cardLongPressHandlers.onClickCapture(event);
    if (event.defaultPrevented) return;

    const insideChoiceSurface = target.closest(
      "#player-hand, .decision-float, .card-search-overlay, .pitch-focus-card",
    ) !== null;
    const dismissal = handChoiceDismissal(
      sel.kind === "play-hand" || sel.kind === "choose-hand-action",
      !roomCommandPending && myDecision && pd?.preStackSource?.zone === "hand",
      insideChoiceSurface,
    );
    if (dismissal === null) return;

    // Treat the first outside click as dismissal, like a blurred popover,
    // instead of also activating the control underneath it.
    event.preventDefault();
    event.stopPropagation();
    if (dismissal === "reset-local") resetSel();
    else undoAndDismissAnnouncement("last-action");
  };

  const effectHeroList = effectHeroes(
    intl,
    view.players,
    view.players.map((player) => playerProfiles?.[player.seat]?.username),
  );

  const playerHalfInteraction = {
    legal: boardActionState,
    selection: sel,
    paymentCandidateIds: choosingPitch ? EMPTY_INSTANCE_IDS : arenaPaymentCandidateIds,
    paymentSelectedIds: new Set(pitchSel),
    preStackSelectedInstanceId,
    stagedIds,
    committedDefenderIds,
    optimisticallyHiddenIds,
    defending,
    onStage: stage,
    onSelectPaymentCard: togglePitch,
    onActivate: (instanceId: number) => clickActivate(instanceId)(),
    onSelect: setSel,
  };

  const canUndo = !spectating && !replaying && view.phase !== "game-over";
  const oppNameplate = playerProfiles ? (
    <PlayerNameplate
      placement="opponent"
      profile={playerProfiles[1 - seat]!}
      actions={authUser && roomCode && !spectating && !botGame && !replaying ? (
        <OpponentActions
          username={playerProfiles[1 - seat]!.username}
          roomCode={roomCode}
          onReport={reportOpponent}
        />
      ) : null}
    />
  ) : null;
  const selfNameplate = playerProfiles ? (
    <PlayerNameplate placement="self" profile={playerProfiles[seat]!} />
  ) : null;
  const oppHandRevealed = view.phase === "game-over" || replaying;
  const oppHand = (
    <div
      className={`opp-hand${oppHandRevealed ? " opp-hand-revealed" : ""}`}
      data-motion-zone={motionLocationKey({ kind: "hand", seat: opp.seat })}
      role="group"
      aria-label={intl.formatMessage({ id: "game.hand.opponentCount" }, { count: presentedOppHandCount })}
      style={{
        "--fan-n": Math.max(1, oppHandRevealed ? opp.hand.length : presentedOppHandCount),
      } as CSSProperties}
    >
      {oppHandRevealed
        ? opp.hand.map((card, i) => (
            <CardFace
              key={card.instanceId}
              card={card}
              style={handFanSlotStyle(i)}
              motionKey={motionPresentationKey(
                { kind: "hand", seat: opp.seat },
                card.instanceId,
              )}
            />
          ))
        : Array.from({ length: presentedOppHandCount }, (_, i) => (
            <CardBack
              key={i}
              label=""
              size="hand"
              style={handFanSlotStyle(i)}
              motionKey={opaqueMotionPresentationKey(
                { kind: "hand", seat: opp.seat },
                i,
              )}
              motionZoneAnchor={i === presentedOppHandCount - 1
                ? motionLocationKey({ kind: "hand", seat: opp.seat })
                : undefined}
            />
          ))}
      {presentedOppHandCount === 0 && <span className="muted">opponent has no cards in hand</span>}
      <span className="opp-hand-count" aria-hidden="true">{presentedOppHandCount}</span>
    </div>
  );
  return (
    <EffectHeroesContext.Provider value={effectHeroList}>
    <CardArtProvider art={cardArt}>
    <SquareCardPresentation enabled={squareCardsEnabled}>
    <div
      ref={tableRef}
      className={`table${railCollapsed ? " rail-is-collapsed" : ""}${view.phase === "game-over" ? " game-is-over" : ""}${hasActiveCombatChain ? " has-active-combat-chain" : ""}${mobileHandIsHidden ? " mobile-hand-is-hidden" : ""}${compactHud ? " hud-is-compact" : ""}${hasPlaymat ? " has-playmat" : ""}`}
      data-playability-cue={playabilityCuePreference}
      data-motion-preference={motionPreference}
      onMouseMove={onHoverCard}
      onMouseOut={(event) => {
        // mouseout also fires between children of one hovered target, such as
        // an effect chip's art and text. Keep the preview instead of flashing it.
        const next = event.relatedTarget;
        if (next instanceof Node && previewTargetRef.current?.contains(next)) return;
        setPreview(null);
      }}
      onMouseLeave={() => setPreview(null)}
      {...cardLongPressHandlers}
      onClickCapture={onTableClickCapture}
      onClick={onTableClick}
    >
      <AchievementToast
        achievements={matchAchievements.toast}
        percent={matchAchievements.toastPercent}
        exiting={matchAchievements.toastExiting}
        onViewAchievements={() => { leave(); setLobbyRail("achievements"); }}
      />
      <PriorityArrivalFlash hasOwnPriority={hasOwnPriority} />
      {playmatHint.visible
        ? <PlaymatHintToast onChoose={playmatHint.choose} onDismiss={playmatHint.dismiss} />
        : null}
      {/* ── playmat board: opponent half on top, your half below ── */}
      <div ref={boardRef} className="board">
        <PlaymatArt key={`opp:${oppPlaymat}`} side="opp" playmat={oppPlaymat} />
        <PlaymatArt key={`own:${ownPlaymat}`} side="own" playmat={ownPlaymat} />
        {gameMotion.turnStartUiReady && pitchSource ? (
          <PitchFocus
            key={pitchSource.card.instanceId}
            source={pitchSource}
            seat={seat}
            motionPreference={motionPreference}
            getStackFocusOrigin={gameMotion.getStackFocusOrigin}
            getHandFocusOrigin={gameMotion.getHandFocusOrigin}
          />
        ) : null}
        <BrowserBotNotice />
        {/* Phone landscape seats these in the rail's player plates. */}
        {mobileLandscapeViewport ? null : (
          <>
            {oppNameplate}
            {selfNameplate}
            {oppHand}
          </>
        )}

        {/* opponent half — mirrored vertically, same columns as yours */}
        <PlayerHalf
          player={opp}
          mine={false}
          mirrored
          holdsPriority={priorityHolder === opp.seat}
          ongoing={view.ongoing.filter((effect) => effect.seat === opp.seat)}
          gameOver={view.phase === "game-over"}
          replaying={replaying}
          deckShuffling={deckCardFeedback.shuffledSeats.has(opp.seat)}
          interaction={playerHalfInteraction}
          latestEmote={latestEmote}
          canSendEmote={canSendEmote}
          mobileFloatViewport={mobileFloatViewport}
          mobileLandscapeViewport={mobileLandscapeViewport}
          compactBoard={compactBoard}
          cardDisplayPreference={cardDisplayPreference}
          activeChainAttackerInstanceId={activeChainAttackerInstanceId}
          onSendEmote={sendEmote}
          onOpenOverlay={setOverlay}
          onOpenEffects={openEffectLedger}
        />

        {/* center divider: a brass-inlay strip marking the seam */}
        <div className="mat-divider" ref={dividerRef}>
          {priorityHolder !== null ? (
            <span className="mat-priority-status" role="status">
              {intl.formatMessage({ id: "game.decision.playerDeciding" }, { player: priorityHolderName })}
            </span>
          ) : null}
          <div className="mat-divider-center">
            {showEndTurnPassToast && !mobileFloatViewport
              ? <EndTurnPassToast placement="divider" />
              : null}
            {timingFloat}
            <div className="mat-divider-mini-dock" ref={setSplitLineMiniHost} />
          </div>
        </div>

        {/* your half */}
        <PlayerHalf
          player={me}
          // Live spectators have a table orientation, but do not own its
          // lower seat. Treating it as theirs hides the public arsenal count
          // whenever that arsenal contains only face-down cards. Replays keep
          // their recorded player perspective while exposing replay data.
          mine={!spectating || replaying}
          mirrored={false}
          holdsPriority={priorityHolder === me.seat}
          priorityPulse={hasOwnPriority}
          ongoing={view.ongoing.filter((effect) => effect.seat === me.seat)}
          gameOver={view.phase === "game-over"}
          replaying={replaying}
          visibleDeckTop={myVisibleDeckTop}
          deckShuffling={deckCardFeedback.shuffledSeats.has(me.seat)}
          interaction={playerHalfInteraction}
          latestEmote={latestEmote}
          canSendEmote={canSendEmote}
          mobileFloatViewport={mobileFloatViewport}
          mobileLandscapeViewport={mobileLandscapeViewport}
          compactBoard={compactBoard}
          cardDisplayPreference={cardDisplayPreference}
          activeChainAttackerInstanceId={activeChainAttackerInstanceId}
          onSendEmote={sendEmote}
          onOpenOverlay={setOverlay}
          onOpenEffects={openEffectLedger}
          standingOrders={standingOrders}
        />

        <PlayerHand
          key={`${presentedView.gameId}:${me.seat}`}
          view={presentedView}
          player={me}
          viewerSeat={seat}
          spectating={spectating}
          replaying={replaying}
          motionPreference={motionPreference}
          interaction={{
            legalState: boardActionState,
            legalIntents: legal,
            selection: sel,
            preStackSelectedInstanceId,
            pitchSelection: pitchSel,
            choosingPitch,
            focusedSourceInstanceId: pitchSource?.fromHand ? pitchSource.card.instanceId : null,
            selectedPaymentVariants:
              stagedAdditionalCostDefinition && !additionalCostConfirmed
                ? []
                : selectedPaymentVariants,
            resourcePayment,
            stagedIds,
            optimisticallyHiddenIds,
            defending,
            choosingArsenal,
            handPick,
            boundedHandPick,
            selectedBoundedChoiceOptionIds,
            onCardClick: onHandClick,
            onActivate: (instanceId) => clickActivate(instanceId)(),
            onSelect: setSel,
            onHandDrop: (instanceId, action) => {
              if (action === "play") {
                playHandFromDrop(instanceId);
                return;
              }
              // Blocking and arsenal drops act exactly like clicking the card.
              const card = me.hand.find((candidate) => candidate.instanceId === instanceId);
              if (card) onHandClick(card);
            },
            onDragStart: (action) => {
              setPreview(null);
              // Light up a block or arsenal destination without re-rendering the board.
              if (action === "block" || action === "arsenal") {
                tableRef.current?.setAttribute("data-hand-drop", action);
              }
            },
            onDragEnd: () => tableRef.current?.removeAttribute("data-hand-drop"),
          }}
        />
      </div>

      {/* Fixed HUD sibling: keeping this outside .board guarantees that
          waiting-state changes cannot affect board layout or motion anchors. */}
      <div
        className={`waiting${spectating ? " waiting-spectating" : ""}${waitingForOpponent && !replaying ? "" : " waiting-hidden"}`}
        aria-hidden={waitingForOpponent && !replaying ? undefined : true}
      >
        {spectating
          // Phones have no room for the hero's name here; the lit HUD
          // portrait already says whose action is awaited.
          ? mobileFloatViewport
            ? intl.formatMessage({ id: "game.waiting.spectating.short" })
            : intl.formatMessage({ id: "game.waiting.spectating" }, { hero: activeHeroName })
          : intl.formatMessage({ id: "game.waiting.opponent" })}
      </div>

      <MobileHandToggle
        expanded={!mobileHandIsHidden}
        cardCount={presentedHandCount}
        onToggle={toggleMobileHand}
      />

      {showEndTurnPassToast && mobileFloatViewport
        ? <EndTurnPassToast placement="mobile-hand" />
        : null}

      {/* ── floating status window: life + remaining AP + pass.
          Docks to the right edge of the combat chain while it's open ── */}
      <StatusFloat
        dockRect={chainRect}
        hostRef={setHudHost}
        oppLife={opp.life}
        myLife={me.life}
        oppHeroName={opp.heroName}
        myHeroName={me.heroName}
        oppHeroCardId={opp.heroCardId}
        myHeroCardId={me.heroCardId}
        oppMarked={(opp.heroCounters?.marked ?? 0) > 0}
        myMarked={(me.heroCounters?.marked ?? 0) > 0}
        mySeat={seat}
        priorityHolderSeat={priorityHolder}
        priorityPulse={hasOwnPriority}
        log={view.log}
        logEntries={view.logEntries}
        activeHeroName={activeHeroName}
        actionPoints={view.players[view.activePlayer]!.actionPoints}
        myResources={me.resources}
        primaryAction={primaryAction}
        passDisabled={primaryActionDisabled}
        onPass={triggerPrimaryAction}
        onUndo={mobileLandscapeViewport && canUndo ? () => undoAndDismissAnnouncement("last-action") : null}
        undoDisabled={roomCommandPending}
        rail={mobileLandscapeViewport
          ? {
              oppIdentity: oppNameplate,
              oppHand,
              myIdentity: selfNameplate,
              activeSeat: view.activePlayer,
              middle: <FullscreenNudge />,
            }
          : null}
      />

      {/* ── floating stack window: played cards and effects awaiting resolution,
          including the attack before it moves onto the combat chain. ── */}
      {gameMotion.turnStartUiReady ? <StackFloat
        motionDeferred={combatPresentation.deferStack}
        layers={combatPresentation.stack}
        queue={combatPresentation.queue}
        context={combatPresentation.context}
        miniHost={splitLineMiniHost}
        visibility={mobileCombatFloatVisibility}
        tokenSkip={connected && !spectating && !replaying && skippableRun
          ? { kind: skippableRun, onSkip: () => sendTokenSkip(skippableRun, true) }
          : undefined}
      /> : null}

      {/* ── floating combat chain panel: draggable + hidable, past links browsable.
          Staged defenders (not yet committed) show on the current link for
          both players and count into the live defense value (0 for the
          opponent — face-down staging leaks nothing) ── */}
      <ChainFloat
        motionDeferred={combatPresentation.deferChain}
        links={combatPresentation.chain}
        onRect={setChainRect}
        miniHost={splitLineMiniHost}
        visibility={mobileCombatFloatVisibility}
        staged={stagedDefenders}
        stagedDefense={stagedDefense}
        stagedAttack={stagedAttack}
        stagedAttackModifiers={stagedAttackModifiers}
        onUnstage={defending ? unstage : undefined}
        onUnstageAll={defending && stagedIds.size > 0
          ? () => {
              stage([]);
              clearPitch();
            }
          : undefined}
        onCloseChain={derived.canCloseChain ? () => send({ kind: "close-chain" }) : null}
        activatableCardIds={boardActionState.activatable}
        selectedAbilitySourceInstanceId={
          sel.kind === "activate" ? sel.sourceInstanceId : null
        }
        onActivateCard={(instanceId) => clickActivate(instanceId)()}
      >
        {chainTimingStatus}
      </ChainFloat>

      {/* ── floating decision window: prompts, choices, pitch selection ── */}
      {gameMotion.turnStartUiReady ? <DecisionFloat
        viewerSeat={seat}
        optionHotkeys={optionHotkeys}
        endTurnConfirmation={confirmEndTurn && warnBeforeEndTurn
          ? {
              onConfirm: () => {
                setConfirmEndTurn(false);
                send({ kind: "pass" });
              },
              onCancel: () => setConfirmEndTurn(false),
            }
          : null}
        pitchFocused={choosingPitch || pitchSource !== null}
        pending={{
          decision: hidePriorityGuidance || showCardSearchOverlay || (awaitingHandoff && myDecision)
            ? null
            : pd,
          isMine: myDecision,
          playerName: (playerSeat) => view.players[playerSeat]?.heroName ?? "",
          optionCardLabels,
          canPass: derived.canPass,
          defendPitchIds,
          hand: me.hand,
          defendSel: [...stagedIds],
          selectedPitchIds: pitchSel,
          onTogglePitch: togglePitch,
          resourcePaymentSelected,
          resourcePaymentRequired,
          confirmSkipArsenal,
          onRequestPass: requestPass,
          onDisableGuidance: () => updateLessGuidance(true),
          onConfirmSkipArsenal: () => send({ kind: "pass" }),
          onCancelSkipArsenal: () => setConfirmSkipArsenal(false),
          ...(boundedCardChoice
            ? {
                boundedChoiceSelectedOptionIds,
                onConfirmBoundedChoice: () => send({
                  kind: "choose-many",
                  optionIds: [...boundedChoiceSelectedOptionIds],
                }),
                ...(boundedHandPick ? {} : { onToggleBoundedChoice: toggleBoundedChoice }),
              }
            : {}),
          onSend: send,
        }}
        action={{
          sel,
          selCardId,
          step: actionStep,
          autoCommitPending,
          abilityChoices: sel.kind === "activate"
            ? selectedAbilityIndexes.map((index) => ({
                index,
                label: abilityLabel(sel.sourceInstanceId, index),
              }))
            : [],
          onSelectAbility: selectAbility,
          onChooseHandPlay: (instanceId) =>
            setSel({ kind: "play-hand", instanceId }),
          onChooseHandAbility: (instanceId) => {
            const selection = handCardSelection(
              actionCandidates.filter((intent) => intent.kind !== "play-card"),
              instanceId,
            );
            if (selection) setSel(selection);
          },
          meldChoices,
          meldSide,
          onSelectMeldSide: selectMeld,
          playMethod,
          playMethodChoiceRequired,
          onSelectPlayMethod: selectPlayMethod,
          targetChoices,
          targetAllyId,
          onSelectTarget: selectAllyTarget,
          cardTargetChoices,
          targetCardInstanceId,
          onSelectCardTarget: selectCardTarget,
          boostCount: selectedBoostCount,
          boostOptions,
          onSelectBoost: selectBoost,
          onConfirmChainClose: confirmChainClose,
          onConfirmAction: confirmAction,
          normalCostPayableWithoutPitch,
          alternativeCostChoices,
          alternativeCostCardInstanceIds,
          onSelectAlternativeCost: selectAlternativeCost,
          stagedAdditionalCost,
          additionalCostConfirmed,
          canConfirmAdditionalCost,
          onToggleAdditionalCostCard: toggleAdditionalCostCard,
          onConfirmAdditionalCost: confirmAdditionalCost,
          pitchSel,
          paymentProgress,
          onCancel: resetSel,
        }}
      /> : null}

      {/* ── side panel: status + log ── */}
      <SideRail
        fullscreenSupported={fullscreen.supported}
        fullscreenActive={fullscreen.active}
        onToggleFullscreen={fullscreen.toggle}
        unreadMessageCount={authUser && !replaying ? unreadMessageCount : 0}
        onOpenSocial={authUser && !replaying ? () => setSocialOpen(true) : undefined}
        collapsed={railCollapsed}
        onToggleCollapsed={() => setRailCollapsed((collapsed) => !collapsed)}
        turn={view.turn}
        onUndo={canUndo ? undoAndDismissAnnouncement : null}
        undoDisabled={roomCommandPending}
        onLeave={leave}
        leaveAction={botGame && !spectating ? "end-game" : "leave"}
        onConcede={
          !spectating && !replaying && view.phase !== "game-over"
            ? () => send({ kind: "concede" })
            : null
        }
        drawOfferSeat={view.drawOfferSeat}
        drawSeat={seat}
        onDrawIntent={!spectating && !replaying && !botGame && view.phase !== "game-over"
          ? (kind) => send({ kind })
          : null}
        spectating={spectating}
        spectatorCount={spectatorCount}
        spectatorUsernames={spectatorUsernames}
        onKickSpectator={!spectating && !replaying ? kickSpectator : null}
        opponentConnected={opponentConnected}
        connectionIssueVisible={connectionIssueVisible}
        error={error}
        winnerText={
          view.phase === "game-over"
            ? view.winner === null
              ? intl.formatMessage({ id: "game.result.draw" })
              : spectating
              ? intl.formatMessage({ id: "game.result.namedWinner" }, { winner: winnerName })
              : view.winner === seat
                ? intl.formatMessage({ id: "game.result.victory" })
                : intl.formatMessage({ id: "game.result.defeat" })
            : null
        }
        replaying={replaying}
        emoteSeat={(mobileFloatViewport || mobileLandscapeViewport) && canSendEmote ? seat : null}
        onSendEmote={(mobileFloatViewport || mobileLandscapeViewport) && canSendEmote ? sendEmote : null}
        onReportBug={!spectating && !replaying ? reportBug : null}
        onShareReplay={savedReplayShare.replayId ? () => setReplayShareOpen(true) : null}
        replayShared={savedReplayShare.shared}
        noteFrame={liveNoteFrame}
        noteRoomVersion={liveNoteRoomVersion}
        noteText={liveNoteText}
        onSetFrameNote={!spectating && !replaying ? setLiveReplayNote : null}
        onShowGameOver={
          view.phase === "game-over" && (!replaying || replayAtEnd) && gameOverDismissed
            ? () => setGameOverDismissed(false)
            : null
        }
        priorityWindowMode={priorityWindowMode}
        onPriorityWindowModeChange={
          !spectating && !replaying ? updatePriorityWindowMode : null
        }
        lessGuidance={lessGuidance}
        onLessGuidanceChange={updateLessGuidance}
        skipPlayConfirmation={skipPlayConfirmation}
        onSkipPlayConfirmationChange={updateSkipPlayConfirmation}
        optionHotkeys={optionHotkeys}
        onOptionHotkeysChange={updateOptionHotkeys}
        skipBotDelay={skipBotDelay}
        onSkipBotDelayChange={betaTester && botGame && !spectating ? updateSkipBotDelay : null}
        motionPreference={motionPreference}
        onMotionPreferenceChange={updateMotionPreference}
        cardDisplayPreference={cardDisplayPreference}
        onCardDisplayPreferenceChange={updateCardDisplayPreference}
        playmat={playmat}
        onPlaymatChange={chooseOwnPlaymat}
        botPlaymat={botPlaymat}
        onBotPlaymatChange={updateBotPlaymat}
        openSettingsSignal={openSettingsSignal}
        playabilityCuePreference={playabilityCuePreference}
        onPlayabilityCuePreferenceChange={updatePlayabilityCuePreference}
        soundEffectsEnabled={soundEffectsEnabled}
        onSoundEffectsEnabledChange={updateSoundEffectsEnabled}
        soundEffectsVolume={soundEffectsVolume}
        onSoundEffectsVolumeChange={updateSoundEffectsVolume}
        log={view.log}
        logEntries={view.logEntries}
        friendlyHeroName={me.heroName}
        opponentHeroName={opp.heroName}
        viewerSeat={seat}
        roomCode={roomCode}
        onInspectCard={setInspectedCardId}
        mobilePrimaryAction={primaryAction}
        mobilePrimaryActionDisabled={primaryActionDisabled}
        onMobilePrimaryAction={triggerPrimaryAction}
        backgroundSearching={backgroundSearching}
        onStopBackgroundSearch={stopBackgroundMatchmaking}
      />
      {replayShareOpen && savedReplayShare.replayId ? (
        <ShareReplayDialog
          replayId={savedReplayShare.replayId}
          expiresInDays={savedReplayShare.expiresInDays}
          onClose={() => setReplayShareOpen(false)}
        />
      ) : null}

      {showCardSearchOverlay ? (
        <CardSearchOverlay
          key={`${pd?.prompt ?? "search"}:${pd?.options?.join(":") ?? "choice"}`}
          decision={pd}
          zoneCounts={{
            hand: opp.handCount,
            deck: opp.deckCount,
            arsenal: opp.arsenalCount,
          }}
          {...(boundedCardChoice
            ? {
                selectedOptionIds: boundedChoiceSelectedOptionIds,
                canSelect: (optionId: string) =>
                  boundedCardChoiceSelectable(boundedCardChoice, boundedChoiceSelectedOptionIds, optionId),
                onToggle: toggleBoundedChoice,
              }
            : {})}
          onSubmit={(optionIds) => send({ kind: "choose-many", optionIds: [...optionIds] })}
        />
      ) : null}

      {effectLedger ? (
        <EffectLedger
          effects={view.ongoing}
          target={effectLedger}
          onClose={() => setEffectLedger(null)}
          onInspectCard={(cardId) => {
            setPreview(null);
            setInspectedCardId(cardId);
          }}
        />
      ) : null}

      <BoardOverlays
        preview={pitchSource && preview?.id === pitchSource.card.cardId ? null : preview}
        overlay={showCardSearchOverlay ? null : overlay}
        inspectedCardId={inspectedCardId}
        seat={seat}
        yourSeat={yourSeat}
        deckCardFeedback={deckCardFeedback}
        showIdleVictory={showIdleToast}
        opponentHeroName={opp.heroName}
        opponentIdleMs={oppIdleMs}
        onClaimVictory={() => {
          claimVictory();
          dismissIdleVictory(oppLastAction);
        }}
        onDismissIdleVictory={() => dismissIdleVictory(oppLastAction)}
        gameView={view}
        spectating={spectating}
        replaying={replaying}
        replayAtEnd={replayAtEnd}
        gameOverDismissed={gameOverDismissed}
        getRecordedViews={getRecordedViews}
        replayViews={replayViews}
        replayAvailable={replayFrames > 0}
        onWatchReplay={watchReplay}
        onDownloadReplay={downloadReplay}
        onLeave={leave}
        onCloseReplay={closeReplay}
        onDismissGameOver={() => setGameOverDismissed(true)}
        onCloseOverlay={() => setOverlay(null)}
        onInspectCard={setInspectedCardId}
        opponentUsername={playerProfiles?.[1 - seat]?.username ?? null}
        botGame={botGame}
        drawOfferSeat={view.drawOfferSeat}
        onAcceptDraw={!spectating && !replaying && !botGame && view.phase !== "game-over"
          ? () => send({ kind: "accept-draw" }) : null}
        onDeclineDraw={!spectating && !replaying && !botGame && view.phase !== "game-over"
          ? () => send({ kind: "decline-draw" }) : null}
        standingOrders={inspectedStandingOrders
          ? { model: inspectedStandingOrders, onSetOrder: standingOrders.onSetOrder }
          : null}
      />
      <GameMotionLayer
        batch={gameMotion.batch}
        queuedSources={gameMotion.queuedSources}
        squareCardsEnabled={squareCardsEnabled}
        onFlightArrive={gameMotion.arriveFlight}
        onFlightDepart={gameMotion.departFlight}
        onComplete={gameMotion.completeBatch}
      />
    </div>
    </SquareCardPresentation>
    </CardArtProvider>
    </EffectHeroesContext.Provider>
  );
}
