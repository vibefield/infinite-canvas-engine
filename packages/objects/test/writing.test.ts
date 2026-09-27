// The desk's WRITING (design-015 §6.1; D2c): the paper kind's own state on one desk. Pinned: the
// raster cache's KEYS — a layout re-laid only when one of its inputs moves (the text, the seeds, the
// seed, the size, the face's version), a raster redrawn only on a new layout or a band crossing (the
// √2 ladder's hysteresis: never on a pan or a wobble), only within 200 CSS px of the view; the
// RESIDENCY — a new size frees the old rect, `forget` gives it back (no page leak across a delete),
// full pages evict what no one drew and else draw blank, honestly; a PINNED still wins and is never
// re-rastered; no text raster (the oracle) rasters nothing live; the WIPE and the CARET as flux.
import type { Entity } from "@ice/core";
import { describe, expect, it } from "vitest";
import { InkShelves, uvOf } from "../src/paper/pages";
import { DEFAULT_PAPER_LAW, lampOf, resolvePaper } from "../src/paper/paper";
import { type InkBitmap, type TextRaster, encodeSeeds, type HandLayout, type HandMetrics } from "@ice/desk/kit";
import { caretIndexIn, createWriting, type InkPages } from "../src/paper/writing";
import { MAT_GRID } from "@ice/desk";

const E = (n: number) => n as Entity;
const lamp = lampOf(MAT_GRID.plane);
const VIEW = { camX: 0, camY: 0, zoom: 1, width: 1200, height: 800, dpr: 2 };

/** A text raster that counts: every glyph an em-half wide; `ready` flips the face on (the version bumps). */
function fakeText() {
  const metrics: HandMetrics = { ascent: 0.8, descent: 0.2, advance: () => 0.5 };
  let ready = true;
  let version = 1;
  const calls: { band: number; w: number; h: number; glyphs: number }[] = [];
  const text: TextRaster = {
    metrics: () => (ready ? metrics : undefined),
    version: () => version,
    raster(L: HandLayout, _face, box, band): InkBitmap {
      const w = Math.max(1, Math.ceil(box.w * band));
      const h = Math.max(1, Math.ceil(box.h * band));
      calls.push({ band, w, h, glyphs: L.glyphs.length });
      return { bytes: new Uint8Array(w * h).fill(200), w, h };
    },
  };
  return { text, calls, setReady(r: boolean) { ready = r; version += 1; } };
}

/** Pages over the real shelves (pages.ts), 2048² × `layers`, with a write log. */
function fakePages(layers = 4) {
  const shelves = new InkShelves(2048, layers);
  const writes: string[] = [];
  let resets = 0;
  const pages: InkPages = {
    alloc: (w, h) => shelves.alloc(w, h),
    free: (r) => shelves.free(r),
    write: (r, bytes) => { writes.push(`${r.layer}:${r.x},${r.y} ${r.w}×${r.h} ${bytes.length}`); return uvOf(r.x, r.y, r.w, r.h, 2048, 2048); },
    reset: () => { shelves.reset(); resets += 1; },
    trim: () => shelves.trim(),
  };
  return { pages, shelves, writes, resets: () => resets };
}

function desk(opts: { text?: TextRaster | undefined; layers?: number; drawn?: (e: Entity) => number | undefined } = {}) {
  const t = fakeText();
  const p = fakePages(opts.layers);
  const w = createWriting({ pages: () => p.pages, text: "text" in opts ? opts.text : t.text, ...(opts.drawn !== undefined ? { drawn: opts.drawn } : {}) });
  let now = 0;
  /** One frame: the tick, then every note drawn in order. */
  const frame = (notes: { e: Entity; cx: number; cy: number; text: string; seeds?: string; seed?: number; w?: number }[], view = VIEW, dt = 16) => {
    now += dt;
    const want = w.tick(now);
    const out = notes.map((n) => {
      const rect = { cx: n.cx, cy: n.cy, w: n.w ?? 200, h: n.w ?? 200 };
      const G = resolvePaper({ cx: rect.cx, cy: rect.cy, w: rect.w, h: rect.h, angle: 0 }, { held: 0, ring: 0, fade: 1 }, DEFAULT_PAPER_LAW, lamp);
      return w.draw(n.e, { text: n.text, seeds: n.seeds ?? "", seed: n.seed ?? 7 }, rect, view, G);
    });
    return { want, out };
  };
  return { w, t, p, frame, now: () => now };
}

