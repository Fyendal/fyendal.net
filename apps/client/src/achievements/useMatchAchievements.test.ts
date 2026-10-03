import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { apiAchievements } from "../auth/auth.js";
import { useMatchAchievements } from "./useMatchAchievements.js";

// Run the hook's effects and cleanups without a browser or a DOM dependency.
const hooks = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as unknown[],
  pending: [] as (() => void)[],
  cleanups: [] as (() => void)[],
}));
vi.mock("react", () => ({
  useState(initial: unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (value: unknown) => { hooks.slots[index] = value; }];
  },
  useRef(initial: unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
    return hooks.slots[index];
  },
  useEffect(effect: () => (() => void) | undefined, deps: unknown[]) {
    const index = hooks.cursor++;
    const previous = hooks.slots[index] as unknown[] | undefined;
    if (previous && deps.every((dep, i) => Object.is(dep, previous[i]))) return;
    hooks.slots[index] = deps;
    hooks.pending.push(() => {
      hooks.cleanups[index]?.();
      hooks.cleanups[index] = effect() ?? (() => undefined);
    });
  },
}));
vi.mock("../auth/auth.js", () => ({ apiAchievements: vi.fn() }));

type Input = Parameters<typeof useMatchAchievements>[0];
const initial: Input = {
  token: "alice", roomCode: "ABCDEF", gameOver: false, live: true,
  viewUpdate: { source: "live", sequence: 1, transition: "forward" },
};
function TestHook(input: Input) {
  hooks.cursor = 0;
  const result = useMatchAchievements(input);
  hooks.pending.splice(0).forEach((effect) => effect());
  return result;
}
function pendingResponse() {
  let resolve!: (value: Awaited<ReturnType<typeof apiAchievements>>) => void;
  vi.mocked(apiAchievements).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  return () => resolve({
    ok: true,
    unlocks: [{ id: "first-victory", roomCode: "ABCDEF", unlockedAt: 123 }],
    percentages: [],
  });
}

beforeEach(() => {
  hooks.slots = [];
  hooks.pending = [];
  hooks.cleanups = [];
  vi.mocked(apiAchievements).mockReset();
  vi.useFakeTimers();
  vi.stubGlobal("window", globalThis);
});
afterEach(() => {
  hooks.cleanups.forEach((cleanup) => cleanup());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("restarts a cancelled match lookup when returning from replay", async () => {
  const finish = { ...initial, gameOver: true };
  TestHook(initial);
  const stale = pendingResponse();
  TestHook(finish);
  const signal = vi.mocked(apiAchievements).mock.calls[0]![1];
  TestHook({ ...finish, live: false });
  expect(signal?.aborted).toBe(true);
  const current = pendingResponse();
  TestHook(finish);
  expect(apiAchievements).toHaveBeenCalledTimes(2);
  stale();
  await Promise.resolve();
  expect(TestHook(finish).earned).toEqual([]);
  current();
  await Promise.resolve();
  expect(TestHook(finish).earned).toEqual(["first-victory"]);
  expect(TestHook(finish).toast).toEqual([]);
});

it("keeps the pending lookup on live refreshes and expires its toast", async () => {
  TestHook(initial);
  const resolve = pendingResponse();
  const finish = { ...initial, gameOver: true };
  TestHook(finish);
  const refreshed = { ...finish, viewUpdate: { ...finish.viewUpdate, sequence: 2 } };
  TestHook(refreshed);
  expect(apiAchievements).toHaveBeenCalledTimes(1);
  resolve();
  await Promise.resolve();
  expect(TestHook(refreshed).toast).toEqual(["first-victory"]);
  vi.advanceTimersByTime(5_000);
  expect(TestHook(refreshed).toastExiting).toBe(true);
  vi.advanceTimersByTime(220);
  expect(TestHook(refreshed).toast).toEqual([]);
});

it("clears account-specific unlocks and reloads on account changes", async () => {
  const resolve = pendingResponse();
  const finish = { ...initial, gameOver: true };
  TestHook(finish);
  resolve();
  await Promise.resolve();
  expect(TestHook(finish).earned).toEqual(["first-victory"]);
  pendingResponse();
  const otherAccount = { ...finish, token: "bob" };
  TestHook(otherAccount);
  expect(TestHook(otherAccount).earned).toEqual([]);
  expect(apiAchievements).toHaveBeenLastCalledWith("bob", expect.any(AbortSignal));
});
