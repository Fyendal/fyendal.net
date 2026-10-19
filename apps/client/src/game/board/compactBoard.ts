const clamp = (minimum: number, preferred: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, preferred));

/** Match the minimum width of the nine-track square arena in game-board.css:
 *  seven arena-square tracks, eight gaps and the first spacer. */
export function shouldUseCompactBoard(
  usableBoardWidth: number,
  viewportWidth: number,
  viewportHeight: number,
): boolean {
  if (viewportWidth <= 700) return false;

  const squareSize = viewportWidth >= 1600 && viewportHeight >= 900
    ? Math.min(viewportHeight * 0.12, viewportWidth * 0.1005)
    : clamp(84, viewportHeight * 0.12, 165);
  const columnGap = clamp(10, viewportHeight * 0.0135, 15);
  const firstSpacer = clamp(6, viewportWidth * 0.008, 16);
  const minimumSquareWidth = 7 * squareSize + 8 * columnGap + firstSpacer;

  return usableBoardWidth < minimumSquareWidth + 8;
}

const COMPACT_HUD_BOARD_WIDTH = 1100;

/** Narrow desktop boards take the compact arena's smaller HUD controls. */
export function shouldUseCompactHud(
  usableBoardWidth: number,
  viewportWidth: number,
  compactBoard: boolean,
): boolean {
  if (viewportWidth <= 700) return false;
  return compactBoard || usableBoardWidth < COMPACT_HUD_BOARD_WIDTH;
}
