/**
 * M8 exit (node-board): the LOCKED gating from design-004 §6 / design-001 §5.3 —
 * port ENTITIES are runtime and on-demand, so steady-state pan with the select
 * tool spawns ZERO ports. A scripted 20-frame middle-button pan far from every
 * node materializes nothing (no connect tool, no hover-Targets, no connect drag).
 */
import { Port } from "@ice/core";
import { describe, expect, it } from "vitest";
import { spawnMathNode } from "../src/app";
import { makeRig } from "./rig";

describe("node-board M8 exit: zero port churn on a select-tool pan", () => {
  it("a 20-frame pan on empty canvas spawns no Port entities", () => {
    const rig = makeRig();
    for (let i = 0; i < 6; i++) spawnMathNode(rig.session.store, rig.world, 100 + i * 160, 100, i);
    rig.setTool("select");
    rig.step(2); // project + equip + index the nodes

    const spawned: import("@ice/core").Entity[] = [];
    rig.world.observe({ onSpawn: (e) => spawned.push(e) });

    // Middle-button pan on empty canvas, far from every node (y ≈ 100).
    rig.down(1500, 1500, 4);
    rig.step();
    for (let f = 0; f < 20; f++) {
      rig.move(1500 - f * 3, 1500 - f * 3);
      rig.step();
    }
    rig.up(1440, 1440);
    rig.step();

    const portSpawns = spawned.filter((e) => rig.world.isAlive(e) && rig.world.has(e, Port));
    expect(portSpawns).toHaveLength(0);
  });
});
