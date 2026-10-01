import { describe, expect, it } from "vitest";
import { pitchFocusOrigin, rememberStackFocusOrigins } from "./pitchFocusMotion.js";

const arena = { left: 40, top: 400, width: 90, height: 124 };
const stack = { left: 200, top: 100, width: 70, height: 96 };
const previousStack = { left: 220, top: 110, width: 70, height: 96 };

describe("pitch focus animation origin", () => {
  it("retains Danse's stack origin across repeated commits of the payment view", () => {
    const withStack = { cards: new Map([["stack:layer:7", stack]]), zones: new Map() };
    const withoutStack = { cards: new Map([["0:equipment:7", arena]]), zones: new Map() };
    let origins = rememberStackFocusOrigins(new Map(), withStack, [7]);
    origins = rememberStackFocusOrigins(origins, withoutStack, [], 7);
    origins = rememberStackFocusOrigins(origins, withoutStack, [], 7);
    expect(pitchFocusOrigin(false, arena, undefined, origins.get(7))).toBe(stack);
    expect(rememberStackFocusOrigins(origins, withoutStack, []).has(7)).toBe(false);
  });

  it("refreshes visible stack geometry and drops unrelated resolved sources", () => {
    const current = { cards: new Map([["stack:layer:8", stack]]), zones: new Map() };
    const origins = rememberStackFocusOrigins(new Map([[7, previousStack], [8, previousStack]]), current, [8]);
    expect(origins.get(8)).toBe(stack);
    expect(origins.has(7)).toBe(false);
  });

  it("uses the last stack position after a trigger opens a payment decision", () => {
    expect(pitchFocusOrigin(false, arena, undefined, previousStack)).toBe(previousStack);
    expect(pitchFocusOrigin(false, undefined, undefined, previousStack)).toBe(previousStack);
  });

  it("prefers a currently displayed stack source", () => {
    expect(pitchFocusOrigin(false, arena, stack, previousStack)).toBe(stack);
  });

  it("uses the arena for a direct activation with no stack presentation", () => {
    expect(pitchFocusOrigin(false, arena, undefined, undefined)).toBe(arena);
  });

  it("keeps hand announcements anchored to their hand card", () => {
    expect(pitchFocusOrigin(true, arena, stack, previousStack)).toBe(arena);
    expect(pitchFocusOrigin(true, undefined, stack, previousStack, arena)).toBe(arena);
  });
});
