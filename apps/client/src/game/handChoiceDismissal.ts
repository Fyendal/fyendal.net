export type HandChoiceDismissal = "reset-local" | "undo-pre-stack" | null;

/** Clicking away from a hand-card announcement dismisses it. A local
 * announcement can simply reset; an authoritative pre-stack choice must
 * rewind the play that opened it. */
export function handChoiceDismissal(
  localHandChoice: boolean,
  preStackHandChoice: boolean,
  insideChoiceSurface: boolean,
): HandChoiceDismissal {
  if (insideChoiceSurface) return null;
  if (localHandChoice) return "reset-local";
  if (preStackHandChoice) return "undo-pre-stack";
  return null;
}
