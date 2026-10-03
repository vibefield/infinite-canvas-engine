/**
 * The button a press began with (petition I28) — read off the pointer's `PointerButtons.buttons` on its `WentDown` tick, which is
 * the down fact's own PointerEvent `buttons` mask (ingest's fold ends at the transition, l0-input.ts). A pointerdown carries the
 * one button that pressed: a second button joining a held press arrives as a pointermove (the Pointer Events spec's chorded
 * buttons), never as a down.
 *
 *   - PRIMARY — bit 1 (a mouse's left button, a touch, a pen's tip) or 32 (a pen's eraser end: the board's eraser reads it), or
 *     no bit at all (a synthetic down that names no button — every press, as before I28). The recognizers take it, and the hand.
 *   - MIDDLE — bit 4: a drag only where its drag pans — `dragRoute`'s device convention on the bare canvas (design-003 §4.4), the
 *     hand's pan brought close (held.ts) — and never a tap, a long press, or a grab of what is under it.
 *   - SECONDARY — anything else (2: the right button, a pen's barrel; 8/16: back and forward): a POINT. Its point, its pick and
 *     its hover move with it (ingest, `picking`); nothing selects, drags, enters or works a part. Its `contextmenu` is the host's.
 *
 * Pure over the ctx: no writes.
 */
import type { Entity, SystemCtx } from "@vibecook/strata-ecs";
import { CanvasSurface, HandleSpec, Port, Position } from "../catalog";

export type PressButton = "primary" | "middle" | "secondary";

/** The button a press began with, from the `buttons` mask its down carried. */
export function pressButton(buttons: number): PressButton {
  if (buttons === 0 || (buttons & (1 | 32)) !== 0) return "primary";
  return (buttons & 4) !== 0 ? "middle" : "secondary";
}

/**
 * Whether a MIDDLE press on `captured` is a drag: where `dragRoute` sends a drag to its CANVAS branch, whose device convention pans
 * — the bare canvas, or a capture that is no handle, no port and no object (a wire). Over a handle, a port or an object it is a
 * point: before I28 it resized, connected or MOVED what it landed on.
 */
export function middlePans(ctx: Pick<SystemCtx, "has" | "hasTag">, captured: Entity | undefined): boolean {
  if (captured === undefined || ctx.hasTag(captured, CanvasSurface)) return true;
  return !ctx.has(captured, HandleSpec) && !ctx.has(captured, Port) && !ctx.has(captured, Position);
}
