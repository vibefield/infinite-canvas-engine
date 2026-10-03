// A kind's entry in a slot made the MISSING face's (petition I24) — shared by the ground's slots (the root's, the pool's) and the
// tray's, so a quarantine reaches every slot that holds the kind's pass.

import type { KindPass } from "../kind";
import type { SlotKind, SlotSet } from "../ground";
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
