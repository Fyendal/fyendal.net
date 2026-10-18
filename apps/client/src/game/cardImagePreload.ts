import { useEffect, useRef, useState } from "react";
import { cardData } from "@fyendal/cards/client";
import { resolveCardImageUrls } from "./cardImageUrl.js";

const PRELOAD_CONCURRENCY = 8;
const URL_TIMEOUT_MS = 15_000;

/** Settled outcome per card id; a card resolves once any of its fallback
 * objects loads, so later renders hit the browser cache. */
const cardResults = new Map<string, Promise<boolean>>();
const loadedCards = new Set<string>();

function loadUrl(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image();
    const timer = window.setTimeout(() => finish(false), URL_TIMEOUT_MS);
    function finish(ok: boolean) {
      window.clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      resolve(ok);
    }
    image.decoding = "async";
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.src = url;
  });
}

/** Walk the same fallback chain `CardArtwork` uses until one object loads. */
export function preloadCardImage(cardId: string): Promise<boolean> {
  const existing = cardResults.get(cardId);
  if (existing) return existing;
  const result = (async () => {
    for (const url of resolveCardImageUrls(cardId, cardData[cardId])) {
      if (await loadUrl(url)) {
        loadedCards.add(cardId);
        return true;
      }
    }
    // Let a later screen retry a card that failed or timed out.
    cardResults.delete(cardId);
    return false;
  })();
  cardResults.set(cardId, result);
  return result;
}

export function canPreloadCardImages(): boolean {
  return typeof Image !== "undefined" && typeof window !== "undefined";
}

function uniqueCardIds(cardIds: readonly string[]): string[] {
  return [...new Set(cardIds.filter((id) => id !== ""))];
}

/** Preload in list order with bounded concurrency. Progress counts settled
 * cards, including failures, so callers can always reach completion. */
export async function preloadCardImages(
  cardIds: readonly string[],
  onProgress?: (settled: number, total: number) => void,
): Promise<void> {
  const ids = uniqueCardIds(cardIds);
  let next = 0;
  let settled = 0;
  onProgress?.(0, ids.length);
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++]!;
      await preloadCardImage(id);
      settled += 1;
      onProgress?.(settled, ids.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PRELOAD_CONCURRENCY, ids.length) }, worker));
}

export interface CardImagePreload {
  done: boolean;
  settled: number;
  total: number;
}

function initialPreload(key: string | null, cardIds: readonly string[]): CardImagePreload {
  const ids = uniqueCardIds(cardIds);
  const cached = ids.filter((id) => loadedCards.has(id)).length;
  const done = key === null || !canPreloadCardImages() || cached === ids.length;
  return { done, settled: done ? ids.length : cached, total: ids.length };
}

/**
 * Preload `cardIds` once per `key`. A screen may gate on `done`, which also
 * becomes true after `timeoutMs` so a slow CDN never blocks play. The id list
 * is captured when the key changes; later edits under the same key are ignored.
 */
export function useCardImagePreload(
  key: string | null,
  cardIds: readonly string[],
  timeoutMs: number,
): CardImagePreload {
  const idsRef = useRef(cardIds);
  idsRef.current = cardIds;
  const [state, setState] = useState<{ key: string | null } & CardImagePreload>(
    () => ({ key, ...initialPreload(key, cardIds) }),
  );

  useEffect(() => {
    const initial = initialPreload(key, idsRef.current);
    setState({ key, ...initial });
    if (initial.done) return;
    let active = true;
    const timer = window.setTimeout(() => {
      if (active) setState((current) => current.key === key ? { ...current, done: true } : current);
    }, timeoutMs);
    void preloadCardImages(idsRef.current, (settled, total) => {
      if (!active) return;
      setState((current) => current.key === key
        ? { key, settled, total, done: current.done || settled === total }
        : current);
    });
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [key, timeoutMs]);

  if (state.key !== key) return initialPreload(key, cardIds);
  return { done: state.done, settled: state.settled, total: state.total };
}
