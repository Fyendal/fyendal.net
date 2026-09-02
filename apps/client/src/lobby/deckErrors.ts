/** Convert every deck-validation failure shape into UI-ready messages. */
export function deckErrorMessages(
  result: {
    errors?: string[];
    missing?: string[];
    unimplemented?: string[];
    error?: string;
  },
  fallback: string,
  labels: {
    unknownCards: (cards: string) => string;
    unimplementedCards: (cards: string) => string;
  } = {
    unknownCards: (cards) => `unknown cards: ${cards}`,
    unimplementedCards: (cards) => `not implemented yet: ${cards}`,
  },
): string[] {
  const messages = [...(result.errors ?? [])];
  if (result.missing?.length) messages.push(labels.unknownCards(result.missing.join(", ")));
  if (result.unimplemented?.length) {
    messages.push(labels.unimplementedCards(result.unimplemented.join(", ")));
  }
  if (messages.length === 0) messages.push(result.error || fallback);
  return messages;
}
