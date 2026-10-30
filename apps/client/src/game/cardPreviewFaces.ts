import { cardData } from "@fyendal/cards/client";

export const CARD_PREVIEW_FACE_GAP = 12;

const frontByBackId = new Map<string, string>();
for (const card of Object.values(cardData)) {
  if (!card.backId || !cardData[card.backId]) continue;
  const current = frontByBackId.get(card.backId);
  const isMatchingCollectorNumber = `${card.id}B` === card.backId;
  if (!current || isMatchingCollectorNumber) frontByBackId.set(card.backId, card.id);
}

/** Return the front face of a back-face card id, if it has one. */
export function cardFrontFaceId(cardId: string): string | undefined {
  return frontByBackId.get(cardId);
}

/** Return a physical card's faces front-first, regardless of which face is active. */
export function cardPreviewFaceIds(cardId: string): readonly string[] {
  const card = cardData[cardId];
  if (!card) return [];
  if (card.backId && cardData[card.backId]) return [cardId, card.backId];
  const frontId = frontByBackId.get(cardId);
  return frontId ? [frontId, cardId] : [cardId];
}

/** Meld cards print both halves sideways, so previews turn them to read. */
export function isSidewaysCard(cardId: string): boolean {
  return cardData[cardId]?.keywords?.some((keyword) => keyword.trim().toLowerCase() === "meld") === true;
}

/** The on-screen box of one preview face, landscape for sideways cards. */
export function cardPreviewFaceBox(
  cardId: string,
  faceSize: { width: number; height: number },
): { width: number; height: number } {
  return isSidewaysCard(cardId)
    ? { width: faceSize.height, height: faceSize.width }
    : faceSize;
}

export function cardPreviewSurfaceSize(
  cardId: string,
  faceSize: { width: number; height: number },
): { width: number; height: number } {
  const boxes = cardPreviewFaceIds(cardId).map((id) => cardPreviewFaceBox(id, faceSize));
  if (boxes.length === 0) return faceSize;
  return {
    width: boxes.reduce((sum, box) => sum + box.width, 0) + CARD_PREVIEW_FACE_GAP * (boxes.length - 1),
    height: Math.max(...boxes.map((box) => box.height)),
  };
}
