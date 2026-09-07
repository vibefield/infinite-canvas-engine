// @vitest-environment node
// The live portal's pure parts (PORTAL.md): the slot's BOX (what a nested slot
// instances and bakes — the root's numbers untouched), the gate, the portal's
// geometry — and §2's identity as a test: the camera a container's inside
// renders under at rest IS the enter flight's start, so a flight that begins
// from it cuts bit for bit; an exit's affine is the same M. Then the hole
// mode, the draw tree's order through a fake pass, and the pool.
import { must } from "./must";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONTENT_MODE, contentValues, PLATE, PORTAL, portalContent, runsOf } from "../../src/card/content";
import { frameStruct, frameUniformStruct, frameValues } from "../../src/card/layout";
import { DEFAULT_MAT_CONFIG, matConfigOf, withMat } from "../../src/packs/mat";
import { MatUniforms } from "../../src/packs/mat/layout";
import { FillUniforms } from "../../src/nav/fill-pass";
import { MATERIAL, PRODUCT, resolve, VF_EXT, VF_REST, VF_UNIFORMS } from "../../src/packs/vf-frame";
import { DEFAULT_FIELD_CONFIG, DRESS_FLOOR, dressConfig, Uniforms, packSources, uniformValues } from "../../src/field/layout";
import { atlasGeom, boxOf, boxValues, lod, rungCounts } from "../../src/lattice/lod";
import { drawFrame, drawSlot, prepareFrame, SlotPool, type DrawSlot, type SlotSet } from "../../src/compose/ground";
import { departedCamera, enterFlight, exitFlight, FIT, flightAt, outgoingCamera, solveFlightStart, invertAffine } from "../../src/nav/flight";
import { boxOfPortal, chainOf, clipOf, faceCovers, faceRadius, faceRect, FOLDER_FACE, intersectBox, PORTAL_CAP, PORTAL_CHAIN, PORTAL_CHAIN_TYPE, PORTAL_GATE, portalOf, portalPresence, portalValues, scissorOf, THROUGH_IN, THROUGH_OUT } from "../../src/nav/portal";
import { THEMES } from "../../oracle/fixtures/vf-theme";

const VP = { width: 1200, height: 800 };
const CAM = { x: 13.7, y: -21.3, zoom: 1.37 };
const K = { x: 412.5, y: 233.25, width: 329, height: 345 };
const CONTENT = { x: -40, y: -20, width: 700, height: 300 };
const view = (box?: { x: number; y: number; w: number; h: number }) => ({ camX: 13.7, camY: -21.3, zoom: 1.37, width: 1200, height: 800, ...(box ? { box } : {}) });
// both structs are BUILT per card program since design-014; these are the vf-frame pack's
const Frame = frameStruct(VF_EXT);
const FrameUniforms = frameUniformStruct(VF_UNIFORMS);

describe("the slot's box (PORTAL.md §2.3)", () => {
  it("absent, the box is the attachment: every lattice number is the root's", () => {
    const v = view();
    const full = view({ x: 0, y: 0, w: 1200, h: 800 });
    expect(boxOf(v)).toEqual({ x: 0, y: 0, w: 1200, h: 800 });
    expect(boxValues(v)).toEqual([0, 0, 1200, 800]);
    const l = lod(v);
    expect(atlasGeom(full, l, 6, 1)).toEqual(atlasGeom(v, l, 6, 1));
    expect(rungCounts(full, l)).toEqual(rungCounts(v, l));
    expect(uniformValues({ view: { ...v, dpr: 2 }, pointer: { x: 0, y: 0, on: false } }, DEFAULT_FIELD_CONFIG, 0).box).toEqual([0, 0, 1200, 800]);
    expect(uniformValues({ view: { ...view({ x: 300, y: 200, w: 309, h: 299 }), dpr: 2 }, pointer: { x: 0, y: 0, on: false } }, DEFAULT_FIELD_CONFIG, 0).box).toEqual([300, 200, 309, 299]);
  });
  it("a face-sized box instances and bakes the face, not the screen, and starts its atlas at the box", () => {
    const l = lod(view());
    const root = rungCounts(view(), l);
    const face = rungCounts(view({ x: 300, y: 200, w: 309, h: 299 }), l);
    expect(face[1].count).toBeLessThan(root[1].count / 4);   // the +3 edge margin per axis is the same on both, so a 9.6 % face is not 9.6 % of the sites
    const ga = atlasGeom(view(), l, 6, 1);
    const gb = atlasGeom(view({ x: 300, y: 200, w: 309, h: 299 }), l, 6, 1);
    expect(gb.w * gb.h).toBeLessThan(ga.w * ga.h / 4);   // the margin (the glyph's reach) is the same on both, so a 4.6 % face is not 4.6 % of the texels
    expect(gb.originI).toBeGreaterThan(ga.originI); expect(gb.originJ).toBeGreaterThan(ga.originJ);
    expect(gb.step).toBe(ga.step); expect(gb.phaseX).toBe(ga.phaseX);   // the phase is the camera's — sites land where they land
  });
  it("packSources culls against the box, with the field's reach as the pad", () => {
    const into = { n: 0, count: 8, set() { this.n += 1; } };
    const src = [{ cx: 100, cy: 100, hx: 20, hy: 20, r: 4, strength: 1 }, { cx: 900, cy: 700, hx: 20, hy: 20, r: 4, strength: 1 }];
    expect(packSources(src, { width: 1200, height: 800 }, 60, into)).toBe(2);
    expect(packSources(src, { width: 1200, height: 800, box: { x: 850, y: 650, w: 100, h: 100 } }, 60, into)).toBe(1);
    expect(Uniforms.fields.map(([n]) => n)).toContain("box");
  });
});

