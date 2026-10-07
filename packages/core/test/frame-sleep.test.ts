/**
 * THE SLEEP (2026-09-27, ICE M21 K7a — engine/frame-control.ts, dom/loop.ts): a host loop that opts in stops scheduling frames
 * once the engine is quiet — no wake pending, no registered wake due, no settle reporter busy, for SLEEP_TAIL steps — and
 * everything that can change the next frame from outside a step wakes it. The pins: the protocol itself (a wake, the tail, a
 * registered time, a settled step, a wake inside a step), and each of core's doors — the world's outside writes, the input
 * queue, the document's local and remote commits, the room's presence — and each of its registered wakes: the interaction
 * stack's pending work (a recognizer, a flight, inertia, a tween, the band), a behavior that ticks. The host loop is simulated
 * as dom/loop.ts drives it: a step, then `nextStep`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createWorld, defineQuery } from "@vibecook/strata-ecs";
import {
  attachPresence,
  CameraInertia,
  createCanvasEngine,
  createEngine,
  defineWidget,
  NavTransition,
  interactionPending,
  NO_MODS,
  SLEEP_TAIL,
  Tray,
  Viewport,
  widgets,
  type CanvasEngine,
  type Engine,
  type InputEvent,
} from "../src";
import { Camera as CoreCamera } from "../src/catalog/camera-derived";
import { __resetBehaviorsForTests, defineBehavior } from "../src/behavior/define-behavior";
import { p } from "../src/widget/props";

const BOX =
  widgets.get("sleep:box") ??
  defineWidget({
    type: "sleep:box",
    defaultSize: { w: 100, h: 80 },
  });

const engines: CanvasEngine[] = [];
afterEach(() => {
  for (const ce of engines.splice(0)) ce.dispose();
  __resetBehaviorsForTests();
});

/** The host loop, simulated: a step at the loop's clock, then the gate's word on the next one (dom/loop.ts `schedule`). */
function loopOf(engine: Engine) {
  let t = 1000;
  return {
    get now() { return t; },
    /** One step; returns when the next is due (≤ now: the next frame). */
    step(): number {
      t += 16;
      engine.step(t);
      return engine.frame.nextStep(t);
    },
    /** Steps until the gate says sleep (or `cap`); returns how many were taken and the time it sleeps until. */
    toSleep(cap = 200): { steps: number; until: number } {
      for (let n = 1; n <= cap; n++) {
        const due = this.step();
        if (due > t) return { steps: n, until: due };
      }
      return { steps: cap, until: Number.NaN };
    },
    advance(ms: number): void { t += ms; },
  };
}

function boot(): CanvasEngine {
  const ce = createCanvasEngine({ widgets: [BOX] });
  engines.push(ce);
  ce.docs.create();
  ce.world.setResource(Viewport, { w: 1600, h: 900, dpr: 1 });
  return ce;
}

