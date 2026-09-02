import { CardRef } from "./DecisionShared.js";

export function boostOptionLabel(count: number, offersMultipleBoosts: boolean): string {
  if (count === 0) return "Don't Boost";
  if (count === 1) return offersMultipleBoosts ? "Boost once" : "Boost";
  return `Boost ${count} times`;
}

/** Present affirmative Boost choices first while retaining the engine's
 * ascending order when an attack can Boost more than once. */
export function orderedBoostOptions(options: readonly number[]): number[] {
  return [...options].sort((left, right) => {
    if (left === 0) return right === 0 ? 0 : 1;
    if (right === 0) return -1;
    return left - right;
  });
}

export function ChainCloseConfirmation({
  cardId,
  onConfirm,
  onCancel,
}: {
  cardId: string | undefined;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <span className="decision-prompt">Close the combat chain?</span>
      <span className="decision-context">
        Playing {cardId ? <CardRef id={cardId} /> : "this non-attack action"} will close the current combat chain.
      </span>
      <div className="decision-buttons">
        <button
          className="btn-primary shortcut-button"
          onClick={onConfirm}
          title="Close Chain and Play (Space)"
          aria-keyshortcuts="Space"
        >
          Close Chain and Play
          <kbd className="shortcut-key" aria-label="Space key" />
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </>
  );
}

export function ActionConfirmation({
  cardId,
  activation,
  onConfirm,
  onCancel,
}: {
  cardId: string | undefined;
  activation: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const verb = activation ? "Activate" : "Play";
  return (
    <>
      <span className="decision-prompt">
        {verb} {cardId ? <CardRef id={cardId} /> : activation ? "ability" : "card"}?
      </span>
      <div className="decision-buttons">
        <button
          className="btn-primary shortcut-button"
          onClick={onConfirm}
          title={`${verb} (Space)`}
          aria-keyshortcuts="Space"
        >
          {verb}
          <kbd className="shortcut-key" aria-label="Space key" />
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </>
  );
}

export function ArsenalSkipConfirmation({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <span className="decision-prompt">Skip arsenal?</span>
      <span className="decision-context">
        End the turn without putting a card into your arsenal?
      </span>
      <div className="decision-buttons">
        <button className="btn-primary" onClick={onConfirm}>Skip Arsenal</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </>
  );
}

export function OptDecisionInstructions({ cardCount }: { cardCount: number }) {
  if (cardCount < 2) return null;
  return (
    <span className="decision-context">
      Last Top is topmost; last Bottom is bottommost.
    </span>
  );
}
