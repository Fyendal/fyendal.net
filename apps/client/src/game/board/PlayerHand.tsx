import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useIntl } from "react-intl";
import type {
  CardView,
  GameIntent,
  GameView,
  PendingDecision,
  PlayableZone,
  PlayerView,
} from "@fyendal/shared";
import { cardData } from "@fyendal/cards/client";
import { CardBack, CardFace } from "../Card.js";
import { PreviewCardFace } from "../PreviewCardFace.js";
import { cardLegalityExplanation } from "../causalExplanations.js";
import {
  canAddPaymentCard,
  canAddResourcePaymentPitch,
  isDiscardPayment,
} from "../legalSelection.js";
import { playableZoneTooltip } from "../playableZoneTooltip.js";
import {
  motionLocationKey,
  opaqueMotionPresentationKey,
  motionPresentationKey,
} from "../motion/motionTypes.js";
import type { Sel } from "../useActionAnnouncement.js";
import type { BoardLegalState } from "./boardModel.js";
import { useHandReorder } from "./useHandReorder.js";
import { handDropAction, handPlayWindow, type HandDropAction } from "./handOrder.js";
import { handFanSlotStyle } from "./handFan.js";
import type { MotionPreference } from "../../storage.js";
import { useMotionPreference } from "../motion/useMotionPreference.js";

type ResourcePayment = NonNullable<PendingDecision["resourcePayment"]>;

interface HandScrollAvailability {
  left: boolean;
  right: boolean;
}

/** A pre-stack play temporarily leaves the authoritative hand, then the
 * client projects it back while its declaration is open. Keep the surviving
 * cards in their last presented order so that projected source does not jump
 * to the right edge of the hand. */
export function preservePreStackHandOrder(
  cards: readonly CardView[],
  previousInstanceIds: readonly number[],
  preStackInstanceId: number | null,
): CardView[] {
  if (
    preStackInstanceId === null ||
    !previousInstanceIds.includes(preStackInstanceId) ||
    !cards.some((card) => card.instanceId === preStackInstanceId)
  ) return [...cards];

  const previousIndex = new Map(
    previousInstanceIds.map((instanceId, index) => [instanceId, index]),
  );
  return cards
    .map((card, currentIndex) => ({ card, currentIndex }))
    .sort((left, right) => {
      const leftIndex = previousIndex.get(left.card.instanceId);
      const rightIndex = previousIndex.get(right.card.instanceId);
      if (leftIndex !== undefined && rightIndex !== undefined) return leftIndex - rightIndex;
      if (leftIndex !== undefined) return -1;
      if (rightIndex !== undefined) return 1;
      return left.currentIndex - right.currentIndex;
    })
    .map(({ card }) => card);
}

export function handScrollAvailability({
  scrollLeft,
  clientWidth,
  scrollWidth,
}: {
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
}): HandScrollAvailability {
  const end = Math.max(0, scrollWidth - clientWidth);
  return {
    left: scrollLeft > 1,
    right: scrollLeft < end - 1,
  };
}

export interface PlayerHandInteraction {
  legalState: BoardLegalState;
  legalIntents: readonly GameIntent[];
  selection: Sel;
  /** A play paused before the stack remains visibly selected without
   * reopening the local action-announcement state. */
  preStackSelectedInstanceId: number | null;
  pitchSelection: readonly number[];
  selectedPaymentVariants: Parameters<typeof canAddPaymentCard>[0];
  resourcePayment?: ResourcePayment;
  choosingPitch?: boolean;
  focusedSourceInstanceId?: number | null;
  stagedIds: ReadonlySet<number>;
  optimisticallyHiddenIds: ReadonlySet<number>;
  defending: boolean;
  choosingArsenal: boolean;
  handPick: ReadonlyMap<number, string> | null;
  boundedHandPick?: ReadonlyMap<number, string> | null;
  selectedBoundedChoiceOptionIds?: ReadonlySet<string>;
  onCardClick: (card: CardView) => void;
  onActivate: (instanceId: number) => void;
  onSelect: (selection: Sel) => void;
  onHandDrop?: (instanceId: number, action: HandDropAction) => void;
  onDragStart?: (action: HandDropAction | null) => void;
  onDragEnd?: () => void;
}

