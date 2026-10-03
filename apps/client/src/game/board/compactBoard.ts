const clamp = (minimum: number, preferred: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, preferred));

/** Match the minimum width of the nine-track square arena in game-board.css. */
export function shouldUseCompactBoard(
  usableBoardWidth: number,
  viewportWidth: number,
  viewportHeight: number,
): boolean {
  if (viewportWidth <= 700) return false;

  const squareSize = viewportWidth >= 1600 && viewportHeight >= 900
    ? Math.min(viewportHeight * 0.12, viewportWidth * 0.1005)
    : clamp(84, viewportHeight * 0.12, 165);
  const pileWidth = viewportWidth >= 1101
    ? squareSize
    : clamp(68, viewportHeight * 0.1, 130);
  const columnGap = clamp(10, viewportHeight * 0.0135, 15);
  const firstSpacer = clamp(6, viewportWidth * 0.008, 16);
  const minimumSquareWidth = 5 * squareSize + 2 * pileWidth +
    8 * columnGap + firstSpacer;

  return usableBoardWidth < minimumSquareWidth + 8;
}
