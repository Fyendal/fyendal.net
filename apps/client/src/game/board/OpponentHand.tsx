import type { CSSProperties } from "react";
import { useIntl } from "react-intl";
import type { PlayerView } from "@fyendal/shared";
import { CardBack, CardFace } from "../Card.js";
import {
  motionLocationKey,
  motionPresentationKey,
  opaqueMotionPresentationKey,
} from "../motion/motionTypes.js";
import { handFanSlotStyle } from "./handFan.js";
import { handCardState } from "./handCardState.js";
import type { PlayerHandInteraction } from "./PlayerHand.js";

/** The hand at the top of the board: backs, the revealed hand after the game,
 * or in solo the second seat's face-up hand, clickable while that seat acts. */
export function OpponentHand({
  player,
  presentedCount,
  revealed,
  solo,
  interaction,
}: {
  player: PlayerView;
  presentedCount: number;
  revealed: boolean;
  solo: boolean;
  /** Present only while this seat acts in solo. */
  interaction: PlayerHandInteraction | null;
}) {
  const intl = useIntl();
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
  const count = faceUp ? fanned.length : presentedCount;
  return (
    <div
      className={`opp-hand${faceUp ? " opp-hand-revealed" : ""}${solo ? " opp-hand-solo" : ""}${interaction ? " opp-hand-interactive" : ""}`}
      data-motion-zone={motionLocationKey(location)}
      role="group"
      aria-label={intl.formatMessage({ id: "game.hand.opponentCount" }, { count })}
      style={{ "--fan-n": Math.max(1, count) } as CSSProperties}
    >
      {faceUp
        ? cards.map((card) => {
            const state = handCardState(card, player, interaction);
            const index = fanned.indexOf(card);
            return (
              <CardFace
                key={card.instanceId}
                card={card}
                style={index < 0 ? undefined : handFanSlotStyle(index)}
                motionKey={motionPresentationKey(location, card.instanceId)}
                focusSourceHidden={card.instanceId === focusedId}
                onClick={interaction && state.actionable && card.instanceId !== focusedId
                  ? () => interaction.onCardClick(card)
                  : undefined}
                selected={state.selected}
                pitched={state.pitched}
                highlighted={state.actionable}
                dimmed={state.dimmed}
              />
            );
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
      {solo && cards.length === 0 ? (
        <div
          className="card card-hand hand-slot-probe"
          aria-hidden="true"
          data-motion-zone-anchor={motionLocationKey(location)}
        />
      ) : null}
      {presentedCount === 0 && !solo ? <span className="muted">opponent has no cards in hand</span> : null}
      <span className="opp-hand-count" aria-hidden="true">{presentedCount}</span>
    </div>
  );
}
