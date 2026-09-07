// A critically-damped-by-default spring, integrated on the CPU with substeps.
// Springs, not tweens: a target that flips mid-flight reverses from wherever
// the value IS, with no snap and no restart.

export function spring(
  x0: number, v0: number, target: number,
  hz: number, damping: number, dt: number, substeps = 8,
): [number, number] {
  const w = 2 * Math.PI * hz;
  const h = Math.min(dt, 0.05) / substeps;
  let x = x0;
  let v = v0;
  for (let i = 0; i < substeps; i++) {
    v += (w * w * (target - x) - 2 * damping * w * v) * h;
    x += v * h;
  }
  return [x, v];
}

export function settled(x: number, v: number, target: number, eps = 1e-3): boolean {
  return Math.abs(x - target) < eps && Math.abs(v) < eps * 10;
}
