// @vitest-environment node
// The NESTED DESKS from the world (design-015 §9, MINIMAT.md §3–§5; D2b): a mini mat's children
// become its live inside — a slot through its face under `insideViewOfFace(...).cam` with the gate's
// presence, `at` its row — and its far-LOD chips; the gate; live insides off. The SEAM: a container's
// face AS DRAWN (a hovered mat's, risen) while it is in the frame, at rest when it is not. The FLIGHT:
// the departed desk from the frame's Retained widgets as one tree through the face on an enter, the
// dressing for the landing and the cut; the cut frame holds every spring. The RE-DRESSING: 320 ms in
// log space from the zoom the desk was dressed for, the lamp handed over on the same ramp, a hold at 0.
import { Camera, createCanvasEngine, Grab, NavRedress, NavTransition, NO_ENTITY, Retained, Selected, Viewport, writeRuntimeResource } from "@ice/core";
import { describe, expect, it } from "vitest";
import { createDeskBuilder, DEFAULT_GRID, FIT, outgoingCamera, portalAffine, visibleRect, PORTAL_GATE } from "@ice/desk";
import { minimatKind } from "../src/minimat/kind";
import { paperKind } from "../src/paper/kind";
import { insideViewOfFace } from "@ice/desk/kit";
import type { MiniMatInstance } from "../src/minimat/layout";
import { faceOf, type MiniMatGeometry } from "../src/minimat/minimat";
import { MiniMat, Note } from "../src";
import type { PaperInstance } from "../src/paper/layout";
import { PALETTE, PENS, SURFACES, THEMES, VINYLS } from "../../desk/oracle/fixtures/vf-theme";
import { must } from "../../desk/test/must";

const VP = { width: 1200, height: 800, dpr: 2 };
const CAM = { x: 0, y: 0, zoom: 1 };
const DT = 1 / 60;
const palette = { ...PALETTE.light, papers: { yellow: SURFACES.note }, pens: PENS, vinyls: VINYLS };
const LOOKS = new Map<string, unknown>([["paper", must(paperKind().theme)(palette, "light")], ["minimat", must(minimatKind().theme)(palette, "light")]]);

function makeDesk() {
  const ce = createCanvasEngine({ widgets: [Note, MiniMat] });
  ce.docs.create();
  ce.world.setResource(Viewport, { w: VP.width, h: VP.height, dpr: VP.dpr });
  let now = 0;
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; ce.step(now); } };
  const note = (cx: number, cy: number, parent?: number, props: Record<string, unknown> = {}) => ce.ops.spawnWidget("desk.note", { x: cx - 100, y: cy - 100, props: { seed: 7, ...props }, ...(parent === undefined ? {} : { parent: parent as never }), undoable: false });
  const mat = (cx: number, cy: number, w = 640, h = 480, parent?: number) => ce.ops.spawnWidget("desk.minimat", { x: cx - w / 2, y: cy - h / 2, w, h, props: { name: "Inbox" }, ...(parent === undefined ? {} : { parent: parent as never }), undoable: false });
  const builder = createDeskBuilder(ce.world, { objects: [Note, MiniMat] });
  const build = (cam = CAM, dt = DT, opts: Parameters<typeof builder.build>[6] = {}) => { builder.changed(); return builder.build(cam, VP, dt, THEMES.light, DEFAULT_GRID, LOOKS, { now, ...opts }); };
  const settle = (cam = CAM): number => { let n = 0; do { build(cam); n += 1; } while (builder.live() && n < 600); return n; };
  const camera = () => { const c = ce.world.getResource(Camera); if (c === undefined) throw new Error("no camera"); return { x: c.x, y: c.y, zoom: c.zoom }; };
  return { ce, world: ce.world, step, builder, build, settle, note, mat, camera, now: () => now };
}

/** The desk of the oracle's minimat scenes, in miniature: a mini mat at (700, 400) 640×480 holding two notes and a small mat. */
function nested() {
  const d = makeDesk();
  const m = d.mat(700, 400);
  d.step(3);   // the container compiles before it takes children
  const a = d.note(-120, -60, m);
  const b = d.note(110, -40, m, { pen: "ball" });
  const inner = d.mat(340, 120, 420, 320, m);
  const root = d.note(200, 600);
  d.step(5);
  return { ...d, m, a, b, inner, root };
}

