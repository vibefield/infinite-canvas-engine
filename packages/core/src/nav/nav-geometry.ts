/**
 * The NAV GEOMETRY seam (design-015 §9; D2b) — the renderer as the authority on its
 * containers' DRAWN geometry, exactly as it is on picking (`framePick`, design-014 B3b).
 *
 * The cut is exact only on the face AS DRAWN. The desk resolves a mini mat's face through
 * its springs (a hover's rise, a hold's lift) and draws the live inside under the camera that
 * face implies; a flight that starts from the container's STATIC rect starts a different face
 * whenever a spring is not at rest, and the cut jumps. So the interaction stack carries a
 * second slot beside `framePick`: `navGeometry.current`, which the renderer fills at mount
 * and clears at dispose, and which core's nav — `enterContainer`/`exitTo`, the zoom-through,
 * the drop-into's affine — asks first. The answer is one `NavFace`: the face in the parent
 * frame's units, the inside's arrival camera, the embedding `M` (inside → parent), the camera
 * the inside renders under at the host camera (the enter cut's exact `c0`), the gate's answer
 * and "does the face cover the viewport". Core's own computation — the static portal rect
 * through `resolvePortal`, the arrival through `resolveFrameView`, a sharp-cornered cover
 * test — stays the FALLBACK for every app that mounts no renderer with a word on it
 * (`resolveNavFace` below), so nothing an existing app does changes.
 *
 * Two facts ride here as well, both one-writer and one-tick:
 * - `NavIntent` — a nav op requested from INSIDE the tick (the double-tap gesture, the
 *   zoom-through), which the facade applies right after `engine.step` (ops are structural —
 *   `world.spawn`, tag writes, the index rebuild — and illegal mid-tick). The frame in between
 *   is drawn under the old camera; for the zoom-through that frame IS the covering face, the
 *   same pixels the cut then shows.
 * - `NavRedress` — a zoom-through cut left a desk DRESSED for another zoom (design-015 §9,
 *   PORTAL.md §9): `kind: "in"` = the desk entered is dressed for its arrival (`from`) and
 *   re-dresses to the camera's zoom; `"out"` = the desk left — now a live inside of `frame` —
 *   is dressed for the camera it was cut at (`from`) and re-dresses to its arrival. The
 *   renderer eases over its own ramp (320 ms, log space) and hands the lamp over on the same
 *   ramp; core states the fact and nothing else.
 */
import { field, enumOf } from "@vibecook/strata-ecs";
import type { Entity, World } from "@vibecook/strata-ecs";
import { type CameraState, outgoingCamera, type PortalAffine, portalAffine, visibleRect } from "@ice/kernel";
import { Viewport } from "../catalog/camera-derived";
import { ZoomThroughSettings } from "../catalog/settings-resources";
import { engineCatalogFor, widgetTypeFor } from "../canvas/engine-catalog";
import { type CanvasRect, resolveFrameView, resolvePortal } from "../canvas/frame-view";
import { defineResource } from "../schema/meta";
import { PrefabId } from "../schema/prefab";
import { ZOOM_THROUGH_DEFAULTS } from "../settings/defaults";

/** A container's face and its inside's embedding, under one host camera. */
export interface NavFace {
  /** The FACE — the portal rect — in the parent frame's world units, as drawn this frame (springs included) or at rest. */
  readonly face: CanvasRect;
  /** The inside's arrival camera: what its lattice is dressed for and what a flight lands on. */
  readonly arrival: CameraState;
  /** The embedding `M`: inside → parent (`portalAffine(visibleRect(arrival), face)`), the flight's own. */
  readonly affine: PortalAffine;
  /** The camera the inside renders under at the host camera — the enter cut's exact `c0` (`outgoingCamera(M, cam)`). */
  readonly camera: CameraState;
  /** The gate's answer at the host camera, 0..1: 0 = the far LOD alone, 1 = the live inside whole. */
  readonly presence: number;
  /** Does the face cover the whole viewport at the host camera by `marginPx` CSS px (negative: it may poke out by that much)? */
  covers(marginPx: number): boolean;
}

/** What a renderer with a word on its containers' geometry answers. */
export interface NavGeometrySource {
  /**
   * The container's face under the host camera `cam`: as DRAWN when the container is in the current
   * frame, at REST when it is not (the current frame's own container, an exit's); `undefined` = no
   * word — core computes from the static rect.
   */
  face(container: Entity, cam: CameraState): NavFace | undefined;
}

/** The stack's slot for the nav geometry source — a mutable box beside `framePick`, so the renderer can arrive after install. */
export interface NavGeometrySlot { current: NavGeometrySource | null }

