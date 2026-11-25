// THE MARKS DRAWN (petition I60 — "Editing the Ink": a highlight under the words, a strike through them, an underline under them,
// a pen for each letter, the selection's wash), their CPU half: the glyph run built from an INK carries a MARKS SECTION after its
// glyphs (kit/ink-strokes.ts) and each glyph's pen, the pen it had and its re-ink in g4's last float; the kit's `marks` WGSL piece
// reads them (shaders/kit/marks.wgsl — `ink_marks`) and `inkMarksAt` is its twin. Pinned here, on a face of the tests' own
// (./hand-fixture): the head names the section; every stroke is listed in each row its reach meets and in no other, every laid
// line's caret band likewise; the same ink gives the same bytes; a WASH is rewritten alone — the head and one vec4 a laid line,
// byte for byte the run built with it — and the store writes it in two writes; blank paper reads nothing; the strokes are the
// design page's (the spike's polyline model over the same law agrees with the twin's analytic line); a stroke is pulled through
// from its moment, the stretch on the paper before shown throughout, a recolour showing the old value ahead of the pen; a re-inked
// glyph's ink is split by the new pen's front along its own path (`handInkAt`'s `was` and `over`); the WGSL's constants are the
// kit's. The pixels are marks.dawn.test.ts's.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { handMetricsOf } from "../src/kit/hand-atlas";
import { createHandRuns } from "../src/kit/hand-gpu";
import { HAND_RUN, type HandRun, handEase, handInkAt, handRun } from "../src/kit/hand-run";
import { carryInk, findQuote, type InkValue, inkOf, type MarkStroke, mark, spansOf, strokesOf } from "../src/kit/ink";
import { inkMarksAt, inkWash, washRun } from "../src/kit/ink-marks";
import { INK_MARKS, INK_STROKES, INK_WASH, inkCentre, inkShape, inkSection, strokeValueOf } from "../src/kit/ink-strokes";
import { type PenMarks, type PenMoment, SHOWN, type StrokeMoment, WRITTEN } from "../src/kit/pen-clock";
import { HAND, type HandLayout, layoutText } from "../src/kit/text";
import { kitWgsl } from "../src/kit/wgsl";
import { installGpuFlags } from "./fake-gpu";
import { fixtureFace } from "./hand-fixture";

installGpuFlags();

const face = fixtureFace();
const metrics = handMetricsOf(face.atlas);
const TEXT = "lol xo. lox ool\nlx. xx lo ox lol\nxol lo. oxo ll\nlox ox. lol xo";

/** The words of `ink` quoted, as an agent names them. */
function at(ink: InkValue, quote: string): { readonly from: number; readonly to: number } {
  const r = findQuote(ink.text, quote);
  if ("error" in r) throw new Error(`no "${quote}"`);
  return r;
}
/** The test's sheet: a highlight, a strike in red, an underline in the words' own pen, and words in the red pen. */
function marked(): InkValue {
  let ink = inkOf({ text: TEXT }, 11);
  const r = (q: string) => at(ink, q);
  ink = mark(ink, r("xo. lox").from, r("xo. lox").to, { highlight: "yellow" });
  ink = mark(ink, r("lx. xx").from, r("lx. xx").to, { strike: "red" });
  ink = mark(ink, r("lo ox").from, r("lo ox").to, { underline: true });
  ink = mark(ink, r("oxo ll").from, r("oxo ll").to, { pen: "red" });
  return ink;
}
const lay = (ink: InkValue): HandLayout => layoutText(ink.text, { w: 420, h: 320 }, HAND, metrics, 11, ink.seeds);
const vec = (run: HandRun, i: number): number[] => Array.from(run.data.subarray(4 * i, 4 * i + 4));
const em = HAND.size;

