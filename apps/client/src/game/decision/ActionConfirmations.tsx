import { useIntl, type IntlShape } from "react-intl";
import { ChoiceCancel, ChoiceList } from "./ChoiceModal.js";
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
      <ChoiceList
        options={[{
          key: "close-chain",
          label: intl.formatMessage({ id: "game.decision.closeChain.action" }),
          spaceDefault: true,
          onChoose: onConfirm,
        }]}
      />
      <ChoiceCancel onCancel={onCancel} />
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
      <ChoiceList
        options={[{ key: "confirm", label: verb, spaceDefault: true, onChoose: onConfirm }]}
      />
      <ChoiceCancel onCancel={onCancel} />
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
      <ChoiceList
        options={[{
          key: "skip-arsenal",
          label: intl.formatMessage({ id: "game.decision.arsenal.action" }),
          onChoose: onConfirm,
        }]}
      />
      <ChoiceCancel onCancel={onCancel} />
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