/** Smooth at both ends; exactly 0 below `a` and 1 above `b`. */
export const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The DEFAULT arrival camera for a frame (design-006 as amended; nested-canvas's rule): kernel
 * `fitCamera` over its direct content, capped into the natural band (FIT_DEFAULTS ∩ the
 * session's CameraLimits ∩ the canvas type's camera policy); identity when empty or headless.
 */
export function defaultArrivalCamera(world: World, frame: Entity, isContainer?: (e: Entity) => boolean): CameraState {
  const frameTypeId = world.get(frame, PrefabId)?.id;
  const canvas = typeof frameTypeId === "string" ? engineCatalogFor(world)?.canvasForContainer(frameTypeId) : undefined;
  return resolveFrameView(world, frame, canvas, isContainer === undefined ? {} : { isContainer }).camera;
}

/** The container's STATIC face: its body rect through its `portal` insets, parent-frame units (`resolvePortal`). */
export function staticFace(world: World, container: Entity): CanvasRect | undefined {
  const typeId = world.get(container, PrefabId)?.id;
  const binding = typeof typeId === "string" ? widgetTypeFor(world, typeId)?.container : undefined;
  return resolvePortal(world, container, binding)?.parent;
}

/** The gate the fallback measures presence by: the live settings', else the defaults'. */
function gateOf(world: World): readonly [number, number] {
  const zt = world.getResource(ZoomThroughSettings);
  return zt === undefined ? ZOOM_THROUGH_DEFAULTS.gate : [zt.gate0, zt.gate1];
}

/**
 * A `NavFace` from the STATIC geometry — core's own word when no renderer has one: the face is
 * the portal rect, the arrival `defaultArrivalCamera`'s, the cover test sharp-cornered (the
 * desk's mini mat's face has square corners too — its face law's `radius` 0, K8a — so the two agree where both answer).
 */
export function fallbackNavFace(world: World, container: Entity, cam: CameraState, opts: { readonly face?: CanvasRect; readonly arrival?: CameraState; readonly isContainer?: (e: Entity) => boolean } = {}): NavFace | undefined {
  const face = opts.face ?? staticFace(world, container);
  if (face === undefined || !(face.width > 0) || !(face.height > 0)) return undefined;
  const vp = world.getResource(Viewport);
  const w = vp?.w ?? 0;
  const h = vp?.h ?? 0;
  const arrival = opts.arrival ?? defaultArrivalCamera(world, container, opts.isContainer);
  const affine = portalAffine(visibleRect(arrival, w, h), face);
  const [g0, g1] = gateOf(world);
  const short = Math.min(face.width, face.height) * cam.zoom;
  return {
    face,
    arrival,
    affine,
    camera: outgoingCamera(affine, cam),
    presence: smoothstep(g0, g1, short),
    covers(marginPx) {
      if (w <= 0 || h <= 0) return false;
      const x0 = (face.x - cam.x) * cam.zoom;
      const y0 = (face.y - cam.y) * cam.zoom;
      const x1 = x0 + face.width * cam.zoom;
      const y1 = y0 + face.height * cam.zoom;
      return x0 <= -marginPx && y0 <= -marginPx && x1 >= w + marginPx && y1 >= h + marginPx;
    },
  };
}

/**
 * THE one door core's nav reads a container's face through: the renderer's word when a source is
 * mounted and answers, else the fallback. `overrides` are an op's own numbers (`NavOpts.face` /
 * `.arrival`), which outrank both.
 */
export function resolveNavFace(world: World, container: Entity, cam: CameraState, slot: NavGeometrySlot | undefined, overrides: { readonly face?: CanvasRect; readonly arrival?: CameraState; readonly isContainer?: (e: Entity) => boolean } = {}): NavFace | undefined {
  const source = slot?.current ?? null;
  if (source !== null && overrides.face === undefined && overrides.arrival === undefined) {
    const drawn = source.face(container, cam);
    if (drawn !== undefined) return drawn;
  }
  return fallbackNavFace(world, container, cam, overrides);
}

/**
 * A nav op asked for from INSIDE the tick — by the double-tap gesture (`navTap`) or the
 * zoom-through — for the facade to apply once the tick is over. `epoch` bumps per request;
 * `transition` is the op's (a `"cut"` states `NavRedress` itself). `target` is the container to
 * enter (unused on exit).
 */
export const NavIntent = defineResource(
  "NavIntent",
  {
    kind: field(enumOf(["enter", "exit"]), { default: "enter" }),
    target: field("eid", { default: 0 as Entity }),
    transition: field(enumOf(["zoom", "none", "cut"]), { default: "zoom" }),
    source: field(enumOf(["tap", "through"]), { default: "tap" }),
    epoch: field("u32", { default: 0 }),
  },
  { durable: false },
);

/**
 * A zoom-through cut left a desk dressed for another zoom (design-015 §9): `in` — the desk
 * entered was dressed for its arrival (`from`) as a face and re-dresses to the camera's zoom;
 * `out` — the desk left, now the live inside of `frame`, was dressed for the camera it was cut
 * at (`from`) and re-dresses to its arrival. Stated by the nav ops on every `transition: "cut"`
 * (one writer); the renderer eases; `epoch` bumps per cut.
 */
export const NavRedress = defineResource(
  "NavRedress",
  {
    kind: field(enumOf(["in", "out"]), { default: "in" }),
    from: field("f64", { default: 1 }),
    /** The container whose desk re-dresses: the one entered (`in`), the one left (`out`). */
    frame: field("eid", { default: 0 as Entity }),
    epoch: field("u32", { default: 0 }),
  },
  { durable: false },
);