describe("the run built from an ink carries its marks (petition I60)", () => {
  it("lays a marks section after its glyphs: the head says where it begins, its strokes, and that nothing is washed", () => {
    const ink = marked();
    const L = lay(ink);
    const strokes = strokesOf(L, ink);
    const run = handRun(L, face.atlas, { ink });
    expect(strokes.map((s) => s.kind)).toEqual(["highlight", "strike", "underline"]);
    expect(run.marks).toBeDefined();
    const mk = run.marks as NonNullable<HandRun["marks"]>;
    const glyphsAt = run.data[9] as number;
    expect(mk.at).toBe(glyphsAt + HAND_RUN.glyph * run.glyphs);   // no re-ink: the section right after the glyphs
    expect(vec(run, INK_MARKS.head)).toEqual([mk.at, 3, 0, 0]);
    expect(mk).toMatchObject({ strokes: 3, lines: L.lines.length, em });
    expect(run.length).toBe(mk.washAt + L.lines.length);
    // the section's first vec4: the rows' top, one over the em, how many, where the wash begins (from the section's start)
    const [y0, inv, rows, washAt] = vec(run, mk.at) as [number, number, number, number];
    expect(inv).toBe(Math.fround(1 / em));
    expect(rows).toBe(mk.rows);
    expect(mk.at + washAt).toBe(mk.washAt);
    expect(y0).toBeLessThan((L.lines[0]?.y ?? 0) - L.ascent);
    // a run built without an ink is the pen's alone: the head reads none, nothing follows the glyphs
    const bare = handRun(L, face.atlas);
    expect(vec(bare, INK_MARKS.head)).toEqual([0, 0, 0, 0]);
    expect(bare.marks).toBeUndefined();
    expect(bare.length).toBe(glyphsAt + HAND_RUN.glyph * bare.glyphs);
  });

  it("lists every stroke in each row its reach meets and in no other, and each laid line in the rows its caret band meets", () => {
    const ink = marked();
    const L = lay(ink);
    const run = handRun(L, face.atlas, { ink });
    const mk = run.marks as NonNullable<HandRun["marks"]>;
    const [y0, inv, rows] = vec(run, mk.at) as [number, number, number];
    const strokesAt = mk.at + 1 + rows;
    const listAt = strokesAt + INK_MARKS.stroke * mk.strokes;
    const half = 0.5 * INK_MARKS.ramp * em + 1e-3;
    const rowOf = (v: number): number => Math.min(rows - 1, Math.max(0, Math.floor((v - y0) * inv)));
    for (let r = 0; r < rows; r++) {
      const [offset, count, la, lb] = vec(run, mk.at + 1 + r) as [number, number, number, number];
      const listed = Array.from({ length: count }, (_, k) => run.data[4 * listAt + offset + k] as number);
      for (let n = 0; n < mk.strokes; n++) {
        const [, , y, reach] = vec(run, strokesAt + INK_MARKS.stroke * n) as [number, number, number, number];
        const meets = r >= rowOf(y - reach - half) && r <= rowOf(y + reach + half);
        expect(listed.includes(n), `row ${r}, stroke ${n}`).toBe(meets);
      }
      L.lines.forEach((ln, k) => {
        const meets = r >= rowOf(ln.y - L.ascent - half) && r <= rowOf(ln.y + L.descent + half);
        expect(k >= la && k < lb, `row ${r}, line ${k}`).toBe(meets);
      });
    }
  });

  it("draws each stroke as a hand makes it — its ends run past the words, its centre on its line, its hand from its first glyph's seed, kept through an edit before it", () => {
    const ink = marked();
    const L = lay(ink);
    const strokes = strokesOf(L, ink);
    for (const s of strokes) {
      const law = INK_STROKES[s.kind];
      const shape = inkShape(s, em, ink.seeds[s.from] as number);
      expect(shape.x0).toBeCloseTo(s.x0 - law.before * em, 9);
      expect(shape.x1).toBeCloseTo(s.x1 + law.after * em, 9);
      expect(shape.y).toBe(s.y);
      expect(shape.hw).toBeCloseTo(law.hw * em, 9);
      expect(Math.abs(shape.slope - law.bias)).toBeLessThanOrEqual(law.tilt + 1e-12);
      expect(Math.abs(shape.lean)).toBeLessThanOrEqual(s.kind === "highlight" ? INK_MARKS.chisel : 0);
      // its reach holds its whole centre line, its width about it
      for (let x = shape.x0; x <= shape.x1; x += 0.5) expect(Math.abs(inkCentre(shape, x, em).y - shape.y) + shape.hw).toBeLessThanOrEqual(shape.reach + 1e-9);
    }
    // a highlight's value is its highlighter; a line's its pen: red (PENS[3]) is 4, "the words' own" over the sheet's own pen 0
    expect(strokes.map((s) => inkShape(s, em, 1).value)).toEqual([1, 4, 0]);
    // words typed before them: the strokes move with their words and keep their hand
    const typed = carryInk(ink, `xx ${ink.text}`, (() => { let n = 900; return () => n++; })()).ink;
    const moved = strokesOf(lay(typed), typed);
    moved.forEach((s, i) => {
      const a = inkShape(strokes[i] as MarkStroke, em, ink.seeds[(strokes[i] as MarkStroke).from] as number);
      const b = inkShape(s, em, typed.seeds[s.from] as number);
      expect([b.slope, b.p1, b.p2, b.lean]).toEqual([a.slope, a.p1, a.p2, a.lean]);
    });
  });

  it("carries each glyph's pen, the pen it had and its re-ink in g4's last float, and the re-inks' moments after the glyphs", () => {
    const ink = marked();
    const L = lay(ink);
    const T = 50_000;
    const red = at(ink, "oxo ll");
    // the clock's answer, by hand: the red words being re-inked from felt (pen 1), each glyph 120 ms, 40 ms apart
    const was = L.glyphs.map((g) => (g.index >= red.from && g.index < red.to ? 1 : 0));
    const reinks: PenMoment[] = L.glyphs.map((g, j) => (g.index >= red.from && g.index < red.to ? { start: T + 40 * j, dur: 120 } : WRITTEN));
    const m: PenMarks = { was, reinks, strokes: strokesOf(L, ink).map(() => SHOWN) };
    const run = handRun(L, face.atlas, { ink, marked: m, epoch: T - 10 });
    const glyphsAt = run.data[9] as number;
    const n = was.filter((w) => w === 1).length;
    expect(run.reinks).toBe(n);
    expect((run.marks as NonNullable<HandRun["marks"]>).at).toBe(glyphsAt + HAND_RUN.glyph * run.glyphs + Math.ceil(n / 2));
    let entry = 0;
    L.glyphs.forEach((g, j) => {
      const packed = run.data[4 * (glyphsAt + HAND_RUN.glyph * j + 4) + 3] as number;
      const pen = packed % 16;
      const had = Math.floor(packed / 16) % 16;
      const re = Math.floor(packed / 256);
      const inRed = g.index >= red.from && g.index < red.to;
      expect(pen, `glyph ${j}`).toBe(inRed ? 4 : 0);
      expect(had, `glyph ${j}`).toBe(inRed ? 1 : 0);
      if (!inRed) { expect(re).toBe(0); return; }
      entry += 1;
      expect(re).toBe(entry);
      const k = re - 1;
      const pair = vec(run, glyphsAt + HAND_RUN.glyph * run.glyphs + (k >> 1));
      expect(pair.slice((k & 1) * 2, (k & 1) * 2 + 2)).toEqual([T + 40 * j - (T - 10), 120]);
    });
    // `pens` still names a glyph's pen when a kind gives them (P2's option), over the ink's
    const own = handRun(L, face.atlas, { ink, pens: L.glyphs.map(() => 2) });
    expect(Array.from({ length: own.glyphs }, (_, j) => (own.data[4 * (glyphsAt + HAND_RUN.glyph * j + 4) + 3] as number) % 16).every((p) => p === 2)).toBe(true);
  });

  it("gives the same bytes for the same ink, moments and wash", () => {
    const ink = marked();
    const L = lay(ink);
    const wash = spansOf(L, 2, 30);
    const a = handRun(L, face.atlas, { ink, wash, epoch: 1234 });
    const b = handRun(lay(ink), face.atlas, { ink, wash: spansOf(lay(ink), 2, 30), epoch: 1234 });
    expect(Array.from(b.data)).toEqual(Array.from(a.data));
  });
});

