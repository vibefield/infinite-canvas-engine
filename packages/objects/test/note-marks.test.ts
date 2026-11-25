// @vitest-environment node
// THE NOTE DRAWS ITS MARKS (petition I60 — "Editing the Ink", the note's half): the pen's run is built FROM THE INK (kit/hand-run.ts
// `handRun({ ink, marked, wash })`), so each glyph is in its own pen and the run carries the marks section the kit's `ink_marks` reads
// beside `hand_ink` in the note's shader. Pinned on the writing (paper/writing.ts) over the desk's own baked Caveat:
//  - THE RUN: built from the ink — each glyph's pen from its mark, the strokes as `strokesOf` gives them — and the record told it
//    carries the marks; an unmarked sheet's run carries the section too (empty), so a selection needs no rebuild;
//  - THE CLOCK (`clock.marks` after the frame's `look`): a desk opening draws nothing; a mark made later — here, by a peer, by an agent:
//    the writing cannot tell and need not — is drawn ONCE from when it is seen (its stroke's moment from now, a re-ink's from now), the
//    desk drawing while it moves (`KindHost.redraw`, no record remade) and none at rest; the run built again for the mark alone;
//  - THE WASH on the editor's selection: rewritten ALONE in the run the store holds (`NoteRuns.wash` — never a run built, the run the
//    same object), a frame asked; cleared when the selection lifts; the same selection again writes nothing; a run built while words are
//    selected is built with the wash in it;
//  - THE RASTER ROAD (a glyph the face lacks): the marks drawn over the raster from a run of the marks alone (no glyph laid, its letters
//    the raster's in the sheet's pen), none without a mark or a selection;
//  - THE RECORD: the marks' inks from the note's palette (`PaperPalette` — pens, highlighters, pencil; the selection's colour where it
//    names no pencil), a colour a float, in the kit's order.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Entity } from "@ice/core";
import { kindPalette, MAT_GRID, rgb } from "@ice/desk";
import { createPenClock, encodeMarks, findQuote, HIGHLIGHTERS, type HandAtlas, handFacesOf, type HandMetrics, type HandRun, type InkBitmap, type InkChange, type InkWash, inkMarksAt, inkOf, mark, PENS, type PenKey, readHandAtlas, strokesOf, type TextRaster, washRun } from "@ice/desk/kit";
import { describe, expect, it } from "vitest";
import { deskPalette } from "../src";
import { markInksOf, paperKind } from "../src/paper/kind";
import { packInk, paperValues } from "../src/paper/layout";
import { InkShelves, uvOf } from "../src/paper/pages";
import { DEFAULT_PAPER_LAW, lampOf, resolvePaper } from "../src/paper/paper";
import { createWriting, type InkPages, type NoteRuns } from "../src/paper/writing";

const E = (n: number) => n as Entity;
const lamp = lampOf(MAT_GRID.plane);
const VIEW = { camX: 0, camY: 0, zoom: 1, width: 1200, height: 800, dpr: 2 };

function caveat(): HandAtlas {
  const dir = resolve(import.meta.dirname, "../../../apps/desk/assets/hand");
  const read = readHandAtlas(JSON.parse(readFileSync(resolve(dir, "caveat-500.hand.json"), "utf8")), new Uint8Array(readFileSync(resolve(dir, "caveat-500.hand.bin"))));
  if ("error" in read) throw new Error(read.error);
  return read;
}
const CAVEAT = caveat();

function fakeText(): TextRaster {
  const metrics: HandMetrics = { ascent: 0.96, descent: 0.3, advance: () => 0.5 };
  return {
    metrics: () => metrics,
    version: () => 1,
    raster(_L, _face, box, band): InkBitmap {
      const w = Math.max(1, Math.ceil(box.w * band));
      const h = Math.max(1, Math.ceil(box.h * band));
      return { bytes: new Uint8Array(w * h).fill(200), w, h };
    },
  };
}

function fakePages(): InkPages {
  const shelves = new InkShelves(2048, 4);
  return { alloc: (w, h) => shelves.alloc(w, h), free: (r) => shelves.free(r), write: (r) => uvOf(r.x, r.y, r.w, r.h, 2048, 2048), reset: () => shelves.reset(), trim: () => shelves.trim() };
}

