// The MARKS (design-015 §7, stratum 5; D4a): the layout's numbers against *Marks on the Mat*'s reference
// drawing code (chrome.js `drawSelection` · `drawMember` · `drawUnion` · `drawMarquee` · `drawGuides` · `pill`
// · `drawRulerBand`, desk.css's tape), its paint order, and the pass through `Ground` on a fake device — the
// marks drawn once, after every stratum, only when a frame names them. The pixels are the oracle's.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Ground } from "../src/ground";
import { NO_GLYPHS } from "../src/mat/layout";
import { MAT_SHADER_FILES, matShaders } from "../src/mat/shaders";
import { easeIsland, easeLift } from "../src/marks/ease";
import { bracketReach, frameOnScreen, framesBox, LIGHT, layoutMarks, MARK, type MarkFrame, type MarkRecord, type MarksInput, NO_MARKS, pillBox, selectionBox, selectionGeometry, tapeStrips, textWidth } from "../src/marks/layout";
import { MARKS_SHADER_FILES, marksShaders } from "../src/marks/shaders";
import { shaderText } from "../src/shaders";
import { cssColor, MARKS } from "../src/theme";
import { THEMES } from "../oracle/fixtures/vf-theme";
import { fakeDevice, fakeSurface, installGpuFlags } from "./fake-gpu";

const VIEW = { width: 1200, height: 800, dpr: 2 };
const ATLAS = { scale: 2, cellW: 16, cellH: 28, advance: 12, baseline: 21, cap: 15, width: 768, height: 28, count: 48 };
const NOTE: MarkFrame = { cx: 400, cy: 300, hx: 100, hy: 100, angle: 0, r: 1.5 };
const input = (over: Partial<MarksInput>): MarksInput => ({ ...NO_MARKS(VIEW), ...over });
const kinds = (ms: readonly MarkRecord[]): string[] => ms.map((m) => Object.entries(MARK).find(([, v]) => v === m.shape[0])?.[0] ?? "?");
const rgba = (css: string, a = 1): number[] => { const c = cssColor(css); return [c[0], c[1], c[2], c[3] * a]; };
const close = (a: readonly number[], b: readonly number[]): void => { expect(a.length).toBe(b.length); a.forEach((v, i) => expect(v).toBeCloseTo(b[i] as number, 9)); };
const I = MARKS.inks;

