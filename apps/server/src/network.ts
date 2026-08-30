import { isIP } from "node:net";
import type { IncomingHttpHeaders } from "node:http";

function normalizeIp(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const unwrapped = trimmed.startsWith("[") && trimmed.endsWith("]")
    ? trimmed.slice(1, -1)
    : trimmed;
  const normalized = unwrapped.startsWith("::ffff:") ? unwrapped.slice(7) : unwrapped;
  return isIP(normalized) ? normalized : null;
}

/**
 * Resolve the client address by peeling a configured number of trusted proxy
 * hops from the right side of X-Forwarded-For plus the direct socket peer.
 * With zero trusted hops, forwarded headers are ignored completely.
 */
export function clientIp(
  headers: IncomingHttpHeaders,
  remoteAddress: string | undefined,
  trustedProxyHops: number,
): string {
  const remote = normalizeIp(remoteAddress);
  const hops = Number.isSafeInteger(trustedProxyHops) && trustedProxyHops > 0
    ? trustedProxyHops
    : 0;
  if (hops === 0) return remote ?? "unknown";

  const raw = headers["x-forwarded-for"];
  const forwarded = (Array.isArray(raw) ? raw.join(",") : raw ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  // Keep invalid entries in the chain so an attacker cannot change which hop
  // is selected merely by inserting malformed values to the left.
  const chain = [...forwarded, remoteAddress ?? ""];
  const clientIndex = chain.length - 1 - hops;
  return clientIndex >= 0 ? normalizeIp(chain[clientIndex]) ?? remote ?? "unknown" : remote ?? "unknown";
}

export function configuredTrustedProxyHops(value = process.env.TRUSTED_PROXY_HOPS): number {
  const parsed = Number(value ?? 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}
