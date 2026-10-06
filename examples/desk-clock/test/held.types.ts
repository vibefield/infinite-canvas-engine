// THE NAMES A HOST READS OFF THE SELECTION (petition I36): a host that draws the held bar itself (VibeField's tools-in-hand
// controller, over `handle.selection`) takes the anchor's hand — `HeldAnchor`: its tools, the mode in hand, its landing, its travel,
// its readout — and each slot in it — `HeldSlot`: id, label, kind, hint, glyph, swatch — by NAME from `@vibecook/ice/desk`, never
// re-derived structurally (`NonNullable<SelectionAnchor["held"]>` passes a field ICE renames without a word). Type-only, no runtime:
// dts:check (scripts/dts-check.mjs) compiles this module beside the clock's src/ against the umbrella's BUILT declarations, so each
// name is one the package ships; the equalities pin each name to the part of the anchor it names.
import type { HeldAnchor, HeldGlyph, HeldSlot, SelectionAnchor } from "@vibecook/ice/desk";

/** Exact type equality (a mutual-assignability check would let an added optional field through). */
type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** The anchor's hand is `HeldAnchor`; its slots are `HeldSlot`; a slot's glyph is `HeldGlyph`. */
export const NAMED: readonly [
  Same<NonNullable<SelectionAnchor["held"]>, HeldAnchor>,
  Same<HeldAnchor["tools"][number], HeldSlot>,
  Same<NonNullable<HeldSlot["glyph"]>, HeldGlyph>,
] = [true, true, true];

/** What a host's bar draws from the anchor: the slots and the word in hand — nothing while nothing is held or it flies home. */
export function heldBar(anchor: SelectionAnchor): { readonly slots: readonly HeldSlot[]; readonly active: string; readonly readout?: string } | undefined {
  const held: HeldAnchor | undefined = anchor.held;
  if (held === undefined || held.landing) return undefined;
  return { slots: held.tools, active: held.active, ...(held.readout !== undefined ? { readout: held.readout } : {}) };
}
