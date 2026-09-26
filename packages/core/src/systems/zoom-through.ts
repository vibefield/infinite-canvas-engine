/**
 * The ZOOM-THROUGH (design-015 §9, design-013 Q13 → ON; PORTAL.md §8 — D2b). `ctl:behave`,
 * after `cameraControl`: on a frame whose wheel zoomed (`WheelZoomStep`, D2a-core's one-tick
 * fact — pans never cut, and the touch pinch is not recorded there, D-D2a.6), when no flight
 * drives and the settings say so —
 *
 * - a zoom IN: the topmost Active container (paint order) whose face has come in whole
 *   (presence 1) AND covers the whole viewport by `in` CSS px is entered as a CUT nobody can
 *   see: the view already IS its inside, and the cut lands on the camera the inside was
 *   rendering under (`transition: "cut"`).
 * - a zoom OUT: when the current frame's own face — under the parent camera the inside
 *   renders as it does now, the continuity solve — no longer covers the view by `out` px, the
 *   frame is left as a cut onto that parent camera.
 *
 * Both are asked through the one-tick `NavIntent` fact (ops are structural — illegal mid-tick;
 * the facade applies it right after the step) with `redress` set: the entered desk was DRESSED
 * for its arrival as a face (`from` = the arrival's zoom), the left desk for the camera it was
 * cut at (`from` = the camera's zoom) — the renderer re-dresses over its own ramp and hands the
 * lamp over on it (`NavRedress`, written by the applier). The faces come through the nav
 * geometry seam (the drawn face, the gate's answer, the cover test), else core's static rect.
 */
import type { Entity, TickSystem, World } from "@vibecook/strata-ecs";
import { defineQuery, defineTickSystem } from "@vibecook/strata-ecs";
import { type CameraState, solveFlightStart } from "@ice/kernel";
import { Active, Camera } from "../catalog/camera-derived";
import { Container } from "../catalog/graph";
import { Position, Size } from "../catalog/scene";
import { ZoomThroughSettings } from "../catalog/settings-resources";
import { FrameInfo } from "../engine/frame-info";
import { type NavGeometrySlot, NavIntent, resolveNavFace } from "../nav/nav-geometry";
import { currentNavFrame } from "../nav/nested-canvas";
import { compareStackOrder, createSiblingOrderIndex } from "../ops/sibling-order";
import { PrefabId } from "../schema/prefab";
import { NavTransition } from "./nav-flight";
import { WheelZoomStep } from "./camera-sim";

const activeContainersQ = defineQuery([Container, Active, Position, Size, PrefabId]);

export interface ZoomThroughOpts {
  /** The nav geometry seam the faces are read through (the interaction stack's slot). */
  readonly navGeometry?: NavGeometrySlot;
  /** Is this entity a container the engine may enter (the facade's catalog-backed test)? Default: any `Container`. */
  readonly isContainer?: (entity: Entity) => boolean;
}

export function createZoomThrough(world: World, opts: ZoomThroughOpts = {}): TickSystem {
  const order = createSiblingOrderIndex(world);
  const isContainer = opts.isContainer ?? (() => true);
  const wheeledThisTick = (): boolean => {
    const step = world.getResource(WheelZoomStep);
    if (step === undefined || step.ratio === 1) return false;
    return step.tick === (world.getResource(FrameInfo)?.tick ?? -1);
  };
  return defineTickSystem(
    (ctx) => {
      const zt = world.getResource(ZoomThroughSettings);
      if (zt === undefined || !zt.enabled || !wheeledThisTick()) return;
      if (world.getResource(NavTransition)?.active === true) return;   // no cut while a flight drives
      const step = world.getResource(WheelZoomStep);
      const camRes = world.getResource(Camera);
      if (step === undefined || camRes === undefined) return;
      const cam: CameraState = { x: camRes.x, y: camRes.y, zoom: camRes.zoom };
      const prev = world.getResource(NavIntent);
      const epoch = (prev?.epoch ?? 0) + 1;
      if (step.ratio > 1) {
        // IN: the topmost Active container first — paint order, the same comparator pick and paint use
        const conts: Entity[] = [];
        ctx.query(activeContainersQ).each((b) => { for (const r of b) conts.push(b.entity(r)); });
        if (conts.length === 0) return;
        const ordinals = order.ordinals();
        conts.sort((a, b) => compareStackOrder(ctx, ordinals, b, a));
        for (const c of conts) {
          if (!isContainer(c)) continue;
          const f = resolveNavFace(world, c, cam, opts.navGeometry);
          if (f === undefined || f.presence < 1 || !f.covers(zt.in)) continue;
          world.setResource(NavIntent, { kind: "enter", target: c, transition: "cut", source: "through", epoch });
          return;
        }
      } else {
        // OUT: the current frame's own face under the parent camera the inside renders as it does now
        const frame = currentNavFrame(world);
        if (frame === undefined || !world.isAlive(frame)) return;
        const rest = resolveNavFace(world, frame, cam, opts.navGeometry);
        if (rest === undefined) return;
        const hostCam = solveFlightStart(rest.affine, cam);
        const f = resolveNavFace(world, frame, hostCam, opts.navGeometry);
        if (f === undefined || f.covers(-zt.out)) return;
        world.setResource(NavIntent, { kind: "exit", target: frame, transition: "cut", source: "through", epoch });
      }
    },
    {
      name: "zoomThrough",
      runIf: () => world.getResource(ZoomThroughSettings)?.enabled === true && wheeledThisTick(),
    },
  );
}
