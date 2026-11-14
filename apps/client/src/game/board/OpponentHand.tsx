import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useIntl } from "react-intl";
import type { CardView, GameView, PlayerView } from "@fyendal/shared";
import { CardBack, CardFace } from "../Card.js";
import { UiIcon } from "../../components/UiIcon.js";
import { cardLegalityExplanation } from "../causalExplanations.js";
import { playableZoneTooltip } from "../playableZoneTooltip.js";
import {
  motionLocationKey,
  motionPresentationKey,
  opaqueMotionPresentationKey,
} from "../motion/motionTypes.js";
import { handFanSlotStyle } from "./handFan.js";
import { handCardState, handZoneCards } from "./handCardState.js";
import { preservePreStackHandOrder, type PlayerHandInteraction } from "./PlayerHand.js";
import { soloHandPresentation, type SoloHandPresentation, type SoloSideState } from "./soloControl.js";
import type { BoardLegalState } from "./boardModel.js";
import {
  sameSoloHandFrame,
  soloHandFrame,
  soloHandWings,
  type Box,
  type SoloHandFrame,
} from "./soloHand.js";

/** Bottom edge of the solo top hand, for floats that sit beside it. */
const TOP_HAND_BOTTOM_VAR = "--solo-top-hand-bottom";

function boxOf(element: Element | null | undefined): Box | null {
  return element ? element.getBoundingClientRect() : null;
}