export function PlayerHand({
  view,
  player,
  viewerSeat,
  spectating,
  replaying,
  motionPreference = "system",
  interaction,
}: {
  view: GameView;
  player: PlayerView;
  viewerSeat: number;
  spectating: boolean;
  replaying: boolean;
  motionPreference?: MotionPreference;
  interaction: PlayerHandInteraction;
}) {
  const intl = useIntl();
  const reducedMotion = useMotionPreference(motionPreference);
  const handMotionLocation = { kind: "hand" as const, seat: player.seat };
  const handRef = useRef<HTMLDivElement>(null);
  const previousHandOrderRef = useRef<readonly number[]>([]);
  const preStackCards = preservePreStackHandOrder(
    player.hand,
    previousHandOrderRef.current,
    interaction.preStackSelectedInstanceId,
  );
  const reorderEnabled = !spectating && !replaying && !interaction.choosingPitch &&
    interaction.resourcePayment === undefined;
  const { order, handlers: reorderHandlers, floatingCard, floatingCardRef, dropOnRelease } = useHandReorder(
    handRef,
    preStackCards.map((card) => card.instanceId),
    reorderEnabled,
    interaction.onHandDrop ? {
      action: (instanceId) => handDropAction(instanceId, {
        defending: interaction.defending,
        stageableIds: interaction.legalState.stageableDefenders,
        choosingArsenal: interaction.choosingArsenal,
        playableIds: interaction.legalState.playableHand,
        selection: interaction.selection,
        otherDecisionActive:
          (view.pendingDecision !== null && !handPlayWindow(view.pendingDecision.kind)) ||
          interaction.handPick !== null || interaction.boundedHandPick != null ||
          interaction.resourcePayment !== undefined || interaction.preStackSelectedInstanceId !== null,
      }),
      onDrop: interaction.onHandDrop,
      onDragStart: interaction.onDragStart,
      onDragEnd: interaction.onDragEnd,
    } : undefined,
    reducedMotion,
  );
  const handCards = new Map(player.hand.map((card) => [card.instanceId, card]));
  const visibleCards = order.flatMap((id) => {
    const card = handCards.get(id);
    return card ? [card] : [];
  }).filter((card) =>
    !interaction.stagedIds.has(card.instanceId)
    && !interaction.optimisticallyHiddenIds.has(card.instanceId)
  );
  useEffect(() => {
    previousHandOrderRef.current = visibleCards.map((card) => card.instanceId);
  });
  const playableZoneCards = spectating
    ? []
    : [...interaction.legalState.playableZones]
      .filter((entry): entry is [number, Exclude<PlayableZone, "deck">] => entry[1] !== "deck")
      .flatMap(([instanceId, zone]) => {
        if (interaction.optimisticallyHiddenIds.has(instanceId)) return [];
        // Effects such as Red Lure Harpoon and Nuu let this player play an
        // opponent-owned card. The legal intent is authoritative, so search
        // every public inactive zone instead of assuming the card is owned by
        // the player whose hand strip surfaces the action.
        const card = view.players.flatMap((zoneOwner) => [
          ...zoneOwner.banish,
          ...zoneOwner.graveyard,
        ])
          .find((candidate) => candidate.instanceId === instanceId);
        return card ? [{ card, zone }] : [];
      });
  const activatableZoneCards = spectating
    ? []
    : [...player.graveyard, ...player.banish].filter((card) =>
      !interaction.optimisticallyHiddenIds.has(card.instanceId) &&
      interaction.legalState.activatable.has(card.instanceId) &&
      !interaction.legalState.playableZones.has(card.instanceId)
    );
  const [scrollAvailability, setScrollAvailability] = useState<HandScrollAvailability>({
    left: false,
    right: false,
  });
  const updateScrollAvailability = useCallback(() => {
    const hand = handRef.current;
    if (!hand) return;
    const next = handScrollAvailability(hand);
    setScrollAvailability((current) =>
      current.left === next.left && current.right === next.right ? current : next
    );
  }, []);

  useEffect(() => {
    const hand = handRef.current;
    if (!hand) return;
    updateScrollAvailability();
    hand.addEventListener("scroll", updateScrollAvailability, { passive: true });
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updateScrollAvailability);
    resizeObserver?.observe(hand);
    window.addEventListener("resize", updateScrollAvailability);
    return () => {
      hand.removeEventListener("scroll", updateScrollAvailability);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateScrollAvailability);
    };
  }, [
    activatableZoneCards.length,
    player.handCount,
    playableZoneCards.length,
    updateScrollAvailability,
    visibleCards.length,
  ]);

  const scrollHand = (direction: -1 | 1) => {
    const hand = handRef.current;
    if (!hand) return;
    const card = hand.querySelector<HTMLElement>(".card-hand");
    const gap = Number.parseFloat(getComputedStyle(hand).columnGap) || 0;
    hand.scrollBy({
      left: direction * ((card?.offsetWidth ?? hand.clientWidth * 0.75) + gap),
      behavior: "smooth",
    });
  };
  const pitchValue = (instanceId: number) => {
    const card = player.hand.find((candidate) => candidate.instanceId === instanceId);
    return card ? (cardData[card.cardId]?.pitch ?? 0) : 0;
  };
  const discardPayment = isDiscardPayment(interaction.selectedPaymentVariants);
  const showBacks = spectating && view.phase !== "game-over" && !(replaying && player.hand.length > 0);
  // A focused source keeps its DOM node but leaves the fan.
  const fannedHandCards = visibleCards.filter((card) =>
    interaction.focusedSourceInstanceId !== card.instanceId
  );
  const handSlots = showBacks ? player.handCount : fannedHandCards.length;
  const fanCount = handSlots + playableZoneCards.length + activatableZoneCards.length;
  const fanSlot = (card: CardView) => {
    const index = fannedHandCards.indexOf(card);
    return index < 0 ? undefined : handFanSlotStyle(index);
  };
  const draggedCard = floatingCard ? handCards.get(floatingCard.instanceId) : undefined;

  return (
    <>
      {draggedCard && floatingCard ? createPortal(
        <div
          ref={floatingCardRef}
          className={`hand-drag-card${dropOnRelease ? " hand-drag-card-playable" : ""}${
            floatingCard.returning ? " hand-drag-card-returning" : ""
          }${floatingCard.previewStacked ? " hand-drag-card-stacked-preview" : ""}`}
          data-reduced-motion={reducedMotion ? "true" : undefined}
          style={{ width: floatingCard.width, height: floatingCard.height }}
          aria-hidden="true"
        >
          <CardFace card={draggedCard} showOverlays={false} />
          {floatingCard.previewWidth > 0 ? (
            <div
              className="hand-drag-preview"
              style={{ width: floatingCard.previewWidth, height: floatingCard.previewHeight }}
            >
              <PreviewCardFace card={draggedCard} showOverlays={false} />
            </div>
          ) : null}
        </div>,
        document.body,
      ) : null}
      <div
        className="hand"
        id="player-hand"
        ref={handRef}
        data-motion-zone={motionLocationKey(handMotionLocation)}
        data-reduced-motion={reducedMotion ? "true" : undefined}
        style={{ "--fan-n": Math.max(1, fanCount) } as CSSProperties}
        {...reorderHandlers}
      >
        {showBacks
          ? Array.from({ length: player.handCount }, (_, index) => (
              <CardBack
                key={index}
                label=""
                size="hand"
                style={handFanSlotStyle(index)}
                motionKey={opaqueMotionPresentationKey(handMotionLocation, index)}
              />
            ))
          : visibleCards.map((card) => {
            const stageable = interaction.defending &&
              interaction.legalState.stageableDefenders.has(card.instanceId);
            const selected =
              ((interaction.selection.kind === "play-hand" ||
                interaction.selection.kind === "choose-hand-action") &&
                interaction.selection.instanceId === card.instanceId) ||
              (interaction.selection.kind === "activate" &&
                interaction.selection.sourceInstanceId === card.instanceId) ||
              interaction.preStackSelectedInstanceId === card.instanceId ||
              (
                interaction.boundedHandPick?.has(card.instanceId) === true &&
                interaction.selectedBoundedChoiceOptionIds?.has(
                  interaction.boundedHandPick.get(card.instanceId)!,
                ) === true
              );
            const resourcePitchable = interaction.resourcePayment !== undefined && (
              interaction.pitchSelection.includes(card.instanceId) ||
              canAddResourcePaymentPitch(
                interaction.resourcePayment,
                interaction.pitchSelection,
                card.instanceId,
              )
            );
            const pitchable = interaction.selection.kind !== "none" && !selected && (
              interaction.pitchSelection.includes(card.instanceId) ||
              canAddPaymentCard(
                interaction.selectedPaymentVariants,
                interaction.pitchSelection,
                card.instanceId,
                pitchValue,
              )
            );
            const actionable = interaction.choosingPitch
              ? !selected && (interaction.resourcePayment ? resourcePitchable : pitchable)
              : interaction.defending
                ? stageable
                : interaction.selection.kind !== "none"
                  ? pitchable || selected
                  : resourcePitchable ||
                    interaction.choosingArsenal ||
                    interaction.handPick?.has(card.instanceId) === true ||
                    interaction.boundedHandPick?.has(card.instanceId) === true ||
                    interaction.legalState.playableHand.has(card.instanceId) ||
                    interaction.legalState.activatable.has(card.instanceId);
            const explanation = !spectating && !replaying && !actionable &&
              interaction.selection.kind === "none"
              ? cardLegalityExplanation(view, viewerSeat, interaction.legalIntents, card).text
              : undefined;
            return (
              <CardFace
                key={card.instanceId}
                card={card}
                style={fanSlot(card)}
                motionKey={motionPresentationKey(handMotionLocation, card.instanceId)}
                focusSourceHidden={interaction.focusedSourceInstanceId === card.instanceId}
                handReorderHint={reorderEnabled && interaction.focusedSourceInstanceId !== card.instanceId
                  ? intl.formatMessage({ id: "game.hand.reorderHint" })
                  : undefined}
                onClick={actionable && interaction.focusedSourceInstanceId !== card.instanceId
                  ? () => interaction.onCardClick(card) : undefined}
                explanation={explanation}
                selected={selected || (
                  discardPayment && interaction.pitchSelection.includes(card.instanceId)
                )}
                pitched={!discardPayment && interaction.pitchSelection.includes(card.instanceId)}
                highlighted={actionable}
                dimmed={interaction.defending && !stageable}
              />
            );
            })}
        {playableZoneCards.map(({ card, zone }, index) => (
            <CardFace
              key={`${zone}-${card.instanceId}`}
              card={card}
              style={handFanSlotStyle(handSlots + index)}
              ghost
              explanation={playableZoneTooltip(card, zone)}
              onClick={() => {
                if (interaction.selection.kind === "none") {
                  interaction.onSelect({ kind: "play-zone", instanceId: card.instanceId, zone });
                }
              }}
              selected={interaction.selection.kind === "play-zone" &&
                interaction.selection.instanceId === card.instanceId}
              highlighted
            />
        ))}
        {activatableZoneCards.map((card, index) => (
          <CardFace
            key={`activate-${card.instanceId}`}
            card={card}
            style={handFanSlotStyle(handSlots + playableZoneCards.length + index)}
            ghost
            onClick={() => interaction.onActivate(card.instanceId)}
            selected={interaction.selection.kind === "activate" &&
              interaction.selection.sourceInstanceId === card.instanceId}
            highlighted
          />
        ))}
        {player.handCount === 0 ? (
          // An empty hand still needs a real resting slot so an effect draw
          // that is discarded at once lands in hand like any other draw.
          <div
            className="card card-hand hand-slot-probe"
            aria-hidden="true"
            data-motion-zone-anchor={motionLocationKey(handMotionLocation)}
          />
        ) : null}
      </div>
      {scrollAvailability.left ? (
        <button
          type="button"
          className="hand-scroll-button hand-scroll-button-left"
          aria-label={intl.formatMessage({ id: "game.hand.scrollLeft" })}
          aria-controls="player-hand"
          onClick={() => scrollHand(-1)}
        >
          <span className="hand-scroll-glyph" aria-hidden="true">{"<<"}</span>
        </button>
      ) : null}
      {scrollAvailability.right ? (
        <button
          type="button"
          className="hand-scroll-button hand-scroll-button-right"
          aria-label={intl.formatMessage({ id: "game.hand.scrollRight" })}
          aria-controls="player-hand"
          onClick={() => scrollHand(1)}
        >
          <span className="hand-scroll-glyph" aria-hidden="true">{">>"}</span>
        </button>
      ) : null}
    </>
  );
}
