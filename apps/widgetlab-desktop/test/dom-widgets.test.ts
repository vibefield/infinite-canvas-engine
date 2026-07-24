/**
 * DOM-widget barrel smoke (task 63): the 9 ported cards register cleanly.
 *
 * Importing the barrel runs every `defineWidget` side effect exactly once —
 * `defineWidget` throws on a duplicate type, so a clean import is itself the
 * no-duplicate assertion. We further pin: 9 entries, the exact v1 type-id set,
 * ids unique, and that each is retrievable from the core registry.
 */
import { Resizable, widgets } from "@ice/core";
import { describe, expect, it } from "vitest";
import { DOM_WIDGETS } from "../src/widgets/dom";

/** The v1 playground card type ids, verbatim (order-independent set). */
const V1_TYPE_IDS = [
  "clock-card",
  "battery-card",
  "calendar-card",
  "weather-card",
  "stocks-card",
  "fitness-card",
  "photos-card",
  "todo-list-card",
  "debug-resizable",
];

describe("widgetlab DOM widgets", () => {
  it("exports exactly 9 widgets", () => {
    expect(DOM_WIDGETS).toHaveLength(9);
  });

  it("covers the exact v1 type-id set, with no duplicates", () => {
    const ids = DOM_WIDGETS.map((w) => w.type);
    expect(new Set(ids).size).toBe(ids.length); // unique
    expect(new Set(ids)).toEqual(new Set(V1_TYPE_IDS));
  });

  it("registered each type in the core widget registry", () => {
    for (const w of DOM_WIDGETS) {
      expect(widgets.get(w.type)).toBe(w);
    }
  });

  it("marks only DebugResizable resizable; cards are non-resizable", () => {
    const resizable = DOM_WIDGETS.filter((w) => w.capabilityTags.includes(Resizable)).map(
      (w) => w.type,
    );
    expect(resizable).toEqual(["debug-resizable"]);
  });
});
