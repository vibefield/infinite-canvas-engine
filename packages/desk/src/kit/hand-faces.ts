// THE HAND'S FACES as a desk SERVICE (petition I59 — the desk's pen; K8a's open registry, kit/services.ts): the baked `ice-hand/1`
// atlases a host lends its kinds by the faces' names (`PEN_FACES` — `caveat`, `caveat-bold`, `kalam`), so every kind that writes —
// the note, a plugin's pad, the calendar's line — reads the SAME face, and the GPU holds one texture of it a desk
// (kit/hand-gpu.ts `handAtlasGpu`). A browser lends them by URL, fetched on the first ask (`handFaces`, the desk's host half —
// `deskLayer({ hand })` lends it and wakes the desk when a face lands); Node, the oracle and the tests lend atlases they hold
// (`handFacesOf`). A face that has not landed answers undefined: while it is on its way (`loading`) a sheet in it waits blank; one
// the desk does not lend, or that would not load, leaves the sheet its raster road.

import type { HandAtlas } from "./hand-atlas";
import { type ServiceKey, serviceKey } from "./services";

export interface HandFaces {
  /**
   * The face's atlas by its name (`PEN_FACES`'s), or undefined — while it loads (the first ask starts the load; `loading` says so),
   * when this desk lends no such face, or when the one it lends would not load. A sheet whose face is LOADING waits blank, as a
   * sheet waits for its font (never a stand-in hand that re-writes itself); one whose face is not lent, or failed, keeps its raster
   * road.
   */
  face(name: string): HandAtlas | undefined;
  /**
   * Is the face lent and still on its way — asked, or about to be (the first `face` ask starts it), and neither landed nor failed?
   * A kind's sheet in it waits blank meanwhile (petition I59 — the note's pen road). Absent (the faces a host holds, `handFacesOf`):
   * never — a face is there at once, or not lent.
   */
  loading?(name: string): boolean;
  /** Bumped whenever a face lands (or is found missing): every run built from a face is built again. */
  version(): number;
  /**
   * Tell `fn` whenever `version` moves — a face landed between frames (K7a: the desk wakes for it; `deskLayer({ hand })` is told).
   * Returns an unsubscribe. Absent (the in-memory faces): the version never moves on its own.
   */
  onVersion?(fn: () => void): () => void;
}

/** The hand's faces as a desk SERVICE (K8a): `host.use?.(HAND_FACES)` — lent by `deskLayer({ hand })`, or `service(HAND_FACES, …)`. */
export const HAND_FACES: ServiceKey<HandFaces> = serviceKey<HandFaces>("hand");

/** Faces a host already holds — Node, the oracle, a test: each name's atlas at once, the version never moving. */
export function handFacesOf(faces: Readonly<Record<string, HandAtlas>>): HandFaces {
  const table = new Map(Object.entries(faces));
  return { face: (name) => table.get(name), version: () => 0 };
}
