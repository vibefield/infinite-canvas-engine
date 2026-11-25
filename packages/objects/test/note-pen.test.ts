// @vitest-environment happy-dom
// THE NOTE WRITES WITH THE PEN (petition I59 — the desk's pen, its note half): a sheet's words read in the note's own shader from a
// glyph run and the face's baked atlas (kit/hand-run.ts, kit/hand.wgsl), so its writing is sharp at every zoom with no raster per
// zoom rung, and the pen's moments replace the wipe. Pinned, on the writing (paper/writing.ts) over the desk's own baked Caveat
// (apps/desk/assets/hand, as the app lends it):
//  - THE ROADS, per sheet: a lent face that has landed → the pen; a lent face still on its way → the sheet waits BLANK (no stand-in
//    hand that re-writes itself); no faces lent → today's raster; a glyph the face lacks (an emoji, CJK) → the raster; a pinned
//    raster wins over both. `stats().roads` counts them;
//  - THE RUN is built and written only when the layout or the moments change — never on a pan, a zoom or a redraw; its rung is 0
//    (the builder remakes nothing on a zoom);
//  - THE MOMENTS through the note's own typing (its body's lease on the desk's editor): a glyph typed there is written as typed, a
//    paste and a peer's words as they arrive, and a sheet's first look writes nothing;
//  - THE WAKE: frames only while the pen moves (`KindHost.redraw` — no record remade), none at rest; the pen's time held at the last
//    moment written once nothing moves, so a pan rewrites no knob;
//  - `forget` gives the run's room back and the clock forgets the sheet; the record carries the run's base to the pass;
//  - WHERE THE WORDS LIE (petition I60, the words' menu) on the pen's road too: `rangeBox` from the layout the pen writes, through
//    the note's lease, which names its note; none while the face is on its way.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createCanvasEngine, type Entity } from "@ice/core";
import { createDeskEditor, handFaces, MAT_GRID } from "@ice/desk";
import { carrySeeds, createPenClock, encodeSeeds, glyphBox, HAND_WEIGHT, type HandAtlas, type HandFaces, handFacesOf, type HandLayout, type HandMetrics, type HandRun, type InkBitmap, type PenKey, readHandAtlas, seedsFor, type TextPart, type TextRaster } from "@ice/desk/kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNoteBody, NOTE_INK, NOTE_PROPS, Note, type PaperDriver } from "../src";
import { Paper, paperValues } from "../src/paper/layout";
import { InkShelves, uvOf } from "../src/paper/pages";
import { DEFAULT_PAPER_LAW, lampOf, resolvePaper } from "../src/paper/paper";
import { PAPER } from "../src/paper/theme";
import { createNoteTyping } from "../src/paper/typing";
import { createWriting, DEFAULT_BLEED, type InkPages, type NoteRuns, type Writing } from "../src/paper/writing";

const E = (n: number) => n as Entity;
const lamp = lampOf(MAT_GRID.plane);
const VIEW = { camX: 0, camY: 0, zoom: 1, width: 1200, height: 800, dpr: 2 };

/** The desk's own Caveat 500, as baked and committed (apps/desk/assets/hand) — the face the note writes in. */
function caveat(): HandAtlas {
  const dir = resolve(import.meta.dirname, "../../../apps/desk/assets/hand");
  const read = readHandAtlas(JSON.parse(readFileSync(resolve(dir, "caveat-500.hand.json"), "utf8")), new Uint8Array(readFileSync(resolve(dir, "caveat-500.hand.bin"))));
  if ("error" in read) throw new Error(read.error);
  return read;
}
const CAVEAT = caveat();

/** A text raster that counts what it rasters (the raster road's). */
function fakeText() {
  const metrics: HandMetrics = { ascent: 0.96, descent: 0.3, advance: () => 0.5 };
  const calls: number[] = [];
  const text: TextRaster = {
    metrics: () => metrics,
    version: () => 1,
    raster(L, _face, box, band): InkBitmap {
      const w = Math.max(1, Math.ceil(box.w * band));
      const h = Math.max(1, Math.ceil(box.h * band));
      calls.push(L.glyphs.length);
      return { bytes: new Uint8Array(w * h).fill(200), w, h };
    },
  };
  return { text, calls };
}

