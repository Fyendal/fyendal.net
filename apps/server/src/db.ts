import { Pool, types } from "pg";

types.setTypeParser(types.builtins.INT8, (value) => value === null ? null : Number(value));

export interface UserRow {
  id: number;
  username: string;
  username_lc: string;
  pass_hash: string;
  created_at: number;
  early_tester: boolean;
  selected_badge: "early-tester" | null;
}

export interface Queryable {
  query(text: string, params?: any[]): Promise<{ rows: any[]; rowCount: number | null }>;
  connect?: () => Promise<Queryable & { release?: () => void }>;
  /** Present on an already checked-out pg client. Callers that receive such a
   * client own its release; nested transaction helpers must not reconnect or
   * release it. */
  release?: () => void;
}

/** Run work on one checked-out connection when available, or directly on a
 * transaction-capable test database. Commit and rollback stay paired here so
 * stores cannot subtly disagree about transaction cleanup. */
export async function withTransaction<T>(
  db: Queryable,
  work: (tx: Queryable) => Promise<T>,
): Promise<T> {
  const connected = db.connect && !db.release ? await db.connect() : null;
  const tx = connected ?? db;
  await tx.query("BEGIN");
  try {
    const result = await work(tx);
    await tx.query("COMMIT");
    return result;
  } catch (error) {
    await tx.query("ROLLBACK");
    throw error;
  } finally {
    connected?.release?.();
  }
}

export interface Migration {
  version: number;
  sql: string;
  apply?: (db: Queryable) => Promise<void>;
}

export const SCHEMA_EPOCH = 1;

export class ResetRequiredError extends Error {
  readonly code = "RESET_REQUIRED";

  constructor(detail: string) {
    super(`RESET_REQUIRED: ${detail}`);
    this.name = "ResetRequiredError";
  }
}

const INITIAL_SCHEMA = `
CREATE TABLE users (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username TEXT NOT NULL,
  username_lc TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL
);
CREATE TABLE decks (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  format TEXT NOT NULL,
  fabrary_url TEXT,
  decklist JSONB NOT NULL,
  hero_name TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE TABLE rooms (
  code TEXT PRIMARY KEY,
  format TEXT NOT NULL,
  spectators JSONB NOT NULL,
  state JSONB,
  prep JSONB,
  ruleset_version TEXT NOT NULL,
  version BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  gc_at BIGINT,
  status TEXT NOT NULL,
  winner INTEGER
);
CREATE TABLE room_seats (
  room_code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
  seat INTEGER NOT NULL CHECK (seat IN (0, 1)),
  user_id INTEGER REFERENCES users(id),
  token_hash TEXT NOT NULL,
  username TEXT,
  hero TEXT,
  hero_id TEXT,
  deck_id TEXT,
  deck_name TEXT,
  from_queue BOOLEAN NOT NULL DEFAULT FALSE,
  ready BOOLEAN NOT NULL DEFAULT FALSE,
  presented JSONB,
  last_action_at BIGINT,
  PRIMARY KEY (room_code, seat)
);
CREATE TABLE room_history (
  room_code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
  version BIGINT NOT NULL,
  state JSONB NOT NULL,
  PRIMARY KEY (room_code, version)
);
CREATE TABLE room_presence (
  room_code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
  lease_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  seat INTEGER,
  last_seen_at BIGINT NOT NULL,
  PRIMARY KEY (room_code, lease_id)
);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);
CREATE INDEX decks_user_id_idx ON decks (user_id);
CREATE INDEX rooms_status_created_idx ON rooms (status, created_at);
CREATE INDEX rooms_gc_at_idx ON rooms (gc_at);
CREATE INDEX rooms_ruleset_version_idx ON rooms (ruleset_version);
CREATE INDEX room_seats_user_id_idx ON room_seats (user_id);
CREATE INDEX room_seats_token_hash_idx ON room_seats (token_hash);
CREATE INDEX room_presence_token_hash_idx ON room_presence (room_code, token_hash);
CREATE INDEX room_presence_expiry_idx ON room_presence (last_seen_at);
`;

