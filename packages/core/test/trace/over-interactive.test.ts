/**
 * OverInteractive — the hover-time widget-boundary tag (design-002 §8
 * amendment, 2026-07-18). Ingest folds the adapters' `overInteractive` fact
 * into a PERSISTENT change-only tag on the pointer entity:
 *   - stamped true  → tag added;
 *   - stamped false → tag removed;
 *   - unstamped facts (wheel, blur cancel, drivers that don't track hover)
 *     leave the tag exactly as it was — absent is "no information", not false.
 */
import { describe, expect, it } from "vitest";
import { NO_MODS, OverInteractive, type InputEvent } from "../../src";
import { createTraceRig } from "./rig";

function fact(partial: Partial<InputEvent> & Pick<InputEvent, "kind">): InputEvent {
  return {
    pointerId: "mouse",
    device: "mouse",
    screenX: 10,
    screenY: 10,
    buttons: 0,
    mods: NO_MODS,
    ...partial,
  };
}

describe("trace — OverInteractive hover tag", () => {
  it("sets the tag from a stamped move, clears it on a false stamp", () => {
    const rig = createTraceRig();
    rig.move("mouse", 10, 10); // unstamped spawn move — no tag
    rig.step();
    const p = rig.pointerEntity("mouse");
    expect(p).toBeDefined();
    if (p === undefined) return;
    expect(rig.world.hasTag(p, OverInteractive)).toBe(false);

    rig.core.queue.enqueue(fact({ kind: "move", overInteractive: true }));
    rig.step();
    expect(rig.world.hasTag(p, OverInteractive)).toBe(true);

    rig.core.queue.enqueue(fact({ kind: "move", overInteractive: false }));
    rig.step();
    expect(rig.world.hasTag(p, OverInteractive)).toBe(false);
  });

  it("holds the tag across ticks with no hover-bearing fact (wheel, idle)", () => {
    const rig = createTraceRig();
    rig.core.queue.enqueue(fact({ kind: "move", overInteractive: true }));
    rig.step();
    const p = rig.pointerEntity("mouse");
    expect(p).toBeDefined();
    if (p === undefined) return;
    expect(rig.world.hasTag(p, OverInteractive)).toBe(true);

    rig.wheel(10, 10, 0, 40); // wheel facts never carry hover truth
    rig.step();
    expect(rig.world.hasTag(p, OverInteractive)).toBe(true);

    rig.step(3); // idle frames — nothing drains, nothing clears
    expect(rig.world.hasTag(p, OverInteractive)).toBe(true);
  });

  it("seeds the tag on the pointer's SPAWN frame from a stamped down (touch first-contact)", () => {
    const rig = createTraceRig();
    rig.core.queue.enqueue(
      fact({ kind: "down", pointerId: "touch:1", device: "touch", buttons: 1, overInteractive: true }),
    );
    rig.step();
    const p = rig.pointerEntity("touch:1");
    expect(p).toBeDefined();
    if (p === undefined) return;
    expect(rig.world.hasTag(p, OverInteractive)).toBe(true);
  });

  it("unstamped traces never grow the tag (rig facts carry no hover field)", () => {
    const rig = createTraceRig();
    const box = rig.spawnBox({ x: 0, y: 0 });
    rig.target("mouse", box);
    rig.move("mouse", 10, 10);
    rig.down("mouse", 10, 10);
    rig.step(2);
    const p = rig.pointerEntity("mouse");
    expect(p).toBeDefined();
    if (p === undefined) return;
    expect(rig.world.hasTag(p, OverInteractive)).toBe(false);
  });
});
