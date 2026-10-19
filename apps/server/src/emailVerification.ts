import { normalizeEmailAddress } from "@fyendal/protocol";
import type { Queryable } from "./db.js";
import { hashToken, newToken } from "./tokenHash.js";

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

export interface NormalizedEmail {
  email: string;
  emailLc: string;
}

export function normalizeEmail(input: string): NormalizedEmail | null {
  const email = normalizeEmailAddress(input);
  return email ? { email, emailLc: email.toLowerCase() } : null;
}

export interface PendingVerification {
  token: string;
  email: string;
  username: string;
}

/** Replace the account's pending address. Run inside the caller's transaction. */
export async function insertEmailVerification(
  tx: Queryable,
  userId: number,
  username: string,
  address: NormalizedEmail,
): Promise<PendingVerification> {
  const token = newToken();
  await tx.query("DELETE FROM email_verifications WHERE user_id = $1", [userId]);
  await tx.query(
    `INSERT INTO email_verifications (token_hash, user_id, email, email_lc, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [hashToken(token), userId, address.email, address.emailLc, Date.now() + VERIFICATION_TTL_MS],
  );
  return { token, email: address.email, username };
}
