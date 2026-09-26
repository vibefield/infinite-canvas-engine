/**
 * The desk's drag modifiers (design-015 §7, *Marks on the Mat*'s keys; D4a) — read off the recognizer's
 * WATCHED pointer, whose `PointerMods` is the pointer's latched sample (design-003 §4.5; the keyboard
 * carries only key events), so a modifier pressed or let go mid-drag takes effect on the next frame:
 *
 *   - ⇧ locks the drag to ONE axis — its dominant one, recomputed from the total each frame (the page's
 *     `if (|dx| > |dy|) dy = 0 else dx = 0`); the snap then corrects only along the free axis.
 *   - ⌘ (or Ctrl) held holds the snap off.
 *   - ⌥ as the drag STARTS leaves a copy behind (moveClaim latches it as `LeavesCopy` on the recognizer;
 *     the release commits the copies with the move — one gesture, one undo step).
 *
 * Shared by the snap system and the move behavior, so the delta the snap aligns is the delta the move
 * writes. Pure over the ctx: no writes.
 */
import type { Entity, SystemCtx } from "@vibecook/strata-ecs";
import { Drag, PointerMods, Watches } from "../catalog";

export interface DragMods {
  readonly shift: boolean;
  readonly alt: boolean;
  readonly meta: boolean;
  readonly ctrl: boolean;
}
const NONE: DragMods = { shift: false, alt: false, meta: false, ctrl: false };

/** The recognizer's watched pointer's modifiers now (none when it watches no pointer). */
export function watchedMods(ctx: Pick<SystemCtx, "getRelations" | "get">, rec: Entity): DragMods {
  const pointer = ctx.getRelations(rec, Watches)[0];
  const m = pointer === undefined ? undefined : ctx.get(pointer, PointerMods);
  return m === undefined ? NONE : { shift: m.shift, alt: m.alt, meta: m.meta, ctrl: m.ctrl };
}

/** ⌘ or Ctrl held: the snap stands down for this frame. */
export const snapHeldOff = (mods: DragMods): boolean => mods.meta || mods.ctrl;

/**
 * A move drag's WORLD delta: the screen total over the zoom at its claim, locked to its dominant axis while ⇧ is
 * held. `lock` names the axis it runs along (`x` = horizontally, its y held), null when free.
 */
export function moveDelta(ctx: Pick<SystemCtx, "read" | "getRelations" | "get">, rec: Entity): { readonly x: number; readonly y: number; readonly lock: "x" | "y" | null } {
  const d = ctx.read(rec, Drag);
  const x = d.totalX / d.zoomAtClaim;
  const y = d.totalY / d.zoomAtClaim;
  if (!watchedMods(ctx, rec).shift) return { x, y, lock: null };
  return Math.abs(x) > Math.abs(y) ? { x, y: 0, lock: "x" } : { x: 0, y, lock: "y" };
}
