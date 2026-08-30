import { describe, expect, it, vi } from "vitest";
import {
  appendClusterEvent,
  ClusterEventConsumer,
  sweepClusterEvents,
  type ClusterEvent,
} from "../clusterEvents.js";
import { freshDb } from "./testdb.js";

describe("cluster event log", () => {
  it("delivers every event to independent gateway consumers", async () => {
    const db = await freshDb();
    const first: ClusterEvent[] = [];
    const second: ClusterEvent[] = [];
    const a = new ClusterEventConsumer(db, (event) => { first.push(event); });
    const b = new ClusterEventConsumer(db, (event) => { second.push(event); });

    await appendClusterEvent(db, {
      type: "room",
      event: { code: "ABC123", kind: "presence", seat: 1, connected: true, version: 7 },
    });
    await appendClusterEvent(db, { type: "user-sessions-revoked", userId: 42 });
    await Promise.all([a.pollNow(), b.pollNow()]);

    expect(first).toEqual(second);
    expect(first).toEqual([
      { type: "room", event: { code: "ABC123", kind: "presence", seat: 1, connected: true, version: 7 } },
      { type: "user-sessions-revoked", userId: 42 },
    ]);
  });

  it("ignores malformed payloads without skipping later valid rows", async () => {
    const db = await freshDb();
    await db.query(
      `INSERT INTO cluster_events
        (event_type, room_code, room_version, subject_user_id, payload, created_at)
       VALUES ('room','ABC123',1,NULL,'{"kind":"presence","seat":9,"connected":true}',1)`,
    );
    await appendClusterEvent(db, { type: "queue-changed" });
    const events: ClusterEvent[] = [];
    const logError = vi.fn();
    const consumer = new ClusterEventConsumer(db, (event) => { events.push(event); }, { logError });

    await consumer.pollNow();

    expect(logError).toHaveBeenCalledOnce();
    expect(events).toEqual([{ type: "queue-changed" }]);
  });

  it("sweeps only events older than the retention boundary", async () => {
    const db = await freshDb();
    await db.query(
      `INSERT INTO cluster_events
        (event_type, room_code, room_version, subject_user_id, payload, created_at)
       VALUES ('queue-changed',NULL,NULL,NULL,'{}',100),
              ('queue-changed',NULL,NULL,NULL,'{}',200)`,
    );
    expect(await sweepClusterEvents(db, 250, 100)).toBe(1);
    expect((await db.query("SELECT created_at FROM cluster_events")).rows).toEqual([{ created_at: 200 }]);
  });

  it("starts a joining gateway at the current tail", async () => {
    const db = await freshDb();
    await appendClusterEvent(db, { type: "queue-changed" });
    const seen: string[] = [];
    const consumer = new ClusterEventConsumer(db, (event) => { seen.push(event.type); });
    await consumer.startAtTail();
    await appendClusterEvent(db, { type: "queue-changed" });
    await consumer.pollNow();
    consumer.stop();
    expect(seen).toEqual(["queue-changed"]);
  });

  it("coalesces consecutive authoritative room refresh hints", async () => {
    const db = await freshDb();
    await appendClusterEvent(db, { type: "room", event: { code: "ABC123", kind: "sync", version: 1 } });
    await appendClusterEvent(db, { type: "room", event: { code: "ABC123", kind: "prep", version: 2 } });
    const seen: ClusterEvent[] = [];
    const consumer = new ClusterEventConsumer(db, (event) => { seen.push(event); });
    await consumer.pollNow();
    expect(seen).toEqual([
      { type: "room", event: { code: "ABC123", kind: "sync", version: 2 } },
    ]);
  });
});
