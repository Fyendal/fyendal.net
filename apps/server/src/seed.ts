/** Create the local accounts used by manual testing and lobby smoke checks. */
import { hashPassword } from "./auth.js";
import { createPool } from "./db.js";
import { assertSafeToSeed } from "./seedGuard.js";

assertSafeToSeed();

const PASSWORD = "password123";
const USERS = ["alice", "bob", "charlie", "diana"];

const pool = await createPool();
try {
  for (const username of USERS) {
    const { rows } = await pool.query(
      `INSERT INTO users (username, username_lc, pass_hash, created_at)
       VALUES ($1, $1, $2, $3)
       ON CONFLICT (username_lc) DO NOTHING
       RETURNING id`,
      [username, await hashPassword(PASSWORD), Date.now()],
    );
    console.log(rows.length > 0 ? `seeded ${username}` : `${username} already exists — skipped`);
  }
  console.log(`test login: alice / ${PASSWORD} (also bob, charlie, diana)`);
} finally {
  await pool.end();
}
