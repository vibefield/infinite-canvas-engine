/**
 * Tray insert-by-drag — ghost adoption end to end (2026-07-19, James: the
 * widget tray — "the widget duplicate … and user drag it to canvas and drop,
 * it lift down and live at the placed location. if user cancle the drag or
 * drapped at invalid place, it will flyback to tray and destroy").
 *
 * Pinned, all through the REAL facade (createCanvasEngine + doc session — the
 * commit path is the doc sink, so undo depth is the truth being tested):
 *  - ops.insertByDrag spawns a DRAFT ghost centered under the pointer and the
 *    ordinary drag stack adopts it via the synthetic down (same-tick pick);
 *  - drop = ONE create transaction: durable twin at the final position, prop
 *    overrides applied, twin selected, ghost swapped out, ONE undo step;
 *  - drop into an accepting container creates INSIDE it (ChildOf + local pos);
 *  - cancel / rejected-by-Solid = fly-back tween toward the tray press point,
 *    ghost despawned, document untouched (undo has nothing);
 *  - a longPress-drag widget type still drags INSTANTLY from the tray;
 *  - a click without a drag strands no ghost.
 */
import { describe, expect, it } from "vitest";
import {
  Grab,
  GhostRetiring,
  InsertGhost,
  NO_MODS,
  Position,
  PrefabId,
  Selected,
  TransformTween,
  Viewport,
  ChildOf,
  createCanvasEngine,
  defineQuery,
  defineWidget,
  p,
  widgets,
  type CanvasEngine,
  type Entity,
} from "../../src";

const CARD =
  widgets.get("ins:card") ??
  defineWidget({
    type: "ins:card",
    surface: "dom",
    component: null,
    props: { label: p.string({ default: "note" }) },
    defaultSize: { w: 100, h: 80 },
    interaction: { selectable: true, movable: true, snap: "target", dragOn: "press" },
    provides: ["widget"],
  });
const FOLDER =
  widgets.get("ins:folder") ??
  defineWidget({
    type: "ins:folder",
    surface: "dom",
    component: null,
    defaultSize: { w: 200, h: 200 },
    interaction: { selectable: false, movable: false },
    container: { accepts: ["widget"] },
  });
const SOLID =
  widgets.get("ins:solid") ??
  defineWidget({
    type: "ins:solid",
    surface: "dom",
    component: null,
    defaultSize: { w: 160, h: 120 },
    interaction: { selectable: true, movable: true, solid: true, dragOn: "press" },
  });
const HOLD =
  widgets.get("ins:hold") ??
  defineWidget({
    type: "ins:hold",
    surface: "dom",
    component: null,
    defaultSize: { w: 100, h: 80 },
    interaction: { selectable: true, movable: true, dragOn: "longPress" },
    provides: ["widget"],
  });

const prefabQ = defineQuery([PrefabId]);

/** Alive durable twins of `type` (≠ any ghost — ghosts carry InsertGhost). */
function twinsOf(ce: CanvasEngine, type: string): Entity[] {
  const out: Entity[] = [];
  ce.world.query(prefabQ).each((b) => {
    for (const r of b) {
      const e = b.entity(r);
      if (ce.world.get(e, PrefabId)?.id === type && !ce.world.has(e, InsertGhost)) out.push(e);
    }
  });
  return out;
}

function boot() {
  const ce = createCanvasEngine({ widgets: [CARD, FOLDER, SOLID, HOLD] });
  ce.docs.create();
  ce.world.setResource(Viewport, { w: 1600, h: 900, dpr: 1 });
  ce.world.sync();
  let now = 1000;
  const step = (n = 1): void => {
    for (let i = 0; i < n; i++) {
      now += 16;
      ce.step(now);
    }
  };
  const mouse = (kind: "down" | "move" | "up", x: number, y: number, buttons: number): void => {
    ce.stack.queue.enqueue({ kind, pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons, mods: NO_MODS });
  };
  step(3);
  return { ce, step, mouse };
}

