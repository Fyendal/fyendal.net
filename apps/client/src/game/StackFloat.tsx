import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ChainLinkView, StackLayerView } from "@fyendal/shared";
import { CardBack, CardFace } from "./Card.js";
import { BloodDebtTriggerTile, isBloodDebtTrigger } from "./BloodDebtTriggerTile.js";
import type { FloatVisibilityController } from "./floatVisibility.js";
import { useFloatDrag } from "./useFloatDrag.js";

export function stackActivityRevision(
  layers: readonly StackLayerView[],
  attack?: ChainLinkView,
): string {
  const attackKey = attack ? `attack:${attack.attackingCard.instanceId}` : "";
  const layerKeys = layers.map((layer, index) => [
    index,
    layer.card?.instanceId ?? "hidden",
    layer.card?.cardId ?? "",
    layer.seat,
    layer.label,
    layer.optional ? 1 : 0,
    layer.count ?? 1,
  ].join(":"));
  return attackKey || layerKeys.length > 0
    ? [attackKey, ...layerKeys].join("|")
    : "";
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

/** Floating stack window: played cards and triggered/activated ability layers
 *  awaiting resolution (index 0 resolves first and appears rightmost). An
 *  attack still on the stack renders as the bottom/leftmost layer — its combat
 *  chain link only starts once the attack resolves. Defaults to the board's
 *  central game-state axis; draggable vertically only. */
export function StackFloat({
  layers,
  attack,
  context,
  miniHost,
  visibility,
  lessGuidance = false,
  onSkipRunechants,
}: {
  layers: StackLayerView[];
  /** declared attack still on the stack (newest chain link, pre-defend) */
  attack?: ChainLinkView;
  /** Combat phase/step and reason these layers are waiting. */
  context?: string;
  /** The playmat divider dock that anchors the minimized control. */
  miniHost?: HTMLElement | null;
  /** Optional controller shared with sibling floats on compact layouts. */
  visibility?: FloatVisibilityController;
  /** Hide explanatory layer labels while retaining the stack objects. */
  lessGuidance?: boolean;
  /** One-shot shortcut offered only during the viewer's Runechant choice. */
  onSkipRunechants?: () => void;
}) {
  const [localHidden, setLocalHidden] = useState(false);
  const stackHidden = visibility?.hidden ?? localHidden;
  const setStackHidden = visibility?.setHidden ?? setLocalHidden;
  const stackFloat = useFloatDrag({ axis: "y", hTransform: "none" });
  const stackSize = layers.length + (attack ? 1 : 0);
  const stackRevision = stackActivityRevision(layers, attack);
  const previousStackRevision = useRef("");
  useEffect(() => {
    const shouldReveal = stackActivityShouldReveal(previousStackRevision.current, stackRevision);
    previousStackRevision.current = stackRevision;
    if (shouldReveal) setStackHidden(false);
  }, [setStackHidden, stackRevision]);
  if (stackSize === 0) return null;
  if (stackHidden) {
    const minimized = (
      <button
        className={`stack-mini${miniHost ? " stack-mini-anchored" : ""}`}
        style={miniHost ? undefined : stackFloat.style}
        onClick={() => setStackHidden(false)}
        title="Show stack"
      >
        <span className="stack-mini-title">
          <span className="mini-title-long">The Stack</span>
          <span className="mini-title-short">Stack</span>
        </span>
        <span className="stack-mini-count">{stackSize}</span>
      </button>
    );
    return miniHost ? createPortal(minimized, miniHost) : minimized;
  }
  return (
    <div className="float stack-float" style={stackFloat.style} {...stackFloat.dragProps}>
      <div className="chain-float-bar">
        <span className="chain-float-title stack-title">The Stack</span>
        {onSkipRunechants ? (
          <button
            className="stack-skip-runechants"
            onClick={onSkipRunechants}
            title="Skip consecutive Runechants in this priority window"
            type="button"
          >
            Skip all Runechants
          </button>
        ) : null}
        <button
          className="chain-hide stack-hide"
          title="Minimize stack"
          aria-label="Minimize stack"
          onClick={() => setStackHidden(true)}
        >
          —
        </button>
      </div>
      {context ? <div className="stack-context">{context}</div> : null}
      <div className="stack-layers">
        {layers.map((l, i) => {
          const bloodDebt = isBloodDebtTrigger(l.label);
          const count = l.count ?? 1;
          return (
            <div key={`${l.card?.instanceId ?? "x"}-${i}`} className="stack-layer">
              {bloodDebt ? (
                <BloodDebtTriggerTile count={count} />
              ) : l.card ? (
                <CardFace card={l.card} size="zone" dimmed={l.card.faceDown} />
              ) : (
                <CardBack label="Trigger" />
              )}
              {!bloodDebt && count > 1 ? (
                <span className="stack-layer-count" aria-label={`${count} grouped triggers`}>
                  ×{count}
                </span>
              ) : null}
              {!bloodDebt && !lessGuidance ? (
                <div className="stack-label">
                  {stackLayerLabel(l.label)}
                  {l.optional && <span className="muted"> (may)</span>}
                </div>
              ) : null}
            </div>
          );
        })}
        {attack && (
          <div className="stack-layer stack-attack">
            <CardFace
              card={attack.attackingCard}
              size="zone"
              goAgain={attack.goAgain}
              dominate={attack.dominate}
              overpower={attack.overpower}
              wagered={attack.wagered}
              wagerRewards={attack.wagerRewards}
              showTapped={false}
            />
          </div>
        )}
      </div>
    </div>
  );
}
