// The mouse follower behind the projector's tilt: the reference's
// SecondOrderDynamics (f 1 Hz · ζ 0.3 · r 2), a second-order filter that also
// feeds the target's velocity forward — the tilt leads the pointer a little
// and rings once. Two channels, pure, stepped per frame by the host; the
// engine only ever sees the resulting matrix.
// (research/tree-shadow/prototype/src/gobo.js, transcribed.)

export interface SecondOrder {
  readonly k1: number; readonly k2: number; readonly k3: number;
  readonly w: number; readonly z: number; readonly d: number;
  target: [number, number];
  prevTarget: [number, number];
  value: [number, number];
  velocity: [number, number];
}

export function secondOrder(f = 1, z = 0.3, r = 2, value: readonly [number, number] = [0, 0]): SecondOrder {
  const w = Math.PI * 2 * f;
  return {
    k1: z / (Math.PI * f), k2: 1 / (w * w), k3: (r * z) / w,
    w, z, d: w * Math.sqrt(Math.abs(z * z - 1)),
    target: [value[0], value[1]], prevTarget: [value[0], value[1]], value: [value[0], value[1]], velocity: [0, 0],
  };
}

export function stepSecondOrder(s: SecondOrder, dt: number): void {
  if (dt <= 0) return;
  const tv: [number, number] = [(s.target[0] - s.prevTarget[0]) / dt, (s.target[1] - s.prevTarget[1]) / dt];
  s.prevTarget = [s.target[0], s.target[1]];
  let k1: number;
  let k2: number;
  if (s.w * dt < s.z) {
    k1 = s.k1;
    k2 = Math.max(s.k2, (dt * dt) / 2 + (dt * s.k1) / 2, dt * s.k1);
  } else {
    const t = Math.exp(-s.z * s.w * dt);
    const i = 2 * t * (s.z <= 1 ? Math.cos(dt * s.d) : Math.cosh(dt * s.d));
    const rr = t * t;
    const o = dt / (1 + rr - i);
    k1 = (1 - rr) * o;
    k2 = dt * o;
  }
  for (const c of [0, 1] as const) {
    s.value[c] += s.velocity[c] * dt;
    s.velocity[c] += ((s.target[c] + tv[c] * s.k3 - s.value[c] - s.velocity[c] * k1) * dt) / k2;
  }
}
