// @vitest-environment node
// The NAV GEOMETRY seam (design-015 §9; D2b): the renderer's word on a container's DRAWN face
// beside `framePick`. Without a source, core computes from the static portal rect and the
// default framing (the fallback, unchanged for every app that mounts none). With one, an enter
// starts from the source's exact camera — the face as drawn, springs included — and lands on
// the source's arrival (an empty desk's is the prototype's, not core's identity); an op's own
// `NavOpts` overrides outrank both. `transition: "cut"` moves nothing and lands on the
// continuity camera (the zoom-through's cut), in and out. `NavCamera.zoom` is f64: a return
// pose taken from a flight's arrival survives the round trip.
import { invertAffine, outgoingCamera, portalAffine, solveFlightStart, visibleRect } from "@ice/kernel";
import { describe, expect, it } from "vitest";
import {
  Camera,
  NavCamera,
  NavRedress,
  NavTransition,
  Viewport,
  createCanvasEngine,
  currentNavEntry,
  defineWidget,
  fallbackNavFace,
  type NavGeometrySource,
  resolveNavFace,
  smoothstep,
  widgets,
} from "../src";

// One widget type per FILE (global registry; no test reset).
const FOLDER =
  widgets.get("navg:folder") ??
  defineWidget({ type: "navg:folder", surface: "dom", component: null, defaultSize: { w: 200, h: 200 }, container: { accepts: ["widget"], provides: ["widget"], portal: { top: 10, right: 10, bottom: 10, left: 10 } } });
const BOX =
  widgets.get("navg:box") ??
  defineWidget({ type: "navg:box", surface: "dom", component: null, defaultSize: { w: 100, h: 100 }, provides: ["widget"] });

const VP = { w: 800, h: 600, dpr: 1 };
/** The static face: the folder's body (300, 200, 200×200) inset by its portal (10). */
const STATIC_FACE = { x: 310, y: 210, width: 180, height: 180 };

function rig(opts: { inner?: boolean } = {}) {
  const ce = createCanvasEngine({ widgets: [FOLDER, BOX] });
  ce.docs.create();
  ce.world.setResource(Viewport, VP);
  const folder = ce.ops.spawnWidget("navg:folder", { x: 300, y: 200, w: 200, h: 200, undoable: false });
  ce.world.sync();
  let now = 0;
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; ce.step(now); } };
  step(2); // the container compiles on a tick before it takes children
  let inner: number | undefined;
  if (opts.inner !== false) {
    inner = ce.ops.spawnWidget("navg:box", { x: 10, y: 10, w: 50, h: 50, parent: folder, undoable: false }) as number;
    ce.world.sync();
  }
  step(5);
  const cam = () => { const c = ce.world.getResource(Camera); if (c === undefined) throw new Error("no camera"); return { x: c.x, y: c.y, zoom: c.zoom }; };
  const nav = () => { const t = ce.world.getResource(NavTransition); if (t === undefined) throw new Error("no NavTransition"); return t; };
  return { ce, world: ce.world, step, cam, nav, folder, inner };
}

/** A source that says the face is DRAWN LIFTED (grown by 10 on every side) and the inside arrives on the prototype's empty-desk camera. */
function liftedSource(): NavGeometrySource & { readonly face0: { x: number; y: number; width: number; height: number }; readonly arrival0: { x: number; y: number; zoom: number } } {
  const face0 = { x: 300, y: 200, width: 200, height: 200 };
  const arrival0 = { x: -VP.w / 2, y: -VP.h / 2, zoom: 1 };
  return {
    face0,
    arrival0,
    face(_container, cam) {
      const affine = portalAffine(visibleRect(arrival0, VP.w, VP.h), face0);
      return { face: face0, arrival: arrival0, affine, camera: outgoingCamera(affine, cam), presence: 1, covers: () => false };
    },
  };
}

