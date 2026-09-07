// @vitest-environment node
// The flight's descriptor and its two B7 rules (design-013 §8 B7, D-B7.1): the resource carries
// the DEPARTED frame's camera at the cut and `departedCameraOf` returns it bit for bit at p = 0
// and while frozen (`outgoingCamera` through the affine otherwise); an enter STARTS from the
// live portal's exact camera — `outgoingCamera(M, camPre)` — and the first tick after the cut
// HOLDS at p = 0 so one product frame is the cut frame; the departed frame's cards are
// `Retained` for the flight and released at the landing, on a gesture's yield and on abort; the
// landing is exact.
import { outgoingCamera, portalAffine, solveFlightStart, visibleRect } from "@ice/kernel";
import { describe, expect, it } from "vitest";
import {
  Camera,
  NavTransition,
  Retained,
  Viewport,
  abortNavFlight,
  createCanvasEngine,
  defineWidget,
  departedCameraOf,
  widgets,
} from "../src";

// One widget type per FILE (global registry; no test reset).
const FOLDER =
  widgets.get("navf:folder") ??
  defineWidget({ type: "navf:folder", surface: "dom", component: null, defaultSize: { w: 200, h: 200 }, container: { accepts: ["widget"] } });
const BOX =
  widgets.get("navf:box") ??
  defineWidget({ type: "navf:box", surface: "dom", component: null, defaultSize: { w: 100, h: 100 }, provides: ["widget"] });

const VP = { w: 800, h: 600, dpr: 1 };

function rig() {
  const ce = createCanvasEngine({ widgets: [FOLDER, BOX] });
  ce.docs.create();
  ce.world.setResource(Viewport, VP);
  const folder = ce.ops.spawnWidget("navf:folder", { x: 300, y: 200, w: 200, h: 200, undoable: false });
  const a = ce.ops.spawnWidget("navf:box", { x: 0, y: 0, w: 100, h: 100, undoable: false });
  const b = ce.ops.spawnWidget("navf:box", { x: 600, y: 400, w: 100, h: 100, undoable: false });
  ce.world.sync();
  let now = 0;
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; ce.step(now); } };
  step(2); // the container compiles on a tick before it takes children
  const inner = ce.ops.spawnWidget("navf:box", { x: 10, y: 10, w: 50, h: 50, parent: folder, undoable: false });
  ce.world.sync();
  step(5);
  const cam = () => { const c = ce.world.getResource(Camera); if (c === undefined) throw new Error("no camera"); return { x: c.x, y: c.y, zoom: c.zoom }; };
  const nav = () => { const t = ce.world.getResource(NavTransition); if (t === undefined) throw new Error("no NavTransition"); return t; };
  const retained = (e: number) => ce.world.hasTag(e as never, Retained);
  const settle = (): number => { let n = 0; while (nav().active && n < 600) { step(); n += 1; } return n; };
  return { ce, world: ce.world, step, cam, nav, retained, settle, folder, a, b, inner };
}