describe("the selection's wash is rewritten alone (petition I60)", () => {
  it("changes only the marks' head and one vec4 a laid line — byte for byte the run built with that wash", () => {
    const ink = marked();
    const L = lay(ink);
    const before = handRun(L, face.atlas, { ink, wash: spansOf(L, 3, 9) });
    const spans = spansOf(L, 12, 40);
    const built = handRun(L, face.atlas, { ink, wash: spans });
    const w = inkWash(before, spans);
    const mk = before.marks as NonNullable<HandRun["marks"]>;
    expect(w.at).toBe(mk.washAt);
    expect(w.lines.length).toBe(4 * L.lines.length);
    expect(Array.from(washRun(before, w).data)).toEqual(Array.from(built.data));
    // the texels that differ between the two runs are the head and the wash's own
    for (let i = 0; i < before.length; i++) {
      const differs = vec(before, i).some((v, c) => v !== (built.data[4 * i + c] as number));
      if (differs) expect(i === INK_MARKS.head || (i >= mk.washAt && i < mk.washAt + L.lines.length), `vec4 ${i}`).toBe(true);
    }
    // nothing selected: the head reads no wash
    expect(Array.from(inkWash(built, []).head)).toEqual([mk.at, mk.strokes, 0, 0]);
    // a run built without an ink has no room for one
    expect(() => inkWash(handRun(L, face.atlas), spans)).toThrow(/no marks section/);
  });

  it("is written into a kind's run store in two writes — the head's texel and the lines — and refused for a key without a run", () => {
    const puts: { x: number; y: number; w: number; h: number; offset: number }[] = [];
    const dev = {
      limits: { maxTextureDimension2D: 8192 },
      createTexture: (d: GPUTextureDescriptor) => ({ label: d.label ?? "", createView: () => ({}), destroy: () => {} }),
      createCommandEncoder: () => ({ copyTextureToTexture: () => {}, finish: () => ({}) }),
      queue: {
        writeTexture: (dst: { origin?: { x: number; y: number } }, _d: unknown, layout: GPUTexelCopyBufferLayout, size: number[]) =>
          puts.push({ x: dst.origin?.x ?? 0, y: dst.origin?.y ?? 0, w: size[0] as number, h: size[1] as number, offset: layout.offset ?? 0 }),
        submit: () => {},
      },
    } as unknown as GPUDevice;
    const runs = createHandRuns(dev, { label: "t/runs" });
    const ink = marked();
    const L = lay(ink);
    const run = handRun(L, face.atlas, { ink });
    runs.write("filler", { ...run, data: new Float32Array(4 * 700), length: 700 });
    const base = runs.write("sheet", run);
    puts.length = 0;
    expect(runs.wash("sheet", inkWash(run, spansOf(L, 0, 25)))).toBe(true);
    const texel = (i: number): { x: number; y: number } => ({ x: i % HAND_RUN.row, y: Math.floor(i / HAND_RUN.row) });
    const mk = run.marks as NonNullable<HandRun["marks"]>;
    expect(puts[0]).toMatchObject({ ...texel(base + INK_MARKS.head), w: 1, h: 1 });
    const lines = puts.slice(1);
    expect(lines.reduce((s, p) => s + p.w * p.h, 0)).toBe(L.lines.length);
    expect(lines[0]).toMatchObject(texel(base + mk.washAt));
    expect(runs.wash("nobody", inkWash(run, []))).toBe(false);
  });
});

