/**
 * L3 camera slice — cameraControl (ctl:behave) + cameraInertia & tweenSystem
 * (simulate). Design-003 §5 item 9 + the `simulate` tail; design-001 §3 (a live
 * TransformTween holds the claim); design decision 14 (per-frame pan at CURRENT
 * zoom, never total/zoomAtClaim — mid-pan wheel-zoom keeps content under cursor).
 *
 * `cameraControl` is a PURE value consumer: it reads active camera-gesture
 * recognizers and writes ONLY the `Camera` resource (resources are access-exempt,
 * design-003 §10 — hence no `access.write`). It NEVER touches an entity's
 * components. It is driven off the guaranteed-singleton `CanvasSurface` entity so
 * the body runs EXACTLY ONCE per frame (same idiom as `pointerIngest`): the
 * camera is a whole-frame aggregate over every active camera gesture, written
 * once, change-guarded (an unconditional write would churn `CameraVersion` and
 * wake the plane reflector every frame). Camera writes go through the closed-over
 * `world.setResource` (no `ctx` resource API; verified legal in systems).
 *
 * Camera-gesture kinds and their math:
 *  - RoutedPan Drag (Active): integrate the PER-FRAME screen delta at the CURRENT
 *    zoom via a per-recognizer last-total memo (design decision 14).
 *  - WheelPan (Active): pan by its per-tick deltas (`Camera -= d/zoom`).
 *  - WheelZoom (Active): anchored zoom, `zoomAtPoint(cam, anchor, zoom·e^(-pinch·k))`.
 *  - Pinch (Active): zoom `startZoom · spread/startDist`, anchored at the live centroid.
 * `Camera.gesturing` is true while ANY of these is Active (compositor DPR gate).
 * On pan JustEnded, inertia is seeded from the Drag's release velocity.
 */
import { field } from "@vibecook/strata-ecs";
import type { Entity, System, World } from "@vibecook/strata-ecs";
import { defineQuery, defineSystem } from "@vibecook/strata-ecs";
import { zoomAtPoint } from "@ice/kernel";
import {
  Camera,
  CanvasSurface,
  Drag,
  GesturePhases,
  LocalPointer,
  Pinch,
  Pointer,
  PointerScreen,
  Position,
  RoutedPan,
  TransformTween,
  Watches,
  WentDown,
  WheelPan,
  WheelZoom,
} from "../catalog";
import { FrameInfo } from "../engine/frame-info";
import { defineResource } from "../schema/meta";
import { CAMERA_DEFAULTS, GESTURE_DEFAULTS } from "../settings/defaults";

const P = GesturePhases;

/** Wheel/pinch zoom sensitivity — matches the shipped demo pan/zoom feel (design-003 §5 item 9). */
const ZOOM_SENSITIVITY = 0.0015;

/** Camera default when the resource is unset (tests may never seed it). */
const CAMERA_ZERO = { x: 0, y: 0, zoom: 1, gesturing: false } as const;

/**
 * Runtime pan-inertia velocity (screen px/s), seeded by `cameraControl` at pan
 * release and decayed by `cameraInertia`. A resource (not closure state) so
 * devtools sees it and there is no hidden singleton (design-003 §9).
 */
export const CameraInertia = defineResource(
  "CameraInertia",
  { vx: field("f32", { default: 0 }), vy: field("f32", { default: 0 }) },
  { durable: false },
);

export interface CameraSystems {
  cameraControl: System;
  cameraInertia: System;
  tweenSystem: System;
}

const surfaceQ = defineQuery([CanvasSurface]);
const panDragQ = defineQuery([Drag, RoutedPan]);
const wheelPanQ = defineQuery([WheelPan]);
const wheelZoomQ = defineQuery([WheelZoom]);
const pinchQ = defineQuery([Pinch]);
const downPointerQ = defineQuery([Pointer, WentDown, LocalPointer]);
const tweenQ = defineQuery([Position, TransformTween]);

