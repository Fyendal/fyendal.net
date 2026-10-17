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
  {
    version: 22,
    // Product analytics are intentionally anonymous and append-only. They
    // retain aggregate history after account deletion, room GC, and replay
    // expiry without preserving user ids, usernames, room codes, or state.
    sql: `CREATE TABLE analytics_events (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL
        CHECK (event_type IN ('user_registered', 'game_completed')),
      occurred_at BIGINT NOT NULL,
      format TEXT
        CHECK (format IS NULL OR format IN ('classic-battles', 'cc', 'silver-age')),
      game_mode TEXT
        CHECK (game_mode IS NULL OR game_mode IN ('pvp', 'bot')),
      CHECK (
        (event_type = 'user_registered' AND format IS NULL AND game_mode IS NULL)
        OR
        (event_type = 'game_completed' AND format IS NOT NULL AND game_mode IS NOT NULL)
      )
    );
    CREATE INDEX analytics_events_time_idx
      ON analytics_events (occurred_at, event_type);`,
  },
  {
    version: 23,
    // Bug reports remain available for operator follow-up after resolution.
    // A nullable timestamp records both status and when the report was closed
    // without exposing operator workflow through the player-facing API.
    sql: `ALTER TABLE bug_reports ADD COLUMN fixed_at BIGINT;
    CREATE INDEX bug_reports_fixed_created_idx
      ON bug_reports (fixed_at, created_at);`,
  },
  {
    version: 24,
    // Fixed-report acknowledgements are durable per account so dismissing a
    // notification on one browser prevents it from resurfacing elsewhere.
    sql: `ALTER TABLE bug_reports ADD COLUMN dismissed_at BIGINT;
    CREATE INDEX bug_reports_reporter_notification_idx
      ON bug_reports (reporter_user_id, dismissed_at, fixed_at);`,
  },
  {
    version: 25,
    sql: `ALTER TABLE rooms ADD COLUMN card_pool_mode TEXT NOT NULL DEFAULT 'legal'
      CHECK (card_pool_mode IN ('legal', 'future', 'open'));
    UPDATE rooms SET card_pool_mode = 'future' WHERE allow_future_cards = TRUE;
    ALTER TABLE matchmaking_entries ADD COLUMN card_pool_mode TEXT NOT NULL DEFAULT 'legal'
      CHECK (card_pool_mode IN ('legal', 'future', 'open'));
    UPDATE matchmaking_entries SET card_pool_mode = 'future' WHERE allow_future_cards = TRUE;
    DROP INDEX matchmaking_fifo_idx;
    CREATE INDEX matchmaking_fifo_idx
      ON matchmaking_entries(format, card_pool_mode, joined_at, user_id);`,
  },
  {
    version: 26,
    sql: `ALTER TABLE matchmaking_entries
      ADD COLUMN mode TEXT NOT NULL DEFAULT 'foreground'
        CHECK (mode IN ('foreground', 'background')),
      ADD COLUMN source_room_code TEXT REFERENCES rooms(code) ON DELETE CASCADE,
      ADD COLUMN pending_offer_room_code TEXT REFERENCES rooms(code) ON DELETE SET NULL,
      ADD COLUMN avoided_room_codes JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE matchmaking_entries ADD CONSTRAINT matchmaking_entry_mode_check CHECK (
      (mode = 'foreground' AND source_room_code IS NULL)
      OR (mode = 'background' AND source_room_code IS NOT NULL)
    );
    CREATE UNIQUE INDEX matchmaking_pending_offer_user_idx
      ON matchmaking_entries(pending_offer_room_code, user_id)
      WHERE pending_offer_room_code IS NOT NULL;
    CREATE INDEX matchmaking_source_room_idx
      ON matchmaking_entries(source_room_code)
      WHERE source_room_code IS NOT NULL;

    CREATE TABLE pending_bot_starts (
      user_id INTEGER PRIMARY KEY REFERENCES matchmaking_entries(user_id) ON DELETE CASCADE,
      format TEXT NOT NULL CHECK (format IN ('cc', 'silver-age')),
      deck_id TEXT NOT NULL,
      bot TEXT NOT NULL CHECK (bot IN ('ira', 'hala', 'cindra', 'jarl', 'briar', 'bravo')),
      card_pool_mode TEXT NOT NULL CHECK (card_pool_mode IN ('legal', 'future', 'open')),
      requested_at BIGINT NOT NULL
    );
    CREATE TABLE pending_bot_start_candidates (
      starter_user_id INTEGER NOT NULL REFERENCES pending_bot_starts(user_id) ON DELETE CASCADE,
      candidate_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
      attempted BOOLEAN NOT NULL DEFAULT FALSE,
      PRIMARY KEY (starter_user_id, candidate_user_id),
      UNIQUE (starter_user_id, ordinal)
    );
    CREATE INDEX pending_bot_candidates_next_idx
      ON pending_bot_start_candidates(starter_user_id, attempted, ordinal);

    CREATE TABLE matchmaking_offers (
      room_code TEXT PRIMARY KEY REFERENCES rooms(code) ON DELETE CASCADE,
      first_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      second_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL,
      CHECK (first_user_id <> second_user_id)
    );
    CREATE UNIQUE INDEX matchmaking_offer_pair_idx
      ON matchmaking_offers(first_user_id, second_user_id);`,
  },
  {
    version: 27,
    sql: `ALTER TABLE pending_bot_start_candidates
      ADD COLUMN skipped BOOLEAN NOT NULL DEFAULT FALSE;
    DROP INDEX pending_bot_candidates_next_idx;
    CREATE INDEX pending_bot_candidates_next_idx
      ON pending_bot_start_candidates(starter_user_id, attempted, skipped, ordinal);`,
  },
  {
    version: 28,
    // Early local applications of v26 briefly included this FK. Built-in
    // precon ids are registry-backed and intentionally have no decks row.
    sql: `ALTER TABLE pending_bot_starts
      DROP CONSTRAINT IF EXISTS pending_bot_starts_deck_id_fkey;
    ALTER TABLE pending_bot_starts
      DROP CONSTRAINT IF EXISTS pending_bot_starts_deck_id_fk;`,
  },
  {
    version: 29,
    // Bot ids are durable background-matchmaking state. Extend the v26
    // allowlist for the Starvo practice opponent without editing that applied
    // migration.
    sql: `ALTER TABLE pending_bot_starts
      DROP CONSTRAINT IF EXISTS pending_bot_starts_bot_check;
    -- pg-mem assigns positional names to inline checks; production Postgres
    -- uses the column-derived name above.
    ALTER TABLE pending_bot_starts
      DROP CONSTRAINT IF EXISTS pending_bot_starts_constraint_2;
    ALTER TABLE pending_bot_starts
      ADD CONSTRAINT pending_bot_starts_bot_check
      CHECK (bot IN ('ira', 'hala', 'cindra', 'jarl', 'briar', 'bravo', 'starvo'));`,
  },
  {
    version: 30,
    // Operators can close reports that are invalid, duplicates, or otherwise
    // do not require a fix without sending the reporter a fixed notification.
    sql: `ALTER TABLE bug_reports ADD COLUMN closed_at BIGINT;
    ALTER TABLE bug_reports
      ADD CONSTRAINT bug_reports_resolution_check
      CHECK (fixed_at IS NULL OR closed_at IS NULL);
    CREATE INDEX bug_reports_closed_created_idx
      ON bug_reports (closed_at, created_at);`,
  },
  {
    version: 31,
    sql: `CREATE TABLE friendships (
      user_low_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_high_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (user_low_id, user_high_id),
      CHECK (user_low_id < user_high_id)
    );
    CREATE INDEX friendships_high_idx ON friendships (user_high_id, user_low_id);
    CREATE TABLE friend_requests (
      user_low_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_high_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      requester_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (user_low_id, user_high_id),
      CHECK (user_low_id < user_high_id),
      CHECK (requester_user_id = user_low_id OR requester_user_id = user_high_id)
    );
    CREATE INDEX friend_requests_low_created_idx ON friend_requests (user_low_id, created_at);
    CREATE INDEX friend_requests_high_created_idx ON friend_requests (user_high_id, created_at);
    CREATE TABLE friend_messages (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_low_id INTEGER NOT NULL,
      user_high_id INTEGER NOT NULL,
      sender_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_message_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      read_at BIGINT,
      FOREIGN KEY (user_low_id, user_high_id)
        REFERENCES friendships(user_low_id, user_high_id) ON DELETE CASCADE,
      UNIQUE (sender_user_id, client_message_id),
      CHECK (user_low_id < user_high_id),
      CHECK (sender_user_id <> recipient_user_id),
      CHECK ((sender_user_id = user_low_id AND recipient_user_id = user_high_id)
        OR (sender_user_id = user_high_id AND recipient_user_id = user_low_id))
    );
    CREATE INDEX friend_messages_conversation_idx
      ON friend_messages (user_low_id, user_high_id, created_at DESC, id DESC);
    CREATE INDEX friend_messages_unread_idx
      ON friend_messages (recipient_user_id, read_at, created_at);
    CREATE TABLE social_presence (
      lease_id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      last_seen_at BIGINT NOT NULL
    );
    CREATE INDEX social_presence_user_seen_idx
      ON social_presence (user_id, last_seen_at);
    CREATE INDEX social_presence_expiry_idx ON social_presence (last_seen_at);`,
  },
  {
    version: 32,
    // Replay finalization is asynchronous and may fail on an unusually large
    // recording. Persist retry state so every gateway and every maintenance
    // sweep observes the same backoff instead of retrying a costly query once
    // per minute on each surviving Cloud Run revision.
    sql: `ALTER TABLE replay_games
      ADD COLUMN finalization_attempts INTEGER NOT NULL DEFAULT 0
        CHECK (finalization_attempts >= 0),
      ADD COLUMN finalization_retry_at BIGINT;
    CREATE INDEX replay_games_finalization_retry_idx
      ON replay_games (finalization_retry_at, finished_at)
      WHERE status = 'finalizing';`,
  },
  {
    version: 33,
    // Replay notes are private participant-owned metadata. Live notes use the
    // authoritative room version until finalization resolves it to a frame.
    sql: `CREATE TABLE replay_notes (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      replay_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      room_version BIGINT,
      frame_index INTEGER,
      note VARCHAR(2000) NOT NULL CHECK (note <> ''),
      FOREIGN KEY (replay_id, user_id)
        REFERENCES replay_participants(replay_id, user_id) ON DELETE CASCADE,
      CHECK ((room_version IS NOT NULL AND frame_index IS NULL)
        OR (room_version IS NULL AND frame_index IS NOT NULL)),
      CHECK (room_version IS NULL OR room_version >= 0),
      CHECK (frame_index IS NULL OR frame_index >= 0)
    );
    CREATE UNIQUE INDEX replay_notes_room_version_idx
      ON replay_notes(replay_id, user_id, room_version)
      WHERE room_version IS NOT NULL;
    CREATE UNIQUE INDEX replay_notes_frame_idx
      ON replay_notes(replay_id, user_id, frame_index)
      WHERE frame_index IS NOT NULL;
    CREATE INDEX replay_notes_owner_idx
      ON replay_notes(replay_id, user_id);`,
  },
  {
    version: 34,
    sql: `ALTER TABLE room_presence
      ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
    CREATE INDEX room_presence_spectator_user_idx
      ON room_presence(room_code, user_id) WHERE seat IS NULL;`,
  },
  {
    version: 35,
    // Favorites are participant-owned: retaining a replay for one player must
    // not extend the other player's private payload or notes.
    sql: `ALTER TABLE replay_participants
      ADD COLUMN favorite BOOLEAN NOT NULL DEFAULT FALSE;
    CREATE INDEX replay_participants_favorite_user_idx
      ON replay_participants(user_id, replay_id) WHERE favorite = TRUE;`,
  },
  {
    version: 36,
    sql: `CREATE TABLE global_notice (
      singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton = TRUE),
      notice JSONB NOT NULL
    );`,
  },
  {
    version: 37,
    sql: `ALTER TABLE bug_reports ADD COLUMN resolution_message VARCHAR(2000);
    ALTER TABLE bug_reports ADD CONSTRAINT bug_reports_message_check
      CHECK (resolution_message IS NULL OR resolution_message <> '');`,
  },
  {
    version: 38,
    // Extend durable matchmaking bot ids without changing applied migrations.
    sql: `ALTER TABLE pending_bot_starts
      DROP CONSTRAINT IF EXISTS pending_bot_starts_bot_check;
    ALTER TABLE pending_bot_starts
      ADD CONSTRAINT pending_bot_starts_bot_check
      CHECK (bot IN ('ira', 'hala', 'cindra', 'jarl', 'briar', 'bravo', 'starvo', 'kayo'));`,
  },
  {
    version: 39,
    // End automatic early-tester awards while retaining existing entitlements
    // and each account's displayed-badge preference.
    sql: `ALTER TABLE users ALTER COLUMN early_tester SET DEFAULT FALSE;
    ALTER TABLE users ALTER COLUMN selected_badge SET DEFAULT NULL;`,
  },
  {
    version: 40,
    // One account per UTC game-start day. The account FK makes these
    // activity records exportable and removes them on account deletion.
    sql: `CREATE TABLE daily_game_players (
      day_utc BIGINT NOT NULL CHECK (day_utc >= 0),
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (day_utc, user_id)
    );`,
  },
  {
    version: 41,
    // Shared precons have no decks row, so deck_id is not a foreign key.
    sql: `CREATE TABLE deck_plays (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      deck_id TEXT NOT NULL,
      last_played_at BIGINT NOT NULL CHECK (last_played_at >= 0),
      PRIMARY KEY (user_id, deck_id)
    );`,
  },
  {
    version: 42,
    sql: `CREATE TABLE version_update_notice (
      singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton = TRUE),
      notice JSONB NOT NULL
    );`,
  },
  {
    version: 43,
    sql: `CREATE TABLE user_achievements (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      achievement_id TEXT NOT NULL,
      unlocked_at BIGINT NOT NULL CHECK (unlocked_at >= 0),
      room_code TEXT NOT NULL,
      PRIMARY KEY (user_id, achievement_id)
    );
    CREATE INDEX user_achievements_id_idx ON user_achievements (achievement_id);`,
  },
  {
    version: 44,
    sql: `ALTER TABLE pending_bot_starts
      DROP CONSTRAINT IF EXISTS pending_bot_starts_bot_check;
    ALTER TABLE pending_bot_starts
      ADD CONSTRAINT pending_bot_starts_bot_check
      CHECK (bot IN ('ira', 'hala', 'cindra', 'jarl', 'briar', 'bravo', 'starvo', 'kayo', 'levia'));`,
  },
  {
    version: 45,
    // A declined offer avoids its room code, but a requeueing opponent opens a
    // new room. These lists belong to one search and end with its entry.
    sql: `ALTER TABLE matchmaking_entries
      ADD COLUMN avoided_user_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE matchmaking_entries
      ADD COLUMN avoided_heroes JSONB NOT NULL DEFAULT '[]'::jsonb;`,
  },
  {
    version: 46,
    // Durable match history. Replays expire and rooms are garbage-collected,
    // so finished games get their own rows, written in the game-over commit.
    // Per-hero counters are maintained in that same commit so the history tab
    // never aggregates match rows on read. Opponent accounts are referenced
    // with SET NULL so one player's deletion keeps the other's history; the
    // username snapshot is cleared explicitly on account deletion.
    sql: `CREATE TABLE matches (
      id TEXT PRIMARY KEY,
      room_code TEXT NOT NULL,
      format TEXT NOT NULL CHECK (format IN ('cc', 'silver-age')),
      ruleset_version TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('pvp', 'bot')),
      winner INTEGER CHECK (winner IS NULL OR winner IN (0, 1)),
      end_reason TEXT CHECK (end_reason IS NULL OR end_reason IN ('lethal', 'concede', 'idle', 'draw', 'ended')),
      started_at BIGINT NOT NULL CHECK (started_at >= 0),
      finished_at BIGINT NOT NULL CHECK (finished_at >= 0),
      replay_id TEXT REFERENCES replay_games(id) ON DELETE SET NULL,
      UNIQUE (room_code, started_at)
    );
    CREATE INDEX matches_finished_idx ON matches (finished_at, id);
    CREATE TABLE match_participants (
      match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      seat INTEGER NOT NULL CHECK (seat IN (0, 1)),
      controller TEXT NOT NULL CHECK (controller IN ('human', 'bot')),
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      username TEXT,
      bot_id TEXT,
      hero_id TEXT NOT NULL,
      deck_name TEXT,
      PRIMARY KEY (match_id, seat)
    );
    CREATE INDEX match_participants_user_idx ON match_participants (user_id, match_id);
    CREATE TABLE hero_records (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      hero_id TEXT NOT NULL,
      opponent_kind TEXT NOT NULL CHECK (opponent_kind IN ('player', 'bot')),
      format TEXT NOT NULL CHECK (format IN ('cc', 'silver-age')),
      games INTEGER NOT NULL DEFAULT 0 CHECK (games >= 0),
      wins INTEGER NOT NULL DEFAULT 0 CHECK (wins >= 0),
      losses INTEGER NOT NULL DEFAULT 0 CHECK (losses >= 0),
      draws INTEGER NOT NULL DEFAULT 0 CHECK (draws >= 0),
      ended INTEGER NOT NULL DEFAULT 0 CHECK (ended >= 0),
      last_played_at BIGINT NOT NULL CHECK (last_played_at >= 0),
      PRIMARY KEY (user_id, hero_id, opponent_kind, format)
    );
    CREATE TABLE matchup_records (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      hero_id TEXT NOT NULL,
      opponent_hero_id TEXT NOT NULL,
      opponent_kind TEXT NOT NULL CHECK (opponent_kind IN ('player', 'bot')),
      format TEXT NOT NULL CHECK (format IN ('cc', 'silver-age')),
      games INTEGER NOT NULL DEFAULT 0 CHECK (games >= 0),
      wins INTEGER NOT NULL DEFAULT 0 CHECK (wins >= 0),
      losses INTEGER NOT NULL DEFAULT 0 CHECK (losses >= 0),
      draws INTEGER NOT NULL DEFAULT 0 CHECK (draws >= 0),
      PRIMARY KEY (user_id, hero_id, opponent_hero_id, opponent_kind, format)
    );`,
    // Backfill from Constructed replays still retained at upgrade time so
    // history is not empty on deploy. A seat without a participant row belonged to a bot
    // (bot seats have no account); its bot identity is not recorded, so the
    // seat keeps a null bot id. End reasons are unknown for these games.
    apply: async (db) => {
      const { rows: replays } = await db.query(
        `SELECT id, room_code, ruleset_version, format, hero_0_id, hero_1_id, winner, created_at, finished_at
         FROM replay_games
         WHERE status = 'ready' AND finished_at IS NOT NULL AND format IN ('cc', 'silver-age')
         ORDER BY finished_at, id`,
      );
      for (const replay of replays as Array<Record<string, unknown>>) {
        const replayId = String(replay.id);
        const { rows: participants } = await db.query(
          `SELECT p.seat, p.user_id, u.username FROM replay_participants p
           JOIN users u ON u.id = p.user_id WHERE p.replay_id = $1`,
          [replayId],
        );
        const bySeat = new Map<number, { userId: number; username: string }>();
        for (const row of participants as Array<Record<string, unknown>>) {
          bySeat.set(Number(row.seat), { userId: Number(row.user_id), username: String(row.username) });
        }
        if (bySeat.size === 0) continue;
        const winner = replay.winner === null ? null : Number(replay.winner);
        const mode = bySeat.size === 2 ? "pvp" : "bot";
        const existing = await db.query(
          "SELECT id FROM matches WHERE room_code = $1 AND started_at = $2",
          [String(replay.room_code), Number(replay.created_at)],
        );
        if (existing.rows.length) continue;
        await db.query(
          `INSERT INTO matches
             (id, room_code, format, ruleset_version, mode, winner, end_reason, started_at, finished_at, replay_id)
           VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8, $1)`,
          [
            replayId, String(replay.room_code), String(replay.format), String(replay.ruleset_version),
            mode, winner, Number(replay.created_at), Number(replay.finished_at),
          ],
        );
        const heroIds = [String(replay.hero_0_id), String(replay.hero_1_id)] as const;
        for (const seat of [0, 1] as const) {
          const human = bySeat.get(seat);
          await db.query(
            `INSERT INTO match_participants
               (match_id, seat, controller, user_id, username, bot_id, hero_id, deck_name)
             VALUES ($1, $2, $3, $4, $5, NULL, $6, NULL)`,
            [replayId, seat, human ? "human" : "bot", human?.userId ?? null, human?.username ?? null, heroIds[seat]],
          );
        }
        for (const seat of [0, 1] as const) {
          const human = bySeat.get(seat);
          if (!human) continue;
          const opponentKind = bySeat.has(1 - seat) ? "player" : "bot";
          const column = winner === null ? "ended" : winner === seat ? "wins" : "losses";
          await db.query(
            `INSERT INTO hero_records
               (user_id, hero_id, opponent_kind, format, games, ${column}, last_played_at)
             VALUES ($1, $2, $3, $4, 1, 1, $5)
             ON CONFLICT (user_id, hero_id, opponent_kind, format) DO UPDATE SET
               games = hero_records.games + 1,
               ${column} = hero_records.${column} + 1,
               last_played_at = GREATEST(hero_records.last_played_at, EXCLUDED.last_played_at)`,
            [human.userId, heroIds[seat], opponentKind, String(replay.format), Number(replay.finished_at)],
          );
          if (column === "ended") continue;
          await db.query(
            `INSERT INTO matchup_records
               (user_id, hero_id, opponent_hero_id, opponent_kind, format, games, ${column})
             VALUES ($1, $2, $3, $4, $5, 1, 1)
             ON CONFLICT (user_id, hero_id, opponent_hero_id, opponent_kind, format) DO UPDATE SET
               games = matchup_records.games + 1,
               ${column} = matchup_records.${column} + 1`,
            [human.userId, heroIds[seat], heroIds[1 - seat], opponentKind, String(replay.format)],
          );
        }
      }
    },
  },
  {
    version: 47,
    // Retire Classic Battles. Its queue entries, rooms, replays, and lock row
    // are deleted; room deletion cascades to seats, history, presence,
    // commands, offers, and entries retaining those rooms. Bug reports,
    // achievements, cluster events, and anonymous analytics keep their
    // historical rows. The per-seat box-hero columns are dropped, and format
    // checks narrow to the constructed formats. Inline checks are named
    // `<table>_format_check` by PostgreSQL and `<table>_constraint_1` by
    // pg-mem; dropping both conditionally keeps the schemas in lockstep.
    sql: `DELETE FROM matchmaking_entries WHERE format = 'classic-battles';
    DELETE FROM rooms WHERE format = 'classic-battles';
    DELETE FROM replay_games WHERE format = 'classic-battles';
    DELETE FROM matchmaking_locks WHERE format = 'classic-battles';
    ALTER TABLE room_seats DROP COLUMN hero;
    ALTER TABLE matchmaking_entries DROP COLUMN hero;
    ALTER TABLE rooms
      ADD CONSTRAINT rooms_format_check CHECK (format IN ('cc', 'silver-age'));
    ALTER TABLE replay_games DROP CONSTRAINT IF EXISTS replay_games_format_check;
    ALTER TABLE replay_games DROP CONSTRAINT IF EXISTS replay_games_constraint_1;
    ALTER TABLE replay_games
      ADD CONSTRAINT replay_games_format_check CHECK (format IN ('cc', 'silver-age'));
    ALTER TABLE matchmaking_locks DROP CONSTRAINT IF EXISTS matchmaking_locks_format_check;
    ALTER TABLE matchmaking_locks DROP CONSTRAINT IF EXISTS matchmaking_locks_constraint_1;
    ALTER TABLE matchmaking_locks
      ADD CONSTRAINT matchmaking_locks_format_check CHECK (format IN ('cc', 'silver-age'));
    ALTER TABLE matchmaking_entries DROP CONSTRAINT IF EXISTS matchmaking_entries_format_check;
    ALTER TABLE matchmaking_entries DROP CONSTRAINT IF EXISTS matchmaking_entries_constraint_1;
    ALTER TABLE matchmaking_entries
      ADD CONSTRAINT matchmaking_entries_format_check CHECK (format IN ('cc', 'silver-age'));`,
  },
  {
    version: 48,
    // Operator-only conduct reports, filed against a game opponent or from a
    // friend chat. A game report's subject is resolved from the room's seats,
    // never from client input, and is unique per reporter, opponent, and room
    // so resubmission is idempotent; rooms are garbage-collected, so the code
    // and version are kept without a key. Chat reports have no room. Friend
    // messages expire and are deleted with the friendship, so a report the
    // reporter chose to attach the conversation to keeps its own copy.
    sql: `CREATE TABLE player_reports (
      id TEXT PRIMARY KEY,
      reporter_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reported_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source TEXT NOT NULL,
      room_code TEXT,
      room_version BIGINT,
      reason TEXT NOT NULL,
      details VARCHAR(500) NOT NULL DEFAULT '',
      chat_history JSONB,
      created_at BIGINT NOT NULL,
      CONSTRAINT player_reports_once UNIQUE (reporter_user_id, reported_user_id, room_code),
      CONSTRAINT player_reports_reason_check CHECK (
        (source = 'game' AND room_code IS NOT NULL AND room_version IS NOT NULL
          AND reason IN ('stalling', 'emote-spam', 'offensive-name', 'cheating', 'other'))
        OR (source = 'chat' AND room_code IS NULL AND room_version IS NULL
          AND reason IN ('harassment', 'spam', 'offensive-name', 'other'))
      )
    );
    CREATE INDEX player_reports_reported_idx ON player_reports (reported_user_id, created_at);`,
  },
  {
    version: 49,
    // Matchmaking pairs searches in the stricter of their card pools, so a
    // queued seat remembers the pool its player chose. A survivor requeued
    // after its opponent leaves resumes that search. NULL marks seats taken
    // outside matchmaking, which keep the room's pool.
    sql: `ALTER TABLE room_seats ADD COLUMN queue_card_pool_mode TEXT
      CHECK (queue_card_pool_mode IS NULL OR queue_card_pool_mode IN ('legal', 'future', 'open'));`,
  },
  {
    version: 50,
    // A participant may share their own seat-perspective replay copy through
    // an unguessable link. The token is a read-only capability for one copy,
    // kept raw so the owner can copy the link again. Friends-only links also
    // require a live friendship at read time. The share belongs to the copy:
    // deletion, expiry sweeps, and account deletion cascade through it.
    sql: `CREATE TABLE replay_shares (
      replay_id TEXT NOT NULL,
      owner_user_id INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      visibility TEXT NOT NULL CHECK (visibility IN ('public', 'friends')),
      include_notes BOOLEAN NOT NULL DEFAULT FALSE,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (replay_id, owner_user_id),
      FOREIGN KEY (replay_id, owner_user_id)
        REFERENCES replay_participants(replay_id, user_id) ON DELETE CASCADE
    );`,
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