/** The kind's run store in miniature, its washes rewritten alone as `HandRuns.wash` does (the marks' head and a texel a laid line). */
function fakeRuns() {
  const rooms = new Map<PenKey, { at: number; run: HandRun; data: Float32Array }>();
  let next = 0;
  const log = { writes: 0, washes: 0, texels: 0 };
  const runs: NoteRuns = {
    write(key, run) {
      log.writes += 1;
      const had = rooms.get(key);
      const at = had?.at ?? next;
      if (had === undefined) next += run.length + 16;
      rooms.set(key, { at, run, data: run.data.slice() });
      return at;
    },
    wash(key, w: InkWash) {
      const room = rooms.get(key);
      if (room === undefined) return false;
      log.washes += 1;
      log.texels += 1 + w.lines.length / 4;
      room.data = washRun({ ...room.run, data: room.data }, w).data;
      return true;
    },
    free(key) { rooms.delete(key); },
    face() {},
    at() {},
  };
  return { runs, rooms, log };
}

/** `text`'s marks after each `[quote, change]`, as the cell writes them. */
function marked(text: string, ...changes: readonly (readonly [string, InkChange])[]): string {
  let ink = inkOf({ text }, 7);
  for (const [q, change] of changes) {
    const r = findQuote(text, q);
    if ("error" in r) throw new Error(`no single "${q}"`);
    ink = mark(ink, r.from, r.to, change);
  }
  return encodeMarks(ink.marks);
}

interface Note { readonly e: Entity; readonly text: string; readonly marks?: string }

function desk(opts: { readonly redraw?: () => void } = {}) {
  const r = fakeRuns();
  const clock = createPenClock();
  let redraws = 0;
  const w = createWriting({ pages: fakePages, runs: () => r.runs, clock, text: fakeText(), faces: handFacesOf({ caveat: CAVEAT }), redraw: opts.redraw ?? (() => { redraws += 1; }) });
  let now = 1000;
  const frame = (notes: readonly Note[], dt = 16) => {
    now += dt;
    const want = w.tick(now);
    const out = notes.map((n) => {
      const rect = { cx: 300, cy: 250, w: 200, h: 200 };
      const G = resolvePaper({ cx: rect.cx, cy: rect.cy, w: rect.w, h: rect.h, angle: 0 }, { held: 0, ring: 0, fade: 1 }, DEFAULT_PAPER_LAW, lamp);
      return w.draw(n.e, { text: n.text, seeds: "", seed: 7, marks: n.marks ?? "" }, rect, VIEW, G);
    });
    return { want, out, due: w.due(now) };
  };
  return { w, r, clock, frame, now: () => now, redraws: () => redraws };
}

const TEXT = "buy milk\ncall mum back";
/** Each laid glyph's pen as the run packs it (bits 0–3 of its last float). */
const pensOf = (run: HandRun): number[] => {
  const d = run.data;
  const at = d[4 * 2 + 1] as number;
  return Array.from({ length: run.glyphs }, (_, n) => (d[4 * (at + 5 * n + 4) + 3] as number) & 15);
};

describe("the note's run is built from its ink (petition I60)", () => {
  it("each glyph in the pen its mark names, the strokes in a marks section; the record told the run carries the marks", () => {
    const { w, frame } = desk();
    const marks = marked(TEXT, ["call", { pen: "red" }], ["milk", { highlight: "yellow" }], ["mum", { strike: true }]);
    const f = frame([{ e: E(1), text: TEXT, marks }]);
    const p = w.penOf(E(1));
    expect(p?.road).toBe("pen");
    expect(f.out[0]?.pen).toEqual({ base: p?.base, marks: true });
    // "buymilkcallmumback": the laid glyphs in reading order; "call" in red (PENS[3] — 4)
    expect(pensOf(p?.run as HandRun)).toEqual([0, 0, 0, 0, 0, 0, 0, 4, 4, 4, 4, 0, 0, 0, 0, 0, 0, 0]);
    expect(p?.run.marks?.strokes).toBe(2);
    expect(p?.strokes.map((s) => s.kind)).toEqual(strokesOf(w.layoutOf(E(1)) as never, inkOf({ text: TEXT, marks }, 7)).map((s) => s.kind));
  });

  it("an unmarked sheet's run carries the section too (no stroke), so its first selection rewrites the wash and builds nothing", () => {
    const { w, r, frame } = desk();
    frame([{ e: E(1), text: TEXT }]);
    const run = w.penOf(E(1))?.run;
    expect(run?.marks?.strokes).toBe(0);
    const built = w.stats().runs;
    w.select(E(1), 0, 3);
    expect(w.stats().runs).toBe(built);
    expect(w.penOf(E(1))?.run).toBe(run);
    expect(r.log.washes).toBe(1);
  });
});

