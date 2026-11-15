import { useEffect, useState } from "react";
import { useIntl } from "react-intl";
import { cardData } from "@fyendal/cards/client";
import type { CardView, GameMessage } from "@fyendal/shared";
import { BloodDebtTriggerTile, isBloodDebtTrigger } from "../BloodDebtTriggerTile.js";
import { CardFace } from "../Card.js";
import { TooltipButton } from "../../components/TooltipButton.js";
import { moveOrderItem, ReorderList, ReorderMoveControls } from "../ReorderList.js";
import { shouldPassOnSpace } from "../passHotkey.js";
import { CardRef, cardAffiliation, cardDisplayName } from "./DecisionShared.js";
import { formatGameMessage } from "../../i18n/GameMessage.js";

interface TriggerOrderItem {
  key: string;
  optionId: string;
  label: string;
  message: GameMessage | null;
  card: CardView | null;
  count: number | null;
  bloodDebt: boolean;
}

export const moveTriggerOrder = moveOrderItem;

export function confirmTriggerOrderOnSpace(
  event: Parameters<typeof shouldPassOnSpace>[0] & Pick<KeyboardEvent, "preventDefault">,
  optionIds: readonly string[],
  onConfirm: (optionIds: string[]) => void,
): boolean {
  if (!shouldPassOnSpace(event)) return false;
  event.preventDefault();
  onConfirm([...optionIds]);
  return true;
}

export function TriggerOrderDecision({
  options,
  labels,
  messages = [],
  counts,
  cards,
  viewerSeat,
  onConfirm,
}: {
  options: string[];
  labels: string[];
  messages?: Array<GameMessage | null>;
  counts: Array<number | null>;
  cards: Array<CardView | null>;
  viewerSeat: number;
  onConfirm: (optionIds: string[]) => void;
}) {
  const intl = useIntl();
  const [items, setItems] = useState<TriggerOrderItem[]>(() =>
    options.map((optionId, index) => {
      const label = labels[index] ?? "";
      const count = counts[index] ?? null;
      const bloodDebt = count !== null && isBloodDebtTrigger(label);
      return {
        key: `${optionId}:${index}`,
        optionId,
        label,
        message: messages[index] ?? null,
        card: bloodDebt ? null : (cards[index] ?? null),
        count,
        bloodDebt,
      };
    }),
  );
  const move = (from: number, to: number) =>
    setItems((current) => moveTriggerOrder(current, from, to));
  const localizedLabel = (item: TriggerOrderItem) => item.message
    ? formatGameMessage(intl, item.message, {
        card: (cardId) => item.card?.cardId === cardId
          ? (item.card.name ?? cardId)
          : (cardData[cardId]?.name ?? cardId),
      })
    : item.label;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      confirmTriggerOrderOnSpace(event, items.map((item) => item.optionId), onConfirm);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [items, onConfirm]);

  const confirmLabel = intl.formatMessage({ id: "game.decision.triggerOrder.confirm" });

  return (
    <>
      <span className="decision-context" id="trigger-order-help">
        {intl.formatMessage({ id: "game.decision.triggerOrder.instructions" })}
      </span>
      <ReorderList
        items={items}
        itemKey={(item) => item.key}
        dragType="application/x-fyendal-trigger"
        className="trigger-order-list"
        itemClassName="trigger-order-item"
        label={intl.formatMessage({ id: "game.decision.triggerOrder.label" })}
        describedBy="trigger-order-help"
        onMove={move}
        renderItem={(item, index) => {
          const label = localizedLabel(item);
          const effect = item.bloodDebt && item.count !== null
            ? intl.formatMessage({ id: "game.bloodDebt.loseLife" }, { count: item.count })
            : label || intl.formatMessage({ id: "game.triggeredAbility" });
          const source = item.bloodDebt
            ? intl.formatMessage({ id: "game.bloodDebt" })
            : item.card
              ? cardDisplayName(item.card)
              : intl.formatMessage({ id: "game.trigger" });
          const edge = index === 0
            ? "game.decision.triggerOrder.first"
            : index === items.length - 1
              ? "game.decision.triggerOrder.last"
              : null;
          return <>
            {item.count !== null && item.bloodDebt ? (
              <BloodDebtTriggerTile count={item.count} />
            ) : item.card ? (
              <CardFace
                card={item.card}
                size="zone"
                squareArt={false}
                affiliation={cardAffiliation(item.card, viewerSeat)}
              />
            ) : <span className="trigger-order-thumb-empty" aria-hidden="true" />}
            <span className="trigger-order-label">
              <span className="trigger-order-source">
                {item.card ? <CardRef id={item.card.cardId} name={item.card.name} /> : null}
                {edge ? <span className="trigger-order-edge">{intl.formatMessage({ id: edge })}</span> : null}
              </span>
              <span className="trigger-order-effect">{effect}</span>
            </span>
            <ReorderMoveControls
              index={index}
              onMove={move}
              moves={[
                {
                  to: index - 1,
                  icon: "chevron-up",
                  tooltip: intl.formatMessage({ id: "game.decision.triggerOrder.earlier" }),
                  tooltipSide: "above",
                  label: intl.formatMessage(
                    { id: "game.decision.triggerOrder.moveEarlier" },
                    { source, label: effect },
                  ),
                  disabled: index === 0,
                },
                {
                  to: index + 1,
                  icon: "chevron-down",
                  tooltip: intl.formatMessage({ id: "game.decision.triggerOrder.later" }),
                  label: intl.formatMessage(
                    { id: "game.decision.triggerOrder.moveLater" },
                    { source, label: effect },
                  ),
                  disabled: index === items.length - 1,
                },
              ]}
            />
          </>;
        }}
      />
      <div className="decision-buttons">
        <TooltipButton
          className="btn-primary shortcut-button"
          onClick={() => onConfirm(items.map((item) => item.optionId))}
          tooltip={intl.formatMessage({ id: "common.shortcut.space" }, { label: confirmLabel })}
          tooltipSide="above"
          aria-label={confirmLabel}
          aria-keyshortcuts="Space"
        >
          {confirmLabel}
          <kbd className="shortcut-key" aria-label={intl.formatMessage({ id: "common.spaceKey" })} />
        </TooltipButton>
      </div>
    </>
  );
}
