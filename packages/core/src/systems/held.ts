/**
 * HELD INPUT (design-015 §8; D4b) — while an object is in the hand, every pointer is the held
 * object's and the desk behind it is inert. The HEAD of the `react` phase: the ingest's one-tick
 * tags are flushed by then (a press is visible), and what this stamps flushes before `ctl`.
 *
 * The desk goes inert with the vocabulary the stack already honours: every local pointer gets the
 * one-tick `HandledByWidget` (picking and the recognizers skip it — no hit, no tap, no drag, no
 * selection change) and `WheelHandled` (both wheel consumers skip it — the camera never moves), the
 * cleanup phase clears them, this system stamps them again next tick. So "no camera move" is not a
 * rule the camera keeps; it is a fact the camera never hears about.
 *
 * What the pointer does instead is mapped through the SAME pose the renderer drew — the seam
 * `HeldPoseSlot` beside `framePick`: the renderer publishes the held object's screen frame each
 * frame (`HeldPoseSource.frame`), and a pointer's point becomes `HeldPointer` — the object's own
 * units, centred — and an inside/outside verdict. The routes (desk.js `heldDown`/`heldMove`/
 * `heldUp`/`heldZoomAt`/`heldPanBy`, number for number):
 *  - a ⌘/ctrl-wheel or a pinch brings the object closer ABOUT THE POINTER (`HeldView.zoom`, up to 3×,
 *    the pan following so the point under the pointer stays), never the mat; in past 0.72× it is put
 *    down — and the rest of that gesture is MUTED (`HeldMute`: 400 ms, +250 per swallowed event), so
 *    the wheel's tail never zooms the desk (the v2 lesson);
 *  - once brought close (zoom > 1) a plain wheel moves the object under the eye, clamped so it never
 *    leaves the middle of the view; a middle-button or Space drag pans the same way, as does a drag
 *    that starts on the soft desk;
 *  - a click on the soft desk — pressed and released outside the object, unmoved — puts it down; two
 *    instant taps on the object do too (the notebook's case rule, generalised) — unless they land on its
 *    drawing surface with a mode in hand (D3t-a): that press is the TOOL's (`HeldPress` `tool` — the
 *    board's stroke; a double-click there is two dots, never a way back) — or on one of the kind's named
 *    PARTS (D3t-b: any part but `content` and `frame`, the object itself): that press is the KIND's
 *    (`HeldPress` `part`, with the part it began on — a notebook's turn: two clicks there turn two pages);
 *  - every route above is the PRIMARY button's (petition I28, press-button.ts): a secondary press — and a middle one with nothing
 *    to pan — is a point in the hand as on the desk: it keeps no `HeldPress`, so it puts nothing down, works no part, lays no stroke;
 *  - (design-019 §5, M24 LT2) a primary press is COUNTED — `HeldPress.count`, 1, 2, 3… within the multi-tap window and slop of the
 *    last (`HeldPressMemo`, by the down events' own times): the platform's `detail` is 0 on a pointerdown, so the desk counts; and a
 *    kind that takes the wheel (`OpenBinding.wheel: "kind"` — its type's `heldWheel`) has a plain wheel written to `HeldWheel` for it
 *    instead of panning the hand — ⌘/ctrl and the pinch zoom the hand as ever, and past 0.72× still put it down.
 * The ways back are OPS (`ops.putDown`, structural) and a system may not run them mid-tick: it writes
 * the one-tick `HeldIntent` and the facade applies it after the step (D2b's `NavIntent`, same shape).
 * Nothing here reads a kind: the seam gives a frame and (D3t-a) the part under a point; the tool in
 * hand is core's `HeldTool`, the wheel's owner the widget type's `heldWheel`. The kind is TOLD its input by the desk, which folds
 * `HeldPointer`, `HeldPress` and `HeldWheel` into its `held` events (desk/hold/told.ts) — never a second input path.
 */
import type { Entity, System, World } from "@vibecook/strata-ecs";
import { defineQuery, defineSystem } from "@vibecook/strata-ecs";
import { widgetTypeFor } from "../canvas/engine-catalog";
import { Held, HeldIntent, HeldMute, HeldPointer, HeldPress, HeldPressMemo, HeldTapMemo, HeldTool, HeldView, HeldWheel } from "../catalog/desk";
import {
  HandledByWidget,
  Keyboard,
  LocalPointer,
  Pointer,
  PointerButtons,
  PointerMods,
  PointerScreen,
  PointerWheel,
  WentCancelled,
  WentDown,
  WentUp,
  WheelHandled,
} from "../catalog/pointer";
import { GestureSettings } from "../catalog/settings-resources";
import { FrameInfo } from "../engine/frame-info";
import { PrefabId } from "../schema/prefab";
import { GESTURE_DEFAULTS } from "../settings/defaults";
import { pressButton } from "./press-button";

