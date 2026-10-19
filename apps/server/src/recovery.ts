import { EMAIL_MAX_LENGTH } from "@fyendal/protocol";
import { createSession, hashPassword, passwordError, revokeAllSessionsIn, verifyPassword } from "./auth.js";
import { withTransaction, type Queryable } from "./db.js";
import { insertEmailVerification, type NormalizedEmail, type PendingVerification } from "./emailVerification.js";
import { hashToken, newToken } from "./tokenHash.js";

const RESET_TTL_MS = 30 * 60 * 1000;
/** Bounds the links in one reset email when many accounts share an address. */
const RESET_ACCOUNTS_MAX = 10;

export interface AccountEmail {
  email: string | null;
  pendingEmail: string | null;
}

export async function accountEmail(db: Queryable, userId: number): Promise<AccountEmail | null> {
  const { rows } = await db.query(
    `SELECT u.email, v.email AS pending_email FROM users u
     LEFT JOIN email_verifications v ON v.user_id = u.id AND v.expires_at > $2
     WHERE u.id = $1`,
    [userId, Date.now()],
  );
  if (!rows[0]) return null;
  return {
    email: typeof rows[0].email === "string" ? rows[0].email : null,
    pendingEmail: typeof rows[0].pending_email === "string" ? rows[0].pending_email : null,
  };
}

export type PasswordCheckedResult<T> =
  | { status: "ok"; value: T }
  | { status: "invalid-password" }
  | { status: "not-found" };

/** Verify the account password before any transaction opens, so the slow
 * KDF never holds a pooled connection or row lock. */
async function checkPassword(
  db: Queryable,
  userId: number,
  password: string,
): Promise<{ username: string; email: string | null } | "invalid-password" | "not-found"> {
  const { rows } = await db.query("SELECT username, pass_hash, email FROM users WHERE id = $1", [userId]);
  const user = rows[0];
  if (!user) return "not-found";
  if (!(await verifyPassword(password, String(user.pass_hash)))) return "invalid-password";
  return { username: String(user.username), email: typeof user.email === "string" ? user.email : null };
}

/** Password-confirmed request to verify a new recovery address. */
export async function requestEmailChange(
  db: Queryable,
  userId: number,
  password: string,
  address: NormalizedEmail,
): Promise<PasswordCheckedResult<{ pending: PendingVerification; email: string | null }>> {
  const user = await checkPassword(db, userId, password);
  if (typeof user === "string") return { status: user };
  const pending = await withTransaction(db, (tx) => insertEmailVerification(tx, userId, user.username, address));
  return { status: "ok", value: { pending, email: user.email } };
}

/** Password-confirmed removal of both the verified and any pending address. */
export async function removeEmail(
  db: Queryable,
  userId: number,
  password: string,
): Promise<PasswordCheckedResult<{ username: string; previousEmail: string | null }>> {
  const user = await checkPassword(db, userId, password);
  if (typeof user === "string") return { status: user };
  const previousEmail = await withTransaction(db, async (tx) => {
    const { rows } = await tx.query("SELECT email FROM users WHERE id = $1 FOR UPDATE", [userId]);
    await tx.query("UPDATE users SET email = NULL, email_lc = NULL WHERE id = $1", [userId]);
    await tx.query("DELETE FROM email_verifications WHERE user_id = $1", [userId]);
    await tx.query("DELETE FROM password_resets WHERE user_id = $1", [userId]);
    return typeof rows[0]?.email === "string" ? rows[0].email : null;
  });
  return { status: "ok", value: { username: user.username, previousEmail } };
}

/** Consume a verification link. Outstanding reset links are dropped because
 * they were addressed to the previous recovery address. Returns the replaced
 * verified address, when it differs, so it can be notified. */
export async function confirmEmailVerification(
  db: Queryable,
  token: string,
): Promise<{ username: string; previousEmail: string | null } | null> {
  if (!token) return null;
  return withTransaction(db, async (tx) => {
    const { rows } = await tx.query(
      `DELETE FROM email_verifications WHERE token_hash = $1
       RETURNING user_id, email, email_lc, expires_at`,
      [hashToken(token)],
    );
    const pending = rows[0];
    if (!pending || Number(pending.expires_at) <= Date.now()) return null;
    const userId = Number(pending.user_id);
    const { rows: users } = await tx.query(
      "SELECT username, email, email_lc FROM users WHERE id = $1 FOR UPDATE",
      [userId],
    );
    const user = users[0];
    if (!user) return null;
    await tx.query("UPDATE users SET email = $2, email_lc = $3 WHERE id = $1", [
      userId,
      pending.email,
      pending.email_lc,
    ]);
    await tx.query("DELETE FROM password_resets WHERE user_id = $1", [userId]);
    const previousLc = typeof user.email_lc === "string" ? user.email_lc : null;
    return {
      username: String(user.username),
      previousEmail: previousLc !== null && previousLc !== pending.email_lc ? String(user.email) : null,
    };
  });
}

