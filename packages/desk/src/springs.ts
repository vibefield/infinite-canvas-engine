// A critically-damped-by-default spring, integrated on the CPU with substeps.
// Springs, not tweens: a target that flips mid-flight reverses from wherever
// the value IS, with no snap and no restart.
//
// And the desk's ONE physics for its objects: every object lifts off the mat on
// the same spring and brings its selection ring in on the same spring — the
// note, the notebook, the whiteboard, the mini mat. The numbers are the §7
// lift (`--vf-ease-lift`: 180 ms with a slight overshoot) and the old card's
// reveal, kept when the cards retired (2026-09-25).

export function spring(
  x0: number, v0: number, target: number,
  hz: number, damping: number, dt: number, substeps = 8,
): [number, number] {
  let x = x0;
  let v = v0;
  const w = 2 * Math.PI * hz;
  const h = Math.min(dt, 0.05) / substeps;
  for (let i = 0; i < substeps; i++) {
    v += (w * w * (target - x) - 2 * damping * w * v) * h;
    x += v * h;
  }
  return [x, v];
}

export function settled(x: number, v: number, target: number, eps = 1e-3): boolean {
  return Math.abs(x - target) < eps && Math.abs(v) < eps * 10;
}

/** The objects' springs: the hold's lift, and the selection ring's presence. */
export interface ObjectSprings {
  readonly liftHz: number; readonly liftDamp: number;
  readonly ringHz: number; readonly ringDamp: number;
}

export const SPRINGS: ObjectSprings = { liftHz: 4.5, liftDamp: 0.78, ringHz: 2.4, ringDamp: 1.0 };
