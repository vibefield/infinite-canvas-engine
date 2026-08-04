/**
 * The frame gate (2026-08-04) — the frozen-world mode design-005 §7 named as a
 * SEPARATE concept from stage holds, and its settle protocol.
 *
 * The pins that matter: a freeze parks the loop for real (the gate stops
 * claiming steps), it parks only once the canvas has settled (so the frozen
 * image is whole rather than half-drawn), and everything that could rot across
 * a park — an in-flight gesture, a queue of stale input — is dealt with at the
 * transition rather than replayed on thaw.
 */
import { describe, expect, it, vi } from "vitest";
import {
  CancelRequest,
  createCanvasEngine,
  createEngine,
  createWorld,
  defineWidget,
  FrameMode,
  NO_MODS,
  SETTLE_CAP,
  Viewport,
  widgets,
  type InputEvent,
} from "../src";

const BOX =
  widgets.get("freeze:box") ??
  defineWidget({
    type: "freeze:box",
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

const MOVE: InputEvent = {
  kind: "move",
  pointerId: "mouse",
  device: "mouse",
  screenX: 10,
  screenY: 10,
  buttons: 0,
  mods: NO_MODS,
};

describe("engine.frame — refcount and mirror", () => {
  it("refcounts named freezes and mirrors the count into FrameMode", () => {
    const ce = boot();
    expect(ce.frame.isFrozen()).toBe(false);
    expect(ce.world.getResource(FrameMode)?.freezeHolds ?? 0).toBe(0);

    const a = ce.frame.freeze("godview");
    const b = ce.frame.freeze("window-hidden");
    expect(ce.frame.isFrozen()).toBe(true);
    expect(ce.world.getResource(FrameMode)?.freezeHolds).toBe(2);
    expect(ce.frame.holds()).toEqual(["godview", "window-hidden"]);

    a();
    expect(ce.frame.isFrozen()).toBe(true); // the other reason still holds
    b();
    expect(ce.frame.isFrozen()).toBe(false);
    expect(ce.world.getResource(FrameMode)?.freezeHolds).toBe(0);
    ce.dispose();
  });

  it("thaw is idempotent — a double thaw never eats another holder's freeze", () => {
    const ce = boot();
    const a = ce.frame.freeze("godview");
    const b = ce.frame.freeze("screensaver");
    a();
    a();
    a();
    expect(ce.frame.isFrozen()).toBe(true);
    expect(ce.frame.holds()).toEqual(["screensaver"]);
    b();
    expect(ce.frame.isFrozen()).toBe(false);
    ce.dispose();
  });

  it("the facade and the raw engine share ONE gate", () => {
    const ce = boot();
    const thaw = ce.engine.frame.freeze("via-engine");
    expect(ce.frame.isFrozen()).toBe(true);
    thaw();
    expect(ce.engine.frame.isFrozen()).toBe(false);
    ce.dispose();
  });
});

describe("engine.frame — the settle walk", () => {
  it("takes exactly one more step when nothing is owed, then parks", () => {
    const world = createWorld();
    const engine = createEngine(world);
    expect(engine.frame.claimStep()).toBe(true); // unfrozen: always

    engine.frame.freeze("cover");
    expect(engine.frame.claimStep()).toBe(true); // the settle step
    expect(engine.frame.isParked()).toBe(true);
    expect(engine.frame.claimStep()).toBe(false);
    expect(engine.frame.claimStep()).toBe(false);
  });

  it("keeps stepping while a reporter is busy, then takes one settled step", () => {
    const world = createWorld();
    const engine = createEngine(world);
    let owed = 3;
    engine.frame.settleWhile("gl-paints", () => owed > 0);

    engine.frame.freeze("cover");
    // Three busy frames: the gate keeps handing out steps rather than parking
    // on a half-drawn board.
    for (let i = 0; i < 3; i++) {
      expect(engine.frame.claimStep()).toBe(true);
      expect(engine.frame.isParked()).toBe(false);
      expect(engine.frame.settling()).toEqual(["gl-paints"]);
      owed -= 1;
    }
    // Quiet now: one final step so the settled state reflects, then park.
    expect(engine.frame.claimStep()).toBe(true);
    expect(engine.frame.isParked()).toBe(true);
    expect(engine.frame.claimStep()).toBe(false);
  });

  it("parks anyway at the settle cap, naming the reporter that wedged it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const world = createWorld();
    const engine = createEngine(world);
    engine.frame.settleWhile("never-quiet", () => true);

    engine.frame.freeze("cover");
    for (let i = 0; i < SETTLE_CAP; i++) expect(engine.frame.claimStep()).toBe(true);
    expect(engine.frame.claimStep()).toBe(false); // capped, not hung
    expect(engine.frame.isParked()).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("never-quiet"));
    warn.mockRestore();
  });

  it("an unregistered reporter stops holding the settle open", () => {
    const world = createWorld();
    const engine = createEngine(world);
    const release = engine.frame.settleWhile("gl-paints", () => true);
    engine.frame.freeze("cover");
    expect(engine.frame.claimStep()).toBe(true);
    expect(engine.frame.isParked()).toBe(false);
    release();
    expect(engine.frame.claimStep()).toBe(true); // the settled step
    expect(engine.frame.isParked()).toBe(true);
  });

  it("thaw re-arms: a second freeze settles and parks again", () => {
    const world = createWorld();
    const engine = createEngine(world);
    const thaw = engine.frame.freeze("first");
    engine.frame.claimStep();
    expect(engine.frame.isParked()).toBe(true);

    thaw();
    expect(engine.frame.isParked()).toBe(false);
    expect(engine.frame.claimStep()).toBe(true);

    engine.frame.freeze("second");
    expect(engine.frame.claimStep()).toBe(true);
    expect(engine.frame.claimStep()).toBe(false);
  });
});

