export type RecoveryRoute = "reset-password" | "verify-email";

/** Recovery email links open these full-page routes; neither collides with
 * the 6-character room-code pattern. */
export function recoveryRouteFromPath(path: string): RecoveryRoute | null {
  const match = /^\/(reset-password|verify-email)\/?$/.exec(path);
  return match ? match[1] as RecoveryRoute : null;
}
