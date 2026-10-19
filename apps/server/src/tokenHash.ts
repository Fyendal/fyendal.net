import { createHash, randomBytes } from "node:crypto";

/** Opaque 32-byte credential. Callers persist only `hashToken(token)`. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Hash an opaque credential before it crosses a persistence boundary. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