/** Measures the top half's free row so the wings follow every board layout. */
function useSoloHandFrame(anchor: HTMLElement | null, enabled: boolean, chipRoom: boolean): SoloHandFrame | null {
  const [frame, setFrame] = useState<SoloHandFrame | null>(null);
  useLayoutEffect(() => {
    const board = anchor?.closest<HTMLElement>(".board");
    const table = anchor?.closest<HTMLElement>(".table");
    if (!enabled || !board) {
      setFrame(null);
      return;
    }
    const half = () => board.querySelector<HTMLElement>(".mat-half.mat-opp");
    const zone = (name: string) => half()?.querySelector(`:scope > .zone-${name}`);
    const measure = () => {
      const next = soloHandFrame({
        board: board.getBoundingClientRect(),
        legs: boxOf(zone("legs")),
        arsenal: boxOf(zone("arsenal")),
        banished: boxOf(zone("banished")),
        nameplate: boxOf(board.querySelector(".player-nameplate-opponent")),
        hud: boxOf(table?.querySelector(".status-float")),
        chipRoom,
      });
      setFrame((current) => (sameSoloHandFrame(current, next) ? current : next));
      if (next) {
        table?.style.setProperty(TOP_HAND_BOTTOM_VAR, `${Math.round(board.getBoundingClientRect().top + next.bottom)}px`);
      } else {
        table?.style.removeProperty(TOP_HAND_BOTTOM_VAR);
      }
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(board);
    const hud = table?.querySelector(".status-float");
    if (hud) resize.observe(hud);
    const observed = half();
    if (observed) {
      resize.observe(observed);
      for (const child of observed.children) resize.observe(child);
    }
    // Zones remount when the arsenal gains a slot or equipment taps.
    const mutations = observed ? new MutationObserver(measure) : null;
    if (observed) mutations?.observe(observed, { childList: true, attributes: true, attributeFilter: ["class"] });
    window.addEventListener("resize", measure);
    return () => {
      resize.disconnect();
      mutations?.disconnect();
      window.removeEventListener("resize", measure);
      table?.style.removeProperty(TOP_HAND_BOTTOM_VAR);
    };
  }, [anchor, chipRoom, enabled]);
  return frame;
}

/** The hand at the top of the board: backs, the revealed hand after the game,
 * or in solo the second seat's face-up hand, clickable while that seat acts.
 * On desktop the solo hand sits in two wings either side of the arsenal. */
export function OpponentHand({
  view,
  player,
  presentedCount,
  revealed,
  solo,
  side = null,
  wings = false,
  effectsBelow = false,
  steadyLegalState = null,
  interaction,
}: {
  view: GameView;
  player: PlayerView;
  presentedCount: number;
  revealed: boolean;
  solo: boolean;
  /** Solo: whether this seat is the one acting. */
  side?: SoloSideState | null;
  /** Solo desktop layout; phones use a strip that opens into a tray. */
  wings?: boolean;
  /** This seat has effect chips in the slot the left wing rests over. */
  effectsBelow?: boolean;
  /** Legal state ignoring pending commands and the seat-switch lock, so the
   * hand does not shrink and regrow around every click. */
  steadyLegalState?: BoardLegalState | null;
  /** Present only while this seat acts in solo. */
  interaction: PlayerHandInteraction | null;
}) {
  const intl = useIntl();
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  const frame = useSoloHandFrame(anchor, solo && wings, effectsBelow);
  const previousOrder = useRef<readonly number[]>([]);
  const location = { kind: "hand" as const, seat: player.seat };
  const faceUp = revealed || solo;
  const hiddenIds = interaction?.optimisticallyHiddenIds;
  const stagedIds = interaction?.stagedIds;
  const cards = faceUp
    ? player.hand.filter((card) =>
        !stagedIds?.has(card.instanceId) && !hiddenIds?.has(card.instanceId))
    : [];
  const focusedId = interaction?.focusedSourceInstanceId ?? null;
  const fanned = cards.filter((card) => card.instanceId !== focusedId);
  // A play paused before the stack is projected back into the hand; keep it in place.
  const ordered = preservePreStackHandOrder(
    fanned,
    previousOrder.current,
    interaction?.preStackSelectedInstanceId ?? null,
  );
  useEffect(() => {
    previousOrder.current = ordered.map((card) => card.instanceId);
  });
  // The acting hand comes forward only when something in it can be used.
  const steadyInteraction = interaction && steadyLegalState
    ? { ...interaction, legalState: steadyLegalState }
    : interaction;
  const steadyZoneCards = handZoneCards(view, player, steadyInteraction);
  const usable = steadyInteraction !== null && (
    cards.some((card) => handCardState(card, player, steadyInteraction).actionable)
    || steadyZoneCards.playable.length + steadyZoneCards.activatable.length > 0
  );
  const presentedSide = soloHandPresentation(side, usable);
  // Phone: open while this seat can act; a tap overrides until control changes sides.
  const [trayOverride, setTrayOverride] = useState<{ side: SoloHandPresentation | null; open: boolean } | null>(null);
  const trayOpen = trayOverride !== null && trayOverride.side === presentedSide
    ? trayOverride.open
    : presentedSide === "acting";
  const setTrayOpen = (open: boolean) => setTrayOverride({ side: presentedSide, open });
  const zoneCards = handZoneCards(view, player, interaction);
  const count = faceUp ? fanned.length : presentedCount;
  const label = intl.formatMessage({ id: "game.hand.opponentCount" }, { count });

  const handCard = (card: CardView, style: CSSProperties | undefined) => {
    const state = handCardState(card, player, interaction);
    const explanation = interaction && !state.actionable && interaction.selection.kind === "none"
      ? cardLegalityExplanation(view, player.seat, interaction.legalIntents, card).text
      : undefined;
    return (
      <CardFace
        key={card.instanceId}
        card={card}
        style={style}
        motionKey={motionPresentationKey(location, card.instanceId)}
        focusSourceHidden={card.instanceId === focusedId}
        onClick={interaction && state.actionable && card.instanceId !== focusedId
          ? () => interaction.onCardClick(card)
          : undefined}
        explanation={explanation}
        selected={state.selected}
        pitched={state.pitched}
        highlighted={state.actionable}
        dimmed={state.dimmed}
      />
    );
  };
  const ghostCards: ((style: CSSProperties | undefined) => ReactNode)[] = interaction
    ? [
        ...zoneCards.playable.map(({ card, zone }) => (style: CSSProperties | undefined) => (
          <CardFace
            key={`${zone}-${card.instanceId}`}
            card={card}
            style={style}
            ghost
            explanation={playableZoneTooltip(intl, card, zone)}
            onClick={() => {
              if (interaction.selection.kind === "none") {
                interaction.onSelect({ kind: "play-zone", instanceId: card.instanceId, zone });
              }
            }}
            selected={interaction.selection.kind === "play-zone" &&
              interaction.selection.instanceId === card.instanceId}
            highlighted
          />
        )),
        ...zoneCards.activatable.map((card) => (style: CSSProperties | undefined) => (
          <CardFace
            key={`activate-${card.instanceId}`}
            card={card}
            style={style}
            ghost
            onClick={() => interaction.onActivate(card.instanceId)}
            selected={interaction.selection.kind === "activate" &&
              interaction.selection.sourceInstanceId === card.instanceId}
            highlighted
          />
        )),
      ]
    : [];
  const entries = [
    ...ordered.map((card) => (style: CSSProperties | undefined) => handCard(card, style)),
    ...ghostCards,
  ];
  const focused = cards.find((card) => card.instanceId === focusedId);
  const emptyAnchor = cards.length === 0 ? (
    <div
      className="card card-hand hand-slot-probe"
      aria-hidden="true"
      data-motion-zone-anchor={motionLocationKey(location)}
    />
  ) : null;

  if (solo && wings && frame) {
    const layout = soloHandWings(frame, entries.length);
    const leftWidth = frame.gapLeft - frame.left;
    const cardSize = { width: layout.cardWidth, height: layout.cardHeight };
    const leftEntries = entries.slice(0, layout.left.count);
    const rightEntries = entries.slice(layout.left.count);
    return (
      <div
        ref={setAnchor}
        className={`opp-hand opp-hand-solo opp-hand-wings${presentedSide ? ` opp-hand-${presentedSide}` : ""}${interaction ? " opp-hand-interactive" : ""}`}
        data-motion-zone={motionLocationKey(location)}
        role="group"
        aria-label={label}
      >
        <div
          className="opp-hand-wing opp-hand-wing-left"
          style={{ left: frame.left, top: frame.top, width: leftWidth, height: layout.cardHeight }}
        >
          {leftEntries.map((render, index) => render({
            ...cardSize,
            left: leftWidth - layout.cardWidth - (leftEntries.length - 1 - index) * layout.left.step,
            zIndex: index + 1,
          }))}
        </div>
        <div
          className="opp-hand-wing opp-hand-wing-right"
          style={{ left: frame.gapRight, top: frame.top, width: frame.right - frame.gapRight, height: layout.cardHeight }}
        >
          {rightEntries.map((render, index) => render({
            ...cardSize,
            left: index * layout.right.step,
            zIndex: index + 1,
          }))}
          {focused ? handCard(focused, { ...cardSize, left: 0 }) : null}
          {emptyAnchor}
        </div>
      </div>
    );
  }

  if (solo && !wings) {
    return (
      <div
        ref={setAnchor}
        className={`opp-hand opp-hand-solo opp-hand-phone${trayOpen ? " opp-hand-open" : ""}${presentedSide ? ` opp-hand-${presentedSide}` : ""}${interaction ? " opp-hand-interactive" : ""}`}
        data-motion-zone={motionLocationKey(location)}
        role="group"
        aria-label={label}
        style={{ "--fan-n": Math.max(1, entries.length) } as CSSProperties}
      >
        {trayOpen ? (
          <>
            <div className="opp-hand-tray">
              {entries.map((render) => render(undefined))}
              {focused ? handCard(focused, undefined) : null}
              {emptyAnchor}
            </div>
            <button
              type="button"
              className="opp-hand-tray-toggle"
              aria-expanded
              aria-label={intl.formatMessage({ id: "game.hand.hide" })}
              onClick={() => setTrayOpen(false)}
            >
              <UiIcon name="chevron-up" />
            </button>
          </>
        ) : (
          <>
            {cards.map((card) => {
              const index = ordered.indexOf(card);
              return handCard(card, index < 0 ? undefined : handFanSlotStyle(index));
            })}
            {emptyAnchor}
            <button
              type="button"
              className="opp-hand-peek"
              aria-expanded={false}
              aria-label={intl.formatMessage({ id: "game.hand.showCount" }, { count })}
              onClick={() => setTrayOpen(true)}
            />
          </>
        )}
      </div>
    );
  }

  return (
    <div
      ref={setAnchor}
      className={`opp-hand${faceUp ? " opp-hand-revealed" : ""}${solo ? " opp-hand-solo" : ""}${presentedSide ? ` opp-hand-${presentedSide}` : ""}${interaction ? " opp-hand-interactive" : ""}`}
      data-motion-zone={motionLocationKey(location)}
      role="group"
      aria-label={label}
      style={{ "--fan-n": Math.max(1, count + (solo ? zoneCards.playable.length + zoneCards.activatable.length : 0)) } as CSSProperties}
    >
      {faceUp
        ? cards.map((card) => {
            const index = ordered.indexOf(card);
            return handCard(card, index < 0 ? undefined : handFanSlotStyle(index));
          })
        : Array.from({ length: presentedCount }, (_, i) => (
            <CardBack
              key={i}
              label=""
              size="hand"
              style={handFanSlotStyle(i)}
              motionKey={opaqueMotionPresentationKey(location, i)}
              motionZoneAnchor={i === presentedCount - 1 ? motionLocationKey(location) : undefined}
            />
          ))}
      {solo ? ghostCards.map((render, index) => render(handFanSlotStyle(fanned.length + index))) : null}
      {solo ? emptyAnchor : null}
      {presentedCount === 0 && !solo ? <span className="muted">opponent has no cards in hand</span> : null}
      <span className="opp-hand-count" aria-hidden="true">{presentedCount}</span>
    </div>
  );
}
