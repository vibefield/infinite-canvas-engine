// CPU mirror of the frame shader's distance functions — identical maths, used
// for hit-testing and by the tests. It takes the same resolved geometry the GPU
// is handed, so what you click is what is drawn, mid-animation included.
// (Lineage: research/sdf-card/src/sdf.js.)

import type { Geometry } from "./choreography";

const hypot = Math.hypot;

export const sdRoundBox = (px: number, py: number, bx: number, by: number, r: number): number => {
  const rr = Math.min(Math.max(r, 0), Math.min(bx, by));
  const qx = Math.abs(px) - bx + rr;
  const qy = Math.abs(py) - by + rr;
  return hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr;
};

// Exact circular fillets (Quilez). Exact when the operands are perpendicular
// half-planes — the condition the corner is built to satisfy. The union form
// clamps its operands to ≥ -r so the fillet stays local in the interior.
export const opUnionRound = (a: number, b: number, r: number): number => {
  const m = Math.min(a, b);
  const A = Math.max(a, -r);
  const B = Math.max(b, -r);
  return Math.min(m, Math.max(r, Math.min(A, B)) - hypot(Math.max(r - A, 0), Math.max(r - B, 0)));
};
export const opIsectRound = (a: number, b: number, r: number): number =>
  Math.min(-r, Math.max(a, b)) + hypot(Math.max(r + a, 0), Math.max(r + b, 0));

const SGN = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;   // TL TR BR BL
/** A corner by index — TL 0 · TR 1 · BR 2 · BL 3; a literal union so every `Corner4` read is exact. */
export type CornerIndex = 0 | 1 | 2 | 3;

/** One corner's constraint region of the WELL: its quadrant, minus its bay's notch. */
export function cornerSd(G: Geometry, wx: number, wy: number, i: CornerIndex): number {
  const [whx, why] = G.wellHalf;
  const sg = SGN[i];
  const ux = (wx - G.centre[0]) * sg[0];
  const uy = (wy - G.centre[1]) * sg[1];
  const bx = ux - whx;
  const by = uy - why;
  const dR = opIsectRound(bx, by, G.wellR);                   // the well's own rounded corner
  const nw = Math.min(Math.max(G.nw[i], 0), whx);
  const nh = Math.min(Math.max(G.nh[i], 0), why);
  if (!(nw > 0.001 && nh > 0.001)) return dR;
  const nx = ux - (whx - nw);
  const ny = uy - (why - nh);
  const dN = opIsectRound(-nx, -ny, G.rho[i]);
  // the rounded well ∩ the notched well — see frame.wgsl
  const din = Math.max(Math.max(opIsectRound(by, -dN, G.rf[i]), opIsectRound(bx, -dN, G.rf[i])), dR);
  if (din <= 0) return din;                                   // inside: the max form is exact
  const f1 = opIsectRound(by, nx, G.rf[i]);                   // outside: the min form is exact
  const f2 = opIsectRound(bx, ny, G.rf[i]);
  return Math.max(opUnionRound(f1, f2, G.rho[i]), dR);
}

/** The WELL: the recess around the content, its corners notched — negative inside. */
export function sdWell(G: Geometry, wx: number, wy: number): number {
  let d = cornerSd(G, wx, wy, 0);
  for (const i of [1, 2, 3] as const) d = Math.max(d, cornerSd(G, wx, wy, i));
  return d;
}

/** The INNER boundary: the content's rounded rect, scaled by the lift — negative inside. */
export const sdInner = (G: Geometry, wx: number, wy: number): number =>
  sdRoundBox(wx - G.centre[0], wy - G.centre[1], G.ih[0], G.ih[1], G.radius);

/** The OUTER silhouette: the plate's rounded rect. */
export const sdOuter = (G: Geometry, wx: number, wy: number): number =>
  sdRoundBox(wx - G.centre[0], wy - G.centre[1], G.half[0], G.half[1], G.outerR);

/** The frame — everything of the shell that is not the content: the plate's rim and the well. */
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
