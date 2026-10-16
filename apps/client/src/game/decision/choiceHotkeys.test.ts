import { describe, expect, it } from "vitest";
import {
  assignChoiceHotkeys,
  CHOICE_HOTKEY_LIMIT,
  choiceHotkeyIndex,
  choiceHotkeyLabel,
} from "./choiceHotkeys.js";

function press(code: string, overrides: Partial<Parameters<typeof choiceHotkeyIndex>[0]> = {}) {
  return {
    code,
    repeat: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    target: null,
    ...overrides,
  };
}

describe("choice hotkeys", () => {
  it("labels the top row before the home row and stops after eight", () => {
    expect(Array.from({ length: CHOICE_HOTKEY_LIMIT + 1 }, (_, index) => choiceHotkeyLabel(index)))
      .toEqual(["Q", "W", "E", "R", "A", "S", "D", "F", undefined]);
  });

  it("maps physical keys to the displayed choice index", () => {
    expect(choiceHotkeyIndex(press("KeyQ"), 3)).toBe(0);
    expect(choiceHotkeyIndex(press("KeyE"), 3)).toBe(2);
    expect(choiceHotkeyIndex(press("KeyF"), 8)).toBe(7);
  });

  it("ignores keys beyond the offered choices and unrelated keys", () => {
    expect(choiceHotkeyIndex(press("KeyR"), 3)).toBeNull();
    expect(choiceHotkeyIndex(press("KeyZ"), 8)).toBeNull();
    expect(choiceHotkeyIndex(press("Space"), 8)).toBeNull();
  });

  it("leaves modified, repeated, and text-entry presses alone", () => {
    expect(choiceHotkeyIndex(press("KeyQ", { shiftKey: true }), 2)).toBeNull();
    expect(choiceHotkeyIndex(press("KeyQ", { metaKey: true }), 2)).toBeNull();
    expect(choiceHotkeyIndex(press("KeyQ", { ctrlKey: true }), 2)).toBeNull();
    expect(choiceHotkeyIndex(press("KeyQ", { altKey: true }), 2)).toBeNull();
    expect(choiceHotkeyIndex(press("KeyQ", { repeat: true }), 2)).toBeNull();
    const input = { closest: (selectors: string) => selectors.includes("input") ? {} : null };
    expect(choiceHotkeyIndex(press("KeyQ", { target: input as unknown as EventTarget }), 2))
      .toBeNull();
  });
});

describe("choice hotkey assignment", () => {
  const modes = ["power", "go again", "arsenal", "draw"];
  const first = assignChoiceHotkeys(modes, [], []);

  it("assigns letters in display order for a fresh prompt", () => {
    expect([...first]).toEqual([["power", 0], ["go again", 1], ["arsenal", 2], ["draw", 3]]);
  });

  it("keeps each remaining mode's letter after a pick", () => {
    expect([...assignChoiceHotkeys(["go again", "arsenal", "draw"], ["power"], [first])])
      .toEqual([["power", 0], ["go again", 1], ["arsenal", 2], ["draw", 3]]);
    expect([...assignChoiceHotkeys(["power", "go again"], ["arsenal", "draw"], [first])])
      .toEqual([["arsenal", 2], ["draw", 3], ["power", 0], ["go again", 1]]);
  });

  it("starts over when no earlier prompt offered exactly these modes", () => {
    expect([...assignChoiceHotkeys(["go again", "arsenal"], ["power"], [first])])
      .toEqual([["go again", 0], ["arsenal", 1]]);
    expect([...assignChoiceHotkeys(["yes", "no"], ["maybe"], [first])])
      .toEqual([["yes", 0], ["no", 1]]);
  });
});
