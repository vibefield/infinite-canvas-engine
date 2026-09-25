/**
 * L3 camera slice — cameraControl (ctl:behave) + cameraInertia & tweenSystem
 * (simulate). Design-003 §5 item 9 + the `simulate` tail; design-001 §3 (a live
 * TransformTween holds the claim); design decision 14 (per-frame pan at CURRENT
 * zoom, never total/zoomAtClaim — mid-pan wheel-zoom keeps content under cursor).
 *
 * `cameraControl` is a PURE value consumer: it reads active camera-gesture
 * recognizers and writes ONLY the `Camera` resource (resources are access-exempt,
 * design-003 §10 — hence no `access.write`). It NEVER touches an entity's
 * components. It is a TICK system (strata 0.5.0): the scheduler runs the body
 * EXACTLY once per frame — the camera is a whole-frame aggregate over every
 * active camera gesture, written once, change-guarded (an unconditional write would churn `CameraVersion` and
 * wake the plane reflector every frame). Camera writes go through the closed-over
 * `world.setResource` (no `ctx` resource API; verified legal in systems).
 *
 * Camera-gesture kinds and their math:
 *  - RoutedPan Drag (Active): integrate the PER-FRAME screen delta at the CURRENT
 *    zoom via a per-recognizer last-total memo (design decision 14). Sign is
 *    content-follows-pointer (`Camera -= Δ/zoom`, design-003 §5 item 9): the
 *    drag GRABS the canvas, standard in every canvas app.
 *  - WheelPan (Active): `Camera += d/zoom` — scroll direction = TRAVEL direction
 *    (wheel-down/swipe-down moves the viewport down the world; content moves
 *    opposite). This is the Figma/Freeform convention for both mouse wheels and
 *    macOS natural-scroll trackpads; the sign was inverted until James's field
 *    report (2026-07-10) and is now pinned by a trace.
 *  - WheelZoom (Active): anchored zoom, `zoomAtPoint(cam, anchor,
 *    zoom·2^(−clamp(pinch, ±maxStep)·sens))` (the v2 curve below — this line
 *    said `e^(−pinch·k)` until D2a-core corrected it; the code never did).
 *  - Pinch (Active): zoom `startZoom · spread/startDist`, anchored at the live centroid.
 * `Camera.gesturing` is true while ANY of these is Active (compositor DPR gate).
 * On pan JustEnded, inertia is seeded from the Drag's release velocity.
 *
 * THE WHEEL MODE (design-015 §9, D-D11 — D2a-core, 2026-09-25):
 * `GestureSettings.wheel` is `"pan"` by default — everything above, byte for
 * byte. `"zoom"` is the desk's law, the prototype's (vibe-field/draft/ground
 * lab/main.ts): a PLAIN wheel's Δy zooms about the pointer by
 * `zoom · exp(−Δy · wheelZoomRate)` and its Δx moves nothing; a pinch
 * (WheelZoom) zooms by the same law instead of the v2 curve; CameraLimits
 * clamps both as ever. Either mode records each frame's WHEEL zoom in the
 * one-tick `WheelZoomStep` (below) for the systems that run after this one.
 */
