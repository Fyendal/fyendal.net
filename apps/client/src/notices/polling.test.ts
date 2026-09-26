import { afterEach, describe, expect, it, vi } from "vitest";
import { apiGlobalNotice } from "../auth/auth.js";
import { startNoticePolling } from "./polling.js";

vi.mock("../auth/auth.js", () => ({ apiGlobalNotice: vi.fn() }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

describe("notice polling", () => {
  function setup() {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
    const window = new EventTarget();
    vi.stubGlobal("document", document);
    vi.stubGlobal("window", window);
    return { document, window };
  }
  it("expires locally despite failed refreshes, then picks up replacements and removal", async () => {
    setup();
    const first = { id: "one", message: "Maintenance", expiresAt: 36_000 };
    const second = { id: "two", message: "All clear", expiresAt: null };
    vi.mocked(apiGlobalNotice).mockResolvedValueOnce({ ok: true, notice: first })
      .mockResolvedValueOnce({ ok: false, error: "offline" })
      .mockResolvedValueOnce({ ok: true, notice: second })
      .mockResolvedValueOnce({ ok: true, notice: null });
    const update = vi.fn();
    const stop = startNoticePolling(update);
    await vi.advanceTimersByTimeAsync(0);
    expect(update).toHaveBeenLastCalledWith(first);
    await vi.advanceTimersByTimeAsync(35_000);
    expect(update).toHaveBeenLastCalledWith(null);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(update).toHaveBeenLastCalledWith(second);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(update).toHaveBeenLastCalledWith(null);
    stop();
    const calls = update.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(update).toHaveBeenCalledTimes(calls);
  });
  it("pauses hidden-page requests and refreshes on visibility and connectivity", async () => {
    const { document, window } = setup();
    document.visibilityState = "hidden";
    vi.mocked(apiGlobalNotice).mockResolvedValue({ ok: true, notice: null });
    const stop = startNoticePolling(vi.fn());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(apiGlobalNotice).not.toHaveBeenCalled();
    document.visibilityState = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(apiGlobalNotice).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(apiGlobalNotice).toHaveBeenCalledTimes(2);
    stop();
  });
});