describe("the gate and the portal's geometry (§2.1, §2.5)", () => {
  it("presence is 0 under the gate, 1 past it, a smoothstep between — of the face's SHORT side", () => {
    const at = (w: number, h: number) => portalPresence({ cx: 0, cy: 0, hx: w / 2, hy: h / 2, r: 22 });
    expect(PORTAL_GATE).toEqual([80, 120]); expect(PORTAL_CAP).toBe(16);
    expect(at(79, 400)).toBe(0); expect(at(400, 79)).toBe(0);
    expect(at(120, 400)).toBe(1); expect(at(1000, 121)).toBe(1);
    expect(at(100, 400)).toBeCloseTo(0.5, 9);
    expect(at(110, 400)).toBeGreaterThan(at(100, 400));
    expect(at(100, 400, )).toBe(portalPresence({ cx: 0, cy: 0, hx: 200, hy: 50, r: 0 }));
  });
  it("the box is the face's bounding box plus a px, clamped to the attachment", () => {
    expect(boxOfPortal({ cx: 100, cy: 60, hx: 50, hy: 30, r: 8 }, VP)).toEqual({ x: 49, y: 29, w: 102, h: 62 });
    expect(boxOfPortal({ cx: 20, cy: 10, hx: 50, hy: 30, r: 8 }, VP)).toEqual({ x: 0, y: 0, w: 71, h: 41 });
    expect(boxOfPortal({ cx: 2000, cy: 10, hx: 50, hy: 30, r: 8 }, VP).w).toBe(0);
  });
  it("portalOf: the clip is the face on screen, M the flight's affine, the camera the departed-slot ride; null under the gate or without area", () => {
    const p = must(portalOf(K, 22, CONTENT, CAM, VP));
    expect(p).not.toBeNull();
    expect(p.clip).toEqual(clipOf(K, 22, CAM));
    expect(p.presence).toBe(1);
    const f = enterFlight(K, CONTENT, CAM, VP);
    expect(p.M).toEqual(invertAffine(f.affine) === p.M ? p.M : { s: 1 / f.affine.s, ox: -f.affine.ox / f.affine.s, oy: -f.affine.oy / f.affine.s });
    expect(p.cam).toEqual(outgoingCamera(p.M, CAM));
    expect(portalOf(K, 22, CONTENT, { ...CAM, zoom: 0.2 }, VP)).toBeNull();   // 329 × 0.2 = 66 px: under the gate
    expect(portalOf({ ...K, width: 0 }, 22, CONTENT, CAM, VP)).toBeNull();
    expect(must(portalOf(K, 22, CONTENT, { ...CAM, zoom: 0.3 }, VP, FIT, [40, 80])).presence).toBe(1);   // a host's gate
    // the inside's bounds may come as a thunk, asked only past the gate — a host makes an inside on first sight, never for a plate
    let asked = 0;
    const lazy = () => { asked += 1; return CONTENT; };
    expect(portalOf(K, 22, lazy, { ...CAM, zoom: 0.2 }, VP)).toBeNull(); expect(asked).toBe(0);
    expect(must(portalOf(K, 22, lazy, CAM, VP)).cam).toEqual(p.cam); expect(asked).toBe(1);
  });
});

