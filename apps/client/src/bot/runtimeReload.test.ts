import { describe, expect, it, vi } from "vitest";
import { reloadForBotRuntime } from "./runtimeReload.js";

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}

describe("reloadForBotRuntime", () => {
  it("reloads once per runtime mismatch", () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    reloadForBotRuntime(storage, "old", "new", reload);
    reloadForBotRuntime(storage, "old", "new", reload);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("reloads again for a later deploy", () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    reloadForBotRuntime(storage, "old", "new", reload);
    reloadForBotRuntime(storage, "new", "newer", reload);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("never reloads without a durable marker", () => {
    const reload = vi.fn();
    const storage = { getItem: () => null, setItem: () => { throw new Error("blocked"); } };
    reloadForBotRuntime(storage, "old", "new", reload);
    expect(reload).not.toHaveBeenCalled();
  });
});
