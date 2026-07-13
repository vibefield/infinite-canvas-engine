/**
 * CSS-style cubic-bezier timing functions (pure math — kernel).
 *
 * `cubicBezierEase(x1, y1, x2, y2)` builds f(t): the exact curve CSS
 * `transition-timing-function: cubic-bezier(…)` runs, so GL surfaces can
 * match DOM transitions beat-for-beat (the composite-quad lift mirrors the
 * DOM card lift's spring, cubic-bezier(0.2, 0.9, 0.3, 1.2)). y outside [0,1]
 * (overshoot springs) is legal and expected; x1/x2 are clamped to [0,1] per
 * spec so x(u) stays monotone and invertible.
 */

/** Bernstein sample with P0=0, P3=1 (one axis of the timing curve). */
function sample(u: number, p1: number, p2: number): number {
  const v = 1 - u;
  return 3 * v * v * u * p1 + 3 * v * u * u * p2 + u * u * u;
}

export function cubicBezierEase(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx1 = Math.min(1, Math.max(0, x1));
  const cx2 = Math.min(1, Math.max(0, x2));
  const sampleDx = (u: number): number => {
    const v = 1 - u;
    return 3 * v * v * cx1 + 6 * v * u * (cx2 - cx1) + 3 * u * u * (1 - cx2);
  };

  return (t: number): number => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    // Solve x(u) = t: Newton first (fast for well-behaved curves)…
    let u = t;
    for (let i = 0; i < 8; i++) {
      const err = sample(u, cx1, cx2) - t;
      if (Math.abs(err) < 1e-6) return sample(u, y1, y2);
      const d = sampleDx(u);
      if (d < 1e-6) break; // flat spot — Newton would explode
      u = Math.min(1, Math.max(0, u - err / d));
    }
    // …bisection fallback (x is monotone under the clamp).
    let lo = 0;
    let hi = 1;
    u = t;
    while (hi - lo > 1e-6) {
      if (sample(u, cx1, cx2) < t) lo = u;
      else hi = u;
      u = (lo + hi) / 2;
    }
    return sample(u, y1, y2);
  };
}
