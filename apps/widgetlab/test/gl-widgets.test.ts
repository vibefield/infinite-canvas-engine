/**
 * GL (R3F) card registration + shape tests (task 64). Headless: no WebGL, no
 * <Canvas> — importing the barrel runs the `defineWidget` side effects and we
 * assert the registry shape only (registration throwing would fail the import).
 */
import { describe, expect, it } from "vitest";
import { SIZE as CRYSTAL } from "../src/widgets/CrystalWidget";
import { SIZE as FLOATING } from "../src/widgets/FloatingCubeWidget";
import { GL_WIDGETS } from "../src/widgets/gl";
import { SIZE as GOLD } from "../src/widgets/GoldKnotCard";
import { SIZE as MATTE } from "../src/widgets/MatteSphereCard";
import { SIZE as ORBIT } from "../src/widgets/OrbitCubeCard";
import { SIZE as SHAPES } from "../src/widgets/ShapesCard";
import { SIZE as TORUS } from "../src/widgets/TorusKnotCard";

// Verbatim v1 `type` ids, in barrel order, with their v1 size preset + whether
// the island repaints every visible frame (`animated`).
const EXPECTED = [
  { type: "matte-sphere-card", size: MATTE, animated: false },
  { type: "crystal-widget", size: CRYSTAL, animated: true },
  { type: "torus-knot-card", size: TORUS, animated: true },
  { type: "floating-cube-widget", size: FLOATING, animated: true },
  { type: "gold-knot-card", size: GOLD, animated: true },
  { type: "shapes-card", size: SHAPES, animated: true },
  { type: "orbit-cube-card", size: ORBIT, animated: false },
] as const;

// v1 presets (px): small 155×155, medium 329×155, large 329×345, xl 329×535.
const PRESETS = {
  "matte-sphere-card": { w: 155, h: 155 },
  "crystal-widget": { w: 155, h: 155 },
  "torus-knot-card": { w: 329, h: 155 },
  "floating-cube-widget": { w: 329, h: 155 },
  "gold-knot-card": { w: 329, h: 345 },
  "shapes-card": { w: 329, h: 345 },
  "orbit-cube-card": { w: 329, h: 155 },
} as const;

describe("GL_WIDGETS", () => {
  it("registers exactly 7 gl-surface cards", () => {
    expect(GL_WIDGETS).toHaveLength(7);
    for (const w of GL_WIDGETS) expect(w.surface).toBe("gl");
  });

  it("has the verbatim v1 type ids, unique and in order", () => {
    const ids = GL_WIDGETS.map((w) => w.type);
    expect(ids).toEqual(EXPECTED.map((e) => e.type));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("carries each v1 size preset as defaultSize (and matches the SIZE export)", () => {
    for (const { type, size } of EXPECTED) {
      const w = GL_WIDGETS.find((x) => x.type === type);
      expect(w, type).toBeDefined();
      expect(w?.defaultSize).toEqual(PRESETS[type]);
      // The per-file SIZE const is the single source for defaultSize.
      expect({ w: size.w, h: size.h }).toEqual(PRESETS[type]);
    }
  });

  it("opts animated islands in and leaves static/event-driven ones off", () => {
    for (const { type, animated } of EXPECTED) {
      const w = GL_WIDGETS.find((x) => x.type === type);
      expect(w?.animated, type).toBe(animated);
    }
  });

  it("exposes a default 'props' group per card (the prop cells)", () => {
    for (const w of GL_WIDGETS) {
      expect(w.groups.some((g) => g.name === "props"), w.type).toBe(true);
    }
  });
});