/** Pages over the real shelves (the raster road's room). */
function fakePages(): InkPages {
  const shelves = new InkShelves(2048, 4);
  return { alloc: (w, h) => shelves.alloc(w, h), free: (r) => shelves.free(r), write: (r) => uvOf(r.x, r.y, r.w, r.h, 2048, 2048), reset: () => shelves.reset(), trim: () => shelves.trim() };
}

/** The kind's run store as the pass keeps it, in miniature: each key's room, the writes, the face bound, the pen's time. */
function fakeRuns() {
  const rooms = new Map<PenKey, { at: number; run: HandRun }>();
  let next = 0;
  const log = { writes: 0, frees: 0, faces: [] as HandAtlas[], at: [] as number[] };
  const runs: NoteRuns = {
    write(key, run) {
      log.writes += 1;
      const had = rooms.get(key);
      const at = had?.at ?? next;
      if (had === undefined) next += run.length + 16;
      rooms.set(key, { at, run });
      return at;
    },
    free(key) { if (rooms.delete(key)) log.frees += 1; },
    face(atlas) { if (log.faces[log.faces.length - 1] !== atlas) log.faces.push(atlas); },
    at(ms) { log.at.push(ms); },
  };
  return { runs, rooms, log };
}

interface DeskOpts { readonly faces?: HandFaces | undefined; readonly text?: TextRaster | undefined; readonly redraw?: () => void }

/** A desk's writing with the pen's doors (faces, the run store, the redraw), and a frame: the tick, then every note drawn in order. */
function desk(opts: DeskOpts = {}) {
  const t = fakeText();
  const r = fakeRuns();
  const clock = createPenClock();
  let redraws = 0;
  const w = createWriting({
    pages: fakePages, runs: () => r.runs, clock,
    text: "text" in opts ? opts.text : t.text,
    ...("faces" in opts ? (opts.faces !== undefined ? { faces: opts.faces } : {}) : { faces: handFacesOf({ caveat: CAVEAT }) }),
    redraw: opts.redraw ?? (() => { redraws += 1; }),
  });
  let now = 1000;
  const frame = (notes: readonly { e: Entity; cx?: number; cy?: number; text: string; seeds?: string; seed?: number }[], view = VIEW, dt = 16) => {
    now += dt;
    const want = w.tick(now);
    const out = notes.map((n) => {
      const rect = { cx: n.cx ?? 300, cy: n.cy ?? 250, w: 200, h: 200 };
      const G = resolvePaper({ cx: rect.cx, cy: rect.cy, w: rect.w, h: rect.h, angle: 0 }, { held: 0, ring: 0, fade: 1 }, DEFAULT_PAPER_LAW, lamp);
      return w.draw(n.e, { text: n.text, seeds: n.seeds ?? "", seed: n.seed ?? 7 }, rect, view, G);
    });
    return { want, out, due: w.due(now) };
  };
  return { w, t, r, clock, frame, now: () => now, redraws: () => redraws, step: (dt: number) => { now += dt; } };
}

/** Written before, as a run holds it (`HAND_RUN.before`, −1e30 in an f32). */
const BEFORE = Math.fround(-1e30);

/** A note's glyph moments as its run holds them (ms from the run's epoch; `BEFORE` written before), by glyph. */
function startsOf(w: Writing, e: Entity): number[] {
  const p = w.penOf(e);
  if (p === undefined) return [];
  const d = p.run.data;
  const glyphsAt = d[4 * 2 + 1] as number;
  return Array.from({ length: p.run.glyphs }, (_, n) => d[4 * (glyphsAt + 5 * n + 4)] as number);
}

