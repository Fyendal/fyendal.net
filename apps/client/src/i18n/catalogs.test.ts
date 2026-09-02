import { describe, expect, it } from "vitest";
import englishMessages from "./compiled/en.json";
import chineseMessages from "./compiled/zh-Hans.json";

describe("locale catalogs", () => {
  it("keeps Simplified Chinese complete with the English source catalog", () => {
    expect(Object.keys(chineseMessages).sort()).toEqual(Object.keys(englishMessages).sort());
  });
});
