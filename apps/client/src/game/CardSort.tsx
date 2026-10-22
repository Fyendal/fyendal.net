import { cardData } from "@fyendal/cards/client";
import { useIntl } from "react-intl";

/** "zone" keeps the source's own order, such as a pile's or a decklist's. */
export type CardSortOrder = "zone" | "pitch" | "name";

export interface SortableCard {
  cardId: string;
  name?: string;
}

const CARD_NAME_COLLATOR = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

const OPTION_MESSAGES: Record<CardSortOrder, string> = {
  zone: "game.zone.sort.zoneOrder",
  pitch: "game.zone.sort.pitch",
  name: "game.zone.sort.cardName",
};

function cardName(card: SortableCard): string {
  return cardData[card.cardId]?.name ?? card.name ?? card.cardId;
}

function cardPitchOrder(card: SortableCard): number {
  const pitch = cardData[card.cardId]?.pitch;
  return pitch === 1 || pitch === 2 || pitch === 3 ? pitch : 4;
}

/** Groups printings of the same named card together in either order. */
export function sortCards<T>(
  items: readonly T[],
  sortOrder: CardSortOrder,
  cardOf: (item: T) => SortableCard,
): readonly T[] {
  if (sortOrder === "zone") return items;
  return [...items].sort((leftItem, rightItem) => {
    const left = cardOf(leftItem);
    const right = cardOf(rightItem);
    const nameOrder = CARD_NAME_COLLATOR.compare(cardName(left), cardName(right));
    const pitchOrder = cardPitchOrder(left) - cardPitchOrder(right);
    return sortOrder === "pitch"
      ? pitchOrder || nameOrder
      : nameOrder || pitchOrder;
  });
}

export function CardSortToggle<Order extends CardSortOrder>({
  options,
  value,
  onChange,
}: {
  options: readonly Order[];
  value: Order;
  onChange: (order: Order) => void;
}) {
  const intl = useIntl();
  return (
    <div
      className="card-sort"
      role="group"
      aria-label={intl.formatMessage({ id: "game.zone.sort.label" })}
    >
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
        >
          {option === "pitch" ? (
            <span className="card-sort-pips" aria-hidden="true">
              <i /><i /><i />
            </span>
          ) : null}
          {intl.formatMessage({ id: OPTION_MESSAGES[option] })}
        </button>
      ))}
    </div>
  );
}
