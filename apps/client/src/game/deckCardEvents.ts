import type { CardView, GameView, PlayerView } from "@fyendal/shared";
import { cardData } from "@fyendal/cards/client";

export type DeckCardEventKind = "banish" | "graveyard" | "reveal" | "shuffle" | "roll";

export interface DeckCardEvent {
  kind: DeckCardEventKind;
  cardIds: string[];
  label: string;
  sourceZone?: "deck" | "graveyard" | "hand";
  seat?: number;
  /** Per-card owner seats aligned with `cardIds`; used when one event mixes
   * owners (a clash reveals both heroes' cards in a single toast). */
  cardSeats?: (number | undefined)[];
}

const CARD_ID_BY_NAME = (() => {
  const byName = new Map<string, string>();
  for (const card of Object.values(cardData)) {
    const name = card.name.trim().toLowerCase();
    if (!byName.has(name)) byName.set(name, card.id);
  }
  return [...byName]
    .map(([name, cardId]) => ({ name, cardId }))
    .sort((a, b) => b.name.length - a.name.length);
})();

const CARD_PRINTING_TAG = /⟦([A-Z0-9]+)⟧/g;

function withoutCardPrintingTags(line: string): string {
  return line.replace(CARD_PRINTING_TAG, "");
}

function isWordCharacter(value: string | undefined): boolean {
  return value !== undefined && /[\p{L}\p{N}]/u.test(value);
}

function publicNonDeckIds(view: GameView): Set<number> {
  const ids = new Set<number>();
  const add = (cards: readonly (CardView | null | undefined)[] | undefined) => {
    for (const card of cards ?? []) if (card && card.instanceId >= 0) ids.add(card.instanceId);
  };
  for (const player of view.players) {
    add(player.hand);
    add(player.arsenal);
    add(player.pitch);
    add(player.graveyard);
    add(player.banish);
    add(player.soul);
    add(player.board);
    add(player.weapons);
    add(Object.values(player.equipment));
  }
  for (const link of view.chain) {
    add([link.attackingCard]);
    add(link.defendingCards);
    add(link.reactions);
  }
  for (const layer of view.stack) {
    if (layer.card) add([layer.card]);
  }
  return ids;
}

function newZoneCards(
  previous: PlayerView,
  current: PlayerView,
  zone: "graveyard" | "banish",
  previouslyPublic: ReadonlySet<number>,
): CardView[] {
  const previousZoneIds = new Set(previous[zone].map((card) => card.instanceId));
  return current[zone].filter((card) =>
    card.instanceId >= 0 &&
    card.cardId !== "" &&
    !previousZoneIds.has(card.instanceId) &&
    !previouslyPublic.has(card.instanceId)
  );
}

function cardNamesMovedFromDeck(
  lines: readonly string[],
  zone: "graveyard" | "banish",
): Set<string> {
  const names = new Set<string>();
  const pattern = zone === "banish"
    ? /^(.+?) is banished from (?:the )?deck$/i
    : /^(.+?) is put into the graveyard from (?:the )?deck$/i;
  for (const line of lines) {
    const match = pattern.exec(withoutCardPrintingTags(line));
    if (match?.[1]) names.add(match[1].trim().toLowerCase());
  }
  return names;
}

function cardNamesBanishedFromGraveyard(lines: readonly string[]): Set<string> {
  const names = new Set<string>();
  for (const line of lines) {
    const match = /^(.+?) is banished from graveyard$/i.exec(withoutCardPrintingTags(line));
    if (match?.[1]) names.add(match[1].trim().toLowerCase());
  }
  return names;
}

function appendedLogLines(previous: readonly string[], current: readonly string[]): string[] {
  if (current.length >= previous.length && previous.every((line, index) => current[index] === line)) {
    return current.slice(previous.length);
  }
  // Undo commonly restores an earlier log prefix. It must not replay old card
  // announcements while the board rolls backward.
  if (current.length < previous.length && current.every((line, index) => previous[index] === line)) {
    return [];
  }
  const maxOverlap = Math.min(previous.length, current.length);
  for (let overlap = maxOverlap; overlap > 0; overlap--) {
    const previousStart = previous.length - overlap;
    let matches = true;
    for (let index = 0; index < overlap; index++) {
      if (previous[previousStart + index] !== current[index]) {
        matches = false;
        break;
      }
    }
    if (matches) return current.slice(overlap);
  }
  // No shared boundary means reconnect/resync rather than a trustworthy new
  // suffix. Do not animate historical public information.
  return [];
}

