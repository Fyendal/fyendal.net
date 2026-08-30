import type { GameIntent } from "@fyendal/shared";

export function canSkipRunechant(legal: readonly GameIntent[]): boolean {
  return legal.some((intent) => intent.kind === "skip-runechant");
}
