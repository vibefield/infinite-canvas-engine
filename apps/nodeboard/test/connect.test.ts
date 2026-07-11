/**
 * M8 exit (node-board): the connect gesture end-to-end, headless. With the
 * connect tool active, a drag from a math-node's `out` port to a sum-node's `in`
 * port commits ONE wire that the doc sink places — resolved with correct
 * `WirePorts` and `WireFrom`/`WireTo` endpoints after the engine steps and the
 * store syncs.
 *
 * Port anchor positions come from the kernel `portAnchor` over each node's live
 * Position/Size + its (single-port-side) slot — the same math the connect
 * systems and the wires reflector use, so screen coords land dead-on the dots.
 */
import { Wire, WireFrom, WirePorts, WireTo, defineQuery } from "@ice/core";
import { type PortSlot, portAnchor } from "@ice/kernel";
import { describe, expect, it } from "vitest";
import { spawnMathNode, spawnSumNode } from "../src/app";
import { makeRig } from "./rig";

const wireQ = defineQuery([Wire, WirePorts]);
const OUT_E: PortSlot = { side: "e", index: 0, count: 1 };
const IN_W: PortSlot = { side: "w", index: 0, count: 1 };

function firstWire(world: import("@ice/core").World): import("@ice/core").Entity | undefined {
  let found: import("@ice/core").Entity | undefined;
  world.query(wireQ).each((b) => {
    for (const r of b) {
      found = b.entity(r);
      return;
    }
  });
  return found;
}

describe("node-board M8 exit: connect gesture commits a wire", () => {
  it("drag math.out → sum.in spawns a Wire with the right ports + endpoints", () => {
    const rig = makeRig();
    const math = spawnMathNode(rig.session.store, rig.world, 100, 100, 5);
    const sum = spawnSumNode(rig.session.store, rig.world, 450, 100);
    rig.step(3); // project + equip + membership (Active) + spatialSync indexes both

    rig.setTool("connect");
    rig.step(3); // trigger (a) materializes + indexes both nodes' ports

    const src = portAnchor(rig.rectOf(math), OUT_E); // math east-edge midpoint
    const dst = portAnchor(rig.rectOf(sum), IN_W); // sum west-edge midpoint

    rig.down(src.x, src.y); // captures the source out-port (port pick tier)
    rig.step();
    rig.move(src.x + 15, src.y); // exit slop → Active → RoutedConnect
    rig.step();
    rig.move(dst.x, dst.y); // over the target in-port (snaps, compatible)
    rig.step();
    expect(rig.stack.wirePreview.active).toBe(true);
    expect(rig.stack.wirePreview.compatible).toBe(true);
    rig.up(dst.x, dst.y);
    rig.step(); // JustEnded → connect commit (doc sink spawns the wire)

    expect(rig.recorder.intents.filter((i) => i.kind === "connect")).toHaveLength(1);

    rig.step(2); // wire structure projects at sync
    const wire = firstWire(rig.world);
    expect(wire).toBeDefined();
    if (wire === undefined) return;
    expect(rig.world.read(wire, WirePorts)).toEqual({ from: "out", to: "in" });
    expect(rig.world.getRelation(wire, WireFrom)).toBe(math);
    expect(rig.world.getRelation(wire, WireTo)).toBe(sum);
  });
});