describe("the note's two roads, per sheet (petition I59)", () => {
  it("a lent face that has LANDED: the pen — laid by the face's own metrics, its run written to the kind's store, its base in the record; no raster, no wipe", () => {
    const { w, t, r, frame } = desk();
    const f = frame([{ e: E(1), text: "buy milk" }]);
    expect(w.roadOf(E(1))).toBe("pen");
    expect(f.out[0]?.raster).toBeUndefined();
    expect(f.out[0]?.pen).toEqual({ base: r.rooms.get(E(1))?.at });
    expect(t.calls).toEqual([]);   // the text raster never asked
    expect(r.log.faces).toEqual([CAVEAT]);   // the pass binds the note's face
    const p = w.penOf(E(1));
    expect(p?.glyphs).toBe(7);   // "buy milk": seven inked glyphs, the space an advance
    expect(p?.run.missing).toEqual([]);
    // laid by the atlas's own advances: the second glyph sits one baked advance (× its jitter) after the first
    const L = w.layoutOf(E(1));
    expect(L?.ascent).toBeCloseTo(CAVEAT.ascent * 24, 9);
    expect(w.stats().roads).toEqual({ pen: 1, raster: 0, waiting: 0 });
  });

  it("a lent face still on its way: the sheet waits BLANK — no layout, no raster, no stand-in — and its landing writes it at once, with no pen moving (its first look)", async () => {
    let land: (() => void) | undefined;
    const json = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../apps/desk/assets/hand/caveat-500.hand.json"), "utf8")) as unknown;
    const bin = new Uint8Array(readFileSync(resolve(import.meta.dirname, "../../../apps/desk/assets/hand/caveat-500.hand.bin")));
    const gate = new Promise<void>((ok) => { land = ok; });
    const fetch = async (url: string) => {
      await gate;
      return { ok: true, status: 200, json: async () => json, arrayBuffer: async () => bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer };
    };
    const faces = handFaces({ faces: { caveat: { json: "c.json", bin: "c.bin" } }, fetch });
    const { w, t, r, frame } = desk({ faces });
    const f0 = frame([{ e: E(1), text: "hello" }]);
    expect(w.roadOf(E(1))).toBe("waiting");
    expect(f0.out[0]).toEqual({});
    expect(w.layoutOf(E(1))).toBeUndefined();
    expect([t.calls.length, r.log.writes]).toEqual([0, 0]);
    expect(w.stats().roads).toEqual({ pen: 0, raster: 0, waiting: 1 });
    land?.();
    for (let i = 0; i < 5; i++) await new Promise((ok) => setTimeout(ok, 0));
    const f1 = frame([{ e: E(1), text: "hello" }]);
    expect(f1.want).toBe(true);   // the face landed: every record remade
    expect(w.roadOf(E(1))).toBe("pen");
    expect(f1.out[0]?.pen).toBeDefined();
    expect(startsOf(w, E(1)).every((s) => s === BEFORE)).toBe(true);   // its first look: every glyph already there
    expect(t.calls.length).toBe(0);
  });

  it("no faces lent: today's raster road, unchanged — the wipe and all; a face lent but not landing (404) the same", async () => {
    const bare = desk({ faces: undefined });
    const f = bare.frame([{ e: E(1), text: "hi" }]);
    expect(bare.w.roadOf(E(1))).toBe("raster");
    expect(f.out[0]?.raster).toBeDefined();
    expect(f.out[0]?.pen).toBeUndefined();
    bare.w.wrote(E(1), 1, bare.now());
    expect(bare.frame([{ e: E(1), text: "hi" }]).out[0]?.wipe).toBeDefined();
    expect(bare.w.stats().roads).toEqual({ pen: 0, raster: 1, waiting: 0 });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const faces = handFaces({ faces: { caveat: { json: "c.json", bin: "c.bin" } }, fetch: async () => ({ ok: false, status: 404, json: async () => null, arrayBuffer: async () => new ArrayBuffer(0) }) });
      const lost = desk({ faces });
      lost.frame([{ e: E(1), text: "hi" }]);
      expect(lost.w.roadOf(E(1))).toBe("waiting");
      for (let i = 0; i < 5; i++) await new Promise((ok) => setTimeout(ok, 0));
      expect(lost.frame([{ e: E(1), text: "hi" }]).out[0]?.raster).toBeDefined();
      expect(lost.w.roadOf(E(1))).toBe("raster");
    } finally {
      error.mockRestore();
    }
  });

  it("a glyph the face lacks (an emoji, CJK): the RASTER road for that sheet — its run given back, the clock forgetting it; the glyph gone, the pen again with nothing re-written", () => {
    const { w, t, r, frame } = desk();
    frame([{ e: E(1), text: "ok" }, { e: E(2), text: "日本" }]);
    expect([w.roadOf(E(1)), w.roadOf(E(2))]).toEqual(["pen", "raster"]);
    expect(t.calls).toEqual([2]);   // the CJK sheet rastered, by the text raster
    frame([{ e: E(1), text: "ok 🙂" }, { e: E(2), text: "日本" }]);
    expect(w.roadOf(E(1))).toBe("raster");
    expect(w.penOf(E(1))).toBeUndefined();
    expect(r.rooms.has(E(1))).toBe(false);
    const f = frame([{ e: E(1), text: "ok" }, { e: E(2), text: "日本" }]);
    expect(w.roadOf(E(1))).toBe("pen");
    expect(f.out[0]?.raster).toBeUndefined();
    expect(startsOf(w, E(1)).every((s) => s === BEFORE)).toBe(true);   // back on the pen: a first look, nothing written again
    expect(w.stats().roads).toEqual({ pen: 1, raster: 1, waiting: 0 });
  });

  it("a PINNED raster (a still's committed ink) wins over both: no layout, no run, the face never asked of the pass", () => {
    const { w, r, frame } = desk();
    expect(w.pin(E(1), new Uint8Array(4), { w: 2, h: 2 })).toBe(true);
    const f = frame([{ e: E(1), text: "buy milk" }]);
    expect(w.roadOf(E(1))).toBe("pinned");
    expect(f.out[0]?.raster).toBeDefined();
    expect(f.out[0]?.pen).toBeUndefined();
    expect([r.log.writes, w.stats().roads.pen]).toEqual([0, 0]);
  });
});

