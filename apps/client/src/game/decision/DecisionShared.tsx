import { cardData } from "@fyendal/cards/client";
import type { CardView } from "@fyendal/shared";
import type { ReactNode } from "react";

/** Inline card name that triggers the hover preview (via data-cardid delegation). */
export function CardRef({ id, name }: { id: string; name?: string }) {
  return (
    <span className="card-ref" data-cardid={id}>
      {cardData[id]?.name ?? name ?? id}
    </span>
  );
}

export function cardDisplayName(card: Pick<CardView, "cardId" | "name">): string {
  return cardData[card.cardId]?.name ?? card.name ?? card.cardId;
}

const firstPrintingByName = new Map<string, string>();
for (const [id, data] of Object.entries(cardData)) {
  if (!firstPrintingByName.has(data.name)) firstPrintingByName.set(data.name, id);
}

/** Turn a leading card name in a scripted prompt into an inspectable card reference. */
export function DecisionPrompt({
  prompt,
  suffix,
  breakOnDash = false,
}: {
  prompt: string;
  suffix?: ReactNode;
  breakOnDash?: boolean;
}) {
  const separator = prompt.indexOf(":");
  const name = separator === -1 ? prompt : prompt.slice(0, separator);
  const cardId = separator === -1 ? undefined : firstPrintingByName.get(name);
  const warning = prompt === "Warning: this damage cannot be prevented.";
  const promptText = cardId ? prompt.slice(separator) : prompt;
  const dashSeparator = breakOnDash ? promptText.indexOf(" — ") : -1;
  const nextLine = dashSeparator === -1 ? "" : promptText.slice(dashSeparator + 3);
  const capitalizedNextLine = nextLine.length > 0
    ? `${nextLine[0]!.toUpperCase()}${nextLine.slice(1)}`
    : nextLine;
  const formattedPrompt = dashSeparator === -1
    ? promptText
    : <>{promptText.slice(0, dashSeparator)}<br />{capitalizedNextLine}</>;

  return (
    <span className={`decision-prompt${warning ? " decision-prompt-warning" : ""}`}>
      {cardId ? <CardRef id={cardId} /> : null}
      {formattedPrompt}
      {suffix}
    </span>
  );
}

/** Announcement choices release focus so Space remains the shared Confirm shortcut. */
export function chooseWithoutFocus(
  button: Pick<HTMLButtonElement, "blur">,
  choose: () => void,
): void {
  choose();
  button.blur();
}

/** Describe a card's normal play mode when it also exposes an activated ability. */
export function handCardPlayLabel(cardId: string | undefined): string {
  switch (cardId ? cardData[cardId]?.cardType : undefined) {
    case "action":
      return "Play as action";
    case "attack-reaction":
      return "Play as attack reaction";
    case "defense-reaction":
      return "Play as defense reaction";
    case "instant":
      return "Play as instant";
    default:
      return "Play card";
  }
}

export function cardAffiliation(
  card: CardView,
  viewerSeat: number,
): "friendly" | "opponent" {
  return card.owner === viewerSeat ? "friendly" : "opponent";
}
