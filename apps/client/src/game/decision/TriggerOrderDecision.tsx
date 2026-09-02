import { useEffect, useState } from "react";
import { useIntl } from "react-intl";
import { cardData } from "@fyendal/cards/client";
import type { CardView, GameMessage } from "@fyendal/shared";
import { BloodDebtTriggerTile, isBloodDebtTrigger } from "../BloodDebtTriggerTile.js";
import { CardFace } from "../Card.js";
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

export function moveTriggerOrder<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) {
    return next;
  }
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

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

  return (
    <>
      <span className="decision-context" id="trigger-order-help">
        {intl.formatMessage({ id: "game.decision.triggerOrder.instructions" })}
      </span>
      <div
        className="trigger-order-list"
        role="list"
        aria-label={intl.formatMessage({ id: "game.decision.triggerOrder.label" })}
        aria-describedby="trigger-order-help"
      >
        {items.map((item, index) => {
          const label = localizedLabel(item);
          return <div
            className="trigger-order-item"
            draggable
            key={item.key}
            role="listitem"
            onPointerDown={(event) => event.stopPropagation()}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("application/x-fyendal-trigger", item.key);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => {
              event.preventDefault();
              const draggedKey = event.dataTransfer.getData("application/x-fyendal-trigger");
              const from = items.findIndex((candidate) => candidate.key === draggedKey);
              move(from, index);
            }}
          >
            <span className="trigger-order-grip" aria-hidden="true">⠿</span>
            <span className="trigger-order-position">
              {index + 1}
              <small>{intl.formatMessage({
                id: index === 0
                  ? "game.decision.triggerOrder.first"
                  : index === items.length - 1
                    ? "game.decision.triggerOrder.last"
                    : "game.decision.triggerOrder.then",
              })}</small>
            </span>
            {item.count !== null && item.bloodDebt ? (
              <BloodDebtTriggerTile count={item.count} />
            ) : item.card ? (
              <CardFace
                card={item.card}
                size="zone"
                affiliation={cardAffiliation(item.card, viewerSeat)}
              />
            ) : null}
            <span className="trigger-order-label">
              {item.card ? <strong><CardRef id={item.card.cardId} name={item.card.name} /></strong> : null}
              <span>{item.bloodDebt && item.count !== null
                ? intl.formatMessage({ id: "game.bloodDebt.loseLife" }, { count: item.count })
                : label || intl.formatMessage({ id: "game.triggeredAbility" })}</span>
            </span>
            <span className="trigger-order-controls">
              <button
                aria-label={intl.formatMessage(
                  { id: "game.decision.triggerOrder.moveEarlier" },
                  {
                    source: item.bloodDebt
                      ? intl.formatMessage({ id: "game.bloodDebt" })
                      : item.card
                        ? cardDisplayName(item.card)
                        : intl.formatMessage({ id: "game.trigger" }),
                    label: item.bloodDebt && item.count !== null
                      ? intl.formatMessage({ id: "game.bloodDebt.loseLife" }, { count: item.count })
                      : label || intl.formatMessage({ id: "game.triggeredAbility" }),
                  },
                )}
                disabled={index === 0}
                onClick={() => move(index, index - 1)}
                title={intl.formatMessage({ id: "game.decision.triggerOrder.earlier" })}
                type="button"
              >
                ↑
              </button>
              <button
                aria-label={intl.formatMessage(
                  { id: "game.decision.triggerOrder.moveLater" },
                  {
                    source: item.bloodDebt
                      ? intl.formatMessage({ id: "game.bloodDebt" })
                      : item.card
                        ? cardDisplayName(item.card)
                        : intl.formatMessage({ id: "game.trigger" }),
                    label: item.bloodDebt && item.count !== null
                      ? intl.formatMessage({ id: "game.bloodDebt.loseLife" }, { count: item.count })
                      : label || intl.formatMessage({ id: "game.triggeredAbility" }),
                  },
                )}
                disabled={index === items.length - 1}
                onClick={() => move(index, index + 1)}
                title={intl.formatMessage({ id: "game.decision.triggerOrder.later" })}
                type="button"
              >
                ↓
              </button>
            </span>
          </div>;
        })}
      </div>
      <div className="decision-buttons">
        <button
          className="btn-primary shortcut-button"
          onClick={() => onConfirm(items.map((item) => item.optionId))}
          title={intl.formatMessage(
            { id: "common.shortcut.space" },
            { label: intl.formatMessage({ id: "game.decision.triggerOrder.confirm" }) },
          )}
          aria-keyshortcuts="Space"
          type="button"
        >
          {intl.formatMessage({ id: "game.decision.triggerOrder.confirm" })}
          <kbd className="shortcut-key" aria-label={intl.formatMessage({ id: "common.spaceKey" })} />
        </button>
      </div>
    </>
  );
}
