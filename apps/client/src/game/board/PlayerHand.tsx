import { useCallback, useEffect, useRef, useState } from "react";
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
import { cardLegalityExplanation } from "../causalExplanations.js";
import {
  canAddPitch,
  canAddResourcePaymentPitch,
} from "../legalSelection.js";
import { playableZoneTooltip } from "../playableZoneTooltip.js";
import {
  motionLocationKey,
  opaqueMotionPresentationKey,
  motionPresentationKey,
} from "../motion/motionTypes.js";
import type { Sel } from "../useActionAnnouncement.js";
import type { BoardLegalState } from "./boardModel.js";

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
  selectedPaymentVariants: Parameters<typeof canAddPitch>[0];
  resourcePayment?: ResourcePayment;
  stagedIds: ReadonlySet<number>;
  optimisticallyHiddenIds: ReadonlySet<number>;
  defending: boolean;
  choosingArsenal: boolean;
  handPick: ReadonlyMap<number, string> | null;
  onCardClick: (card: CardView) => void;
  onSelect: (selection: Sel) => void;
}

export function PlayerHand({
  view,
  player,
  viewerSeat,
  spectating,
  replaying,
  interaction,
}: {
  view: GameView;
  player: PlayerView;
  viewerSeat: number;
  spectating: boolean;
  replaying: boolean;
  interaction: PlayerHandInteraction;
}) {
  const handMotionLocation = { kind: "hand" as const, seat: player.seat };
  const previousHandOrderRef = useRef<readonly number[]>([]);
  const currentVisibleCards = player.hand.filter((card) =>
    !interaction.stagedIds.has(card.instanceId)
    && !interaction.optimisticallyHiddenIds.has(card.instanceId)
  );
  const visibleCards = preservePreStackHandOrder(
    currentVisibleCards,
    previousHandOrderRef.current,
    interaction.preStackSelectedInstanceId,
  );
  const visibleCardOrderKey = visibleCards.map((card) => card.instanceId).join(":");
  useEffect(() => {
    previousHandOrderRef.current = visibleCards.map((card) => card.instanceId);
  }, [visibleCardOrderKey]);
  const playableZoneCards = spectating
    ? []
    : [...interaction.legalState.playableZones]
      .filter((entry): entry is [number, Exclude<PlayableZone, "deck">] => entry[1] !== "deck")
      .flatMap(([instanceId, zone]) => {
        if (interaction.optimisticallyHiddenIds.has(instanceId)) return [];
        const card = [...player.banish, ...player.graveyard]
          .find((candidate) => candidate.instanceId === instanceId);
        return card ? [{ card, zone }] : [];
      });
  const handRef = useRef<HTMLDivElement>(null);
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

  return (
    <>
      <div
        className="hand"
        id="player-hand"
        ref={handRef}
        data-motion-zone={motionLocationKey(handMotionLocation)}
      >
        {spectating && view.winner === null && !(replaying && player.hand.length > 0)
          ? Array.from({ length: player.handCount }, (_, index) => (
              <CardBack
                key={index}
                label=""
                size="hand"
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
              interaction.preStackSelectedInstanceId === card.instanceId;
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
              canAddPitch(
                interaction.selectedPaymentVariants,
                interaction.pitchSelection,
                card.instanceId,
                pitchValue,
              )
            );
            const actionable = interaction.defending
              ? stageable
              : interaction.selection.kind !== "none"
                ? pitchable || selected
                : resourcePitchable ||
                  interaction.choosingArsenal ||
                  interaction.handPick?.has(card.instanceId) === true ||
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
                motionKey={motionPresentationKey(handMotionLocation, card.instanceId)}
                onClick={actionable ? () => interaction.onCardClick(card) : undefined}
                explanation={explanation}
                selected={selected}
                pitched={interaction.pitchSelection.includes(card.instanceId)}
                highlighted={actionable}
                dimmed={interaction.defending && !stageable}
              />
            );
            })}
        {playableZoneCards.map(({ card, zone }) => (
            <CardFace
              key={`${zone}-${card.instanceId}`}
              card={card}
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
        {!spectating && visibleCards.length === 0 && playableZoneCards.length === 0
          ? <span className="muted">no cards in hand</span>
          : null}
      </div>
      {scrollAvailability.left ? (
        <button
          type="button"
          className="hand-scroll-button hand-scroll-button-left"
          aria-label="Scroll hand left"
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
          aria-label="Scroll hand right"
          aria-controls="player-hand"
          onClick={() => scrollHand(1)}
        >
          <span className="hand-scroll-glyph" aria-hidden="true">{">>"}</span>
        </button>
      ) : null}
    </>
  );
}