export function revealedCardIdsFromLogs(lines: readonly string[]): string[] {
  const found = new Set<string>();
  for (const line of lines) {
    const reveal = /\breveals?\b/i.exec(line);
    const isRevealed = /\bis revealed\b/i.exec(line);
    const publicFragment = reveal
      ? line.slice(reveal.index + reveal[0].length)
      : isRevealed
        ? line.slice(0, isRevealed.index)
        : "";
    if (!publicFragment) continue;
    const exactCardIdsByName = new Map<string, string[]>();
    for (const tag of publicFragment.matchAll(CARD_PRINTING_TAG)) {
      const cardId = tag[1];
      const exact = cardId ? cardData[cardId] : undefined;
      if (!cardId || !exact) continue;
      const name = exact.name.trim().toLowerCase();
      const ids = exactCardIdsByName.get(name) ?? [];
      ids.push(cardId);
      exactCardIdsByName.set(name, ids);
    }
    const normalized = publicFragment.toLowerCase();
    const claimedRanges: Array<{ start: number; end: number }> = [];
    for (const card of CARD_ID_BY_NAME) {
      let searchFrom = 0;
      while (searchFrom < normalized.length) {
        const start = normalized.indexOf(card.name, searchFrom);
        if (start < 0) break;
        const end = start + card.name.length;
        searchFrom = start + 1;
        const first = card.name[0];
        const last = card.name.at(-1);
        const before = normalized[start - 1];
        const after = normalized[end];
        const hasBoundaries =
          (!isWordCharacter(first) || !isWordCharacter(before)) &&
          (!isWordCharacter(last) || !isWordCharacter(after));
        const overlapsLongerName = claimedRanges.some(
          (range) => start < range.end && end > range.start,
        );
        if (!hasBoundaries || overlapsLongerName) continue;
        claimedRanges.push({ start, end });
        found.add(exactCardIdsByName.get(card.name)?.shift() ?? card.cardId);
      }
    }
  }
  return [...found];
}

function revealLabelFromLog(line: string): string {
  const visibleLine = withoutCardPrintingTags(line);
  if (
    /\bfrom (?:your |their |the )?hand\b/i.test(visibleLine) ||
    /\bis fused\b/i.test(visibleLine)
  ) return "Revealed from hand";
  return "Revealed from deck";
}

/** Compare consecutive authoritative public views and return card movements
 * and public announcements worth a toast. Deck departures exclude cards known
 * in another public zone; graveyard banishes intentionally surface those
 * already-public cards again so the random or selected result is visible. */
