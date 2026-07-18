/**
 * Natural default framing (2026-07-18, James: "do zoom to fit, but with a
 * upper and bottom cap … should feel natural"): ops.frameContent and the
 * folder arrival camera share kernel fitCamera + the FIT_DEFAULTS band
 * (∩ CameraLimits). Pinned:
 *  - frameContent caps at 100% for small content (no card-fills-the-screen),
 *    floors at 50% for huge content, centers either way;
 *  - it returns false (camera untouched) without viewport or content;
 *  - the folder ARRIVAL camera honors the same caps (a folder holding one
 *    small card arrives at 100%, not ~350%);
 *  - ops.zoomToFit stays UNCAPPED below the band (explicit fit-all).
 */
import { describe, expect, it } from "vitest";
import { Camera, ChildOf, Viewport, createCanvasEngine, defineWidget, widgets } from "../src";

// One widget type per FILE (global registry; no test reset).
const BOX =
  widgets.get("ff:box") ??
  defineWidget({
    type: "ff:box",
    surface: "dom",
    component: null,
    defaultSize: { w: 100, h: 100 },
  });
const FOLDER =
  widgets.get("ff:folder") ??
  defineWidget({
    type: "ff:folder",
    surface: "dom",
    component: null,
    defaultSize: { w: 200, h: 200 },
    container: { accepts: ["widget"] },
  });

function makeEngine() {
  const ce = createCanvasEngine({ widgets: [BOX, FOLDER] });
  ce.docs.create();
  ce.world.setResource(Viewport, { w: 1600, h: 900, dpr: 1 });
  let now = 0;
  const step = (n = 1): void => {
    for (let i = 0; i < n; i++) {
      now += 16;
      ce.step(now);
    }
  };
  return { ce, step };
}

describe("ops.frameContent", () => {
  it("small content caps at 100%, centered", () => {
    const { ce, step } = makeEngine();
    ce.ops.spawnWidget("ff:box", { x: 500, y: 500, w: 100, h: 100, undoable: false });
    ce.world.sync();
    step(5); // membership stamps Active
    expect(ce.ops.frameContent()).toBe(true);
    const cam = ce.world.getResource(Camera);
    expect(cam?.zoom).toBe(1); // uncapped fit ≈ 3.46
    expect(cam?.x).toBe(550 - 800);
    expect(cam?.y).toBe(550 - 450);
    ce.dispose();
  });

  it("huge content floors at 50%", () => {
    const { ce, step } = makeEngine();
    ce.ops.spawnWidget("ff:box", { x: 0, y: 0, w: 100, h: 100, undoable: false });
    ce.ops.spawnWidget("ff:box", { x: 9900, y: 4900, w: 100, h: 100, undoable: false });
    ce.world.sync();
    step(5);
    expect(ce.ops.frameContent()).toBe(true);
    expect(ce.world.getResource(Camera)?.zoom).toBe(0.5); // uncapped ≈ 0.157
    ce.dispose();
  });

  it("returns false with no content; camera untouched", () => {
    const { ce, step } = makeEngine();
    step(2);
    expect(ce.ops.frameContent()).toBe(false);
    expect(ce.world.getResource(Camera)).toEqual({ x: 0, y: 0, zoom: 1, gesturing: false });
    ce.dispose();
  });

  it("ops.zoomToFit stays uncapped (explicit fit-all beats natural)", () => {
    const { ce, step } = makeEngine();
    ce.ops.spawnWidget("ff:box", { x: 0, y: 0, w: 100, h: 100, undoable: false });
    ce.ops.spawnWidget("ff:box", { x: 9900, y: 4900, w: 100, h: 100, undoable: false });
    ce.world.sync();
    step(5);
    ce.ops.zoomToFit();
    const z = ce.world.getResource(Camera)?.zoom ?? 0;
    expect(z).toBeLessThan(0.2); // true fit, below the natural floor
    ce.dispose();
  });
});

describe("folder arrival camera honors the natural band", () => {
  it("a folder holding ONE small card arrives at 100%, centered on it", () => {
    const { ce, step } = makeEngine();
    const folder = ce.ops.spawnWidget("ff:folder", { x: 0, y: 0, w: 200, h: 200, undoable: false });
    const child = ce.ops.spawnWidget("ff:box", { x: 40, y: 40, w: 100, h: 100, undoable: false });
    ce.world.sync();
    step(5);
    // Runtime reparent (consume shape): child into the folder's frame at
    // local (40,40) — arrival math only reads the ChildOf edge + rects.
    ce.world.setRelation(child, ChildOf, folder);
    step(3);
    ce.ops.enterContainer(folder, { transition: "none" });
    step(3);
    const cam = ce.world.getResource(Camera);
    expect(cam?.zoom).toBe(1); // uncapped fit ≈ min(1600/260, 900/260) ≈ 3.46
    expect(cam?.x).toBe(90 - 800); // child center (90,90) centered
    expect(cam?.y).toBe(90 - 450);
    ce.dispose();
  });
});
