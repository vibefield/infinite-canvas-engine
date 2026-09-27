// The MINI MAT (MINIMAT.md) as an OBJECT — the desk's CONTAINER through `defineObject` (design-015
// §6): a small cutting mat lying on the big one with a desk inside it. Durable props: its printed
// `name` and its `vinyl` (sage — the desk's own — slate, charcoal: the product's colours through
// the palette, kinds/minimat.ts `MiniMatPalette`). Sheets, movable, selectable; a container that
// accepts notes and mini mats, its FACE — the inside's window — the sheet inset by the printed
// border (`portal` = `MINIMAT.margin` on every side, the same rect `faceOf` cuts). Flat in this
// slice: the inside's members, the chips, the live slot and the flight are D2b's.

import { p } from "@ice/core";
import { minimatKind } from "./kind";
import { defineObject } from "@ice/desk";
import { MINIMAT } from "./theme";

/** The vinyls a mini mat is sold in (MINIMAT.md §2) — names; `sage` is the desk's ground, the rest the host's. */
export const VINYLS = ["sage", "slate", "charcoal"] as const;
export type VinylName = (typeof VINYLS)[number];

/** The mini mat's durable type id. */
export const MINIMAT_TYPE = "desk.minimat";

/**
 * The note's durable type id, which a mini mat accepts: core's container list is by TYPE NAME, resolved when something is dropped
 * in, so the mini mat names the note as a plugin container would — never by importing it (K4a, design-016 K-L1; test/kind-names.test.ts
 * pins it to the note's own `NOTE_TYPE`). K8 turns `accepts` into provides-keys.
 */
const NOTE_TYPE = "desk.note";

export const MiniMat = defineObject({
  type: MINIMAT_TYPE,
  version: 1,
  props: {
    name: p.string({ default: "" }),
    vinyl: p.enum(VINYLS, { default: "sage" }),
  },
  size: { w: MINIMAT.size.w, h: MINIMAT.size.h },
  kind: minimatKind(),
  // on the pegboard tray (design-017 §8): a mini mat on a shelf
  tray: { label: "Mini mat", category: "surface", order: 0, hang: { w: 213, h: 160, accessory: "shelf", pegs: [[-2, 0.5], [2, 0.5]] } },
  interaction: { selectable: true, movable: true, resizable: false, snap: "both" },
  container: {
    accepts: [NOTE_TYPE, MINIMAT_TYPE],
    provides: [MINIMAT_TYPE],
    portal: { top: MINIMAT.margin, right: MINIMAT.margin, bottom: MINIMAT.margin, left: MINIMAT.margin },
  },
});
