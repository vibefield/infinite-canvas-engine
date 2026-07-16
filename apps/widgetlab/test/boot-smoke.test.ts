/**
 * widgetlab boot smoke (headless): the demo engine assembles — 20 widget types
 * registered, 21 seeds spawned at the v1 coordinates (+ the wire-able node
 * trio, 2026-07-16) with 2 pre-seeded wires in ONE clean session
 * (undoable:false ⇒ the user's first ⌘Z is a no-op), and the engine steps
 * without throwing (GL islands stay unmounted — no WebGL in happy-dom).
 */
import { Position, Selected, WidgetEquipped, Wire } from "@ice/core";
import { defineQuery } from "@ice/core";
import { describe, expect, it } from "vitest";
import { createDemoEngine } from "../src/App";
import { WIDGETS } from "../src/widgets";

describe("widgetlab boot smoke", () => {
  it("seeds the v1 scene + node trio: 21 widgets, 2 wires, clean undo stack, engine steps", () => {
    expect(WIDGETS).toHaveLength(20);

    const ce = createDemoEngine();
    const posQ = defineQuery([Position]);
    let count = 0;
    ce.world.query(posQ).each((b) => {
      for (const _r of b) count++;
    });
    expect(count).toBeGreaterThanOrEqual(21); // 18 v1 seeds + 3 nodes (chrome spawns later)

    const wireQ = defineQuery([Wire]);
    let wires = 0;
    ce.world.query(wireQ).each((b) => {
      wires += b.count;
    });
    expect(wires).toBe(2); // signal→filter, filter→scope

    const session = ce.docs.current();
    expect(session).toBeDefined();

    let now = 0;
    for (let i = 0; i < 6; i++) {
      now += 16;
      ce.step(now);
    }
    // seeds were undoable:false — nothing on the user's undo stack
    ce.docs.undo(); // must be a clean no-op, not a scene wipe
    let after = 0;
    ce.world.query(posQ).each((b) => {
      for (const _r of b) after++;
    });
    expect(after).toBeGreaterThanOrEqual(21);
    void Selected;
    void WidgetEquipped;
    ce.dispose();
  });
});
