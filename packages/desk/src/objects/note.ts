// The NOTE (STICKY.md) as an OBJECT — the desk's first reference kind through `defineObject`
// (design-015 §6): a sheet of paper on the mat. Durable props: its writing — `text`, and `seeds`, each
// glyph's own hand (paper/seeds.ts; D-D13: the seeds persist or a reload re-draws the hand) — in ONE
// conflict group, `ink`, so the two are one cell written in one transaction and a concurrent edit can
// never pair one peer's text with another's seeds (D2c); its pen and its paper by name (the product's
// colours through the palette, kinds/paper.ts `PaperPalette`), and its `seed` — the tilt it is stuck
// at, never square (`tiltOf`), and the hand of a glyph with no stored seed. Things, movable,
// selectable, snapping both ways; it offers itself to a mini mat (`provides`) — D2b's drop-into.

import { type Component, type Entity, p } from "@ice/core";
import { paperKind } from "../kinds/paper";
import type { KindDriver } from "../kinds/world";
import { defineObject } from "../object";
import type { Writing } from "../paper/writing";
import { PAPER } from "../paper/theme";
import { createNoteTyping, type NoteTyping } from "./typing";

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
    seeds: p.string({ default: "" }),
    pen: p.enum(PENS, { default: "fountain" }),
    paper: p.enum(PAPERS, { default: "yellow" }),
    seed: p.number({ default: 0 }),
  },
  groups: { ink: ["text", "seeds"] },
  size: { w: PAPER.size, h: PAPER.size },
  kind: paperKind(),
  interaction: { selectable: true, movable: true, resizable: false, snap: "both" },
  provides: [NOTE_TYPE],
  // TYPING IS A GESTURE (design-015 §6.1; D2c): the note's driver is its typing session — the world half the ONE focused editor
  // (host/editor.ts) drives; it follows nothing on its own (D-D7-A.3)
  drivers: (h): PaperDriver => ({
    typing: createNoteTyping({ world: h.world, docs: h.docs, ink: NOTE_INK, props: NOTE_PROPS }),
    writing: () => h.local as Writing | undefined,
    isNote: h.isKind,
    follow: () => {},
    idle: () => true,
  }),
});

/** The note's writing as a cell (`desk.note:ink` — `{ text, seeds }`): what a typing session live-writes and commits whole. */
export const NOTE_INK = groupOf("ink") as Component<{ text: string; seeds: string }>;
/** The note's other props (`desk.note:props` — `{ pen, paper, seed }`). */
export const NOTE_PROPS = groupOf("props") as Component<{ pen: string; paper: string; seed: number }>;

/** The note's driver (`driversOf(Note)`): its typing session, its writing local and its membership — what the editor asks of it. */
export interface PaperDriver extends KindDriver {
  readonly typing: NoteTyping;
  readonly writing: () => Writing | undefined;
  readonly isNote: (e: Entity) => boolean;
}

function groupOf(name: string): Component {
  const g = Note.groups.find((q) => q.name === name);
  if (g === undefined) throw new Error(`desk: the note has no "${name}" group`);
  return g.component;
}
