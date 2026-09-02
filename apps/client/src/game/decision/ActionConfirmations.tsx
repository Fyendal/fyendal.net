import { useIntl, type IntlShape } from "react-intl";
import { CardRef } from "./DecisionShared.js";

export function boostOptionLabel(
  intl: IntlShape,
  count: number,
  offersMultipleBoosts: boolean,
): string {
  if (count === 0) return intl.formatMessage({ id: "game.decision.boost.none" });
  if (count === 1) {
    return intl.formatMessage({
      id: offersMultipleBoosts ? "game.decision.boost.once" : "game.decision.boost.action",
    });
  }
  return intl.formatMessage({ id: "game.decision.boost.times" }, { count });
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
  const intl = useIntl();
  return (
    <>
      <span className="decision-prompt">{intl.formatMessage({ id: "game.decision.closeChain.prompt" })}</span>
      <span className="decision-context">
        {intl.formatMessage(
          { id: "game.decision.closeChain.context" },
          { card: cardId ? <CardRef id={cardId} /> : intl.formatMessage({ id: "game.card.nonAttack" }) },
        )}
      </span>
      <div className="decision-buttons">
        <button
          className="btn-primary shortcut-button"
          onClick={onConfirm}
          title={intl.formatMessage(
            { id: "common.shortcut.space" },
            { label: intl.formatMessage({ id: "game.decision.closeChain.action" }) },
          )}
          aria-keyshortcuts="Space"
        >
          {intl.formatMessage({ id: "game.decision.closeChain.action" })}
          <kbd className="shortcut-key" aria-label={intl.formatMessage({ id: "common.spaceKey" })} />
        </button>
        <button onClick={onCancel}>{intl.formatMessage({ id: "common.cancel" })}</button>
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
  const intl = useIntl();
  const verb = intl.formatMessage({ id: activation ? "game.action.activate" : "game.action.play" });
  return (
    <>
      <span className="decision-prompt">
        {intl.formatMessage(
          { id: "game.decision.action.confirm" },
          {
            verb,
            target: cardId
              ? <CardRef id={cardId} />
              : intl.formatMessage({ id: activation ? "game.ability" : "game.card" }),
          },
        )}
      </span>
      <div className="decision-buttons">
        <button
          className="btn-primary shortcut-button"
          onClick={onConfirm}
          title={intl.formatMessage({ id: "common.shortcut.space" }, { label: verb })}
          aria-keyshortcuts="Space"
        >
          {verb}
          <kbd className="shortcut-key" aria-label={intl.formatMessage({ id: "common.spaceKey" })} />
        </button>
        <button onClick={onCancel}>{intl.formatMessage({ id: "common.cancel" })}</button>
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
  const intl = useIntl();
  return (
    <>
      <span className="decision-prompt">{intl.formatMessage({ id: "game.decision.arsenal.prompt" })}</span>
      <span className="decision-context">
        {intl.formatMessage({ id: "game.decision.arsenal.context" })}
      </span>
      <div className="decision-buttons">
        <button className="btn-primary" onClick={onConfirm}>
          {intl.formatMessage({ id: "game.decision.arsenal.action" })}
        </button>
        <button onClick={onCancel}>{intl.formatMessage({ id: "common.cancel" })}</button>
      </div>
    </>
  );
}

export function OptDecisionInstructions({ cardCount }: { cardCount: number }) {
  const intl = useIntl();
  if (cardCount < 2) return null;
  return (
    <span className="decision-context">
      {intl.formatMessage({ id: "game.decision.opt.instructions" })}
    </span>
  );
}