describe("the marks' moments: drawn once from when they are seen, never when a desk opens (petition I60)", () => {
  it("a desk opening (the sheet's first look) draws every mark at once: no stroke or re-ink in flight, nothing to wake for", () => {
    const { w, frame } = desk();
    const marks = marked(TEXT, ["milk", { highlight: "pink" }], ["call", { pen: "ball" }]);
    const f = frame([{ e: E(1), text: TEXT, marks }]);
    const m = w.penOf(E(1))?.marked;
    expect(m?.strokes.every((s) => s.start === Number.NEGATIVE_INFINITY)).toBe(true);
    expect(m?.reinks.every((s) => s.start === Number.NEGATIVE_INFINITY)).toBe(true);
    expect(f.due).toBe(Number.POSITIVE_INFINITY);
    expect(w.stats().moving).toBe(0);
  });

  it("a mark made later is drawn from when it is seen: its stroke's moment is the frame's, the desk drawn while it moves with no record remade, none at rest — and ONE run built for it", () => {
    const { w, r, frame, now, redraws } = desk();
    frame([{ e: E(1), text: TEXT }]);
    const built = w.stats().runs;
    const writes = r.log.writes;
    const marks = marked(TEXT, ["mum", { strike: true }]);
    frame([{ e: E(1), text: TEXT, marks }]);
    expect([w.stats().runs, r.log.writes]).toEqual([built + 1, writes + 1]);
    const s = w.penOf(E(1))?.marked?.strokes[0];
    expect(s?.start).toBe(now());   // the frame's tick: the writing's `now`
    expect(s?.dur).toBeGreaterThan(0);
    expect(w.stats().moving).toBe(1);
    // while it moves: a redraw a tick, the run never built again
    const r0 = redraws();
    let frames = 0;
    for (let i = 0; i < 60 && frame([{ e: E(1), text: TEXT, marks }]).due <= now(); i++) frames += 1;
    expect(frames).toBeGreaterThan(3);
    expect(redraws() - r0).toBeGreaterThan(3);
    expect(w.stats().runs).toBe(built + 1);
    // at rest: nothing to wake for, no redraw asked
    const r1 = redraws();
    const rest = frame([{ e: E(1), text: TEXT, marks }]);
    expect(rest.due).toBe(Number.POSITIVE_INFINITY);
    frame([{ e: E(1), text: TEXT, marks }]);
    expect(redraws()).toBe(r1);
    expect(w.stats().moving).toBe(0);
  });

  it("a word's pen changed is RE-INKED from when it is seen, its new pen over the one it had; the clock's moments hold the pen's time while it moves", () => {
    const { w, frame, now } = desk();
    frame([{ e: E(1), text: TEXT }]);
    frame([{ e: E(1), text: TEXT, marks: marked(TEXT, ["back", { pen: "red" }]) }]);
    const m = w.penOf(E(1))?.marked;
    const inked = (m?.reinks ?? []).filter((q) => q.start > Number.NEGATIVE_INFINITY);
    expect(inked.length).toBe(4);   // "back"
    expect(inked[0]?.start).toBe(now());
    expect(w.penOf(E(1))?.run.reinks).toBe(4);
    expect(w.penTime()).toBe(now());
    frame([{ e: E(1), text: TEXT, marks: marked(TEXT, ["back", { pen: "red" }]) }], 50);
    expect(w.penTime()).toBe(now());
  });
});

describe("the selection's WASH is rewritten alone (petition I60)", () => {
  it("a selection change writes the wash into the run the store holds — never a run built, the run the same object — and asks a frame; lifted, it is cleared", () => {
    const { w, r, frame, redraws } = desk();
    frame([{ e: E(1), text: TEXT }]);
    const run = w.penOf(E(1))?.run as HandRun;
    const built = w.stats().runs;
    const writes = r.log.writes;
    const r0 = redraws();
    w.select(E(1), 9, 17);   // "call mum"
    expect([w.stats().runs, r.log.writes, w.stats().washes]).toEqual([built, writes, 1]);
    expect(w.penOf(E(1))?.run).toBe(run);
    expect(redraws()).toBe(r0 + 1);
    expect(r.log.texels).toBe(1 + (run.marks?.lines ?? 0));   // the head and a texel a laid line: a few texels, the run untouched
    // the store's copy washes where the words are: the twin reads a wash over "call", none over "buy"
    const L = w.layoutOf(E(1));
    const at = (i: number) => [L?.positions[2 * i] as number, (L?.positions[2 * i + 1] as number) - 4] as const;
    const held = { ...run, data: r.rooms.get(E(1))?.data as Float32Array };
    expect(inkMarksAt(held, at(10)[0] + 1, at(10)[1], 0, 0.5).wash).toBeGreaterThan(0.9);
    expect(inkMarksAt(held, at(1)[0] + 1, at(1)[1], 0, 0.5).wash).toBe(0);
    // the same selection again writes nothing; a frame builds nothing for it
    w.select(E(1), 9, 17);
    frame([{ e: E(1), text: TEXT }]);
    expect([w.stats().washes, w.stats().runs]).toEqual([1, built]);
    // lifted (the lease ended): cleared, alone
    w.select(undefined);
    expect([w.stats().washes, w.stats().runs]).toEqual([2, built]);
    expect(inkMarksAt({ ...run, data: r.rooms.get(E(1))?.data as Float32Array }, at(10)[0] + 1, at(10)[1], 0, 0.5).wash).toBe(0);
  });

  it("a run built while words are selected (an edit, a mark) is built with the wash in it", () => {
    const { w, frame } = desk();
    frame([{ e: E(1), text: TEXT }]);
    w.select(E(1), 0, 3);
    frame([{ e: E(1), text: TEXT, marks: marked(TEXT, ["buy", { underline: true }]) }]);
    const p = w.penOf(E(1));
    const L = w.layoutOf(E(1));
    expect(p?.wash).toBeUndefined();   // the run's own wash, built in
    expect(inkMarksAt(p?.run as HandRun, (L?.positions[2] as number) + 1, (L?.positions[3] as number) - 4, 0, 0.5).wash).toBeGreaterThan(0.9);
  });
});

