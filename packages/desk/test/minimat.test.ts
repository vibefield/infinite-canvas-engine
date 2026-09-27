// THE MINI MAT (MINIMAT.md) — its pure parts: the law's geometry (the sheet, the face, the
// hold and the hover, the shadow's slope, the hit test), the FAR LOD (the face's lattice —
// the live inside's own lines, dressed the same way — the ruler's numerals, the chips and a
// note's writing greeked), the name as glyphs packed four to a float, the records against
// the WGSL that reads them, and the inside's helpers: its presentation, the flight's
// presences and the lamps a flight hands over (MINIMAT.md §4).
import { must } from "./must";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { compose } from "../src/engine/shader";
import { DEFAULT_MAT_CONFIG, GLYPHS, litByOwn, MatUniforms, settleLight } from "../src/mat/layout";
import { lineWeight } from "../src/lattice/line";
import { enterFlight, exitFlight } from "../src/nav/flight";
import { portalPresence } from "../src/nav/portal";
import { lampOf } from "../src/paper/paper";
import { MAT_GRID } from "../src/theme";
import { MINIMAT } from "../src/minimat/theme";
import { chipOf, chipVisible, CHIP_LINES, DEFAULT_MINIMAT_LAW, faceLattice, faceOf, MINIMAT_REST, NAME_CHARS, nameGlyphs, numeralsOf, packGlyphs, pickMiniMat, resolveMiniMat, sdMiniMat, shadowReach } from "../src/minimat/minimat";
import { ChipRecord, chipValues, MiniMat, miniMatUniformValues, MiniMatUniforms, miniMatValues } from "../src/minimat/layout";
import { flightLights, flightPresent, HANDOVER, insidePresent, insideView, miniMatInstance } from "../src/minimat/inside";
import { miniMatShaders } from "../src/minimat/shaders";
import { DEFAULT_GRID } from "../src/mat/grid";

const LAW = DEFAULT_MINIMAT_LAW;
const lamp = lampOf(MAT_GRID.plane);
const at = (cx: number, cy: number, w = 640, h = 480, m = MINIMAT_REST) => resolveMiniMat({ cx, cy, w, h }, m, LAW, lamp);
const VP = { width: 1200, height: 800 };

describe("the mini mat's geometry", () => {
  it("at rest is its own rect flat on the desk; its FACE is the sheet inset by the printed border", () => {
    const G = at(0, 0);
    expect(G.half).toEqual([320, 240]);
    expect(G).toMatchObject({ radius: MINIMAT.radius, margin: MINIMAT.margin, lift: 0, thick: MINIMAT.thick, scale: 1, ring: 0, alpha: 1 });
    expect(faceOf(G)).toEqual({ x: -320 + MINIMAT.margin, y: -240 + MINIMAT.margin, width: 640 - 2 * MINIMAT.margin, height: 480 - 2 * MINIMAT.margin });
    expect(MINIMAT.size).toEqual({ w: 640, h: 480 });   // 8 × 6 of the design's 80-unit modules
  });

  it("held it rises and reads a touch larger, hovered it rises a fifth as far; the ring and the fade are the motion's", () => {
    const held = at(0, 0, 640, 480, { held: 1, hover: 0, ring: 1, fade: 0.5 });
    expect(held.scale).toBe(MINIMAT.lift.scale);
    expect(held.half[0]).toBeCloseTo(320 * MINIMAT.lift.scale, 12);
    expect(held.margin).toBeCloseTo(MINIMAT.margin * MINIMAT.lift.scale, 12);
    expect(held.lift).toBe(MINIMAT.lift.height);
    expect(held.ring).toBe(1); expect(held.alpha).toBe(0.5);
    const hovered = at(0, 0, 640, 480, { held: 0, hover: 1, ring: 0, fade: 1 });
    expect(hovered.scale).toBe(1);
    expect(hovered.lift).toBeCloseTo(MINIMAT.lift.height * MINIMAT.hover, 12);
    // a held mini mat under the pointer rises as held, not held + hovered
    expect(at(0, 0, 640, 480, { held: 0.5, hover: 1, ring: 0, fade: 1 }).lift).toBeCloseTo(MINIMAT.lift.height * Math.max(0.5, MINIMAT.hover), 12);
  });

  it("the shadow falls away from the lamp, its slope capped; the lamp's direction is a unit vector", () => {
    const G = at(0, 0);
    expect(Math.hypot(...G.lamp)).toBeCloseTo(1, 12);
    // away from the lamp: the slope points against the lamp's ground direction
    expect(G.slope[0] * G.lamp[0] + G.slope[1] * G.lamp[1]).toBeLessThanOrEqual(0);
    for (const [x, y] of [[0, 0], [5000, -3000], [-9000, 9000]] as const) expect(Math.hypot(...at(x, y).slope)).toBeLessThanOrEqual(MINIMAT.shadow.slopeMax + 1e-12);
    expect(shadowReach(at(0, 0, 640, 480, { held: 1, hover: 0, ring: 0, fade: 1 }))).toBeGreaterThan(shadowReach(G));
  });

  it("the hit test: the face is the inside's window, the border the sheet round it, the die-cut corner outside", () => {
    const G = at(0, 0);
    const fx = 320 - MINIMAT.margin;
    expect(pickMiniMat(G, 0, 0)).toBe("face");
    expect(pickMiniMat(G, fx - 1, 0)).toBe("face");
    expect(pickMiniMat(G, fx + 1, 0)).toBe("border");
    expect(pickMiniMat(G, 0, 240 - 2)).toBe("border");   // the foot, where the name is printed
    expect(pickMiniMat(G, 321, 0)).toBe("outside");
    expect(pickMiniMat(G, 319, 239)).toBe("outside");     // the corner's arc cuts it
    expect(sdMiniMat(G, 330, 0)).toBeCloseTo(10, 12);
  });
});

