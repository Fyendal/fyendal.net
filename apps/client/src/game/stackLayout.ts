const MAX_VISIBLE_STACK_OFFSET = 48;
const MAX_CARD_STEP = 12;

/** Keep card piles compact while leaving every card edge visible. */
export function cardStackStep(cardCount: number): number {
  return Math.min(
    MAX_CARD_STEP,
    MAX_VISIBLE_STACK_OFFSET / Math.max(1, cardCount - 1),
  );
}

/** Match the square card's title height with 3px of clearance between bars. */
export function squareCardStackOffset(
  depth: number,
  cardWidth: "--arena-square-size" | "--mat-zone-col",
): string {
  return `calc(-${depth} * clamp(16px, calc(var(${cardWidth}) * .12 + 3px), 23px))`;
}
