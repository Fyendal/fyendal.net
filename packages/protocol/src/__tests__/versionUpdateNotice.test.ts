import { describe, expect, it } from "vitest";
import { decodeVersionUpdateNoticeResponse } from "../index.js";

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
