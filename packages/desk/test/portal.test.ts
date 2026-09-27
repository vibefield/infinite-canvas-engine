// The live inside's pure parts (PORTAL.md; MINIMAT.md §3–§5): the slot's BOX (what a
// nested slot shades — the root's numbers untouched), the gate, the face's geometry —
// and §2's identity as a test: the camera a mini mat's inside renders under at rest IS
// the enter flight's start, so a flight that begins from it cuts bit for bit; an exit's
// affine is the same M. Then the dressing, the zoom-through's cover test, the draw
// tree's order through fake kinds (the mini mats in ranges, each live inside right
// after its mini mat and its chips over it), `prepareFrame`'s chain and HOST LIGHT, and
// the pool. (The folder's face, the portal hole in the card frame and the fill pass
// retired with the cards, 2026-09-25; the tree's slots hold the registry's kinds since
// D2a-render — kinds.test.ts has the registry's own laws.)
import { must } from "./must";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_MAT_CONFIG, MatUniforms, matUniformValues, STILL_MAT_FRAME } from "../src/mat/layout";
import { DEFAULT_GRID, dressGrid, dressScale } from "../src/mat/grid";
import { boxOf, boxValues } from "../src/lattice/lod";
import { type DrawSlot, drawFrame, drawSlot, type KindExtra, type KindPass, prepareFrame, type SlotContext, type SlotKind, SlotPool, type SlotSet } from "../src/ground";
import { departedCamera, enterFlight, exitFlight, FIT, flightAt, outgoingCamera, solveFlightStart } from "../src/nav/flight";
import { boxOfPortal, chainOf, clipOf, faceCovers, intersectBox, PORTAL_CAP, PORTAL_CHAIN, PORTAL_CHAIN_TYPE, PORTAL_GATE, portalPresence, portalValues, scissorOf, THROUGH_IN, THROUGH_OUT } from "../src/nav/portal";
import { DEFAULT_MINIMAT_LAW, FACE_RADIUS, faceClip, faceOf, MINIMAT_REST, resolveMiniMat } from "../src/minimat/minimat";
import { insideView } from "../src/minimat/inside";
import { lampOf } from "../src/paper/paper";
import { GRID, MAT_GRID } from "../src/theme";
import { MINIMAT } from "../src/minimat/theme";
import { THEMES } from "../oracle/fixtures/vf-theme";
import { DESK, fakeSlot, scissorPass } from "./fake-kinds";

const VP = { width: 1200, height: 800 };
const CAM = { x: 13.7, y: -21.3, zoom: 1.37 };
const CONTENT = { x: -40, y: -20, width: 700, height: 300 };
const view = (box?: { x: number; y: number; w: number; h: number }) => ({ camX: 13.7, camY: -21.3, zoom: 1.37, width: 1200, height: 800, ...(box ? { box } : {}) });
// a mini mat at rest whose FACE is K: the sheet is the face grown by the printed border all round
const K = { x: 412.5, y: 233.25, width: 329, height: 345 };
const G = resolveMiniMat({ cx: K.x + K.width / 2, cy: K.y + K.height / 2, w: K.width + 2 * MINIMAT.margin, h: K.height + 2 * MINIMAT.margin }, MINIMAT_REST, DEFAULT_MINIMAT_LAW, lampOf(MAT_GRID.plane));

describe("the slot's box (PORTAL.md §2.3)", () => {
  it("absent, the box is the attachment; the mat's block carries whichever it is", () => {
    const v = view();
    expect(boxOf(v)).toEqual({ x: 0, y: 0, w: 1200, h: 800 });
    expect(boxValues(v)).toEqual([0, 0, 1200, 800]);
    expect(MatUniforms.fields.map(([n]) => n)).toContain("box");
    expect(matUniformValues({ ...v, dpr: 2 }, GRID.fadeIn, DEFAULT_MAT_CONFIG, STILL_MAT_FRAME, 0).box).toEqual([0, 0, 1200, 800]);
    expect(matUniformValues({ ...view({ x: 300, y: 200, w: 309, h: 299 }), dpr: 2 }, GRID.fadeIn, DEFAULT_MAT_CONFIG, STILL_MAT_FRAME, 0).box).toEqual([300, 200, 309, 299]);
    // the box moves nothing else: the lattice is the camera's, wherever the slot is shaded
    const a = matUniformValues({ ...v, dpr: 2 }, GRID.fadeIn, DEFAULT_MAT_CONFIG, STILL_MAT_FRAME, 0);
    const b = matUniformValues({ ...view({ x: 300, y: 200, w: 309, h: 299 }), dpr: 2 }, GRID.fadeIn, DEFAULT_MAT_CONFIG, STILL_MAT_FRAME, 0);
    expect({ ...b, box: a.box }).toEqual(a);
  });
});