/** Initial production schema. Future changes append new immutable entries. */
export const MIGRATIONS: Migration[] = [
  { version: 1, sql: INITIAL_SCHEMA },
  {
    version: 2,
    sql: `ALTER TABLE room_seats
      ADD COLUMN controller TEXT NOT NULL DEFAULT 'human'
      CHECK (controller IN ('human', 'bot'));`,
  },
  {
    version: 3,
    sql: "ALTER TABLE rooms ADD COLUMN is_private BOOLEAN NOT NULL DEFAULT FALSE;",
  },
  {
    version: 4,
    sql: `CREATE TABLE bug_reports (
      id TEXT PRIMARY KEY,
      reporter_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      room_code TEXT NOT NULL,
      room_version BIGINT NOT NULL,
      ruleset_version TEXT NOT NULL,
      description TEXT NOT NULL,
      trace JSONB NOT NULL,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX bug_reports_reporter_idx ON bug_reports (reporter_user_id, created_at);
    CREATE INDEX bug_reports_room_idx ON bug_reports (room_code, created_at);`,
  },
  {
    version: 5,
    sql: `ALTER TABLE room_history
      ADD COLUMN snapshot_turn INTEGER,
      ADD COLUMN undo_seat INTEGER;
    ALTER TABLE room_history
      ADD CONSTRAINT room_history_snapshot_turn_check
        CHECK (snapshot_turn IS NULL OR snapshot_turn >= 0),
      ADD CONSTRAINT room_history_undo_seat_check
        CHECK (undo_seat IS NULL OR undo_seat IN (0, 1));`,
  },
  {
    version: 6,
    sql: `CREATE TABLE replay_games (
      id TEXT PRIMARY KEY,
      room_code TEXT NOT NULL,
      ruleset_version TEXT NOT NULL,
      format TEXT NOT NULL CHECK (format IN ('classic-battles', 'cc', 'silver-age')),
      hero_0_id TEXT NOT NULL,
      hero_1_id TEXT NOT NULL,
      winner INTEGER CHECK (winner IS NULL OR winner IN (0, 1)),
      status TEXT NOT NULL CHECK (status IN ('recording', 'finalizing', 'ready')),
      initial_state JSONB,
      created_at BIGINT NOT NULL,
      finished_at BIGINT,
      expires_at BIGINT,
      frame_count INTEGER CHECK (frame_count IS NULL OR frame_count > 0)
    );
    CREATE TABLE replay_events (
      replay_id TEXT NOT NULL REFERENCES replay_games(id) ON DELETE CASCADE,
      sequence BIGINT NOT NULL CHECK (sequence > 0),
      room_version BIGINT NOT NULL CHECK (room_version >= 0),
      event JSONB NOT NULL,
      PRIMARY KEY (replay_id, sequence)
    );
    CREATE TABLE replay_participants (
      replay_id TEXT NOT NULL REFERENCES replay_games(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      seat INTEGER NOT NULL CHECK (seat IN (0, 1)),
      payload BYTEA,
      payload_bytes INTEGER CHECK (payload_bytes IS NULL OR payload_bytes > 0),
      PRIMARY KEY (replay_id, user_id),
      UNIQUE (replay_id, seat)
    );
    CREATE INDEX replay_games_expires_idx ON replay_games(expires_at);
    CREATE INDEX replay_games_room_status_created_idx
      ON replay_games(room_code, status, created_at);
    CREATE INDEX replay_games_status_finished_idx ON replay_games(status, finished_at);
    CREATE INDEX replay_participants_user_idx ON replay_participants(user_id, replay_id);`,
  },
  {
    version: 7,
    sql: "ALTER TABLE rooms ADD COLUMN allow_future_cards BOOLEAN NOT NULL DEFAULT FALSE;",
  },
  {
    version: 8,
    sql: `DELETE FROM replay_games;
    DROP TABLE replay_events;
    ALTER TABLE replay_games DROP COLUMN initial_state;
    CREATE TABLE replay_frames (
      replay_id TEXT NOT NULL REFERENCES replay_games(id) ON DELETE CASCADE,
      room_version BIGINT NOT NULL CHECK (room_version >= 0),
      view JSONB NOT NULL,
      PRIMARY KEY (replay_id, room_version)
    );`,
  },
  {
    version: 9,
    sql: `CREATE TABLE cluster_events (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      event_type TEXT NOT NULL,
      room_code TEXT,
      room_version BIGINT,
      subject_user_id INTEGER,
      payload JSONB NOT NULL,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX cluster_events_created_idx ON cluster_events(created_at);
    CREATE INDEX cluster_events_room_idx ON cluster_events(room_code, id);`,
  },
  {
    version: 10,
    sql: `ALTER TABLE room_seats
      ADD COLUMN priority_mode TEXT NOT NULL DEFAULT 'always-pause'
        CHECK (priority_mode IN ('always-pause', 'auto-pass')),
      ADD COLUMN runechant_skip BOOLEAN NOT NULL DEFAULT FALSE;`,
  },
  {
    version: 11,
    sql: `CREATE TABLE room_commands (
      room_code TEXT NOT NULL,
      seat INTEGER NOT NULL CHECK (seat IN (0, 1)),
      command_id TEXT NOT NULL,
      command_type TEXT NOT NULL,
      expected_version BIGINT NOT NULL CHECK (expected_version >= 0),
      committed_version BIGINT NOT NULL CHECK (committed_version > expected_version),
      created_at BIGINT NOT NULL,
      PRIMARY KEY (room_code, seat, command_id),
      FOREIGN KEY (room_code, seat) REFERENCES room_seats(room_code, seat) ON DELETE CASCADE
    );
    CREATE INDEX room_commands_created_idx ON room_commands(created_at);`,
  },
  {
    version: 12,
    sql: `CREATE TABLE matchmaking_locks (
      format TEXT PRIMARY KEY CHECK (format IN ('classic-battles', 'cc', 'silver-age')),
      generation BIGINT NOT NULL DEFAULT 0
    );
    INSERT INTO matchmaking_locks(format) VALUES ('classic-battles'), ('cc'), ('silver-age');
    CREATE TABLE matchmaking_entries (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      format TEXT NOT NULL CHECK (format IN ('classic-battles', 'cc', 'silver-age')),
      hero TEXT,
      deck_id TEXT REFERENCES decks(id) ON DELETE CASCADE,
      deck_name TEXT,
      allow_future_cards BOOLEAN NOT NULL DEFAULT FALSE,
      retained_room_code TEXT REFERENCES rooms(code) ON DELETE CASCADE,
      joined_at BIGINT NOT NULL
    );
    CREATE INDEX matchmaking_fifo_idx
      ON matchmaking_entries(format, allow_future_cards, joined_at, user_id);`,
  },
  {
    version: 13,
    sql: `CREATE TABLE worker_leases (
      name TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      lease_until BIGINT NOT NULL
    );
    CREATE INDEX worker_leases_expiry_idx ON worker_leases(lease_until);`,
  },
  {
    version: 14,
    sql: `CREATE TABLE runtime_config (
      singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton = TRUE),
      active_ruleset_version TEXT,
      generation BIGINT NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL
    );
    INSERT INTO runtime_config(singleton, active_ruleset_version, generation, updated_at)
      VALUES (TRUE, NULL, 0, 0);`,
  },
  {
    version: 15,
    sql: `CREATE TABLE rate_limit_buckets (
      bucket_hash TEXT NOT NULL,
      window_start BIGINT NOT NULL,
      request_count INTEGER NOT NULL CHECK (request_count > 0),
      expires_at BIGINT NOT NULL,
      PRIMARY KEY (bucket_hash, window_start)
    );
    CREATE INDEX rate_limit_buckets_expiry_idx ON rate_limit_buckets(expires_at);`,
  },
  {
    version: 16,
    // Keep this entitlement durable. When early testing closes, append a
    // migration that changes the default to FALSE; existing testers retain it.
    sql: "ALTER TABLE users ADD COLUMN early_tester BOOLEAN NOT NULL DEFAULT TRUE;",
  },
  {
    version: 17,
    // Preserve the badge that early testers already saw. When early testing
    // closes, the entitlement/default migration must also default this to NULL.
    sql: `ALTER TABLE users ADD COLUMN selected_badge TEXT;
    UPDATE users SET selected_badge = 'early-tester' WHERE early_tester = TRUE;
    ALTER TABLE users ALTER COLUMN selected_badge SET DEFAULT 'early-tester';
    ALTER TABLE users ADD CONSTRAINT users_selected_badge_entitlement CHECK (
      selected_badge IS NULL OR (selected_badge = 'early-tester' AND early_tester = TRUE)
    );`,
  },
  {
    version: 18,
    // Matchmaking accepts built-in precons as well as user-owned decks. Precons
    // intentionally have no decks row, while queued users and retained rooms
    // already provide the durable cascade boundaries for queue entries.
    // PostgreSQL names this implicit constraint with `_fkey`; pg-mem uses
    // `_fk`. Dropping both conditionally keeps production and test schemas in
    // lockstep without changing the already-applied migration 12.
    sql: `ALTER TABLE matchmaking_entries
      DROP CONSTRAINT IF EXISTS matchmaking_entries_deck_id_fkey;
    ALTER TABLE matchmaking_entries
      DROP CONSTRAINT IF EXISTS matchmaking_entries_deck_id_fk;`,
  },
  {
    version: 19,
    // Matchmade prep deadlines must survive gateway recycling. A nullable room
    // deadline keeps invited and bot rooms untimed; accepted is meaningful
    // only for seats created by matchmaking.
    sql: `ALTER TABLE rooms ADD COLUMN prep_deadline_at BIGINT;
    ALTER TABLE room_seats ADD COLUMN accepted BOOLEAN NOT NULL DEFAULT FALSE;
    CREATE INDEX rooms_prep_deadline_idx ON rooms(prep_deadline_at);`,
  },
  {
    version: 20,
    // Some pre-baseline development databases recorded migration 4 without
    // creating this table. Repair that drift without changing the immutable
    // migration that defines the table for clean databases.
    sql: "",
    apply: async (db) => {
      if ((await publicTables(db)).includes("bug_reports")) return;
      await db.query(`CREATE TABLE bug_reports (
        id TEXT PRIMARY KEY,
        reporter_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        room_code TEXT NOT NULL,
        room_version BIGINT NOT NULL,
        ruleset_version TEXT NOT NULL,
        description TEXT NOT NULL,
        trace JSONB NOT NULL,
        created_at BIGINT NOT NULL
      );
      CREATE INDEX bug_reports_reporter_idx ON bug_reports (reporter_user_id, created_at);
      CREATE INDEX bug_reports_room_idx ON bug_reports (room_code, created_at);`);
    },
  },
  {
    version: 21,
    // Presentation transitions are durable edges between room/replay versions,
    // not rules state, so they remain outside PersistedStateV1.
    sql: `ALTER TABLE rooms ADD COLUMN last_transition JSONB;
    ALTER TABLE replay_frames ADD COLUMN transition JSONB;`,
  },
];

