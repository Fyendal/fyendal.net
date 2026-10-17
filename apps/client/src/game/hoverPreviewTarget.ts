export function hoverPreviewTarget(target: HTMLElement): HTMLElement | null {
  const boundLayer = target.closest<HTMLElement>("[data-bound-preview-card]");
  const boundCard = boundLayer?.querySelector<HTMLElement>("[data-cardid]");

  // An effect chip is a hover target even without a source card, so its text
  // and duration always reach the hint panel.
  return boundCard ?? target.closest<HTMLElement>("[data-effect-summary]") ??
    target.closest<HTMLElement>("[data-cardid]");
}
