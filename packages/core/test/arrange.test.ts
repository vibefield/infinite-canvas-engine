/**
 * ops.arrange — the desktop-style Clean Up (kernel packLayout + the
 * commit-then-glide protocol from ops/arrange.ts). Pinned:
 *  - instant mode packs without crowding, preserves reading order, and is
 *    idempotent (second call moves nothing, commits nothing);
 *  - ONE undo restores every mover;
 *  - default mode glides: tween riders attached, runtime still at the old
 *    spot on the call frame, reconverged with the committed doc at land;
 *  - selection ≥2 scopes the arrange; bystanders never move;
 *  - a widget already carrying a TransformTween is RETARGETED (I15, 2026-08-15).
 */
import { describe, expect, it } from "vitest";
import {
  Position,
  TransformTween,
  Viewport,
  Wire,
  WireFrom,
  WireTo,
  createCanvasEngine,
  defineWidget,
  widgets,
  type Entity,
} from "../src";

// One widget type per FILE (global registry; no test reset).
const BOX =
  widgets.get("arr:box") ??
  defineWidget({
    type: "arr:box",
    surface: "dom",
    component: null,
    defaultSize: { w: 100, h: 100 },
  });

const GUTTER = 24;

function crowds(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return (
    a.x < b.x + b.w + GUTTER &&
    b.x < a.x + a.w + GUTTER &&
    a.y < b.y + b.h + GUTTER &&
    b.y < a.y + a.h + GUTTER
  );
}

function makeBoard() {
  const ce = createCanvasEngine({ widgets: [BOX] });
  ce.docs.create();
  ce.world.setResource(Viewport, { w: 1600, h: 900, dpr: 1 });
  // Scattered AND piled: b and c overlap exactly, d floats far right.
  const a = ce.ops.spawnWidget("arr:box", { x: 0, y: 0, w: 100, h: 100, undoable: false });
  const b = ce.ops.spawnWidget("arr:box", { x: 30, y: 40, w: 100, h: 100, undoable: false });
  const c = ce.ops.spawnWidget("arr:box", { x: 30, y: 40, w: 100, h: 100, undoable: false });
  const d = ce.ops.spawnWidget("arr:box", { x: 900, y: 10, w: 100, h: 100, undoable: false });
  ce.world.sync();
  let now = 0;
  const step = (n = 1): void => {
    for (let i = 0; i < n; i++) {
      now += 16;
      ce.step(now);
    }
  };
  step(5); // membership stamps Active at root
  return { ce, step, all: [a, b, c, d] as Entity[] };
}

const rectOf = (ce: ReturnType<typeof makeBoard>["ce"], e: Entity) => ({
  ...(ce.world.get(e, Position) as { x: number; y: number }),
  w: 100,
  h: 100,
});

