/**
 * pointerlab boot + behavior smoke — the app assembly drives the REAL engine
 * (L0 queue → picking → recognizers → behaviors), no rig, no mocks: synthetic
 * events go through the same InputQueue the DOM adapter feeds.
 */
import { describe, expect, it } from "vitest";
import {
  Camera,
  CursorVisual,
  NO_MODS,
  Position,
  Selected,
  Viewport,
  defineQuery,
  type Entity,
  type InputEvent,
  type World,
} from "@ice/core";
import { Cur, RemoteId, WidgetVisual, WorldPos } from "../src/components";
import { createPointerWorld, type PointerWorld } from "../src/world";

const widgetQ = defineQuery([Position, WidgetVisual]);
const remoteQ = defineQuery([WorldPos, RemoteId]);
const curQ = defineQuery([Cur, CursorVisual]);

function entitiesOf(world: World, q: ReturnType<typeof defineQuery>): Entity[] {
  const out: Entity[] = [];
  world.query(q).each((b) => {
    for (const r of b) out.push(b.entity(r));
  });
  return out;
}

function makeStepper(pw: PointerWorld) {
  let now = 1000;
  return (n = 1): void => {
    for (let i = 0; i < n; i++) {
      now += 16;
      pw.engine.step(now);
    }
  };
}

function ev(kind: InputEvent["kind"], x: number, y: number, buttons: number): InputEvent {
  return {
    kind,
    pointerId: "mouse",
    device: "mouse",
    screenX: x,
    screenY: y,
    buttons,
    mods: NO_MODS,
  };
}

describe("pointerlab boot smoke", () => {
  it("assembles the world: 4 widgets, 4 fake remotes, identity camera", () => {
    const pw = createPointerWorld();
    // v2 parity: identity camera until the first viewport sync fits.
    expect(pw.world.getResource(Camera)?.zoom).toBe(1);
    expect(entitiesOf(pw.world, widgetQ)).toHaveLength(4);
    expect(entitiesOf(pw.world, remoteQ)).toHaveLength(4);
    const step = makeStepper(pw);
    step(5); // no input at all — the pipeline idles without throwing
    // remote cursors spawned for the fake remotes (local pointer not yet born)
    expect(entitiesOf(pw.world, curQ).length).toBeGreaterThanOrEqual(4);
  });

  it("tap on card A selects it; tap on empty canvas clears", () => {
    const pw = createPointerWorld();
    pw.world.setResource(Viewport, { w: 1200, h: 900, dpr: 1 });
    const step = makeStepper(pw);
    step(2); // spatial index warm-up (spawn → spatialSync)

    // card A: v2 centre (300,260) → identity camera puts it at screen (300,260)
    pw.stack.queue.enqueue(ev("down", 300, 260, 1));
    step();
    pw.stack.queue.enqueue(ev("up", 300, 260, 0));
    step();
    const cardA = entitiesOf(pw.world, widgetQ)[0] as Entity;
    expect(pw.world.hasTag(cardA, Selected)).toBe(true);

    // far empty canvas → clear
    pw.stack.queue.enqueue(ev("down", 1100, 850, 1));
    step();
    pw.stack.queue.enqueue(ev("up", 1100, 850, 0));
    step();
    expect(pw.world.hasTag(cardA, Selected)).toBe(false);
  });

  it("drag on card A moves it (select-on-grab, absolute totals)", () => {
    const pw = createPointerWorld();
    pw.world.setResource(Viewport, { w: 1200, h: 900, dpr: 1 });
    const step = makeStepper(pw);
    step(2);
    const cardA = entitiesOf(pw.world, widgetQ)[0] as Entity;
    const before = pw.world.read(cardA, Position);

    pw.stack.queue.enqueue(ev("down", 300, 260, 1));
    step();
    pw.stack.queue.enqueue(ev("move", 320, 260, 1)); // past the 10px dead zone → Active
    step();
    pw.stack.queue.enqueue(ev("move", 360, 290, 1));
    step();
    pw.stack.queue.enqueue(ev("up", 360, 290, 0));
    step(2);

    const after = pw.world.read(cardA, Position);
    // totals rebase at dead-zone exit: the move counts from the activation point (320,260)
    expect(after.x - before.x).toBeCloseTo(40, 0);
    expect(after.y - before.y).toBeCloseTo(30, 0);
    expect(pw.world.hasTag(cardA, Selected)).toBe(true); // select-on-grab
  });

  it("empty-canvas drag marquees (buffer live mid-drag) and selects intersecting widgets", () => {
    const pw = createPointerWorld();
    pw.world.setResource(Viewport, { w: 1200, h: 900, dpr: 1 });
    const step = makeStepper(pw);
    step(2);

    pw.stack.queue.enqueue(ev("down", 100, 100, 1)); // empty canvas, above/left of card A
    step();
    pw.stack.queue.enqueue(ev("move", 130, 130, 1)); // activate
    step();
    pw.stack.queue.enqueue(ev("move", 700, 700, 1)); // sweep across A/B
    step();
    expect(pw.stack.marqueeBuffer.rect).not.toBeNull();

    pw.stack.queue.enqueue(ev("up", 700, 700, 0));
    step(2);
    expect(pw.stack.marqueeBuffer.rect).toBeNull();
    const selected = entitiesOf(pw.world, widgetQ).filter((e) => pw.world.hasTag(e, Selected));
    expect(selected.length).toBeGreaterThanOrEqual(2); // cards A + B intersect the sweep
  });

  it("local ring cursor spawns on first mouse event and follows toward it", () => {
    const pw = createPointerWorld();
    pw.world.setResource(Viewport, { w: 1200, h: 900, dpr: 1 });
    const step = makeStepper(pw);
    pw.stack.queue.enqueue(ev("move", 400, 300, 0));
    step(3);
    const locals = entitiesOf(pw.world, curQ).filter(
      (e) => pw.world.read(e, CursorVisual).kind === "local",
    );
    expect(locals).toHaveLength(1);
    const cur = pw.world.read(locals[0] as Entity, Cur);
    // the spring eases toward the pointer — after a few frames it is well on its way
    expect(Math.hypot(cur.x - 400, cur.y - 300)).toBeLessThan(400);
  });

  it("fake remotes wander: positions change over time", () => {
    const pw = createPointerWorld();
    const step = makeStepper(pw);
    const before = entitiesOf(pw.world, remoteQ).map((e) => ({ ...pw.world.read(e, WorldPos) }));
    step(200); // ~3.2s — every remote has picked at least one goal and eased toward it
    const after = entitiesOf(pw.world, remoteQ);
    const moved = after.some((e, i) => {
      const b = before[i];
      if (b === undefined) return true; // churn replaced someone — motion happened
      const a = pw.world.read(e, WorldPos);
      return Math.abs(a.x - b.x) > 1 || Math.abs(a.y - b.y) > 1;
    });
    expect(moved).toBe(true);
  });
});