describe("the live inside from the world (MINIMAT.md §3)", () => {
  it("a mini mat's children are its portal — through its face, under the inside's camera, at the gate's presence, `at` its row — and its chips", () => {
    const d = nested();
    const f = d.build();
    // the root: the mat (sheets) then the root note (things); the children are NOT root members
    expect(f.objects.map((o) => o.kind)).toEqual(["minimat", "paper"]);
    expect(f.stats.active).toBe(2);
    expect(f.portals).toHaveLength(1);
    const p = must(f.portals[0]);
    expect(p.at).toBe(0);
    // the inside's camera and presence are the face's own numbers (insideViewOfFace on the drawn face), the face 640−64 × 480−64 at zoom 1 → past the gate
    const G = d.builder.geometryOf(d.m) as MiniMatGeometry;
    const view = must(insideViewOfFace(faceOf(G), { x: -220, y: -160, width: 770, height: 440 }, CAM, VP, FIT, PORTAL_GATE));
    expect(p.view.camX).toBe(view.cam.x);
    expect(p.view.camY).toBe(view.cam.y);
    expect(p.view.zoom).toBe(view.cam.zoom);
    expect(p.present?.objects).toBe(1);
    expect(p.present?.portal).toEqual(view.clip);
    expect(p.lodZoom).toBe(view.arrival.zoom);
    // its objects: the inner mat first (sheets), then the two notes, under the inside's camera. The inner mat's face (256 world
    // units short) is 123 px at the inside's zoom 0.48 — short of the gate: its far LOD alone, no portal of its own
    expect((p.objects ?? []).map((o) => o.kind)).toEqual(["minimat", "paper", "paper"]);
    expect(p.portals).toBeUndefined();
    expect(must(d.builder.insideViewOf(d.inner)).presence).toBe(0);
    expect(p.view.zoom).toBeCloseTo(0.48, 12);
    // the mat's record carries the chips of its three children: two paper chips (the ball pen's ink on the second), one vinyl chip
    const rec = must(f.objects[0]).record as MiniMatInstance;
    expect(rec.chips?.map((c) => c.kind)).toEqual(["mat", "paper", "paper"]);
    expect(rec.live).toBe(-1);
    // the inside's members lie at rest: no lift, no ring (nothing inside is held or selected)
    const noteRec = must(p.objects?.[1]).record as PaperInstance;
    expect(noteRec.geometry.lift).toBe(0);
    expect(noteRec.geometry.ring).toBe(0);
    expect(f.stats.portals).toBe(1);
  });

  it("the gate: a face short of 140 px draws its chips alone; live insides can be turned off", () => {
    const d = nested();
    const far = d.build({ x: -2000, y: -1400, zoom: 0.2 });
    expect(far.portals).toHaveLength(0);
    const rec = must(far.objects[0]).record as MiniMatInstance;
    expect(rec.chips).toHaveLength(3);
    expect(must(d.builder.insideViewOf(d.m)).presence).toBe(0);
    const off = d.build(CAM, DT, { portals: false });
    expect(off.portals).toHaveLength(0);
    expect(off.stats.portals).toBe(0);
    expect((must(off.objects[0]).record as MiniMatInstance).chips).toHaveLength(3);
  });
});