describe("the marks' layout (chrome.js, number for number, in screen px)", () => {
  it("a sole selection at rest: the hairline one device px at 42 %, then the brackets — a keyline 2 wider at 34 % under the 1.5 px pencil — 6 out, the corner r + 6, reaching 16", () => {
    const ms = layoutMarks(input({ objects: [{ frame: NOTE, style: "brackets", t: 1, alpha: 1, knobs: false }] }));
    expect(kinds(ms)).toEqual(["stroke", "brackets", "brackets"]);
    const [hair, key, pencil] = ms as [MarkRecord, MarkRecord, MarkRecord];
    close(hair.centre, [400, 300, 0, 7.5]); close(hair.half, [106, 106, 0, 0]);
    expect(hair.shape[2]).toBe(0.5);   // 1 / dpr
    close(hair.colour, rgba(I.pencil.css, 0.42));
    expect(key.shape[2]).toBe(3.5); close(key.colour, rgba(I.keyline.css));
    expect(pencil.shape[2]).toBe(1.5); close(pencil.colour, rgba(I.pencil.css));
    expect(pencil.shape[3]).toBe(16); expect(key.shape[3]).toBe(16);
    close(pencil.half, [106, 106, 0, 0]);
    expect(cssColor(I.pencil.css).slice(0, 3).map((v) => Math.round(v * 255))).toEqual([121, 181, 248]);
  });

  it("a bracket's reach is ≤ 30 % of the frame's side and never under its corner + 2; the corner is capped at 10", () => {
    expect(bracketReach(16, 106, 106, 7.5)).toBe(16);
    expect(bracketReach(16, 20, 40, 10)).toBe(12);          // 0.3 × 40
    expect(bracketReach(16, 12, 12, 10)).toBe(12);          // r + 2 wins over 0.3 × 24 = 7.2
    expect(selectionGeometry({ ...NOTE, r: 9 }, 1, 1).R).toBe(10);
  });

  it("the lock-on arrives from 8 px further out on --vf-ease-lift, its presence full by 1/2.2 of the way; at t = 0 nothing is drawn", () => {
    expect(layoutMarks(input({ objects: [{ frame: NOTE, style: "brackets", t: 0, alpha: 1, knobs: false }] }))).toEqual([]);
    const g = selectionGeometry(NOTE, 0.25, 1);
    expect(g.gap).toBeCloseTo(6 + (1 - easeLift(0.25)) * 8, 12);
    expect(g.a).toBeCloseTo(0.55, 12);
    expect(selectionGeometry(NOTE, 0.5, 1).a).toBe(1);
    // --vf-ease-lift overshoots: past its target mid-way, so the frame dips inside 6 before it settles
    expect(Math.max(...[0.5, 0.6, 0.7, 0.8].map(easeLift))).toBeGreaterThan(1);
    expect(easeLift(1)).toBe(1); expect(easeIsland(0)).toBe(0); expect(easeIsland(1)).toBe(1);
    const ms = layoutMarks(input({ objects: [{ frame: NOTE, style: "brackets", t: 0.25, alpha: 1, knobs: false }] }));
    close((ms[2] as MarkRecord).half.slice(0, 2), [100 + g.gap, 100 + g.gap]);
    expect((ms[2] as MarkRecord).colour[3]).toBeCloseTo(0.55, 12);
  });

  it("under 24 px on screen the brackets collapse to one ring (a keyline and the pencil, no hairline, no knobs)", () => {
    const tiny: MarkFrame = { cx: 50, cy: 50, hx: 11.9, hy: 30, angle: 0, r: 1 };
    const ms = layoutMarks(input({ objects: [{ frame: tiny, style: "brackets", t: 1, alpha: 1, knobs: true }] }));
    expect(kinds(ms)).toEqual(["stroke", "stroke"]);
    expect((ms[0] as MarkRecord).shape[2]).toBe(3.5); expect((ms[1] as MarkRecord).shape[2]).toBe(1.5);
    expect(kinds(layoutMarks(input({ objects: [{ frame: { ...tiny, hx: 12 }, style: "brackets", t: 1, alpha: 1, knobs: false }] })))).toEqual(["stroke", "brackets", "brackets"]);
  });

  it("knobs where the object resizes: four, at the frame's corners in by r(1 − √½) — a cast ring 1 wider at 28 %, the paper face, a 1.5 px pencil rim — turned with the frame", () => {
    const f: MarkFrame = { cx: 400, cy: 300, hx: 100, hy: 60, angle: Math.PI / 2, r: 2 };
    const ms = layoutMarks(input({ objects: [{ frame: f, style: "brackets", t: 1, alpha: 1, knobs: true }] }));
    expect(kinds(ms)).toEqual(["stroke", "brackets", "brackets", ...Array(4).fill(["fill", "fill", "stroke"]).flat()]);
    const R = 8;
    const k = R * (1 - Math.SQRT1_2);
    const knobs = ms.slice(3).filter((_, i) => i % 3 === 1);
    // local (−X + k, −Y + k) turned a quarter: (x, y) → (−y, x)
    close([knobs[0]?.centre[0] ?? 0, knobs[0]?.centre[1] ?? 0], [400 + (66 - k), 300 - (106 - k)]);
    close((ms[3] as MarkRecord).colour, [...cssColor(I.keyline.css).slice(0, 3), 0.28]);
    expect((ms[3] as MarkRecord).centre[3]).toBe(4.5);
    close((ms[4] as MarkRecord).colour, rgba(I.paper.css)); expect((ms[4] as MarkRecord).centre[3]).toBe(3.5);
    expect((ms[5] as MarkRecord).shape[2]).toBe(1.5);
  });

  it("several: quiet member ticks (4 out, reaching 8, 1.25 px at 62 %) and ONE union square to the mat, 10 out, corner 4", () => {
    const a: MarkFrame = { cx: 200, cy: 200, hx: 50, hy: 50, angle: 0.1, r: 1.5 };
    const b: MarkFrame = { cx: 500, cy: 260, hx: 80, hy: 40, angle: 0, r: 10 };
    const box = framesBox([a, b]);
    expect(box).not.toBeNull();
    const ms = layoutMarks(input({ objects: [a, b].map((frame) => ({ frame, style: "member" as const, t: 1, alpha: 1, knobs: false })), union: { box: box as NonNullable<typeof box>, t: 1, alpha: 1 } }));
    expect(kinds(ms)).toEqual(["brackets", "brackets", "brackets", "brackets", "stroke", "brackets", "brackets"]);
    const m = ms[1] as MarkRecord;
    expect(m.shape[2]).toBe(1.25); expect(m.shape[3]).toBe(8); expect(m.colour[3]).toBeCloseTo(0.62, 12);
    close(m.half.slice(0, 2), [54, 54]); expect(m.centre[3]).toBe(5.5);
    expect((ms[3] as MarkRecord).centre[3]).toBe(8);   // min(10 + 4, 8)
    const u = ms[6] as MarkRecord;
    const B = box as NonNullable<typeof box>;
    close(u.half.slice(0, 2), [(B.x1 - B.x0) / 2 + 10, (B.y1 - B.y0) / 2 + 10]);
    expect(u.centre[2]).toBe(0); expect(u.centre[3]).toBe(10);
    // the menu's anchor: the brackets' box (6 out) for one, the union's (10 out) for several
    expect(selectionBox([NOTE])).toEqual({ x0: 294, y0: 194, x1: 506, y1: 406 });
    expect(selectionBox([a, b])?.x0).toBeCloseTo(B.x0 - 10, 12);
  });

  it("the vellum: a cream veil at 11 % (a cool one at 7 % by night), its pencil edge one device px at 80 %, brackets reaching 12 once both sides pass 14, the count riding the cursor in a pencil pill", () => {
    const m = { rect: { x0: 500, y0: 400, x1: 300, y1: 250 }, count: 2, pointer: { x: 500, y: 400 } };
    const day = layoutMarks(input({ marquee: m }), ATLAS);
    expect(kinds(day)).toEqual(["fill", "stroke", "brackets", "brackets", "fill", "glyph"]);
    close((day[0] as MarkRecord).centre.slice(0, 2), [400, 325]); close((day[0] as MarkRecord).half.slice(0, 2), [100, 75]);
    close((day[0] as MarkRecord).colour, rgba(I.vellumDay.css));
    expect((day[1] as MarkRecord).shape[2]).toBe(0.5); close((day[1] as MarkRecord).colour, rgba(I.pencil.css, 0.8));
    expect((day[3] as MarkRecord).shape[3]).toBe(12);
    const p = day[4] as MarkRecord;
    expect(p.half[0] * 2).toBe(Math.ceil(textWidth("2", ATLAS)) + 8); expect(p.half[1] * 2).toBe(15);
    expect(p.centre[0] - p.half[0]).toBe(514); expect(p.centre[1] - p.half[1]).toBe(Math.round(418 - 7.5));
    close(p.colour, rgba(I.pencil.css)); close((day[5] as MarkRecord).colour, rgba(I.tray.css));
    expect((day[5] as MarkRecord).aux[0]).toBe(2);   // the atlas cell of "2"
    const night = layoutMarks(input({ marquee: m, night: true }), ATLAS);
    close((night[0] as MarkRecord).colour, rgba(I.vellumNight.css));
    // a sliver: no brackets; no atlas: no numerals (the pill still says where)
    expect(kinds(layoutMarks(input({ marquee: { rect: { x0: 0, y0: 0, x1: 14, y1: 90 }, count: 0, pointer: null } })))).toEqual(["fill", "stroke"]);
    expect(kinds(layoutMarks(input({ marquee: m }), NO_GLYPHS))).toEqual(["fill", "stroke", "brackets", "brackets", "fill"]);
  });

  it("the laser: faint wall to wall and ADDED, bright over the aligned span — the bloom 9 · 5 · 2.6 at 7 · 16 · 32 % (added, × the strike up to 1.8), the line, the core — a flare at each aligned corner; a centre dotted every 4.51", () => {
    const g = { axis: "x" as const, at: 300, type: "edge" as const, span: [86, 514] as const, points: [[300, 100], [300, 500]] as const };
    const ms = layoutMarks(input({ guides: [g] }));
    expect(kinds(ms)).toEqual(["segment", "segment", "segment", "segment", "segment", "segment", "segment", "flare", "flare"]);
    expect(ms.map((m) => m.shape[1])).toEqual([LIGHT, LIGHT, LIGHT, LIGHT, LIGHT, 0, 0, LIGHT, LIGHT]);
    close((ms[0] as MarkRecord).centre.slice(0, 2), [300, 0]); close((ms[0] as MarkRecord).half.slice(0, 2), [300, 800]);
    expect(ms.map((m) => m.shape[2])).toEqual([3, 1, 9, 5, 2.6, 1.25, 0.6, 0, 0]);
    expect(ms.slice(2, 5).map((m) => m.colour[3])).toEqual([0.07, 0.16, 0.32]);
    close((ms[5] as MarkRecord).colour, rgba(I.laserLine.css, 0.95)); close((ms[6] as MarkRecord).colour, rgba(I.laserCore.css, 0.95));
    close((ms[2] as MarkRecord).centre.slice(0, 2), [300, 86]);
    expect(ms.every((m) => m.aux[0] === 0 || m.shape[0] === MARK.flare)).toBe(true);   // solid
    const struck = layoutMarks(input({ guides: [g], strike: 1 }));
    expect(struck.slice(2, 5).map((m) => m.colour[3])).toEqual([0.07 * 1.8, 0.16 * 1.8, 0.32 * 1.8].map((v) => Math.min(1, v)));
    expect((struck[7] as MarkRecord).aux[3]).toBe(1);   // the flare's core min(1, 0.9 × 1.8)
    const dotted = layoutMarks(input({ guides: [{ ...g, type: "center" }] }));
    expect(dotted.slice(0, 7).map((m) => m.aux[0])).toEqual(Array(7).fill(4.51));
    expect(dotted.slice(2, 7).map((m) => m.shape[2])).toEqual([9 * 0.7, 5 * 0.7, 2.6 * 0.7, 2, 1]);
  });

  it("a gap: a 4 px bloom at 18 % (added) under the 1.1 px line, 4 px ticks at its ends, its number in a laser pill on it — beside it under 26 px", () => {
    const ms = layoutMarks(input({ bars: [{ axis: "x", from: 200, to: 260, perp: 400, gap: 40.4 }] }), ATLAS);
    expect(kinds(ms)).toEqual(["bar", "bar", "fill", "glyph", "glyph"]);
    expect((ms[0] as MarkRecord).shape[1]).toBe(LIGHT); expect((ms[0] as MarkRecord).shape[2]).toBe(4); expect((ms[0] as MarkRecord).aux[0]).toBe(4);
    expect((ms[1] as MarkRecord).shape[2]).toBe(1.1);
    close((ms[2] as MarkRecord).colour, rgba(I.laser.css)); close((ms[3] as MarkRecord).colour, rgba(I.white.css));
    expect(ms.slice(3).map((m) => m.aux[0])).toEqual([4, 0]);   // "40"
    expect((ms[2] as MarkRecord).centre[0]).toBe(230);
    const short = layoutMarks(input({ bars: [{ axis: "y", from: 200, to: 220, perp: 400, gap: 20 }] }), ATLAS);
    expect((short[2] as MarkRecord).centre[0]).toBe(pillBox(416, 210, "20", "center", ATLAS).x0 + 10);
  });

  it("the tape: two strips 60 × 17 (object units — it zooms with its object) over the top corners, 5 above and 20 past, turned ±37° with the object; pressed from 1.22×; moonlit by night", () => {
    const f: MarkFrame = { cx: 400, cy: 300, hx: 200, hy: 200, angle: 0.1, r: 3 };
    const [a, b] = tapeStrips({ frame: f, units: 2, press: [1, 1], alpha: 1 });
    const turn = (37 * Math.PI) / 180;
    expect(a?.angle).toBeCloseTo(0.1 - turn, 12); expect(b?.angle).toBeCloseTo(0.1 + turn, 12);
    expect(a?.hx).toBe(60); expect(a?.hy).toBe(17);
    const c = Math.cos(0.1);
    const s = Math.sin(0.1);
    const lx = -(200 - 10 * 2);
    const ly = -200 + 3.5 * 2;
    expect(a?.cx).toBeCloseTo(400 + c * lx - s * ly, 9); expect(a?.cy).toBeCloseTo(300 + s * lx + c * ly, 9);
    const pressed = tapeStrips({ frame: f, units: 2, press: [0, 0.5], alpha: 1 });
    expect(pressed[0]?.alpha).toBe(0); expect(pressed[0]?.hx).toBeCloseTo(60 * 1.22, 12);
    expect(pressed[1]?.alpha).toBeCloseTo(Math.min(1, easeLift(0.5)), 12);
    const day = layoutMarks(input({ tape: [{ frame: f, units: 2, press: [1, 1], alpha: 1 }] }));
    expect(kinds(day)).toEqual(["tape", "tape"]);
    close((day[0] as MarkRecord).aux, [2, 1, 1, 0.1]); close((day[0] as MarkRecord).colour, rgba(I.tape.css));
    close((layoutMarks(input({ night: true, tape: [{ frame: f, units: 2, press: [1, 1], alpha: 1 }] }))[0] as MarkRecord).aux, [2, 0.3, 0.46, 0.1]);
  });

  it("your extent on the rulers: a pencil wash clipped to each band, its edges, the edge coordinates over a cast halo (the left band's read down), a laser tick where a guide stands", () => {
    const ruler = { sel: { x0: 300, y0: 200, x1: 500, y1: 400 }, world: { x0: 300, y0: 200, x1: 500, y1: 400 }, margin: 26, band: 26 };
    const ms = layoutMarks(input({ ruler, guides: [{ axis: "x", at: 300, type: "edge", span: [180, 420], points: [] }] }), ATLAS);
    const tail = ms.slice(7);   // after the guide's seven segments
    const wash = tail[0] as MarkRecord;
    close(wash.centre.slice(0, 2), [400, 39]); close(wash.half.slice(0, 2), [100, 13]); close(wash.colour, rgba(I.pencil.css, 0.16));
    const glyphs = tail.filter((m) => m.shape[0] === MARK.glyph);
    // "300" "500" "200" "400": each a halo then the pencil
    expect(glyphs.length).toBe(24);
    expect(glyphs.filter((m) => m.centre[2] === Math.PI / 2).length).toBe(12);
    expect(glyphs.filter((m) => m.aux[1] > 0).length).toBe(12);
    const tick = tail.at(-1) as MarkRecord;
    expect(tick.shape[1]).toBe(LIGHT); close(tick.centre.slice(0, 2), [300, 29]); close(tick.half.slice(0, 2), [300, 51]);
  });

  it("paint order is chrome.js's: the tape, each object's marks, the union, the vellum, the laser, the rulers", () => {
    const f: MarkFrame = { cx: 400, cy: 300, hx: 100, hy: 100, angle: 0, r: 2 };
    const ms = layoutMarks(input({
      tape: [{ frame: f, units: 1, press: [1, 1], alpha: 1 }],
      objects: [{ frame: f, style: "member", t: 1, alpha: 1, knobs: false }],
      union: { box: { x0: 300, y0: 200, x1: 500, y1: 400 }, t: 1, alpha: 1 },
      marquee: { rect: { x0: 0, y0: 0, x1: 50, y1: 50 }, count: 0, pointer: null },
      guides: [{ axis: "y", at: 200, type: "edge", span: [0, 10], points: [] }],
      ruler: { sel: { x0: 300, y0: 200, x1: 500, y1: 400 }, world: { x0: 0, y0: 0, x1: 1, y1: 1 }, margin: 26, band: 26 },
    }));
    expect(kinds(ms).slice(0, 12)).toEqual(["tape", "tape", "brackets", "brackets", "stroke", "brackets", "brackets", "fill", "stroke", "brackets", "brackets", "segment"]);
    expect(kinds(ms).at(-1)).toBe("segment");
  });

  it("a world frame on screen: (world − camera top-left) × zoom, the extents and the corner scaled, the turn kept", () => {
    expect(frameOnScreen({ cx: 110, cy: 60, hx: 50, hy: 20, angle: 0.3, r: 2 }, { x: 10, y: 20, zoom: 2 })).toEqual({ cx: 200, cy: 80, hx: 100, hy: 40, angle: 0.3, r: 4 });
  });
});

