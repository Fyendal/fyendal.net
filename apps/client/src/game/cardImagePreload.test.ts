import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveCardImageUrls } from "./cardImageUrl.js";

class FakeImage {
  static failing = new Set<string>();
  static requested: string[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  decoding = "";
  set src(url: string) {
    FakeImage.requested.push(url);
    queueMicrotask(() => (FakeImage.failing.has(url) ? this.onerror : this.onload)?.());
  }
}

async function load() {
  vi.resetModules();
  FakeImage.failing.clear();
  FakeImage.requested = [];
  vi.stubGlobal("Image", FakeImage);
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  return import("./cardImagePreload.js");
}

afterEach(() => vi.unstubAllGlobals());

describe("card image preloading", () => {
  it("walks the artwork fallback chain until an object loads", async () => {
    const { preloadCardImage } = await load();
    const [first, second] = resolveCardImageUrls("IAR001");
    FakeImage.failing.add(first!);
    await expect(preloadCardImage("IAR001")).resolves.toBe(true);
    expect(FakeImage.requested).toEqual([first, second]);
  });

  it("preloads a chosen art separately from the standard image", async () => {
    const { preloadCardImage, preloadCardImages } = await load();
    await preloadCardImages(["WTR001"], undefined, { WTR001: "WTR001-RF" });
    expect(FakeImage.requested).toEqual([resolveCardImageUrls("WTR001", undefined, false, "WTR001-RF")[0]]);
    await preloadCardImage("WTR001");
    expect(FakeImage.requested.at(-1)).toBe(resolveCardImageUrls("WTR001")[0]);
  });

  it("reports settled progress for unique cards, failures included", async () => {
    const { preloadCardImages } = await load();
    for (const url of resolveCardImageUrls("WTR001")) FakeImage.failing.add(url);
    const progress: [number, number][] = [];
    await preloadCardImages(["WTR001", "WTR002", "WTR002", ""], (settled, total) => {
      progress.push([settled, total]);
    });
    expect(progress.at(0)).toEqual([0, 2]);
    expect(progress.at(-1)).toEqual([2, 2]);
  });
});