describe("the flight's descriptor (B7)", () => {
  it("an enter starts from the live portal's exact camera, records the pre-cut camera, holds one tick at p = 0, and lands exactly", () => {
    const r = rig();
    const camPre = r.cam();
    r.ce.ops.enterContainer(r.folder);
    const t = r.nav();
    expect(t.active).toBe(true);
    expect(t.kind).toBe("enter");
    // the departed frame's camera at the cut, bit for bit
    expect([t.fromX, t.fromY, t.fromZ]).toEqual([camPre.x, camPre.y, camPre.zoom]);
    // the start IS the portal's camera: outgoingCamera(M, camPre) with M the child's arrival view onto the container's face
    const c1 = { x: t.c1x, y: t.c1y, zoom: t.c1z };
    const K = { x: 300, y: 200, width: 200, height: 200 };
    const M = portalAffine(visibleRect(c1, VP.w, VP.h), K);
    const c0 = r.cam();
    expect(c0).toEqual(outgoingCamera(M, camPre));
    expect([t.c0x, t.c0y, t.c0z]).toEqual([c0.x, c0.y, c0.zoom]);
    // the continuity solve's twin is the same number to within an ulp — the rule picks the portal's, not the solve's
    const twin = solveFlightStart({ s: t.as, ox: t.aox, oy: t.aoy }, camPre);
    expect(Math.abs(twin.zoom - c0.zoom)).toBeLessThan(1e-9);
    // departedCameraOf at the cut: the pre-cut camera itself
    expect(departedCameraOf(t, c0)).toEqual(camPre);
    // the first tick HOLDS: one product frame at p = 0 with the camera at c0
    r.step();
    const held = r.nav();
    expect(held.p).toBe(0);
    expect(held.ticks).toBe(1);
    expect(r.cam()).toEqual(c0);
    // then the spring runs: p > 0, the camera moved, the departed camera rides the affine
    r.step();
    const t2 = r.nav();
    expect(t2.p).toBeGreaterThan(0);
    const c2 = r.cam();
    expect(c2).not.toEqual(c0);
    expect(departedCameraOf(t2, c2)).toEqual(outgoingCamera({ s: t2.as, ox: t2.aox, oy: t2.aoy }, c2));
    // the landing is exact
    r.settle();
    expect(r.nav().active).toBe(false);
    expect(r.cam()).toEqual(c1);
    r.ce.dispose();
  });

  it("frozen: the departed camera is the pre-cut camera throughout", () => {
    const t = { frozen: true, c0x: 5, c0y: 6, c0z: 0.5, fromX: 1, fromY: 2, fromZ: 3, as: 2, aox: 10, aoy: 20 };
    expect(departedCameraOf(t, { x: 99, y: 98, zoom: 0.7 })).toEqual({ x: 1, y: 2, zoom: 3 });
    expect(departedCameraOf({ ...t, frozen: false }, { x: 99, y: 98, zoom: 0.7 })).toEqual(outgoingCamera({ s: 2, ox: 10, oy: 20 }, { x: 99, y: 98, zoom: 0.7 }));
    expect(departedCameraOf({ ...t, frozen: false }, { x: 5, y: 6, zoom: 0.5 })).toEqual({ x: 1, y: 2, zoom: 3 });
  });

  it("the departed frame's cards are Retained for the flight and released at the landing; the inside's on exit", () => {
    const r = rig();
    expect(r.retained(r.a)).toBe(false);
    r.ce.ops.enterContainer(r.folder);
    // the root's cards (the departed frame) are retained; the inside's are not
    expect(r.retained(r.a)).toBe(true);
    expect(r.retained(r.b)).toBe(true);
    expect(r.retained(r.folder)).toBe(true);
    expect(r.retained(r.inner)).toBe(false);
    r.step(3);
    expect(r.retained(r.a)).toBe(true);
    r.settle();
    expect(r.retained(r.a)).toBe(false);
    expect(r.retained(r.b)).toBe(false);
    expect(r.retained(r.folder)).toBe(false);
    // exit: the inside is the departed frame
    const innerCam = r.cam();
    r.ce.ops.exitContainer();
    const t = r.nav();
    expect(t.kind).toBe("exit");
    expect([t.fromX, t.fromY, t.fromZ]).toEqual([innerCam.x, innerCam.y, innerCam.zoom]);
    expect(r.retained(r.inner)).toBe(true);
    expect(r.retained(r.a)).toBe(false);
    r.settle();
    expect(r.retained(r.inner)).toBe(false);
    r.ce.dispose();
  });

  it("an abort releases the retained set (a gesture's yield takes the same path inside the tick)", () => {
    // `Camera.gesturing` is the camera-sim system's fact (a raw resource write is overwritten before the
    // nav tick reads it), so the yield is not driven here; it releases through the tick's one `release()`.
    const r = rig();
    r.ce.ops.enterContainer(r.folder);
    r.step(2);
    expect(r.retained(r.a)).toBe(true);
    abortNavFlight(r.world);
    expect(r.nav().active).toBe(false);
    expect(r.retained(r.a)).toBe(false);
    r.settle();
    r.ce.ops.exitContainer();
    expect(r.retained(r.inner)).toBe(true);
    abortNavFlight(r.world);
    expect(r.nav().active).toBe(false);
    expect(r.retained(r.inner)).toBe(false);
    r.ce.dispose();
  });
});
