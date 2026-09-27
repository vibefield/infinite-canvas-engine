// K4a (design-016 K-L1): no kind imports another. Where one kind's behaviour reaches another's objects — the mini mat holds notes, the
// desk calendar pins notes to its days, the desk canvas places them all — it reaches them by what they PROVIDE (K8a: the desk's
// provides-keys, `@ice/desk`), never by importing the other kind's module and never by its type or kind name (D-K4a.3's names retired).
import { CONTAINABLE, DESK_OBJECT, PINNABLE } from "@ice/desk";
import { describe, expect, it } from "vitest";
import { PINNABLE as CALENDAR_PINS } from "../src/calendar/object";
import { MiniMat } from "../src/minimat/object";
import { Note } from "../src/paper/object";
import { DESK_OBJECTS, DeskCanvas } from "../src/preset";

describe("a kind reaches another's objects by what they provide, never by a name (K4a; K8a)", () => {
  it("the mini mat accepts the one key a note and a mini mat provide — no type name", () => {
    expect(MiniMat.container?.accepts).toEqual([CONTAINABLE]);
    expect(Note.provides).toContain(CONTAINABLE);
    expect(MiniMat.provides).toContain(CONTAINABLE);
  });
  it("the desk calendar pins what provides the desk's PINNABLE key — the note does", () => {
    expect(CALENDAR_PINS).toBe(PINNABLE);
    expect(Note.provides).toContain(PINNABLE);
  });
  it("the desk canvas places by the one key every reference object provides — its placement names no type", () => {
    expect(DeskCanvas.semantic.placement).toEqual({ accepts: [DESK_OBJECT], widgets: [] });
    for (const t of DESK_OBJECTS) expect(t.provides, t.type).toContain(DESK_OBJECT);
  });
});