describe("ink_marks's CPU twin, inkMarksAt (petition I60)", () => {
  it("reads nothing on blank paper: no section, one load; a sheet unmarked and unselected, one load anywhere", () => {
    const plain = inkOf({ text: TEXT }, 11);
    const L = lay(plain);
    const none = handRun(L, face.atlas);
    const section = handRun(L, face.atlas, { ink: plain });
    expect((section.marks as NonNullable<HandRun["marks"]>).strokes).toBe(0);
    for (let y = -10; y < 200; y += 1.7) {
      for (let x = -10; x < 430; x += 2.3) {
        for (const r of [none, section]) {
          const m = inkMarksAt(r, x, y, 0, 0.5);
          expect(m).toEqual({ marker: 0, tint: 0, wash: 0, line: 0, pen: 0, loads: 1 });
        }
      }
    }
  });

  it("finds a marked sheet's blank paper in three loads at most — outside the rows, or a row that lists no stroke — and lays nothing there", () => {
    const ink = marked();
    const L = lay(ink);
    const run = handRun(L, face.atlas, { ink });
    let blank = 0;
    for (let y = -20; y < 220; y += 1.3) {
      for (let x = -10; x < 430; x += 3.1) {
        const m = inkMarksAt(run, x, y, 0, 0.5);
        if (m.marker > 0 || m.line > 0) continue;
        if (m.loads <= 3) blank += 1;
      }
    }
    expect(blank).toBeGreaterThan(5000);
  });

  it("draws the design page's strokes: the spike's own polyline model of the same law agrees with the twin's analytic line", () => {
    const ink = marked();
    const L = lay(ink);
    const strokes = strokesOf(L, ink);
    const run = handRun(L, face.atlas, { ink });
    const aa = 0.25;
    for (const s of strokes) {
      const shape = inkShape(s, em, ink.seeds[s.from] as number);
      let worst = 0;
      let coarse = 0;
      let inked = 0;
      for (let y = shape.y - shape.reach - 2; y <= shape.y + shape.reach + 2; y += 0.11) {
        for (let x = shape.x0 - 4; x <= shape.x1 + 4; x += 0.37) {
          const twin = inkMarksAt(run, x, y, 0, aa);
          const got = s.kind === "highlight" ? twin.marker : twin.line;
          // the spike's marksheet.mjs: its centre line sampled every `step` em, the band read off the segment under x, a line's the
          // nearest segment — the same law; at 0.01 em its polyline is the curve, at its own 0.2 em a chord short of it
          const fine = spikeCover(shape, x, y, aa, 0.01);
          worst = Math.max(worst, Math.abs(got - fine));
          coarse = Math.max(coarse, Math.abs(got - spikeCover(shape, x, y, aa, 0.2)));
          if (fine > 0.1) inked += 1;
        }
      }
      console.log(`[ink-marks] ${s.kind}: twin against the spike's curve max |Δ| ${worst.toFixed(4)} (its 0.2 em polyline ${coarse.toFixed(4)}), ${inked} points inked`);
      expect(inked).toBeGreaterThan(50);
      expect(worst).toBeLessThan(0.03);
    }
  });

  it("lays a highlighter under its words at its presence, a strike through them on the x-height's middle and an underline under them, each in its pen", () => {
    const ink = marked();
    const L = lay(ink);
    const run = handRun(L, face.atlas, { ink });
    const [hl, st, ul] = strokesOf(L, ink).map((s) => inkShape(s, em, ink.seeds[s.from] as number)) as [ReturnType<typeof inkShape>, ReturnType<typeof inkShape>, ReturnType<typeof inkShape>];
    const mid = (s: typeof hl): readonly [number, number] => { const x = 0.5 * (s.x0 + s.x1); return [x, inkCentre(s, x, em).y]; };
    const h = inkMarksAt(run, ...mid(hl), 0, 0.25);
    expect(h).toMatchObject({ tint: 1, line: 0 });
    expect(h.marker).toBeCloseTo(INK_STROKES.highlight.press, 6);
    const base = (L.lines[0] as { y: number }).y;
    expect(hl.y).toBeCloseTo(base - 0.2 * em, 4);
    // the band is 0.7 em tall: in at 0.34 em off its centre line, out at 0.36
    const [hx, hy] = mid(hl);
    expect(inkMarksAt(run, hx, hy + 0.34 * em, 0, 0.25).marker).toBeGreaterThan(0.6);
    expect(inkMarksAt(run, hx, hy + 0.36 * em, 0, 0.25).marker).toBe(0);
    const s = inkMarksAt(run, ...mid(st), 0, 0.25);
    expect(s).toMatchObject({ pen: 4, marker: 0 });
    expect(s.line).toBeCloseTo(INK_STROKES.strike.press, 6);
    expect(st.y).toBeCloseTo((L.lines[1] as { y: number }).y - 0.2 * em, 4);
    const u = inkMarksAt(run, ...mid(ul), 0, 0.25);
    expect(u).toMatchObject({ pen: 0 });
    expect(u.line).toBeCloseTo(INK_STROKES.underline.press, 6);
    expect(ul.y).toBeCloseTo((L.lines[1] as { y: number }).y + 0.15 * em, 4);
  });

  it("pulls a stroke through from its moment: nothing before, the left of the pen's front while it draws, all after — the stretch on the paper before shown throughout", () => {
    const ink = marked();
    const L = lay(ink);
    const strokes = strokesOf(L, ink);
    const T = 10_000;
    const fresh: StrokeMoment = { start: T, dur: 400, have: [1, 0], was: -1 };
    const run = handRun(L, face.atlas, { ink, epoch: T - 50, marked: { was: [], reinks: [], strokes: [fresh, SHOWN, SHOWN] } });
    const hl = inkShape(strokes[0] as MarkStroke, em, ink.seeds[(strokes[0] as MarkStroke).from] as number);
    const along = (u: number): readonly [number, number] => { const x = hl.x0 + u * (hl.x1 - hl.x0); return [x, inkCentre(hl, x, em).y]; };
    expect(inkMarksAt(run, ...along(0.05), T - 1, 0.25).marker).toBe(0);
    const front = handEase(200 / 400);
    expect(inkMarksAt(run, ...along(front - 0.1), T + 200, 0.25).marker).toBeCloseTo(INK_STROKES.highlight.press, 6);
    expect(inkMarksAt(run, ...along(front + 0.1), T + 200, 0.25).marker).toBe(0);
    expect(inkMarksAt(run, ...along(0.95), T + 400, 0.25).marker).toBeCloseTo(INK_STROKES.highlight.press, 6);
    // grown at its end: its first part was on the paper — shown before the pen sets off, the pen pulling from where it ended
    const grown: StrokeMoment = { start: T, dur: 400, have: [0, 0.5], was: -1 };
    const run2 = handRun(L, face.atlas, { ink, epoch: T - 50, marked: { was: [], reinks: [], strokes: [grown, SHOWN, SHOWN] } });
    const strokeHalf = (0.5 * ((strokes[0] as MarkStroke).x0 + (strokes[0] as MarkStroke).x1) - hl.x0) / (hl.x1 - hl.x0);
    expect(inkMarksAt(run2, ...along(strokeHalf - 0.05), T - 1, 0.25).marker).toBeGreaterThan(0.6);
    expect(inkMarksAt(run2, ...along(strokeHalf + 0.05), T - 1, 0.25).marker).toBe(0);
    expect(inkMarksAt(run2, ...along(strokeHalf + 0.05), T + 300, 0.25).marker).toBeGreaterThan(0.6);
    // a recolour (pink over yellow, the highlighter changed): all of it laid throughout, the old ahead of the pen's front
    const pink = mark(ink, at(ink, "xo. lox").from, at(ink, "xo. lox").to, { highlight: "pink" });
    const recolour: StrokeMoment = { start: T, dur: 400, have: [1, 0], was: 1 };
    const run3 = handRun(L, face.atlas, { ink: pink, epoch: T - 50, marked: { was: [], reinks: [], strokes: [recolour, SHOWN, SHOWN] } });
    expect(inkMarksAt(run3, ...along(0.5), T - 1, 0.25)).toMatchObject({ tint: 1 });
    expect(inkMarksAt(run3, ...along(front - 0.1), T + 200, 0.25)).toMatchObject({ tint: 3 });
    expect(inkMarksAt(run3, ...along(front + 0.1), T + 200, 0.25)).toMatchObject({ tint: 1 });
    expect(inkMarksAt(run3, ...along(front + 0.1), T + 200, 0.25).marker).toBeCloseTo(INK_STROKES.highlight.press, 6);
  });

  it("lays the selection's wash square to each line — the caret's height, grown across, its corners rounded — under every stroke, and nowhere else", () => {
    const ink = marked();
    const L = lay(ink);
    const spans = spansOf(L, 4, 22);
    const run = washRun(handRun(L, face.atlas, { ink }), inkWash(handRun(L, face.atlas, { ink }), spans));
    expect(spans.length).toBe(2);
    for (const s of spans) {
      const cy = 0.5 * (s.y0 + s.y1);
      expect(inkMarksAt(run, 0.5 * (s.x0 + s.x1), cy, 0, 0.25).wash).toBe(1);
      expect(inkMarksAt(run, s.x0 - INK_WASH.pad * em + 0.2, cy, 0, 0.25).wash).toBe(1);
      expect(inkMarksAt(run, s.x0 - INK_WASH.pad * em - 0.2, cy, 0, 0.25).wash).toBe(0);
      // a corner is rounded: its very corner is bare
      expect(inkMarksAt(run, s.x0 - INK_WASH.pad * em + 0.05, s.y0 + 0.05, 0, 0.25).wash).toBe(0);
    }
    // between the lines' spans' outside (the sheet's bottom margin) nothing is washed
    expect(inkMarksAt(run, 100, (L.lines[3] as { y: number }).y + 2 * em, 0, 0.25).wash).toBe(0);
  });

  it("splits a re-inked glyph's ink by its new pen's front along its own path: `was` ahead of it, the new pen behind (handInkAt)", () => {
    const ink = marked();
    const L = lay(ink);
    const T = 80_000;
    const red = at(ink, "oxo ll");
    const j = L.glyphs.findIndex((g) => g.index === red.from + 1);   // the "x" of "oxo"
    const g = L.glyphs[j] as HandLayout["glyphs"][number];
    const was = L.glyphs.map(() => 0);
    was[j] = 1;
    const reinks: PenMoment[] = L.glyphs.map(() => WRITTEN);
    reinks[j] = { start: T, dur: 200 };
    const run = handRun(L, face.atlas, { ink, epoch: T - 5, marked: { was, reinks, strokes: [SHOWN, SHOWN, SHOWN] } });
    // the cross's first stroke (top-left to bottom-right) is written before its second: mid-way, the first is the new pen's
    const size = em * g.scale;
    const pt = (u: number, v: number): readonly [number, number] => [g.x + u * size * Math.cos(g.rot) - v * size * Math.sin(g.rot), g.y + u * size * Math.sin(g.rot) + v * size * Math.cos(g.rot)];
    const early = pt(0.1, -0.4);   // near the first stroke's start
    const late = pt(0.4, -0.4);    // the second stroke's start: the last of the path the pen reaches
    const before = handInkAt(run, face.atlas, ...early, T - 1, 0.25);
    expect(before.cover).toBeGreaterThan(0.5);
    expect(before).toMatchObject({ pen: 4, was: 1, over: 0 });
    // the moment the new pen is a third of the way along the glyph's path (the ease runs ahead early: 0.8 at half its time)
    let s = 1;
    while (handEase(s / 200) < 0.3) s += 1;
    expect(handInkAt(run, face.atlas, ...early, T + s, 0.25).over).toBe(1);
    expect(handInkAt(run, face.atlas, ...late, T + s, 0.25)).toMatchObject({ was: 1, over: 0 });
    expect(handInkAt(run, face.atlas, ...late, T + 200, 0.25)).toMatchObject({ pen: 4, over: 1 });
    // a glyph with no re-ink (an "l" before the red words): its own pen, all of it — a point on its bar
    const og = L.glyphs.find((x) => x.ch === "l" && x.index < red.from) as HandLayout["glyphs"][number];
    const os = em * og.scale;
    const o = handInkAt(run, face.atlas, og.x + 0.18 * os * Math.cos(og.rot) + 0.3 * os * Math.sin(og.rot), og.y + 0.18 * os * Math.sin(og.rot) - 0.3 * os * Math.cos(og.rot), T + 100, 0.25);
    expect(o.cover).toBeGreaterThan(0.5);
    expect(o).toMatchObject({ pen: 0, was: 0, over: 1 });
  });
});