describe("frame.nextStep — the protocol", () => {
  it("sleeps after SLEEP_TAIL quiet steps; an outside wake buys the step it wakes and the tail again", () => {
    const engine = createEngine(createWorld());
    const loop = loopOf(engine);
    expect(loop.toSleep()).toEqual({ steps: SLEEP_TAIL, until: Number.POSITIVE_INFINITY });
    // asleep: nothing is due, a step taken anyway asks for nothing
    engine.frame.wake("test");
    expect(engine.frame.sleepStats().wakes.test).toBe(1);
    expect(loop.toSleep()).toEqual({ steps: SLEEP_TAIL, until: Number.POSITIVE_INFINITY });
  });

  it("a wake INSIDE a step is the step's own: counted nowhere, no tail", () => {
    const engine = createEngine(createWorld());
    const loop = loopOf(engine);
    loop.toSleep();
    let inside = 0;
    engine.onPublish(() => { inside += 1; engine.frame.wake("inside"); });
    // the steps a sleeping loop takes for nothing: each asks for no other (the publish hook's wake is inside)
    expect(loop.step()).toBe(Number.POSITIVE_INFINITY);
    expect(inside).toBe(1);
    expect(engine.frame.sleepStats().wakes.inside).toBeUndefined();
  });

  it("a registered TIME: the loop sleeps until it, and the step it takes then is settled", () => {
    const engine = createEngine(createWorld());
    const loop = loopOf(engine);
    let at = Number.POSITIVE_INFINITY;
    engine.frame.wakeWhen("blink", () => at);
    loop.toSleep();
    at = loop.now + 530;
    // one more quiet step (nothing woke it): the gate names the time
    expect(loop.step()).toBe(at);
    const settled: boolean[] = [];
    engine.registerReflector({ name: "probe", always: true, flush: () => { settled.push(engine.frame.settled()); } });
    loop.advance(530);
    at = Number.POSITIVE_INFINITY;
    expect(loop.step()).toBe(Number.POSITIVE_INFINITY);   // the time's step, and asleep again at once: no tail
    expect(settled).toEqual([true]);
    // an outside wake: the next step is not settled
    engine.frame.wake("input");
    loop.step();
    expect(settled).toEqual([true, false]);
  });

  it("a source due now, or a settle reporter busy, keeps the loop stepping; quiet again, the tail then sleep", () => {
    const engine = createEngine(createWorld());
    const loop = loopOf(engine);
    let moving = 5;
    engine.frame.wakeWhen("spring", (now) => (moving > 0 ? now : Number.POSITIVE_INFINITY));
    let owed = 3;
    engine.frame.settleWhile("paints", () => owed > 0);
    for (let i = 0; i < 5; i++) {
      expect(loop.step()).toBeLessThanOrEqual(loop.now);
      moving -= 1;
      owed -= 1;
    }
    expect(engine.frame.due(loop.now)).toEqual([]);
    expect(loop.toSleep()).toEqual({ steps: SLEEP_TAIL, until: Number.POSITIVE_INFINITY });
  });

  it("a sleeping host hears a wake; the stats count the sleeps, the wakes and the timed steps", () => {
    const engine = createEngine(createWorld());
    const loop = loopOf(engine);
    let heard = 0;
    engine.frame.onWake(() => { heard += 1; });
    loop.toSleep();
    engine.frame.sleeping(true);
    engine.frame.wake("world");
    engine.frame.wake("input");
    expect(heard).toBe(2);
    engine.frame.sleeping(false);
    engine.frame.wake("world");
    expect(heard).toBe(2);   // awake: nothing to restart
    engine.frame.sleeping(true);
    engine.frame.sleeping(false, true);
    const s = engine.frame.sleepStats();
    expect(s).toMatchObject({ asleep: false, sleeps: 2, timed: 1, wakes: { world: 2, input: 1 } });
  });
});

