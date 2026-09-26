// The NOTEBOOK (NOTEBOOK.md — the real 3D book) as an OBJECT (design-015 §6; D3w): a clothbound book lying on
// the desk among its things. Durable props: its `title`, its `cover` and `ruling` by name (the covers' colours are
// the host's palette), its `seed` (the hand of its paper), the `spread` it is open at (the sheets turned onto the
// left) and its `angle` on the mat (the prototype kept it on the book; a new one takes its seed's — `bookAngle`).
// Its rect is the closed case (180 × 252); whether it lies OPEN is a pose — the opening is D4b's (a still pins it).
// Its INK (the four pens, the pages' strokes as data children `ChildOf` the book with their page) is D3t's.
// Things, movable, selectable, snapping both ways; a ROOT object (D-D18: `interaction.drop: "never"` — no container
// takes it, whatever it accepts).

import { p } from "@ice/core";
import { notebookKind } from "../kinds/notebook";
import { NOTEBOOK } from "../notebook/law";
import { defineObject } from "../object";

/** The covers a notebook is bound in (NOTEBOOK.md §4) — names; the cloths and designs are the host's. */
export const COVERS = ["ink", "orbit", "tiles", "label", "linen"] as const;
export type CoverName = (typeof COVERS)[number];

/** The rulings its pages are printed with (notebook/layout.ts `RULINGS`). */
export const RULING_NAMES = ["plain", "dots", "rules", "grid"] as const;

/** The notebook's durable type id. */
export const NOTEBOOK_TYPE = "desk.notebook";

export const Notebook = defineObject({
  type: NOTEBOOK_TYPE,
  version: 1,
  props: {
    title: p.string({ default: "" }),
    cover: p.enum(COVERS, { default: "orbit" }),
    ruling: p.enum(RULING_NAMES, { default: "dots" }),
    seed: p.number({ default: 0 }),
    spread: p.number({ default: 0 }),
    angle: p.number({ default: 0 }),
  },
  size: { w: NOTEBOOK.cover.width, h: NOTEBOOK.cover.height },
  kind: notebookKind(),
  interaction: { selectable: true, movable: true, resizable: false, snap: "both", drop: "never" },
});