export function detectDeckCardEvents(previous: GameView, current: GameView): DeckCardEvent[] {
  const events: DeckCardEvent[] = [];
  const movedCardIds = new Set<string>();
  const announcedInstances = new Set<number>();
  const previouslyPublic = publicNonDeckIds(previous);
  const newLogLines = appendedLogLines(previous.log, current.log);

  const graveyardBanishNames = cardNamesBanishedFromGraveyard(newLogLines);
  if (graveyardBanishNames.size > 0) {
    for (const seat of [0, 1] as const) {
      const before = previous.players[seat]!;
      const after = current.players[seat]!;
      const priorGraveyardIds = new Set(before.graveyard.map((card) => card.instanceId));
      const priorBanishIds = new Set(before.banish.map((card) => card.instanceId));
      const cards = after.banish.filter((card) =>
        card.instanceId >= 0 &&
        card.cardId !== "" &&
        priorGraveyardIds.has(card.instanceId) &&
        !priorBanishIds.has(card.instanceId) &&
        graveyardBanishNames.has(cardData[card.cardId]?.name.trim().toLowerCase() ?? "")
      );
      if (cards.length === 0) continue;
      const cardIds = cards.map((card) => card.cardId);
      cardIds.forEach((cardId) => movedCardIds.add(cardId));
      const existing = events.find((event) =>
        event.kind === "banish" && event.label === "Banished from graveyard"
      );
      if (existing) {
        existing.cardSeats = [
          ...(existing.cardSeats ?? existing.cardIds.map(() => existing.seat)),
          ...cardIds.map(() => seat),
        ];
        existing.cardIds.push(...cardIds);
        delete existing.seat;
      } else {
        events.push({
          kind: "banish",
          cardIds,
          label: "Banished from graveyard",
          sourceZone: "graveyard",
          seat,
        });
      }
    }
  }

  for (const seat of [0, 1] as const) {
    const before = previous.players[seat]!;
    const after = current.players[seat]!;
    let remainingDeckDepartures = Math.max(0, before.deckCount - after.deckCount);
    if (remainingDeckDepartures === 0) continue;

    for (const zone of ["banish", "graveyard"] as const) {
      if (remainingDeckDepartures === 0) break;
      const movedNames = cardNamesMovedFromDeck(newLogLines, zone);
      if (movedNames.size === 0) continue;
      const cards = newZoneCards(before, after, zone, previouslyPublic)
        .filter((card) => movedNames.has(cardData[card.cardId]?.name.trim().toLowerCase() ?? ""))
        .filter((card) => !announcedInstances.has(card.instanceId))
        .slice(0, remainingDeckDepartures);
      if (cards.length === 0) continue;
      remainingDeckDepartures -= cards.length;
      cards.forEach((card) => announcedInstances.add(card.instanceId));
      const cardIds = cards.map((card) => card.cardId);
      cardIds.forEach((cardId) => movedCardIds.add(cardId));
      const label = zone === "banish" ? "Banished from deck" : "Sent from deck to graveyard";
      const existingBanish = zone === "banish"
        ? events.find((event) => event.kind === "banish" && event.label === label)
        : undefined;
      if (existingBanish) {
        existingBanish.cardSeats = [
          ...(existingBanish.cardSeats ?? existingBanish.cardIds.map(() => existingBanish.seat)),
          ...cardIds.map(() => seat),
        ];
        existingBanish.cardIds.push(...cardIds);
        delete existingBanish.seat;
      } else {
        events.push({ kind: zone, cardIds, label, sourceZone: "deck", seat });
      }
    }
  }

  // one reveal toast per view update, but per-card owner seats so a clash
  // ("Rhinar reveals …", "Dorinthea reveals …") shows both cards side by side
  // with their own border colors
  const revealedIds = new Set<string>();
  const revealsByLabel = new Map<string, {
    cardIds: string[];
    cardSeats: (number | undefined)[];
  }>();
  for (const line of newLogLines) {
    const cardIds = revealedCardIdsFromLogs([line])
      .filter((cardId) => !movedCardIds.has(cardId) && !revealedIds.has(cardId));
    if (cardIds.length === 0) continue;
    const subject = /^(.+?)\s+reveals?\s/i.exec(line)?.[1];
    const seat = current.players.find((player) => player.heroName === subject)?.seat;
    const label = revealLabelFromLog(line);
    const reveal = revealsByLabel.get(label) ?? { cardIds: [], cardSeats: [] };
    for (const cardId of cardIds) revealedIds.add(cardId);
    reveal.cardIds.push(...cardIds);
    reveal.cardSeats.push(...cardIds.map(() => seat));
    revealsByLabel.set(label, reveal);
  }
  for (const [label, reveal] of revealsByLabel) {
    events.push({
      kind: "reveal",
      cardIds: reveal.cardIds,
      label,
      sourceZone: label === "Revealed from hand" ? "hand" : "deck",
      cardSeats: reveal.cardSeats,
    });
  }

  const shuffledSeats = new Set<number>();
  for (const line of newLogLines) {
    const automaticLog = /^(.+?) shuffles their deck$/i.exec(line);
    if (!automaticLog?.[1]) continue;
    const heroName = automaticLog[1];
    for (const player of current.players) {
      if (player.heroName === heroName) shuffledSeats.add(player.seat);
    }
  }
  for (const seat of shuffledSeats) {
    events.push({
      kind: "shuffle",
      cardIds: [],
      label: `${current.players[seat]?.heroName ?? "Hero"} shuffles their deck`,
      seat,
    });
  }

  // Die rolls are public information announced in the log ("Rhinar rolls 4",
  // "the die is rerolled: 2"); surface the outcome as a toast.
  for (const line of newLogLines) {
    if (/^.+ rolls \d+$/.test(line) || /^the die is rerolled: \d+$/.test(line)) {
      events.push({ kind: "roll", cardIds: [], label: line });
    }
  }
  return events;
}
