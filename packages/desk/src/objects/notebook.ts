// The NOTEBOOK (NOTEBOOK.md — the real 3D book) as an OBJECT (design-015 §6; D3w): a clothbound book lying on
// the desk among its things. Durable props: its `title`, its `cover` and `ruling` by name (the covers' colours are
// the host's palette), its `seed` (the hand of its paper), the `spread` it is open at (the sheets turned onto the
// left) and its `angle` on the mat (the prototype kept it on the book; a new one takes its seed's — `bookAngle`).
// Its rect is the closed case (180 × 252); whether it lies OPEN is a pose — the opening is D4b's (a still pins it).
// What is WRITTEN in it is not a prop: its INK is its DATA CHILDREN (D3t-b) — `desk.stroke` entities `ChildOf` the book,
// each on its `page` in page units, laid by the pen in hand (one transaction a stroke; board/data.ts), the pages' rasters a
// cache replayed from them (kinds/notebook.ts). `spread` moves with a completed turn, off the undo stack (D-D3t-b.2).
// Things, movable, selectable, snapping both ways; a ROOT object (D-D18: `interaction.drop: "never"` — no container
// takes it, whatever it accepts).

import { p } from "@ice/core";
import { StrokePrefab } from "../kit/strokes";
import { type Books, notebookKind } from "../kinds/notebook";
import { NOTEBOOK } from "../notebook/law";
import { defineObject } from "../object";
import { createNotebookHand } from "./leaf";

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
  // its strokes are its DATA (D3t-b, the Board's prefab): the catalog stamps, gates and migrates them with the book
  data: [StrokePrefab],
  // the notebook in hand (D3t-b): its pen and its LEAVES — the hand onto the notebook kind's state, each stroke ONE transaction out of the frame (D-D7-A.3)
  drivers: (h) => createNotebookHand({
    world: h.world, docs: h.docs, books: () => h.local as Books | undefined, isBook: h.isKind, heldToWorld: h.heldToWorld, geometryOf: h.geometryOf,
    props: Notebook.groups[0]?.component,
  }),
});
