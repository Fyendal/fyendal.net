interface PitchCandidate {
  instanceId: number;
  value: number;
}

/**
 * Enumerate ordered pitch sequences that first cover `required` on their last
 * card. A sequence may float resources, but it may never contain a card after
 * the running pool has already covered the payment.
 *
 * Shorter sequences are returned first. Different orders are significant:
 * pitching 1 then 3 to pay 3 is legal, while pitching 3 then 1 is not.
 */
export function enumeratePitchSequences(
  candidates: readonly PitchCandidate[],
  available: number,
  required: number,
  maxResults: number,
): number[][] {
  if (available >= required) return [[]];
  if (maxResults <= 0) return [];

  const results: number[][] = [];
  const valuesDescending = candidates.map((candidate) => candidate.value).sort((a, b) => b - a);
  for (let size = 1; size <= candidates.length; size++) {
    const maximumAtThisSize = valuesDescending
      .slice(0, size)
      .reduce((total, value) => total + value, available);
    if (maximumAtThisSize < required) continue;

    const collect = (
      picked: number[],
      used: Set<number>,
      running: number,
    ): void => {
      if (results.length >= maxResults || running >= required) return;
      if (picked.length === size) return;

      for (const candidate of candidates) {
        if (used.has(candidate.instanceId)) continue;
        const nextRunning = running + candidate.value;
        const nextPicked = [...picked, candidate.instanceId];
        if (nextPicked.length === size) {
          if (nextRunning >= required) results.push(nextPicked);
        } else if (nextRunning < required) {
          used.add(candidate.instanceId);
          collect(nextPicked, used, nextRunning);
          used.delete(candidate.instanceId);
        }
        if (results.length >= maxResults) return;
      }
    };

    collect([], new Set(), available);
    if (results.length >= maxResults) break;
  }
  return results;
}
