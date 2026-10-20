import { useEffect, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { createPortal } from "react-dom";
import type { AttackQueueEntryView, StackLayerView, TokenSkipKind } from "@fyendal/shared";
import { TooltipButton } from "../components/TooltipButton.js";
import { UiIcon } from "../components/UiIcon.js";
import { cardData } from "@fyendal/cards/client";
import { CardBack, CardFace } from "./Card.js";
import { BloodDebtTriggerTile, isBloodDebtTrigger } from "./BloodDebtTriggerTile.js";
import type { FloatVisibilityController } from "./floatVisibility.js";
import { motionLocationKey, motionPresentationKey } from "./motion/motionTypes.js";
import { localizeTimingLabel } from "./timingLocalization.js";
import { useFloatDrag } from "./useFloatDrag.js";
import { formatGameMessage } from "../i18n/GameMessage.js";

export function stackActivityRevision(
  layers: readonly StackLayerView[],
  queue: readonly AttackQueueEntryView[] = [],
): string {
  const layerKeys = layers.map((layer, index) => [
    index,
    layer.card?.instanceId ?? "hidden",
    layer.card?.cardId ?? "",
    layer.seat,
    layer.labelMessage?.id ?? "",
    layer.label,
    layer.optional ? 1 : 0,
    layer.count ?? 1,
  ].join(":"));
  const queueKeys = queue.map((entry) => `queue:${entry.card.instanceId}`);
  return [...layerKeys, ...queueKeys].join("|");
}

export function stackActivityShouldReveal(previous: string, current: string): boolean {
  return current !== "" && current !== previous;
}

/** Heave layers represent an opportunity that has not been paid for yet. The
 * shorter engine label sounded like the card had already been heaved, which
 * made a later, ordinary face-down arsenal choice look like a rules error. */
export function stackLayerLabel(label: string): string {
  return /^Heave \d+$/.test(label) ? `${label} opportunity` : label;
}

/** Attacks waiting their turn on the combat chain, first attack first. Each
 * is a slim chip, not a full card, so the queue adds one short row instead of
 * a second card row over the combat chain. */
function AttackQueueChips({ queue }: { queue: readonly AttackQueueEntryView[] }) {
  return (
    <ol className="stack-queue-chips">
      {queue.map((entry, index) => {
        const location = { kind: "attack-queue", index } as const;
        return (
          <li
            key={entry.card.instanceId}
            className="stack-queue-chip"
            data-motion-zone={motionLocationKey(location)}
          >
            <span className="stack-queue-order" aria-hidden="true">{index + 1}</span>
            <CardFace
              card={entry.card}
              size="zone"
              squareArt={false}
              motionKey={motionPresentationKey(location, entry.card.instanceId)}
            />
            <span className="stack-queue-name">
              {entry.card.name ?? cardData[entry.card.cardId]?.name ?? entry.card.cardId}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const TOKEN_SKIP_MESSAGES = {
  runechant: { label: "game.stack.skipRunechants", tooltip: "game.stack.skipRunechantsTitle" },
  "seismic-surge": { label: "game.stack.skipSeismicSurges", tooltip: "game.stack.skipSeismicSurgesTitle" },
} as const satisfies Record<TokenSkipKind, { label: string; tooltip: string }>;

/** One-shot shortcut through the token run on top of the stack. The token
 * kind tints the control so it reads as belonging to the layer below it. */
function TokenSkipButton({ kind, onSkip }: { kind: TokenSkipKind; onSkip: () => void }) {
  const intl = useIntl();
  const messages = TOKEN_SKIP_MESSAGES[kind];
  const label = intl.formatMessage({ id: messages.label });
  return (
    <TooltipButton
      className="stack-token-skip"
      data-token={kind}
      onClick={onSkip}
      tooltip={intl.formatMessage({ id: messages.tooltip })}
      aria-label={label}
    >
      <UiIcon name="skip-forward" className="stack-token-skip-icon" />
      {label}
    </TooltipButton>
  );
}

function AttackQueueLabel({ withHint }: { withHint: boolean }) {
  const intl = useIntl();
  return (
    <span className="stack-queue-label">
      <UiIcon name="attack-queue" className="stack-queue-icon" />
      <span className="stack-queue-title">{intl.formatMessage({ id: "game.stack.queue.title" })}</span>
      {withHint ? (
        <span className="stack-queue-hint">{intl.formatMessage({ id: "game.stack.queue.hint" })}</span>
      ) : null}
    </span>
  );
}

/** Floating stack window: played cards and triggered/activated ability layers
 *  awaiting resolution (index 0 resolves first and appears rightmost). On
 *  desktop this defaults in the open lane between the opponent's arms and
 *  first weapon. */
export function StackFloat({
  layers,
  queue = [],
  context,
  miniHost,
  visibility,
  motionDeferred = false,
  tokenSkip,
  autoPassedTopLayer = false,
}: {
  layers: StackLayerView[];
  /** Attacks waiting to move onto the combat chain, first attack first. */
  queue?: readonly AttackQueueEntryView[];
  /** Keep geometry mounted until the incoming card actually starts moving. */
  motionDeferred?: boolean;
  /** Combat phase/step and reason these layers are waiting. */
  context?: string;
  /** The playmat divider dock that anchors the minimized control. */
  miniHost?: HTMLElement | null;
  /** Optional controller shared with sibling floats on compact layouts. */
  visibility?: FloatVisibilityController;
  /** One-shot shortcut offered only during the viewer's Runechant or
   *  Seismic Surge choice. */
  tokenSkip?: { kind: TokenSkipKind; onSkip: () => void };
  /** The top layer's priority window was passed by the viewer's standing order. */
  autoPassedTopLayer?: boolean;
}) {
  const intl = useIntl();
  const [localHidden, setLocalHidden] = useState(false);
  const stackHidden = visibility?.hidden ?? localHidden;
  const setStackHidden = visibility?.setHidden ?? setLocalHidden;
  const stackFloat = useFloatDrag();
  const stackSize = layers.length;
  const layerMotionKeys = layers.map((layer, index) => layer.card
    ? motionPresentationKey({ kind: "stack-layer", index }, layer.card.instanceId)
    : undefined);
  const stackRevision = stackActivityRevision(layers, queue);
  const previousStackRevision = useRef("");
  useEffect(() => {
    const shouldReveal = stackActivityShouldReveal(previousStackRevision.current, stackRevision);
    previousStackRevision.current = stackRevision;
    if (shouldReveal) setStackHidden(false);
  }, [setStackHidden, stackRevision]);
  if (stackSize === 0 && queue.length === 0) return null;
  if (stackHidden) {
    const minimized = (
      <TooltipButton
        className={`stack-mini${miniHost ? " stack-mini-anchored" : ""}`}
        style={{ ...(miniHost ? {} : stackFloat.style), visibility: motionDeferred ? "hidden" : undefined }}
        onClick={() => setStackHidden(false)}
        tooltip={intl.formatMessage({ id: "game.stack.show" })}
      >
        <span className="stack-mini-title">
          <span className="mini-title-long">{intl.formatMessage({ id: "game.stack.title" })}</span>
          <span className="mini-title-short">{intl.formatMessage({ id: "game.stack.short" })}</span>
        </span>
        <span className="stack-mini-count">{stackSize + queue.length}</span>
      </TooltipButton>
    );
    return miniHost ? createPortal(minimized, miniHost) : minimized;
  }
  if (stackSize === 0) {
    // Between layers only the queue remains. A one-line strip in the stack's
    // lane keeps the order visible without covering the attack being fought.
    return (
      <section
        className="float stack-float stack-queue-strip"
        aria-label={intl.formatMessage({ id: "game.stack.queue.title" })}
        style={{ ...stackFloat.style, visibility: motionDeferred ? "hidden" : undefined }}
        {...stackFloat.dragProps}
      >
        <AttackQueueLabel withHint={false} />
        <AttackQueueChips queue={queue} />
        <TooltipButton
          className="chain-hide stack-hide"
          tooltip={intl.formatMessage({ id: "game.stack.minimize" })}
          onClick={() => setStackHidden(true)}
        >
          <span className="chain-hide-icon" aria-hidden="true">—</span>
        </TooltipButton>
      </section>
    );
  }
  return (
    <div
      className="float stack-float"
      style={{ ...stackFloat.style, visibility: motionDeferred ? "hidden" : undefined }}
      {...stackFloat.dragProps}
    >
      <div className="chain-float-bar">
        <span className="chain-float-title stack-title">
          {intl.formatMessage({ id: "game.stack.title" })}
        </span>
        {tokenSkip ? <TokenSkipButton kind={tokenSkip.kind} onSkip={tokenSkip.onSkip} /> : null}
        <TooltipButton
          className="chain-hide stack-hide"
          tooltip={intl.formatMessage({ id: "game.stack.minimize" })}
          onClick={() => setStackHidden(true)}
        >
          <span className="chain-hide-icon" aria-hidden="true">—</span>
        </TooltipButton>
      </div>
      {context ? (
        <div className="stack-context">{localizeTimingLabel(intl, context)}</div>
      ) : null}
      <div className="stack-layers">
        {layers.map((l, i) => {
          const bloodDebt = isBloodDebtTrigger(l.label);
          const count = l.count ?? 1;
          return (
            <div
              key={`${l.card?.instanceId ?? "x"}-${i}`}
              className="stack-layer"
              data-motion-zone={motionLocationKey({ kind: "stack-layer", index: i })}
            >
              {bloodDebt ? (
                <BloodDebtTriggerTile count={count} />
              ) : l.card ? (
                <CardFace
                  card={l.card}
                  size="zone"
                  squareArt={false}
                  dimmed={l.card.faceDown}
                  motionKey={layerMotionKeys[i]}
                />
              ) : (
                <CardBack label={intl.formatMessage({ id: "game.stack.trigger" })} square={false} />
              )}
              {!bloodDebt && count > 1 ? (
                <span
                  className="stack-layer-count"
                  aria-label={intl.formatMessage({ id: "game.stack.groupedTriggers" }, { count })}
                >
                  ×{count}
                </span>
              ) : null}
              {!bloodDebt ? (
                <div className="stack-label">
                  {stackLayerLabel(l.labelMessage
                    ? formatGameMessage(intl, l.labelMessage, {
                        card: (cardId) => l.card?.cardId === cardId
                          ? (l.card.name ?? cardId)
                          : cardId,
                      })
                    : l.label)}
                  {l.optional ? (
                    <span className="muted"> ({intl.formatMessage({ id: "game.stack.optional" })})</span>
                  ) : null}
                </div>
              ) : null}
              {i === 0 && autoPassedTopLayer ? (
                <span className="stack-layer-auto" role="status">
                  {intl.formatMessage({ id: "game.standingOrder.stack.passed" })}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      {queue.length > 0 ? (
        <section className="stack-queue" aria-label={intl.formatMessage({ id: "game.stack.queue.title" })}>
          <AttackQueueLabel withHint />
          <AttackQueueChips queue={queue} />
        </section>
      ) : null}
    </div>
  );
}
