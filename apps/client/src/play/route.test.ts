import { describe, expect, it } from "vitest";
import { fabraryPlayRoute } from "./route.js";

const url = "https://fabrary.net/decks/01M1WZTPC64GDCMN2GX752E3R7";
const query = (deck: string = url, format = "cc") => `?${new URLSearchParams({ fabrary: deck, format })}`;

describe("Fabrary play links", () => {
  it("accepts encoded and plain deck URLs, canonicalizing the source", () => {
    expect(fabraryPlayRoute("/play", query())).toEqual({ ok: true, request: { url, format: "cc" } });
    const alternate = url.replace("fabrary.net", "www.fabrary.net").toLowerCase() + "?ignored=1";
    expect(fabraryPlayRoute("/play/", query(alternate, "silver-age")))
      .toEqual({ ok: true, request: { url, format: "silver-age" } });
    expect(fabraryPlayRoute("/play/index.html", query()))
      .toEqual({ ok: true, request: { url, format: "cc" } });
    expect(fabraryPlayRoute("/play", `?fabrary=${url}&format=compcc&user=untrusted&visibility=public`))
      .toEqual({ ok: true, request: { url, format: "cc" } });
  });

  it("rejects missing or repeated required parameters and unknown formats", () => {
    for (const search of ["", `?fabrary=${url}`, query() + "&format=cc", query() + `&fabrary=${url}`]) {
      expect(fabraryPlayRoute("/play", search)).toEqual({ ok: false, error: "play.error.link" });
    }
    for (const format of ["blitz", "classic-battles", "", "unknown"]) {
      expect(fabraryPlayRoute("/play", query(url, format))).toEqual({ ok: false, error: "play.error.format" });
    }
  });

  it("rejects hostile URLs and unbounded input", () => {
    for (const deck of [url.replace("https:", "http:"), url.replace("fabrary.net", "fabrary.net.evil.test"),
      url.replace("fabrary.net", "user:pass@fabrary.net"), url.replace("fabrary.net", "fabrary.net:8443"),
      "javascript:alert(1)", url + "/more", url.replace("01M1WZTPC64GDCMN2GX752E3R7", "invalid")]) {
      expect(fabraryPlayRoute("/play", query(deck))).toEqual({ ok: false, error: "play.error.link" });
    }
    expect(fabraryPlayRoute("/play", "?" + "a".repeat(4096))).toEqual({ ok: false, error: "play.error.link" });
    expect(fabraryPlayRoute("/", query())).toBeNull();
    expect(fabraryPlayRoute("/ABC123", query())).toBeNull();
  });
});