describe("the marks piece (petition I60)", () => {
  it("its constants are the kit's, and the pen's header is the marks' head and the pen's four", () => {
    const text = ["marks", "hand"].map((f) => readFileSync(resolve(import.meta.dirname, `../shaders/kit/${f}.wgsl`), "utf8")).join("\n");
    const constOf = (name: string): string => (new RegExp(`^const ${name}: [\\w<>]+ = ([^;]+);`, "m").exec(text)?.[1] ?? "").trim();
    expect(constOf("INK_HEAD")).toBe(`${INK_MARKS.head}u`);
    expect(constOf("INK_STROKE")).toBe(`${INK_MARKS.stroke}u`);
    expect(constOf("INK_WAVE")).toBe(`vec2f(${INK_MARKS.wave[0]}, ${INK_MARKS.wave[1]})`);
    expect(Number(constOf("INK_RAMP"))).toBe(INK_MARKS.ramp);
    expect(Number(constOf("INK_WASH_PAD"))).toBe(INK_WASH.pad);
    expect(Number(constOf("INK_WASH_RADIUS"))).toBe(INK_WASH.radius);
    expect(constOf("HAND_HEADER")).toBe(`${HAND_RUN.header}u`);
    expect(HAND_RUN.header).toBe(INK_MARKS.head + 1);
  });

  it("composes the pen's piece with it, once, before it — asked alone or beside `hand`", () => {
    const alone = kitWgsl(["marks"], { entry: { label: "e", text: "" } });
    const both = kitWgsl(["hand", "marks"], { entry: { label: "e", text: "" } });
    expect(alone.modules?.map((m) => m.label)).toEqual(["kit/hand.wgsl", "kit/marks.wgsl"]);
    expect(both.modules?.map((m) => m.label)).toEqual(["kit/hand.wgsl", "kit/marks.wgsl"]);
  });

  it("reads a glyph's value for a stroke as strokesOf does: the highlighter, or a line in the words' own pen as theirs", () => {
    const ink = marked();
    const L = lay(ink);
    for (const s of strokesOf(L, ink)) for (let i = s.from; i < s.to; i++) if (ink.text[i] !== " ") expect(strokeValueOf(s.kind, ink.marks[i] as number), `${s.kind} at ${i}`).toBe(s.value);
    const section = inkSection({ layout: L, ink, strokes: strokesOf(L, ink), epoch: 0, before: HAND_RUN.before });
    expect(section.strokes).toBe(3);
  });
});