describe("the far LOD (MINIMAT.md §5)", () => {
  const law = DEFAULT_MAT_CONFIG.line;
  it("the face's lattice is the live inside's: the rungs at its zoom, each weighed by the mat's own line law", () => {
    const L = faceLattice(1, [10, 20], law);
    expect(L.rungs).toEqual([2, 20, 200]);
    for (let i = 0; i < 3; i++) {
      const w = lineWeight(must(L.rungs[i]) * 1, [10, 20], law);
      expect(L.weights[i]).toBe(w.alpha); expect(L.widths[i]).toBe(w.halfWidth);
    }
    expect(L.weights).toEqual([0, law.alphaThin, law.alphaThick]);   // the fine rung under the window; the mid at its top; the coarse a decade above
  });

  it("dressed for its arrival it is the lattice under the scaled window — floored, so a tiny face never hazes", () => {
    expect(faceLattice(0.75, [10, 20], law, 1)).toEqual(faceLattice(0.75, [7.5, 15], law));
    expect(faceLattice(0.1, [10, 20], law, 1)).toEqual(faceLattice(0.1, [5, 10], law));   // σ 0.1 floored at GRID.dressFloor ½
    expect(faceLattice(0.5, [10, 20], law, 0.5)).toEqual(faceLattice(0.5, [10, 20], law));
  });

  it("the ruler numbers the finest rung whose sites are far enough apart, its own sites fading in, in the inside's units", () => {
    const from = MINIMAT.print.labelsFrom;
    expect(from).toEqual([48, 64]);
    expect(numeralsOf(faceLattice(1, [10, 20], law), 1, from)).toEqual({ spacing: 200, mult: 2, exp: 2, fade: 1 });
    const n3 = must(numeralsOf(faceLattice(3, [10, 20], law), 3, from));   // the mid rung at 60 px: numbered, three quarters in
    expect(n3).toMatchObject({ spacing: 20, mult: 2, exp: 1 });
    expect(n3.fade).toBeCloseTo(0.84375, 12);
    expect(numeralsOf(faceLattice(1, [10, 20], law), 1, [5000, 6000])).toBeNull();
  });

  it("a child becomes a CHIP through the embedding: its footprint scaled about the host's origin, a note's lines greeked on the x-height", () => {
    const ink = [0.1, 0.1, 0.2] as const;
    const paper = [0.96, 0.9, 0.66] as const;
    const note = { kind: "paper" as const, cx: 100, cy: 50, hx: 40, hy: 40, angle: 0.1, radius: 2, colour: paper, height: 3, writing: { ink, x0: 16, em: 24, lines: [{ y: 40, width: 50 }, { y: 70, width: 0.2 }] } };
    const ch = chipOf(note, { s: 0.5, ox: 10, oy: 20 }, 0.3);
    expect(ch.centre).toEqual([60, 45]); expect(ch.half).toEqual([20, 20]);
    expect(ch.radius).toBe(1); expect(ch.height).toBe(1.5);
    expect(ch.cos).toBe(Math.cos(0.1)); expect(ch.sin).toBe(Math.sin(0.1));
    expect(ch.stroke).toBeCloseTo(0.5 * 0.3 * 24 * 0.5, 12);
    expect(ch.lines).toEqual([[(16 - 40) * 0.5, (16 + 50 - 40) * 0.5, (40 - 0.32 * 24 - 40) * 0.5]]);   // a line too short to read is no stroke
    expect(ch.ink).toBe(ink);
    const mat = chipOf({ kind: "mat", cx: 0, cy: 0, hx: 190, hy: 150, angle: 0, radius: 10, colour: paper, height: 3, margin: 32 }, { s: 0.25, ox: 0, oy: 0 });
    expect(mat.margin).toBe(8); expect(mat.lines).toEqual([]); expect(mat.ink).toBe(paper);
    // the writing's lines stop at CHIP_LINES
    const long = chipOf({ ...note, writing: { ...note.writing, lines: Array.from({ length: 10 }, (_, i) => ({ y: 20 + i * 10, width: 30 })) } }, { s: 1, ox: 0, oy: 0 });
    expect(long.lines.length).toBe(CHIP_LINES);
    expect(chipVisible(ch, 0.02)).toBe(false); expect(chipVisible(ch, 0.03)).toBe(true);
  });
});

