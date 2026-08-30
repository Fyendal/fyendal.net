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
});
