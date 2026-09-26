/**
 * THE M8 exit test `port-churn` (nodeboard's, ported BY NAME at D5a — design-015 §11.6: an engine fact, on core
 * alone): the LOCKED gating of design-004 §6 / design-001 §5.3 — port ENTITIES are runtime and on-demand, so a
 * steady-state pan with the select tool spawns ZERO ports. A scripted 20-frame middle-button pan far from every
 * node materialises nothing (no connect tool, no hover `Targets`, no connect drag). nodeboard's assertion, six
 * ported nodes spawned through core's paved road (m8-rig.ts) — and one row stronger: the spawn observer is on
 * from the FIRST frame, so a port materialised at rest (before the pan) is caught too. nodeboard attached it
 * after boot, and a select tool that lit every visible port would have spawned them all unseen (D5a's red
 * proof found it). D7: a port that is spawned AND reaped during the pan counts too — the count was of the ports
 * alive at the end, blind to the churn the test is named for.
 */
import type { Entity } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import { Port } from "../src";
import { makeM8Rig, spawnMathNode } from "./m8-rig";

describe("M8 exit (core): zero port churn on a select-tool pan", () => {
  it("a 20-frame pan on empty canvas spawns no Port entities", () => {
    const rig = makeM8Rig();
    const spawned: Entity[] = [];
    // …and the ports REAPED along the way (D7, the surface review's #12): a port spawned and reaped mid-pan was invisible
    // to a count of the ports alive at the end — `onDestroy` fires before teardown, the entity still readable
    const reaped: Entity[] = [];
    rig.world.observe({ onSpawn: (e) => spawned.push(e), onDestroy: (e) => { if (rig.world.has(e, Port)) reaped.push(e); } });
    const ports = (): Entity[] => [...spawned.filter((e) => rig.world.isAlive(e) && rig.world.has(e, Port)), ...reaped];

    for (let i = 0; i < 6; i++) spawnMathNode(rig.session.store, rig.world, 100 + i * 160, 100, i);
    rig.setTool("select");
    rig.step(2); // project + equip + index the nodes
    expect(ports()).toHaveLength(0); // at rest: nothing lit

    // Middle-button pan on empty canvas, far from every node (y ≈ 100).
    rig.down(1500, 1500, 4);
    rig.step();
    for (let f = 0; f < 20; f++) {
      rig.move(1500 - f * 3, 1500 - f * 3);
      rig.step();
    }
    rig.up(1440, 1440);
    rig.step();

    expect(ports()).toHaveLength(0); // the pan: nothing lit
  });
});
