/**
 * The default keymap over the facade: attach it, select a widget, press Delete —
 * the selection is removed through `ops.deleteSelection`. Facade-only APIs
 * (`attachKeymap`, `engine.ops`, `engine.world`).
 */
import { attachKeymap } from "@ice/react";
import { describe, expect, it } from "vitest";
import { createMoodboardEngine } from "../src/engine";

describe("moodboard keymap", () => {
  it("Delete removes the current selection", () => {
    const { engine } = createMoodboardEngine();
    let now = 0;
    const step = (n = 1): void => {
      for (let i = 0; i < n; i++) {
        now += 16;
        engine.step(now);
      }
    };

    const e = engine.ops.spawnWidget("sticky", { x: 420, y: 420 });
    step(2);
    engine.ops.setSelection([e]);

    const detach = attachKeymap(engine, window);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    step(2);

    expect(engine.world.isAlive(e)).toBe(false);

    detach();
    engine.dispose();
  });
});