describe("the gate and the face's geometry (§2.1, §2.5; MINIMAT.md §3)", () => {
  it("presence is 0 under the gate, 1 past it, a smoothstep between — of the face's SHORT side; the gate is the mini mat's", () => {
    const at = (w: number, h: number) => portalPresence({ cx: 0, cy: 0, hx: w / 2, hy: h / 2, r: 0 });
    expect(PORTAL_GATE).toBe(MINIMAT.gate); expect(PORTAL_CAP).toBe(16);
    const [lo, hi] = PORTAL_GATE;
    expect(at(lo - 1, 800)).toBe(0); expect(at(800, lo - 1)).toBe(0);
    expect(at(hi, 800)).toBe(1); expect(at(2000, hi + 1)).toBe(1);
    expect(at((lo + hi) / 2, 800)).toBeCloseTo(0.5, 9);
    expect(at((lo + hi) / 2 + 10, 800)).toBeGreaterThan(at((lo + hi) / 2, 800));
  });
  it("the box is the face's bounding box plus a px, clamped to the attachment", () => {
    expect(boxOfPortal({ cx: 100, cy: 60, hx: 50, hy: 30, r: 8 }, VP)).toEqual({ x: 49, y: 29, w: 102, h: 62 });
    expect(boxOfPortal({ cx: 20, cy: 10, hx: 50, hy: 30, r: 8 }, VP)).toEqual({ x: 0, y: 0, w: 71, h: 41 });
    expect(boxOfPortal({ cx: 2000, cy: 10, hx: 50, hy: 30, r: 8 }, VP).w).toBe(0);
  });
  it("the face is the sheet inset by its printed border, square-cornered; its clip is clipOf of it", () => {
    expect(faceOf(G)).toEqual(K);
    expect(FACE_RADIUS).toBe(0);
    expect(faceClip(G, CAM)).toEqual(clipOf(K, 0, CAM));
  });
  it("insideView: the clip is the face on screen, M the flight's affine, the camera the departed-slot ride — at EVERY size, the gate only its presence", () => {
    const v = must(insideView(G, CONTENT, CAM, VP));
    expect(v.clip).toEqual(faceClip(G, CAM));
    expect(v.presence).toBe(1);
    const f = enterFlight(K, CONTENT, CAM, VP);
    expect(v.M).toEqual({ s: 1 / f.affine.s, ox: -f.affine.ox / f.affine.s, oy: -f.affine.oy / f.affine.s });
    expect(v.cam).toEqual(outgoingCamera(v.M, CAM));
    expect(v.box).toEqual(boxOfPortal(v.clip, VP));
    // under the gate the embedding is still there — the far LOD draws the face on it — and the presence is 0
    const far = must(insideView(G, CONTENT, { ...CAM, zoom: 0.2 }, VP));   // 329 × 0.2 = 66 px
    expect(far.presence).toBe(0); expect(far.M).toEqual(v.M);
    expect(must(insideView(G, CONTENT, { ...CAM, zoom: 0.3 }, VP, FIT, [40, 80])).presence).toBe(1);   // a host's gate
    // an empty inside arrives on its origin at zoom 1
    expect(must(insideView(G, null, CAM, VP)).arrival).toEqual({ x: -VP.width / 2, y: -VP.height / 2, zoom: 1 });
  });
});