describe("the print's words (MINIMAT.md §2)", () => {
  it("a name is its capitals as the atlas's glyphs; a letter the atlas lacks prints as a space; at most NAME_CHARS", () => {
    expect(GLYPHS.length).toBeLessThanOrEqual(64);   // six bits a glyph
    expect(nameGlyphs("Ideas")).toEqual([...("IDEAS")].map((c) => GLYPHS.indexOf(c)));
    expect(nameGlyphs("é")).toEqual([GLYPHS.indexOf(" ")]);
    expect(nameGlyphs("x".repeat(40)).length).toBe(NAME_CHARS);
  });
  it("glyphs pack four to a float in base 64 — exact in an f32 — and unpack as the shader does", () => {
    const g = nameGlyphs("Deeper / 2");
    const packed = packGlyphs(g);
    expect(packed.length).toBe(NAME_CHARS / 4);
    for (const f of packed) expect(Math.fround(f)).toBe(f);
    expect(Math.fround(must(packGlyphs([63, 63, 63, 63])[0]))).toBe(2 ** 24 - 1);
    const unpack = (k: number) => (Math.fround(must(packed[k >> 2])) >>> (6 * (k & 3))) & 63;   // minimat.wgsl `mm_name_glyph`
    expect(g.map((_, k) => unpack(k))).toEqual(g);
  });
});

