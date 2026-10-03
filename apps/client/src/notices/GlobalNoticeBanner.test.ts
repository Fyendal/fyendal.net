import { afterEach, describe, expect, it, vi } from "vitest";
import { scheduleNoticeExpiry } from "./GlobalNoticeBanner.js";

afterEach(() => vi.useRealTimers());

describe("notice expiry", () => {
  it("hides a notice at its expiry without a refresh", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const onExpire = vi.fn();
    const cancel = scheduleNoticeExpiry(2_000, onExpire);
    await vi.advanceTimersByTimeAsync(999);
    expect(onExpire).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onExpire).toHaveBeenCalledOnce();
    cancel();
  });

  it("cancels the expiry when Home closes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const onExpire = vi.fn();
    const cancel = scheduleNoticeExpiry(2_000, onExpire);
    cancel();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(onExpire).not.toHaveBeenCalled();
  });
});
