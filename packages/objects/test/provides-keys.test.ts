// K8a (design-016 §5 · K-L2 — "no list in the engine names a kind"): until K8a the desk canvas placed a LIST of the six reference types
// (`placement.widgets`) — core refused any other object on the desk — and the mini mat accepted two TYPE NAMES ("desk.note",
// "desk.minimat"), so a plugin kind could lie on neither without posing as a built-in. Both place by PROVIDES-KEYS now (the desk's,
// `@ice/desk`): here FIXTURE plugin kinds, declared in this test and not in `@ice/objects`, join the desk and a mini mat by declaring
// the key, and are refused without it — through core's own placement authority, the one the ops and the drop consult.
import { BoardRoot, createCanvasEngine, type Entity } from "@ice/core";
import { CONTAINABLE, DESK_OBJECT, defineObject, type KindPass, type ObjectKind } from "@ice/desk";
import { describe, expect, it } from "vitest";
import { DESK_ENGINE, DESK_OBJECTS } from "../src/preset";

/** A plugin's kind of the test's own — drawn by no pass here (no device), resolved by nothing: placement never asks. */
const plugKind = (name: string): ObjectKind => ({ name, stratum: "things", reach: 0, create: async () => ({}) as KindPass, resolve: () => ({}), record: () => ({}), hit: () => null });
const Plug = defineObject({ type: "test.plug", version: 1, props: {}, kind: plugKind("plug"), size: { w: 80, h: 80 }, provides: [DESK_OBJECT, CONTAINABLE] });
const DeskOnly = defineObject({ type: "test.desk-only", version: 1, props: {}, kind: plugKind("desk-only"), size: { w: 80, h: 80 }, provides: [DESK_OBJECT] });
const Stray = defineObject({ type: "test.stray", version: 1, props: {}, kind: plugKind("stray"), size: { w: 80, h: 80 } });

function desk() {
  const ce = createCanvasEngine({ ...DESK_ENGINE, widgets: [...DESK_OBJECTS, Plug, DeskOnly, Stray] });
  ce.docs.create();
  const root = ce.world.getResource(BoardRoot)?.root as Entity;
  return { ce, root };
}

describe("placement and a container's accepts by what an object provides (K8a)", () => {
  it("the desk canvas places every reference object AND a plugin kind that provides DESK_OBJECT — and refuses one that does not", () => {
    const { ce, root } = desk();
    try {
      for (const t of DESK_OBJECTS) expect(ce.placement.canPlace(t.type, root).ok, t.type).toBe(true);
      expect(ce.placement.canPlace(Plug.type, root).ok).toBe(true);
      expect(ce.placement.canPlace(DeskOnly.type, root).ok).toBe(true);
      const refused = ce.placement.canPlace(Stray.type, root);
      expect(refused.ok).toBe(false);
      // the op the tray's take and the app's keys spawn through: the plugin lands on the desk, the stray is refused there
      const e = ce.ops.spawnWidget(Plug.type, { x: 0, y: 0, undoable: false });
      expect(ce.world.isAlive(e)).toBe(true);
      expect(() => ce.ops.spawnWidget(Stray.type, { x: 0, y: 0, undoable: false })).toThrow();
    } finally {
      ce.dispose();
    }
  });

  it("the mini mat holds what provides CONTAINABLE — the note, a mini mat, a plugin kind — and nothing else", () => {
    const { ce } = desk();
    try {
      const mat = ce.ops.spawnWidget("desk.minimat", { x: 0, y: 0, w: 640, h: 480, props: { name: "Inbox" }, undoable: false });
      ce.step(16);   // the spawn's facts reach the world at the tick (the container is read off its PrefabId)
      const into = (type: string): boolean => ce.placement.canIngress(type, mat).ok;
      expect(into("desk.note")).toBe(true);
      expect(into("desk.minimat")).toBe(true);
      expect(into(Plug.type)).toBe(true);
      // on the desk but not held by a mat: no chip, no key
      for (const type of ["desk.board", "desk.photo", "desk.notebook", "desk.calendar", DeskOnly.type, Stray.type]) expect(into(type), type).toBe(false);
    } finally {
      ce.dispose();
    }
  });
});
