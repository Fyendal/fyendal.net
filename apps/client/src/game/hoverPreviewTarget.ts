export function hoverPreviewTarget(target: HTMLElement): HTMLElement | null {
  const boundLayer = target.closest<HTMLElement>("[data-bound-preview-card]");
  const boundCard = boundLayer?.querySelector<HTMLElement>("[data-cardid]");

  // The chip's nested CardFace has its own card id. Keep the effect wrapper
  // as the hover target so its chosen mode and duration reach the tooltip.
  return boundCard ?? target.closest<HTMLElement>("[data-effect-label]") ??
    target.closest<HTMLElement>("[data-cardid]");
}