describe("engine.frame — what a freeze must not strand", () => {
  it("cancels active gestures at the freeze, and settles until they are terminal", () => {
    const ce = boot();
    ce.world.setResource(CancelRequest, { active: false });
    ce.world.sync();

    ce.frame.freeze("godview");
    // Cancellation is a one-tick resource the ctl:spawn sweep acts on NEXT
    // tick — the point is that a parked loop never leaves a gesture holding
    // uncommitted runtime edits.
    expect(ce.world.getResource(CancelRequest)?.active).toBe(true);
    ce.dispose();
  });

  it("drops input banked while parked instead of replaying it on thaw", () => {
    const ce = boot();
    const thaw = ce.frame.freeze("godview");
    // Adapters never stop enqueuing: the pointer kept moving over the chrome
    // that covers the canvas.
    ce.stack.queue.enqueue(MOVE);
    ce.stack.queue.enqueue(MOVE);
    expect(ce.stack.queue.size()).toBe(2);

    thaw();
    expect(ce.stack.queue.size()).toBe(0);
    ce.dispose();
  });

  it("leaves stage holds alone — the two concepts do not touch", () => {
    const ce = boot();
    const release = ce.stage.background("widget-tray");
    const thaw = ce.frame.freeze("godview");
    expect(ce.stage.isBackgrounded()).toBe(true);
    expect(ce.stage.holds()).toEqual(["widget-tray"]);
    thaw();
    expect(ce.stage.isBackgrounded()).toBe(true);
    release();
    expect(ce.frame.isFrozen()).toBe(false);
    ce.dispose();
  });

  it("step() itself stays callable by hand while frozen (the gate governs the LOOP)", () => {
    const ce = boot();
    ce.frame.freeze("godview");
    const e = ce.ops.spawnWidget("freeze:box", { x: 10, y: 20 });
    ce.step(1016); // a headless host / trace driving frames by hand
    expect(ce.world.isAlive(e)).toBe(true);
    ce.dispose();
  });
});
