import { decodeVersionUpdateNotice } from "@fyendal/protocol";
import type { VersionUpdateNotice } from "@fyendal/shared";
import type { Queryable } from "./db.js";

export async function getVersionUpdateNotice(db: Queryable): Promise<VersionUpdateNotice | null> {
  const { rows } = await db.query("SELECT notice FROM version_update_notice WHERE singleton = TRUE");
  if (!rows[0]) return null;
  const raw: unknown = rows[0].notice;
  const notice = decodeVersionUpdateNotice(raw);
  if (!notice) throw new Error("Invalid stored version update notice");
  return notice;
}
