// A kind's entry in a slot made the MISSING face's (petition I24) — shared by the ground's slots (the root's, the pool's) and the
// tray's, so a quarantine reaches every slot that holds the kind's pass.

import type { KindPass } from "../kind";
import type { CuttingMat } from "../mat/mat-pass";
import type { SlotKind, SlotSet } from "../ground";
import { MISSING_KIND } from "./object";
import type { MissingFaces } from "./pass";

/**
 * Kind `name`'s entry in `s` becomes the desk's missing faces on the slot's mat (`faces` — the root's), under the kind's name and
 * stratum. Returns the pass the entry held (the caller lets it go), or undefined when the slot holds no such kind, or the desk no faces.
 */
export function swapToMissing(s: SlotSet, name: string, faces: MissingFaces | undefined): KindPass | undefined {
  const k = s.kinds.get(name);
  if (k === undefined || faces === undefined) return undefined;
  (s.kinds as Map<string, SlotKind>).set(name, { name, stratum: k.stratum, pass: faces.spawn(s.mat) });
  return k.pass;
}

/**
 * `k`'s pass for a new slot on `mat` — a mini mat's inside, a departed desk, a tray specimen — its own `spawn`, inside the kind boundary
 * (M24 LT3, `RenderBoundary`): one that throws is the kind's (a strike once the frame is done), and the slot draws its objects in the
 * desk's missing face (`root.missing`); a slot is reused frame after frame, so its spawn is not asked again. With no boundary, or no
 * faces to draw instead, the throw is the caller's, as before.
 */
export function spawnInside(root: SlotSet, k: SlotKind, mat: CuttingMat): KindPass {
  const b = root.boundary;
  if (b === undefined || root.missing === undefined || k.name === MISSING_KIND) return k.pass.spawn(mat);
  try { return k.pass.spawn(mat); } catch (err) { b.threw(k.name, "spawn", err); return root.missing.spawn(mat); }
}
