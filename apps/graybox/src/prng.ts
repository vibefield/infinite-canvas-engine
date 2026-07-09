/**
 * Deterministic LCG — mirrors packages/kernel/test/prng.ts so the demo scene is
 * reproducible run-to-run (NO Date/Math.random: the churn-budget numbers must be
 * comparable across measurement runs).
 */
export function makePrng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export function inRange(rand: () => number, min: number, max: number): number {
  return min + rand() * (max - min);
}
