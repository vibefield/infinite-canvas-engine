/**
 * cull + widgetMount gates (2026-07-15; design-004 §2 lifecycle × the
 * activeMembership gating playbook).
 *
 * The rig runs the REAL derive slice (membership → cull → mount) so the
 * tag-flush timing matches production: membership stamps Active at its flush,
 * cull sees the flip through its journal next tick, mount follows one behind.
 * Pins: idle frames SKIP both systems (run/skip telemetry), camera motion
 * re-culls, Position churn re-tests through the delta path, despawns leave
 * the snapshot, and the keep-mounted LRU still evicts.
 */
import { createWorld } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import {
  Camera,
  ChildOf,
  createActiveMembership,
  createCanvasEngine,
  createEngine,
  createWidgetRuntime,
  Culled,
  defineWidget,
  type Entity,
  Position,
  PrefabId,
  Size,
  Viewport,
  Visible,
  WidgetEquipped,
} from "../src";
import { guardedTransaction } from "../src/guards/guarded-tx";
import { widgetSpawnInits } from "../src/widget/spawn";

function rig(opts: { keepMounted?: number } = {}) {
  const world = createWorld();
  const engine = createEngine(world);
  engine.registerReflector({ name: "armed", observe: { resources: [Camera] }, flush: () => {} });
  engine.enableTelemetry();
  const runtime = createWidgetRuntime(world, opts);
  engine.addSystems("derive", createActiveMembership(world), runtime.cullSystem, runtime.mountSystem);
  engine.registerReflector({ name: "mountFlush", always: true, flush: () => runtime.flush() });
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  world.setResource(Viewport, { w: 800, h: 600, dpr: 1 });
  let now = 0;
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      now += 16;
      engine.step(now);
    }
  };
  const spawn = (x: number, y: number, w = 100, h = 80): Entity =>
    world.spawn({
      components: [
        [Position, { x, y }],
        [Size, { w, h }],
        [PrefabId, { id: "mountbox" }],
      ],
      tags: [WidgetEquipped],
    });
  const ran = (name: string) => engine.lastFrame()?.systems.find((s) => s.system === name)?.ran;
  const entry = (e: Entity) => runtime.store.getSnapshot().find((m) => m.entity === e);
  return { world, step, spawn, ran, entry, runtime };
}

