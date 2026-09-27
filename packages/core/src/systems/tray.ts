/**
 * TRAY INPUT (design-016 §7; design-017 §4 — K3) — the pegboard drawer's share of the pointer, beside the hand's (systems/held.ts)
 * and in its vocabulary. Right after `heldInput` at the head of `react`: the ingest's one-tick tags are flushed by then (a press is
 * visible), and what this stamps flushes before `ctl`, so picking, the recognizers and both wheel consumers never hear of what the
 * tray takes. While an object is in hand the tray stands aside (the hand's frame never draws it).
 *
 *  - CLOSED, only the lip's HANDLE is the tray's — its finger notch, `handlePx` either side of the centre (D-K3.10: the lip is drawn
 *    the drawer's whole width, but a strip that wide would take the view's bottom edge from the desk — a calendar filling the view
 *    has its foot there): the mouse over it is `Tray.lip` (the hover that lifts the lip); a press there is `TrayPress lip`
 *    (`HandledByWidget` — never a desk gesture) and a click, or a drag up past `lipDragPx`, opens the drawer. Everything else — the
 *    rest of the lip included — is the desk's, untouched.
 *  - OPEN, the desk is INERT: every local pointer gets the one-tick `HandledByWidget` and `WheelHandled`, each tick, as the hand's
 *    do — so "the wheel never moves the camera" is not a rule the camera keeps; it is a fact the camera never hears about. Over the
 *    drawer the wheel scrolls it (`dy`; the OS's momentum arrives as deltas and is applied as it comes — no inertia of ours; ⌘/ctrl
 *    and a pinch are swallowed) and a press-drag scrolls it; past an end the rest is the band's `stretch` (a reversal unwinds it
 *    first), which lets go once the scroll input has been quiet `letGoMs`. A click on the dimmed desk — pressed and released there,
 *    unmoved — closes it.
 *
 * Where the drawer is comes through the SEAM `TrayPoseSlot` beside `heldPose`: the renderer's word on the drawer as it DREW it this
 * frame (its rect mid-slide, the scroll range its layout gives), so a hit and the clamp agree with the pixels. Nothing here reads a
 * kind or a pixel; opening a drawer cancels every gesture in flight (`CancelRequest`, read by the `ctl:spawn` sweep this tick).
 */
import type { Entity, System, World } from "@vibecook/strata-ecs";
import { defineQuery, defineSystem } from "@vibecook/strata-ecs";
import { Tray, TrayPress } from "../catalog/desk";
import { HandledByWidget, LocalPointer, Pointer, PointerButtons, PointerMods, PointerScreen, PointerWheel, WentCancelled, WentDown, WentUp, WheelHandled } from "../catalog/pointer";
import { FrameInfo } from "../engine/frame-info";
import { cancelActiveGestures } from "../ops/gestures";
import { heldEntity } from "./held";

/** The drawer ON SCREEN as the renderer drew it this frame, CSS px: its outline box (top-left, width, full height — the part below the view included), the slide `p` (0 closed … 1 open), and the scroll range `max` its layout gives. */
export interface TrayScreenFrame {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly p: number;
  readonly max: number;
}

/** The pose seam: the renderer's word on where the drawer is — `undefined` before its first frame. */
export interface TrayPoseSource { frame(): TrayScreenFrame | undefined }

/** The stack's slot for the pose source — a mutable box, so the renderer can arrive after install (as `heldPose`). */
export interface TrayPoseSlot { current: TrayPoseSource | null }

/** The tray's input numbers (design-017 §7): a click's slop, the lip's drag up that opens, its handle's reach either side of the centre and its hit pad above what is drawn, how long the scroll input must be quiet before the band lets go. */
export const TRAY_INPUT = { slopPx: 4, lipDragPx: 10, handlePx: 60, lipPadPx: 8, letGoMs: 120 } as const;

const trayQ = defineQuery([Tray]);
const localPointerQ = defineQuery([Pointer, PointerScreen, LocalPointer]);

/** A delta down the board into scroll ∈ [0, max], the rest into the band; a delta back unwinds the band first. */
export function scrollBy(scroll: number, stretch: number, d: number, max: number): { readonly scroll: number; readonly stretch: number } {
  let s = scroll;
  let b = stretch;
  let rest = d;
  if (b !== 0 && Math.sign(rest) !== Math.sign(b)) {
    const back = Math.sign(b) * Math.min(Math.abs(b), Math.abs(rest));
    b -= back;
    rest += back;
  }
  if (b === 0 && rest !== 0) {
    const next = Math.min(Math.max(s + rest, 0), Math.max(max, 0));
    const took = next - s;
    s = next;
    rest -= took;
  }
  return { scroll: s, stretch: b + rest };
}

