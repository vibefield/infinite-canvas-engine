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
  FrameInfo,
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

describe("engine.frame.onParked — the park ANNOUNCED (petition I41)", () => {
  /** A host loop as dom/loop.ts drives one: a claim, then the step it granted. Returns whether a step ran. */
  function hostOf(engine: ReturnType<typeof createEngine>) {
    let now = 1000;
    return {
      frame(): boolean {
        if (!engine.frame.claimStep()) return false;
        now += 16;
        engine.step(now);
        return true;
      },
    };
  }

  it("announces once when the settle step ENDS — not at the freeze, not as the step is handed out — and never per frame", () => {
    const world = createWorld();
    const engine = createEngine(world);
    const heard: Array<{ parked: boolean; tick: number }> = [];
    engine.frame.onParked((parked) => heard.push({ parked, tick: world.getResource(FrameInfo)?.tick ?? 0 }));
    const host = hostOf(engine);
    for (let i = 0; i < 5; i++) expect(host.frame()).toBe(true);
    expect(heard).toEqual([]); // a live loop announces nothing

    const thaw = engine.frame.freeze("cover");
    expect(heard).toEqual([]); // a freeze is not a park

    // The settle step: the gate closes as it hands it out (isParked turns true) — the park is announced when it has ENDED.
    expect(engine.frame.claimStep()).toBe(true);
    expect(engine.frame.isParked()).toBe(true);
    expect(heard).toEqual([]);
    engine.step(2000);
    expect(heard).toEqual([{ parked: true, tick: 6 }]); // heard after the sixth step — the frame the park leaves standing

    for (let i = 0; i < 20; i++) expect(host.frame()).toBe(false); // the refused claims: nothing more
    expect(heard).toHaveLength(1);

    thaw();
    expect(heard.map((h) => h.parked)).toEqual([true, false]); // the reopening, once
    for (let i = 0; i < 5; i++) expect(host.frame()).toBe(true);
    expect(heard).toHaveLength(2);
  });

  it("after a busy walk: one announcement, at the end of the settled step that follows it", () => {
    const engine = createEngine(createWorld());
    let owed = 3;
    engine.frame.settleWhile("gl-paints", () => owed > 0);
    const heard: boolean[] = [];
    engine.frame.onParked((parked) => heard.push(parked));
    const host = hostOf(engine);
    engine.frame.freeze("cover");
    for (let i = 0; i < 3; i++) {
      expect(host.frame()).toBe(true);
      owed -= 1;
    }
    expect(heard).toEqual([]); // walking, not parked
    expect(host.frame()).toBe(true); // the settled step
    expect(heard).toEqual([true]);
    expect(host.frame()).toBe(false);
    expect(heard).toEqual([true]);
  });

  it("the settle cap and a host that claims without stepping: announced at the first REFUSED claim", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const capped = createEngine(createWorld());
      capped.frame.settleWhile("never-quiet", () => true);
      const heardCap: boolean[] = [];
      capped.frame.onParked((parked) => heardCap.push(parked));
      capped.frame.freeze("cover");
      for (let i = 0; i < SETTLE_CAP; i++) expect(capped.frame.claimStep()).toBe(true);
      expect(heardCap).toEqual([]);
      expect(capped.frame.claimStep()).toBe(false); // capped: no step follows this park
      expect(heardCap).toEqual([true]);
      expect(capped.frame.claimStep()).toBe(false);
      expect(heardCap).toEqual([true]);
    } finally {
      warn.mockRestore();
    }

    const bare = createEngine(createWorld());
    const heard: boolean[] = [];
    bare.frame.onParked((parked) => heard.push(parked));
    bare.frame.freeze("cover");
    expect(bare.frame.claimStep()).toBe(true); // the settle step, never stepped
    expect(heard).toEqual([]);
    expect(bare.frame.claimStep()).toBe(false);
    expect(heard).toEqual([true]);
  });

  it("a freeze thawed before it parks announces nothing; a second freeze over a park changes nothing; the LAST thaw reopens", () => {
    const engine = createEngine(createWorld());
    const heard: boolean[] = [];
    engine.frame.onParked((parked) => heard.push(parked));
    const host = hostOf(engine);

    const early = engine.frame.freeze("flash");
    early();
    expect(heard).toEqual([]);
    expect(host.frame()).toBe(true);
    expect(heard).toEqual([]);

    const a = engine.frame.freeze("godview");
    host.frame(); // settle
    expect(heard).toEqual([true]);
    const b = engine.frame.freeze("window-hidden"); // over the park
    a();
    expect(heard).toEqual([true]); // still parked by the other holder
    b();
    expect(heard).toEqual([true, false]);
  });

  it("a listener that thaws AT the park gets the gate reopened — the claim it refused is granted, and the listeners after it hear only the reopening", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const engine = createEngine(createWorld());
      engine.frame.settleWhile("never-quiet", () => true);
      const thaw = engine.frame.freeze("blink");
      const first: boolean[] = [];
      const second: boolean[] = [];
      engine.frame.onParked((parked) => {
        first.push(parked);
        if (parked) thaw();
      });
      engine.frame.onParked((parked) => second.push(parked));
      for (let i = 0; i < SETTLE_CAP; i++) engine.frame.claimStep();
      expect(engine.frame.claimStep()).toBe(true); // the cap parked it, the listener thawed it: the loop is not left dead
      expect(engine.frame.isFrozen()).toBe(false);
      expect(first).toEqual([true, false]);
      expect(second).toEqual([false]); // never told of a park already over
    } finally {
      warn.mockRestore();
    }
  });

  it("a throwing listener is contained: the others hear, and the gate stands", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const engine = createEngine(createWorld());
      const heard: boolean[] = [];
      engine.frame.onParked(() => {
        throw new Error("host bug");
      });
      engine.frame.onParked((parked) => heard.push(parked));
      const host = hostOf(engine);
      engine.frame.freeze("cover");
      expect(() => host.frame()).not.toThrow();
      expect(heard).toEqual([true]);
      expect(engine.frame.isParked()).toBe(true);
      expect(error).toHaveBeenCalledWith(expect.stringContaining("onParked"), expect.any(Error));
    } finally {
      error.mockRestore();
    }
  });

  it("an unsubscribed listener hears nothing", () => {
    const engine = createEngine(createWorld());
    const heard: boolean[] = [];
    const off = engine.frame.onParked((parked) => heard.push(parked));
    off();
    engine.frame.freeze("cover");
    hostOf(engine).frame();
    expect(heard).toEqual([]);
  });
});
