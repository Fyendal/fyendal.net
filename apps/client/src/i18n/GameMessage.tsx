import type { GameMessage, GameMessageValue } from "@fyendal/shared";
import type { ReactNode } from "react";
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
}: {
  message: GameMessage;
  resolvers?: RichMessageResolvers;
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
  return <>{intl.formatMessage({ id: message.id }, values)}</>;
}
