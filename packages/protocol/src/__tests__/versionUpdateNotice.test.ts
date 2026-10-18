import { describe, expect, it } from "vitest";
import { decodeVersionUpdateImageSource, decodeVersionUpdateNoticeResponse } from "../index.js";

describe("version update notice decoding", () => {
  const notice = { id: "publication-id", version: "2.0", markdown: "## New in 2.0\n\n- Feature", publishedAt: 1_700_000_000_000 };
  it("accepts an active notice or an explicit removal", () => {
    expect(decodeVersionUpdateNoticeResponse({ ok: true, notice })).toEqual({ ok: true, notice });
    expect(decodeVersionUpdateNoticeResponse({ ok: true, notice: null })).toEqual({ ok: true, notice: null });
  });
  it("normalizes notices published before timestamps were recorded", () => {
    const { publishedAt: _ignored, ...legacy } = notice;
    expect(decodeVersionUpdateNoticeResponse({ ok: true, notice: legacy }))
      .toEqual({ ok: true, notice: { ...legacy, publishedAt: null } });
  });
  it.each([
    { ...notice, version: " " }, { ...notice, markdown: " " },
    { ...notice, version: "x".repeat(81) }, { ...notice, markdown: "x".repeat(10_001) },
    { ...notice, publishedAt: -1 }, { ...notice, publishedAt: 1.5 },
    { ...notice, publishedAt: Number.MAX_SAFE_INTEGER },
    { ...notice, extra: true }, { version: "2.0", markdown: "Hello" },
  ])("rejects invalid payloads: %j", (invalid) => {
    expect(decodeVersionUpdateNoticeResponse({ ok: true, notice: invalid })).toBeNull();
  });
  it("rejects extra response keys", () => {
    expect(decodeVersionUpdateNoticeResponse({ ok: true, notice, extra: true })).toBeNull();
  });
});

describe("version update image sources", () => {
  it("accepts client screenshots with their encoded size", () => {
    expect(decodeVersionUpdateImageSource("/updates/2026-10-18/deck-grid.1280x720.webp"))
      .toEqual({ kind: "screenshot", src: "/updates/2026-10-18/deck-grid.1280x720.webp", width: 1280, height: 720 });
    expect(decodeVersionUpdateImageSource("/updates/v2/mobile.390x844.png")?.kind).toBe("screenshot");
  });
  it("accepts Fabrary card printings", () => {
    expect(decodeVersionUpdateImageSource("https://content.fabrary.net/cards/ROS254-MV.webp"))
      .toEqual({ kind: "card", src: "https://content.fabrary.net/cards/ROS254-MV.webp", width: 450, height: 628 });
    expect(decodeVersionUpdateImageSource("https://content.fabrary.net/cards/GEM119_BACK.webp")?.kind).toBe("card");
  });
  it.each([
    undefined, "", "/updates/release/shot.webp", "/updates/release/shot.0x720.webp",
    "/updates/release/shot.5000x720.webp", "/updates/release/shot.1280x720.svg",
    "/updates/../secret/shot.1280x720.webp", "/updates/release/../shot.1280x720.webp",
    "//evil.example/updates/release/shot.1280x720.webp", "/updates/Release/shot.1280x720.webp",
    "/updates/release/shot.1280x720.webp?x=1", "/assets/shot.1280x720.webp",
    "https://example.com/updates/release/shot.1280x720.webp", "data:image/png;base64,AAAA",
    "http://content.fabrary.net/cards/WTR001.webp", "https://content.fabrary.net/heroes/dash.webp",
    "https://content.fabrary.net/cards/WTR001.png", "https://content.fabrary.net.evil.example/cards/WTR001.webp",
  ])("rejects %j", (src) => {
    expect(decodeVersionUpdateImageSource(src)).toBeNull();
  });
});
