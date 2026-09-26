// THE LAMP over the desk (design-015 §2 — the gobo projector as a light every kind's shadow falls from). It lived in
// paper/paper.ts as the note's first light; every kind's geometry takes it (the builder hands it to each resolve), so it is the
// MAT's — moved here at D7 #5 (D-D7-A.3): the builder may not import a kind's module for what belongs to the desk.

import { HERO_PROJECTOR, type ProjectorSpec } from "./projector";

/** The lamp over the desk in WORLD units: where it stands on the plane, and how high above it. */
export interface Lamp { readonly x: number; readonly y: number; readonly h: number }

/** The gobo projector as a lamp on the world plane (mat.wgsl `desk_of` inverted: world = (desk − origin) / metresPerUnit). */
export function lampOf(plane: { readonly originX: number; readonly originZ: number; readonly metresPerUnit: number; readonly deskY: number }, p: ProjectorSpec = HERO_PROJECTOR): Lamp {
  const m = plane.metresPerUnit;
  return { x: (p.position[0] - plane.originX) / m, y: (p.position[2] - plane.originZ) / m, h: (p.position[1] - plane.deskY) / m };
}