describe("the fallback — core's own word on a container with no renderer's (design-015 §9)", () => {
  it("is the static portal rect, the default framing, the gate on the face's short side and a sharp-cornered cover test", () => {
    const r = rig({ inner: false });
    const cam = { x: 0, y: 0, zoom: 1 };
    const f = fallbackNavFace(r.world, r.folder, cam);
    if (f === undefined) throw new Error("no face");
    expect(f.face).toEqual(STATIC_FACE);
    // an EMPTY frame's default framing is core's identity (0, 0, 1) — the seam is how a renderer says otherwise
    expect(f.arrival).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(f.affine).toEqual(portalAffine(visibleRect(f.arrival, VP.w, VP.h), STATIC_FACE));
    expect(f.camera).toEqual(outgoingCamera(f.affine, cam));
    // the gate: 180 px short side at zoom 1 → between 140 and 220
    expect(f.presence).toBeCloseTo(smoothstep(140, 220, 180), 12);
    expect(f.presence).toBeGreaterThan(0);
    expect(f.presence).toBeLessThan(1);
    // the cover test: at zoom 1 the face is 180 px in an 800×600 view — it covers nothing
    expect(f.covers(2)).toBe(false);
    // zoomed so the face fills the view with 30 px to spare on every side (its left and top edges 30 px OUTSIDE the view): covers by 2, by 29, not by 31
    const zoom = (VP.w + 60) / STATIC_FACE.width;
    const camIn = { x: STATIC_FACE.x + 30 / zoom, y: STATIC_FACE.y + 30 / zoom, zoom };
    const g = fallbackNavFace(r.world, r.folder, camIn);
    if (g === undefined) throw new Error("no face");
    expect(g.covers(2)).toBe(true);
    expect(g.covers(29)).toBe(true);
    expect(g.covers(31)).toBe(false);
    expect(g.presence).toBe(1);
  });

  it("resolveNavFace asks the mounted source first and falls back when it has no word", () => {
    const r = rig({ inner: false });
    const cam = { x: 0, y: 0, zoom: 1 };
    const slot = r.ce.stack.navGeometry;
    expect(slot.current).toBeNull();
    expect(resolveNavFace(r.world, r.folder, cam, slot)?.face).toEqual(STATIC_FACE);
    const src = liftedSource();
    slot.current = src;
    expect(resolveNavFace(r.world, r.folder, cam, slot)?.face).toEqual(src.face0);
    slot.current = { face: () => undefined };
    expect(resolveNavFace(r.world, r.folder, cam, slot)?.face).toEqual(STATIC_FACE);
    slot.current = null;
  });
});

describe("an enter through the seam (the cut is exact only on the face AS DRAWN)", () => {
  it("starts the flight from the source's exact camera and lands on the source's arrival; the affine is the drawn face's", () => {
    const r = rig({ inner: false });
    const src = liftedSource();
    r.ce.stack.navGeometry.current = src;
    const camPre = r.cam();
    r.ce.ops.enterContainer(r.folder);
    const t = r.nav();
    expect(t.active).toBe(true);
    const M = portalAffine(visibleRect(src.arrival0, VP.w, VP.h), src.face0);
    const A = invertAffine(M);
    // the arrival is the SOURCE's (the prototype's empty desk: centred on its origin at zoom 1), not core's identity
    expect([t.c1x, t.c1y, t.c1z]).toEqual([src.arrival0.x, src.arrival0.y, 1]);
    // the start IS the drawn face's camera, bit for bit
    const c0 = outgoingCamera(M, camPre);
    expect([t.c0x, t.c0y, t.c0z]).toEqual([c0.x, c0.y, c0.zoom]);
    expect(r.cam()).toEqual(c0);
    expect([t.as, t.aox, t.aoy]).toEqual([A.s, A.ox, A.oy]);
    r.ce.stack.navGeometry.current = null;
  });

  it("an op's own overrides — face, arrival, c0 — outrank the source", () => {
    const r = rig({ inner: false });
    r.ce.stack.navGeometry.current = liftedSource();
    const face = { x: 320, y: 220, width: 160, height: 160 };
    const arrival = { x: -100, y: -50, zoom: 0.75 };
    const c0 = { x: 1, y: 2, zoom: 3 };
    r.ce.ops.enterContainer(r.folder, { face, arrival, c0 });
    const t = r.nav();
    expect([t.c1x, t.c1y, t.c1z]).toEqual([arrival.x, arrival.y, arrival.zoom]);
    expect([t.c0x, t.c0y, t.c0z]).toEqual([c0.x, c0.y, c0.zoom]);
    const A = invertAffine(portalAffine(visibleRect(arrival, VP.w, VP.h), face));
    expect([t.as, t.aox, t.aoy]).toEqual([A.s, A.ox, A.oy]);
    r.ce.stack.navGeometry.current = null;
  });

  it("without a source the enter is what it was: the static face, the default framing, outgoingCamera(M, cam)", () => {
    const r = rig();
    const camPre = r.cam();
    r.ce.ops.enterContainer(r.folder);
    const t = r.nav();
    const c1 = { x: t.c1x, y: t.c1y, zoom: t.c1z };
    const M = portalAffine(visibleRect(c1, VP.w, VP.h), STATIC_FACE);
    expect(r.cam()).toEqual(outgoingCamera(M, camPre));
    const A = invertAffine(M);
    expect([t.as, t.aox, t.aoy]).toEqual([A.s, A.ox, A.oy]);
  });
});

