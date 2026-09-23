// CPU mirror of the frame shader's distance functions — identical maths, used
// for hit-testing and by the tests. It takes the same resolved geometry the GPU
// is handed, so what you click is what is drawn, mid-animation included.
// (Lineage: research/sdf-card/src/sdf.js; the notched corners before the socket.)

import type { Geometry } from "./choreography";

const hypot = Math.hypot;

export const sdRoundBox = (px: number, py: number, bx: number, by: number, r: number): number => {
  const rr = Math.min(Math.max(r, 0), Math.min(bx, by));
  const qx = Math.abs(px) - bx + rr;
  const qy = Math.abs(py) - by + rr;
  return hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr;
};

// Exact circular fillets (Quilez). Exact when the operands are perpendicular
// half-planes; a plausible blend otherwise, which is what an ear meeting the
// ring's edge wants. The union form clamps its operands to ≥ -r so the fillet
// stays local in the interior.
export const opUnionRound = (a: number, b: number, r: number): number => {
  const m = Math.min(a, b);
  const A = Math.max(a, -r);
  const B = Math.max(b, -r);
  return Math.min(m, Math.max(r, Math.min(A, B)) - hypot(Math.max(r - A, 0), Math.max(r - B, 0)));
};
export const opIsectRound = (a: number, b: number, r: number): number =>
  Math.min(-r, Math.max(a, b)) + hypot(Math.max(r + a, 0), Math.max(r + b, 0));

/** A corner by index — TL 0 · TR 1 · BR 2 · BL 3. */
export type CornerIndex = 0 | 1 | 2 | 3;

/** The INNER boundary: the content's rounded rect, grown by the lift — negative inside. */
export const sdInner = (G: Geometry, wx: number, wy: number): number =>
  sdRoundBox(wx - G.centre[0], wy - G.centre[1], G.ih[0], G.ih[1], G.radius);

/** The OUTER silhouette: the socket's rounded rect, with each ear blended in by its fillet. */
export function sdOuter(G: Geometry, wx: number, wy: number): number {
  let d = sdRoundBox(wx - G.centre[0], wy - G.centre[1], G.half[0], G.half[1], G.outerR);
  for (let i = 0; i < 4; i++) {
    const r = G.earR[i] as number;
    if (r <= 0.001) continue;   // a corner without an ear costs a compare, and a point-sized ear must not bulge the corner
    d = opUnionRound(d, hypot(wx - (G.earX[i] as number), wy - (G.earY[i] as number)) - r, G.fillet[i] as number);
  }
  return d;
}

export const sdFrame = (G: Geometry, x: number, y: number): number => Math.max(sdOuter(G, x, y), -sdInner(G, x, y));

export type Hit = "lock" | "close" | "content" | "frame" | "outside";

/** What is under a world point. Routes by position, never by hover — touch has no hover. */
export function pick(G: Geometry, x: number, y: number): Hit {
  if (G.lockR > 0.05 && hypot(x - G.lockC[0], y - G.lockC[1]) - G.lockR < 0) return "lock";
  if (G.closeR > 0.05 && hypot(x - G.closeC[0], y - G.closeC[1]) - G.closeR < 0) return "close";
  if (sdInner(G, x, y) < 0) return "content";
  if (sdFrame(G, x, y) < 0) return "frame";
  return "outside";
}
