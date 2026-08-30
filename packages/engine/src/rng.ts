/**
 * Deterministic seeded PRNG (mulberry32). All randomness in the engine flows
 * through these helpers; the numeric state lives on `GameState.rngState` so a
 * cloned state carries its RNG position with it.
 */

/** Anything carrying a mutable numeric rng state field (GameState qualifies). */
interface RngCarrier {
  rngState: number;
}

/** Advance the PRNG and return a float in [0, 1). */
export function rngNext(carrier: RngCarrier): number {
  carrier.rngState = (carrier.rngState + 0x6d2b79f5) | 0;
  let t = carrier.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Advance the PRNG and return an integer in [0, n). */
export function rngInt(carrier: RngCarrier, n: number): number {
  if (n <= 0) throw new Error("rngInt: n must be positive");
  return Math.floor(rngNext(carrier) * n);
}

/** In-place Fisher–Yates shuffle driven by the seeded PRNG. */
export function shuffleInPlace<T>(carrier: RngCarrier, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rngInt(carrier, i + 1);
    const a = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = a;
  }
  return arr;
}
