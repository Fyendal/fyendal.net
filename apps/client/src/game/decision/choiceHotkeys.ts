import { createContext, useContext, useEffect, useId, useRef } from "react";
import { loadChoiceHotkeys, saveChoiceHotkeys } from "../../storage.js";

/** Left-hand keys, top row then home row, assigned to choices in display order.
 * Matching on physical `code` keeps the same hand position on every layout. */
const CHOICE_HOTKEYS = [
  { code: "KeyQ", label: "Q" },
  { code: "KeyW", label: "W" },
  { code: "KeyE", label: "E" },
  { code: "KeyR", label: "R" },
  { code: "KeyA", label: "A" },
  { code: "KeyS", label: "S" },
  { code: "KeyD", label: "D" },
  { code: "KeyF", label: "F" },
] as const;

export const CHOICE_HOTKEY_LIMIT = CHOICE_HOTKEYS.length;

/** The player's Option hotkeys setting; off unless the board enables it. */
export const ChoiceHotkeysEnabled = createContext(false);

export function useChoiceHotkeysEnabled(): boolean {
  return useContext(ChoiceHotkeysEnabled);
}

type ChoiceHotkeyEvent = Pick<
  KeyboardEvent,
  "code" | "repeat" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "target"
>;

type KeyboardTarget = {
  closest?: (selectors: string) => unknown;
};

/** Visible keycap for the choice at `index`, or undefined past the eighth. */
export function choiceHotkeyLabel(index: number): string | undefined {
  return CHOICE_HOTKEYS[index]?.label;
}

/** Resolve an unmodified, non-repeating letter press to a hotkey slot.
 * Editable controls keep their letters for text entry. */
export function choiceHotkeyIndex(event: ChoiceHotkeyEvent, slotCount: number): number | null {
  if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return null;
  }
  const index = CHOICE_HOTKEYS.findIndex((hotkey) => hotkey.code === event.code);
  if (index === -1 || index >= slotCount) return null;
  const target = event.target as KeyboardTarget | null;
  if (target?.closest?.("input, textarea, select, [contenteditable='true']")) return null;
  return index;
}

export type ChoiceHotkeyAssignment = ReadonlyMap<string, number>;

/** Assign hotkey slots to option keys in display order. A multi-mode choice
 * arrives again with the picked modes removed and listed as chosen; when an
 * earlier assignment covers exactly the remaining and chosen modes, every
 * mode keeps its slot, so the list can also keep each row where it was.
 * Chosen modes stay in the result to place their rows; they take no key. */
export function assignChoiceHotkeys(
  optionKeys: readonly string[],
  chosenKeys: readonly string[],
  previous: readonly ChoiceHotkeyAssignment[],
): ChoiceHotkeyAssignment {
  if (chosenKeys.length > 0) {
    const earlier = previous.find((assignment) =>
      assignment.size === optionKeys.length + chosenKeys.length &&
      [...optionKeys, ...chosenKeys].every((key) => assignment.has(key)));
    if (earlier) {
      return new Map([...chosenKeys, ...optionKeys].map((key) => [key, earlier.get(key)!]));
    }
  }
  return new Map(optionKeys.slice(0, CHOICE_HOTKEYS.length).map((key, index) => [key, index]));
}

/** Recent fresh assignments by option set. The decision float unmounts
 * between one pick and the next prompt, and a reconnect reloads the page, so
 * they live in session storage rather than React state. */
const RECENT_ASSIGNMENT_LIMIT = 4;
let recentAssignments: Map<string, ChoiceHotkeyAssignment> | null = null;

function signature(keys: Iterable<string>): string {
  return JSON.stringify([...keys].sort());
}

function sessionStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function recent(): Map<string, ChoiceHotkeyAssignment> {
  if (!recentAssignments) {
    const store = sessionStore();
    recentAssignments = new Map(
      (store ? loadChoiceHotkeys(store) : []).map((pairs) => {
        const assignment = new Map(pairs);
        return [signature(assignment.keys()), assignment];
      }),
    );
  }
  return recentAssignments;
}

/** Record a fresh assignment; lists call this after commit. */
export function rememberChoiceHotkeys(assignment: ChoiceHotkeyAssignment): void {
  const assignments = recent();
  const key = signature(assignment.keys());
  const existing = assignments.get(key);
  if (existing && [...existing].every(([option, slot]) => assignment.get(option) === slot)) return;
  assignments.delete(key);
  assignments.set(key, assignment);
  while (assignments.size > RECENT_ASSIGNMENT_LIMIT) {
    assignments.delete(assignments.keys().next().value!);
  }
  const store = sessionStore();
  if (store) saveChoiceHotkeys(store, [...assignments.values()].map((entry) => [...entry]));
}

export function useChoiceHotkeyAssignment(
  optionKeys: readonly string[],
  chosenKeys: readonly string[],
): ChoiceHotkeyAssignment {
  const assignment = assignChoiceHotkeys(optionKeys, chosenKeys, [...recent().values()]);
  const assignmentRef = useRef(assignment);
  assignmentRef.current = assignment;
  // Only a fresh, complete mode list is worth remembering for the next step.
  const freshSignature = chosenKeys.length === 0 && optionKeys.length > 1
    ? JSON.stringify([...assignment])
    : null;
  useEffect(() => {
    if (freshSignature) rememberChoiceHotkeys(assignmentRef.current);
  }, [freshSignature]);
  return assignment;
}

/** The pending decision and a local announcement can both show a list. Only
 * the most recently mounted list answers letters, so one press never chooses
 * twice; the announcement mounts after the decision it refines. */
const owners: string[] = [];

/** Listen for letters while mounted; `choices` is indexed by hotkey slot and
 * may leave slots empty. */
export function useChoiceHotkeys(choices: readonly ((() => void) | undefined)[]): void {
  const ownerId = useId();
  const choicesRef = useRef(choices);
  choicesRef.current = choices;
  const enabled = choices.some((choice) => choice !== undefined);

  useEffect(() => {
    if (!enabled) return;
    owners.push(ownerId);
    const onKeyDown = (event: KeyboardEvent) => {
      if (owners[owners.length - 1] !== ownerId) return;
      // An open settings or report dialog owns the keyboard.
      if (document.querySelector("[aria-modal='true']")) return;
      const index = choiceHotkeyIndex(event, choicesRef.current.length);
      if (index === null) return;
      event.preventDefault();
      choicesRef.current[index]?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      const position = owners.lastIndexOf(ownerId);
      if (position !== -1) owners.splice(position, 1);
    };
  }, [enabled, ownerId]);
}
