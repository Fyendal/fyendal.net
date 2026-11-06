import { useIntl, type IntlShape } from "react-intl";
import type { LethalPassRisk } from "../lethalPass.js";
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

function EquipFailWarning({ cardId, blockerId }: { cardId: string | undefined; blockerId: string | null }) {
  const intl = useIntl();
  const card = cardId ? <CardRef id={cardId} /> : intl.formatMessage({ id: "game.card" });
  return (
    <span className="decision-context decision-warning">
      {blockerId === null
        ? intl.formatMessage({ id: "game.decision.equipFails.noBase.warning" }, { card })
        : intl.formatMessage(
            { id: "game.decision.equipFails.warning" },
            { card, equipped: <CardRef id={blockerId} /> },
          )}
    </span>
  );
}

export function ChainCloseConfirmation({
  cardId,
  equipBlockedBy,
  onConfirm,
  onCancel,
}: {
  cardId: string | undefined;
  equipBlockedBy?: string | null;
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
      {equipBlockedBy !== undefined ? <EquipFailWarning cardId={cardId} blockerId={equipBlockedBy} /> : null}
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
  equipBlockedBy,
  onConfirm,
  onCancel,
}: {
  cardId: string | undefined;
  activation: boolean;
  equipBlockedBy?: string | null;
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
      {equipBlockedBy !== undefined ? <EquipFailWarning cardId={cardId} blockerId={equipBlockedBy} /> : null}
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

export function EndTurnConfirmation({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const intl = useIntl();
  return (
    <>
      <span className="decision-prompt">{intl.formatMessage({ id: "game.decision.endTurn.prompt" })}</span>
      <ChoiceList
        options={[{
          key: "end-turn",
          label: intl.formatMessage({ id: "game.decision.endTurn.action" }),
          onChoose: onConfirm,
        }]}
      />
      <ChoiceCancel onCancel={onCancel} />
    </>
  );
}

export function LethalPassConfirmation({
  risk,
  action,
  onConfirm,
  onCancel,
}: {
  risk: LethalPassRisk;
  action: "pass" | "confirm-blocks" | "confirm-no-blocks";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const intl = useIntl();
  return (
    <>
      <span className="decision-prompt" role="alert">
        {intl.formatMessage({ id: "game.decision.lethal.prompt" })}
      </span>
      <div className="lethal-tally">
        <span className="lethal-tally-side lethal-tally-damage">
          <strong>{risk.damage}</strong>
          <span>{intl.formatMessage({ id: "game.decision.lethal.damage" })}</span>
        </span>
        <span className="lethal-tally-side">
          <img className="ico ico-lg" src="/icons/life.png" alt="" />
          <strong>{risk.life}</strong>
          <span>{intl.formatMessage({ id: "game.decision.lethal.life" })}</span>
        </span>
      </div>
      <span className="decision-context">
        {intl.formatMessage({ id: `game.decision.lethal.context.${risk.window}` })}
      </span>
      <ChoiceList
        options={[{
          key: "lethal-commit",
          label: intl.formatMessage({ id: `game.decision.lethal.action.${action}` }),
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
