export function hoverPreviewTarget(target: HTMLElement): HTMLElement | null {
  const boundLayer = target.closest<HTMLElement>("[data-bound-preview-card]");
  const boundCard = boundLayer?.querySelector<HTMLElement>("[data-cardid]");

  return boundCard ?? target.closest<HTMLElement>("[data-cardid], [data-effect-label]");
}
