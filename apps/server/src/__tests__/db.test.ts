import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import {
  applyMigrations,
  MIGRATIONS,
  ResetRequiredError,
  SCHEMA_EPOCH,
  withTransaction,
  type Queryable,
} from "../db.js";

function rawDb(): Queryable {
  const { Pool } = newDb().adapters.createPg();
  return new Pool();
}

async function tables(db: Queryable): Promise<string[]> {
  const { rows } = await db.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
  );
  return rows.map((row) => String(row.table_name));
}

describe("initial schema", () => {
  it("uses an already checked-out client without reconnecting or releasing it", async () => {
    const statements: string[] = [];
    let released = false;
    const client: Queryable = {
      query: async (text) => {
        statements.push(text);
        return { rows: [], rowCount: 0 };
      },
      connect: async () => {
        throw new Error("checked-out client must not reconnect");
      },
      release: () => {
        released = true;
      },
    };

    await withTransaction(client, async (tx) => {
      await tx.query("SELECT 1");
    });

    expect(statements).toEqual(["BEGIN", "SELECT 1", "COMMIT"]);
    expect(released).toBe(false);
  });

  it("checks out and releases a client when given a pool", async () => {
    const statements: string[] = [];
    let released = false;
    const pool: Queryable = {
      query: async () => {
        throw new Error("transactions must use the checked-out client");
      },
      connect: async () => ({
        query: async (text) => {
          statements.push(text);
          return { rows: [], rowCount: 0 };
        },
        release: () => {
          released = true;
        },
      }),
    };

    await withTransaction(pool, async (tx) => {
      await tx.query("SELECT 1");
    });

    expect(statements).toEqual(["BEGIN", "SELECT 1", "COMMIT"]);
    expect(released).toBe(true);
  });

  it("initializes only an empty database with the clean baseline", async () => {
    const db = rawDb();
    await applyMigrations(db, MIGRATIONS);
    expect((await db.query("SELECT epoch FROM schema_metadata")).rows).toEqual([{ epoch: SCHEMA_EPOCH }]);
    expect((await db.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'room_seats' AND column_name = 'controller'",
    )).rows).toEqual([{ column_name: "controller" }]);
    expect((await db.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'room_history' AND column_name IN ('snapshot_turn', 'undo_seat')
       ORDER BY column_name`,
    )).rows).toEqual([
      { column_name: "snapshot_turn" },
      { column_name: "undo_seat" },
    ]);
    expect((await db.query(
      `SELECT data_type FROM information_schema.columns
       WHERE table_name = 'replay_participants' AND column_name = 'payload'`,
    )).rows).toEqual([{ data_type: "bytea" }]);
    expect((await db.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'rooms' AND column_name IN ('allow_future_cards', 'card_pool_mode')
       ORDER BY column_name`,
    )).rows).toEqual([
      { column_name: "allow_future_cards" },
      { column_name: "card_pool_mode" },
    ]);
    expect((await db.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'users' AND column_name = 'early_tester'`,
    )).rows).toEqual([{ column_name: "early_tester" }]);
    expect((await db.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'users' AND column_name = 'selected_badge'`,
    )).rows).toEqual([{ column_name: "selected_badge" }]);
    expect((await db.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'bug_reports' AND column_name = 'fixed_at'`,
    )).rows).toEqual([{ column_name: "fixed_at" }]);
    expect((await db.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'bug_reports' AND column_name = 'dismissed_at'`,
    )).rows).toEqual([{ column_name: "dismissed_at" }]);
    expect((await db.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'bug_reports' AND column_name = 'closed_at'`,
    )).rows).toEqual([{ column_name: "closed_at" }]);
    expect(await tables(db)).toEqual(expect.arrayContaining([
      "users", "sessions", "decks", "rooms", "room_seats", "room_history", "room_presence",
      "bug_reports", "replay_games", "replay_frames", "replay_participants",
      "analytics_events", "schema_metadata", "schema_migrations",
    ]));
    expect(await tables(db)).not.toContain("replay_events");
  });

  it("accepts an existing database and applies appended migrations once", async () => {
    const db = rawDb();
    await applyMigrations(db, MIGRATIONS);
    await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('Kept', 'kept', 'hash', 1)`,
    );
    const next = MIGRATIONS.at(-1)!.version + 1;
    const migrations = [...MIGRATIONS, { version: next, sql: "ALTER TABLE users ADD COLUMN last_login_at BIGINT;" }];
    await applyMigrations(db, migrations);
    await applyMigrations(db, migrations);
    expect((await db.query("SELECT username FROM users")).rows).toEqual([{ username: "Kept" }]);
    expect((await db.query("SELECT version FROM schema_migrations ORDER BY version")).rows)
      .toEqual(migrations.map((migration) => ({ version: migration.version })));
  });

  it("upgrades a version 25 database with durable bot matchmaking state", async () => {
    const db = rawDb();
    await applyMigrations(db, MIGRATIONS.filter((migration) => migration.version <= 25));
    await applyMigrations(db, MIGRATIONS);

    expect((await db.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'matchmaking_entries'
         AND column_name IN ('mode', 'source_room_code', 'pending_offer_room_code', 'avoided_room_codes')
       ORDER BY column_name`,
    )).rows).toEqual([
      { column_name: "avoided_room_codes" },
      { column_name: "mode" },
      { column_name: "pending_offer_room_code" },
      { column_name: "source_room_code" },
    ]);
    expect(await tables(db)).toEqual(expect.arrayContaining([
      "pending_bot_starts",
      "pending_bot_start_candidates",
      "matchmaking_offers",
    ]));
    expect((await db.query("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1")).rows)
      .toEqual([{ version: 30 }]);
  });

  it("adds candidate skip state to an already-applied version 26 database", async () => {
    const db = rawDb();
    await applyMigrations(db, MIGRATIONS.filter((migration) => migration.version <= 26));
    expect((await db.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'pending_bot_start_candidates' AND column_name = 'skipped'`,
    )).rows).toEqual([]);

    await applyMigrations(db, MIGRATIONS);

    expect((await db.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'pending_bot_start_candidates' AND column_name = 'skipped'`,
    )).rows).toEqual([{ column_name: "skipped" }]);
    expect((await db.query("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1")).rows)
      .toEqual([{ version: 30 }]);
  });

  it("adds Starvo to durable pending bot starts", async () => {
    const db = rawDb();
    await applyMigrations(db, MIGRATIONS.filter((migration) => migration.version <= 28));
    const user = await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('StarvoQueue','starvoqueue','hash',1) RETURNING id`,
    );
    const userId = Number(user.rows[0]!.id);
    await db.query(
      `INSERT INTO matchmaking_entries (user_id, format, deck_id, joined_at)
       VALUES ($1,'cc','precon-asb',1)`,
      [userId],
    );

    await applyMigrations(db, MIGRATIONS);

    await expect(db.query(
      `INSERT INTO pending_bot_starts
        (user_id, format, deck_id, bot, card_pool_mode, requested_at)
       VALUES ($1,'cc','precon-asb','starvo','legal',1)`,
      [userId],
    )).resolves.toMatchObject({ rowCount: 1 });
    expect((await db.query("SELECT bot FROM pending_bot_starts WHERE user_id = $1", [userId])).rows)
      .toEqual([{ bot: "starvo" }]);
  });

  it("repairs the early version 26 pending-bot deck foreign key", async () => {
    const db = rawDb();
    await applyMigrations(db, MIGRATIONS.filter((migration) => migration.version <= 27));
    await db.query(
      `ALTER TABLE pending_bot_starts
       ADD CONSTRAINT pending_bot_starts_deck_id_fkey
       FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE`,
    );

    await applyMigrations(db, MIGRATIONS);
    const user = await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('PreconRepair','preconrepair','hash',1) RETURNING id`,
    );
    const userId = Number(user.rows[0]!.id);
    await db.query(
      `INSERT INTO matchmaking_entries (user_id, format, deck_id, joined_at)
       VALUES ($1,'silver-age','precon-sar',1)`,
      [userId],
    );
    await expect(db.query(
      `INSERT INTO pending_bot_starts
        (user_id, format, deck_id, bot, card_pool_mode, requested_at)
       VALUES ($1,'silver-age','precon-sar','briar','legal',1)`,
      [userId],
    )).resolves.toMatchObject({ rowCount: 1 });
  });

  it("repairs a legacy database whose bug reports table is missing", async () => {
    const db = rawDb();
    const repairVersion = MIGRATIONS.at(-1)!.version;
    const legacyMigrations = MIGRATIONS
      .filter((migration) => migration.version < repairVersion)
      .map((migration) => migration.version === 4 ? { ...migration, sql: "" } : migration);
    await applyMigrations(db, legacyMigrations);

    await applyMigrations(db, MIGRATIONS);

    expect(await tables(db)).toContain("bug_reports");
    expect((await db.query(
      "SELECT id FROM bug_reports WHERE reporter_user_id = $1 ORDER BY created_at, id",
      [1],
    )).rows).toEqual([]);
    expect((await db.query("SELECT version FROM schema_migrations WHERE version = $1", [repairVersion])).rows)
      .toEqual([{ version: repairVersion }]);
  });

  it("discards unreleased intent replays when migrating to stored frames", async () => {
    const db = rawDb();
    await applyMigrations(db, MIGRATIONS.filter((migration) => migration.version <= 7));
    await db.query(
      `INSERT INTO replay_games
        (id, room_code, ruleset_version, format, hero_0_id, hero_1_id,
         winner, status, initial_state, created_at, finished_at, expires_at, frame_count)
       VALUES ('legacy','OLD001','rules-a','cc','H0','H1',NULL,'recording','{}',1,NULL,NULL,NULL)`,
    );
    await db.query(
      `INSERT INTO replay_events (replay_id, sequence, room_version, event)
       VALUES ('legacy',1,1,'{"kind":"intent","seat":0,"intent":{"kind":"pass"}}')`,
    );

    await applyMigrations(db, MIGRATIONS);

    expect((await db.query("SELECT id FROM replay_games")).rows).toEqual([]);
    expect(await tables(db)).toContain("replay_frames");
    expect(await tables(db)).not.toContain("replay_events");
  });

  it("fails with RESET_REQUIRED for unexpected tables or another epoch", async () => {
    const unexpected = rawDb();
    await unexpected.query("CREATE TABLE users (id INTEGER)");
    await expect(applyMigrations(unexpected, MIGRATIONS)).rejects.toMatchObject({ code: "RESET_REQUIRED" });

    const wrong = rawDb();
    await wrong.query("CREATE TABLE schema_metadata (epoch INTEGER PRIMARY KEY)");
    await wrong.query("INSERT INTO schema_metadata (epoch) VALUES (2)");
    await wrong.query("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at BIGINT NOT NULL)");
    await expect(applyMigrations(wrong, MIGRATIONS)).rejects.toBeInstanceOf(ResetRequiredError);
  });

  it("rejects migration gaps and rolls back failed appended migrations", async () => {
    const gap = rawDb();
    await expect(applyMigrations(gap, [{ version: 2, sql: "CREATE TABLE t (id INTEGER)" }]))
      .rejects.toThrow(/migration gap/);

    const db = rawDb();
    await applyMigrations(db, MIGRATIONS);
    const next = MIGRATIONS.at(-1)!.version + 1;
    await expect(applyMigrations(db, [...MIGRATIONS, { version: next, sql: "THIS IS NOT SQL" }]))
      .rejects.toThrow(`migration v${next} failed`);
    expect((await db.query("SELECT version FROM schema_migrations ORDER BY version")).rows)
      .toEqual(MIGRATIONS.map((migration) => ({ version: migration.version })));
  });

  it("cascades users to sessions/decks and rooms to seats/history/presence", async () => {
    const db = rawDb();
    await applyMigrations(db, MIGRATIONS);
    const user = await db.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ('Delete', 'delete', 'hash', 1) RETURNING id`,
    );
    const userId = user.rows[0].id;
    await db.query("INSERT INTO sessions (token_hash,user_id,expires_at) VALUES ('s',$1,1)", [userId]);
    await db.query("INSERT INTO decks (id,user_id,name,format,decklist,hero_name,created_at,updated_at) VALUES ('d',$1,'D','cc','{}','H',1,1)", [userId]);
    await db.query(
      `INSERT INTO bug_reports
        (id,reporter_user_id,room_code,room_version,ruleset_version,description,trace,created_at)
       VALUES ('r',$1,'ABC123',1,'rules','description','{}',1)`,
      [userId],
    );
    await db.query("DELETE FROM users WHERE id = $1", [userId]);
    expect((await db.query("SELECT * FROM sessions")).rows).toEqual([]);
    expect((await db.query("SELECT * FROM decks")).rows).toEqual([]);
    expect((await db.query("SELECT * FROM bug_reports")).rows).toEqual([]);
  });
});
