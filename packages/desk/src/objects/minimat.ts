// The MINI MAT (MINIMAT.md) as an OBJECT — the desk's CONTAINER through `defineObject` (design-015
// §6): a small cutting mat lying on the big one with a desk inside it. Durable props: its printed
// `name` and its `vinyl` (sage — the desk's own — slate, charcoal: the product's colours through
// the palette, kinds/minimat.ts `MiniMatPalette`). Sheets, movable, selectable; a container that
// accepts notes and mini mats, its FACE — the inside's window — the sheet inset by the printed
// border (`portal` = `MINIMAT.margin` on every side, the same rect `faceOf` cuts). Flat in this
// slice: the inside's members, the chips, the live slot and the flight are D2b's.

import { p } from "@ice/core";
import { minimatKind } from "../kinds/minimat";
import { defineObject } from "../object";
import { NOTE_TYPE } from "./note";
import { MINIMAT } from "../minimat/theme";

/** The vinyls a mini mat is sold in (MINIMAT.md §2) — names; `sage` is the desk's ground, the rest the host's. */
export const VINYLS = ["sage", "slate", "charcoal"] as const;
export type VinylName = (typeof VINYLS)[number];

/** The mini mat's durable type id. */
export const MINIMAT_TYPE = "desk.minimat";

export const MiniMat = defineObject({
  type: MINIMAT_TYPE,
  version: 1,
  props: {
    name: p.string({ default: "" }),
    vinyl: p.enum(VINYLS, { default: "sage" }),
  },
  size: { w: MINIMAT.size.w, h: MINIMAT.size.h },
  kind: minimatKind(),
  interaction: { selectable: true, movable: true, resizable: false, snap: "both" },
  container: {
    accepts: [NOTE_TYPE, MINIMAT_TYPE],
    provides: [MINIMAT_TYPE],
    portal: { top: MINIMAT.margin, right: MINIMAT.margin, bottom: MINIMAT.margin, left: MINIMAT.margin },
  },
});
