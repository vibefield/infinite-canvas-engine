/**
 * The desk's vocabulary (design-015 §4.2, §5.1 — D2a-core, 2026-09-25).
 *
 * ADDITIVE: nothing in the DOM/GL paths reads or writes these, and a board of
 * pre-desk widgets carries none of them, so every existing order and every
 * existing gesture is what it was.
 *
 * - `Stratum` — which stratum of the desk an object lies in. A runtime rider
 *   exactly like the capability tags: derivable from the widget TYPE (its
 *   declared `stratum`, an `object` defaulting to `things`), so equip stamps it
 *   at projection on every peer and nothing syncs it (design-013 D4's argument
 *   for `SurfaceKind`, applied to the one presentation fact that survives the
 *   desk). `compareStackOrder` reads it FIRST, so pick order is paint order
 *   across kinds (design-015 §4.2's table, D-D4).
 * - `Locked` — the tape (*Marks on the Mat* Q-e): a taped widget is never
 *   moved or resized by a gesture (moveClaim and resizeClaim give it no rider)
 *   and the marquee passes over it (Q-g), yet it stays selectable, pickable and
 *   openable. A DURABLE TAG — document truth that syncs and undoes — with one
 *   writer, `ops.setLocked` (one transaction). A tag rather than a zero-field
 *   component because a marker IS strata's tag ("a zero-sized marker", its own
 *   `defineTag` doc) and *Marks on the Mat* named it one; the document holds one
 *   `tag:Locked` register per entity. Tags are not prefab-eligibility-checked
 *   (guards/guarded-tx.ts header — "optional-tag modeling is future work"), so
 *   any durable widget carries it with no prefab declaration.
 */
import { field } from "@vibecook/strata-ecs";
import { defineComponent, defineTag } from "../schema/meta";

/** A desk stratum an object can declare (design-015 §4.2). The mat, the held set and the marks are the renderer's, never declared. */
export type DeskStratum = "pads" | "sheets" | "things";

/**
 * `Stratum.band` per declared stratum — ascending = paint order: pads lie under
 * everything on a desk (the calendar pad), sheets lie flat on the mat and hold a
 * desk (the mini mats), things are every other object.
 */
export const STRATUM_BANDS: Readonly<Record<DeskStratum, number>> = Object.freeze({
  pads: 0,
  sheets: 1,
  things: 2,
});

/**
 * The band an entity WITHOUT a `Stratum` sorts in: things. Every pre-desk widget
 * is one, so an all-dom board stays in one band and its order is exactly its
 * sibling order, as before (design-015 §4.2: "things … every future kind").
 */
export const DEFAULT_STRATUM_BAND = STRATUM_BANDS.things;

/** Runtime: the object's desk stratum (equip, from the type's `stratum`). Read by `compareStackOrder`. */
export const Stratum = defineComponent("Stratum", {
  band: field("u8", { default: DEFAULT_STRATUM_BAND }),
});

/** Durable: taped down (design-015 §5.1, Q-e). One writer: `ops.setLocked`. */
export const Locked = defineTag("Locked");