function clampZoom(z: number): number {
  return Math.min(CAMERA_DEFAULTS.maxZoom, Math.max(CAMERA_DEFAULTS.minZoom, z));
}

/** Cubic ease-out (design-003 §5 item 5 fly-back easing). */
function easeOutCubic(t: number): number {
  const inv = 1 - t;
  return 1 - inv * inv * inv;
}

export function createCameraSystems(world: World): CameraSystems {
  // Per-RoutedPan-recognizer last screen total (design decision 14): the pan
  // integrates ONLY this frame's delta at the current zoom, so a Simultaneous
  // wheel-zoom mid-pan never retroactively re-converts the accumulated total.
  const panMemo = new Map<Entity, { x: number; y: number }>();

  // Per-entity tween start position: TransformTween carries only the target
  // (design-001 §5 minimal shape), so the eased lerp needs the fly-away origin
  // captured on the attach frame. Cleaned on arrival.
  const tweenStart = new Map<Entity, { x: number; y: number }>();

  const cameraControl = defineSystem(
    surfaceQ,
    () => {
      const cam0 = world.getResource(Camera) ?? CAMERA_ZERO;
      let x = cam0.x;
      let y = cam0.y;
      let zoom = cam0.zoom;
      let anyActive = false;

      // 1) RoutedPan drags — per-frame delta at CURRENT zoom (design decision 14).
      world.query(panDragQ).each((b) => {
        for (const r of b) {
          const rec = b.entity(r);
          if (world.hasTag(rec, P.tags.Active)) {
            anyActive = true;
            const d = world.read(rec, Drag);
            const last = panMemo.get(rec) ?? { x: 0, y: 0 };
            x -= (d.totalX - last.x) / zoom;
            y -= (d.totalY - last.y) / zoom;
            panMemo.set(rec, { x: d.totalX, y: d.totalY });
          }
          if (world.hasTag(rec, P.justTags.Ended)) {
            const d = world.read(rec, Drag);
            if (Math.hypot(d.velX, d.velY) > GESTURE_DEFAULTS.inertiaMinVelocityPxPerS) {
              world.setResource(CameraInertia, { vx: d.velX, vy: d.velY });
            }
            panMemo.delete(rec);
          } else if (world.hasTag(rec, P.justTags.Cancelled) || world.hasTag(rec, P.justTags.Failed)) {
            panMemo.delete(rec);
          }
        }
      });

      // 2) WheelPan — per-tick deltas (wheelSystem zeroes them on silent frames).
      world.query(wheelPanQ).each((b) => {
        for (const r of b) {
          const rec = b.entity(r);
          if (!world.hasTag(rec, P.tags.Active)) continue;
          anyActive = true;
          const w = world.read(rec, WheelPan);
          if (w.dx === 0 && w.dy === 0) continue;
          x -= w.dx / zoom;
          y -= w.dy / zoom;
        }
      });

      // 3) WheelZoom — anchored zoom about the (live) wheel anchor.
      world.query(wheelZoomQ).each((b) => {
        for (const r of b) {
          const rec = b.entity(r);
          if (!world.hasTag(rec, P.tags.Active)) continue;
          anyActive = true;
          const wz = world.read(rec, WheelZoom);
          if (wz.pinch === 0) continue;
          const next = zoomAtPoint(
            { x, y, zoom },
            wz.anchorX,
            wz.anchorY,
            clampZoom(zoom * Math.exp(-wz.pinch * ZOOM_SENSITIVITY)),
          );
          x = next.x;
          y = next.y;
          zoom = next.zoom;
        }
      });

      // 4) Pinch — zoom by the spread ratio, anchored at the live centroid.
      world.query(pinchQ).each((b) => {
        for (const r of b) {
          const rec = b.entity(r);
          if (!world.hasTag(rec, P.tags.Active)) continue;
          const pointers = world.getRelations(rec, Watches);
          if (pointers.length !== 2) continue;
          const [pa, pbP] = pointers as [Entity, Entity];
          const pin = world.read(rec, Pinch);
          if (pin.startDist <= 0) continue;
          anyActive = true;
          const sa = world.read(pa, PointerScreen);
          const sb = world.read(pbP, PointerScreen);
          const spread = Math.hypot(sb.x - sa.x, sb.y - sa.y);
          const next = zoomAtPoint(
            { x, y, zoom },
            pin.cx,
            pin.cy,
            clampZoom(pin.startZoom * (spread / pin.startDist)),
          );
          x = next.x;
          y = next.y;
          zoom = next.zoom;
        }
      });

      if (x !== cam0.x || y !== cam0.y || zoom !== cam0.zoom || anyActive !== cam0.gesturing) {
        world.setResource(Camera, { x, y, zoom, gesturing: anyActive });
      }
    },
    { name: "cameraControl" },
  );

  const cameraInertia = defineSystem(
    surfaceQ,
    () => {
      const inertia = world.getResource(CameraInertia);
      if (inertia === undefined || (inertia.vx === 0 && inertia.vy === 0)) return;

      // Touch-to-stop: any pointer going down this frame kills inertia dead (v2).
      let stopped = false;
      world.query(downPointerQ).each((b) => {
        if (b.count > 0) stopped = true;
      });
      if (stopped) {
        world.setResource(CameraInertia, { vx: 0, vy: 0 });
        return;
      }

      const dt = world.getResource(FrameInfo)?.dt ?? 16;
      const dtS = dt / 1000;
      const cam0 = world.getResource(Camera) ?? CAMERA_ZERO;
      const zoom = cam0.zoom;
      // Apply at the current zoom (design-003 §5 item 9), then exponential decay.
      const nx = cam0.x - (inertia.vx * dtS) / zoom;
      const ny = cam0.y - (inertia.vy * dtS) / zoom;
      const decay = Math.exp(-dt / GESTURE_DEFAULTS.inertiaDecayMs);
      let vx = inertia.vx * decay;
      let vy = inertia.vy * decay;
      if (Math.hypot(vx, vy) < 1) {
        vx = 0;
        vy = 0;
      }
      world.setResource(CameraInertia, { vx, vy });
      // gesturing unchanged — inertia is not a gesture (no recognizer holds a claim).
      world.setResource(Camera, { x: nx, y: ny, zoom, gesturing: cam0.gesturing });
    },
    {
      name: "cameraInertia",
      runIf: () => {
        const i = world.getResource(CameraInertia);
        return i !== undefined && (i.vx !== 0 || i.vy !== 0);
      },
    },
  );

  const tweenSystem = defineSystem(
    tweenQ,
    (b, ctx) => {
      const dt = ctx.getResource(FrameInfo)?.dt ?? 16;
      for (const r of b) {
        const e = b.entity(r);
        const tw = ctx.read(e, TransformTween);
        const pos = ctx.read(e, Position);
        let start = tweenStart.get(e);
        if (start === undefined) {
          // Attach frame: Position is still the fly-away origin (moveBehavior did
          // not write it this frame) — capture it as the eased lerp's start.
          start = { x: pos.x, y: pos.y };
          tweenStart.set(e, start);
        }
        const elapsed = tw.elapsedMs + dt;
        const dur = tw.durationMs > 0 ? tw.durationMs : 1;
        if (elapsed >= dur) {
          ctx.edit(e).set(Position, { x: tw.toX, y: tw.toY }); // snap exactly to target
          ctx.removeComponent(e, TransformTween); // reap the rider — cell reconverges
          tweenStart.delete(e);
          continue;
        }
        const t = easeOutCubic(elapsed / dur);
        ctx.edit(e).set(Position, { x: start.x + (tw.toX - start.x) * t, y: start.y + (tw.toY - start.y) * t });
        ctx.edit(e).set(TransformTween, { ...tw, elapsedMs: elapsed });
      }
    },
    { name: "tweenSystem", access: { write: [Position, TransformTween] } },
  );

  return { cameraControl, cameraInertia, tweenSystem };
}