describe("ops.arrange", () => {
  it("instant mode: packs without crowding, keeps reading order, idempotent", () => {
    const { ce, all } = makeBoard();
    const movers = ce.ops.arrange({ durationMs: 0, gutter: GUTTER, maxWidth: 500 });
    expect(movers.length).toBeGreaterThan(0);

    const rects = all.map((e) => rectOf(ce, e));
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        expect(crowds(rects[i] as never, rects[j] as never)).toBe(false);
      }
    }
    // Reading order: `a` (0,0) was top-left-most → it leads the packed rows
    // at the cluster's own bbox top-left (which is a's corner).
    expect(ce.world.get(all[0] as Entity, Position)).toEqual({ x: 0, y: 0 });
    // Idempotent: already tidy → nothing moves.
    expect(ce.ops.arrange({ durationMs: 0, gutter: GUTTER, maxWidth: 500 })).toEqual([]);
    ce.dispose();
  });

  it("ONE undo restores every mover", () => {
    const { ce, step, all } = makeBoard();
    const before = all.map((e) => ({ ...(ce.world.get(e, Position) as { x: number; y: number }) }));
    const movers = ce.ops.arrange({ durationMs: 0, gutter: GUTTER, maxWidth: 500 });
    expect(movers.length).toBeGreaterThan(1);
    expect(ce.docs.undo()).toBe(true);
    step(2); // projection drains at sync
    all.forEach((e, i) => {
      expect(ce.world.get(e, Position)).toEqual(before[i]);
    });
    ce.dispose();
  });

  it("default mode glides: old spot on the call frame, packed layout at land", () => {
    const { ce, step, all } = makeBoard();
    const before = all.map((e) => ({ ...(ce.world.get(e, Position) as { x: number; y: number }) }));
    const movers = ce.ops.arrange({ gutter: GUTTER, maxWidth: 500 });
    for (const e of movers) {
      expect(ce.world.has(e, TransformTween)).toBe(true);
      const i = all.indexOf(e);
      expect(ce.world.get(e, Position)).toEqual(before[i]); // no teleport
    }
    step(30); // 240ms at 16ms/tick, plus settle
    for (const e of movers) expect(ce.world.has(e, TransformTween)).toBe(false);
    // Landed = the packed layout: a re-arrange finds nothing to do.
    expect(ce.ops.arrange({ durationMs: 0, gutter: GUTTER, maxWidth: 500 })).toEqual([]);
    ce.dispose();
  });

  it("selection ≥2 scopes the arrange; bystanders never move", () => {
    const { ce, all } = makeBoard();
    const [a, b, c, d] = all as [Entity, Entity, Entity, Entity];
    const dBefore = { ...(ce.world.get(d, Position) as { x: number; y: number }) };
    ce.ops.setSelection([b, c]);
    const movers = ce.ops.arrange({ durationMs: 0, gutter: GUTTER });
    expect(movers.every((e) => e === b || e === c)).toBe(true);
    expect(ce.world.get(d, Position)).toEqual(dBefore);
    expect(ce.world.get(a, Position)).toEqual({ x: 0, y: 0 });
    ce.dispose();
  });

  it("selection Clean Up flows AROUND bystanders (2026-07-17 field bug)", () => {
    const ce = createCanvasEngine({ widgets: [BOX] });
    ce.docs.create();
    ce.world.setResource(Viewport, { w: 1600, h: 900, dpr: 1 });
    // Bystanders bracket the selection's bbox top-left: the old packer put
    // the packed pair right on top of them.
    const a = ce.ops.spawnWidget("arr:box", { x: 0, y: 0, w: 100, h: 100, undoable: false });
    const k = ce.ops.spawnWidget("arr:box", { x: 140, y: 0, w: 100, h: 100, undoable: false });
    const b = ce.ops.spawnWidget("arr:box", { x: 30, y: 60, w: 100, h: 100, undoable: false });
    const c = ce.ops.spawnWidget("arr:box", { x: 30, y: 60, w: 100, h: 100, undoable: false });
    ce.world.sync();
    let now = 0;
    for (let i = 0; i < 5; i++) {
      now += 16;
      ce.step(now);
    }

    ce.ops.setSelection([b, c]);
    const movers = ce.ops.arrange({ durationMs: 0, gutter: GUTTER });
    expect(movers.length).toBeGreaterThan(0);
    expect(ce.world.get(a, Position)).toEqual({ x: 0, y: 0 });
    expect(ce.world.get(k, Position)).toEqual({ x: 140, y: 0 });
    const rects = [a, k, b, c].map((e) => rectOf(ce, e));
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        expect(crowds(rects[i] as never, rects[j] as never)).toBe(false);
      }
    }
    ce.dispose();
  });

  it("wired widgets arrange as layered columns along wire direction", () => {
    const ce = createCanvasEngine({ widgets: [BOX] });
    ce.docs.create();
    ce.world.setResource(Viewport, { w: 1600, h: 900, dpr: 1 });
    // Spatially REVERSED vs wire order: layout must follow the wires.
    const n0 = ce.ops.spawnWidget("arr:box", { x: 800, y: 600, w: 100, h: 100, undoable: false });
    const n1 = ce.ops.spawnWidget("arr:box", { x: 400, y: 300, w: 100, h: 100, undoable: false });
    const n2 = ce.ops.spawnWidget("arr:box", { x: 0, y: 0, w: 100, h: 100, undoable: false });
    const w1 = ce.world.spawn({ tags: [Wire] });
    ce.world.setRelation(w1, WireFrom, n0);
    ce.world.setRelation(w1, WireTo, n1);
    const w2 = ce.world.spawn({ tags: [Wire] });
    ce.world.setRelation(w2, WireFrom, n1);
    ce.world.setRelation(w2, WireTo, n2);
    ce.world.sync();
    let now = 0;
    for (let i = 0; i < 5; i++) {
      now += 16;
      ce.step(now);
    }

    ce.ops.arrange({ durationMs: 0, gutter: GUTTER });
    const p0 = ce.world.get(n0, Position) as { x: number; y: number };
    const p1 = ce.world.get(n1, Position) as { x: number; y: number };
    const p2 = ce.world.get(n2, Position) as { x: number; y: number };
    expect(p0.x).toBeLessThan(p1.x); // source column leads
    expect(p1.x).toBeLessThan(p2.x);
    expect(p0.y).toBe(p1.y); // equal-height single-node columns align
    expect(p1.y).toBe(p2.y);
    ce.dispose();
  });

  it("a LONG wired chain wraps into stacked bands instead of dictating the width", () => {
    const ce = createCanvasEngine({ widgets: [BOX] });
    ce.docs.create();
    ce.world.setResource(Viewport, { w: 1600, h: 900, dpr: 1 });
    const nodes: Entity[] = [];
    for (let i = 0; i < 8; i++) {
      nodes.push(ce.ops.spawnWidget("arr:box", { x: i * 250, y: (i % 3) * 200, w: 100, h: 100, undoable: false }));
    }
    for (let i = 0; i < 7; i++) {
      const w = ce.world.spawn({ tags: [Wire] });
      ce.world.setRelation(w, WireFrom, nodes[i] as Entity);
      ce.world.setRelation(w, WireTo, nodes[i + 1] as Entity);
    }
    ce.world.sync();
    let now = 0;
    for (let i = 0; i < 5; i++) {
      now += 16;
      ce.step(now);
    }

    ce.ops.arrange({ durationMs: 0, gutter: GUTTER });
    const ps = nodes.map((e) => ce.world.get(e, Position) as { x: number; y: number });
    const minX = Math.min(...ps.map((p) => p.x));
    // Unwrapped the chain would run 8×100 + 7×48 = 1136 wide; the band
    // (near-square ≈ 444) forces stacked bands.
    for (const p of ps) expect(p.x + 100 - minX).toBeLessThanOrEqual(450);
    expect((ps[1] as { x: number }).x).toBeGreaterThan((ps[0] as { x: number }).x); // band flows with the wires
    expect((ps[3] as { y: number }).y).toBeGreaterThan((ps[0] as { y: number }).y); // later ranks wrap below
    ce.dispose();
  });

  // [AMENDED 2026-08-15, petition I15] This asserted the OLD law — an in-flight
  // widget was SKIPPED — which stranded it at the previous run's target while
  // every other widget re-arranged around it. The law is now retarget: a second
  // Clean Up re-aims live glides instead of abandoning them.
  it("a widget already in flight (TransformTween) is RETARGETED, not skipped", () => {
    const { ce, all } = makeBoard();
    const b = all[1] as Entity;
    ce.world.addComponent(b, TransformTween, { toX: 500, toY: 500, durationMs: 200, elapsedMs: 0 });

    const movers = ce.ops.arrange({ durationMs: 200, gutter: GUTTER });
    expect(movers.includes(b)).toBe(true);

    // Its glide now aims at the NEW layout target, and the ease was not
    // restarted (elapsedMs survives, so the motion continues from where it is).
    const tw = ce.world.get(b, TransformTween) as { toX: number; toY: number };
    const target = ce.docs.current()?.store.getComponent(b, Position) as { x: number; y: number };
    expect({ x: tw.toX, y: tw.toY }).toEqual({ x: target.x, y: target.y });
    expect(tw).not.toEqual({ toX: 500, toY: 500, durationMs: 200, elapsedMs: 0 });
    ce.dispose();
  });

  it("durationMs 0 on an in-flight widget ENDS the glide instead of letting it fight the snap", () => {
    const { ce, all } = makeBoard();
    const b = all[1] as Entity;
    ce.world.addComponent(b, TransformTween, { toX: 500, toY: 500, durationMs: 200, elapsedMs: 0 });

    ce.ops.arrange({ durationMs: 0, gutter: GUTTER });

    // No tween left to ease it back toward (500,500), and the runtime cell
    // agrees with the document — nothing diverged, nothing to strand.
    expect(ce.world.get(b, TransformTween)).toBeUndefined();
    const live = ce.world.get(b, Position) as { x: number; y: number };
    const doc = ce.docs.current()?.store.getComponent(b, Position) as { x: number; y: number };
    expect(live).toEqual({ x: doc.x, y: doc.y });
    ce.dispose();
  });
});