/** The held object's frame ON SCREEN as the renderer drew it this frame (CSS px): its centre, half extents, its scale (CSS px per object unit), and whether the pickup has settled (the wheel waits for it). */
export interface HeldScreenFrame {
  readonly cx: number;
  readonly cy: number;
  readonly hx: number;
  readonly hy: number;
  readonly s: number;
  readonly settled: boolean;
}

/**
 * The pose seam: the renderer's word on where the held object is — `undefined` before its first frame — and (D3t-a) which of
 * its kind's parts is under a point of the object's own frame (its `hit` on the geometry it drew: the board's melamine
 * `content`, its `frame`), null over nothing; absent = no parts ("content" inside the frame). `cursor` (design-019 §5, M24 LT2):
 * the kind's cursor over one of its NAMED parts (its `open.cursor`) — L4 shows it above its own; undefined: L4's.
 */
export interface HeldPoseSource {
  frame(entity: Entity): HeldScreenFrame | undefined;
  part?(entity: Entity, x: number, y: number): string | null;
  cursor?(entity: Entity, part: string): string | undefined;
}

/** The stack's slot for the pose source — a mutable box, so the renderer can arrive after install (as `framePick`). */
export interface HeldPoseSlot { current: HeldPoseSource | null }

/** The hand's numbers (desk.js `HOLD` and its wheel handler): the zoom's floor (put down below it) and ceiling, the wheel's rate, the mute, the press slop. */
export const HOLD_INPUT = { zoomMin: 0.72, zoomMax: 3, wheelRate: 0.0105, muteMs: 400, muteMoreMs: 250, slopPx: 3 } as const;

const heldQ = defineQuery([Held]);
const localPointerQ = defineQuery([Pointer, PointerScreen, LocalPointer]);

const clamp = (x: number, a: number, b: number): number => Math.min(Math.max(x, a), Math.max(a, b));

/** The held object, or undefined. */
export function heldEntity(world: World): Entity | undefined {
  return world.firstOf(heldQ);
}