describe("the records and the WGSL that reads them (MINIMAT.md §6)", () => {
  const G = at(100, 50);
  const view = must(insideView(G, { x: 0, y: 0, width: 400, height: 300 }, { x: 0, y: 0, zoom: 1 }, VP));
  const inst = miniMatInstance(G, view, DEFAULT_GRID, [], "Ideas");

  it("every field the values name is the struct's, and the struct's every field is named (but its pad)", () => {
    const names = (s: { fields: readonly (readonly [string, string])[] }) => s.fields.map(([n]) => n).filter((n) => !n.startsWith("pad")).sort();
    expect(Object.keys(miniMatValues(inst, 0, 0)).sort()).toEqual(names(MiniMat));
    const ch = chipOf({ kind: "mat", cx: 0, cy: 0, hx: 10, hy: 10, angle: 0, radius: 1, colour: [0, 0, 0], height: 1, margin: 2 }, view.M);
    expect(Object.keys(chipValues(ch)).sort()).toEqual(names(ChipRecord));
    expect(chipValues(ch).kind).toBe(1);
    const meta = { scale: 2, cellW: 16, cellH: 24, advance: 14, baseline: 18, cap: 14, width: 768, height: 24, count: GLYPHS.length };
    expect(Object.keys(miniMatUniformValues(MINIMAT, { cream: [1, 1, 1], cast: [0, 0, 0], select: [0, 0, 1] }, meta)).sort()).toEqual(names(MiniMatUniforms));
    for (const s of [MiniMat, ChipRecord, MiniMatUniforms]) expect(s.size % 16).toBe(0);
    // they fill a buffer without complaint
    MiniMat.alloc(1).set(miniMatValues(inst, 0, 0), 0);
    ChipRecord.alloc(1).set(chipValues(ch), 0);
  });

  it("the live inside's presence rides the record as −1 (none) or its objects' 0..1; the name and the numerals come from the instance", () => {
    expect(miniMatValues(inst, 0, 0).live).toBe(-1);
    expect(miniMatValues({ ...inst, live: -1 }, 0, 0).live).toBe(-1);
    expect(miniMatValues({ ...inst, live: 0.4 }, 0, 0).live).toBe(0.4);
    expect(miniMatValues({ ...inst, live: 1.5 }, 0, 0).live).toBe(1);
    const v = miniMatValues(inst, 3, 7);
    expect([v.chipFirst, v.chipCount]).toEqual([3, 7]);
    expect(v.nameLen).toBe(5); expect(v.name).toEqual(packGlyphs(nameGlyphs("Ideas")));
    expect(v.inside).toEqual([view.M.s, view.M.ox, view.M.oy, 0]);
    expect(v.ground).toEqual([...DEFAULT_GRID.mat.ground, DEFAULT_GRID.mat.grain]);
    expect(miniMatValues({ ...inst, name: undefined }, 0, 0).nameLen).toBe(0);
  });

  it("the shaders compose, name no WGSL reserved word as a field, and read only fields the records declare", () => {
    const here = resolve(import.meta.dirname, "..", "shaders");
    const read = (f: string) => readFileSync(join(here, f), "utf8");
    const src = miniMatShaders((files) => Object.fromEntries(Object.entries(files).map(([k, f]) => [k, read(f)])) as never);
    expect(() => compose(src)).not.toThrow();
    for (const s of [MiniMat, ChipRecord, MiniMatUniforms]) for (const [f] of s.fields) expect(["cast", "active", "filter", "sample", "target", "handle", "layout"]).not.toContain(f);
    const own = (read("minimat/minimat.wgsl") + read("minimat/minimat-pass.wgsl")).replace(/\/\/.*$/gm, "");
    const fields = (s: { fields: readonly (readonly [string, string])[] }) => s.fields.map(([f]) => f);
    for (const m of own.matchAll(/\bM\.(\w+)/g)) expect(fields(MiniMat)).toContain(m[1]);
    for (const m of own.matchAll(/\bk\.(\w+)/g)) expect(fields(MiniMatUniforms)).toContain(m[1]);
    for (const m of own.matchAll(/\(\*C\)\.(\w+)/g)) expect(fields(ChipRecord)).toContain(m[1]);
    for (const m of own.matchAll(/\bu\.(\w+)/g)) expect(fields(MatUniforms)).toContain(m[1]);
  });
});

