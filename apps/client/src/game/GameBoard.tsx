import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { CardView, GameIntent, MeldSide } from "@fyendal/shared";
import { cardData } from "@fyendal/cards/client";
import { useStore } from "../store.js";
import { cardPreviewSize, CardBack, CardFace } from "./Card.js";
import { ChainFloat } from "./ChainFloat.js";
import { EndTurnPassToast } from "./EndTurnPassToast.js";
import { StatusFloat } from "./StatusFloat.js";
import {
  ChainPriorityStatus,
  ChainTimingStatus,
  PriorityFloat,
  TurnTimingFloat,
} from "./PriorityFloat.js";
import { StackFloat } from "./StackFloat.js";
import { DecisionFloat } from "./DecisionFloat.js";
import { useDeckCardFeedback } from "./DeckCardToast.js";
import { SideRail } from "./SideRail.js";
import {
  canAddPitch,
  canAddResourcePaymentPitch,
  offeredMeldSides,
  selectedDefendIntent,
  selectedResourcePaymentOption,
} from "./legalSelection.js";
import { equipmentStackCards } from "./boardGroups.js";
import { chainDefenderIds } from "./defenderState.js";
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
import { handCardChoiceOptions } from "./decisionPresentation.js";
import { shouldHidePriorityGuidance } from "./decisionPass.js";
import { hoverSurfaceLayout } from "./hoverSurfaceLayout.js";
import { canSkipRunechant } from "./runechantSkip.js";
import { PlayerNameplate } from "./PlayerNameplate.js";
import { shouldShowIdleVictoryClaim } from "./idleVictory.js";
import { MobileHandToggle } from "./MobileHandToggle.js";
import { useMobileCardLongPress } from "./mobileCardLongPress.js";
import { abilityLabelForSource, deriveBoardLegalState } from "./board/boardModel.js";
import { useGameSettings } from "./board/useGameSettings.js";
import { useGameViewport } from "./board/useGameViewport.js";
import { useIdleVictoryPrompt } from "./board/useIdleVictoryPrompt.js";
import { useGameShortcuts } from "./board/useGameShortcuts.js";
import { heroCard, type BoardOverlay } from "./board/BoardPrimitives.js";
import { PlayerHalf } from "./board/PlayerHalf.js";
import { PlayerHand } from "./board/PlayerHand.js";
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

const EMPTY_INSTANCE_IDS: ReadonlySet<number> = new Set();

