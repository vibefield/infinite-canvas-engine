// The MINI MAT (MINIMAT.md) as an OBJECT — the desk's CONTAINER through `defineObject` (design-015
// §6): a small cutting mat lying on the big one with a desk inside it. Durable props: its printed
// `name` and its `vinyl` (sage — the desk's own — slate, charcoal: the product's colours through
// the palette, kinds/minimat.ts `MiniMatPalette`). Sheets, movable, selectable; a container that
// holds what provides `CONTAINABLE` (notes, mini mats — K8a), its FACE — the inside's window — the sheet inset by the printed
// border (`portal` = `MINIMAT.margin` on every side, the same rect `faceOf` cuts). Flat in this
// slice: the inside's members, the chips, the live slot and the flight are D2b's.

import { p } from "@ice/core";
import { minimatKind } from "./kind";
import { CONTAINABLE, DESK_OBJECT, defineObject } from "@ice/desk";
import { MINIMAT } from "./theme";

/** The vinyls a mini mat is sold in (MINIMAT.md §2) — names; `sage` is the desk's ground, the rest the host's. */
export const VINYLS = ["sage", "slate", "charcoal"] as const;
export type VinylName = (typeof VINYLS)[number];

/** The mini mat's durable type id. */
export const MINIMAT_TYPE = "desk.minimat";

/** Its selection-menu act's id (K8a): the vinyl cycles — an app's key (`t`) runs it through `ops.runMenuAction`. */
export const VINYL_ACT = "vinyl";
/** The act's glyph, the mat's own drawing in the bar's 24-unit box: a vinyl sample — a swatch with two strokes of its grain. */
const VINYL_GLYPH = "M6.5 5h11A1.5 1.5 0 0 1 19 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 17.5v-11A1.5 1.5 0 0 1 6.5 5ZM5 13l8-8M11 19l8-8";

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
  // its act in the selection menu (K8a — the kind's own, where the app's `t` key held it over the type name until then): the
  // selected mini mats' vinyl cycles sage → slate → charcoal, each mat one undo step; the inside's mat is the same vinyl, so it follows
  menu: [{
    id: VINYL_ACT, label: "Change the vinyl", keys: "T", glyph: { path: VINYL_GLYPH },
    run: (api) => {
      for (const e of api.entities) {
        const cur = api.props(e).vinyl;
        const next = VINYLS[(VINYLS.indexOf(cur as VinylName) + 1) % VINYLS.length] ?? VINYLS[0];
        api.setProps(e, { vinyl: next });
      }
    },
  }],
  container: {
    // it holds what provides `CONTAINABLE` (K8a — a note, a mini mat, a plugin kind that declares its chip), never a list of types;
    // and it lies on the desk, and in another mini mat, by what it provides itself
    accepts: [CONTAINABLE],
    provides: [MINIMAT_TYPE, DESK_OBJECT, CONTAINABLE],
    portal: { top: MINIMAT.margin, right: MINIMAT.margin, bottom: MINIMAT.margin, left: MINIMAT.margin },
  },
});