describe("the inside and the flight (MINIMAT.md §3–§5)", () => {
  const G = at(577, 405.75, 393, 409);
  const K = faceOf(G);
  const CONTENT = { x: -40, y: -20, width: 700, height: 300 };
  const CAM = { x: 13.7, y: -21.3, zoom: 1.37 };

  it("at rest the live inside comes in through its face, its mat whole and its objects at the gate's answer", () => {
    const v = must(insideView(G, CONTENT, CAM, VP));
    expect(insidePresent(v)).toEqual({ opacity: 1, objects: v.presence, portal: v.clip });
    const far = must(insideView(G, CONTENT, { ...CAM, zoom: 0.55 }, VP));   // the face's short side, 329 × 0.55 = 181 px: across the gate
    expect(far.presence).toBeGreaterThan(0); expect(far.presence).toBeLessThan(1);
    expect(insidePresent(far).objects).toBe(far.presence);
  });

  it("a flight's presences: an enter's arriving objects at the gate's answer through the face; an exit's departed desk through it; a frozen flight a dissolve", () => {
    const f = enterFlight(K, CONTENT, CAM, VP);
    f.p = 0.5;
    const clip = { cx: 600, cy: 400, hx: 100, hy: 80, r: 0 };
    const e = flightPresent(f, clip);
    expect(e.incoming).toMatchObject({ portal: clip, objects: portalPresence(clip) });
    expect(e.outgoing.portal).toBeUndefined();
    const g = exitFlight(K, CONTENT, { x: 0, y: 0, zoom: 1 }, CAM, VP);
    g.p = 0.5;
    const x = flightPresent(g, clip);
    expect(x.outgoing.portal).toBe(clip); expect(x.incoming.portal).toBeUndefined(); expect(x.outgoing.objects).toBeUndefined();
    expect(flightPresent({ ...f, frozen: true }, clip)).toEqual({ incoming: { opacity: expect.any(Number) }, outgoing: { opacity: expect.any(Number) } });
    expect(flightPresent(f, undefined).incoming.portal).toBeUndefined();
  });

  it("the lamps a flight hands over: an enter from the departed desk's to its own over [0.3, 1]; an exit back over [0, ½]; a frozen flight none", () => {
    expect(HANDOVER).toEqual({ enter: [0.3, 1], exit: [0, 0.5] });
    const f = enterFlight(K, CONTENT, CAM, VP);
    const cam = { x: 1, y: 2, zoom: 3 };
    const out = { x: 4, y: 5, zoom: 6 };
    const t = (p: number) => { f.p = p; return must(flightLights(f, cam, out).incoming).t; };
    expect(t(0)).toBe(0); expect(t(0.3)).toBe(0); expect(t(0.65)).toBeCloseTo(0.5, 12); expect(t(1)).toBe(1);
    f.p = 0.5;
    expect(flightLights(f, cam, out).incoming).toMatchObject({ a: out, b: cam });
    expect(flightLights(f, cam, out).outgoing).toBeUndefined();
    const g = exitFlight(K, CONTENT, { x: 0, y: 0, zoom: 1 }, CAM, VP);
    g.p = 0.25;
    expect(flightLights(g, cam, out).outgoing).toEqual({ a: out, b: cam, t: 0.5 });
    g.p = 0.5; expect(must(flightLights(g, cam, out).outgoing).t).toBe(1);
    expect(flightLights({ ...f, frozen: true }, cam, out)).toEqual({});
  });

  it("a light settles at its ends onto one camera — the path a slot lit by that camera always takes", () => {
    const a = { x: 1, y: 2, zoom: 3 };
    const b = { x: 4, y: 5, zoom: 6 };
    expect(settleLight(undefined)).toBeUndefined();
    expect(settleLight({ a })).toEqual({ a });
    expect(settleLight({ a, b, t: 0 })).toEqual({ a });
    expect(settleLight({ a, b, t: 1 })).toEqual({ a: b });
    const mid = { a, b, t: 0.5 };
    expect(settleLight(mid)).toBe(mid);
    const view = { camX: 4, camY: 5, zoom: 6, width: 1200, height: 800 };
    expect(litByOwn(view, undefined)).toBe(true);
    expect(litByOwn(view, { a: b })).toBe(true);
    expect(litByOwn(view, { a, b, t: 1 })).toBe(true);    // a handover that has landed on the slot's own camera
    expect(litByOwn(view, { a })).toBe(false);
    expect(litByOwn(view, mid)).toBe(false);
  });
});