describe("§2's identity — the portal's camera is the flight's start", () => {
  it("outgoingCamera(M, camPre) equals solveFlightStart(M⁻¹, camPre) to an ulp, and a flight started from it cuts EXACTLY", () => {
    const p = must(portalOf(K, 22, CONTENT, CAM, VP));
    const f = enterFlight(K, CONTENT, CAM, VP);
    const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1, Math.abs(b));
    expect(rel(p.cam.x, f.c0.x)).toBeLessThan(1e-12); expect(rel(p.cam.y, f.c0.y)).toBeLessThan(1e-12); expect(rel(p.cam.zoom, f.c0.zoom)).toBeLessThan(1e-12);
    const g = enterFlight(K, CONTENT, CAM, VP, undefined, undefined, p.cam);
    expect(g.c0).toBe(p.cam);                       // the very object: the arriving slot renders under the portal's camera
    expect(flightAt(g, 0, VP)).toBe(p.cam);
    expect(departedCamera(g, { ...g.c0 })).toBe(CAM);   // and the departed frame under the pre-cut camera, bit for bit
    expect(g.c1).toEqual(f.c1); expect(g.frozen).toBe(false);
    // the default start is still the continuity solve, pinned to ICE's numbers elsewhere
    expect(f.c0).toEqual(solveFlightStart(f.affine, CAM));
  });
  it("an exit's affine IS the portal's M, so the departed inside mid-flight renders under the portal's camera for that frame", () => {
    const saved = { x: 100, y: 50, zoom: 0.8 };
    const inner = { x: -100, y: -200, zoom: 1.6 };
    const g = exitFlight(K, CONTENT, inner, saved, VP);
    const p = must(portalOf(K, 22, CONTENT, saved, VP));
    expect(g.affine).toEqual(p.M);
    const mid = flightAt(g, 0.5, VP);
    expect(departedCamera(g, mid)).toEqual(must(portalOf(K, 22, CONTENT, mid, VP)).cam);
    expect(departedCamera(g, g.c1)).toEqual(p.cam);
  });
});

describe("the dressing (§9) and the zoom-through (§8)", () => {
  it("dressConfig scales the fade-in and the size presets by zoom / lodZoom, floored; σ = 1 is the object itself", () => {
    const cfg = DEFAULT_FIELD_CONFIG;
    expect(dressConfig(cfg, 0.5, undefined)).toBe(cfg);
    expect(dressConfig(cfg, 0.5, 0.5)).toBe(cfg);
    expect(dressConfig(cfg, 0.5, 0)).toBe(cfg);
    const d = dressConfig(cfg, 0.25, 1);   // a portal at a quarter of its arrival
    expect(d.fadeIn).toEqual([cfg.fadeIn[0] * 0.25, cfg.fadeIn[1] * 0.25]);
    expect(d.halfLen).toBe(cfg.halfLen * 0.25); expect(d.halfWidth).toBe(cfg.halfWidth * 0.25);
    expect(d.dotRadius[1]).toBeCloseTo(cfg.dotRadius[1] * 0.25, 12);
    expect(d.dotRadius[0]).toBe(Math.max(cfg.dotRadius[0] * 0.25, DRESS_FLOOR.dot));
    expect(d.needleHalfWidth[0]).toBeGreaterThanOrEqual(DRESS_FLOOR.wid);
    expect(d.reach).toBe(cfg.reach * 0.25);   // the bend round a miniature card is a miniature bend (§10)
    // a grid PROGRAM's own config rides `ext` since design-014, and the dressing leaves it alone
    expect(d.glyph).toBe(cfg.glyph);
    expect(matConfigOf(dressConfig(withMat(cfg, DEFAULT_MAT_CONFIG), 0.25, 1))).toBe(DEFAULT_MAT_CONFIG);
    const up = dressConfig(cfg, 4, 1);     // a departed parent magnified 4× keeps the cut's rungs, bigger
    expect(up.fadeIn[0]).toBe(cfg.fadeIn[0] * 4); expect(up.dotRadius[1]).toBeCloseTo(cfg.dotRadius[1] * 4, 12);
  });
  it("the portal's σ equals the arriving slot's at the cut: both are c0.zoom / c1.zoom from the same numbers", () => {
    const p = must(portalOf(K, 22, CONTENT, CAM, VP));
    const f = enterFlight(K, CONTENT, CAM, VP, undefined, undefined, p.cam);
    expect(p.arrival).toEqual(f.c1);
    expect(p.cam.zoom / p.arrival.zoom).toBe(f.c0.zoom / f.c1.zoom);
    expect(dressConfig(DEFAULT_FIELD_CONFIG, p.cam.zoom, p.arrival.zoom)).toEqual(dressConfig(DEFAULT_FIELD_CONFIG, f.c0.zoom, f.c1.zoom));
  });
  it("faceCovers: every viewport corner inside the rounded rect by the margin; the dead band between the two margins", () => {
    const vp = { width: 1200, height: 800 };
    const covering = { cx: 600, cy: 400, hx: 700, hy: 500, r: 60 };
    expect(faceCovers(covering, vp, THROUGH_IN)).toBe(true);
    expect(faceCovers(covering, vp, -THROUGH_OUT)).toBe(true);
    // the corner radius bites: a face that spans the viewport exactly leaves the corners outside its arcs
    const exact = { cx: 600, cy: 400, hx: 600, hy: 400, r: 60 };
    expect(faceCovers(exact, vp, THROUGH_IN)).toBe(false);
    expect(faceCovers(exact, vp, -THROUGH_OUT)).toBe(false);
    expect(faceCovers({ ...exact, r: 0 }, vp, 0)).toBe(true);
    expect(faceCovers({ ...exact, r: 0 }, vp, THROUGH_IN)).toBe(false);
    // a face 4 px short on the right: no longer entering, not yet leaving
    const short = { cx: 598, cy: 400, hx: 602, hy: 500, r: 0 };
    expect(faceCovers(short, vp, THROUGH_IN)).toBe(false);
    expect(faceCovers(short, vp, -THROUGH_OUT)).toBe(true);
    expect(THROUGH_IN).toBeGreaterThan(0); expect(THROUGH_OUT).toBeGreaterThan(THROUGH_IN);
  });
});

