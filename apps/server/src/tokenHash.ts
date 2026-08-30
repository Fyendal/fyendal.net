import { createHash } from "node:crypto";

/** Hash an opaque credential before it crosses a persistence boundary. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
