// A CONTAINER's inside, as the contract names it (design-015 §5.2 `chip` · `InsideContext`; moved here from minimat/ at
// K4a, design-016 §5): the view a host has of the desk a container holds — its embedding, the camera it renders under,
// its face on screen, the gate's answer — and a child as that face's far LOD draws it (a CHIP). The mini mat is the
// container that makes them (minimat/inside.ts, `chipOf`); the builder hands them to a kind's `record` and `chip`. Pure
// types: the contract (kinds/world.ts) names them, so they live where no kind folder is imported to reach them.

import type { Box } from "../lattice/lod";
import type { CameraState, PortalAffine } from "../nav/flight";
import type { PortalClip } from "../nav/portal";
import type { RGB } from "../theme";

/** A container's inside under the host camera (MINIMAT.md §3–§5): what `insideView` answers — ALWAYS, past the gate or not. */
export interface InsideView {
  /** The embedding: inside → host (`host = o + inside · s`) — the flight's own. */
  readonly M: PortalAffine;
  /** The inside's arrival camera — what its lattice is DRESSED for (PORTAL.md §9). */
  readonly arrival: CameraState;
  /** The camera the inside renders under at the host's camera: the enter flight's c0 at the cut. */
  readonly cam: CameraState;
  /** The face on screen: the live inside's clip. */
  readonly clip: PortalClip;
  /** The gate's answer (0..1): the live inside's presence — 0 = the face is the far LOD alone. */
  readonly presence: number;
  /** The live inside's box on the attachment. */
  readonly box: Box;
}

/** What a child is, to the face that draws it small: a sheet of paper (a note), or a mini mat of its own. */
export type ChipKind = "paper" | "mat";

/** One child as the face's far LOD draws it, in the CHILD's frame (the inside's world). */
export interface ChildShape {
  readonly kind: ChipKind;
  readonly cx: number; readonly cy: number;
  /** Half extents, the tilt (radians), the corner radius — the child's own. */
  readonly hx: number; readonly hy: number;
  readonly angle: number;
  readonly radius: number;
  /** Its colour: the paper's, or the vinyl's. */
  readonly colour: RGB;
  /** How far it stands off the face, child units — what its contact shadow is cast from. */
  readonly height: number;
  /** A note's writing, GREEKED: the pen's colour, the text's left edge and em (note units from the sheet's top-left), and each line's baseline and width. */
  readonly writing?: { readonly ink: RGB; readonly x0: number; readonly em: number; readonly lines: readonly { readonly y: number; readonly width: number }[] } | undefined;
  /** A mini mat's printed border, child units. */
  readonly margin?: number | undefined;
}

