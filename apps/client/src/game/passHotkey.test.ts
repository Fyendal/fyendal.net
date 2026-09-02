import { describe, expect, it } from "vitest";
import type { GameIntent, PendingDecision } from "@fyendal/shared";
import {
  actionConfirmationHotkey,
  decisionSpaceOption,
  passHotkeyIntent,
  shouldConfirmArsenalPass,
  shouldPassOnSpace,
} from "./passHotkey.js";

function keyEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    code: "Space",
    repeat: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    target: null,
    ...overrides,
  } as KeyboardEvent;
}

describe("pass hotkey", () => {
  it("accepts an unmodified Space press on the game board", () => {
    expect(shouldPassOnSpace(keyEvent())).toBe(true);
  });

  it("ignores held or modified Space presses", () => {
    expect(shouldPassOnSpace(keyEvent({ repeat: true }))).toBe(false);
    expect(shouldPassOnSpace(keyEvent({ ctrlKey: true }))).toBe(false);
    expect(shouldPassOnSpace(keyEvent({ code: "Enter" }))).toBe(false);
  });

  it("bypasses a focused button so Space remains the pass shortcut", () => {
    const target = {
      closest: (selector: string) => selector.includes("button") ? {} : null,
    } as unknown as EventTarget;
    expect(shouldPassOnSpace(keyEvent({ target }))).toBe(true);
  });

  it("does not override Space in editable controls", () => {
    const target = {
      closest: (selector: string) => selector.includes("input") ? {} : null,
    } as unknown as EventTarget;
    expect(shouldPassOnSpace(keyEvent({ target }))).toBe(false);
  });

  it("chooses the decision float's primary action with Space", () => {
    expect(actionConfirmationHotkey(keyEvent(), "boost", true)).toBe("select-default-boost");
    expect(actionConfirmationHotkey(keyEvent(), "confirm", true)).toBe("confirm-action");
    expect(actionConfirmationHotkey(keyEvent(), "close-chain", true)).toBe("confirm-chain-close");
    expect(actionConfirmationHotkey(keyEvent(), "ability", true)).toBeNull();
    expect(actionConfirmationHotkey(keyEvent(), "payment", true)).toBeNull();
    expect(actionConfirmationHotkey(keyEvent(), "confirm", false)).toBeNull();
  });

  it("uses the ordinary pass intent to end the turn or pass priority", () => {
    const pass = { kind: "pass" } as const;
    expect(passHotkeyIntent([pass, { kind: "concede" }], null, [])).toBe(pass);
  });

  it.each([
    "Fyendal's Spring Tunic: Add an energy counter",
    "Put a steam counter on Symbiosis Shot?",
  ])("uses the script-provided Space default: %s", (prompt) => {
    const decision: PendingDecision = {
      player: 0,
      kind: "optional-effect",
      prompt,
      options: ["yes", "no"],
      defaultOption: "yes",
    };
    const yes = { kind: "choose", optionId: "yes" } as const;

    expect(decisionSpaceOption(decision)).toBe("yes");
    expect(passHotkeyIntent([yes, { kind: "choose", optionId: "no" }, { kind: "pass" }], decision, []))
      .toBe(yes);
  });

  it("keeps Space on No for optional decisions that do not add counters", () => {
    const decision: PendingDecision = {
      player: 0,
      kind: "optional-effect",
      prompt: "Draw a card?",
      options: ["yes", "no"],
    };
    const pass = { kind: "pass" } as const;

    expect(decisionSpaceOption(decision)).toBe("no");
    expect(passHotkeyIntent([{ kind: "choose", optionId: "yes" }, pass], decision, []))
      .toBe(pass);
  });

  it("submits an explicit No default from a card script", () => {
    const decision: PendingDecision = {
      player: 0,
      kind: "optional-effect",
      prompt: "Destroy Mask of the Pouncing Lynx to search your deck?",
      options: ["yes", "no"],
      defaultOption: "no",
    };
    const no = { kind: "choose", optionId: "no" } as const;

    expect(decisionSpaceOption(decision)).toBe("no");
    expect(passHotkeyIntent([{ kind: "choose", optionId: "yes" }, no, { kind: "pass" }], decision, []))
      .toBe(no);
  });

  it("requires confirmation before Space declines an arsenal choice", () => {
    const pass = { kind: "pass" } as const;
    const arsenal: PendingDecision = {
      player: 0,
      kind: "arsenal",
      prompt: "Choose a card for arsenal",
    };

    expect(shouldConfirmArsenalPass(arsenal, pass)).toBe(true);
    expect(shouldConfirmArsenalPass({ ...arsenal, kind: "priority-window" }, pass)).toBe(false);
    expect(shouldConfirmArsenalPass(arsenal, { kind: "choose", optionId: "11" })).toBe(false);
  });

  it("confirms the exact staged defense, including its payment", () => {
    const decision: PendingDecision = {
      player: 0,
      kind: "defend",
      prompt: "Defend",
      stagedCards: [{ instanceId: 11, cardId: "CARD", owner: 0 }],
    };
    const defend: GameIntent = {
      kind: "defend",
      instanceIds: [11],
      pitchInstanceIds: [22],
    };
    const legal = [
      { kind: "defend", instanceIds: [], pitchInstanceIds: [] },
      defend,
      { kind: "concede" },
    ] satisfies GameIntent[];

    expect(passHotkeyIntent(legal, decision, [22])).toBe(defend);
    expect(passHotkeyIntent(legal, decision, [])).toBeNull();
  });
});