describe("the seam — the face AS DRAWN (design-015 §9)", () => {
  it("a held mat's face is the larger one the desk drew, not the static portal rect; out of the frame it answers at rest", () => {
    const d = nested();
    d.settle();
    const rest = must(d.builder.navFace(d.m, CAM));
    const staticFace = { x: 700 - 320 + 32, y: 400 - 240 + 32, width: 640 - 64, height: 480 - 64 };
    expect(rest.face).toEqual(staticFace);
    // held (the pin sits the lift at 1 — a still's `held`): the sheet reads a touch larger (MINIMAT.lift.scale) — the drawn face is what
    // the seam answers, so a flight from it cuts exactly. (A hover is a RISE alone: it moves the shadow, never the face.)
    d.builder.pinFlux(d.m, { lift: 1 });
    d.settle();
    const G = d.builder.geometryOf(d.m) as MiniMatGeometry;
    const drawn = must(d.builder.navFace(d.m, CAM));
    expect(drawn.face).toEqual(faceOf(G));
    expect(drawn.face.width).toBeGreaterThan(staticFace.width);
    // the answer IS the flight's own numbers on that face
    const view = must(insideViewOfFace(drawn.face, { x: -220, y: -160, width: 770, height: 440 }, CAM, VP, FIT, PORTAL_GATE));
    expect(drawn.camera).toEqual(view.cam);
    expect(drawn.arrival).toEqual(view.arrival);
    expect(drawn.affine).toEqual(view.M);
    expect(drawn.presence).toBe(1);
    expect(drawn.covers(2)).toBe(false);
    // an empty desk's arrival is the prototype's: centred on its origin at zoom 1 (core's own would be its identity)
    const empty = d.mat(300, 200, 200, 160);
    d.step(3);
    d.build();
    expect(must(d.builder.navFace(empty, CAM)).arrival).toEqual({ x: -VP.width / 2, y: -VP.height / 2, zoom: 1 });
    // inside the mat (the frame's own container is not drawn), the seam answers at REST — the lift pin no longer draws
    d.ce.ops.enterContainer(d.m, { transition: "none" });
    d.step(2);
    d.build(d.camera());
    expect(must(d.builder.navFace(d.m, CAM)).face).toEqual(staticFace);
  });
});

describe("the flight from the world (design-006; PORTAL.md §2.4)", () => {
  it("an enter draws the departed desk under the departed camera as one tree through the face, dressed for the cut; the arriving desk for its landing", () => {
    const d = nested();
    d.settle();
    d.world.addTag(d.root, Selected);
    d.step();
    d.settle();
    const camPre = d.camera();
    d.ce.ops.enterContainer(d.m);
    d.step();   // the cut frame: the flight holds at p = 0
    const t = must(d.world.getResource(NavTransition));
    expect(t.active).toBe(true);
    expect(t.p).toBe(0);
    const f = d.build(d.camera());
    // the arriving desk: the mat's children, through the face (the clip), whole at presence 1, dressed for the landing
    expect(f.objects.map((o) => o.kind)).toEqual(["minimat", "paper", "paper"]);
    expect(f.present?.portal).toBeDefined();
    expect(f.present?.objects).toBe(1);
    expect(f.lodZoom).toBe(t.c1z);
    expect(f.light).toMatchObject({ a: camPre, t: 0 });
    // the departed desk: the root's Retained widgets under the pre-cut camera (bit for bit at the cut), the mat at `at`, dressed for the cut
    const out = must(f.outgoing);
    expect(out.order).toBe("under");
    expect(out.at).toBe(0);
    expect(out.objects?.map((o) => o.kind)).toEqual(["minimat", "paper"]);
    expect([out.view.camX, out.view.camY, out.view.zoom]).toEqual([camPre.x, camPre.y, camPre.zoom]);
    expect(out.lodZoom).toBe(camPre.zoom);
    expect(d.world.hasTag(d.root, Retained)).toBe(true);
    // the departed desk's own live portal at the mat is not built again: the arriving desk IS that face
    expect(out.portals).toBeUndefined();
    // the cut frame is exact: the arriving camera is the drawn face's own (the seam's camera), the mat now a departed-slot member
    const G = d.builder.geometryOf(d.m) as MiniMatGeometry;
    expect(faceOf(G)).toEqual({ x: 700 - 320 + 32, y: 400 - 240 + 32, width: 640 - 64, height: 480 - 64 });
    const M = portalAffine(visibleRect({ x: t.c1x, y: t.c1y, zoom: t.c1z }, VP.width, VP.height), faceOf(G));
    expect(d.camera()).toEqual(outgoingCamera(M, camPre));
  });

  it("the cut frame holds every spring (D-D2b.7): the departed desk IS its pre-cut frame; the next frame moves again", () => {
    const d = nested();
    d.settle();
    // the lift (a Grab): the spring that is left since D6 — the ring's went with the retired ring
    d.world.addComponent(d.root, Grab, { x: 100, y: 500, w: 200, h: 200, parent: NO_ENTITY, prev: NO_ENTITY, ord: 0 });
    d.world.sync();
    d.step();
    d.build();   // the lift starts rising
    d.build();
    const liftBefore = must(d.builder.fluxOf(d.root)).lift;
    expect(liftBefore).toBeGreaterThan(0);
    expect(liftBefore).toBeLessThan(1);
    d.ce.ops.enterContainer(d.m);   // beforeSwitch cancels the gestures: the Grab goes, the lift's target is 0 now
    d.step();
    expect(must(d.world.getResource(NavTransition)).p).toBe(0);
    d.build(d.camera());
    expect(must(d.builder.fluxOf(d.root)).lift).toBe(liftBefore);   // held
    d.step();
    expect(must(d.world.getResource(NavTransition)).p).toBeGreaterThan(0);
    d.build(d.camera());
    expect(must(d.builder.fluxOf(d.root)).lift).not.toBe(liftBefore);   // moving again (its momentum carries it up before it turns for 0)
  });
});

