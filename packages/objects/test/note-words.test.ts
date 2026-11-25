// @vitest-environment happy-dom
// WHERE THE NOTE'S WORDS LIE (petition I60 — "the selection bar comes to the words"): the desk's anchor carries a box over the words
// selected while a part is written, and asks the part where they are — the lease's new `rangeBox(from, to)`, a world box, axis-aligned.
// The note answers it from what it last drew: the union of the range's glyph boxes in its layout (a space or a break, which has no
// glyph, by its own cell: from its place to the next on its line, the face's box tall), placed on the sheet as drawn — for a sheet stuck
// at its tilt, the box of the turned corners. Nothing for an empty range, or before the note was drawn. The note declares no words act
// yet (the ink's acts are the next slice's). On the real pieces: the desk's editor, the note's body and typing, a writing the note was
// drawn into once.
import { Camera, createCanvasEngine, type Entity, Position, Size, Viewport } from "@ice/core";
import { createDeskEditor, MAT_GRID } from "@ice/desk";
import { glyphBox, type HandLayout, type HandMetrics, type TextPart, type TextRaster } from "@ice/desk/kit";
import { afterEach, describe, expect, it } from "vitest";
import { createNoteBody, NOTE_INK, NOTE_PROPS, Note, type PaperDriver } from "../src";
import { InkShelves, uvOf } from "../src/paper/pages";
import { DEFAULT_PAPER_LAW, lampOf, type PaperGeometry, resolvePaper, worldOf } from "../src/paper/paper";
import { createNoteTyping } from "../src/paper/typing";
import { createWriting, type Writing } from "../src/paper/writing";

afterEach(() => { document.body.innerHTML = ""; });

/** A face every glyph of which is half an em wide (writing.test.ts's), and pages over the real shelves. */
const METRICS: HandMetrics = { ascent: 0.8, descent: 0.2, advance: () => 0.5 };
const TEXT_RASTER: TextRaster = {
  metrics: () => METRICS,
  version: () => 1,
  raster: (_L, _face, box, band) => { const w = Math.max(1, Math.ceil(box.w * band)); const h = Math.max(1, Math.ceil(box.h * band)); return { bytes: new Uint8Array(w * h), w, h }; },
};
const WORDS = "the quick brown fox jumps\ndog's 2nd bone";

/** A note drawn once at `angle` (its sheet's tilt) into a writing, the desk's editor and the note's body over it. */
function rig(angle = 0) {
  const ce = createCanvasEngine({ widgets: [Note] });
  ce.docs.create();
  const { world } = ce;
  world.setResource(Viewport, { w: 1200, h: 800, dpr: 1 });
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const typing = createNoteTyping({ world, docs: ce.docs, ink: NOTE_INK, props: NOTE_PROPS });
  const shelves = new InkShelves(2048, 2);
  const writing: Writing = createWriting({ pages: () => ({ alloc: (w, h) => shelves.alloc(w, h), free: (r) => shelves.free(r), write: (r) => uvOf(r.x, r.y, r.w, r.h, 2048, 2048), reset: () => shelves.reset() }), text: TEXT_RASTER });
  const driver: PaperDriver = { typing, writing: () => writing, isNote: (e) => world.get(e, NOTE_INK) !== undefined, body: undefined, follow: () => {}, idle: () => true };
  const note = ce.ops.spawnWidget("desk.note", { x: 100, y: 100, props: { seed: 7, text: WORDS }, undoable: false }) as Entity;
  world.sync();
  ce.step(16);
  ce.step(32);
  const pos = world.get(note, Position) ?? { x: 0, y: 0 };
  const size = world.get(note, Size) ?? { w: 0, h: 0 };
  const rect = { cx: pos.x + size.w / 2, cy: pos.y + size.h / 2, w: size.w, h: size.h };
  const G: PaperGeometry = resolvePaper({ ...rect, angle }, { held: 0, ring: 0, fade: 1 }, DEFAULT_PAPER_LAW, lampOf(MAT_GRID.plane));
  const parts: TextPart[] = [];
  const editor = createDeskEditor({ container, world, parts: () => parts, wake: () => {} });
  const body = createNoteBody({ editor, world, driver, geometryOf: () => G });
  if (body === undefined) throw new Error("no body");
  parts.push(body);
  return {
    ce, writing, editor, body, note, rect, G,
    /** The note drawn ONCE: its layout and its geometry in the writing. */
    draw(): HandLayout {
      writing.tick(16);
      writing.draw(note, { text: WORDS, seeds: "", seed: 7 }, rect, { camX: 0, camY: 0, zoom: 1, width: 1200, height: 800, dpr: 1 }, G);
      const L = writing.layoutOf(note);
      if (L === undefined) throw new Error("no layout");
      return L;
    },
    dispose: () => { editor.dispose(); ce.dispose(); },
  };
}