describe("§2's identity — the inside's camera is the flight's start", () => {
  it("outgoingCamera(M, camPre) equals solveFlightStart(M⁻¹, camPre) to an ulp, and a flight started from it cuts EXACTLY", () => {
    const v = must(insideView(G, CONTENT, CAM, VP));
    const f = enterFlight(K, CONTENT, CAM, VP);
    const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1, Math.abs(b));
    expect(rel(v.cam.x, f.c0.x)).toBeLessThan(1e-12); expect(rel(v.cam.y, f.c0.y)).toBeLessThan(1e-12); expect(rel(v.cam.zoom, f.c0.zoom)).toBeLessThan(1e-12);
    const g = enterFlight(K, CONTENT, CAM, VP, undefined, undefined, v.cam);
    expect(g.c0).toBe(v.cam);                       // the very object: the arriving desk renders under the face's camera
    expect(flightAt(g, 0, VP)).toBe(v.cam);
    expect(departedCamera(g, { ...g.c0 })).toBe(CAM);   // and the departed desk under the pre-cut camera, bit for bit
    expect(g.c1).toEqual(f.c1); expect(g.frozen).toBe(false);
    // the default start is still the continuity solve, pinned to ICE's numbers elsewhere
    expect(f.c0).toEqual(solveFlightStart(f.affine, CAM));
  });
  it("an exit's affine IS the face's M, so the departed inside mid-flight renders under the face's camera for that frame", () => {
    const saved = { x: 100, y: 50, zoom: 0.8 };
    const inner = { x: -100, y: -200, zoom: 1.6 };
    const g = exitFlight(K, CONTENT, inner, saved, VP);
    const v = must(insideView(G, CONTENT, saved, VP));
    expect(g.affine).toEqual(v.M);
    const mid = flightAt(g, 0.5, VP);
    expect(departedCamera(g, mid)).toEqual(must(insideView(G, CONTENT, mid, VP)).cam);
    expect(departedCamera(g, g.c1)).toEqual(v.cam);
  });
});

