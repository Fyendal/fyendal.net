import { timingSafeEqual } from "node:crypto";
import type { KofiWebhook } from "@fyendal/protocol";
import { withTransaction, type Queryable } from "./db.js";
import { normalizeEmail } from "./emailVerification.js";

/** A monthly renewal plus a few days' grace for late card retries. */
export const SUPPORTER_WINDOW_MS = 35 * 24 * 60 * 60 * 1000;

export function kofiTokenMatches(expected: string, received: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type KofiPaymentResult = "recorded" | "duplicate" | "ignored";

/** Records a monthly Ko-fi payment and extends every account whose recovery
 * email matches the payer. Other payment kinds carry no entitlement. */
export async function recordKofiPayment(
  db: Queryable,
  payment: KofiWebhook,
  now = Date.now(),
): Promise<KofiPaymentResult> {
  if (payment.type !== "Subscription" || !payment.isSubscriptionPayment) return "ignored";
  const address = normalizeEmail(payment.email);
  if (!address) return "ignored";
  const parsed = Date.parse(payment.timestamp);
  const paidAt = Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, now) : now;
  if (paidAt <= now - SUPPORTER_WINDOW_MS) return "ignored";
  const until = paidAt + SUPPORTER_WINDOW_MS;
  return withTransaction(db, async (tx) => {
    await tx.query("DELETE FROM kofi_subscription_payments WHERE paid_at <= $1", [now - SUPPORTER_WINDOW_MS]);
    const inserted = await tx.query(
      `INSERT INTO kofi_subscription_payments (transaction_id, email_lc, paid_at, tier_name)
       VALUES ($1, $2, $3, $4) ON CONFLICT (transaction_id) DO NOTHING`,
      [payment.transactionId, address.emailLc, paidAt, payment.tierName],
    );
    if (!inserted.rowCount) return "duplicate";
    // A newly entitled account with no badge chosen starts showing this one.
    await tx.query(
      `UPDATE users SET
         selected_badge = CASE
           WHEN selected_badge IS NULL AND COALESCE(supporter_until, 0) <= $3 THEN 'supporter'
           ELSE selected_badge END,
         supporter_until = $2
       WHERE email_lc = $1 AND COALESCE(supporter_until, 0) < $2`,
      [address.emailLc, until, now],
    );
    return "recorded";
  });
}

/** Re-derive the cached entitlement after the account's recovery email changes. */
export async function refreshSupporterStatus(tx: Queryable, userId: number, now = Date.now()): Promise<void> {
  const { rows: users } = await tx.query("SELECT email_lc FROM users WHERE id = $1", [userId]);
  const emailLc = users[0]?.email_lc;
  let until: number | null = null;
  if (typeof emailLc === "string") {
    const { rows } = await tx.query(
      "SELECT MAX(paid_at) AS paid_at FROM kofi_subscription_payments WHERE email_lc = $1",
      [emailLc],
    );
    const paidAt = rows[0]?.paid_at;
    if (paidAt != null && Number(paidAt) + SUPPORTER_WINDOW_MS > now) until = Number(paidAt) + SUPPORTER_WINDOW_MS;
  }
  await tx.query("UPDATE users SET supporter_until = $2 WHERE id = $1", [userId, until]);
}

export function supporterActive(supporterUntil: unknown, now = Date.now()): boolean {
  return supporterUntil != null && Number(supporterUntil) > now;
}

export async function exportKofiPayments(
  db: Queryable,
  userId: number,
): Promise<Array<{ paidAt: number; tierName: string | null }>> {
  const { rows } = await db.query(
    `SELECT k.paid_at, k.tier_name FROM kofi_subscription_payments k
     JOIN users u ON u.email_lc = k.email_lc
     WHERE u.id = $1 ORDER BY k.paid_at, k.transaction_id`,
    [userId],
  );
  return rows.map((row) => ({
    paidAt: Number(row.paid_at),
    tierName: typeof row.tier_name === "string" ? row.tier_name : null,
  }));
}

/** Drops payments for an address that no remaining account uses. Run after
 * the account row is gone, inside the deletion transaction. */
export async function deleteOrphanedKofiPayments(tx: Queryable, emailLc: string | null): Promise<void> {
  if (emailLc === null) return;
  const { rows } = await tx.query("SELECT 1 FROM users WHERE email_lc = $1 LIMIT 1", [emailLc]);
  if (rows.length === 0) await tx.query("DELETE FROM kofi_subscription_payments WHERE email_lc = $1", [emailLc]);
}