describe("the re-dressing after a zoom-through cut (PORTAL.md §9)", () => {
  it("eases the dressing in log space over 320 ms from the zoom the desk was dressed for, the lamp on the same ramp; a hold keeps it at the start", () => {
    const d = nested();
    d.settle();
    d.ce.ops.enterContainer(d.m, { transition: "cut" });
    d.step();
    const cam = d.camera();
    writeRuntimeResource(d.world, NavRedress, { kind: "in", from: 0.5, frame: d.m, epoch: 1 });
    const f0 = d.build(cam);
    expect(f0.lodZoom).toBe(0.5);   // the cut frame renders at `from` exactly
    expect(f0.light).toMatchObject({ b: cam, t: 0 });
    expect(d.builder.live()).toBe(true);
    // halfway through the ramp: smoothstep(0.5) = 0.5 → the log-space midpoint
    d.step(10);   // 160 ms
    const f1 = d.build(cam);
    const u = 0.5 * 0.5 * (3 - 2 * 0.5);
    expect(f1.lodZoom).toBeCloseTo(Math.exp(Math.log(0.5) + (Math.log(cam.zoom) - Math.log(0.5)) * u), 12);
    expect(f1.light?.t).toBeCloseTo(u, 12);
    // the ramp over: the desk's own dressing, no lamp handover, quiet
    d.step(20);
    const f2 = d.build(cam);
    expect(f2.lodZoom).toBeUndefined();
    expect(f2.light).toBeUndefined();
    expect(d.builder.live()).toBe(false);
    // a fresh cut held at its start
    writeRuntimeResource(d.world, NavRedress, { kind: "in", from: 0.25, frame: d.m, epoch: 2 });
    d.step(30);
    const held = d.build(cam, DT, { holdRedress: true });
    expect(held.lodZoom).toBe(0.25);
    expect(held.light?.t).toBe(0);
  });

  it("a cut OUT re-dresses the mini mat's live inside from the camera it was cut at, lit by its own lamp handed to the host's", () => {
    const d = nested();
    d.settle();
    writeRuntimeResource(d.world, NavRedress, { kind: "out", from: 3, frame: d.m, epoch: 1 });
    const f0 = d.build();
    const p0 = must(f0.portals[0]);
    expect(p0.lodZoom).toBe(3);
    expect(p0.light).toMatchObject({ a: { x: p0.view.camX, y: p0.view.camY, zoom: p0.view.zoom }, b: CAM, t: 0 });
    d.step(30);
    const p1 = must(d.build().portals[0]);
    expect(p1.lodZoom).toBe(must(d.builder.insideViewOf(d.m)).arrival.zoom);
    expect(p1.light).toBeUndefined();
  });
});
