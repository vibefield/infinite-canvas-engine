/** Deterministic LCG for property tests (no Date/Math.random — reproducible). */
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
