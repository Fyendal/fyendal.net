/** Convert every deck-validation failure shape into UI-ready messages. */
export function deckErrorMessages(
  result: {
    errors?: string[];
    missing?: string[];
    unimplemented?: string[];
    error?: string;
  },
  fallback: string,
): string[] {
  const messages = [...(result.errors ?? [])];
  if (result.missing?.length) messages.push(`unknown cards: ${result.missing.join(", ")}`);
  if (result.unimplemented?.length) {
    messages.push(`not implemented yet: ${result.unimplemented.join(", ")}`);
  }
  if (messages.length === 0) messages.push(result.error || fallback);
  return messages;
}