describe("`transition: \"cut\"` — the zoom-through's cut lands on the continuity camera, no motion", () => {
  it("in: the camera lands on c0 (not the arrival) with no flight; out: on solveFlightStart(A, camPre)", () => {
    const r = rig({ inner: false });
    const src = liftedSource();
    r.ce.stack.navGeometry.current = src;
    const camPre = { x: 200, y: 100, zoom: 3 };
    r.ce.world.setResource(Camera, { ...camPre, gesturing: false });
    r.ce.ops.enterContainer(r.folder, { transition: "cut" });
    const M = portalAffine(visibleRect(src.arrival0, VP.w, VP.h), src.face0);
    const c0 = outgoingCamera(M, camPre);
    expect(r.cam()).toEqual(c0);
    expect(r.nav().active).toBe(false);
    expect(r.nav().kind).toBe("enter");
    expect(r.ce.nav.depth()).toBe(1);
    // the cut states the re-dressing itself: the desk entered was dressed for its arrival as a face
    expect(r.world.getResource(NavRedress)).toMatchObject({ kind: "in", from: src.arrival0.zoom, frame: r.folder, epoch: 1 });
    // and a "none" would have landed on the arrival — the two are different cameras here
    expect(c0).not.toEqual(src.arrival0);
    // out as a cut: the parent camera under which the inside renders as it does now
    const camInside = { x: c0.x + 40, y: c0.y + 30, zoom: c0.zoom * 1.5 };
    r.ce.world.setResource(Camera, { ...camInside, gesturing: false });
    r.ce.ops.exitContainer({ transition: "cut" });
    expect(r.ce.nav.depth()).toBe(0);
    expect(r.nav().active).toBe(false);
    expect(r.cam()).toEqual(solveFlightStart(M, camInside));
    // and the desk left, the live inside of the folder now, was dressed for the camera it was cut at
    expect(r.world.getResource(NavRedress)).toMatchObject({ kind: "out", from: camInside.zoom, frame: r.folder, epoch: 2 });
    r.ce.stack.navGeometry.current = null;
  });

  it("`none` still lands on the arrival (the old callers' cut)", () => {
    const r = rig({ inner: false });
    r.ce.ops.enterContainer(r.folder, { transition: "none" });
    expect(r.cam()).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(r.nav().active).toBe(false);
  });
});

describe("NavCamera.zoom is f64 (D2b)", () => {
  it("a return pose taken from a flight's arrival survives the round trip exactly", () => {
    const r = rig({ inner: false });
    // content 900 wide → the arrival zoom is 800/(900+160) ≈ 0.7547, inside the natural band and NOT an f32 number
    r.ce.ops.spawnWidget("navg:box", { x: 0, y: 0, w: 900, h: 300, parent: r.folder, undoable: false });
    const deeper = r.ce.ops.spawnWidget("navg:folder", { x: 100, y: 50, w: 200, h: 200, parent: r.folder, undoable: false });
    r.ce.world.sync();
    r.step(3);
    r.ce.ops.enterContainer(r.folder);
    const t = r.nav();
    expect(t.active).toBe(true);
    expect(Math.fround(t.c1z)).not.toBe(t.c1z);
    // a flight is driving: the deeper entry saves the ARRIVAL as its return pose (§6.2 rev 2)
    r.step(2);
    r.ce.ops.enterContainer(deeper);
    const entry = currentNavEntry(r.world);
    if (entry === undefined) throw new Error("no entry");
    expect(r.world.read(entry, NavCamera).zoom).toBe(t.c1z);
  });
});
