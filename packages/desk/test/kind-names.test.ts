// K4a (design-016 K-L1): no kind imports another. Where one kind's behaviour names another — the mini mat accepts notes, the desk
// calendar pins notes to its days — it names it as a plugin kind would: by the REGISTRY name core or the host resolves at run
// time (a type id, a kind name), never by importing the other kind's module. These pins keep each name the other kind's own.
import { describe, expect, it } from "vitest";
import { PAPER_KIND } from "../src/kinds/paper";
import { PINNABLE_KIND } from "../src/objects/calendar";
import { MINIMAT_TYPE, MiniMat } from "../src/objects/minimat";
import { NOTE_TYPE } from "../src/objects/note";

describe("a kind names another by its registry name (K4a)", () => {
  it("the mini mat accepts the note's own type id, and itself", () => {
    expect(MiniMat.container?.accepts).toEqual([NOTE_TYPE, MINIMAT_TYPE]);
  });
  it("the desk calendar pins the objects of the note's own kind name", () => {
    expect(PINNABLE_KIND).toBe(PAPER_KIND);
  });
});