export interface ResetDelivery {
  to: string;
  accounts: Array<{ username: string; token: string }>;
}

/** Issue reset links for a username or verified email. Returns null when
 * nothing matches; callers must answer identically either way. */
export async function requestPasswordReset(
  db: Queryable,
  identifier: string,
): Promise<ResetDelivery | null> {
  const value = identifier.trim().toLowerCase();
  if (!value || value.length > EMAIL_MAX_LENGTH) return null;
  const { rows } = value.includes("@")
    ? await db.query(
      "SELECT id, username, email FROM users WHERE email_lc = $1 ORDER BY id LIMIT $2",
      [value, RESET_ACCOUNTS_MAX],
    )
    : await db.query(
      "SELECT id, username, email FROM users WHERE username_lc = $1 AND email IS NOT NULL",
      [value],
    );
  const users = rows as Array<{ id: number; username: string; email: string }>;
  if (users.length === 0) return null;
  const now = Date.now();
  const accounts = users.map((user) => ({ userId: user.id, username: user.username, token: newToken() }));
  // One multi-row INSERT is atomic without an explicit transaction.
  await db.query(
    `INSERT INTO password_resets (token_hash, user_id, created_at, expires_at) VALUES ${
      accounts.map((_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`).join(", ")
    }`,
    accounts.flatMap((account) => [hashToken(account.token), account.userId, now, now + RESET_TTL_MS]),
  );
  return {
    to: users[0]!.email,
    accounts: accounts.map(({ username, token }) => ({ username, token })),
  };
}

export type ResetPasswordResult =
  | { ok: true; userId: number; username: string; token: string }
  | { ok: false; error: string };

/** Consume a reset link: set the password, revoke every session and other
 * reset link, and issue a fresh session for this browser. */
export async function resetPassword(
  db: Queryable,
  resetToken: string,
  password: string,
): Promise<ResetPasswordResult> {
  const invalidPassword = passwordError(password);
  if (invalidPassword) return { ok: false, error: invalidPassword };
  const invalidLink = { ok: false as const, error: "invalid or expired link" };
  if (!resetToken) return invalidLink;
  const tokenHash = hashToken(resetToken);
  const { rows: candidate } = await db.query(
    "SELECT expires_at FROM password_resets WHERE token_hash = $1",
    [tokenHash],
  );
  if (!candidate[0] || Number(candidate[0].expires_at) <= Date.now()) return invalidLink;
  // Hash outside the transaction: the KDF is slow and must not hold row locks.
  const passHash = await hashPassword(password);
  return withTransaction(db, async (tx) => {
    // Deleting the row claims the link, so a concurrent second use finds nothing.
    const { rows } = await tx.query(
      "DELETE FROM password_resets WHERE token_hash = $1 RETURNING user_id, expires_at",
      [tokenHash],
    );
    const claimed = rows[0];
    if (!claimed || Number(claimed.expires_at) <= Date.now()) return invalidLink;
    const userId = Number(claimed.user_id);
    const { rows: users } = await tx.query(
      "UPDATE users SET pass_hash = $2 WHERE id = $1 RETURNING username",
      [userId, passHash],
    );
    if (!users[0]) return invalidLink;
    await tx.query("DELETE FROM password_resets WHERE user_id = $1", [userId]);
    await revokeAllSessionsIn(tx, userId);
    const token = await createSession(tx, userId);
    return { ok: true as const, userId, username: String(users[0].username), token };
  });
}

/** Delete expired verification and reset links. */
export async function sweepRecoveryTokens(db: Queryable, now = Date.now()): Promise<number> {
  const verifications = await db.query("DELETE FROM email_verifications WHERE expires_at <= $1", [now]);
  const resets = await db.query("DELETE FROM password_resets WHERE expires_at <= $1", [now]);
  return (verifications.rowCount ?? 0) + (resets.rowCount ?? 0);
}
