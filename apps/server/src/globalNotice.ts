import { decodeGlobalNotice } from "@fyendal/protocol";
import type { GlobalNotice } from "@fyendal/shared";
import type { Queryable } from "./db.js";

export async function getGlobalNotice(db: Queryable, now = Date.now()): Promise<GlobalNotice | null> {
  const { rows } = await db.query("SELECT notice FROM global_notice WHERE singleton = TRUE");
  if (rows.length === 0) return null;
  const raw: unknown = rows[0].notice;
  const notice = decodeGlobalNotice(raw);
  if (!notice) throw new Error("Invalid stored global notice");
  return notice.expiresAt !== null && notice.expiresAt <= now ? null : notice;
}