describe("the hole, the tree, the pool", () => {
  it("mode portal is 3 with no uv; the record carries it; a hole rides a z-run like a plate", () => {
    const G = resolve(PRODUCT, { centre: [0, 0], contentHalf: [64, 32], radius: 12 }, VF_REST, MATERIAL);
    expect(CONTENT_MODE.portal).toBe(3);
    expect(contentValues(G, PORTAL)).toEqual({ mode: 3, layer: 0, uv: [0, 0, 0, 0], chalf: G.ih });
    expect(frameValues(G, [0, 0, 0], PORTAL).mode).toBe(3);
    const b = Frame.alloc(1); b.set(frameValues(G, [0, 0, 0], PORTAL), 0);
    expect(new Uint32Array(b.bytes, Frame.slots.mode.byte, 1)[0]).toBe(3);
    expect(runsOf([PLATE, PORTAL, PLATE])).toEqual([{ first: 0, count: 3, own: null, srgb: false }]);
  });
  it("drawSlot interleaves nested slots at their container's index and restores the parent's scissor after each", () => {
    const log: string[] = [];
    const pass = { setScissorRect: (x: number, y: number, w: number, h: number) => log.push(`scissor ${x},${y},${w},${h}`) } as unknown as GPURenderPassEncoder;
    const fake = (name: string): DrawSlot["field"] & DrawSlot["frames"] => ({ draw: () => log.push(`${name} field`), drawRange: (_p: unknown, a: number, b: number) => log.push(`${name} frames ${a}..${b === Number.MAX_SAFE_INTEGER ? "end" : b}`), stats: {} } as unknown as DrawSlot["field"] & DrawSlot["frames"]);
    const slot = (name: string, present?: DrawSlot["present"], children?: DrawSlot["children"]): DrawSlot => {
      const f = fake(name);
      return { field: f, frames: f, present, fill: { draw: () => log.push(`${name} fill`) } as unknown as DrawSlot["fill"], children };
    };
    const portal = { cx: 300, cy: 200, hx: 100, hy: 60, r: 10 };
    // the inner slot's own face pokes 20 px past the child's right edge; seen THROUGH the child's face (`within`) its scissor stops there
    const inner = slot("inner", { opacity: 1, portal: { cx: 390, cy: 210, hx: 30, hy: 10, r: 2 }, within: [portal] });
    const child = slot("child", { opacity: 1, portal }, [{ at: 1, slot: inner }]);
    const gone = slot("gone", { opacity: 0, portal });
    const root = slot("root", undefined, [{ at: 5, slot: gone }, { at: 2, slot: child }]);
    expect(drawSlot(pass, { w: 2400, h: 1600 }, 2, root)).toBe(true);
    expect(log).toEqual([
      "scissor 0,0,2400,1600", "root field", "root frames 0..2",
      "scissor 399,279,402,242", "child fill", "child field", "child frames 0..1",
      "scissor 719,399,82,42", "inner fill", "inner field", "inner frames 0..end",
      "scissor 399,279,402,242", "child frames 1..end",
      "scissor 0,0,2400,1600", "root frames 2..5",
      "root frames 5..end",   // the slot at opacity 0 drew nothing and touched no scissor
    ]);
  });
  it("drawFrame: an enter through a live portal is one tree; an exit and a frozen flight are two whole slots; the attachment's scissor is restored last", () => {
    const log: string[] = [];
    const pass = { setScissorRect: (x: number, y: number, w: number, h: number) => log.push(`scissor ${x},${y},${w},${h}`) } as unknown as GPURenderPassEncoder;
    const stats = (name: string) => ({ name }) as unknown as DrawSlot["field"]["stats"];
    const mk = (name: string, present?: DrawSlot["present"]): DrawSlot => ({
      field: { draw: () => log.push(`${name} field`), stats: stats(name) } as unknown as DrawSlot["field"],
      frames: { drawRange: (_p: unknown, a: number, b: number) => log.push(`${name} ${a}..${b === Number.MAX_SAFE_INTEGER ? "end" : b}`) } as unknown as DrawSlot["frames"],
      present, fill: { draw: () => log.push(`${name} fill`) } as unknown as DrawSlot["fill"],
    });
    const face = { cx: 600, cy: 400, hx: 100, hy: 50, r: 8 };
    const size = { w: 2400, h: 1600 };
    const r1 = drawFrame(pass, size, 2, mk("in", { opacity: 1, portal: face }), { ...mk("out"), order: "under", at: 3 });
    expect(log).toEqual(["scissor 0,0,2400,1600", "out field", "out 0..3", "scissor 999,699,402,202", "in fill", "in field", "in 0..end", "scissor 0,0,2400,1600", "out 3..end", "scissor 0,0,2400,1600"]);
    expect((r1.incoming as unknown as { name: string }).name).toBe("in"); expect((r1.outgoing as unknown as { name: string }).name).toBe("out");
    log.length = 0;
    drawFrame(pass, size, 2, mk("in"), { ...mk("out", { opacity: 1, portal: face }), order: "over" });
    expect(log).toEqual(["scissor 0,0,2400,1600", "in field", "in 0..end", "scissor 999,699,402,202", "out fill", "out field", "out 0..end", "scissor 0,0,2400,1600"]);
    log.length = 0;
    const r3 = drawFrame(pass, size, 2, mk("in"), { ...mk("out", { opacity: 0 }), order: "under" });
    expect(log).toEqual(["scissor 0,0,2400,1600", "in field", "in 0..end", "scissor 0,0,2400,1600"]);
    expect(r3.outgoing).toBeNull();
  });
  it("prepareFrame builds the chain: a child is seen through its face and every face above it, its box inside the parent's, its fill grown a device px; on enter the departed frame's portal at the container is skipped", () => {
    type Call = { view: unknown; present: unknown; grow?: number };
    const made: { field: Call[]; fill: Call[] }[] = [];
    // a fake slot set records what its field and fill were prepared with; the pool spawns one per acquire (field, frames, fill in that order)
    const fakeSet = () => {
      const rec = { field: [] as Call[], fill: [] as Call[] };
      made.push(rec);
      return {
        field: { config: DEFAULT_FIELD_CONFIG, prepare: (_e: unknown, f: { view: unknown; present?: unknown }) => { rec.field.push({ view: f.view, present: f.present }); }, stats: {} },
        frames: { prepare: (_v: unknown, _t: unknown, list: unknown[]) => list.length, exact: false, lines: {}, heat: {} },
        fill: { prepare: (view: unknown, _c: unknown, present: unknown, grow: number) => { rec.fill.push({ view, present, grow }); } },
      };
    };
    const root = fakeSet() as unknown as SlotSet;
    let pending: ReturnType<typeof fakeSet> | null = null;
    const pool = new SlotPool({ field: { spawn: () => { pending = fakeSet(); return pending.field; } }, frames: { spawn: () => must(pending).frames }, fill: { spawn: () => must(pending).fill } } as unknown as SlotSet);
    const view = { camX: 0, camY: 0, zoom: 1, width: 1200, height: 800, dpr: 2 };
    const face = { cx: 600, cy: 400, hx: 400, hy: 300, r: 10 };          // a container's face: 200..1000 × 100..700
    const inner = { cx: 950, cy: 400, hx: 100, hy: 60, r: 4 };           // a folder inside it, poking 50 px past the face's right edge
    const leaf = (cfg = DEFAULT_FIELD_CONFIG) => ({ view, pointer: { x: 0, y: 0, on: false }, config: cfg, sources: [], frames: [] });
    const grand = { ...leaf(), present: { opacity: 1, portal: inner }, at: 0, plate: [0, 0, 0] as const };
    const child = { ...leaf(), present: { opacity: 1, portal: face }, at: 1, plate: [0, 0, 0] as const, portals: [grand] };
    const inputs = { ...leaf(), theme: THEMES.dark, frames: [{}, {}] as never, portals: [child] };
    const encoder = {} as GPUCommandEncoder;
    const p = prepareFrame(encoder, root, pool, inputs);
    expect(p.portals).toBe(2);
    const c = must(must(p.incoming.children)[0]).slot;
    const g = must(must(c.children)[0]).slot;
    expect(c.present).toEqual({ opacity: 1, portal: face, within: [] });
    expect(g.present).toEqual({ opacity: 1, portal: inner, within: [face] });
    expect(chainOf(g.present)).toEqual([inner, face]);
    // the grandchild's box is its face's bbox inside the child's: 849..1001 clipped at the child's 1001 → the same here; a face past it clips
    const gv = must(must(made[2]).field[0]).view as { box: { x: number; y: number; w: number; h: number } };
    expect(gv.box).toEqual(intersectBox(boxOfPortal(inner, view), boxOfPortal(face, view)));
    expect(must(must(made[1]).fill[0]).grow).toBe(1); expect(must(must(made[2]).fill[0]).grow).toBe(1);   // beneath a hole: grown
    // ENTER: the arriving frame (through the container) is the tree's child — its fill grows — and the departed frame's own portal at `at` is not prepared
    const enter = prepareFrame(encoder, root, pool, { ...leaf(), theme: THEMES.dark, present: { opacity: 1, portal: face }, outgoing: { ...leaf(), order: "under", at: 1, present: { opacity: 0.8 }, portals: [child, { ...child, at: 2 }] } });
    expect(enter.portals).toBe(2);   // the departed frame's portal at 2 (and its nested one), never the one at 1
    expect(must(must(made[0]).fill.at(-1)).grow).toBe(1);
    // EXIT: the departed inside draws over the whole parent — its fill as it is
    const exit = prepareFrame(encoder, root, pool, { ...leaf(), theme: THEMES.dark, outgoing: { ...leaf(), order: "over", present: { opacity: 1, portal: face } } });
    expect(must(exit.outgoing).at).toBeUndefined();
    const outRec = must(made.find((r) => r.fill.some((f) => f.present === must(exit.outgoing).present)));
    expect(must(outRec.fill.at(-1)).grow).toBe(0);
  });
  it("the pool spawns on demand, reuses across frames, and counts what it spawned", () => {
    let spawned = 0;
    const root = { field: { spawn: () => { spawned += 1; return {}; } }, frames: { spawn: () => ({}) }, fill: { spawn: () => ({}) } } as unknown as SlotSet;
    const pool = new SlotPool(root);
    pool.reset(); const a = pool.acquire(); const b = pool.acquire();
    expect(a).not.toBe(b); expect(pool.size).toBe(2); expect(spawned).toBe(2);
    pool.reset(); expect(pool.acquire()).toBe(a); expect(pool.acquire()).toBe(b); expect(pool.acquire()).not.toBe(a);
    expect(pool.size).toBe(3); expect(spawned).toBe(3);
  });
});

