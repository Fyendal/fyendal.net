import type { GameIntent, TokenSkipKind } from "@fyendal/shared";

/** The token run the authoritative legal intents let this seat skip. */
export function skippableTokenRun(legal: readonly GameIntent[]): TokenSkipKind | null {
  for (const intent of legal) {
    if (intent.kind === "skip-runechant") return "runechant";
    if (intent.kind === "skip-seismic-surge") return "seismic-surge";
  }
  return null;
}