describe("the doors — what wakes a sleeping loop", () => {
  it("the world's doors: a write made OUTSIDE a step wakes it; the same write inside a step does not", () => {
    const ce = boot();
    const loop = loopOf(ce.engine);
    loop.toSleep();
    const before = ce.frame.sleepStats().wakes.world ?? 0;
    ce.world.setResource(CoreCamera, { x: 10, y: 0, zoom: 1, gesturing: false });
    expect(ce.frame.sleepStats().wakes.world).toBe(before + 1);
    const e = ce.world.spawn({ components: [] });
    ce.world.destroy(e);
    expect(ce.frame.sleepStats().wakes.world).toBe(before + 3);
    expect(loop.step()).toBeLessThanOrEqual(loop.now);   // woken: the tail runs again
    loop.toSleep();
    // inside a step (a publish hook's write): no wake
    const inside = ce.frame.sleepStats().wakes.world ?? 0;
    let n = 0;
    ce.engine.onPublish((w) => { n += 1; w.setResource(CoreCamera, { x: 20 + n, y: 0, zoom: 1, gesturing: false }); });
    expect(loop.step()).toBe(Number.POSITIVE_INFINITY);
    expect(ce.frame.sleepStats().wakes.world).toBe(inside);
  });

  it("the input queue: an enqueue wakes it, and the stack is due until the input is drained", () => {
    const ce = boot();
    const loop = loopOf(ce.engine);
    loop.toSleep();
    const MOVE: InputEvent = { kind: "move", pointerId: "mouse", device: "mouse", screenX: 10, screenY: 10, buttons: 0, mods: NO_MODS };
    ce.stack.queue.enqueue(MOVE);
    expect(ce.frame.sleepStats().wakes.input).toBe(1);
    expect(interactionPending(ce.world, ce.stack.queue)).toBe("input");
    expect(ce.frame.due(loop.now)).toContain("interaction");
    loop.step();
    expect(interactionPending(ce.world, ce.stack.queue)).toBeUndefined();
    expect(loop.toSleep().until).toBe(Number.POSITIVE_INFINITY);
  });

  it("the document: a local commit outside a step and a peer's change applied both wake it", () => {
    const a = boot();
    const b = createCanvasEngine({ widgets: [BOX] });
    engines.push(b);
    const sa = a.docs.current();
    if (sa === undefined) throw new Error("no session");
    expect(b.docs.open(sa.exportEnvelope()).ok).toBe(true);   // the same document, as a peer holds it
    const sb = b.docs.current();
    if (sb === undefined) throw new Error("no peer session");
    loopOf(a.engine).toSleep();
    loopOf(b.engine).toSleep();
    const out: Uint8Array[] = [];
    sa.store.subscribeOutbound((bytes) => out.push(bytes));
    const docA = a.frame.sleepStats().wakes.doc ?? 0;
    a.ops.spawnWidget("sleep:box", { x: 0, y: 0 });
    expect(out.length).toBeGreaterThan(0);
    expect(a.frame.sleepStats().wakes.doc).toBeGreaterThan(docA);
    const docB = b.frame.sleepStats().wakes.doc ?? 0;
    for (const bytes of out) sb.applyRemote(bytes);
    expect(b.frame.sleepStats().wakes.doc).toBeGreaterThan(docB);
  });

  it("the room: a peer's presence arriving wakes it (never this peer's own)", async () => {
    const ce = boot();
    const loop = loopOf(ce.engine);
    ce.docs.attachPresence({ name: "me", color: "#f00" });
    const wire = ce.docs.presence()?.wire;
    if (wire === undefined) throw new Error("no presence");
    loop.toSleep();
    const own = ce.frame.sleepStats().wakes.presence ?? 0;
    const other = attachPresence(createWorld(), { name: "bob", color: "#00f" });
    const buf: Uint8Array[] = [];
    other.onOutbound((bytes) => buf.push(bytes));
    const t0 = Date.now();
    while (buf.length === 0 && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 10));
    for (const bytes of buf.splice(0)) wire.apply(bytes);
    other.detach();
    expect(ce.frame.sleepStats().wakes.presence ?? 0).toBeGreaterThan(own);
  });

  it("the room at rest: a lone engine's presence counts NO wake over 6.2 s — the TTL sweep's empty ticks are no one's (I43)", async () => {
    // The default TTL (5 s): Loro sweeps every 2.5 s while the store holds this peer's own keys, and a sweep that removes
    // nothing still emits — DK-16 counted `wakes.presence` 2 in 6.2 s at rest before the kit keyed off the event's arrays.
    const ce = boot();
    const loop = loopOf(ce.engine);
    ce.docs.attachPresence({ name: "me", color: "#f00" });
    loop.toSleep();
    const before = ce.frame.sleepStats().wakes.presence ?? 0;
    await new Promise((r) => setTimeout(r, 6200));
    expect((ce.frame.sleepStats().wakes.presence ?? 0) - before).toBe(0);
  }, 15_000);
});