describe("the writing · the raster cache's keys", () => {
  it("draws a note ONCE: the same frame again lays and rasters nothing; an empty sheet holds no raster", () => {
    const { w, t, frame } = desk();
    const a = { e: E(1), cx: 300, cy: 250, text: "hi" };
    const b = { e: E(2), cx: 600, cy: 250, text: "" };
    const f1 = frame([a, b]);
    expect(f1.out[0]?.raster).toBeDefined();
    expect(f1.out[1]?.raster).toBeUndefined();
    expect(t.calls).toEqual([{ band: 2, w: 400, h: 400, glyphs: 2 }]);   // zoom 1 × dpr 2 → band 2
    frame([a, b]);
    frame([a, b]);
    expect(t.calls.length).toBe(1);
    expect(w.stats()).toMatchObject({ layouts: 2, rasters: 1, resident: 1 });
  });

  it("an edit re-lays and re-rasters IN ITS OWN RECT; the seeds alone, the seed, the face's version each re-lay", () => {
    const { w, t, p, frame } = desk();
    frame([{ e: E(1), cx: 300, cy: 250, text: "hi" }]);
    frame([{ e: E(1), cx: 300, cy: 250, text: "hit" }]);
    expect(t.calls.map((c) => c.glyphs)).toEqual([2, 3]);
    expect(p.writes[0]?.split(" ")[0]).toBe(p.writes[1]?.split(" ")[0]);   // the same texels, overwritten
    const L0 = w.layoutOf(E(1));
    frame([{ e: E(1), cx: 300, cy: 250, text: "hit", seeds: encodeSeeds([1, 2, 3]) }]);
    expect(w.layoutOf(E(1))).not.toBe(L0);
    const L1 = w.layoutOf(E(1));
    frame([{ e: E(1), cx: 300, cy: 250, text: "hit", seeds: encodeSeeds([1, 2, 3]), seed: 8 }]);
    expect(w.layoutOf(E(1))).not.toBe(L1);
    const L2 = w.layoutOf(E(1));
    t.setReady(true);   // a face landed: the version moved
    frame([{ e: E(1), cx: 300, cy: 250, text: "hit", seeds: encodeSeeds([1, 2, 3]), seed: 8 }]);
    expect(w.layoutOf(E(1))).not.toBe(L2);
    expect(t.calls.length).toBe(5);
    expect(w.stats().layouts).toBe(5);
  });

  it("the band ladder: a pan and a wobble under the rung re-raster nothing; a rung crossing re-rasters once, at the new size in a new rect", () => {
    const { w, t, frame } = desk();
    const n = { e: E(1), cx: 300, cy: 250, text: "hi" };
    frame([n], { ...VIEW, zoom: 1.6 });                        // 3.2 → the rung at or above: 4
    expect(w.rasterOf(E(1))).toMatchObject({ band: 4, w: 800, h: 800 });
    frame([n], { ...VIEW, zoom: 1.6, camX: 40, camY: -20 });   // a pan
    frame([n], { ...VIEW, zoom: 1 });                          // 2 ≥ 4 / 2.3: kept by the hysteresis
    frame([n], { ...VIEW, zoom: 1.9 });                        // 3.8 ≤ 4: kept
    expect(t.calls.length).toBe(1);
    frame([n], { ...VIEW, zoom: 4 });                          // 8: a crossing
    expect(w.rasterOf(E(1))).toMatchObject({ band: 8, w: 1600, h: 1600 });
    frame([n], { ...VIEW, zoom: 0.5 });                        // 1 < 8 / 2.3: down to 1
    expect(w.rasterOf(E(1))).toMatchObject({ band: 1, w: 200, h: 200 });
    expect(t.calls.map((c) => c.band)).toEqual([4, 8, 1]);
  });

  it("bandOf — the paper kind's RUNG (K6b): the band `draw` rasters at, under the same hysteresis; 0 for an empty sheet, a pinned still, no text raster", () => {
    const { w, frame } = desk();
    const n = { e: E(1), cx: 300, cy: 250, text: "hi" };
    const P = { text: "hi" };
    const R = { w: 200, h: 200 };
    expect(w.bandOf(n.e, P, R, 1.6, 2)).toBe(4);   // no raster yet: the rung at or above 3.2
    frame([n], { ...VIEW, zoom: 1.6 });
    expect(w.bandOf(n.e, P, R, 1, 2)).toBe(4);     // 2 ≥ 4 / 2.3: held by the hysteresis around the raster's band
    expect(w.bandOf(n.e, P, R, 0.5, 2)).toBe(1);   // 1 < 4 / 2.3: down to the rung at or above
    for (const zoom of [1.9, 1, 4, 3, 0.5, 0.7]) {
      const asked = w.bandOf(n.e, P, R, zoom, 2);
      frame([n], { ...VIEW, zoom });
      expect(w.rasterOf(n.e)?.band).toBe(asked);   // what the rung said is what the raster became
    }
    expect(w.bandOf(n.e, P, { w: 1024, h: 200 }, 8, 2)).toBe(2);   // capped at the page: 2048 / 1024
    expect(w.bandOf(E(2), { text: "" }, R, 1.6, 2)).toBe(0);
    expect(w.pin(E(3), new Uint8Array(4), { w: 2, h: 2 })).toBe(true);
    expect(w.bandOf(E(3), { text: "pinned" }, R, 1.6, 2)).toBe(0);
    expect(desk({ text: undefined }).w.bandOf(E(1), P, R, 1.6, 2)).toBe(0);
  });

  it("only a note within 200 CSS px of the view pays for a raster; one further out keeps what it has", () => {
    const { w, t, frame } = desk();
    // the note's circle (r = 141) edge 250 px past the right of the view: out
    const far = { e: E(1), cx: 1200 + 141.5 + 250, cy: 400, text: "far" };
    frame([far]);
    expect(w.rasterOf(E(1))).toBeUndefined();
    const near = { ...far, cx: 1200 + 141.5 + 150 };           // 150 px out: within the 200
    frame([near]);
    expect(w.rasterOf(E(1))).toBeDefined();
    frame([{ ...far, text: "far!" }], { ...VIEW });            // edited while far: it keeps the raster it has
    expect(t.calls.length).toBe(1);
    expect(w.rasterOf(E(1))).toBeDefined();
  });
});

