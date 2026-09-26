import { describe, expect, it } from "vitest";
import { freshDb } from "./testdb.js";
import { getGlobalNotice } from "../globalNotice.js";

describe("global notice persistence", () => {
  it("reads the shared notice and hides it at its expiry", async () => {
    const db = await freshDb();
    expect(await getGlobalNotice(db, 0)).toBeNull();
    const notice = { id: "first", message: "Maintenance", expiresAt: 100 };
    await db.query("INSERT INTO global_notice(singleton, notice) VALUES (TRUE, $1)", [JSON.stringify(notice)]);
    expect(await getGlobalNotice(db, 99)).toEqual(notice);
    expect(await getGlobalNotice(db, 100)).toBeNull();
    const replacement = { id: "second", message: "Service restored", expiresAt: null };
    await db.query("UPDATE global_notice SET notice = $1 WHERE singleton = TRUE", [JSON.stringify(replacement)]);
    expect(await getGlobalNotice(db, 200)).toEqual(replacement);
    await db.query("DELETE FROM global_notice WHERE singleton = TRUE");
    expect(await getGlobalNotice(db, 200)).toBeNull();
  });
  it("rejects corrupt stored JSON", async () => {
    const db = await freshDb();
    await db.query("INSERT INTO global_notice(singleton, notice) VALUES (TRUE, $1)", [JSON.stringify({ message: "bad" })]);
    await expect(getGlobalNotice(db)).rejects.toThrow("Invalid stored global notice");
  });
});
