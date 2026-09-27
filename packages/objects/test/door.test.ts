// K4b (design-016 §5): `@ice/objects` is the reference objects' door — what `@vibecook/ice/desk/objects` publishes. An app
// registers the six through it (`createCanvasEngine(DESK_ENGINE)`), and each is a desk object: a widget type whose face is
// a desk kind, found again through `objectKindOf` — never a second registry.
import { objectKindOf } from "@ice/desk";
import { describe, expect, it } from "vitest";
import { DESK_ENGINE, DESK_OBJECTS, DeskCanvas, deskPalette } from "../src/index";

describe("@ice/objects — the reference objects' door", () => {
  it("names the six reference objects, in the order an app registers them, each bound to its desk kind", () => {
    expect(DESK_OBJECTS.map((o) => objectKindOf(o)?.name)).toEqual(["paper", "minimat", "board", "photo", "notebook", "calendar"]);
    expect(DESK_ENGINE.widgets).toEqual([...DESK_OBJECTS]);
    expect(DESK_ENGINE.rootCanvas).toBe(DeskCanvas);
  });

  it("ships the complete default palette the desk layer mounts with, in both themes", () => {
    for (const theme of ["light", "dark"] as const) expect(Object.keys(deskPalette(theme)).length).toBeGreaterThan(0);
  });
});