describe("trace: tray insert-by-drag (ghost adoption)", () => {
  it("insert → drag → drop: ONE create tx, twin at final pos with props, selected, one undo step", () => {
    const { ce, step, mouse } = boot();
    const bystander = ce.ops.spawnWidget("ins:card", { x: 900, y: 100, undoable: false });
    ce.world.sync();
    step(2);
    ce.ops.setSelection([bystander]); // the insert must REPLACE this, not join it

    const ghost = ce.ops.insertByDrag("ins:card", { screenX: 400, screenY: 300, props: { label: "hello" } });
    expect(ce.world.has(ghost, InsertGhost)).toBe(true);
    expect(ce.world.get(ghost, Position)).toEqual({ x: 350, y: 260 }); // centered (identity cam)

    step(); // down ingested; same-tick pick captured the ghost
    mouse("move", 415, 300, 1); // dead-zone exit — drag origin
    step();
    expect(ce.world.has(ghost, Grab)).toBe(true); // adopted: a real move claim
    expect(ce.world.hasTag(ghost, Selected)).toBe(true);
    expect(ce.world.hasTag(bystander, Selected)).toBe(false); // solo claim, replaced

    mouse("move", 600, 500, 1); // totals (185, 200) from the origin
    step();
    expect(ce.world.get(ghost, Position)).toEqual({ x: 535, y: 460 });

    mouse("up", 600, 500, 0);
    step(3); // commit tick + swap tick
    expect(ce.world.isAlive(ghost)).toBe(false); // ghost reaped

    const twins = twinsOf(ce, "ins:card").filter((e) => e !== bystander);
    expect(twins).toHaveLength(1);
    const twin = twins[0] as Entity;
    expect(ce.world.get(twin, Position)).toEqual({ x: 535, y: 460 });
    expect(ce.world.hasTag(twin, Selected)).toBe(true); // selection transferred
    const group = CARD.groups.find((g) => g.name === "props");
    expect(group).toBeDefined();
    // biome-ignore lint/style/noNonNullAssertion: asserted above
    expect((ce.world.get(twin, group!.component) as { label?: string } | undefined)?.label).toBe("hello");

    expect(ce.docs.undo()).toBe(true); // the ONE step
    step(2);
    expect(twinsOf(ce, "ins:card").filter((e) => e !== bystander)).toHaveLength(0);
    expect(ce.docs.undo()).toBe(false); // nothing else — insert was atomic
    ce.dispose();
  });

  it("drop over an accepting container creates INSIDE it (ChildOf + container-local pos)", () => {
    const { ce, step, mouse } = boot();
    const folder = ce.ops.spawnWidget("ins:folder", { x: 600, y: 300, undoable: false });
    ce.world.sync();
    step(2);

    const ghost = ce.ops.insertByDrag("ins:card", { screenX: 100, screenY: 100 });
    step();
    mouse("move", 115, 100, 1);
    step();
    mouse("move", 700, 400, 1); // over the folder body
    step();
    mouse("up", 700, 400, 0);
    step(3);

    expect(ce.world.isAlive(ghost)).toBe(false);
    const twins = twinsOf(ce, "ins:card");
    expect(twins).toHaveLength(1);
    const twin = twins[0] as Entity;
    expect(ce.world.getRelation(twin, ChildOf)).toBe(folder);
    const local = ce.world.get(twin, Position);
    expect(local).toBeDefined();
    // Container-local free-slot coords — inside the folder's own 200×200 frame.
    // biome-ignore lint/style/noNonNullAssertion: asserted above
    expect(local!.x).toBeGreaterThanOrEqual(-100);
    // biome-ignore lint/style/noNonNullAssertion: asserted above
    expect(local!.x).toBeLessThanOrEqual(300);
    expect(ce.world.hasTag(twin, Selected)).toBe(true);
    ce.dispose();
  });

  it("cancel mid-drag: fly-back tween toward the tray press point, ghost despawns, no undo entry", () => {
    const { ce, step, mouse } = boot();
    const ghost = ce.ops.insertByDrag("ins:card", { screenX: 400, screenY: 300 });
    step();
    mouse("move", 415, 300, 1);
    step();
    mouse("move", 800, 600, 1);
    step();
    expect(ce.world.has(ghost, Grab)).toBe(true);

    ce.ops.cancelActiveGestures();
    step(2); // cancel sweep → behave cancel path
    expect(ce.world.hasTag(ghost, GhostRetiring)).toBe(true);
    const tween = ce.world.get(ghost, TransformTween);
    expect(tween).toBeDefined();
    // Home = the tray press point re-projected (identity cam): centered spawn.
    // biome-ignore lint/style/noNonNullAssertion: asserted above
    expect(tween!.toX).toBe(350);
    // biome-ignore lint/style/noNonNullAssertion: asserted above
    expect(tween!.toY).toBe(260);

    step(20); // ride the 200ms tween home (+ the reap)
    expect(ce.world.isAlive(ghost)).toBe(false);
    expect(twinsOf(ce, "ins:card")).toHaveLength(0);
    expect(ce.docs.undo()).toBe(false); // the document never heard about it
    ce.dispose();
  });

  it("release over a Solid widget is a rejected drop: fly-back + despawn, nothing created", () => {
    const { ce, step, mouse } = boot();
    ce.ops.spawnWidget("ins:solid", { x: 600, y: 400, undoable: false });
    ce.world.sync();
    step(2);

    const ghost = ce.ops.insertByDrag("ins:card", { screenX: 100, screenY: 100 });
    step();
    mouse("move", 115, 100, 1);
    step();
    mouse("move", 660, 450, 1); // over the solid card
    step();
    mouse("up", 660, 450, 0);
    step(2);
    expect(ce.world.hasTag(ghost, GhostRetiring)).toBe(true); // rejected → home
    step(20);
    expect(ce.world.isAlive(ghost)).toBe(false);
    expect(twinsOf(ce, "ins:card")).toHaveLength(0);
    expect(ce.docs.undo()).toBe(false);
    ce.dispose();
  });

  it("a longPress-drag type drags INSTANTLY from the tray (LongPressDrag withheld on ghosts)", () => {
    const { ce, step, mouse } = boot();
    const ghost = ce.ops.insertByDrag("ins:hold", { screenX: 400, screenY: 300 });
    step();
    mouse("move", 415, 300, 1); // instant dead-zone exit, no 500ms hold
    step();
    expect(ce.world.has(ghost, Grab)).toBe(true);
    mouse("up", 415, 300, 0);
    step(3);
    expect(twinsOf(ce, "ins:hold")).toHaveLength(1);
    ce.dispose();
  });

  it("a click without a drag strands nothing: ghost reaped, no create", () => {
    const { ce, step, mouse } = boot();
    const ghost = ce.ops.insertByDrag("ins:card", { screenX: 400, screenY: 300 });
    step();
    mouse("up", 400, 300, 0); // released inside the dead zone — drag never formed
    step(3);
    expect(ce.world.isAlive(ghost)).toBe(false);
    expect(twinsOf(ce, "ins:card")).toHaveLength(0);
    ce.dispose();
  });
});