describe("the writing · residency in the pages", () => {
  it("a new size frees the old rect; `forget` gives the rect back — a delete leaks no page slot, and the note re-rasters when it returns", () => {
    const { w, p, frame } = desk();
    frame([{ e: E(1), cx: 300, cy: 250, text: "hi" }]);
    const used1 = p.shelves.stats.used;
    expect(used1).toBe(400 * 400);
    frame([{ e: E(1), cx: 300, cy: 250, text: "hi", w: 300 }]);
    expect(p.shelves.stats.used).toBe(600 * 600);
    w.forget(E(1));
    expect(p.shelves.stats.used).toBe(0);
    expect(p.shelves.stats.rows).toBe(0);   // and the trailing rows went with it
    for (let i = 0; i < 20; i++) {           // twenty delete → undo cycles: never a leak
      frame([{ e: E(100 + i), cx: 300, cy: 250, text: "hi" }]);
      w.forget(E(100 + i));
    }
    expect(p.shelves.stats.used).toBe(0);
    expect(w.stats().resident).toBe(0);
  });

  it("pages full: what no one drew in the last two frames is evicted, oldest first; still full, the sheet draws blank, honestly", () => {
    const { w, frame } = desk({ layers: 1 });
    // one 2048² layer holds one 1600² raster (band 8): a second on screen at once cannot fit
    const z4 = { ...VIEW, zoom: 4 };
    frame([{ e: E(1), cx: 100, cy: 100, text: "one" }], z4);
    const both = frame([{ e: E(1), cx: 100, cy: 100, text: "one" }, { e: E(2), cx: 150, cy: 100, text: "two" }], z4);
    expect(both.out[1]?.raster).toBeUndefined();
    expect(w.stats().blanks).toBe(1);
    // the first leaves the view for good: two frames later its raster is fair game, and the second takes its place
    frame([{ e: E(2), cx: 150, cy: 100, text: "two" }], z4);
    const later = frame([{ e: E(2), cx: 150, cy: 100, text: "two" }], z4);
    expect(later.out[0]?.raster).toBeDefined();
    expect(w.stats().evicted).toBe(1);
    expect(w.rasterOf(E(1))).toBeUndefined();
  });

  it("a PINNED still is allocated at once in call order, wins over the live text, is never re-rastered; reset carves the pages afresh", () => {
    const { w, t, p, frame } = desk();
    expect(w.pin(E(1), new Uint8Array(400 * 400), { w: 400, h: 400 })).toBe(true);
    expect(w.rasterOf(E(1))).toMatchObject({ layer: 0, x: 0, y: 0, pinned: true });
    const f = frame([{ e: E(1), cx: 300, cy: 250, text: "buy milk" }], { ...VIEW, zoom: 4 });
    expect(f.out[0]?.raster).toBeDefined();
    expect(f.out[0]?.caret).toBeUndefined();
    expect(t.calls.length).toBe(0);
    w.reset();
    expect(p.resets()).toBe(1);
    expect(w.rasterOf(E(1))).toBeUndefined();
    expect(w.isPinned(E(1))).toBe(false);
  });

  it("no text raster — the Node oracle — rasters nothing live; the pinned rasters still draw", () => {
    const { w, frame } = desk({ text: undefined });
    const f = frame([{ e: E(1), cx: 300, cy: 250, text: "hi" }]);
    expect(f.out[0]?.raster).toBeUndefined();
    expect(w.pin(E(2), new Uint8Array(4), { w: 2, h: 2 })).toBe(true);
    expect(frame([{ e: E(2), cx: 300, cy: 250, text: "hi" }]).out[0]?.raster).toBeDefined();
  });

  it("a face still loading lays and rasters nothing — the sheet waits, blank — and the landing wakes a frame that does", () => {
    const { w, t, frame } = desk();
    t.setReady(false);
    const f0 = frame([{ e: E(1), cx: 300, cy: 250, text: "hi" }]);
    expect(f0.out[0]?.raster).toBeUndefined();
    expect(w.layoutOf(E(1))).toBeUndefined();
    t.setReady(true);
    const f1 = frame([{ e: E(1), cx: 300, cy: 250, text: "hi" }]);
    expect(f1.want).toBe(true);
    expect(f1.out[0]?.raster).toBeDefined();
  });
});

