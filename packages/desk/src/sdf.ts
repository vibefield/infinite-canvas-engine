// The desk's shared 2D distance — pure, no GPU: the CPU mirror of
// shaders/primitives.wgsl `sdf_round_box`, exact Euclidean, which every object's
// hit test and CPU mirror reads (the note, the whiteboard, the mini mat). It
// lived beside the card frame's mirror until the cards retired (2026-09-25).
// (Lineage: research/sdf-card/src/sdf.js.)

export const sdRoundBox = (px: number, py: number, bx: number, by: number, r: number): number => {
  const rr = Math.min(Math.max(r, 0), Math.min(bx, by));
  const qx = Math.abs(px) - bx + rr;
  const qy = Math.abs(py) - by + rr;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr;
};
