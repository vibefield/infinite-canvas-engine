// @vitest-environment node
// The ZOOM-THROUGH (design-015 §9, PORTAL.md §8; D2b) through the real stack and the facade's
// post-tick applier: a wheel zoom IN that leaves a container's face covering the view by 2 CSS px
// cuts into it — no flight, the camera lands on the continuity camera (the inside was already
// rendering there), and the re-dressing fact says the desk entered was dressed for its arrival;
// a wheel zoom OUT that leaves the frame's face 6 px short of covering cuts back out onto the
// parent camera the inside renders as it does now. No cut while a flight drives. Off by default.
import { outgoingCamera, portalAffine, solveFlightStart, visibleRect } from "@ice/kernel";
import { describe, expect, it } from "vitest";
import {
  Camera,
  NO_MODS,
  NavIntent,
  NavRedress,
  NavTransition,
  Viewport,
  createCanvasEngine,
  defaultArrivalCamera,
  defineWidget,
  staticFace,
  widgets,
} from "../src";

// One widget type per FILE (global registry; no test reset).
const FOLDER =
  widgets.get("zt:folder") ??
  defineWidget({ type: "zt:folder", surface: "dom", component: null, defaultSize: { w: 200, h: 200 }, container: { accepts: ["widget"], portal: { top: 10, right: 10, bottom: 10, left: 10 } } });
const BOX =
  widgets.get("zt:box") ??
  defineWidget({ type: "zt:box", surface: "dom", component: null, defaultSize: { w: 100, h: 100 }, provides: ["widget"] });

const VP = { w: 800, h: 600, dpr: 1 };

function rig(opts: { through?: boolean } = {}) {
  const ce = createCanvasEngine({
    widgets: [FOLDER, BOX],
    settings: { gestures: { wheel: "zoom" }, ...(opts.through === false ? {} : { nav: { zoomThrough: { enabled: true } } }) },
  });
  ce.docs.create();
  ce.world.setResource(Viewport, VP);
  ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  // the folder's face (310, 210, 180×180) is centred on the view's centre (400, 300): a zoom about that point grows it in place
  const folder = ce.ops.spawnWidget("zt:folder", { x: 300, y: 200, w: 200, h: 200, undoable: false });
  ce.world.sync();
  let now = 1000;
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; ce.step(now); } };
  step(2);
  ce.ops.spawnWidget("zt:box", { x: 10, y: 10, w: 50, h: 50, parent: folder, undoable: false });
  ce.world.sync();
  step(5);
  const wheel = (dy: number, x = 400, y = 300): void => {
    ce.stack.queue.enqueue({ kind: "wheel", pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons: 0, mods: NO_MODS, wheel: { dx: 0, dy, pinch: 0 } });
    step();
  };
  const cam = () => { const c = ce.world.getResource(Camera); if (c === undefined) throw new Error("no camera"); return { x: c.x, y: c.y, zoom: c.zoom }; };
  const nav = () => { const t = ce.world.getResource(NavTransition); if (t === undefined) throw new Error("no NavTransition"); return t; };
  /** The face's embedding M: inside → parent, from the static face and the default framing (no renderer is mounted here). */
  const M = () => {
    const face = staticFace(ce.world, folder);
    if (face === undefined) throw new Error("no face");
    return portalAffine(visibleRect(defaultArrivalCamera(ce.world, folder), VP.w, VP.h), face);
  };
  return { ce, world: ce.world, step, wheel, cam, nav, M, folder, depth: () => ce.nav.depth() };
}

describe("the zoom-through (design-015 §9; D-D2b.3, .4)", () => {
  it("a wheel zoom in that leaves the face covering the view cuts into it: no flight, the continuity camera, the re-dressing fact", () => {
    const r = rig();
    let wheels = 0;
    while (r.depth() === 0 && wheels < 20) { r.wheel(-120); wheels += 1; }
    expect(r.depth()).toBe(1);
    // exp(120 · 0.0016) ≈ ×1.21 per wheel: the 180 px face covers the 800 px view (by 2) from zoom ≈ 4.47 — the 8th wheel
    expect(wheels).toBe(8);
    const t = r.nav();
    expect(t.active).toBe(false);   // a cut, not a flight
    expect(t.kind).toBe("enter");
    // the camera at the cut: outgoingCamera(M, camPre) — the camera the inside was already rendering under through the face
    const camPre = { x: t.fromX, y: t.fromY, zoom: t.fromZ };
    expect(camPre.zoom).toBeGreaterThan(4.4);
    expect(r.cam()).toEqual(outgoingCamera(r.M(), camPre));
    // the request rode the one-tick fact, applied after the tick
    expect(r.world.getResource(NavIntent)).toMatchObject({ kind: "enter", target: r.folder, transition: "cut", source: "through" });
    // the desk entered was dressed for its arrival as a face: the renderer re-dresses from there (the cut op states it)
    const arrival = defaultArrivalCamera(r.world, r.folder);
    expect(r.world.getResource(NavRedress)).toMatchObject({ kind: "in", from: arrival.zoom, frame: r.folder, epoch: 1 });
  });

  it("a wheel zoom out that leaves the frame's face short of covering cuts back out onto the parent camera", () => {
    const r = rig();
    for (let i = 0; i < 20 && r.depth() === 0; i++) r.wheel(-120);
    expect(r.depth()).toBe(1);
    const M = r.M();
    let wheels = 0;
    while (r.depth() === 1 && wheels < 20) { r.wheel(120); wheels += 1; }
    expect(r.depth()).toBe(0);
    const t = r.nav();
    expect(t.active).toBe(false);
    expect(t.kind).toBe("exit");
    const camInside = { x: t.fromX, y: t.fromY, zoom: t.fromZ };
    expect(r.cam()).toEqual(solveFlightStart(M, camInside));
    expect(r.world.getResource(NavRedress)).toMatchObject({ kind: "out", from: camInside.zoom, frame: r.folder, epoch: 2 });
    // and the parent camera it landed on shows the face NOT covering the view by 6 px (the dead band's other edge)
    const face = staticFace(r.world, r.folder);
    if (face === undefined) throw new Error("no face");
    const c = r.cam();
    const x0 = (face.x - c.x) * c.zoom;
    const x1 = x0 + face.width * c.zoom;
    const y0 = (face.y - c.y) * c.zoom;
    const y1 = y0 + face.height * c.zoom;
    expect(x0 <= -6 && y0 <= -6 && x1 >= VP.w + 6 && y1 >= VP.h + 6).toBe(false);
  });

  it("no cut while a flight drives: the wheel that yields the flight does not also cut", () => {
    const r = rig();
    r.ce.ops.enterContainer(r.folder);
    expect(r.nav().active).toBe(true);
    r.step();
    const epoch = r.world.getResource(NavIntent)?.epoch ?? 0;
    r.wheel(120);
    // the flight yielded to the gesture this tick (touch wins) — and the zoom-through, which ran before it saw the yield, asked nothing
    expect(r.nav().active).toBe(false);
    expect(r.world.getResource(NavIntent)?.epoch ?? 0).toBe(epoch);
    expect(r.depth()).toBe(1);
  });

  it("off unless the app says: the same wheels on a default engine enter nothing", () => {
    const r = rig({ through: false });
    for (let i = 0; i < 12; i++) r.wheel(-120);
    expect(r.depth()).toBe(0);
    expect(r.world.getResource(NavIntent)).toBeUndefined();
  });
});
