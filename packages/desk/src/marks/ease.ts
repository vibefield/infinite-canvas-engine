// The two easings the marks move on (DESIGN.md §6 by name; *Marks on the Mat*'s chrome.js `easeLift` /
// `easeIsland`, number for number): `--vf-ease-lift` cubic-bezier(0.2, 0.9, 0.3, 1.2) — the lock-on's
// arrival and the tape's press, with a slight overshoot — and `--vf-ease-island` cubic-bezier(0.25, 1,
// 0.3, 1) — the vellum's fold. A CSS cubic-bezier solved for x by eight Newton steps, as the page does.

const clamp01 = (x: number): number => Math.min(Math.max(x, 0), 1);

function bezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  let t = x;
  for (let i = 0; i < 8; i++) {
    const cx = 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t * t * (1 - t) + t ** 3 - x;
    const dx = 3 * x1 * (1 - t) ** 2 + 6 * (x2 - x1) * t * (1 - t) + 3 * (1 - x2) * t * t;
    if (Math.abs(dx) < 1e-6) break;
    t = clamp01(t - cx / dx);
  }
  return 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t * t * (1 - t) + t ** 3;
}

/** `--vf-ease-lift`: cubic-bezier(0.2, 0.9, 0.3, 1.2) — overshoots past 1 on the way. */
export const easeLift = (x: number): number => bezier(0.2, 0.9, 0.3, 1.2, x);
/** `--vf-ease-island`: cubic-bezier(0.25, 1, 0.3, 1). */
export const easeIsland = (x: number): number => bezier(0.25, 1, 0.3, 1, x);
