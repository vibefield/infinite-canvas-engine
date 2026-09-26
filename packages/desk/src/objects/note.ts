// The NOTE (STICKY.md) as an OBJECT — the desk's first reference kind through `defineObject`
// (design-015 §6): a sheet of paper on the mat. Durable props: its writing (`text` — unused until
// D2c's text stack draws it), its pen and its paper by name (the product's colours through the
// palette, kinds/paper.ts `PaperPalette`), and its `seed` — the tilt it is stuck at, never square
// (`tiltOf`), and at D2c each glyph's hand. Things, movable, selectable, snapping both ways; it
// offers itself to a mini mat (`provides`) — D2b's drop-into.

import { p } from "@ice/core";
import { paperKind } from "../kinds/paper";
import { defineObject } from "../object";
import { PAPER } from "../theme";

/** The pens a note is written with (STICKY.md §3) — names; the inks are the host's. */
export const PENS = ["felt", "ball", "fountain", "red"] as const;
export type PenName = (typeof PENS)[number];
/** The papers a note is cut from — names; the sheets are the host's (the product's `--vf-note-surface` is `yellow`). */
export const PAPERS = ["yellow"] as const;
export type PaperName = (typeof PAPERS)[number];

/** The note's durable type id — what `PrefabId` carries and a mini mat accepts. */
export const NOTE_TYPE = "desk.note";

export const Note = defineObject({
  type: NOTE_TYPE,
  version: 1,
  props: {
    text: p.string({ default: "" }),
    pen: p.enum(PENS, { default: "fountain" }),
    paper: p.enum(PAPERS, { default: "yellow" }),
    seed: p.number({ default: 0 }),
  },
  size: { w: PAPER.size, h: PAPER.size },
  kind: paperKind(),
  interaction: { selectable: true, movable: true, resizable: false, snap: "both" },
  provides: [NOTE_TYPE],
});
