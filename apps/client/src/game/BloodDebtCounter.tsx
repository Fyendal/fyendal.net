import type { CardView } from "@fyendal/shared";
import { cardData } from "@fyendal/cards/client";

const BLOOD_DEBT = "blood debt";

export function countBloodDebtCards(cards: readonly CardView[]): number {
  return cards.reduce((count, card) => {
    // face-down banished cards are inert: Blood Debt never triggers for them
    if (card.faceDown) return count;
    const hasBloodDebt = (cardData[card.cardId]?.keywords ?? []).some(
      (keyword) => keyword.trim().toLowerCase() === BLOOD_DEBT,
    );
    return count + (hasBloodDebt ? 1 : 0);
  }, 0);
}

export function BloodDebtCounter({ cards }: { cards: readonly CardView[] }) {
  const count = countBloodDebtCards(cards);
  if (count === 0) return null;

  const label = `${count} ${count === 1 ? "card has" : "cards have"} Blood Debt in this banished zone`;
  return (
    <span className="blood-debt-counter" role="img" aria-label={label} title={label}>
      <img src="/icons/blood-debt.svg" alt="" aria-hidden="true" />
      <span aria-hidden="true">{count}</span>
    </span>
  );
}