async function publicTables(db: Queryable): Promise<string[]> {
  const { rows } = await db.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
  );
  return rows.map((row) => String(row.table_name));
}

export async function applyMigrations(db: Queryable, migrations: Migration[]): Promise<void> {
  const initialTables = await publicTables(db);
  if (initialTables.length === 0) {
    await db.query("CREATE TABLE schema_metadata (epoch INTEGER PRIMARY KEY)");
    await db.query("INSERT INTO schema_metadata (epoch) VALUES ($1)", [SCHEMA_EPOCH]);
    await db.query("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at BIGINT NOT NULL)");
  } else {
    if (!initialTables.includes("schema_metadata")) {
      throw new ResetRequiredError(`unexpected application tables found (${initialTables.join(", ")})`);
    }
    const { rows } = await db.query("SELECT epoch FROM schema_metadata");
    if (rows.length !== 1 || Number(rows[0].epoch) !== SCHEMA_EPOCH) {
      throw new ResetRequiredError(`database schema epoch is ${rows[0]?.epoch ?? "missing"}; expected ${SCHEMA_EPOCH}`);
    }
    if (!initialTables.includes("schema_migrations")) {
      throw new ResetRequiredError("schema migration ledger is missing");
    }
  }

  const { rows } = await db.query("SELECT version FROM schema_migrations ORDER BY version");
  const applied = new Set(rows.map((row) => Number(row.version)));
  let current = applied.size ? Math.max(...applied) : 0;
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    if (migration.version !== current + 1) {
      throw new Error(`migration gap: at v${current}, next is v${migration.version}`);
    }
    try {
      await withTransaction(db, async (tx) => {
        if (migration.sql.trim()) await tx.query(migration.sql);
        await migration.apply?.(tx);
        await tx.query(
          "INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)",
          [migration.version, Date.now()],
        );
      });
    } catch (error) {
      throw new Error(`migration v${migration.version} failed: ${(error as Error).message}`, { cause: error });
    }
    current = migration.version;
  }
}

export function defaultConnectionString(): string {
  return process.env.DATABASE_URL ?? "postgres://fyendal:fyendal@localhost:5432/fyendal";
}

const MIGRATION_LOCK_KEY = 0x46594d49;

export async function applyMigrationsLocked(pool: Pool, migrations: Migration[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    try {
      await applyMigrations(client, migrations);
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

export async function createPool(connectionString: string = defaultConnectionString()): Promise<Pool> {
  const configuredMax = Number(process.env.DB_POOL_MAX ?? 10);
  const max = Number.isSafeInteger(configuredMax) && configuredMax >= 1 && configuredMax <= 100
    ? configuredMax
    : 10;
  const pool = new Pool({
    connectionString,
    max,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 10_000,
    query_timeout: 12_000,
  });
  try {
    await applyMigrationsLocked(pool, MIGRATIONS);
  } catch (error) {
    await pool.end();
    throw error;
  }
  return pool;
}