describe("the dressing (§9) and the zoom-through (§8)", () => {
  it("dressGrid scales the fade-in by zoom / lodZoom, floored at GRID.dressFloor; σ = 1 is the object itself", () => {
    const g = DEFAULT_GRID;
    expect(dressGrid(g, 0.5, undefined)).toBe(g);
    expect(dressGrid(g, 0.5, 0.5)).toBe(g);
    expect(dressGrid(g, 0.5, 0)).toBe(g);
    const d = dressGrid(g, 0.75, 1);   // a face at three quarters of its arrival
    expect(d.fadeIn).toEqual([g.fadeIn[0] * 0.75, g.fadeIn[1] * 0.75]);
    expect(d.mat).toBe(g.mat);
    // a miniature's grid is never finer than the floor's share of the desk's: the lattice a tiny face shows stays a mat's, not a haze
    expect(dressScale(0.1, 1)).toBe(GRID.dressFloor);
    expect(dressGrid(g, 0.1, 1).fadeIn).toEqual([g.fadeIn[0] * GRID.dressFloor, g.fadeIn[1] * GRID.dressFloor]);
    const up = dressGrid(g, 4, 1);     // a departed parent magnified 4× keeps the cut's rungs, bigger
    expect(up.fadeIn[0]).toBe(g.fadeIn[0] * 4);
  });
  it("the face's σ equals the arriving desk's at the cut: both are c0.zoom / c1.zoom from the same numbers", () => {
    const v = must(insideView(G, CONTENT, CAM, VP));
    const f = enterFlight(K, CONTENT, CAM, VP, undefined, undefined, v.cam);
    expect(v.arrival).toEqual(f.c1);
    expect(v.cam.zoom / v.arrival.zoom).toBe(f.c0.zoom / f.c1.zoom);
    expect(dressGrid(DEFAULT_GRID, v.cam.zoom, v.arrival.zoom)).toEqual(dressGrid(DEFAULT_GRID, f.c0.zoom, f.c1.zoom));
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

// A slot of the desk's shape for the draw order — mini mats (sheets) and notes (things), their objects in paint order, the
// mini mats first — every draw call it gets logged by slot and kind (fake-kinds.ts).
const deskSlot = (log: string[], name: string, objects: readonly string[], present?: DrawSlot["present"], children?: DrawSlot["children"]) => fakeSlot(log, name, { kinds: DESK, objects, present, children });
const mats = (n: number, notes = 0): string[] => [...Array.from({ length: n }, () => "minimat"), ...Array.from({ length: notes }, () => "paper")];

describe("the tree, the pool", () => {
  it("drawSlot draws the mini mats in ranges, each live inside right after its mini mat and its chips over it, restoring the parent's scissor", () => {
    const log: string[] = [];
    const face = { cx: 300, cy: 200, hx: 100, hy: 60, r: 0 };
    // the inner slot's own face pokes 20 px past the child's right edge; seen THROUGH the child's face (`within`) its scissor stops there
    const inner = deskSlot(log, "inner", mats(1, 1), { opacity: 1, portal: { cx: 390, cy: 210, hx: 30, hy: 10, r: 0 }, within: [face] });
    const child = deskSlot(log, "child", mats(3, 1), { opacity: 1, portal: face }, [{ at: 1, slot: inner }]);
    const gone = deskSlot(log, "gone", mats(1, 1), { opacity: 0, portal: face });
    const root = deskSlot(log, "root", mats(8, 1), undefined, [{ at: 5, slot: gone }, { at: 2, slot: child }]);
    expect(drawSlot(scissorPass(log), { w: 2400, h: 1600 }, 2, root)).toBe(true);
    expect(log).toEqual([
      "scissor 0,0,2400,1600", "root mat", "root minimat 0..3",
      "scissor 399,279,402,242", "child mat", "child minimat 0..2",
      "scissor 719,399,82,42", "inner mat", "inner minimat 0..1", "inner paper 0..1",
      "scissor 399,279,402,242", "child minimat over 1", "child minimat 2..3", "child paper 0..1",
      "scissor 0,0,2400,1600", "root minimat over 2", "root minimat 3..6",
      "root minimat over 5",   // the slot at opacity 0 drew nothing and touched no scissor (the pass draws no chips over an inside that is not there)
      "root minimat 6..8", "root paper 0..1",
    ]);
  });
  it("drawFrame: an enter through a live face is one tree; an exit and a frozen flight are two whole slots; the attachment's scissor is restored last", () => {
    const log: string[] = [];
    const pass = scissorPass(log);
    const face = { cx: 600, cy: 400, hx: 100, hy: 50, r: 0 };
    const size = { w: 2400, h: 1600 };
    const r1 = drawFrame(pass, size, 2, deskSlot(log, "in", mats(1, 1), { opacity: 1, portal: face }), { ...deskSlot(log, "out", mats(5, 1)), order: "under", at: 3 });
    expect(log).toEqual(["scissor 0,0,2400,1600", "out mat", "out minimat 0..4", "scissor 999,699,402,202", "in mat", "in minimat 0..1", "in paper 0..1", "scissor 0,0,2400,1600", "out minimat over 3", "out minimat 4..5", "out paper 0..1", "scissor 0,0,2400,1600"]);
    expect((r1.incoming as unknown as { name: string }).name).toBe("in"); expect((r1.outgoing as unknown as { name: string }).name).toBe("out");
    log.length = 0;
    drawFrame(pass, size, 2, deskSlot(log, "in", mats(1, 1)), { ...deskSlot(log, "out", mats(1, 1), { opacity: 1, portal: face }), order: "over" });
    expect(log).toEqual(["scissor 0,0,2400,1600", "in mat", "in minimat 0..1", "in paper 0..1", "scissor 999,699,402,202", "out mat", "out minimat 0..1", "out paper 0..1", "scissor 0,0,2400,1600"]);
    log.length = 0;
    const r3 = drawFrame(pass, size, 2, deskSlot(log, "in", mats(1, 1)), { ...deskSlot(log, "out", mats(1, 1), { opacity: 0 }), order: "under" });
    expect(log).toEqual(["scissor 0,0,2400,1600", "in mat", "in minimat 0..1", "in paper 0..1", "scissor 0,0,2400,1600"]);
    expect(r3.outgoing).toBeNull();
  });
  it("prepareFrame builds the chain and hands every nested slot its host's light; each mini mat is told its live inside's presence; on enter the departed desk's face at `at` is the arriving desk", () => {
    type MatCall = { view: { box?: unknown }; present: unknown; lit: unknown };
    type MiniCall = { present: unknown; lit: unknown; live: number[] };
    const made: { mat: MatCall[]; minis: MiniCall[] }[] = [];
    // a fake slot set records what its mat and its mini mats were prepared with; the pool spawns one per acquire (mat first)
    const fakeSet = () => {
      const rec = { mat: [] as MatCall[], minis: [] as MiniCall[] };
      made.push(rec);
      const minimats = { prepare: (_e: unknown, slot: SlotContext, list: readonly unknown[], extra?: KindExtra) => { rec.minis.push({ present: slot.present, lit: slot.lit, live: [0, 1, 2].map((i) => extra?.live(i) ?? -2) }); return list.length; }, tune() {} } as unknown as KindPass;
      return {
        mat: { prepare: (_e: unknown, view: MatCall["view"], _f: unknown, _c: unknown, _m: unknown, present: unknown, _l: unknown, lit: unknown) => { rec.mat.push({ view, present, lit }); return false; }, newFrame: () => {} },
        kinds: new Map<string, SlotKind>([["minimat", { name: "minimat", stratum: "sheets", pass: minimats }]]),
      };
    };
    const root = fakeSet() as unknown as SlotSet;
    let pending: ReturnType<typeof fakeSet> | null = null;
    const spawned = { spawn: () => must(must(pending).kinds.get("minimat")).pass } as unknown as KindPass;
    const pool = new SlotPool({ mat: { spawn: () => { pending = fakeSet(); return pending.mat; } }, kinds: new Map([["minimat", { name: "minimat", stratum: "sheets", pass: spawned }]]) } as unknown as SlotSet);
    const v = { camX: 5, camY: 7, zoom: 1, width: 1200, height: 800, dpr: 2 };
    const face = { cx: 600, cy: 400, hx: 400, hy: 300, r: 0 };          // a mini mat's face: 200..1000 × 100..700
    const inner = { cx: 950, cy: 400, hx: 100, hy: 60, r: 0 };           // a mini mat inside it, poking 50 px past the face's right edge
    // every desk here holds three mini mats: object i is mini mat i, which a portal's `at` names
    const leaf = { view: v, grid: DEFAULT_GRID, objects: [0, 1, 2].map(() => ({ kind: "minimat", record: {} })) };
    const grand = { ...leaf, present: { opacity: 1, portal: inner }, at: 0 };
    const child = { ...leaf, present: { opacity: 1, objects: 0.4, portal: face }, at: 1, portals: [grand] };
    const encoder = {} as GPUCommandEncoder;
    const p = prepareFrame(encoder, root, pool, { ...leaf, theme: THEMES.dark, portals: [child] });
    expect(p.portals).toBe(2);
    const c = must(must(p.incoming.children)[0]).slot;
    const g = must(must(c.children)[0]).slot;
    expect(c.present).toEqual({ opacity: 1, objects: 0.4, portal: face, within: [] });
    expect(g.present).toEqual({ opacity: 1, portal: inner, within: [face] });
    expect(chainOf(g.present)).toEqual([inner, face]);
    // the grandchild's box is its face's bbox inside the child's: a face past it clips
    expect(must(must(made[2]).mat[0]).view.box).toEqual(intersectBox(boxOfPortal(inner, v), boxOfPortal(face, v)));
    // THE HOST'S LIGHT (MINIMAT.md §4): the root is lit by its own lamp exactly; its inside, and the inside's inside, by the root's
    const rootLight = { a: { x: 5, y: 7, zoom: 1 } };
    expect(must(must(made[0]).mat[0]).lit).toBeUndefined();
    expect(must(must(made[1]).mat[0]).lit).toEqual(rootLight); expect(must(must(made[2]).mat[0]).lit).toEqual(rootLight);
    expect(must(must(made[1]).minis[0]).lit).toEqual(rootLight);
    // each mini mat is told its live inside: the child's objects' presence at 1, none (−1) elsewhere
    expect(must(must(made[0]).minis[0]).live).toEqual([-1, 0.4, -1]);
    expect(must(must(made[1]).minis[0]).live).toEqual([1, -1, -1]);
    // a host's light for the root is the root's, and its insides'
    const lit = { a: { x: 1, y: 2, zoom: 3 }, b: { x: 4, y: 5, zoom: 6 }, t: 0.5 };
    prepareFrame(encoder, root, pool, { ...leaf, theme: THEMES.dark, light: lit, portals: [child] });
    expect(must(must(made[0]).mat.at(-1)).lit).toBe(lit); expect(must(must(made[1]).mat.at(-1)).lit).toBe(lit);
    // ENTER: the departed desk's own face at `at` is the arriving desk — never prepared — and its mini mat there is told the arriving desk's presence
    const enter = prepareFrame(encoder, root, pool, { ...leaf, theme: THEMES.dark, present: { opacity: 1, objects: 0.6, portal: face }, outgoing: { ...leaf, order: "under", at: 1, present: { opacity: 0.8 }, portals: [child, { ...child, at: 2 }] } });
    expect(enter.portals).toBe(2);   // the departed desk's face at 2 (and its nested one), never the one at 1
    const departed = must(made.find((r) => r.mat.some((m) => (m.present as { opacity?: number } | undefined)?.opacity === 0.8)));
    expect(must(departed.minis.at(-1)).live).toEqual([-1, 0.6, 0.4]);
    // EXIT: the departed inside draws over the whole parent
    const exit = prepareFrame(encoder, root, pool, { ...leaf, theme: THEMES.dark, outgoing: { ...leaf, order: "over", present: { opacity: 1, portal: face } } });
    expect(must(exit.outgoing).at).toBeUndefined();
  });
  it("the pool spawns on demand, reuses across frames, and counts what it spawned", () => {
    let spawned = 0;
    const kind = (name: string, stratum: SlotKind["stratum"]): SlotKind => ({ name, stratum, pass: { spawn: () => ({}) } as unknown as KindPass });
    const root = { mat: { spawn: () => { spawned += 1; return {}; } }, kinds: new Map([["paper", kind("paper", "things")], ["minimat", kind("minimat", "sheets")]]) } as unknown as SlotSet;
    const pool = new SlotPool(root);
    pool.reset(); const a = pool.acquire();
    const b = pool.acquire();
    expect(a).not.toBe(b); expect(pool.size).toBe(2); expect(spawned).toBe(2);
    pool.reset(); expect(pool.acquire()).toBe(a); expect(pool.acquire()).toBe(b); expect(pool.acquire()).not.toBe(a);
    expect(pool.size).toBe(3); expect(spawned).toBe(3);
  });
});

describe("§10 — the chain", () => {
  it("the chain is the slot's own face then every face above it; the mat's block — every object pass binds it — carries PORTAL_CHAIN of them, and portal.wgsl agrees", () => {
    const a = { cx: 100, cy: 100, hx: 50, hy: 40, r: 4 };
    const b = { cx: 120, cy: 90, hx: 300, hy: 200, r: 20 };
    expect(chainOf(undefined)).toEqual([]);
    expect(chainOf({ opacity: 1, within: [b] })).toEqual([b]);
    expect(chainOf({ opacity: 1, portal: a, within: [b] })).toEqual([a, b]);
    const pv = portalValues({ opacity: 1, portal: a, within: [b] });
    expect(pv.portals.slice(0, 8)).toEqual([100, 100, 50, 40, 120, 90, 300, 200]);
    expect(pv.clips.slice(0, 8)).toEqual([4, 1, 0, 0, 20, 1, 0, 0]); expect(pv.clips[9]).toBe(0);
    expect(() => portalValues({ opacity: 1, within: Array.from({ length: PORTAL_CHAIN + 1 }, () => a) })).toThrow(/PORTAL_CHAIN/);
    expect(Object.fromEntries(MatUniforms.fields)).toMatchObject({ portals: PORTAL_CHAIN_TYPE, clips: PORTAL_CHAIN_TYPE });
    expect(MatUniforms.slots.portals.n).toBe(4 * PORTAL_CHAIN);
    expect(readFileSync(new URL("../shaders/portal.wgsl", import.meta.url), "utf8")).toContain(`const PORTAL_CHAIN = ${PORTAL_CHAIN}u;`);
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
});
