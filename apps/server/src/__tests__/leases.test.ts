import { describe, expect, it } from "vitest";
import { releaseLease, tryAcquireLease } from "../leases.js";
import { freshDb } from "./testdb.js";

describe("worker leases", () => {
  it("fences another owner until expiry and permits renewal/release", async () => {
    const db = await freshDb();
    expect(await tryAcquireLease(db, "bot:ABC123", "instance-a", 5_000, 1_000)).toBe(true);
    expect(await tryAcquireLease(db, "bot:ABC123", "instance-b", 5_000, 2_000)).toBe(false);
    expect(await tryAcquireLease(db, "bot:ABC123", "instance-a", 5_000, 2_000)).toBe(true);
    expect(await tryAcquireLease(db, "bot:ABC123", "instance-b", 5_000, 7_001)).toBe(true);
    await releaseLease(db, "bot:ABC123", "instance-b");
    expect(await tryAcquireLease(db, "bot:ABC123", "instance-a", 5_000, 7_002)).toBe(true);
  });

  it("accepts the two-hour lease used by hourly maintenance", async () => {
    const db = await freshDb();
    const twoHoursMs = 2 * 60 * 60_000;

    expect(await tryAcquireLease(db, "maintenance:social", "instance-a", twoHoursMs, 1_000)).toBe(true);
    expect(await tryAcquireLease(db, "maintenance:social", "instance-b", twoHoursMs, 1_000 + twoHoursMs - 1)).toBe(false);
    expect(await tryAcquireLease(db, "maintenance:social", "instance-b", twoHoursMs, 1_000 + twoHoursMs)).toBe(true);
  });
});