describe("the raster's road keeps its letters and draws its marks over them (petition I60)", () => {
  it("a sheet with a glyph the face lacks: its marks from a run of the marks alone (no glyph laid); none for an unmarked, unselected sheet", () => {
    const { w, r, frame } = desk();
    const text = "milk 日本";
    const f0 = frame([{ e: E(1), text }]);
    expect(w.roadOf(E(1))).toBe("raster");
    expect(f0.out[0]?.pen).toBeUndefined();
    expect(r.rooms.has(E(1))).toBe(false);
    const f1 = frame([{ e: E(1), text, marks: marked(text, ["milk", { highlight: "green" }]) }]);
    expect(f1.out[0]?.raster).toBeDefined();
    const p = w.penOf(E(1));
    expect(f1.out[0]?.pen).toEqual({ base: p?.base, marks: true, words: false });
    expect([p?.road, p?.run.glyphs, p?.run.marks?.strokes]).toEqual(["raster", 0, 1]);
    // its letters stay the raster's: the record's pen draws no words (`words` false packs 0 on the pen's road)
    expect(paperValues({ geometry: resolvePaper({ cx: 0, cy: 0, w: 200, h: 200, angle: 0 }, { held: 0, ring: 0, fade: 1 }, DEFAULT_PAPER_LAW, lamp), paper: [1, 1, 1], ink: [0, 0, 0], pen: f1.out[0]?.pen }, 0).pen).toEqual([p?.base, 0, 1, 1]);
    // unmarked again: the run given back
    frame([{ e: E(1), text }]);
    expect(r.rooms.has(E(1))).toBe(false);
    expect(w.penOf(E(1))).toBeUndefined();
  });
});

describe("the marks' inks: the note's palette's, in the kit's order (petition I60)", () => {
  it("the kind reads the pens, the five highlighters and the pencil (the selection's colour where none is named); the record packs them a colour a float", () => {
    const theme = paperKind().theme;
    if (theme === undefined) throw new Error("the note's kind has no theme");
    const look = theme(kindPalette(deskPalette("light")), "light");
    const ink = look.pens.fountain as never;
    const inks = markInksOf(look, ink);
    const pal = deskPalette("light") as unknown as { pens: Record<string, { css: string }>; highlighters: Record<string, { css: string }>; select: { css: string } };
    expect(inks.pens).toEqual(PENS.map((n) => rgb(pal.pens[n]?.css as string)));
    expect(inks.highlighters).toEqual(HIGHLIGHTERS.map((n) => rgb(pal.highlighters[n]?.css as string)));
    expect(inks.pencil).toEqual(rgb(pal.select.css));
    const G = resolvePaper({ cx: 0, cy: 0, w: 200, h: 200, angle: 0 }, { held: 0, ring: 0, fade: 1 }, DEFAULT_PAPER_LAW, lamp);
    const v = paperValues({ geometry: G, paper: [1, 1, 1], ink, marks: inks }, 0);
    expect(v.inks).toEqual([...inks.pens.map(packInk), ...inks.highlighters.map(packInk), packInk(inks.pencil), 0, 0]);
    // three bytes a float, exact: below 2^24 and back
    for (const c of [...inks.pens, ...inks.highlighters]) {
      const n = packInk(c);
      expect(n).toBeLessThan(2 ** 24);
      expect(Math.fround(n)).toBe(n);
      expect([Math.floor(n / 65536), Math.floor(n / 256) % 256, n % 256]).toEqual(c.map((x) => Math.round(x * 255)));
    }
  });
});