describe("cull + mount gates", () => {
  it("settles to mounted-visible, then IDLE frames skip cull and widgetMount", () => {
    const t = rig();
    const e = t.spawn(100, 100);
    t.step(3); // membership → cull → mount flush chain
    expect(t.world.hasTag(e, Visible)).toBe(true);
    expect(t.entry(e)).toEqual({ entity: e, hidden: false });

    t.step(3); // settled — nothing journals, window static
    expect(t.ran("cull")).toBe(false);
    expect(t.ran("widgetMount")).toBe(false);
  });

  it("camera pan re-culls (full pass); offscreen widget hides but stays mounted", () => {
    const t = rig();
    const e = t.spawn(100, 100);
    t.step(3);
    expect(t.entry(e)?.hidden).toBe(false);

    // Pan far away — the widget leaves the (overscanned) window.
    t.world.setResource(Camera, { x: 100000, y: 100000, zoom: 1, gesturing: false });
    t.step(1);
    expect(t.ran("cull")).toBe(true);
    expect(t.world.hasTag(e, Culled)).toBe(true);
    t.step(1); // mount consumes the flip's journal
    expect(t.entry(e)).toEqual({ entity: e, hidden: true }); // kept-mounted

    t.step(2);
    expect(t.ran("cull")).toBe(false); // window static again → skip
  });

  it("Position churn re-tests through the delta path (no camera motion)", () => {
    const t = rig();
    const e = t.spawn(100, 100);
    t.step(3);
    expect(t.world.hasTag(e, Visible)).toBe(true);

    t.world.edit(e).set(Position, { x: 100000, y: 100000 }); // dragged offscreen
    t.step(1);
    expect(t.ran("cull")).toBe(true);
    expect(t.world.hasTag(e, Culled)).toBe(true);

    t.world.edit(e).set(Position, { x: 200, y: 200 }); // back in view
    t.step(1);
    expect(t.world.hasTag(e, Visible)).toBe(true);
    t.step(1);
    expect(t.entry(e)?.hidden).toBe(false);
  });

  it("despawn leaves the snapshot (journaled removal, no isAlive sweep needed)", () => {
    const t = rig();
    const e = t.spawn(100, 100);
    t.step(3);
    expect(t.entry(e)).toBeDefined();

    t.world.destroy(e);
    t.step(1);
    expect(t.entry(e)).toBeUndefined();
  });

  it("seed through the REAL widget path: container content never flash-mounts (equip-lag fix)", () => {
    // The 2026-07-15 bench diagnostic: membership classified on the
    // projection frame, before equip stamped Container — fresh folder
    // CONTENT flashed root-Active for one frame, cull mass-Visible-tagged it
    // in the flush membership corrected it, and the zombies stayed mounted
    // (6,440 phantoms on a 10k board). The registry fallback answers
    // container-ness from PrefabId during that window.
    const GateLeaf = defineWidget({
      type: "gate-leaf",
      surface: "dom",
      component: () => null,
      defaultSize: { w: 100, h: 60 },
      provides: ["widget"],
    });
    const GateFolder = defineWidget({
      type: "gate-folder",
      surface: "dom",
      component: () => null,
      defaultSize: { w: 300, h: 300 },
      container: { accepts: ["widget"] },
    });
    const ce = createCanvasEngine({ widgets: [GateLeaf, GateFolder] });
    ce.world.setResource(Viewport, { w: 800, h: 600, dpr: 1 });
    ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
    const session = ce.docs.create();
    let folder: Entity | undefined;
    const leaves: Entity[] = [];
    guardedTransaction(
      session.store,
      ce.world,
      (tx) => {
        const f = widgetSpawnInits("gate-folder", { x: 50, y: 50 });
        folder = tx.spawnPrefab(f.prefab, f.overrides);
        for (let k = 0; k < 5; k++) {
          const l = widgetSpawnInits("gate-leaf", { x: 60 + k * 10, y: 60 });
          const leaf = tx.spawnPrefab(l.prefab, l.overrides);
          tx.setRelation(leaf, ChildOf, folder);
          leaves.push(leaf);
        }
      },
      { undoable: false },
    );
    ce.world.sync();
    let now = 0;
    for (let i = 0; i < 5; i++) {
      now += 16;
      ce.engine.step(now);
    }
    // The folder mounts; its content NEVER does (no flash, no zombies).
    const snapshot = ce.runtime.store.getSnapshot();
    expect(snapshot.some((m) => m.entity === folder)).toBe(true);
    for (const leaf of leaves) {
      expect(snapshot.some((m) => m.entity === leaf)).toBe(false);
      expect(ce.world.hasTag(leaf, Visible)).toBe(false);
      expect(ce.world.hasTag(leaf, Culled)).toBe(true);
    }
  });

  it("keep-mounted LRU still evicts the least-recently-visible hidden widget", () => {
    const t = rig({ keepMounted: 1 }); // hidden budget shrinks to keepMounted - visibleCount
    const a = t.spawn(100, 100);
    const b = t.spawn(300, 100);
    t.step(3);
    expect(t.entry(a)?.hidden).toBe(false);
    expect(t.entry(b)?.hidden).toBe(false);

    // Hide A first, settle, then hide B — A is the older hidden entry.
    t.world.edit(a).set(Position, { x: 100000, y: 0 });
    t.step(2);
    t.world.edit(b).set(Position, { x: 100000, y: 100000 });
    t.step(2);

    // Budget 1, zero visible → one hidden survives: the most recent (B).
    expect(t.entry(a)).toBeUndefined(); // evicted for real
    expect(t.entry(b)).toEqual({ entity: b, hidden: true });
  });

  it("pins a globally capped outgoing set, freezes it synchronously, then resumes LRU exactly once", () => {
    const t = rig({ keepMounted: 1 });
    const a = t.spawn(100, 100);
    const b = t.spawn(300, 100);
    t.step(3);
    let notifications = 0;
    t.runtime.store.subscribe(() => {
      notifications += 1;
    });

    const domHold = t.runtime.store.retainForTransition?.([a, b]);
    if (domHold === undefined) throw new Error("expected transition retention");
    expect(domHold.entities).toEqual([a]);
    expect(t.entry(a)).toEqual({ entity: a, hidden: false, frozen: true });
    expect(notifications).toBe(1); // trusted pre-cut freeze is synchronous

    // A second adapter can share A's slot but cannot grow the global outgoing
    // union past keepMounted with disjoint B.
    const glHold = t.runtime.store.retainForTransition?.([a, b]);
    if (glHold === undefined) throw new Error("expected transition retention");
    expect(glHold.entities).toEqual([a]);

    t.world.edit(a).set(Position, { x: 100_000, y: 0 });
    t.world.edit(b).set(Position, { x: 100_000, y: 100_000 });
    t.step(2);
    expect(t.entry(a)).toEqual({ entity: a, hidden: false, frozen: true });
    expect(t.entry(b)).toEqual({ entity: b, hidden: true });

    domHold.release();
    expect(t.entry(a)?.frozen).toBe(true); // GL still owns the shared pin
    glHold.release();
    expect(t.entry(a)).toBeUndefined(); // normal hidden LRU ran immediately
    expect(t.entry(b)).toEqual({ entity: b, hidden: true });
    const afterRelease = notifications;
    glHold.release();
    domHold.release();
    expect(notifications).toBe(afterRelease);
  });

  it("isolates a throwing pre-cut subscriber without stranding the mount hold", () => {
    const t = rig({ keepMounted: 1 });
    const entity = t.spawn(100, 100);
    t.step(3);
    let laterNotifications = 0;
    t.runtime.store.subscribe(() => {
      throw new Error("bad external-store subscriber");
    });
    t.runtime.store.subscribe(() => {
      laterNotifications += 1;
    });

    const hold = t.runtime.store.retainForTransition?.([entity]);
    if (hold === undefined) throw new Error("expected transition retention");
    expect(hold.entities).toEqual([entity]);
    expect(t.entry(entity)).toEqual({ entity, hidden: false, frozen: true });
    expect(laterNotifications).toBe(1);

    expect(() => hold.release()).not.toThrow();
    expect(t.entry(entity)).toEqual({ entity, hidden: false });
    expect(laterNotifications).toBe(2);
  });
});