/** A note-units box (from the sheet's top-left) placed on sheet `G` of a `w × h` note: the world box of its four corners, turned. */
function placed(G: PaperGeometry, w: number, h: number, b: { x0: number; y0: number; x1: number; y1: number }): { x: number; y: number; w: number; h: number } {
  const corners = [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]].map(([nx, ny]) => worldOf(G, ((nx as number) - w / 2) * G.scale, ((ny as number) - h / 2) * G.scale));
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}
/** The union of the glyph boxes of [from, to) in `L`, note units. */
function glyphUnion(L: HandLayout, from: number, to: number): { x0: number; y0: number; x1: number; y1: number } {
  const boxes = L.glyphs.filter((g) => g.index >= from && g.index < to).map((g) => glyphBox(L, g));
  return { x0: Math.min(...boxes.map((b) => b.x0)), y0: Math.min(...boxes.map((b) => b.y0)), x1: Math.max(...boxes.map((b) => b.x1)), y1: Math.max(...boxes.map((b) => b.y1)) };
}
const close = (a: { x: number; y: number; w: number; h: number } | undefined, b: { x: number; y: number; w: number; h: number }): void => {
  expect(a).toBeDefined();
  for (const k of ["x", "y", "w", "h"] as const) expect(a?.[k]).toBeCloseTo(b[k], 6);
};

describe("the note says where a range of its words lies (petition I60)", () => {
  it("the union of the range's glyph boxes as last laid, on the sheet in the world — through the lease and the writing alike", () => {
    const r = rig();
    try {
      const L = r.draw();
      expect(WORDS.slice(4, 9)).toBe("quick");
      const want = placed(r.G, r.rect.w, r.rect.h, glyphUnion(L, 4, 9));
      close(r.writing.rangeBox(r.note, 4, 9), want);
      // unturned and unscaled, the note's own units are the world's from its top-left
      const u = glyphUnion(L, 4, 9);
      close(r.writing.rangeBox(r.note, 4, 9), { x: r.rect.cx - r.rect.w / 2 + u.x0, y: r.rect.cy - r.rect.h / 2 + u.y0, w: u.x1 - u.x0, h: u.y1 - u.y0 });
      // the lease answers the writing's — the anchor asks it
      expect(r.body.focus(r.note, 0)).toBe(true);
      expect(r.editor.lease()?.rangeBox?.(4, 9)).toEqual(r.writing.rangeBox(r.note, 4, 9));
      // across a break: both lines' glyphs
      expect(WORDS.slice(20, 30)).toBe("jumps\ndog'");
      close(r.writing.rangeBox(r.note, 20, 30), placed(r.G, r.rect.w, r.rect.h, glyphUnion(L, 20, 30)));
    } finally { r.dispose(); }
  });

  it("a space has no glyph and is placed by its own cell: from its place to the next on its line, the face's box tall", () => {
    const r = rig();
    try {
      const L = r.draw();
      expect(WORDS[3]).toBe(" ");
      const x = L.positions[6] as number;
      const y = L.positions[7] as number;
      const next = L.positions[8] as number;
      close(r.writing.rangeBox(r.note, 3, 4), placed(r.G, r.rect.w, r.rect.h, { x0: x, y0: y - L.ascent, x1: next, y1: y + L.descent }));
      // the break that ends a line takes no width there: its line's end, the face's box tall
      const nl = WORDS.indexOf("\n");
      const bx = L.positions[2 * nl] as number;
      const by = L.positions[2 * nl + 1] as number;
      close(r.writing.rangeBox(r.note, nl, nl + 1), placed(r.G, r.rect.w, r.rect.h, { x0: bx, y0: by - L.ascent, x1: bx, y1: by + L.descent }));
    } finally { r.dispose(); }
  });

  it("turned with its sheet: the world box of the range's turned corners", () => {
    const r = rig(0.3);
    try {
      const L = r.draw();
      const u = glyphUnion(L, 4, 9);
      const box = r.writing.rangeBox(r.note, 4, 9);
      close(box, placed(r.G, r.rect.w, r.rect.h, u));
      // wider and taller than the unturned box of the same letters: the corners swing out
      expect(box?.w ?? 0).toBeGreaterThan(u.x1 - u.x0);
      expect(box?.h ?? 0).toBeGreaterThan(u.y1 - u.y0);
    } finally { r.dispose(); }
  });

  it("nothing for an empty range, a range off the text, or a note not drawn yet", () => {
    const r = rig();
    try {
      expect(r.writing.rangeBox(r.note, 4, 9)).toBeUndefined();   // not drawn: no layout, no geometry
      r.body.focus(r.note, 0);
      expect(r.editor.lease()?.rangeBox?.(4, 9)).toBeUndefined();
      r.draw();
      expect(r.writing.rangeBox(r.note, 4, 4)).toBeUndefined();
      expect(r.writing.rangeBox(r.note, 9, 4)).toBeDefined();   // held in order, as the selection is
      expect(r.writing.rangeBox(r.note, WORDS.length, WORDS.length + 5)).toBeUndefined();
      expect(r.writing.rangeBox(9999 as Entity, 0, 3)).toBeUndefined();
    } finally { r.dispose(); }
  });

  it("the note's lease NAMES the note it writes (`entity`): the words' menu is that note's by the lease's own word, not by the claim its typing holds", () => {
    const r = rig();
    try {
      expect(r.body.focus(r.note, 0)).toBe(true);
      expect(r.editor.lease()?.entity).toBe(r.note);
    } finally { r.dispose(); }
  });
});