describe("§10 — the chain, the face, the fill's growth (the review's two defects)", () => {
  it("the chain is the slot's own face then every face above it; every uniform block carries PORTAL_CHAIN of them, and portal.wgsl agrees", () => {
    const a = { cx: 100, cy: 100, hx: 50, hy: 40, r: 4 };
    const b = { cx: 120, cy: 90, hx: 300, hy: 200, r: 20 };
    expect(chainOf(undefined)).toEqual([]);
    expect(chainOf({ opacity: 1, within: [b] })).toEqual([b]);
    expect(chainOf({ opacity: 1, portal: a, within: [b] })).toEqual([a, b]);
    const v = portalValues({ opacity: 1, portal: a, within: [b] });
    expect(v.portals.slice(0, 8)).toEqual([100, 100, 50, 40, 120, 90, 300, 200]);
    expect(v.clips.slice(0, 8)).toEqual([4, 1, 0, 0, 20, 1, 0, 0]); expect(v.clips[9]).toBe(0);
    expect(() => portalValues({ opacity: 1, within: Array.from({ length: PORTAL_CHAIN + 1 }, () => a) })).toThrow(/PORTAL_CHAIN/);
    for (const s of [Uniforms, FrameUniforms, MatUniforms, FillUniforms]) {
      expect(Object.fromEntries(s.fields)).toMatchObject({ portals: PORTAL_CHAIN_TYPE, clips: PORTAL_CHAIN_TYPE });
      expect(s.slots.portals.n).toBe(4 * PORTAL_CHAIN);
    }
    expect(readFileSync(new URL("../../shaders/portal.wgsl", import.meta.url), "utf8")).toContain(`const PORTAL_CHAIN = ${PORTAL_CHAIN}u;`);
  });
  it("the scissor and the box are the chain's intersection — empty where the faces miss", () => {
    const own = { cx: 390, cy: 210, hx: 30, hy: 10, r: 2 };
    const above = { cx: 300, cy: 200, hx: 100, hy: 60, r: 10 };
    expect(scissorOf({ opacity: 1, portal: own }, 2, { w: 2400, h: 1600 })).toEqual([719, 399, 122, 42]);
    expect(scissorOf({ opacity: 1, portal: own, within: [above] }, 2, { w: 2400, h: 1600 })).toEqual([719, 399, 82, 42]);
    expect(scissorOf({ opacity: 1, portal: own, within: [{ ...above, cx: 100 }] }, 2, { w: 2400, h: 1600 })[2]).toBe(0);
    expect(intersectBox({ x: 0, y: 0, w: 100, h: 100 }, { x: 50, y: 20, w: 100, h: 50 })).toEqual({ x: 50, y: 20, w: 50, h: 50 });
    expect(intersectBox({ x: 0, y: 0, w: 100, h: 100 }, { x: 200, y: 20, w: 100, h: 50 }).w).toBe(0);
  });
  it("the face: the product folder's insets and radius; the hole is cut to it, the band round it stays the plate", () => {
    expect(FOLDER_FACE).toEqual({ top: 10, right: 10, bottom: 36, left: 10, radius: 7 });   // plugins/field-tools manifest `portal`, folder.css
    const K = { x: 0, y: 0, width: 329, height: 345 };
    expect(faceRect(K, FOLDER_FACE)).toEqual({ x: 10, y: 10, width: 309, height: 299 });
    expect(faceRadius(K, FOLDER_FACE, 22)).toBe(7);
    // ICE's resolvePortal: insets that leave no area are ignored — the whole body, the card's own radius (a tiny folder's frozen flight still flies)
    const tiny = { ...K, width: 40, height: 40 };
    expect(faceRect(tiny, FOLDER_FACE)).toBe(tiny); expect(faceRadius(tiny, FOLDER_FACE, 22)).toBe(22);
    const G = resolve(PRODUCT, { centre: [50, 20], contentHalf: [164.5, 172.5], radius: 22 }, VF_REST, MATERIAL);
    const face = { cx: 50, cy: 7, hx: 154.5, hy: 149.5, r: 7 };
    expect(contentValues(G, portalContent(face))).toEqual({ mode: 3, layer: 0, uv: [0, -13, 7, 1], chalf: [154.5, 149.5] });
    expect(contentValues(G, PORTAL)).toEqual({ mode: 3, layer: 0, uv: [0, 0, 0, 0], chalf: G.ih });   // no face: the whole interior, as before
    const b = Frame.alloc(1); b.set(frameValues(G, [0, 0, 0], portalContent(face)), 0);
    expect(Array.from(new Float32Array(b.bytes, Frame.slots.uv.byte, 4))).toEqual([0, -13, 7, 1]);
  });
});