import { field } from "@vibecook/strata-ecs";
import type { Entity, System, TickSystem, World } from "@vibecook/strata-ecs";
import { defineQuery, defineSystem, defineTickSystem } from "@vibecook/strata-ecs";
import { zoomAtPoint } from "@ice/kernel";
import {
  Camera,
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
import { CameraLimits, GestureSettings } from "../catalog/settings-resources";
import { FrameInfo } from "../engine/frame-info";
import { defineResource } from "../schema/meta";
import { CAMERA_DEFAULTS, GESTURE_DEFAULTS } from "../settings/defaults";

const P = GesturePhases;

// Wheel-zoom speed is the v2 prototype curve (2026-07-13, superseding the old
// e^(−Δ·0.0015) demo constant): factor = 2^(−clamp(Δ, ±maxStep) · sensitivity),
// live-tunable via GestureSettings. See GESTURE_DEFAULTS for why the clamp is
// the load-bearing half (mouse-notch ≈ pinch-frame parity).

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

/**
 * This frame's WHEEL zoom (design-015 §9, D2a-core): the one-tick fact a system
 * that runs after `cameraControl` reads to know "this frame zoomed in / out
 * about this anchor" — D2b's zoom-through is the first. `cameraControl` is its
 * one writer, change-only: it writes a step on each frame whose wheel zoom (a
 * plain wheel in `"zoom"` mode, or a pinch-wheel in either mode) moved the
 * zoom, and resets `ratio` to 1 on the first frame after that has none; idle
 * frames write nothing.
 *  - `ratio`: zoom after ÷ zoom before, over this frame's wheel zooms — `> 1`
 *    zoomed in, `< 1` out, `1` no step (a clamped zoom is no step).
 *  - `anchorX/Y`: the screen point (CSS px) of the frame's last wheel zoom.
 *  - `tick`: the `FrameInfo.tick` it happened on, for a reader that runs BEFORE
 *    `cameraControl` and must tell last frame's step from this one's.
 * Not recorded: pans, flights, ops (`zoomTo`, fits) and the TOUCH pinch — whose
 * zoom is absolute from its own start (`startZoom · spread/startDist`), so a
 * consumer that re-bases the camera mid-pinch would have to re-base the pinch
 * too; that is the consumer's call to make, not a fact to hand it silently.
 */
export const WheelZoomStep = defineResource(
  "WheelZoomStep",
  {
    ratio: field("f64", { default: 1 }),
    anchorX: field("f32", { default: 0 }),
    anchorY: field("f32", { default: 0 }),
    tick: field("u32", { default: 0 }),
  },
  { durable: false },
);

export interface CameraSystems {
  cameraControl: TickSystem;
  cameraInertia: TickSystem;
  tweenSystem: System;
}

const panDragQ = defineQuery([Drag, RoutedPan]);
const wheelPanQ = defineQuery([WheelPan]);
const wheelZoomQ = defineQuery([WheelZoom]);
const pinchQ = defineQuery([Pinch]);
const downPointerQ = defineQuery([Pointer, WentDown, LocalPointer]);
const tweenQ = defineQuery([Position, TransformTween]);

function clampZoom(world: World, z: number): number {
  // Live-tunable limits (design-005 §4): resource first, const fallback.
  const lim = world.getResource(CameraLimits) ?? CAMERA_DEFAULTS;
  return Math.min(lim.maxZoom, Math.max(lim.minZoom, z));
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
  // captured on the attach frame. Cleaned on arrival — and, since 2026-08-15
  // (petition I15), on DEATH too: an entity destroyed mid-glide never reaches
  // the landing branch, so its entry used to sit in this map for the world's
  // whole life. Bounded and harmless (generation-tagged handles never collide),
  // but a leak is a leak — and behaviors will make mid-glide despawns ordinary.
  const tweenStart = new Map<Entity, { x: number; y: number }>();
  world.observe({
    onDestroy: (e) => {
      tweenStart.delete(e);
    },
    onReset: () => {
      tweenStart.clear();
      panMemo.clear();
    },
  });

  // Tick system (strata 0.5.0, petition 5): the scheduler owns cardinality —
  // the whole-frame aggregate runs EXACTLY once per frame by construction.
  // (Pre-0.5.0 this was a CanvasSurface-anchored chunk system; a missing
  // count guard multiplied the non-idempotent integrations N-archetypes× —
  // caught by the wheel-pan direction trace, 2026-07-10.)
  const cameraControl = defineTickSystem(
    (ctx) => {
      const cam0 = world.getResource(Camera) ?? CAMERA_ZERO;
      let x = cam0.x;
      let y = cam0.y;
      let zoom = cam0.zoom;
      let anyActive = false;
      // The wheel mode (design-015 §9): "zoom" is the desk's law for a plain
      // wheel AND a pinch; "pan" (default) leaves 2) and 3) exactly as they were.
      const gmode = world.getResource(GestureSettings);
      const wheelZooms = (gmode?.wheel ?? GESTURE_DEFAULTS.wheel) === "zoom";
      const zoomRate = gmode?.wheelZoomRate ?? GESTURE_DEFAULTS.wheelZoomRate;
      // This frame's WHEEL zoom, for WheelZoomStep: the product of its ratios and its last anchor.
      let wheelRatio = 1;
      let wheelAnchorX = 0;
      let wheelAnchorY = 0;

      // 1) RoutedPan drags — per-frame delta at CURRENT zoom (design decision 14).
      ctx.query(panDragQ).each((b) => {
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
      // += : scroll direction is travel direction (see module note). The DRAG
      // pan above keeps -= (grab-the-canvas) — the two are deliberately opposed.
      ctx.query(wheelPanQ).each((b) => {
        for (const r of b) {
          const rec = b.entity(r);
          if (!world.hasTag(rec, P.tags.Active)) continue;
          anyActive = true;
          const w = world.read(rec, WheelPan);
          if (w.dx === 0 && w.dy === 0) continue;
          if (wheelZooms) {
            // The desk (design-015 §9): a plain wheel's Δy ZOOMS about the
            // pointer by the prototype's law; its Δx is not the camera's.
            if (w.dy === 0) continue;
            const next = zoomAtPoint(
              { x, y, zoom },
              w.anchorX,
              w.anchorY,
              clampZoom(world, zoom * Math.exp(-w.dy * zoomRate)),
            );
            wheelRatio *= next.zoom / zoom;
            wheelAnchorX = w.anchorX;
            wheelAnchorY = w.anchorY;
            x = next.x;
            y = next.y;
            zoom = next.zoom;
            continue;
          }
          x += w.dx / zoom;
          y += w.dy / zoom;
        }
      });

      // 3) WheelZoom — anchored zoom about the (live) wheel anchor.
      ctx.query(wheelZoomQ).each((b) => {
        for (const r of b) {
          const rec = b.entity(r);
          if (!world.hasTag(rec, P.tags.Active)) continue;
          anyActive = true;
          const wz = world.read(rec, WheelZoom);
          if (wz.pinch === 0) continue;
          let factor: number;
          if (wheelZooms) {
            // The desk: a pinch zooms by the same law as its plain wheel.
            factor = Math.exp(-wz.pinch * zoomRate);
          } else {
            const gset = world.getResource(GestureSettings);
            const sens = gset?.wheelZoomSensitivity ?? GESTURE_DEFAULTS.wheelZoomSensitivity;
            const maxStep = gset?.wheelZoomMaxStep ?? GESTURE_DEFAULTS.wheelZoomMaxStep;
            const step = Math.max(-maxStep, Math.min(maxStep, wz.pinch));
            factor = 2 ** (-step * sens);
          }
          const next = zoomAtPoint(
            { x, y, zoom },
            wz.anchorX,
            wz.anchorY,
            clampZoom(world, zoom * factor),
          );
          wheelRatio *= next.zoom / zoom;
          wheelAnchorX = wz.anchorX;
          wheelAnchorY = wz.anchorY;
          x = next.x;
          y = next.y;
          zoom = next.zoom;
        }
      });

      // 4) Pinch — zoom by the spread ratio, anchored at the live centroid.
      ctx.query(pinchQ).each((b) => {
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
            clampZoom(world, pin.startZoom * (spread / pin.startDist)),
          );
          x = next.x;
          y = next.y;
          zoom = next.zoom;
        }
      });

      if (x !== cam0.x || y !== cam0.y || zoom !== cam0.zoom || anyActive !== cam0.gesturing) {
        world.setResource(Camera, { x, y, zoom, gesturing: anyActive });
      }

      // WheelZoomStep (design-015 §9), change-only: this frame's wheel zoom, or
      // the one reset after the last one. An idle frame writes nothing.
      if (wheelRatio !== 1) {
        world.setResource(WheelZoomStep, {
          ratio: wheelRatio,
          anchorX: wheelAnchorX,
          anchorY: wheelAnchorY,
          tick: world.getResource(FrameInfo)?.tick ?? 0,
        });
      } else {
        const last = world.getResource(WheelZoomStep);
        if (last !== undefined && last.ratio !== 1) world.setResource(WheelZoomStep, { ...last, ratio: 1 });
      }
    },
    { name: "cameraControl" },
  );

  const cameraInertia = defineTickSystem(
    (ctx) => {
      const inertia = world.getResource(CameraInertia);
      if (inertia === undefined || (inertia.vx === 0 && inertia.vy === 0)) return;

      // Touch-to-stop: any pointer going down this frame kills inertia dead (v2).
      let stopped = false;
      ctx.query(downPointerQ).each((b) => {
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
