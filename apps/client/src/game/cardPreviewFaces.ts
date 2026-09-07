import { cardData } from "@fyendal/cards/client";

export const CARD_PREVIEW_FACE_GAP = 12;

const frontByBackId = new Map<string, string>();
for (const card of Object.values(cardData)) {
  if (!card.backId || !cardData[card.backId]) continue;
  const current = frontByBackId.get(card.backId);
  const isMatchingCollectorNumber = `${card.id}B` === card.backId;
  if (!current || isMatchingCollectorNumber) frontByBackId.set(card.backId, card.id);
}

/** Return a physical card's faces front-first, regardless of which face is active. */
export function cardPreviewFaceIds(cardId: string): readonly string[] {
  const card = cardData[cardId];
  if (!card) return [];
  if (card.backId && cardData[card.backId]) return [cardId, card.backId];
  const frontId = frontByBackId.get(cardId);
  return frontId ? [frontId, cardId] : [cardId];
}

export function cardPreviewSurfaceSize(
  cardId: string,
  faceSize: { width: number; height: number },
): { width: number; height: number } {
  const faceCount = Math.max(1, cardPreviewFaceIds(cardId).length);
  return {
    width: faceSize.width * faceCount + CARD_PREVIEW_FACE_GAP * (faceCount - 1),
    height: faceSize.height,
  };
}