describe("the registered wakes — due while their work is pending", () => {
  it("the interaction stack: a flight, inertia, a tween, the band, a press held — each due; at rest never", () => {
    const ce = boot();
    const loop = loopOf(ce.engine);
    loop.toSleep();
    const pending = (): string | undefined => interactionPending(ce.world, ce.stack.queue);
    expect(pending()).toBeUndefined();
    ce.world.setResource(NavTransition, { active: true } as never);
    expect(pending()).toBe("flight");
    ce.world.setResource(NavTransition, { active: false } as never);
    // inertia: the loop steps while the camera glides — far past the tail (the stack's registered wake, not the tail, keeps it)
    ce.world.setResource(CameraInertia, { vx: 4000, vy: 0 });
    expect(pending()).toBe("inertia");
    let glide = 0;
    while (pending() === "inertia" && glide < 600) { expect(loop.step()).toBeLessThanOrEqual(loop.now); glide += 1; }
    expect(glide).toBeGreaterThan(SLEEP_TAIL + 2);
    expect(pending()).toBeUndefined();
    expect(loop.toSleep().until).toBe(Number.POSITIVE_INFINITY);
    const cam = ce.world.getResource(CoreCamera);
    ce.world.setResource(CoreCamera, { x: cam?.x ?? 0, y: cam?.y ?? 0, zoom: cam?.zoom ?? 1, gesturing: true });
    expect(pending()).toBe("gesture");
    ce.world.setResource(CoreCamera, { x: cam?.x ?? 0, y: cam?.y ?? 0, zoom: cam?.zoom ?? 1, gesturing: false });
    const tray = ce.world.firstOf(defineQuery([Tray]));
    if (tray !== undefined) {
      ce.world.edit(tray).set(Tray, { ...ce.world.read(tray, Tray), open: true, scroll: 0, stretch: 12 });
      expect(pending()).toBe("band");
      ce.world.edit(tray).set(Tray, { ...ce.world.read(tray, Tray), open: false, scroll: 0, stretch: 0 });
    }
    // a press held: a recognizer is alive (a long-press timer) until the release is processed and it is reaped
    const DOWN: InputEvent = { kind: "down", pointerId: "mouse", device: "mouse", screenX: 400, screenY: 300, buttons: 1, mods: NO_MODS };
    const UP: InputEvent = { kind: "up", pointerId: "mouse", device: "mouse", screenX: 400, screenY: 300, buttons: 0, mods: NO_MODS };
    ce.stack.queue.enqueue(DOWN);
    loop.step();
    expect(pending()).toBe("recognizer");
    for (let i = 0; i < 5; i++) expect(loop.step()).toBeLessThanOrEqual(loop.now);   // held still: due every frame
    ce.stack.queue.enqueue(UP);
    const slept = loop.toSleep(400);
    expect(slept.until).toBe(Number.POSITIVE_INFINITY);
    expect(pending()).toBeUndefined();
  });

  it("a behavior with a tick hook is due while it has instances, and never without", () => {
    const Ticker = defineBehavior("sleep:ticker", {
      store: "runtime",
      schema: { n: p.number({ default: 0 }) },
      on: { tick: () => {} },
    });
    const CARD = widgets.get("sleep:card") ?? defineWidget({ type: "sleep:card", defaultSize: { w: 10, h: 10 }, behaviors: [Ticker] });
    const ce = createCanvasEngine({ widgets: [BOX, CARD], behaviors: [Ticker] });
    engines.push(ce);
    ce.docs.create();
    const loop = loopOf(ce.engine);
    loop.toSleep();
    expect(ce.frame.due(loop.now)).not.toContain("behavior:sleep:ticker");
    ce.ops.spawnWidget("sleep:card", { x: 0, y: 0, undoable: false });
    for (let i = 0; i < 3; i++) loop.step();
    expect(ce.frame.due(loop.now)).toContain("behavior:sleep:ticker");
    expect(loop.step()).toBeLessThanOrEqual(loop.now);
  });
});
