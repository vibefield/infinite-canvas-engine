/**
 * Nav-tick zombie regression (field bug 2026-07-17, widgetlab folders):
 * entering a container snaps the camera to the flight start (a far-zoomed-out
 * window that can span the DEPARTING frame's coords) in the same tick the
 * membership resweep strips Active from the departing widgets. Tag flips
 * flush at the derive boundary, so cull's full pass used to classify against
 * STALE Active tags and re-tag a root-culled widget Visible while ¬Active —
 * a zombie: rendered at frame-local-nonsense coords, unpickable, repaired by
 * nobody (membership sees no input churn; cull only touches Active).
 *
 * Fix under test: cull SKIPS the nav tick and runs a forced full pass the
 * next tick (mount-store.ts navSkipTick/navHoldFull), plus the mount delta
 * requires Active before marking visible.
 */
import { describe, expect, it } from "vitest";
import { Active, Culled, Viewport, Visible, createCanvasEngine, defineWidget, widgets } from "../src";

// One widget type per FILE (global registry; no test reset).
const FOLDER =
  widgets.get("navz:folder") ??
  defineWidget({
    type: "navz:folder",
    surface: "dom",
    component: null,
    defaultSize: { w: 200, h: 200 },
    container: { accepts: ["widget"] },
  });
const BOX =
  widgets.get("navz:box") ??
  defineWidget({
    type: "navz:box",
    surface: "dom",
    component: null,
    defaultSize: { w: 100, h: 100 },
  });

describe("nav transitions never resurrect departing-frame widgets", () => {
  it("a root-culled widget stays Culled ∧ ¬Visible through an enter flight whose start window covers it", () => {
    const ce = createCanvasEngine({ widgets: [FOLDER, BOX] });
    ce.docs.create();
    ce.world.setResource(Viewport, { w: 800, h: 600, dpr: 1 });
    const folder = ce.ops.spawnWidget("navz:folder", { x: 0, y: 0, w: 200, h: 200, undoable: false });
    // Culled at root (x 2500 > 800 + 200 overscan) but INSIDE the enter
    // flight's start window (zoom ~0.25 ⇒ ~3200 world px wide).
    const box = ce.ops.spawnWidget("navz:box", { x: 2500, y: 0, w: 100, h: 100, undoable: false });
    ce.world.sync();

    let now = 0;
    const step = (n = 1): void => {
      for (let i = 0; i < n; i++) {
        now += 16;
        ce.step(now);
      }
    };
    step(5); // membership + cull settle at root
    expect(ce.world.hasTag(box, Active)).toBe(true);
    expect(ce.world.hasTag(box, Culled)).toBe(true);
    expect(ce.world.hasTag(box, Visible)).toBe(false);

    ce.ops.enterContainer(folder);
    // Through the whole flight AND after settle: never Visible (pre-fix, the
    // stale-Active cull pass re-tagged it Visible on the first tick).
    for (let i = 0; i < 80; i++) {
      step();
      expect(ce.world.hasTag(box, Visible)).toBe(false);
    }
    expect(ce.world.hasTag(box, Active)).toBe(false);
    expect(ce.world.hasTag(box, Culled)).toBe(true);
    const entry = ce.runtime.store.getSnapshot().find((m) => m.entity === box);
    expect(entry === undefined || entry.hidden === true).toBe(true);
    ce.dispose();
  });

  it("exiting restores the root widgets and re-hides the folder's content", () => {
    const ce = createCanvasEngine({ widgets: [FOLDER, BOX] });
    ce.docs.create();
    ce.world.setResource(Viewport, { w: 800, h: 600, dpr: 1 });
    const folder = ce.ops.spawnWidget("navz:folder", { x: 0, y: 0, w: 200, h: 200, undoable: false });
    const rootBox = ce.ops.spawnWidget("navz:box", { x: 300, y: 0, w: 100, h: 100, undoable: false });
    ce.world.sync();
    let now = 0;
    const step = (n = 1): void => {
      for (let i = 0; i < n; i++) {
        now += 16;
        ce.step(now);
      }
    };
    step(5);
    ce.ops.enterContainer(folder);
    step(80); // flight settles
    expect(ce.world.hasTag(rootBox, Active)).toBe(false);
    expect(ce.world.hasTag(rootBox, Visible)).toBe(false);

    ce.ops.exitContainer();
    for (let i = 0; i < 80; i++) step();
    expect(ce.world.hasTag(rootBox, Active)).toBe(true);
    expect(ce.world.hasTag(rootBox, Visible)).toBe(true); // back on screen at root
    ce.dispose();
  });
});
