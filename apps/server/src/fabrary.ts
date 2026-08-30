import { cardList } from "@fyendal/cards";
import type { FabraryMatchup } from "@fyendal/protocol";
import type { CardData } from "@fyendal/shared";
import { asRecord } from "./validation.js";

const FABRARY_API_BASE =
  "https://atofkpq0x8.execute-api.us-east-2.amazonaws.com/prod/v1/decks";
const FABRARY_DECK_ID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_CARDS = 256;
const MAX_CARD_QTY = 99;
const MAX_MATCHUPS = 128;
const REQUEST_TIMEOUT_MS = 10_000;

export interface FabraryDeck {
  canonicalUrl: string;
  name: string;
  /** Fabrary data translated to the same text format as Copy decklist. */
  text: string;
  matchups: FabraryMatchup[];
}

export type FabraryDeckResult =
  | { ok: true; deck: FabraryDeck }
  | { ok: false; status: 400 | 404 | 429 | 502 | 503; error: string };

export interface FabraryClient {
  fetchDeck(url: string, matchupId?: string): Promise<FabraryDeckResult>;
}

interface ParsedFabraryUrl {
  deckId: string;
  canonicalUrl: string;
}

/** Accept only public Fabrary deck pages; the API host is never user-controlled. */
export function parseFabraryDeckUrl(input: string): ParsedFabraryUrl | null {
  if (!input || input.length > 2_048) return null;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    (url.hostname !== "fabrary.net" && url.hostname !== "www.fabrary.net") ||
    url.port ||
    url.username ||
    url.password
  ) return null;
  const match = /^\/decks\/([^/]+)\/?$/.exec(url.pathname);
  const deckId = match?.[1]?.toUpperCase();
  if (!deckId || !FABRARY_DECK_ID.test(deckId)) return null;
  return {
    deckId,
    canonicalUrl: `https://fabrary.net/decks/${deckId}`,
  };
}

function fabraryIdentifier(card: CardData): string {
  const name = card.name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "s")
    .toLowerCase()
    .replace(/\/\//g, "_")
    .replace(/[\s-]/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_");
  const pitch = card.pitch === 1
    ? "_red"
    : card.pitch === 2
      ? "_yellow"
      : card.pitch === 3
        ? "_blue"
        : card.pitch === 4
          ? "_purple"
          : "";
  return `${name}${pitch}`;
}

const cardsByIdentifier = new Map<string, CardData>();
for (const card of cardList) {
  const identifier = fabraryIdentifier(card);
  if (!cardsByIdentifier.has(identifier)) cardsByIdentifier.set(identifier, card);
}

function quantity(value: unknown, fallback?: number): number | null {
  if ((value === undefined || value === null) && fallback !== undefined) return fallback;
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= MAX_CARD_QTY
    ? Number(value)
    : null;
}

function readableUnknownIdentifier(identifier: string): { name: string; pitch?: number } {
  const match = /^(.*)_(red|yellow|blue|purple)$/.exec(identifier);
  const pitch = match?.[2] === "red"
    ? 1
    : match?.[2] === "yellow"
      ? 2
      : match?.[2] === "blue"
        ? 3
        : match?.[2] === "purple"
          ? 4
          : undefined;
  return {
    name: (match?.[1] ?? identifier).replace(/[_-]+/g, " "),
    ...(pitch ? { pitch } : {}),
  };
}

function cardLine(identifier: string, qty: number): string {
  // Fabrary uses `--` between the faces of meld/double-faced cards, while our
  // normalized card-name index represents `//` as one separator. Collapse the
  // resulting underscores so `burn-up--shock-red` resolves to
  // `Burn Up // Shock` instead of the fallback name "burn up shock".
  const normalizedIdentifier = identifier.replace(/-/g, "_").replace(/_+/g, "_").toLowerCase();
  const card = cardsByIdentifier.get(normalizedIdentifier);
  const fallback = readableUnknownIdentifier(normalizedIdentifier);
  const name = card?.name ?? fallback.name;
  const pitch = card?.pitch ?? fallback.pitch;
  return `${qty}x ${name}${pitch ? ` (${pitch})` : ""}`;
}

function decodeMatchups(value: unknown): FabraryMatchup[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_MATCHUPS) return null;
  const matchups: FabraryMatchup[] = [];
  const ids = new Set<string>();
  for (const rawMatchup of value) {
    const matchup = asRecord(rawMatchup);
    if (!matchup || typeof matchup.matchupId !== "string" || typeof matchup.name !== "string") return null;
    const id = matchup.matchupId.trim();
    const name = matchup.name.trim();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || !name || name.length > 256 || ids.has(id)) return null;
    let heroIdentifiers: string[] | undefined;
    if (matchup.heroIdentifiers !== undefined) {
      if (!Array.isArray(matchup.heroIdentifiers) || matchup.heroIdentifiers.length > 64) return null;
      heroIdentifiers = [];
      for (const value of matchup.heroIdentifiers) {
        if (typeof value !== "string" || !value || value.length > 256) return null;
        heroIdentifiers.push(value);
      }
    }
    const rawPreference = typeof matchup.preferredTurnOrder === "string"
      ? matchup.preferredTurnOrder.toLowerCase()
      : "";
    const preferredTurnOrder = rawPreference === "first" || rawPreference === "1st"
      ? "first" as const
      : rawPreference === "second" || rawPreference === "2nd"
        ? "second" as const
        : null;
    if (!(matchup.notes === undefined || matchup.notes === null || typeof matchup.notes === "string")) return null;
    const notes = typeof matchup.notes === "string" ? matchup.notes.trim() : "";
    if (notes.length > 4_096) return null;
    ids.add(id);
    matchups.push({
      id,
      name,
      ...(heroIdentifiers ? { heroIdentifiers } : {}),
      preferredTurnOrder,
      ...(notes ? { notes } : {}),
    });
  }
  return matchups;
}