describe("the writing · a delete ghost", () => {
  it("a FADING note draws the raster it holds and asks for nothing: no layout, no raster — after a reset it fades blank", () => {
    const { w, t, p } = desk();
    const G = resolvePaper({ cx: 300, cy: 250, w: 200, h: 200, angle: 0 }, { held: 0, ring: 0, fade: 1 }, DEFAULT_PAPER_LAW, lamp);
    const rect = { cx: 300, cy: 250, w: 200, h: 200 };
    w.tick(16);
    const held = w.draw(E(1), { text: "hi", seeds: "", seed: 7 }, rect, VIEW, G);
    expect(w.draw(E(1), { text: "hi", seeds: "", seed: 7 }, rect, VIEW, G, true).raster).toEqual(held.raster);
    w.reset();
    const layouts = w.stats().layouts;
    expect(w.draw(E(1), { text: "hi", seeds: "", seed: 7 }, rect, VIEW, G, true)).toEqual({});
    expect([w.stats().layouts, t.calls.length, p.shelves.stats.used]).toEqual([layouts, 1, 0]);
  });
});

describe("the writing · the pen and the caret (flux)", () => {
  it("the wipe runs 110 ms over the newest glyph — a frame wanted every tick meanwhile — then is gone and the desk idles", () => {
    const { w, frame } = desk();
    const n = { e: E(1), cx: 300, cy: 250, text: "hi" };
    frame([n]);
    w.wrote(E(1), 1, 16);
    const f1 = frame([n]);                    // now 32: t = 16/110
    expect(f1.want).toBe(true);
    expect(f1.out[0]?.wipe?.t).toBeCloseTo(16 / 110, 6);
    const glyph = w.layoutOf(E(1))?.glyphs[1];
    expect(f1.out[0]?.wipe?.x0).toBeLessThan(glyph?.x ?? 0);
    let f = f1;
    for (let i = 0; i < 6; i++) f = frame([n]);   // 128 ms: over
    expect(f.out[0]?.wipe).toBeUndefined();
    expect(w.wipeOf(E(1))).toBeUndefined();
    expect(frame([n]).want).toBe(false);
    w.wrote(E(1), undefined, 200);            // a paste arrives whole: no wipe
    expect(frame([n]).out[0]?.wipe).toBeUndefined();
  });

  it("a wipe on a note NOT drawn again (panned off): it is let go when its time is up and asks nothing more — the builder's word, when given, asks nothing at all (law #7, D7)", () => {
    const n = { e: E(1), cx: 300, cy: 250, text: "hi" };
    // no word from a builder: the wipe's own 110 ms and one frame to draw it done, then quiet — though the note is never drawn again
    const bare = desk();
    bare.frame([n]);
    const laid = bare.w.landed(E(1));
    expect(laid).toBeGreaterThan(0);   // its raster laid: a landing (D7)
    bare.w.wrote(E(1), 1, 16);
    const wants: boolean[] = [];
    for (let i = 0; i < 12; i++) wants.push(bare.frame([]).want);   // 192 ms of frames that draw nothing
    expect(wants.slice(0, 7).every((x) => x)).toBe(true);
    expect(wants.slice(7)).toEqual([false, false, false, false, false]);
    expect(bare.w.wipeOf(E(1))).toBeUndefined();
    expect(bare.w.landed(E(1))).toBe(laid + 1);   // the wipe let go: one landing; its running frames none
    // the builder's word: the note culled while its wipe runs — no frame is asked for it
    let shown = true;
    const cut = desk({ drawn: () => (shown ? 0 : undefined) });
    cut.frame([n]);
    cut.w.wrote(E(1), 1, 16);
    shown = false;
    expect(cut.frame([]).want).toBe(true);    // the write itself: one frame (its text moved)
    expect(cut.frame([]).want).toBe(false);   // …and none for its wipe, still running (32 of 110 ms)
    expect(cut.w.wipeOf(E(1))).toBeDefined();
    for (let i = 0; i < 8; i++) cut.frame([]);
    expect(cut.w.wipeOf(E(1))).toBeUndefined();
  });

  it("the caret stands before its glyph and blinks every 530 ms: a frame wanted at each flip, none between", () => {
    const { w, frame, now } = desk();
    const n = { e: E(1), cx: 300, cy: 250, text: "hi" };
    frame([n]);
    w.caret(E(1), 1, now());
    const f0 = frame([n]);
    const L = w.layoutOf(E(1));
    expect(f0.out[0]?.caret).toMatchObject({ x: L?.positions[2], y: L?.positions[3], on: true });
    let wants = 0;
    let flips = 0;
    let on = true;
    for (let i = 0; i < 70; i++) {            // 1.12 s at 16 ms
      const f = frame([n]);
      if (f.want) wants += 1;
      const c: boolean = f.out[0]?.caret?.on ?? on;
      if (c !== on) { flips += 1; on = c; }
    }
    expect(flips).toBe(2);
    expect(wants).toBe(2);
    w.caret(undefined);
    expect(frame([n]).out[0]?.caret).toBeUndefined();
  });

  it("the tap's caret index: the layout's nearest position, lines weighed three times the columns", () => {
    const { w, frame } = desk();
    frame([{ e: E(1), cx: 300, cy: 250, text: "ab\ncd" }]);
    const L = w.layoutOf(E(1));
    if (L === undefined) throw new Error("no layout");
    // the note's top-left is (200, 150) in the world; position i sits at (x, y) in note units
    const at = (i: number) => w.caretIndexAt(E(1), 200 + (L.positions[2 * i] as number) + 1, 150 + (L.positions[2 * i + 1] as number) - L.ascent * 0.4);
    expect([0, 1, 2, 3, 4, 5].map(at)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(caretIndexIn(L, 1e6, (L.positions[1] as number) - L.ascent * 0.4, 5)).toBe(2);   // far right of line 1: its end
    expect(w.noteAt(300, 250)).toBe(E(1));
    expect(w.noteAt(10, 10)).toBeUndefined();
  });
});

describe("the ink pages · trim (pages.ts, D2c)", () => {
  it("gives back only TRAILING empty rows; a row before a used one stays; an emptied layer is carved afresh", () => {
    const s = new InkShelves(2048, 1);
    const a = s.alloc(400, 400);
    const b = s.alloc(566, 566);
    if (a === null || b === null) throw new Error("alloc");
    expect(s.stats.rows).toBe(2);
    s.free(a);
    expect(s.trim()).toBe(0);                 // a's row is not trailing: b's is after it
    s.free(b);
    expect(s.trim()).toBe(2);
    expect(s.stats.rows).toBe(0);
    expect(s.alloc(1600, 1600)).toMatchObject({ layer: 0, x: 0, y: 0 });
  });
});
