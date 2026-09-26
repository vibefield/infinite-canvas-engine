/**
 * The cull gate (2026-07-15; design-004 §2 lifecycle × the activeMembership
 * gating playbook), as it stands after design-015 D5b: the mount system, its
 * keep-mounted LRU and the transition retention it served left with the DOM
 * hosts and GL islands they kept mounted — `Visible`/`Culled` is the desk
 * renderer's working set and the cull is the whole runtime.
 *
 * The rig runs the REAL derive slice (membership → cull) so the tag-flush timing
 * matches production: membership stamps Active at its flush, cull sees the flip
 * through its journal next tick. Pins: idle frames SKIP the cull (run/skip
 * telemetry), camera motion re-culls, Position churn re-tests through the delta
 * path, and the equip-lag fix keeps fresh container content Culled.
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

function rig() {
  const world = createWorld();
  const engine = createEngine(world);
  engine.registerReflector({ name: "armed", observe: { resources: [Camera] }, flush: () => {} });
  engine.enableTelemetry();
  const runtime = createWidgetRuntime(world);
  engine.addSystems("derive", createActiveMembership(world), runtime.cullSystem);
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
  return { world, step, spawn, ran, runtime };
}

describe("the cull gate", () => {
  it("settles to Visible, then IDLE frames skip the cull", () => {
    const t = rig();
    const e = t.spawn(100, 100);
    t.step(3); // membership → cull chain
    expect(t.world.hasTag(e, Visible)).toBe(true);

    t.step(3); // settled — nothing journals, window static
    expect(t.ran("cull")).toBe(false);
  });

  it("camera pan re-culls (full pass); an offscreen widget is Culled, and a static window skips again", () => {
    const t = rig();
    const e = t.spawn(100, 100);
    t.step(3);
    expect(t.world.hasTag(e, Visible)).toBe(true);

    // Pan far away — the widget leaves the (overscanned) window.
    t.world.setResource(Camera, { x: 100000, y: 100000, zoom: 1, gesturing: false });
    t.step(1);
    expect(t.ran("cull")).toBe(true);
    expect(t.world.hasTag(e, Culled)).toBe(true);
    expect(t.world.hasTag(e, Visible)).toBe(false);

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
  });

  it("seed through the REAL widget path: container content is Culled from its first frame (equip-lag fix)", () => {
    // The 2026-07-15 bench diagnostic: membership classified on the
    // projection frame, before equip stamped Container — fresh folder
    // CONTENT flashed root-Active for one frame, cull mass-Visible-tagged it
    // in the flush membership corrected it, and the zombies stayed mounted
    // (6,440 phantoms on a 10k board). The registry fallback answers
    // container-ness from PrefabId during that window.
    const GateLeaf = defineWidget({
      type: "gate-leaf",
      defaultSize: { w: 100, h: 60 },
      provides: ["widget"],
    });
    const GateFolder = defineWidget({
      type: "gate-folder",
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
    // The folder is Visible; its content NEVER is (no flash, no zombies).
    expect(folder !== undefined && ce.world.hasTag(folder, Visible)).toBe(true);
    for (const leaf of leaves) {
      expect(ce.world.hasTag(leaf, Visible)).toBe(false);
      expect(ce.world.hasTag(leaf, Culled)).toBe(true);
    }
    ce.dispose();
  });
});
