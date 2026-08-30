import { cardData } from "@fyendal/cards/client";

export interface LogTextSegment {
  text: string;
  cardId?: string;
  isToken?: true;
}

const cardIdByName = new Map<string, string>();
const tokenNames = new Set<string>();
for (const card of Object.values(cardData)) {
  if (!cardIdByName.has(card.name)) cardIdByName.set(card.name, card.id);
  if (card.cardType === "token") tokenNames.add(card.name);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const cardNames = [...cardIdByName.keys()].sort((a, b) => b.length - a.length);
const cardNamePattern = new RegExp(
  `(^|[^\\p{L}\\p{N}])(${cardNames.map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}])`,
  "gu",
);
const turnBoundaryPattern = /^— Turn (\d+): (.+)'s turn —$/u;

export interface TurnBoundaryLogLine {
  turn: number;
  heroName: string;
}

export function parseTurnBoundaryLogLine(line: string): TurnBoundaryLogLine | null {
  const match = turnBoundaryPattern.exec(line);
  if (!match?.[1] || !match[2]) return null;
  return { turn: Number(match[1]), heroName: match[2] };
}

/** Recognize only card names already visible in projected log text. Hidden
 * `⟦PRINTINGID⟧` suffixes emitted by the engine pin exact printings; direct
 * `Name⟦PRINTINGID⟧` tags remain supported for legacy replays. Untagged names
 * fall back to the representative printing. */
export function logTextSegments(line: string): LogTextSegment[] {
  let visibleEnd = line.length;
  const trailingCardIdsByName = new Map<string, string[]>();
  while (visibleEnd > 0) {
    const tag = /⟦([A-Z0-9]+)⟧$/.exec(line.slice(0, visibleEnd));
    const cardId = tag?.[1];
    const card = cardId ? cardData[cardId] : undefined;
    if (!tag || !cardId || !card) break;
    const ids = trailingCardIdsByName.get(card.name) ?? [];
    ids.unshift(cardId);
    trailingCardIdsByName.set(card.name, ids);
    visibleEnd -= tag[0].length;
  }
  const visibleLine = line.slice(0, visibleEnd);
  const segments: LogTextSegment[] = [];
  let cursor = 0;
  for (const match of visibleLine.matchAll(cardNamePattern)) {
    const prefix = match[1] ?? "";
    const name = match[2];
    if (!name || match.index === undefined) continue;
    const start = match.index + prefix.length;
    if (start > cursor) segments.push({ text: visibleLine.slice(cursor, start) });
    let cardId = cardIdByName.get(name);
    let end = start + name.length;
    // Direct tags remain supported for existing replays. New logs keep tags
    // in a hidden suffix so raw human-readable sentences remain contiguous.
    const tag = /^⟦([A-Z0-9]+)⟧/.exec(visibleLine.slice(end));
    if (tag?.[1] && cardData[tag[1]]) {
      cardId = tag[1];
      end += tag[0].length;
    } else {
      cardId = trailingCardIdsByName.get(name)?.shift() ?? cardId;
    }
    segments.push({
      text: name,
      cardId,
      ...(tokenNames.has(name) ? { isToken: true as const } : {}),
    });
    cursor = end;
  }
  if (cursor < visibleLine.length) segments.push({ text: visibleLine.slice(cursor) });
  return segments.length > 0 ? segments : [{ text: visibleLine }];
}
