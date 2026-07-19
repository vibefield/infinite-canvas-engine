/**
 * Stage background holds (2026-07-19, the overlay-quiesce concept): named,
 * refcounted, disposer-released — and PRESENTATION-ONLY: the world must stay
 * fully live while backgrounded (that is the design decision that makes the
 * mechanism safe for partial overlays — undo/collab/tweens never freeze).
 */
import { describe, expect, it } from "vitest";
import { StageMode, Viewport, createCanvasEngine, defineWidget, widgets } from "../src";

const BOX =
  widgets.get("stage:box") ??
  defineWidget({
    type: "stage:box",
    surface: "dom",
    component: null,
    defaultSize: { w: 100, h: 80 },
  });

function boot() {
  const ce = createCanvasEngine({ widgets: [BOX] });
  ce.docs.create();
  ce.world.setResource(Viewport, { w: 1600, h: 900, dpr: 1 });
  ce.world.sync();
  return ce;
}

describe("ce.stage background holds", () => {
  it("refcounts named holds and mirrors the count into StageMode", () => {
    const ce = boot();
    expect(ce.stage.isBackgrounded()).toBe(false);
    expect(ce.world.getResource(StageMode)?.backgroundHolds ?? 0).toBe(0);

    const a = ce.stage.background("widget-tray");
    const b = ce.stage.background("settings");
    expect(ce.stage.isBackgrounded()).toBe(true);
    expect(ce.world.getResource(StageMode)?.backgroundHolds).toBe(2);
    expect(ce.stage.holds()).toEqual(["widget-tray", "settings"]);

    a();
    expect(ce.stage.isBackgrounded()).toBe(true); // the OTHER overlay still holds
    expect(ce.world.getResource(StageMode)?.backgroundHolds).toBe(1);
    b();
    expect(ce.stage.isBackgrounded()).toBe(false);
    expect(ce.world.getResource(StageMode)?.backgroundHolds).toBe(0);
    ce.dispose();
  });

  it("release is idempotent — a double release never eats another overlay's hold", () => {
    const ce = boot();
    const a = ce.stage.background("tray");
    const b = ce.stage.background("panel");
    a();
    a(); // the classic boolean-pause bug this API exists to prevent
    a();
    expect(ce.stage.isBackgrounded()).toBe(true);
    expect(ce.world.getResource(StageMode)?.backgroundHolds).toBe(1);
    expect(ce.stage.holds()).toEqual(["panel"]);
    b();
    expect(ce.stage.isBackgrounded()).toBe(false);
    ce.dispose();
  });

  it("backgrounded is presentation-only: ops write and reflect while held", () => {
    const ce = boot();
    const release = ce.stage.background("overlay");
    // The world stays LIVE: a durable spawn + an undo work exactly as in
    // the foreground (no frozen-step staleness — the rev-2 design decision).
    const e = ce.ops.spawnWidget("stage:box", { x: 10, y: 20 });
    let now = 1000;
    now += 16;
    ce.step(now);
    expect(ce.world.isAlive(e)).toBe(true);
    expect(ce.docs.undo()).toBe(true);
    now += 16;
    ce.step(now);
    expect(ce.world.isAlive(e)).toBe(false);
    release();
    ce.dispose();
  });
});