describe("the run: built and written only when the layout or the moments change (petition I59)", () => {
  it("a pan, a zoom across every rung, a redraw: no run built, none written; the rung is 0, so the builder remakes nothing on a zoom", () => {
    const { w, r, frame } = desk();
    const n = { e: E(1), text: "call mum back" };
    frame([n]);
    const runs = w.stats().runs;
    const writes = r.log.writes;
    for (const zoom of [0.3, 0.7, 1, 1.6, 4, 8, 0.5]) frame([n], { ...VIEW, zoom, camX: 40 * zoom, camY: -20 });
    expect([w.stats().runs, r.log.writes]).toEqual([runs, writes]);
    for (const zoom of [0.3, 1, 4]) expect(w.bandOf(E(1), { text: n.text }, { w: 200, h: 200 }, zoom, 2)).toBe(0);
    expect(w.rungOf(E(1), { text: n.text }, { w: 200, h: 200 }, 4, 2, 0)).toBe(0);
    // an edit is a new layout: one run, written in the note's own room (the same base)
    const base = w.penOf(E(1))?.base;
    frame([{ ...n, text: "call mum back!" }]);
    expect([w.stats().runs, r.log.writes]).toEqual([runs + 1, writes + 1]);
    expect(w.penOf(E(1))?.base).toBe(base);
    // the seeds moved (a peer's hand for the same words): a new layout, a new run
    frame([{ ...n, text: "call mum back!", seeds: encodeSeeds(seedsFor("call mum back!", "", 99)) }]);
    expect(w.stats().runs).toBe(runs + 2);
  });

  it("the pen moving rebuilds nothing: the run holds every glyph's moment, and only the pen's time moves (`at`)", () => {
    const { w, r, frame } = desk();
    frame([{ e: E(1), text: "" }]);   // a fresh sheet's first look: nothing there
    frame([{ e: E(1), text: "milk" }]);   // a peer's words arrive: written from now
    const runs = w.stats().runs;
    const at = r.log.at.length;
    for (let i = 0; i < 40; i++) frame([{ e: E(1), text: "milk" }]);
    expect(w.stats().runs).toBe(runs);
    expect(r.log.at.length).toBeGreaterThan(at);
  });
});

/**
 * The desk's editor and a note's body over a real engine and document, the body's writing a pen's (its faces the desk's Caveat, landed,
 * unless `faces` says otherwise); a frame draws the note as the builder would.
 */
