/**
 * Drift test (mirrors defaults.test.ts + catalog.test.ts's SnapConfig pin):
 * every GestureSettings/PointerSettings field default must equal the
 * compile-time constant it mirrors — an inline-number drift bug shipped once.
 */
import type { Resource } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import { GestureSettings, PointerSettings } from "../src/catalog/settings-resources";
import { GESTURE_DEFAULTS, POINTER_DEFAULTS } from "../src/settings/defaults";

/** Declared default value of a resource field, or undefined if the field has none. */
function defaultOf(res: Resource, name: string): unknown {
  return res.fieldByName.get(name)?.spec.default;
}

describe("GestureSettings (design-003 §4.2 kind table + §5 item 9)", () => {
  it("carries exactly GESTURE_DEFAULTS, field by field", () => {
    for (const key of Object.keys(GESTURE_DEFAULTS) as (keyof typeof GESTURE_DEFAULTS)[]) {
      expect(defaultOf(GestureSettings, key)).toBe(GESTURE_DEFAULTS[key]);
    }
  });

  it("declares no fields beyond GESTURE_DEFAULTS", () => {
    expect(GestureSettings.fields.map((f) => f.name).sort()).toEqual(
      Object.keys(GESTURE_DEFAULTS).sort(),
    );
  });
});

describe("PointerSettings (design-003 §3 L1 targeting)", () => {
  it("carries exactly POINTER_DEFAULTS, field by field", () => {
    for (const key of Object.keys(POINTER_DEFAULTS) as (keyof typeof POINTER_DEFAULTS)[]) {
      expect(defaultOf(PointerSettings, key)).toBe(POINTER_DEFAULTS[key]);
    }
  });

  it("declares no fields beyond POINTER_DEFAULTS", () => {
    expect(PointerSettings.fields.map((f) => f.name).sort()).toEqual(
      Object.keys(POINTER_DEFAULTS).sort(),
    );
  });
});
