/**
 * The cursor reflector (design-003 §7 L4; v1 approach): one
 * `host.container.style.cursor` write per DISTINCT `readCursor()` value,
 * zero on a repeat — `always: true` means `flush` runs every step, but the
 * internal last-value cache is what keeps the write itself change-only.
 *
 * `readCursor` is a plain stub closure here (not core's `createCursorSync`):
 * the reflector's contract is entirely "given a string-producing function,
 * write it on change" — core never touches DOM, so this test never imports it.
 */
import { createEngine, createWorld } from "@ice/core";
import { describe, expect, it } from "vitest";
import { createCanvasHost } from "../src/host";
import { createCursorReflector } from "../src/reflectors/cursor";

function setup() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const host = createCanvasHost(container);
  const world = createWorld();
  const engine = createEngine(world);
  let cursor = "default";
  const reflector = createCursorReflector(host, () => cursor);
  engine.registerReflector(reflector);
  return { engine, host, reflector, setCursor: (c: string) => { cursor = c; } };
}

describe("cursor reflector", () => {
  it("paints the initial value on the first flush", () => {
    const { engine, host, reflector } = setup();
    engine.step(0);
    expect(host.container.style.cursor).toBe("default");
    expect(reflector.writes()).toBe(1);
  });

  it("changes write exactly once each; repeats write zero", () => {
    const { engine, host, reflector, setCursor } = setup();

    setCursor("grabbing");
    engine.step(0);
    expect(host.container.style.cursor).toBe("grabbing");
    expect(reflector.writes()).toBe(1);

    // Same value across several more steps — flush runs (always: true) but writes zero.
    engine.step(1);
    engine.step(2);
    engine.step(3);
    expect(host.container.style.cursor).toBe("grabbing");
    expect(reflector.writes()).toBe(1);

    setCursor("grab");
    engine.step(4);
    expect(host.container.style.cursor).toBe("grab");
    expect(reflector.writes()).toBe(2);
  });

  it("cycles through several distinct values with exactly one write per change", () => {
    const { engine, host, reflector, setCursor } = setup();
    const values = ["default", "grab", "grabbing", "ns-resize", "ew-resize", "ew-resize"];

    let now = 0;
    for (const v of values) {
      setCursor(v);
      engine.step(now++);
    }
    // Six steps, one repeat ("ew-resize" twice) → five distinct writes.
    expect(reflector.writes()).toBe(5);
    expect(host.container.style.cursor).toBe("ew-resize");
  });
});