function rig(faces: HandFaces = handFacesOf({ caveat: CAVEAT })) {
  const ce = createCanvasEngine({ widgets: [Note] });
  ce.docs.create();
  const { world } = ce;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const runs = fakeRuns();
  const clock = createPenClock();
  const writing = createWriting({ pages: fakePages, runs: () => runs.runs, faces, clock, redraw: () => {} });
  const typing = createNoteTyping({ world, docs: ce.docs, ink: NOTE_INK, props: NOTE_PROPS });
  const driver: PaperDriver = { typing, writing: () => writing, isNote: (e) => world.get(e, NOTE_INK) !== undefined, body: undefined, follow: () => {}, idle: () => true };
  const parts: TextPart[] = [];
  const editor = createDeskEditor({ container, world, parts: () => parts, wake: () => {} });
  const body = createNoteBody({ editor, world, driver, geometryOf: () => undefined, now: () => now });
  if (body === undefined) throw new Error("no body");
  parts.push(body);
  const note = ce.ops.spawnWidget("desk.note", { x: 0, y: 0, props: { seed: 7, text: "" }, undoable: false }) as Entity;
  ce.step(16);
  let now = 5000;
  const G = resolvePaper({ cx: 0, cy: 0, w: 200, h: 200, angle: 0 }, { held: 0, ring: 0, fade: 1 }, DEFAULT_PAPER_LAW, lamp);
  /** A frame: the clock on, the note drawn from the world's cell as its record would be. */
  const frame = (dt = 16) => {
    now += dt;
    writing.tick(now);
    const ink = world.get(note, NOTE_INK) as { text: string; seeds: string };
    return writing.draw(note, { text: ink.text, seeds: ink.seeds, seed: 7 }, { cx: 0, cy: 0, w: 200, h: 200 }, VIEW, G);
  };
  const el = editor.element;
  const type = (value: string) => { el.value = value; el.setSelectionRange(value.length, value.length); el.dispatchEvent(new Event("input", { bubbles: true })); };
  /** Each glyph's moment as the clock keeps it, by the glyph's seed: [start − now, dur], or written-before. */
  const moments = () => {
    const ink = world.get(note, NOTE_INK) as { text: string; seeds: string };
    const seeds = seedsFor(ink.text, ink.seeds, 7);
    return [...ink.text].map((_, i) => clock.momentOf(note, seeds[i] as number)).filter((m) => m !== undefined).map((m) => (m.start === Number.NEGATIVE_INFINITY ? "written" : [m.start - now, m.dur]));
  };
  return { world, writing, editor, body, note, G, type, frame, moments, now: () => now, dispose: () => { editor.dispose(); ce.dispose(); } };
}

describe("the moments, through the note's own typing (petition I59 — the typing marks its sheet)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ""; });

  it("a glyph TYPED in the note's own typing is written as typed (from that frame, at the hand's pace); the words a sheet first shows are written already", () => {
    const r = rig();
    r.world.edit(r.note).set(NOTE_INK, { text: "hi", seeds: "" });   // words already on the sheet when it is first drawn
    r.frame();
    expect(r.moments()).toEqual(["written", "written"]);   // the first look writes nothing
    expect(r.body.focus(r.note)).toBe(true);
    r.type("hi!");
    r.frame(0);   // the frame the keystroke wakes
    const m = r.moments();
    expect(m.slice(0, 2)).toEqual(["written", "written"]);   // the glyphs before it keep their moments: never written again
    const [start, dur] = m[2] as [number, number];
    expect(start).toBe(0);   // set off in the frame that drew it
    expect(dur).toBeGreaterThanOrEqual(100);   // the typed pace: 90 + 45 ms an em of path, within 100–190
    expect(dur).toBeLessThanOrEqual(190);
    expect(r.writing.wipeOf(r.note)).toBeUndefined();   // the wipe is retired on the pen road
    r.dispose();
  });

  it("a PASTE through the note's typing and a PEER's words arrive: every word its own pen, the letters of a word one after another, the whole within 1.4 s", () => {
    const r = rig();
    r.frame();   // the empty sheet's first look
    expect(r.body.focus(r.note)).toBe(true);
    r.type("buy milk");   // several glyphs in one input: a paste, laid as an input
    r.frame(0);
    const m = r.moments() as [number, number][];
    expect(m.length).toBe(7);
    expect(m[0]?.[0]).toBe(0);
    // each word's letters one after another ("buy", then "milk"), and the second word's own pen sets off after the first word's
    const rising = (from: number, to: number): boolean => m.slice(from, to).every(([s], i, a) => i === 0 || s > (a[i - 1]?.[0] ?? 0));
    expect([rising(0, 3), rising(3, 7)]).toEqual([true, true]);
    expect((m[3] as [number, number])[0]).toBeGreaterThan(0);
    expect(Math.max(...m.map(([s, d]) => s + d))).toBeLessThanOrEqual(1400);   // the whole arrival within 1.4 s
    r.editor.blur();
    // a peer's words once the typing has ended (no word from it): " now" arrives — the hand of "buy milk" carried, so it is not written again
    const cur = r.world.get(r.note, NOTE_INK) as { text: string; seeds: string };
    let fresh = 900;
    const carried = carrySeeds(cur.text, seedsFor(cur.text, cur.seeds, 7), "buy milk now", () => { fresh += 7; return fresh; });
    r.world.edit(r.note).set(NOTE_INK, { text: "buy milk now", seeds: encodeSeeds(carried.seeds) });
    r.frame();
    const all = r.moments() as ([number, number] | "written")[];
    expect(all.length).toBe(10);
    expect(all.slice(7).map((x) => (Array.isArray(x) ? x[0] >= 0 : x))).toEqual([true, true, true]);   // "now": written from this frame
    r.dispose();
  });
});