/** Decode the bounded subset of Fabrary's response that deck imports need. */
export function decodeFabraryDeck(value: unknown, source: ParsedFabraryUrl): FabraryDeck | null {
  const data = asRecord(value);
  if (!data || typeof data.name !== "string") return null;
  const name = data.name.trim();
  if (!name || name.length > 256 || !Array.isArray(data.cards) || data.cards.length > MAX_CARDS) return null;

  const matchups = decodeMatchups(data.matchups);
  if (matchups === null) return null;
  const main: string[] = [];
  const sideboard: string[] = [];
  for (const rawCard of data.cards) {
    const card = asRecord(rawCard);
    if (!card) return null;
    const rawIdentifier = typeof card.identifier === "string"
      ? card.identifier
      : typeof card.cardIdentifier === "string"
        ? card.cardIdentifier
        : null;
    const identifier = rawIdentifier?.trim();
    const total = quantity(card.total);
    const sideboardTotal = quantity(card.sideboardTotal, 0);
    if (!identifier || identifier.length > 256 || total === null || sideboardTotal === null) return null;
    if (total === 0 && sideboardTotal === 0) continue;
    if (total > 0) main.push(cardLine(identifier, total));
    if (sideboardTotal > 0) sideboard.push(cardLine(identifier, sideboardTotal));
  }
  if (main.length === 0 && sideboard.length === 0) return null;

  return {
    canonicalUrl: source.canonicalUrl,
    name,
    matchups,
    text: [
      `Name: ${name}`,
      "Deck cards",
      ...main,
      ...(sideboard.length > 0 ? ["Sideboard cards", ...sideboard] : []),
    ].join("\n"),
  };
}

async function responseText(response: Response): Promise<string | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) return null;
  const text = await response.text();
  return Buffer.byteLength(text, "utf8") <= MAX_RESPONSE_BYTES ? text : null;
}

export function createFabraryClient(
  apiKey: string | undefined = process.env.FABRARY_API_SECRET,
  fetcher: typeof fetch = fetch,
): FabraryClient {
  return {
    async fetchDeck(input, matchupId) {
      const source = parseFabraryDeckUrl(input);
      if (!source) {
        return { ok: false, status: 400, error: "enter a valid https://fabrary.net/decks/... URL" };
      }
      if (!apiKey) {
        return { ok: false, status: 503, error: "Fabrary import is not configured" };
      }
      if (matchupId !== undefined && !/^[A-Za-z0-9_-]{1,128}$/.test(matchupId)) {
        return { ok: false, status: 400, error: "invalid Fabrary matchup" };
      }

      let response: Response;
      try {
        const apiUrl = new URL(`${FABRARY_API_BASE}/${source.deckId}`);
        if (matchupId) apiUrl.searchParams.set("matchupId", matchupId);
        response = await fetcher(apiUrl.toString(), {
          headers: { Accept: "application/json", "x-api-key": apiKey },
          redirect: "error",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        return { ok: false, status: 502, error: "Fabrary could not be reached" };
      }
      if (response.status === 404) {
        return { ok: false, status: 404, error: "Fabrary deck not found; make sure it is public" };
      }
      if (response.status === 429) {
        return { ok: false, status: 429, error: "Fabrary is busy; try again shortly" };
      }
      if (!response.ok) {
        return { ok: false, status: 502, error: "Fabrary rejected the deck request" };
      }

      const raw = await responseText(response);
      if (raw === null) {
        return { ok: false, status: 502, error: "Fabrary returned an invalid deck" };
      }
      let value: unknown;
      try {
        value = JSON.parse(raw) as unknown;
      } catch {
        return { ok: false, status: 502, error: "Fabrary returned an invalid deck" };
      }
      const deck = decodeFabraryDeck(value, source);
      return deck
        ? { ok: true, deck }
        : { ok: false, status: 502, error: "Fabrary returned an invalid deck" };
    },
  };
}
