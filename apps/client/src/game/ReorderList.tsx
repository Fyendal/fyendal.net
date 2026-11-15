import { useState, type ReactNode } from "react";
import { TooltipButton } from "../components/TooltipButton.js";
import { UiIcon, type UiIconName } from "../components/UiIcon.js";

export function moveOrderItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) {
    return next;
  }
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/** Drag-to-reorder items, with an optional grip; each item renders its own content and controls. */
export function ReorderList<T>({
  items,
  itemKey,
  dragType,
  className,
  itemClassName,
  label,
  describedBy,
  onMove,
  renderItem,
  grip = true,
}: {
  items: readonly T[];
  itemKey: (item: T) => string;
  /** Private drag payload type, so drops from other lists are ignored. */
  dragType: string;
  className: string;
  itemClassName: string;
  label: string;
  describedBy?: string;
  onMove: (from: number, to: number) => void;
  renderItem: (item: T, index: number) => ReactNode;
  grip?: boolean;
}) {
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const endDrag = () => {
    setDraggingKey(null);
    setDropIndex(null);
  };
  const draggingIndex = draggingKey === null ? -1 : items.findIndex((item) => itemKey(item) === draggingKey);
  return (
    <ol className={className} aria-label={label} aria-describedby={describedBy}>
      {items.map((item, index) => {
        const key = itemKey(item);
        const dropping = dropIndex === index && draggingKey !== null && draggingKey !== key;
        // A dragged item lands after a later target and before an earlier one.
        const side = dropping ? (draggingIndex < index ? " is-drop-after" : " is-drop-before") : "";
        return <li
          className={`${itemClassName}${draggingKey === key ? " is-dragging" : ""}${dropping ? ` is-drop-target${side}` : ""}`}
          draggable
          key={key}
          onPointerDown={(event) => event.stopPropagation()}
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData(dragType, key);
            setDraggingKey(key);
          }}
          onDragEnd={endDrag}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            if (dropIndex !== index) setDropIndex(index);
          }}
          onDrop={(event) => {
            event.preventDefault();
            const draggedKey = event.dataTransfer.getData(dragType);
            const from = items.findIndex((candidate) => itemKey(candidate) === draggedKey);
            onMove(from, index);
            endDrag();
          }}
        >
          {grip ? <UiIcon name="grip" className="trigger-order-grip" /> : null}
          {renderItem(item, index)}
        </li>;
      })}
    </ol>
  );
}

export interface ReorderMove {
  to: number;
  icon: UiIconName;
  tooltip: string;
  label: string;
  disabled: boolean;
  tooltipSide?: "above" | "below";
}

/** Icon buttons that each move one row to a fixed index. */
export function ReorderMoveControls({
  index,
  moves,
  onMove,
}: {
  index: number;
  moves: readonly ReorderMove[];
  onMove: (from: number, to: number) => void;
}) {
  return (
    <span className="trigger-order-controls trigger-order-move">
      {moves.map((move) => (
        <TooltipButton
          key={move.icon}
          tooltip={move.tooltip}
          tooltipSide={move.tooltipSide}
          aria-label={move.label}
          disabled={move.disabled}
          onClick={() => onMove(index, move.to)}
        >
          <UiIcon name={move.icon} />
        </TooltipButton>
      ))}
    </span>
  );
}