/**
 * The design page's software renderer of a stroke (the spike's marksheet.mjs `shapeOf` and `strokeAt`) over the same shape: its
 * centre line sampled every `step` em; a highlighter's band read straight down from the segment under x, its ends cut on the chisel;
 * a pen line's cover from the nearest segment. Cover at its presence; `aa` units a device px.
 */
function spikeCover(s: ReturnType<typeof inkShape>, x: number, y: number, aa: number, step: number): number {
  const n = Math.max(2, Math.ceil((s.x1 - s.x0) / (step * em)));
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) { const px = s.x0 + ((s.x1 - s.x0) * i) / n; pts.push([px, inkCentre(s, px, em).y]); }
  const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
  if (s.kind === "highlight") {
    let i = Math.floor(((x - s.x0) / (s.x1 - s.x0)) * n);
    i = Math.min(n - 1, Math.max(0, i));
    const [ax, ay] = pts[i] as [number, number];
    const [bx, by] = pts[i + 1] as [number, number];
    const k = clamp01((x - ax) / (bx - ax));
    const yc = ay + (by - ay) * k;
    const lean = (y - yc) * s.lean;
    const d = Math.max(Math.abs(y - yc) - s.hw, s.x0 + lean - x, x - (s.x1 + lean));
    return clamp01(0.5 - d / aa) * s.press;
  }
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = pts[i] as [number, number];
    const [bx, by] = pts[i + 1] as [number, number];
    const dx = bx - ax;
    const dy = by - ay;
    const k = clamp01(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1));
    best = Math.min(best, (x - ax - dx * k) ** 2 + (y - ay - dy * k) ** 2);
  }
  return clamp01(0.5 - (Math.sqrt(best) - s.hw) / aa) * s.press;
}
