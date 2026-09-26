// @vitest-environment node
/**
 * ⌥ on a drop-into (design-015 D4a × D2b — the recorded, provisional design): ⌥ at the drag's START leaves a copy where the
 * object lay (`LeavesCopy`, latched at the claim); ⌥ at the RELEASE keeps the moved object on this desk. The four
 * combinations, all through the facade's doc session (so "one transaction" is the undo stack's truth):
 *   start ⌥ · release ⌥   → a copy at the origin, the original kept on this desk (a plain move + copy — D4a's path);
 *   start ⌥ · release —   → a copy at the origin, the original INTO the mini mat — in the consume's ONE transaction;
 *   start — · release ⌥   → no copy, kept on this desk;
 *   start — · release —   → no copy, into the mini mat.
 * Before 2026-09-26 the consume path ignored `LeavesCopy`: the second row left no copy.
 */
import { describe, expect, it } from "vitest";
import {
  Camera,
  ChildOf,
  NO_MODS,
  Position,
  PrefabId,
  Size,
  Viewport,
  createCanvasEngine,
  defineQuery,
  defineWidget,
  p,
  widgets,
  type Entity,
  type InputMods,
} from "../src";

// One widget type per FILE (global registry; no test reset).
const NOTE =
  widgets.get("ccopy:note") ??
  defineWidget({
    type: "ccopy:note", surface: "object", object: { name: "paper" }, stratum: "things", defaultSize: { w: 200, h: 200 },
    props: { label: p.string({ default: "" }) }, provides: ["note"], interaction: { snap: "none" },
  });
const MAT =
  widgets.get("ccopy:mat") ??
  defineWidget({
    type: "ccopy:mat", surface: "object", object: { name: "minimat" }, stratum: "sheets", defaultSize: { w: 640, h: 480 }, interaction: { snap: "none" },
    container: { accepts: ["note"], provides: ["mat"], portal: { top: 32, right: 32, bottom: 32, left: 32 } },
  });

const prefabQ = defineQuery([PrefabId]);

function rig() {
  const ce = createCanvasEngine({ widgets: [NOTE, MAT], settings: { snap: { enabled: false } } });
  ce.docs.create();
  ce.world.setResource(Viewport, { w: 800, h: 600, dpr: 1 });
  ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false }); // screen == world
  let now = 1000;
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; ce.step(now); } };
  const mouse = (kind: "down" | "move" | "up", x: number, y: number, buttons: number, mods?: Partial<InputMods>): void => {
    ce.stack.queue.enqueue({ kind, pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons, mods: { ...NO_MODS, ...mods } });
  };
  /**
   * The note from (300, 250) to the mat face's centre (900, 500) in 8 samples: ⌥ on the press and the first two samples
   * (the claim reads it there) when `altAtStart`, ⌥ on the last samples and the release when `altAtRelease`.
   */
  const drag = (altAtStart: boolean, altAtRelease: boolean): void => {
    const from = [300, 250] as const;
    const to = [900, 500] as const;
    mouse("move", from[0], from[1], 0);
    step();
    mouse("down", from[0], from[1], 1, { alt: altAtStart });
    step();
    for (let i = 1; i <= 8; i++) {
      const alt = i <= 2 ? altAtStart : i >= 7 ? altAtRelease : false;
      mouse("move", from[0] + ((to[0] - from[0]) * i) / 8, from[1] + ((to[1] - from[1]) * i) / 8, 1, { alt });
      step();
    }
    mouse("up", to[0], to[1], 0, { alt: altAtRelease });
    step(4);
  };
  const spawn = (type: string, x: number, y: number, w: number, h: number, props?: Record<string, unknown>): Entity => {
    const e = ce.ops.spawnWidget(type, { x, y, w, h, undoable: false, ...(props !== undefined ? { props } : {}) });
    ce.world.sync();
    step(3);
    return e;
  };
  const mat = spawn("ccopy:mat", 580, 260, 640, 480);
  const note = spawn("ccopy:note", 200, 150, 200, 200, { label: "n1" });
  const root = ce.world.getRelation(note, ChildOf) as Entity;
  const notes = (): Entity[] => {
    const out: Entity[] = [];
    ce.world.query(prefabQ).each((b) => {
      for (const r of b) {
        const e = b.entity(r);
        if (ce.world.get(e, PrefabId)?.id === NOTE.type) out.push(e);
      }
    });
    return out;
  };
  const label = (e: Entity): unknown => (ce.world.get(e, NOTE.groups[0]?.component as never) as { label?: string } | undefined)?.label;
  return { ce, world: ce.world, step, drag, mat, note, root, notes, label };
}

describe("⌥ on a drop into a mini mat — the copy and the keep, all four ways", () => {
  it("⌥ at the START, let go of before the drop: a copy stays at the origin AND the original goes in — one transaction, one ⌘Z", () => {
    const r = rig();
    r.drag(true, false);
    expect(r.world.getRelation(r.note, ChildOf)).toBe(r.mat); // the original went in
    const copies = r.notes().filter((e) => e !== r.note);
    expect(copies).toHaveLength(1); // …and left a copy behind
    const copy = copies[0] as Entity;
    expect(r.world.getRelation(copy, ChildOf)).toBe(r.root); // on this desk
    expect(r.world.get(copy, Position)).toEqual({ x: 200, y: 150 }); // where the original lay
    expect(r.world.get(copy, Size)).toEqual({ w: 200, h: 200 });
    expect(r.label(copy)).toBe("n1"); // its props
    expect(r.world.getReverse(r.root, ChildOf).at(-1)).toBe(copy); // in the original's (lifted) place: on top
    // ONE transaction: one ⌘Z takes the copy away AND brings the original back out
    expect(r.ce.docs.undo()).toBe(true);
    r.step(3);
    expect(r.notes()).toEqual([r.note]);
    expect(r.world.getRelation(r.note, ChildOf)).toBe(r.root);
    expect(r.world.get(r.note, Position)).toEqual({ x: 200, y: 150 });
    expect(r.ce.docs.undo()).toBe(false); // nothing else was on the stack
    r.ce.dispose();
  });

  it("⌥ held throughout: a copy at the origin, the original kept on this desk (D4a's move + copy)", () => {
    const r = rig();
    r.drag(true, true);
    expect(r.world.getRelation(r.note, ChildOf)).toBe(r.root);
    const copies = r.notes().filter((e) => e !== r.note);
    expect(copies).toHaveLength(1);
    expect(r.world.get(copies[0] as Entity, Position)).toEqual({ x: 200, y: 150 });
    r.ce.dispose();
  });

  it("⌥ at the release only: kept on this desk, no copy; no ⌥ at all: into the mat, no copy (the controls)", () => {
    const r = rig();
    r.drag(false, true);
    expect(r.world.getRelation(r.note, ChildOf)).toBe(r.root);
    expect(r.notes()).toEqual([r.note]);
    r.ce.dispose();
    const s = rig();
    s.drag(false, false);
    expect(s.world.getRelation(s.note, ChildOf)).toBe(s.mat);
    expect(s.notes()).toEqual([s.note]);
    s.ce.dispose();
  });
});
