// @vitest-environment node
// THE LAYERS' WORD ON A LANDING (`docs.extendCommits` — D7 #2, 2026-09-26): an extender runs INSIDE a gesture's committing
// transaction, after the gesture's own writes, with the intent that made them — so what it adds is the gesture's undo step,
// not a second one (the desk's pin when a note is let go on a calendar's day). A cancelled gesture commits nothing and so
// reaches no extender; a throwing extender is reported and the gesture still lands; the returned function leaves the door.
import { describe, expect, it, vi } from "vitest";
import {
  CancelRequest,
  createCanvasEngine,
  defineWidget,
  type InputEvent,
  NO_MODS,
  Position,
  Viewport,
  widgets,
} from "../src";

const BOX = widgets.get("extend:box") ?? defineWidget({ type: "extend:box", defaultSize: { w: 100, h: 80 } });

function rig() {
  const ce = createCanvasEngine({ widgets: [BOX] });
  ce.docs.create();
  ce.world.setResource(Viewport, { w: 1600, h: 900, dpr: 1 });
  let now = 0;
  const step = (n = 1): void => {
    for (let i = 0; i < n; i++) {
      now += 16;
      ce.step(now);
    }
  };
  const e = ce.ops.spawnWidget("extend:box", { x: 100, y: 100, undoable: false });
  step();
  const mouse = (kind: InputEvent["kind"], x: number, y: number, buttons: number): void => {
    ce.stack.queue.enqueue({ kind, pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons, mods: NO_MODS } as InputEvent);
  };
  /** Press the box (its rect, at the default camera) at (x0, 140) and drag it 200 px right in five moves; the release commits core's move. */
  const drag = (release: boolean, x0 = 150): void => {
    mouse("move", x0, 140, 0);
    step();
    mouse("down", x0, 140, 1);
    step();
    for (let i = 1; i <= 5; i++) {
      mouse("move", x0 + 40 * i, 140, 1);
      step();
    }
    if (release) {
      mouse("up", x0 + 200, 140, 0);
      step(3);
    }
  };
  const store = () => {
    const s = ce.docs.current();
    if (s === undefined) throw new Error("no doc");
    return s.store;
  };
  const undoSteps = (): number => {
    const s = store();
    let n = 0;
    while (s.canUndo() && n < 50) {
      s.undo();
      n += 1;
    }
    for (let i = 0; i < n; i++) s.redo();
    ce.world.sync();
    return n;
  };
  return { ce, e, step, mouse, drag, store, undoSteps };
}

describe("docs.extendCommits — the layers' word inside a gesture's transaction", () => {
  it("runs inside the move's transaction, after the move's own writes, with the intent: what it writes is the same undo step — one ⌘Z takes both back", () => {
    const r = rig();
    const seen: string[] = [];
    r.ce.docs.extendCommits((intent, tx) => {
      seen.push(intent.kind);
      for (const w of intent.writes) if (w.component === Position) tx.edit(w.entity).set(Position, { x: 999, y: 999 });
    });
    const steps = r.undoSteps();
    r.drag(true);
    expect(seen).toEqual(["move"]);
    expect(r.store().getComponent(r.e, Position)).toEqual({ x: 999, y: 999 }); // the extender's word landed after the move's
    expect(r.undoSteps()).toBe(steps + 1);
    r.store().undo();
    r.ce.world.sync();
    expect(r.store().getComponent(r.e, Position)).toEqual({ x: 100, y: 100 });
  });

  it("a cancelled gesture commits nothing and reaches no extender", () => {
    const r = rig();
    const calls = vi.fn();
    r.ce.docs.extendCommits(calls);
    r.drag(false);
    r.ce.world.setResource(CancelRequest, { active: true });
    r.step(2);
    r.mouse("up", 350, 140, 0);
    r.step(2);
    expect(calls).not.toHaveBeenCalled();
    expect(r.store().getComponent(r.e, Position)).toEqual({ x: 100, y: 100 });
  });

  it("a throwing extender is reported and the gesture still lands; the returned function leaves the door", () => {
    const r = rig();
    const off = r.ce.docs.extendCommits(() => {
      throw new Error("a layer's fault");
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    r.drag(true);
    expect(err).toHaveBeenCalledTimes(1);
    // the move landed regardless (core measures a drag from the move that made it one, so 200 px of motion lands fewer)
    const landed = r.store().getComponent(r.e, Position)?.x ?? 0;
    expect(landed).toBeGreaterThan(100);
    err.mockRestore();
    off();
    const calls = vi.fn();
    r.ce.docs.extendCommits(calls)();
    r.drag(true, landed + 50);
    expect(calls).not.toHaveBeenCalled();
    expect(r.store().getComponent(r.e, Position)).toEqual({ x: landed + (landed - 100), y: 100 });
  });
});