describe("where the words lie, on the pen's road (petition I60 — the words' menu — under the pen, I59)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ""; });

  /** The union of the glyph boxes of [from, to) in `L`, note units (the words' menu's own reading: note-words.test.ts). */
  const glyphUnion = (L: HandLayout, from: number, to: number) => {
    const boxes = L.glyphs.filter((g) => g.index >= from && g.index < to).map((g) => glyphBox(L, g));
    return { x0: Math.min(...boxes.map((b) => b.x0)), y0: Math.min(...boxes.map((b) => b.y0)), x1: Math.max(...boxes.map((b) => b.x1)), y1: Math.max(...boxes.map((b) => b.y1)) };
  };

  it("a sheet the pen writes answers `rangeBox` from the layout it writes — the range's glyph boxes on the sheet — through its lease too, and the lease names the note", () => {
    const r = rig();
    try {
      r.world.edit(r.note).set(NOTE_INK, { text: "buy milk", seeds: "" });
      r.frame();
      expect(r.writing.roadOf(r.note)).toBe("pen");
      const L = r.writing.layoutOf(r.note) as HandLayout;
      expect(L.em).toBe(24);   // laid by the face's own metrics, at the hand's size
      const u = glyphUnion(L, 4, 8);   // "milk"
      // unturned and unscaled, the sheet at the world's origin, 200 × 200: note units are the world's from its top-left corner
      const box = r.writing.rangeBox(r.note, 4, 8);
      expect(box?.x).toBeCloseTo(-100 + u.x0, 6);
      expect(box?.y).toBeCloseTo(-100 + u.y0, 6);
      expect(box?.w).toBeCloseTo(u.x1 - u.x0, 6);
      expect(box?.h).toBeCloseTo(u.y1 - u.y0, 6);
      expect(r.body.focus(r.note, 0)).toBe(true);
      expect(r.editor.lease()?.entity).toBe(r.note);
      expect(r.editor.lease()?.rangeBox?.(4, 8)).toEqual(box);
    } finally { r.dispose(); }
  });

  it("while the sheet's face is on its way it holds no layout, so it answers no box (it draws blank)", () => {
    const loading: HandFaces = { face: () => undefined, version: () => 0, loading: () => true };
    const r = rig(loading);
    try {
      r.world.edit(r.note).set(NOTE_INK, { text: "buy milk", seeds: "" });
      r.frame();
      expect(r.writing.roadOf(r.note)).toBe("waiting");
      expect(r.writing.rangeBox(r.note, 4, 8)).toBeUndefined();
      expect(r.body.focus(r.note, 0)).toBe(true);
      expect(r.editor.lease()?.entity).toBe(r.note);   // the lease names its note on every road
      expect(r.editor.lease()?.rangeBox?.(4, 8)).toBeUndefined();
    } finally { r.dispose(); }
  });
});