describe("the marks pass through the Ground (a fake device: the commands, not the pixels)", () => {
  const undo: (() => void)[] = [];
  beforeAll(() => { undo.push(installGpuFlags()); });
  afterAll(() => { for (const u of undo.splice(0)) u(); });

  it("drawn once per frame that names marks, AFTER every stratum and before the pass ends; a frame without marks draws none; a ground made without the shaders has no pass", async () => {
    const log: string[] = [];
    const { device } = fakeDevice(log);
    const ground = await Ground.create({ device, surface: fakeSurface(2400, 1600), mat: matShaders(shaderText(MAT_SHADER_FILES)), kinds: [], marks: marksShaders(shaderText(MARKS_SHADER_FILES)) });
    const frame = { view: { camX: 0, camY: 0, zoom: 1, width: 1200, height: 800, dpr: 2 }, theme: THEMES.light };
    ground.render({ ...frame, marks: input({ objects: [{ frame: NOTE, style: "brackets", t: 1, alpha: 1, knobs: false }] }) });
    const pass = log.slice(log.indexOf("pass ground"));
    expect(pass.slice(-4)).toEqual(["pipeline marks", "group 0 marks", "draw 6,3,0,0", "end"]);
    expect(ground.marks?.drawn).toBe(3);
    log.length = 0;
    ground.render(frame);
    expect(log.some((l) => l.startsWith("pipeline marks"))).toBe(false);
    log.length = 0;
    ground.render({ ...frame, marks: NO_MARKS(VIEW) });
    expect(log.some((l) => l.startsWith("pipeline marks"))).toBe(false);
    ground.dispose();
    const bare = await Ground.create({ device, surface: fakeSurface(2400, 1600), mat: matShaders(shaderText(MAT_SHADER_FILES)), kinds: [] });
    expect(bare.marks).toBeNull();
    bare.dispose();
  });

  it("the records grow by doubling past the first 64", async () => {
    const { device } = fakeDevice();
    const ground = await Ground.create({ device, surface: fakeSurface(2400, 1600), mat: matShaders(shaderText(MAT_SHADER_FILES)), kinds: [], marks: marksShaders(shaderText(MARKS_SHADER_FILES)) });
    const many = Array.from({ length: 40 }, (_, i) => ({ frame: { ...NOTE, cx: i * 30 }, style: "member" as const, t: 1, alpha: 1, knobs: false }));
    ground.render({ view: { camX: 0, camY: 0, zoom: 1, width: 1200, height: 800, dpr: 2 }, theme: THEMES.light, marks: input({ objects: many }) });
    expect(ground.marks?.drawn).toBe(80);
    expect(ground.marks?.laid.length).toBe(80);
    ground.dispose();
  });
});
