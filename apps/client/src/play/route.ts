import type { ConstructedFormat } from "../domain.js";

export interface FabraryPlayRequest {
  url: string;
  format: ConstructedFormat;
}

export type FabraryPlayRoute =
  | { ok: true; request: FabraryPlayRequest }
  | { ok: false; error: "play.error.link" | "play.error.format" };

export function isFabraryPlayPath(path: string): boolean {
  return path === "/play" || path === "/play/" || path === "/play/index.html";
}

/** Presentation validation only; the server validates the source independently. */
export function fabraryPlayRoute(path: string, search: string): FabraryPlayRoute | null {
  if (!isFabraryPlayPath(path)) return null;
  if (search.length > 4_096) return { ok: false, error: "play.error.link" };
  const params = new URLSearchParams(search);
  if (params.getAll("fabrary").length !== 1 || params.getAll("format").length !== 1) {
    return { ok: false, error: "play.error.link" };
  }
  const rawFormat = params.get("format");
  const format = rawFormat === "compcc" ? "cc" : rawFormat;
  if (format !== "cc" && format !== "silver-age") return { ok: false, error: "play.error.format" };
  const rawUrl = params.get("fabrary")!;
  if (rawUrl.length > 2_048) return { ok: false, error: "play.error.link" };
  try {
    const url = new URL(rawUrl);
    const match = /^\/decks\/([0-9A-HJKMNP-TV-Z]{26})\/?$/i.exec(url.pathname);
    if (url.protocol !== "https:" || !["fabrary.net", "www.fabrary.net"].includes(url.hostname)
      || url.port || url.username || url.password || !match) {
      return { ok: false, error: "play.error.link" };
    }
    return { ok: true, request: { format, url: `https://fabrary.net/decks/${match[1]!.toUpperCase()}` } };
  } catch {
    return { ok: false, error: "play.error.link" };
  }
}
