import { describe, expect, it } from "vitest";
import {
  LOCALE_STORAGE_KEY,
  applyDocumentLocale,
  loadLocalePreference,
  matchSupportedLocale,
  resolveInitialLocale,
  saveLocalePreference,
} from "./locale.js";

function memoryStorage(initial?: string) {
  let value = initial ?? null;
  return {
    getItem: (key: string) => key === LOCALE_STORAGE_KEY ? value : null,
    setItem: (key: string, next: string) => {
      if (key === LOCALE_STORAGE_KEY) value = next;
    },
    value: () => value,
  };
}

describe("locale preference", () => {
  it("matches Simplified Chinese without coercing Traditional Chinese", () => {
    expect(matchSupportedLocale(["zh-CN"])).toBe("zh-Hans");
    expect(matchSupportedLocale(["zh-SG"])).toBe("zh-Hans");
    expect(matchSupportedLocale(["zh-Hans"])).toBe("zh-Hans");
    expect(matchSupportedLocale(["zh-TW"])).toBe("en");
    expect(matchSupportedLocale(["zh-Hant-HK"])).toBe("en");
  });

  it("uses browser preference order and ignores malformed tags", () => {
    expect(matchSupportedLocale(["not_a_locale", "zh-CN", "en-US"])).toBe("zh-Hans");
    expect(matchSupportedLocale(["en-GB", "zh-CN"])).toBe("en");
  });

  it("round-trips only the exact versioned storage shape", () => {
    const storage = memoryStorage();
    saveLocalePreference(storage, "zh-Hans");
    expect(storage.value()).toBe(JSON.stringify({ version: 1, locale: "zh-Hans" }));
    expect(loadLocalePreference(storage)).toBe("zh-Hans");

    expect(loadLocalePreference(memoryStorage(JSON.stringify({
      version: 1,
      locale: "zh-Hans",
      extra: true,
    })))).toBeNull();
    expect(loadLocalePreference(memoryStorage("not json"))).toBeNull();
  });

  it("prefers an explicit saved locale over browser detection", () => {
    const storage = memoryStorage(JSON.stringify({ version: 1, locale: "en" }));
    expect(resolveInitialLocale(storage, ["zh-CN"])).toBe("en");
  });

  it("updates document language metadata", () => {
    const element = { lang: "en", dir: "" };
    applyDocumentLocale(element, "zh-Hans");
    expect(element).toEqual({ lang: "zh-Hans", dir: "ltr" });
  });
});
