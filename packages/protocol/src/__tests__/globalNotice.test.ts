import { describe, expect, it } from "vitest";
import { decodeGlobalNoticeResponse } from "../index.js";

describe("global notice decoding", () => {
  const notice = { id: "notice-id", message: "Scheduled maintenance", expiresAt: null };
  it("accepts a notice or explicit removal", () => {
    expect(decodeGlobalNoticeResponse({ ok: true, notice })).toEqual({ ok: true, notice });
    expect(decodeGlobalNoticeResponse({ ok: true, notice: null })).toEqual({ ok: true, notice: null });
  });
  it.each([
    { ...notice, message: " " }, { ...notice, message: "x".repeat(1001) },
    { ...notice, expiresAt: -1 }, { ...notice, expiresAt: 1.5 },
    { ...notice, expiresAt: Number.MAX_SAFE_INTEGER + 1 },
    { ...notice, expiresAt: Number.MAX_SAFE_INTEGER },
    { ...notice, extra: true }, { message: "missing id", expiresAt: null },
  ])("rejects invalid notices: %j", (invalid) => {
    expect(decodeGlobalNoticeResponse({ ok: true, notice: invalid })).toBeNull();
  });
  it("rejects missing notice and extra response keys", () => {
    expect(decodeGlobalNoticeResponse({ ok: true })).toBeNull();
    expect(decodeGlobalNoticeResponse({ ok: true, notice, extra: true })).toBeNull();
  });
});