describe("the wake (petition I59 — K7a: nothing polled)", () => {
  it("frames while the pen moves — `redraw`, no record remade — then none: due ∞ at rest; the pen's time is held at the last moment written, so a later frame rewrites no knob", () => {
    let redraws = 0;
    const { w, r, frame, now } = desk({ redraw: () => { redraws += 1; } });
    frame([{ e: E(1), text: "" }]);
    const f = frame([{ e: E(1), text: "milk" }]);   // arrived: the pen sets off now
    expect(f.due).toBe(now());   // being written: due now
    let frames = 0;
    let wants = 0;
    expect(w.stats().moving).toBe(1);   // the pen is writing this sheet
    for (let i = 0; i < 120 && w.due(now()) <= now(); i++) { const g = frame([]); frames += 1; if (g.want) wants += 1; }
    expect(w.stats().moving).toBe(0);
    expect(frames).toBeGreaterThan(10);   // the pen wrote for a while…
    expect(redraws).toBeGreaterThan(10);  // …each frame a redraw…
    expect(wants).toBe(0);                // …and no record remade for it
    expect(w.due(now())).toBe(Number.POSITIVE_INFINITY);   // at rest
    const held = r.log.at[r.log.at.length - 1] as number;
    expect(held).toBeLessThan(now());   // held at the last moment written
    expect(startsOf(w, E(1)).length).toBe(4);
    const still = redraws;
    for (let i = 0; i < 5; i++) frame([], { ...VIEW, camX: 30 * i });   // a pan at rest
    expect(r.log.at[r.log.at.length - 1]).toBe(held);   // the same time: the knobs stand
    expect(redraws).toBe(still);                          // and the pen asks no frame
  });
});

describe("forget and the record (petition I59)", () => {
  it("`forget` gives the run's room back and the clock forgets the sheet; a sheet that comes back writes nothing again", () => {
    const { w, r, clock, frame } = desk();
    frame([{ e: E(1), text: "" }]);
    frame([{ e: E(1), text: "milk" }]);
    expect(clock.writing(0)).toBeGreaterThan(0);
    w.forget(E(1));
    expect(r.rooms.has(E(1))).toBe(false);
    expect(clock.momentOf(E(1), seedsFor("milk", "", 7)[0] as number)).toBeUndefined();
    expect(w.penOf(E(1))).toBeUndefined();
    frame([{ e: E(1), text: "milk" }]);
    expect(startsOf(w, E(1)).every((s) => s === BEFORE)).toBe(true);
  });

  it("the note writes in the desk's weight: its run's header carries `HAND_WEIGHT`, so the pen is as dark as the raster it replaces", () => {
    const { w, frame } = desk();
    frame([{ e: E(1), text: "buy milk" }]);
    const d = w.penOf(E(1))?.run.data as Float32Array;
    expect(HAND_WEIGHT).toBeGreaterThan(0);
    expect(d[4 * 3 + 3]).toBe(Math.fround(HAND_WEIGHT));   // h3.w: the outline moved outward by it, em
    expect(d[4 * 3 + 1]).toBe(Math.fround(DEFAULT_BLEED));   // beside the raster's own bleed
  });

  it("the record carries the run's base and the held scale to the pass; a sheet off the pen carries none", () => {
    const G = resolvePaper({ cx: 0, cy: 0, w: 200, h: 200, angle: 0 }, { held: 1, ring: 0, fade: 1 }, DEFAULT_PAPER_LAW, lamp);
    const buf = Paper.alloc(2);
    buf.set(paperValues({ geometry: G, paper: [1, 0.9, 0.6], ink: [0.1, 0.1, 0.2], pen: { base: 4096 } }, PAPER.grain), 0);
    buf.set(paperValues({ geometry: G, paper: [1, 0.9, 0.6], ink: [0.1, 0.1, 0.2] }, PAPER.grain), 1);
    const f = new Float32Array(buf.bytes);
    const at = (el: number) => (Paper.slots.pen.byte + el * Paper.size) / 4;
    expect([f[at(0)], f[at(0) + 1], f[at(0) + 2]]).toEqual([4096, 1, Math.fround(G.scale)]);
    expect([f[at(1)], f[at(1) + 1]]).toEqual([0, 0]);
    expect(G.scale).toBeGreaterThan(1);   // a held sheet reads at the lift's scale: the shader divides it out
  });
});
