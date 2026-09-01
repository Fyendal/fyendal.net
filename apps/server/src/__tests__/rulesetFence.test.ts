import { describe, expect, it } from "vitest";
import { activateRuleset, assertActiveRuleset, ensureActiveRuleset, RulesetFenceError } from "../rulesetFence.js";
import { PgRoomStore } from "../store.js";
import { freshDb } from "./testdb.js";

describe("ruleset deployment fence", () => {
  it("initializes once and rejects an implicit incompatible rollout", async () => {
    const db = await freshDb();
    await ensureActiveRuleset(db, "rules-a");
    await ensureActiveRuleset(db, "rules-a");
    await expect(ensureActiveRuleset(db, "rules-b")).rejects.toBeInstanceOf(RulesetFenceError);
  });

  it("adopts the persisted ruleset when the fence migration first rolls out", async () => {
    const db = await freshDb();
    const oldStore = new PgRoomStore(db, "rules-a");
    await oldStore.createRoom("classic-battles", { hero: "rhinar" });
    await expect(ensureActiveRuleset(db, "rules-b")).rejects.toBeInstanceOf(RulesetFenceError);
    await expect(ensureActiveRuleset(db, "rules-a")).resolves.toBeUndefined();
  });

  it("explicitly cuts over, invalidates old rooms, and fences old creators", async () => {
    const db = await freshDb();
    await ensureActiveRuleset(db, "rules-a");
    const oldStore = new PgRoomStore(db, "rules-a");
    const room = await oldStore.createRoom("classic-battles", { hero: "rhinar" });

    expect(await activateRuleset(db, "rules-b")).toEqual([{ code: room.code, version: 1 }]);
    await expect(assertActiveRuleset(db, "rules-a")).rejects.toBeInstanceOf(RulesetFenceError);
    await expect(oldStore.createRoom("classic-battles", { hero: "rhinar" })).rejects.toBeInstanceOf(RulesetFenceError);

    const newStore = new PgRoomStore(db, "rules-b");
    const newRoom = await newStore.createRoom("classic-battles", { hero: "dorinthea" });
    expect(newRoom).toMatchObject({ seat: 0 });

    // A superseded Cloud Run instance may remain alive for an existing socket.
    // It must not hydrate or mutate rooms created after the cutover.
    await expect(oldStore.getRoom(newRoom.code)).resolves.toBeNull();
    await expect(newStore.getRoom(newRoom.code)).resolves.toMatchObject({
      code: newRoom.code,
      rulesetVersion: "rules-b",
    });
  });
});