export function GameBoard() {
  const { view, viewUpdate, playerProfiles, legal, actionCandidates, roomCommandPending, pendingInteraction, pendingDefenderStageIds, yourSeat, spectating, spectatorCount, botGame, sendIntent, sendPriorityMode, sendRunechantSkip, sendEmote, latestEmote, undo, error, leave, opponentConnected, connected, roomCode, screen, replayFrames, watchReplay, downloadReplay, getRecordedViews, lastActionAt, claimVictory, reportBug } = useStore(
    useShallow((state) => ({
      view: state.view,
      viewUpdate: state.viewUpdate,
      playerProfiles: state.playerProfiles,
      legal: state.legal,
      actionCandidates: state.actionCandidates,
      roomCommandPending: state.roomCommandPending,
      pendingInteraction: state.pendingInteraction,
      pendingDefenderStageIds: state.pendingDefenderStageIds,
      yourSeat: state.yourSeat,
      spectating: state.spectating,
      spectatorCount: state.spectatorCount,
      botGame: state.botGame,
      sendIntent: state.sendIntent,
      sendPriorityMode: state.sendPriorityMode,
      sendRunechantSkip: state.sendRunechantSkip,
      sendEmote: state.sendEmote,
      latestEmote: state.latestEmote,
      undo: state.undo,
      error: state.error,
      leave: state.leave,
      opponentConnected: state.opponentConnected,
      connected: state.connected,
      roomCode: state.roomCode,
      screen: state.screen,
      replayFrames: state.replayFrames,
      watchReplay: state.watchReplay,
      downloadReplay: state.downloadReplay,
      getRecordedViews: state.getRecordedViews,
      lastActionAt: state.lastActionAt,
      claimVictory: state.claimVictory,
      reportBug: state.reportBug,
    })),
  );
  const tableRef = useRef<HTMLDivElement>(null);
  const [overlay, setOverlay] = useState<BoardOverlay | null>(null);
  const [inspectedCardId, setInspectedCardId] = useState<string | null>(null);
  const cardLongPressHandlers = useMobileCardLongPress((cardId, target) => {
    if (!view) return;
    const cardStackId = Number(
      target.closest<HTMLElement>("[data-card-stack-id]")?.dataset.cardStackId,
    );
    const stackedEntry = Number.isSafeInteger(cardStackId)
      ? view.players
        .flatMap((player) => [
          { card: heroCard(player), underCards: player.soul },
          ...Object.values(player.equipment).map((card) => ({ card, underCards: [] })),
          ...player.weapons.map((card) => ({ card, underCards: [] })),
          ...player.board.map((card) => ({ card, underCards: [] })),
        ])
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
  const {
    railCollapsed,
    setRailCollapsed,
    mobileFloatViewport,
    mobileHandIsHidden,
    toggleMobileHand,
    mobileCombatFloatVisibility,
  } = useGameViewport();
  const {
    lessGuidance,
    motionPreference,
    playabilityCuePreference,
    priorityWindowMode,
    skipPlayConfirmation,
    soundEffectsEnabled,
    soundEffectsVolume,
    updatePriorityWindowMode,
    updateLessGuidance,
    updateMotionPreference,
    updatePlayabilityCuePreference,
    updateSkipPlayConfirmation,
    updateSoundEffectsEnabled,
    updateSoundEffectsVolume,
  } = useGameSettings({
    syncPriorityMode: connected && screen !== "replay" && !spectating && yourSeat !== null,
    sendPriorityMode,
  });
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
  useGameSounds({
    view,
    viewUpdate,
    enabled: soundEffectsEnabled && screen !== "replay",
    volume: soundEffectsVolume,
  });
  // end-of-game popup can be dismissed to inspect the final board; re-arm it
  // whenever a new winner is decided (fresh game in the same room)
  const [gameOverDismissed, setGameOverDismissed] = useState(false);
  const [confirmSkipArsenal, setConfirmSkipArsenal] = useState(false);
  const showDeckCardEvents = screen !== "replay";
  const deckCardFeedback = useDeckCardFeedback(view, showDeckCardEvents);
  const winnerNow = view?.winner ?? null;
  const arsenalDecisionKey =
    view?.pendingDecision?.kind === "arsenal" && view.pendingDecision.player === yourSeat
      ? `${view.turn}:${view.pendingDecision.player}`
      : null;
  useEffect(() => setGameOverDismissed(false), [winnerNow]);
  useEffect(() => setConfirmSkipArsenal(false), [arsenalDecisionKey]);
  // the combat chain window's on-screen rect, reported by ChainFloat so the
  // status window can dock to its right edge
  const [chainRect, setChainRect] = useState<DOMRect | null>(null);
  const [splitLineMiniHost, setSplitLineMiniHost] = useState<HTMLDivElement | null>(null);
  // idle-opponent prompt: no messages flow while the opponent is idle, so a
  // slow local tick re-evaluates their last-activity stamp
  const { now, dismissedFor: idleDismissedFor, dismiss: dismissIdleVictory } =
    useIdleVictoryPrompt();
  const derived = useMemo(
    () => deriveBoardLegalState(actionCandidates, legal),
    [actionCandidates, legal],
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
    canConfirmAdditionalCost,
    normalCostPayableWithoutPitch,
    playMethodChoiceRequired,
    pitchProgress,
    selectedAbilityIndexes,
    boostOptions,
    selectedBoostCount,
    selectedPaymentVariants,
    targetVariants,
    autoCommitPending,
    reset: resetSel,
    select: setSel,
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
  const actionConfirmationReady =
    sel.kind !== "none" &&
    !autoCommitPending &&
    (actionStep === "confirm" || actionStep === "close-chain");

  const canSkipCurrentRunechant = canSkipRunechant(legal);

  const hotkeyIntent = sel.kind === "none"
    ? passHotkeyIntent(legal, view?.pendingDecision ?? null, pitchSel)
    : null;
  const passHotkeyEnabled =
    hotkeyIntent !== null &&
    !roomCommandPending &&
    connected &&
    view !== null &&
    screen !== "replay" &&
    !spectating &&
    yourSeat !== null;
  useGameShortcuts({
    passEnabled: passHotkeyEnabled,
    hotkeyIntent,
    pendingDecision: view?.pendingDecision ?? null,
    setConfirmArsenalSkip: setConfirmSkipArsenal,
    onSend: sendIntent,
    onReset: resetSel,
    confirmationEnabled: actionConfirmationReady,
    actionStep,
    onConfirmAction: confirmAction,
    onConfirmChainClose: confirmChainClose,
  });

  if (!view || !presentedView || (yourSeat === null && !spectating)) return null;
  const causal = causalStatus(view, spectating ? null : yourSeat);
  const seat = yourSeat ?? 0; // spectators watch from seat 0's side of the table
  const replaying = screen === "replay";
  const canSendEmote = !spectating && !replaying && connected;
  const authoritativeMe = view.players[seat]!;
  const me = presentedView.players[seat]!;
  const opp = presentedView.players[seat === 0 ? 1 : 0]!;
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
  const presentedHandCount = Math.max(
    0,
    me.handCount - me.hand.filter((card) => optimisticallyHiddenIds.has(card.instanceId)).length,
  );
  const pd = presentedView.pendingDecision;
  const myDecision = !spectating && pd !== null && pd.player === seat;
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
  const myTurn = view.activePlayer === seat;
  const activeHeroName = view.players[view.activePlayer]?.heroName ?? "";
  const turnLabel = spectating
    ? `${activeHeroName}'s turn`
    : myTurn
      ? "Your turn"
      : "Opponent's turn";
  const combatChainLinks = presentedView.chain.filter((link) => !link.onStack);
  const hasActiveCombatChain = combatChainLinks.length > 0;
  const showPriorityFloat = !spectating && !replaying && gameHasPriority(view);
  const hasOwnPriority = showPriorityFloat && view.priorityPlayer === seat;
  const priorityLabel = view.priorityPlayer === seat ? "YOUR PRIORITY" : "OPPONENT'S PRIORITY";
  const priorityTimingLabel = gameTimingLabel(view);
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
    gameOver: view.winner !== null,
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
  const stagedDefenders: CardView[] = pd?.kind === "defend" ? (pd.stagedCards ?? []) : [];
  const stagedIds = new Set(stagedDefenders.map((c) => c.instanceId));
  /** live defense total of the staged defenders (0 for the opponent) */
  const stagedDefense = pd?.kind === "defend" ? (pd.stagedDefense ?? 0) : 0;
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
        canAddPitch(
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
        ...me.banish,
        ...me.graveyard,
        ...(myVisibleDeckTop ? [myVisibleDeckTop] : []),
      ].find((x) => x.instanceId === sel.instanceId)?.cardId;
    }
    if (sel.kind === "activate") {
      const id = sel.sourceInstanceId;
      if (id === me.heroInstanceId) return me.heroCardId;
      return [
        ...me.hand,
        ...me.weapons,
        ...Object.values(me.equipment),
        ...me.board,
        ...view.chain.map((link) => link.attackingCard),
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
        ? [{ id: null as number | null, label: opp.heroName, card: heroCard(opp), life: opp.life }]
        : []),
      ...[...allyIds].flatMap((id) => {
        const card = opp.board.find((candidate) => candidate.instanceId === id);
        return card
          ? [{
              id: id as number | null,
              label: cardData[card.cardId]?.name ?? "an ally",
              card,
              life: card.life,
            }]
          : [];
      }),
    ];
  })();

  /** Card targets announced by target-aware play intents (for example,
   * Blinding Beam's attacking/defending attack-action target). */
  const cardTargetChoices = (() => {
    if (sel.kind === "none" || sel.kind === "activate") return [];
    const ids = new Set<number>();
    for (const intent of targetVariants) {
      if (
        (intent.kind === "play-card" ||
          intent.kind === "play-from-arsenal" ||
          intent.kind === "play-from-zone") &&
        intent.instanceId === sel.instanceId &&
        intent.targetCardInstanceId !== undefined
      ) ids.add(intent.targetCardInstanceId);
    }
    const combatCards = view.chain.flatMap((link) => [link.attackingCard, ...link.defendingCards]);
    return [...ids].flatMap((id) => {
      const card = combatCards.find((candidate) => candidate.instanceId === id);
      return card
        ? [{ id, label: cardData[card.cardId]?.name ?? "card", card, life: card.life }]
        : [];
    });
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
    const candidateIds = new Set([...alternativeCostSets.values()].flat());
    const handCards = me.hand.filter((card) => candidateIds.has(card.instanceId));
    const arenaCards = [
      ...me.board,
      ...me.weapons,
      ...Object.values(me.equipment).filter((card): card is CardView => card !== undefined),
    ].filter((card) => candidateIds.has(card.instanceId));
    return {
      cardLabel: stagedAdditionalCostDefinition.cardLabel,
      modes: [
        ...(arenaCards.length > 0 ? [{
          mode: "destroy" as const,
          maximum: stagedAdditionalCostDefinition.maximumDestroyed,
          cards: arenaCards,
        }] : []),
        ...(handCards.length > 0 ? [{
          mode: "discard" as const,
          maximum: stagedAdditionalCostDefinition.maximumDiscarded,
          cards: handCards,
        }] : []),
      ],
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
    view.winner === null &&
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
    (pd.kind === "priority-window" ||
      pd.kind === "attack-reaction" ||
      pd.kind === "defense-reaction" ||
      pd.kind === "arsenal");
  // Priority/reaction cards remain highlighted and Pass remains in the status
  // float, so this duplicate prompt can follow the guidance preference. On a
  // mobile viewport, collapsing the hand also clears it off the battlefield.
  const hidePriorityGuidance = shouldHidePriorityGuidance(pd, {
    isMine: myDecision,
    lessGuidance,
    mobileHandIsHidden,
  });
  const passLabel = sel.kind !== "none"
    ? null
    : defending
      ? stagedIds.size > 0 ? "CONFIRM" : "NO BLOCK"
      : !derived.canPass
      ? null
      : myDecision
        ? statusPassDecision
          ? "PASS"
          : null // button-choice decisions carry their own pass/decline button
        : view.phase === "action" && myTurn
          ? "END TURN"
          : "PASS";
  const triggerPrimaryAction = defending
    ? () => {
        if (defendIntent) send(defendIntent);
      }
    : requestPass;

  // hover preview next to the hovered card (event delegation via data-cardid)
  const onHoverCard = (e: React.MouseEvent) => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const target = e.target as HTMLElement;
    // Counter icons have their own focused tooltip. Suppress the large card
    // preview while the pointer is on one so the two surfaces never collide.
    if (target.closest(".c-ovl")) {
      setPreview(null);
      return;
    }
    const el = target.closest<HTMLElement>("[data-cardid], [data-effect-label]");
    if (!el) {
      setPreview(null);
      return;
    }
    const r = el.getBoundingClientRect();
    const cardId = el.dataset.cardid ?? null;
    const effectLabel = el.dataset.effectLabel;
    if (!cardId && effectLabel) {
      const above = r.top >= window.innerHeight - r.bottom;
      const maxWidth = Math.min(360, window.innerWidth - 16);
      setPreview({
        id: null,
        x: 0,
        y: 0,
        effectTooltip: {
          label: effectLabel,
          position: {
            left: Math.min(Math.max(r.left, 8), window.innerWidth - maxWidth - 8),
            maxWidth,
            maxHeight: above
              ? Math.max(0, r.top - 16)
              : Math.max(0, window.innerHeight - r.bottom - 16),
            ...(above
              ? { bottom: window.innerHeight - r.top + 8 }
              : { top: r.bottom + 8 }),
          },
        },
      });
      return;
    }
    if (!cardId) {
      setPreview(null);
      return;
    }
    const previewSize = cardPreviewSize(window.innerHeight);
    const layout = hoverSurfaceLayout(
      r,
      { width: window.innerWidth, height: window.innerHeight },
      previewSize,
      240, // keep the card preview clear of the side panel when space permits
    );
    // Contextual card explanations use the preview side; effect chips also
    // receive a viewport-level tooltip in the opposite horizontal corridor.
    el.dataset.previewSide = layout.preview.side;
    setPreview({
      id: cardId,
      x: layout.preview.x,
      y: layout.preview.y,
      size: previewSize,
      ...(effectLabel
        ? { effectTooltip: { label: effectLabel, position: layout.tooltip } }
        : {}),
    });
  };

  // Touch screens have no hover preview. Tapping an inert card, or holding any
  // card, opens the full-size sheet; actionable cards keep their normal tap.
  const onTableClick = (e: React.MouseEvent) => {
    if (!window.matchMedia("(max-width: 700px)").matches) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, .card-clickable, .overlay")) return;
    const card = target.closest<HTMLElement>("[data-cardid]");
    const cardId = card?.dataset.cardid;
    if (cardId) setInspectedCardId(cardId);
  };

  const playerHalfInteraction = {
    legal: derived,
    selection: sel,
    preStackSelectedInstanceId,
    stagedIds,
    committedDefenderIds,
    optimisticallyHiddenIds,
    defending,
    onStage: stage,
    onActivate: (instanceId: number) => clickActivate(instanceId)(),
    onSelect: setSel,
  };

  return (
    <div
      ref={tableRef}
      className={`table${railCollapsed ? " rail-is-collapsed" : ""}${view.winner !== null ? " game-is-over" : ""}${hasActiveCombatChain ? " has-active-combat-chain" : ""}${mobileHandIsHidden ? " mobile-hand-is-hidden" : ""}${hasOwnPriority ? " has-own-priority" : ""}`}
      data-playability-cue={playabilityCuePreference}
      data-motion-preference={motionPreference}
      onMouseOver={onHoverCard}
      onMouseLeave={() => setPreview(null)}
      {...cardLongPressHandlers}
      onClick={onTableClick}
    >
      {hasOwnPriority ? <div className="own-priority-arrival" aria-hidden="true" /> : null}
      {/* ── playmat board: opponent half on top, your half below ── */}
      <div className="board">
        {playerProfiles ? (
          <>
            <PlayerNameplate placement="opponent" profile={playerProfiles[1 - seat]!} />
            <PlayerNameplate placement="self" profile={playerProfiles[seat]!} />
          </>
        ) : null}
        <div
          className={`opp-hand${view.winner !== null || replaying ? " opp-hand-revealed" : ""}`}
          data-motion-zone={motionLocationKey({ kind: "hand", seat: opp.seat })}
        >
          {view.winner !== null || replaying
            ? opp.hand.map((card) => (
                <CardFace
                  key={card.instanceId}
                  card={card}
                  motionKey={motionPresentationKey(
                    { kind: "hand", seat: opp.seat },
                    card.instanceId,
                  )}
                />
              ))
            : Array.from({ length: opp.handCount }, (_, i) => (
                <CardBack
                  key={i}
                  label=""
                  motionKey={opaqueMotionPresentationKey(
                    { kind: "hand", seat: opp.seat },
                    i,
                  )}
                  motionZoneAnchor={i === opp.handCount - 1
                    ? motionLocationKey({ kind: "hand", seat: opp.seat })
                    : undefined}
                />
              ))}
          {opp.handCount === 0 && <span className="muted">opponent has no cards in hand</span>}
        </div>

        {/* opponent half — mirrored vertically, same columns as yours */}
        <PlayerHalf
          player={opp}
          mine={false}
          mirrored
          ongoing={view.ongoing.filter((effect) => effect.seat === opp.seat)}
          gameOver={view.winner !== null}
          replaying={replaying}
          deckShuffling={deckCardFeedback.shuffledSeats.has(opp.seat)}
          interaction={playerHalfInteraction}
          latestEmote={latestEmote}
          canSendEmote={canSendEmote}
          mobileFloatViewport={mobileFloatViewport}
          onSendEmote={sendEmote}
          onOpenOverlay={setOverlay}
        />

        {/* center divider: a brass-inlay strip marking the seam */}
        <div className="mat-divider">
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
          mine
          mirrored={false}
          ongoing={view.ongoing.filter((effect) => effect.seat === me.seat)}
          gameOver={view.winner !== null}
          replaying={replaying}
          visibleDeckTop={myVisibleDeckTop}
          deckShuffling={deckCardFeedback.shuffledSeats.has(me.seat)}
          interaction={playerHalfInteraction}
          latestEmote={latestEmote}
          canSendEmote={canSendEmote}
          mobileFloatViewport={mobileFloatViewport}
          onSendEmote={sendEmote}
          onOpenOverlay={setOverlay}
        />

        <PlayerHand
          view={view}
          player={me}
          viewerSeat={seat}
          spectating={spectating}
          replaying={replaying}
          interaction={{
            legalState: derived,
            legalIntents: legal,
            selection: sel,
            preStackSelectedInstanceId,
            pitchSelection: pitchSel,
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
            onCardClick: onHandClick,
            onSelect: setSel,
          }}
        />
      </div>

      {/* Fixed HUD sibling: keeping this outside .board guarantees that
          waiting-state changes cannot affect board layout or motion anchors. */}
      <div
        className={`waiting${waitingForOpponent && !replaying ? "" : " waiting-hidden"}`}
        aria-hidden={waitingForOpponent && !replaying ? undefined : true}
      >
        {spectating
          ? `Spectating — ${activeHeroName} to act`
          : "Waiting for opponent…"}
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
        oppLife={opp.life}
        myLife={me.life}
        oppHeroName={opp.heroName}
        myHeroName={me.heroName}
        log={view.log}
        activeHeroName={activeHeroName}
        actionPoints={view.players[view.activePlayer]!.actionPoints}
        passLabel={passLabel}
        passDisabled={roomCommandPending || (defending && defendIntent === null)}
        onPass={triggerPrimaryAction}
      />

      {/* ── floating stack window: triggered ability layers + played cards
          awaiting resolution; an attack still on the stack shows here too —
          its chain link starts only once the attack resolves ── */}
      {gameMotion.turnStartUiReady ? <StackFloat
        layers={presentedView.stack}
        attack={presentedView.chain.find((l) => l.onStack)}
        context={view.stackContext}
        miniHost={splitLineMiniHost}
        visibility={mobileCombatFloatVisibility}
        lessGuidance={lessGuidance}
        onSkipRunechants={connected && !spectating && !replaying && canSkipCurrentRunechant
          ? () => sendRunechantSkip(true)
          : undefined}
      /> : null}

      {/* ── floating combat chain panel: draggable + hidable, past links browsable.
          Staged defenders (not yet committed) show on the current link for
          both players and count into the live defense value (0 for the
          opponent — face-down staging leaks nothing) ── */}
      <ChainFloat
        links={combatChainLinks}
        onRect={setChainRect}
        miniHost={splitLineMiniHost}
        visibility={mobileCombatFloatVisibility}
        staged={stagedDefenders}
        stagedDefense={stagedDefense}
        onUnstage={defending ? unstage : undefined}
        onUnstageAll={defending && stagedIds.size > 0
          ? () => {
              stage([]);
              clearPitch();
            }
          : undefined}
        onCloseChain={derived.canCloseChain ? () => send({ kind: "close-chain" }) : null}
        activatableAttackIds={derived.activatable}
        selectedAbilitySourceInstanceId={
          sel.kind === "activate" ? sel.sourceInstanceId : null
        }
        onActivateAttack={(instanceId) => clickActivate(instanceId)()}
      >
        {chainTimingStatus}
      </ChainFloat>

      {/* ── floating decision window: prompts, choices, pitch selection ── */}
      {gameMotion.turnStartUiReady ? <DecisionFloat
        viewerSeat={seat}
        pending={{
          decision: hidePriorityGuidance ? null : pd,
          isMine: myDecision,
          decidingName: pd ? (view.players[pd.player]?.heroName ?? "") : "",
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
          onConfirmSkipArsenal: () => send({ kind: "pass" }),
          onCancelSkipArsenal: () => setConfirmSkipArsenal(false),
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
          pitchResourcesSelected: pitchProgress.selected,
          pitchResourcesRequired: pitchProgress.required,
          onCancel: resetSel,
        }}
      /> : null}

      {/* ── side panel: status + log ── */}
      <SideRail
        collapsed={railCollapsed}
        onToggleCollapsed={() => setRailCollapsed((collapsed) => !collapsed)}
        turn={view.turn}
        onUndo={!spectating && !replaying && view.winner === null ? undo : null}
        undoDisabled={roomCommandPending}
        onLeave={leave}
        leaveLabel={botGame && !spectating ? "End Game" : "Leave"}
        onConcede={
          !spectating && !replaying && view.winner === null
            ? () => send({ kind: "concede" })
            : null
        }
        spectating={spectating}
        spectatorCount={spectatorCount}
        opponentConnected={opponentConnected}
        connected={connected}
        error={error}
        winnerText={
          view.winner !== null
            ? spectating
              ? `${winnerName} wins!`
              : view.winner === seat
                ? "Victory!"
                : "Defeat"
            : null
        }
        replaying={replaying}
        emoteSeat={mobileFloatViewport && canSendEmote ? seat : null}
        onSendEmote={mobileFloatViewport && canSendEmote ? sendEmote : null}
        onReportBug={!spectating && !replaying ? reportBug : null}
        onShowGameOver={
          !replaying && view.winner !== null && gameOverDismissed
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
        motionPreference={motionPreference}
        onMotionPreferenceChange={updateMotionPreference}
        playabilityCuePreference={playabilityCuePreference}
        onPlayabilityCuePreferenceChange={updatePlayabilityCuePreference}
        soundEffectsEnabled={soundEffectsEnabled}
        onSoundEffectsEnabledChange={updateSoundEffectsEnabled}
        soundEffectsVolume={soundEffectsVolume}
        onSoundEffectsVolumeChange={updateSoundEffectsVolume}
        log={view.log}
        friendlyHeroName={me.heroName}
        opponentHeroName={opp.heroName}
        roomCode={roomCode}
        onInspectCard={setInspectedCardId}
        mobilePrimaryActionLabel={passLabel}
        mobilePrimaryActionDisabled={defending && defendIntent === null}
        onMobilePrimaryAction={triggerPrimaryAction}
      />

      <BoardOverlays
        preview={preview}
        overlay={overlay}
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
        gameOverDismissed={gameOverDismissed}
        getRecordedViews={getRecordedViews}
        replayAvailable={replayFrames > 0}
        onWatchReplay={watchReplay}
        onDownloadReplay={downloadReplay}
        onLeave={leave}
        onDismissGameOver={() => setGameOverDismissed(true)}
        onCloseOverlay={() => setOverlay(null)}
        onInspectCard={setInspectedCardId}
      />
      <GameMotionLayer
        batch={gameMotion.batch}
        onFlightArrive={gameMotion.arriveFlight}
        onComplete={gameMotion.completeBatch}
      />
    </div>
  );
}
