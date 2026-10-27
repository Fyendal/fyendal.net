import { useEffect, useState } from "react";
import type { DeckArt } from "@fyendal/shared";

export type CardArtCatalog = typeof import("@fyendal/cards/art");

let loaded: CardArtCatalog | null = null;
let pending: Promise<CardArtCatalog> | null = null;

/** The art catalog is its own chunk; only pickers and decks with art load it. */
export function loadCardArtCatalog(): Promise<CardArtCatalog> {
  pending ??= import("@fyendal/cards/art").then((module) => {
    loaded = module;
    return module;
  }, (error: unknown) => {
    pending = null;
    throw error;
  });
  return pending;
}

export function useCardArtCatalog(enabled = true): CardArtCatalog | null {
  const [catalog, setCatalog] = useState<CardArtCatalog | null>(loaded);
  useEffect(() => {
    if (!enabled || catalog) return;
    let active = true;
    void loadCardArtCatalog().then((module) => { if (active) setCatalog(module); }, () => undefined);
    return () => { active = false; };
  }, [enabled, catalog]);
  return enabled ? catalog : null;
}

export function deckArtIsCustom(art: DeckArt | undefined): boolean {
  return !!art && (art.highestRarity || Object.keys(art.picks).length > 0);
}
