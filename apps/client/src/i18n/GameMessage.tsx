import type { GameMessage, GameMessageValue } from "@fyendal/shared";
import { Fragment, type ReactNode } from "react";
import { useIntl, type IntlShape } from "react-intl";

interface PlainMessageResolvers {
  card?: (cardId: string) => string;
  player?: (seat: number) => string;
  term?: (id: string) => string;
}

interface RichMessageResolvers {
  card?: (cardId: string) => ReactNode;
  player?: (seat: number) => ReactNode;
  term?: (id: string) => ReactNode;
}

function plainValue(value: GameMessageValue, resolvers: PlainMessageResolvers): string | number | boolean {
  if (typeof value !== "object") return value;
  if (value.kind === "card") return resolvers.card?.(value.cardId) ?? value.cardId;
  if (value.kind === "player") return resolvers.player?.(value.seat) ?? String(value.seat + 1);
  return resolvers.term?.(value.id) ?? value.id;
}

export function formatGameMessage(
  intl: IntlShape,
  message: GameMessage,
  resolvers: PlainMessageResolvers = {},
): string {
  const values = Object.fromEntries(
    Object.entries(message.values ?? {}).map(([key, value]) => [key, plainValue(value, resolvers)]),
  );
  return intl.formatMessage({ id: message.id }, values);
}

export function GameMessageText({
  message,
  resolvers = {},
  breakOnDash = false,
  fallback,
}: {
  message: GameMessage;
  resolvers?: RichMessageResolvers;
  breakOnDash?: boolean;
  fallback?: string;
}) {
  const intl = useIntl();
  const values = Object.fromEntries(
    Object.entries(message.values ?? {}).map(([key, value]) => {
      if (typeof value !== "object") return [key, value];
      if (value.kind === "card") return [key, resolvers.card?.(value.cardId) ?? value.cardId];
      if (value.kind === "player") return [key, resolvers.player?.(value.seat) ?? String(value.seat + 1)];
      return [key, resolvers.term?.(value.id) ?? value.id];
    }),
  );
  const formatted = intl.formatMessage(
    fallback === undefined
      ? { id: message.id }
      : { id: message.id, defaultMessage: fallback },
    values,
  );
  if (!breakOnDash) return <>{formatted}</>;

  const parts = Array.isArray(formatted) ? formatted : [formatted];
  let insertedBreak = false;
  const broken = parts.flatMap((part, index): ReactNode[] => {
    if (insertedBreak || typeof part !== "string") return [part];
    const spacedDash = part.indexOf(" — ");
    const compactDash = part.indexOf("——");
    const separator = spacedDash >= 0 ? spacedDash : compactDash;
    if (separator < 0) return [part];

    insertedBreak = true;
    const separatorLength = spacedDash >= 0 ? 3 : 2;
    const nextLine = part.slice(separator + separatorLength);
    const capitalizedNextLine = nextLine.length > 0
      ? `${nextLine[0]!.toUpperCase()}${nextLine.slice(1)}`
      : nextLine;
    return [
      part.slice(0, separator),
      <br key={`message-break-${index}`} />,
      capitalizedNextLine,
    ];
  });
  return <Fragment>{broken}</Fragment>;
}