export function createHeldInput(world: World, opts: { readonly pose: HeldPoseSlot }): System {
  const request = (kind: "open" | "putDown", target: Entity): void => {
    const prev = world.getResource(HeldIntent);
    world.setResource(HeldIntent, { kind, target, epoch: (prev?.epoch ?? 0) + 1 });
  };
  return defineSystem(
    localPointerQ,
    (b, ctx) => {
      const now = world.getResource(FrameInfo)?.now ?? 0;
      const held = world.firstOf(heldQ);
      if (held === undefined || !ctx.isAlive(held)) {
        // nothing in hand: the mute swallows the tail of the gesture that put the object down, and a pointer's held facts leave
        const mute = world.getResource(HeldMute);
        let muted = mute !== undefined && now < mute.until;
        // the hand's count starts again with the next hold (written once, never a stamp a tick)
        if ((world.getResource(HeldPressMemo)?.count ?? 0) !== 0) world.setResource(HeldPressMemo, { x: 0, y: 0, at: 0, count: 0 });
        for (const r of b) {
          const p = b.entity(r);
          if (ctx.has(p, HeldPointer)) ctx.removeComponent(p, HeldPointer);
          if (ctx.has(p, HeldPress)) ctx.removeComponent(p, HeldPress);
          if (ctx.has(p, HeldWheel)) ctx.removeComponent(p, HeldWheel);
          if (!muted) continue;
          const w = ctx.get(p, PointerWheel);
          if (w === undefined || (w.dx === 0 && w.dy === 0 && w.pinch === 0) || ctx.hasTag(p, WheelHandled)) continue;
          ctx.addTag(p, WheelHandled);
          // each swallowed event pushes the mute further — never nearer (the page's own `now + 250` could shorten its 400)
          world.setResource(HeldMute, { until: Math.max(mute?.until ?? 0, now + HOLD_INPUT.muteMoreMs) });
          muted = true;
        }
        return;
      }
      const view = world.get(held, HeldView) ?? { zoom: 1, panX: 0, panY: 0 };
      const frame = opts.pose.current?.frame(held);
      const gs = world.getResource(GestureSettings);
      const windowMs = gs?.multiTapWindowMs ?? GESTURE_DEFAULTS.multiTapWindowMs;
      const slopPx = gs?.multiTapSlopPx ?? GESTURE_DEFAULTS.multiTapSlopPx;
      const space = world.getResource(Keyboard)?.space === true;
      // the plain wheel's owner in hand (M24 LT2): the hand's (it pans the object brought close) unless the kind takes it
      const typeId = world.get(held, PrefabId)?.id;
      const wheelToKind = typeof typeId === "string" && widgetTypeFor(world, typeId)?.heldWheel === "kind";
      /** The pan clamp at a zoom: half the held extent on screen there (desk.js `heldPanBy`). */
      const clampPan = (x: number, y: number, zoom: number): readonly [number, number] => {
        if (frame === undefined) return [x, y];
        const hx = (frame.hx / Math.max(view.zoom, 1e-9)) * zoom;
        const hy = (frame.hy / Math.max(view.zoom, 1e-9)) * zoom;
        return [clamp(x, -hx, hx), clamp(y, -hy, hy)];
      };
      let next = { zoom: view.zoom, panX: view.panX, panY: view.panY };
      let putDown = false;
      for (const r of b) {
        const p = b.entity(r);
        // the desk is inert: picking, the recognizers and both wheel consumers skip this pointer this tick
        if (!ctx.hasTag(p, HandledByWidget)) ctx.addTag(p, HandledByWidget);
        if (!ctx.hasTag(p, WheelHandled)) ctx.addTag(p, WheelHandled);
        const s = ctx.read(p, PointerScreen);
        // the pointer in the object's own frame, through the pose the renderer drew — and the kind's part under it (D3t-a) — change-only
        let inside = false;
        let part = "";
        if (frame !== undefined) {
          const lx = (s.x - frame.cx) / Math.max(frame.s, 1e-9);
          const ly = (s.y - frame.cy) / Math.max(frame.s, 1e-9);
          inside = Math.abs(s.x - frame.cx) <= frame.hx && Math.abs(s.y - frame.cy) <= frame.hy;
          const source = opts.pose.current;
          part = source?.part !== undefined ? (source.part(held, lx, ly) ?? "") : inside ? "content" : "";
          const cur = ctx.get(p, HeldPointer);
          if (cur === undefined) ctx.addComponent(p, HeldPointer, { x: lx, y: ly, inside, part });
          else if (cur.x !== lx || cur.y !== ly || cur.inside !== inside || cur.part !== part) ctx.edit(p).set(HeldPointer, { x: lx, y: ly, inside, part });
        }
        // the wheel: ⌘/ctrl or a pinch brings it closer about the pointer; a plain wheel moves it once brought close (settled only)
        const w = ctx.get(p, PointerWheel);
        if (!putDown && frame !== undefined && frame.settled && w !== undefined && (w.dx !== 0 || w.dy !== 0 || w.pinch !== 0)) {
          const mods = ctx.get(p, PointerMods);
          const zooming = w.pinch !== 0 || mods?.meta === true || mods?.ctrl === true;
          if (zooming) {
            const d = w.pinch !== 0 ? w.pinch : w.dy;
            const z = next.zoom * Math.exp(-d * HOLD_INPUT.wheelRate);
            if (z < HOLD_INPUT.zoomMin) {
              // in past the floor: down it goes, and the rest of this gesture is nobody's
              putDown = true;
              world.setResource(HeldMute, { until: now + HOLD_INPUT.muteMs });
            } else {
              const zoom = Math.min(z, HOLD_INPUT.zoomMax);
              const ratio = zoom / next.zoom;
              // the point under the pointer stays: C' = p + (C − p)·r, so pan' = pan + (p − C)(1 − r); at the reading size and under, centred
              const cx = frame.cx + (next.panX - view.panX);
              const cy = frame.cy + (next.panY - view.panY);
              const [px, py] = zoom <= 1 ? [0, 0] : clampPan(next.panX + (s.x - cx) * (1 - ratio), next.panY + (s.y - cy) * (1 - ratio), zoom);
              next = { zoom, panX: px, panY: py };
            }
          } else if (wheelToKind) {
            // the kind's wheel (design-019 §5): this tick's deltas, told once by `seq` — the hand never pans for it
            const cur = ctx.get(p, HeldWheel);
            const wheel = { dx: w.dx, dy: w.dy, seq: (cur?.seq ?? 0) + 1 };
            if (cur === undefined) ctx.addComponent(p, HeldWheel, wheel);
            else ctx.edit(p).set(HeldWheel, wheel);
          } else if (next.zoom > 1.001) {
            const [px, py] = clampPan(next.panX - w.dx, next.panY - w.dy, next.zoom);
            next = { ...next, panX: px, panY: py };
          }
        }
        // the press: where it began decides what it is; its release, unmoved, is a way back. On the drawing surface with a mode
        // in hand it is the TOOL's (D3t-a — the board's stroke); on a named part the KIND's (D3t-b — a notebook's turn): never a
        // pan, never a tap that puts the object down
        if (ctx.hasTag(p, WentDown)) {
          // the button it began with (petition I28, press-button.ts): the primary's press is the hand's, a middle one only pans; a
          // secondary press — or a middle one with nothing to pan — is a POINT, and keeps no press
          const button = pressButton(ctx.get(p, PointerButtons)?.buttons ?? 0);
          const pan = (button === "middle" || (button === "primary" && space)) && next.zoom > 1.001;
          if (pan || button === "primary") {
            const tool = part === "content" && (world.get(held, HeldTool)?.id ?? "") !== "";
            const named = part !== "" && part !== "content" && part !== "frame";
            const kind = pan ? "pan" : tool ? "tool" : named ? "part" : inside ? "object" : "desk";
            // its click count (M24 LT2): on from the last primary press within the multi-tap window and slop, by the down events' own
            // times (as the taps below pair) — a pointerdown's `detail` is 0 in the browser, so the desk counts
            let count = 1;
            if (button === "primary") {
              const memo = world.getResource(HeldPressMemo);
              const downMs = ctx.get(p, PointerButtons)?.downMs ?? 0;
              const at = downMs !== 0 ? downMs : now;
              if (memo !== undefined && memo.count > 0 && at - memo.at <= windowMs && Math.hypot(s.x - memo.x, s.y - memo.y) <= slopPx) count = memo.count + 1;
              world.setResource(HeldPressMemo, { x: s.x, y: s.y, at, count });
            }
            const press = { kind, part, x: s.x, y: s.y, panX0: next.panX, panY0: next.panY, moved: false, count } as const;
            if (ctx.has(p, HeldPress)) ctx.edit(p).set(HeldPress, press);
            else ctx.addComponent(p, HeldPress, press);
          } else if (ctx.has(p, HeldPress)) ctx.removeComponent(p, HeldPress);
        } else if (ctx.has(p, HeldPress)) {
          const pr = ctx.read(p, HeldPress);
          const dx = s.x - pr.x;
          const dy = s.y - pr.y;
          const moved = pr.moved || Math.hypot(dx, dy) > HOLD_INPUT.slopPx;
          if (pr.kind === "pan" || (pr.kind === "desk" && next.zoom > 1.001)) {
            // brought close: the drag moves the object under the eye
            const [px, py] = clampPan(pr.panX0 + dx, pr.panY0 + dy, next.zoom);
            next = { ...next, panX: px, panY: py };
          }
          const up = ctx.hasTag(p, WentUp);
          if (up || ctx.hasTag(p, WentCancelled)) {
            if (up && !moved && !putDown) {
              if (pr.kind === "desk") putDown = true;   // a click on the soft desk puts it down (the whiteboard's rule, now every held object's)
              else if (pr.kind === "object") {
                // two instant taps on the object: the notebook's case, generalised (its parts are D3t's)
                const memo = world.getResource(HeldTapMemo);
                // the tap's time is its down EVENT's own — `PointerButtons.downMs`, the adapter's timestamp, kept through the release
                // (K9 S6 — K-H's product call): a main-thread stall between two taps does not unpair them; the frame's `now` is the
                // fallback for an input with no time, and the frame CLOCK is never it (clamped dt; the loop sleeps between taps)
                const downMs = ctx.get(p, PointerButtons)?.downMs ?? 0;
                const at = downMs !== 0 ? downMs : now;
                const pairs = memo !== undefined && memo.seq > 0 && at - memo.at <= windowMs && Math.hypot(s.x - memo.x, s.y - memo.y) <= slopPx;
                if (pairs) { putDown = true; world.setResource(HeldTapMemo, { x: 0, y: 0, at: 0, seq: 0 }); }
                else world.setResource(HeldTapMemo, { x: s.x, y: s.y, at, seq: (memo?.seq ?? 0) + 1 });
              }
            }
            ctx.removeComponent(p, HeldPress);
          } else if (moved !== pr.moved) ctx.edit(p).set(HeldPress, { ...pr, moved });
        }
      }
      if (putDown) { request("putDown", held); return; }
      if (next.zoom !== view.zoom || next.panX !== view.panX || next.panY !== view.panY) {
        if (ctx.has(held, HeldView)) ctx.edit(held).set(HeldView, next);
        else ctx.addComponent(held, HeldView, next);
      }
    },
    { name: "heldInput", access: { write: [HeldView, HeldPointer, HeldPress, HeldWheel] } },
  );
}
