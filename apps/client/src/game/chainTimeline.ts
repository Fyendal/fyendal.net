import type { ChainLinkView } from "@fyendal/shared";

/**
 * Changes whenever the timeline gets a new current position. Combat resolution
 * matters here even though it does not change the number of recorded links:
 * resolving the newest link creates the empty, waiting position after it.
 */
export function chainTimelineRevision(links: readonly ChainLinkView[]): string {
  const newest = links.at(-1);
  return [
    links.length,
    newest?.attackingCard.instanceId ?? "none",
    newest?.resolved === true ? "resolved" : "open",
  ].join(":");
}
