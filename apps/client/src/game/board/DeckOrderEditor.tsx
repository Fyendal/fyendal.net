import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useIntl } from "react-intl";
import type { CardView, ManualEdit, ManualMoveDestination } from "@fyendal/shared";
import { ModalSurface } from "../../components/ModalSurface.js";
import { TooltipButton } from "../../components/TooltipButton.js";
import { UiIcon } from "../../components/UiIcon.js";
import type { SandboxEditRefusal } from "../../store/types.js";
import { CardFace } from "../Card.js";
import { cardDisplayName } from "../decision/DecisionShared.js";
import { moveOrderItem, ReorderList } from "../ReorderList.js";
import { SANDBOX_REFUSAL_MESSAGE } from "../SandboxPanel.js";
import { SandboxCardMoves, sandboxMoveRefusalMessage, sandboxMoveShortcut } from "./SandboxCardMoves.js";

function sameOrder(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/** Rebase an unsaved order onto the server's deck: cards that left are dropped,
 * new cards follow in server order, and `changed` says the deck moved under it. */
export function reconcileDeckOrder(
  draft: readonly number[],
  base: readonly number[],
  current: readonly number[],
): { order: number[]; changed: boolean } {
  const present = new Set(current);
  const kept = new Set(draft.filter((id) => present.has(id)));
  return {
    order: [...kept, ...current.filter((id) => !kept.has(id))],
    changed: !sameOrder(base, current),
  };
}

/** Keyboard reordering on a focused card: arrows step, Home/End jump. */
export function deckKeyTarget(key: string, index: number, count: number): number | null {
  switch (key) {
    case "ArrowLeft":
    case "ArrowUp":
      return index > 0 ? index - 1 : null;
    case "ArrowRight":
    case "ArrowDown":
      return index < count - 1 ? index + 1 : null;
    case "Home":
      return index > 0 ? 0 : null;
    case "End":
      return index < count - 1 ? count - 1 : null;
    default:
      return null;
  }
}

interface DeckDraft {
  order: number[];
  /** Server order the draft was last rebased on. */
  base: number[];
}

/** Draw-order editor for one sandbox seat, laid out like the pile viewer. */
export function DeckOrderEditor({
  heroName,
  deck,
  pending,
  refusal,
  onEdit,
  onClearRefusal,
  onClose,
}: {
  heroName: string;
  /** Top first. */
  deck: readonly CardView[];
  pending: boolean;
  refusal: SandboxEditRefusal | null;
  onEdit: (edit: ManualEdit) => void;
  onClearRefusal: () => void;
  onClose: () => void;
}) {
  const intl = useIntl();
  const titleId = useId();
  const helpId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const serverOrder = deck.map((card) => card.instanceId);
  const serverKey = serverOrder.join(",");
  const [draft, setDraft] = useState<DeckDraft | null>(null);
  const [changed, setChanged] = useState(false);
  const [focusId, setFocusId] = useState<number | null>(null);
  const [lastSent, setLastSent] = useState<ManualEdit["kind"] | null>(null);
  /** Server order our own card move should produce; reaching it is no conflict. */
  const expectedOrder = useRef<number[] | null>(null);
  /** Set by Apply so the editor closes once that order arrives. */
  const closeOnApplied = useRef(false);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus({ preventScroll: true });
    return () => previousFocus?.focus({ preventScroll: true });
  }, []);

  // serverKey stands in for the order array, which is rebuilt each render.
  useEffect(() => {
    const expected = expectedOrder.current;
    expectedOrder.current = null;
    if (!draft || sameOrder(draft.base, serverOrder)) return;
    // Our own applied order arriving back is not a conflict.
    if (sameOrder(draft.order, serverOrder)) {
      setDraft(null);
      if (closeOnApplied.current) onClose();
      return;
    }
    closeOnApplied.current = false;
    const rebased = reconcileDeckOrder(draft.order, draft.base, serverOrder);
    const ownMove = expected !== null && sameOrder(expected, serverOrder);
    setChanged(rebased.changed && !ownMove);
    setDraft(sameOrder(rebased.order, serverOrder) ? null : { order: rebased.order, base: serverOrder });
  }, [serverKey]);

  // Keep keyboard focus on the card that just moved.
  useEffect(() => {
    if (focusId === null) return;
    listRef.current?.querySelector<HTMLElement>(`[data-deck-instance="${focusId}"]`)?.focus();
  }, [focusId, draft]);

  const byId = new Map(deck.map((card) => [card.instanceId, card]));
  const order = draft?.order ?? serverOrder;
  const cards = order.flatMap((id) => byId.get(id) ?? []);
  const dirty = draft !== null && !sameOrder(draft.order, serverOrder);
  const last = cards.length - 1;

  const move = (from: number, to: number) => {
    closeOnApplied.current = false;
    setChanged(false);
    setDraft((current) => ({
      order: moveOrderItem(current?.order ?? serverOrder, from, to),
      base: current?.base ?? serverOrder,
    }));
  };
  const send = (edit: ManualEdit) => {
    onClearRefusal();
    setLastSent(edit.kind);
    closeOnApplied.current = edit.kind === "reorder-deck";
    onEdit(edit);
  };
  const moveOut = (instanceId: number, to: ManualMoveDestination) => {
    expectedOrder.current = serverOrder.filter((id) => id !== instanceId);
    send({ kind: "move-card", instanceId, to });
  };
  const onCardKey = (event: KeyboardEvent<HTMLElement>, index: number, instanceId: number) => {
    const out = event.altKey || event.ctrlKey || event.metaKey ? null : sandboxMoveShortcut(event.key);
    if (out) {
      event.preventDefault();
      if (pending) return;
      const next = cards[index + 1] ?? cards[index - 1];
      setFocusId(next?.instanceId ?? null);
      moveOut(instanceId, out);
      return;
    }
    const to = deckKeyTarget(event.key, index, cards.length);
    if (to === null) return;
    event.preventDefault();
    move(index, to);
    setFocusId(instanceId);
  };

  const title = intl.formatMessage({ id: "game.deckOrder.title" }, { hero: heroName });
  const status = refusal
    ? <p className="deck-order-status deck-order-refusal" role="alert">
        {intl.formatMessage({
          id: lastSent === "move-card"
            ? sandboxMoveRefusalMessage(refusal)
            : refusal === "SANDBOX_EDIT_UNAVAILABLE" ? "game.deckOrder.refusal" : SANDBOX_REFUSAL_MESSAGE[refusal],
        })}
      </p>
    : changed
      ? <p className="deck-order-status" role="status">
          {intl.formatMessage({ id: "game.deckOrder.changed" })}
        </p>
      : <p className="deck-order-status" id={helpId}>
          {intl.formatMessage({ id: "game.deckOrder.instructions" })}
        </p>;

  return (
    <div className="overlay zone-overlay deck-order-overlay" onClick={onClose}>
      <div
        ref={panelRef}
        className="overlay-panel zone-overlay-panel zone-viewer deck-order-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }}
      >
        <div className="zone-viewer-header">
          <div className="zone-viewer-heading">
            <h2 className="zone-viewer-title" id={titleId}>{title}</h2>
            <span className="zone-viewer-count">
              {intl.formatMessage({ id: "game.zone.cardCount" }, { count: cards.length })}
            </span>
          </div>
          <button
            type="button"
            className="deck-order-shuffle"
            disabled={pending || dirty || cards.length < 2}
            onClick={() => send({ kind: "shuffle-deck" })}
          >
            <UiIcon name="shuffle" />
            {intl.formatMessage({ id: "game.deckOrder.shuffle" })}
          </button>
          <button
            type="button"
            className="zone-viewer-close"
            aria-label={intl.formatMessage({ id: "common.closeNamed" }, { title })}
            onClick={onClose}
          >
            <UiIcon name="close" />
          </button>
        </div>
        <div className="deck-order-well" ref={listRef}>
          {cards.length === 0 ? (
            <p className="deck-order-empty">{intl.formatMessage({ id: "game.deckOrder.empty" })}</p>
          ) : (
            <ReorderList
              items={cards}
              itemKey={(card) => String(card.instanceId)}
              dragType="application/x-fyendal-deck"
              className="overlay-cards zone-viewer-cards deck-order-cards"
              itemClassName="deck-order-card"
              label={intl.formatMessage({ id: "game.deckOrder.label" })}
              describedBy={refusal || changed ? undefined : helpId}
              grip={false}
              onMove={move}
              renderItem={(card, index) => {
                const name = cardDisplayName(card);
                return <div
                  className="deck-order-slot"
                  tabIndex={0}
                  data-deck-instance={card.instanceId}
                  aria-label={intl.formatMessage(
                    { id: "game.deckOrder.position" },
                    { card: name, position: index + 1, count: cards.length },
                  )}
                  aria-keyshortcuts="H G B"
                  onKeyDown={(event) => onCardKey(event, index, card.instanceId)}
                >
                  <CardFace card={card} size="zone" squareArt={false} />
                  <SandboxCardMoves
                    zone="deck"
                    card={card}
                    pending={pending}
                    focusable={false}
                    onMove={(to) => moveOut(card.instanceId, to)}
                  />
                  <span className="deck-order-position" aria-hidden="true">{index + 1}</span>
                  <span className="deck-order-jump">
                    <TooltipButton
                      tooltip={intl.formatMessage({ id: "game.deckOrder.toTop" })}
                      tooltipSide="above"
                      aria-label={intl.formatMessage({ id: "game.deckOrder.moveToTop" }, { card: name })}
                      tabIndex={-1}
                      disabled={index === 0}
                      onClick={() => move(index, 0)}
                    >
                      <UiIcon name="to-top" />
                    </TooltipButton>
                    <TooltipButton
                      tooltip={intl.formatMessage({ id: "game.deckOrder.toBottom" })}
                      tooltipSide="above"
                      aria-label={intl.formatMessage({ id: "game.deckOrder.moveToBottom" }, { card: name })}
                      tabIndex={-1}
                      disabled={index === last}
                      onClick={() => move(index, last)}
                    >
                      <UiIcon name="to-bottom" />
                    </TooltipButton>
                  </span>
                </div>;
              }}
            />
          )}
        </div>
        <div className="deck-order-footer">
          {status}
          <button
            type="button"
            className="deck-order-reset"
            disabled={!dirty || pending}
            onClick={() => {
              setDraft(null);
              setChanged(false);
            }}
          >
            {intl.formatMessage({ id: "game.sandbox.reset" })}
          </button>
          <button
            type="button"
            className="btn-primary deck-order-apply"
            disabled={!dirty || pending}
            onClick={() => send({ kind: "reorder-deck", instanceIds: order })}
          >
            {intl.formatMessage({ id: pending && dirty ? "game.sandbox.applying" : "game.deckOrder.apply" })}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Asked once per game before the first draw-order reveal. */
export function DeckRevealConfirm({
  mine,
  onConfirm,
  onCancel,
}: {
  /** The deck on the viewer's side of the board, as opposed to the opponent's. */
  mine: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const intl = useIntl();
  return (
    <ModalSurface
      title={intl.formatMessage({ id: "game.deckOrder.reveal.title" })}
      description={intl.formatMessage({ id: "game.deckOrder.reveal.description" }, { owner: mine ? "mine" : "opponent" })}
      className="sandbox-sheet deck-reveal-sheet"
      onClose={onCancel}
    >
      <div className="sandbox-actions">
        <button type="button" className="sandbox-reset" onClick={onCancel}>
          {intl.formatMessage({ id: "common.cancel" })}
        </button>
        <button type="button" className="btn-primary" data-modal-initial-focus onClick={onConfirm}>
          {intl.formatMessage({ id: "game.deckOrder.reveal.confirm" })}
        </button>
      </div>
    </ModalSurface>
  );
}
