// @vitest-environment node
// ROOT OBJECTS (design-015 §9, D-D18): the whiteboard, the notebook and the desk calendar never go into a mini mat —
// each declares `interaction.drop: "never"`, which the drop system reads off the COMPILED type (l3-drop.ts), so no
// container takes one, whatever it would accept: here a tray that names all three among the widgets it takes, and a
// note (the control) that does go in. A print is not core-movable (D-D3w.4): its drop-into is owed with its carry.
import { Camera, ChildOf, createCanvasEngine, defineWidget, NO_MODS, Position, Size, Viewport, widgets } from "@ice/core";
import { describe, expect, it } from "vitest";
import { Board, BOARD_TYPE, Calendar, CALENDAR_TYPE, DESK_OBJECTS, Note, NOTE_TYPE, Notebook, NOTEBOOK_TYPE, Photo } from "../src/objects";

const MARGIN = 32;
// One widget type per FILE (global registry; no test reset): a container that names the three among what it takes.
const TRAY =
  widgets.get("d18:tray") ??
  defineWidget({
    type: "d18:tray", object: { name: "tray" }, stratum: "sheets", defaultSize: { w: 4000, h: 4000 }, interaction: { snap: "none" },
    container: { accepts: [], widgets: [Board, Notebook, Calendar, Note], portal: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN } },
  });

function desk() {
  const ce = createCanvasEngine({ widgets: [...DESK_OBJECTS, TRAY], settings: { snap: { enabled: false } } });
  ce.docs.create();
  ce.world.setResource(Viewport, { w: 800, h: 600, dpr: 1 });
  ce.world.setResource(Camera, { x: -500, y: -1500, zoom: 0.1, gesturing: false });   // screen = (world − cam) · 0.1
  const tray = ce.ops.spawnWidget(TRAY.type, { x: 2000, y: -1000, w: 4000, h: 4000, undoable: false });
  ce.world.sync();
  let now = 1000;
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; ce.step(now); } };
  step(5);
  const screen = (wx: number, wy: number): [number, number] => [(wx + 500) * 0.1, (wy + 1500) * 0.1];
  const mouse = (kind: "down" | "move" | "up", [x, y]: [number, number], buttons: number): void => {
    ce.stack.queue.enqueue({ kind, pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons, mods: NO_MODS });
  };
  /** Spawn one `type` centred at the world origin, drag its centre to (4000, 1000) — over the tray's FACE — and let go. */
  const dropOver = (type: string, size: { w: number; h: number }): number => {
    const e = ce.ops.spawnWidget(type, { x: -size.w / 2, y: -size.h / 2, w: size.w, h: size.h, undoable: false }) as number;
    ce.world.sync();
    step(3);
    const from = screen(0, 0);
    const to = screen(4000, 1000);
    mouse("move", from, 0); step();
    mouse("down", from, 1); step();
    for (let i = 1; i <= 8; i++) { mouse("move", [from[0] + ((to[0] - from[0]) * i) / 8, from[1] + ((to[1] - from[1]) * i) / 8], 1); step(); }
    mouse("up", to, 0); step(4);
    return e;
  };
  const parentOf = (e: number) => ce.world.getRelation(e as never, ChildOf);
  const centreOf = (e: number) => { const p = ce.world.get(e as never, Position); const s = ce.world.get(e as never, Size); if (p === undefined || s === undefined) throw new Error("no rect"); return { cx: p.x + s.w / 2, cy: p.y + s.h / 2 }; };
  return { ce, tray, dropOver, parentOf, centreOf };
}

describe("the root objects (D-D18): `interaction.drop: \"never\"`, read off the compiled type", () => {
  it("the whiteboard, the notebook and the desk calendar are compiled `drop: \"never\"`; the note, the mini mat and the print drop as ever", () => {
    for (const t of [Board, Notebook, Calendar]) expect(t.drop, t.type).toBe("never");
    for (const t of [Note, Photo]) expect(t.drop, t.type).toBe("into");
  });

  it("a note let go with its centre over a container's face goes in (the control: this container takes it)", () => {
    const d = desk();
    const note = d.dropOver(NOTE_TYPE, Note.defaultSize);
    expect(d.parentOf(note)).toBe(d.tray);
  });

  for (const [name, type, size] of [["whiteboard", BOARD_TYPE, Board.defaultSize], ["notebook", NOTEBOOK_TYPE, Notebook.defaultSize], ["desk calendar", CALENDAR_TYPE, Calendar.defaultSize]] as const) {
    it(`a ${name} let go the same way stays on the desk, where it was let go — a container that names it takes it all the same`, () => {
      const d = desk();
      const e = d.dropOver(type, size);
      expect(d.parentOf(e)).not.toBe(d.tray);
      const c = d.centreOf(e);
      expect(c.cx).toBeGreaterThan(2000);   // it moved there: a plain move, never a fly-back
      expect(c.cy).toBeGreaterThan(0);
    });
  }
});
