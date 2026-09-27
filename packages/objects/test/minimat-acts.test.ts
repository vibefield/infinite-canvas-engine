// K8a (design-016 §5 · K-L2): the mini mat's act — its vinyl cycling sage → slate → charcoal — is the KIND's, declared with its object
// (`defineObject({ menu })`) and run through the engine (`ops.runMenuAction`), where until K8a it was apps/desk's `t` key over the
// type name. On a mixed selection the op reaches the mats alone (the key's old reach); each mat is its own undo step.
import { createCanvasEngine, type Entity } from "@ice/core";
import { describe, expect, it } from "vitest";
import { MiniMat, VINYL_ACT } from "../src/minimat/object";
import { DESK_ENGINE, DESK_OBJECTS } from "../src/preset";

describe("the mini mat's own act (K8a)", () => {
  it("declares the vinyl act with its object and the engine runs it on the selected mats — sage → slate → charcoal → sage, a note untouched", () => {
    expect(MiniMat.menu.map((a) => a.id)).toEqual([VINYL_ACT]);
    const ce = createCanvasEngine({ ...DESK_ENGINE, widgets: [...DESK_OBJECTS] });
    ce.docs.create();
    try {
      const mat = (x: number): Entity => ce.ops.spawnWidget("desk.minimat", { x, y: 0, w: 640, h: 480, props: { name: "M" }, undoable: false });
      const [a, b] = [mat(0), mat(800)];
      const note = ce.ops.spawnWidget("desk.note", { x: 0, y: 600, undoable: false });
      ce.step(16);
      const vinyl = (e: Entity): string | undefined => (ce.world.get(e, MiniMat.groups[0]?.component as never) as { vinyl?: string } | undefined)?.vinyl;
      ce.ops.setSelection([a, b, note], "replace");
      const seen: string[] = [];
      for (let i = 0; i < 3; i++) {
        expect(ce.ops.runMenuAction(VINYL_ACT)).toBe(true);
        ce.step(32 + 16 * i);
        seen.push(`${vinyl(a)}/${vinyl(b)}`);
      }
      expect(seen).toEqual(["slate/slate", "charcoal/charcoal", "sage/sage"]);
      ce.ops.setSelection([note], "replace");
      expect(ce.ops.runMenuAction(VINYL_ACT)).toBe(false);
    } finally {
      ce.dispose();
    }
  });
});