export function createTrayInput(world: World, opts: { readonly pose: TrayPoseSlot }): System {
  return defineSystem(
    localPointerQ,
    (b, ctx) => {
      const tray: Entity | undefined = world.firstOf(trayQ);
      if (tray === undefined || !ctx.isAlive(tray)) return;
      const t = ctx.read(tray, Tray);
      if (heldEntity(world) !== undefined) {
        // the hand's focus: the tray stands aside, its presses let go
        for (const r of b) { const p = b.entity(r); if (ctx.has(p, TrayPress)) ctx.removeComponent(p, TrayPress); }
        if (t.lip) ctx.edit(tray).set(Tray, { ...t, lip: false });
        return;
      }
      const frame = opts.pose.current?.frame();
      const now = world.getResource(FrameInfo)?.now ?? 0;
      const max = Math.max(0, frame?.max ?? 0);
      let open = t.open;
      let scroll = t.scroll;
      let stretch = t.stretch;
      let wheelAt = t.wheelAt;
      let lip = false;
      let dragging = false;
      const over = (x: number, y: number, pad: number): boolean =>
        frame !== undefined && x >= frame.x && x <= frame.x + frame.w && y >= frame.y - pad;
      // the lip's handle: the notch, `handlePx` either side of the drawer's centre
      const onHandle = (x: number, y: number): boolean =>
        frame !== undefined && Math.abs(x - (frame.x + frame.w / 2)) <= TRAY_INPUT.handlePx && y >= frame.y - TRAY_INPUT.lipPadPx;
      for (const r of b) {
        const p = b.entity(r);
        const s = ctx.read(p, PointerScreen);
        // a down the ingest already flagged is DOM chrome's (design-002 §8): it stays the chrome's — the drawer never takes it
        const chrome = ctx.hasTag(p, HandledByWidget);
        const down = ctx.hasTag(p, WentDown) && !chrome && ((ctx.get(p, PointerButtons)?.buttons ?? 0) & 1) !== 0;
        const press = ctx.get(p, TrayPress);
        if (!open) {
          const onLip = onHandle(s.x, s.y);
          if (onLip && ctx.read(p, Pointer).device === "mouse") lip = true;
          if (down && onLip) {
            ctx.addComponent(p, TrayPress, { kind: "lip", x: s.x, y: s.y, scroll0: scroll, moved: false });
            if (!ctx.hasTag(p, HandledByWidget)) ctx.addTag(p, HandledByWidget);
            continue;
          }
          if (press === undefined) continue;
          // a lip press (its down was stamped, so no recognizer ever saw it): a click or a drag up opens
          const moved = press.moved || Math.hypot(s.x - press.x, s.y - press.y) > TRAY_INPUT.slopPx;
          const ended = ctx.hasTag(p, WentUp) || ctx.hasTag(p, WentCancelled);
          const up = press.y - s.y >= TRAY_INPUT.lipDragPx;
          if (up || (ctx.hasTag(p, WentUp) && !moved)) {
            open = true;
            lip = false;
            cancelActiveGestures(world);
            ctx.removeComponent(p, TrayPress);
          } else if (ended) ctx.removeComponent(p, TrayPress);
          else if (moved !== press.moved) ctx.edit(p).set(TrayPress, { ...press, moved });
          continue;
        }
        // OPEN: the desk is inert — picking, the recognizers and both wheel consumers skip this pointer this tick
        if (!ctx.hasTag(p, HandledByWidget)) ctx.addTag(p, HandledByWidget);
        if (!ctx.hasTag(p, WheelHandled)) ctx.addTag(p, WheelHandled);
        const w = ctx.get(p, PointerWheel);
        if (w !== undefined && (w.dy !== 0 || w.dx !== 0 || w.pinch !== 0) && over(s.x, s.y, 0)) {
          const mods = ctx.get(p, PointerMods);
          if (w.pinch === 0 && mods?.ctrl !== true && mods?.meta !== true && w.dy !== 0) {
            ({ scroll, stretch } = scrollBy(scroll, stretch, w.dy, max));
            wheelAt = now;
          }
        }
        if (down) {
          const kind = over(s.x, s.y, 0) ? "board" : "desk";
          const next = { kind, x: s.x, y: s.y, scroll0: scroll + stretch, moved: false } as const;
          if (press !== undefined) ctx.edit(p).set(TrayPress, next);
          else ctx.addComponent(p, TrayPress, next);
          if (kind === "board") dragging = true;
          continue;
        }
        if (press === undefined) continue;
        const moved = press.moved || Math.hypot(s.x - press.x, s.y - press.y) > TRAY_INPUT.slopPx;
        const ended = ctx.hasTag(p, WentUp) || ctx.hasTag(p, WentCancelled);
        if (press.kind === "board" && !ended) {
          // the board under the finger: where it began, less how far the pointer travelled — past an end, the band
          if (moved) {
            const target = press.scroll0 - (s.y - press.y);
            scroll = Math.min(Math.max(target, 0), max);
            stretch = target - scroll;
            wheelAt = now;
          }
          dragging = true;
        }
        if (ended) {
          if (press.kind === "desk" && ctx.hasTag(p, WentUp) && !moved) open = false;
          ctx.removeComponent(p, TrayPress);
        } else if (moved !== press.moved) ctx.edit(p).set(TrayPress, { ...press, moved });
      }
      // the band lets go once the scroll input is quiet — never under a finger still dragging the board — and as the drawer closes
      if (stretch !== 0 && ((!dragging && now - wheelAt > TRAY_INPUT.letGoMs) || !open)) stretch = 0;
      if (open !== t.open || scroll !== t.scroll || stretch !== t.stretch || wheelAt !== t.wheelAt || lip !== t.lip) {
        ctx.edit(tray).set(Tray, { open, scroll, stretch, lip: open ? false : lip, wheelAt });
      }
    },
    { name: "trayInput", access: { write: [Tray, TrayPress] } },
  );
}
