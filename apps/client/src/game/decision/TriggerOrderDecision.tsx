import { useEffect, useState } from "react";
import type { CardView } from "@fyendal/shared";
import { BloodDebtTriggerTile, isBloodDebtTrigger } from "../BloodDebtTriggerTile.js";
import { CardFace } from "../Card.js";
import { shouldPassOnSpace } from "../passHotkey.js";
import { CardRef, cardAffiliation, cardDisplayName } from "./DecisionShared.js";

interface TriggerOrderItem {
  key: string;
  optionId: string;
  sourceName: string;
  label: string;
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
  counts,
  cards,
  viewerSeat,
  onConfirm,
}: {
  options: string[];
  labels: string[];
  counts: Array<number | null>;
  cards: Array<CardView | null>;
  viewerSeat: number;
  onConfirm: (optionIds: string[]) => void;
}) {
  const [items, setItems] = useState<TriggerOrderItem[]>(() =>
    options.map((optionId, index) => {
      const label = labels[index] ?? "Triggered ability";
      const count = counts[index] ?? null;
      const bloodDebt = count !== null && isBloodDebtTrigger(label);
      return {
        key: `${optionId}:${index}`,
        optionId,
        sourceName: bloodDebt
          ? "Blood Debt"
          : cards[index]
            ? cardDisplayName(cards[index]!)
            : "Trigger",
        label: bloodDebt ? `Lose ${count} life` : label,
        card: bloodDebt ? null : (cards[index] ?? null),
        count,
        bloodDebt,
      };
    }),
  );
  const move = (from: number, to: number) =>
    setItems((current) => moveTriggerOrder(current, from, to));
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
        Drag triggers into resolution order. The first trigger resolves first.
      </span>
      <div
        className="trigger-order-list"
        role="list"
        aria-label="Trigger resolution order"
        aria-describedby="trigger-order-help"
      >
        {items.map((item, index) => (
          <div
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
              <small>{index === 0 ? "resolves first" : index === items.length - 1 ? "resolves last" : "then"}</small>
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
              <span>{item.label}</span>
            </span>
            <span className="trigger-order-controls">
              <button
                aria-label={`Move ${item.sourceName}: ${item.label} earlier`}
                disabled={index === 0}
                onClick={() => move(index, index - 1)}
                title="Move earlier"
                type="button"
              >
                ↑
              </button>
              <button
                aria-label={`Move ${item.sourceName}: ${item.label} later`}
                disabled={index === items.length - 1}
                onClick={() => move(index, index + 1)}
                title="Move later"
                type="button"
              >
                ↓
              </button>
            </span>
          </div>
        ))}
      </div>
      <div className="decision-buttons">
        <button
          className="btn-primary shortcut-button"
          onClick={() => onConfirm(items.map((item) => item.optionId))}
          title="Confirm Order (Space)"
          aria-keyshortcuts="Space"
          type="button"
        >
          Confirm Order
          <kbd className="shortcut-key" aria-label="Space key" />
        </button>
      </div>
    </>
  );
}
