// @vitest-environment node
// DROP-INTO for objects (design-015 §9, D-D6, D-D18; D2b — the prototype's `dropInto`): a GPU
// object let go with its CENTRE over a container's FACE goes into that desk at the point where
// it lay, in the inside's own units — `(n − M.o) / M.s` through the face's embedding — its size
// kept, so it takes the inside's scale; no free-slot placement. ⌥ held at the release keeps it on
// this desk. A centre over the border, not the face, is a plain move. A container that does not
// accept it is scenery (a plain move, never a fly-back). `interaction.drop: "never"` offers the
// widget to no container (its Provides is empty). View widgets keep every rule they had.
import { portalAffine, visibleRect } from "@ice/kernel";
import { describe, expect, it } from "vitest";
import {
  Camera,
  ChildOf,
  NO_MODS,
  OverlapCandidate,
  Position,
  Provides,
  Size,
  TransformTween,
  Viewport,
  createCanvasEngine,
  defaultArrivalCamera,
  defineWidget,
  staticFace,
  widgets,
} from "../src";

const MARGIN = 32;
// One widget type per FILE (global registry; no test reset).
const NOTE =
  widgets.get("cons:note") ??
  defineWidget({ type: "cons:note", object: { name: "paper" }, stratum: "things", defaultSize: { w: 200, h: 200 }, provides: ["note"], interaction: { snap: "none" } });
const BOARD =
  widgets.get("cons:board") ??
  defineWidget({ type: "cons:board", object: { name: "board" }, stratum: "things", defaultSize: { w: 200, h: 200 }, provides: ["note"], interaction: { snap: "none", drop: "never" } });
const MAT =
  widgets.get("cons:mat") ??
  defineWidget({
    type: "cons:mat", object: { name: "minimat" }, stratum: "sheets", defaultSize: { w: 640, h: 480 }, interaction: { snap: "none" },
    container: { accepts: ["note", "mat"], provides: ["mat"], portal: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN } },
  });
const TRAY =
  widgets.get("cons:tray") ??
  defineWidget({ type: "cons:tray", object: { name: "tray" }, stratum: "sheets", defaultSize: { w: 640, h: 480 }, interaction: { snap: "none" }, container: { accepts: ["nothing-of-ours"] } });

const VP = { w: 800, h: 600, dpr: 1 };

function rig(containerType = "cons:mat") {
  const ce = createCanvasEngine({ widgets: [NOTE, BOARD, MAT, TRAY], settings: { snap: { enabled: false } } });
  ce.docs.create();
  ce.world.setResource(Viewport, VP);
  ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false }); // screen == world
  // the container: centred at (900, 500), 640×480 → its rect (580, 260)…(1220, 740); its FACE inset by 32 → (612, 292)…(1188, 708)
  const mat = ce.ops.spawnWidget(containerType, { x: 580, y: 260, w: 640, h: 480, undoable: false });
  ce.world.sync();
  let now = 1000;
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; ce.step(now); } };
  step(5);
  const mouse = (kind: "down" | "move" | "up", x: number, y: number, buttons: number, alt = false): void => {
    ce.stack.queue.enqueue({ kind, pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons, mods: alt ? { ...NO_MODS, alt: true } : NO_MODS });
  };
  const liveCentre = (w: number): { cx: number; cy: number } => {
    const p = ce.world.get(w as never, Position);
    const s = ce.world.get(w as never, Size);
    if (p === undefined || s === undefined) throw new Error("no rect");
    return { cx: p.x + s.w / 2, cy: p.y + s.h / 2 };
  };
  /** Drag from `from` to `to` in 8 samples (`onSample` sees the live centre after each), the release with ⌥ when asked; returns the LIVE centre just before the release. */
  const drag = (w: number, from: [number, number], to: [number, number], alt = false, onSample?: (cx: number, cy: number) => void): { cx: number; cy: number } => {
    mouse("move", from[0], from[1], 0); step();
    mouse("down", from[0], from[1], 1); step();
    for (let i = 1; i <= 8; i++) {
      mouse("move", from[0] + ((to[0] - from[0]) * i) / 8, from[1] + ((to[1] - from[1]) * i) / 8, 1, alt); step();
      const c = liveCentre(w);
      onSample?.(c.cx, c.cy);
    }
    const live = liveCentre(w);
    mouse("up", to[0], to[1], 0, alt); step(4);
    return live;
  };
  const spawnAt = (type: string, cx: number, cy: number): number => {
    const e = ce.ops.spawnWidget(type, { x: cx - 100, y: cy - 100, w: 200, h: 200, undoable: false }) as number;
    ce.world.sync();
    step(3);
    return e;
  };
  /** The inside's embedding, as core computes it with no renderer mounted: the static face, the default framing. */
  const M = () => {
    const face = staticFace(ce.world, mat);
    if (face === undefined) throw new Error("no face");
    return portalAffine(visibleRect(defaultArrivalCamera(ce.world, mat), VP.w, VP.h), face);
  };
  const parentOf = (e: number) => ce.world.getRelation(e as never, ChildOf);
  const rectOf = (e: number) => { const p = ce.world.get(e as never, Position); const s = ce.world.get(e as never, Size); if (p === undefined || s === undefined) throw new Error("no rect"); return { ...p, ...s }; };
  return { ce, world: ce.world, step, mouse, drag, spawnAt, M, mat, parentOf, rectOf };
}

describe("drop-into through the portal affine (design-015 §9, D-D6)", () => {
  it("an object let go with its centre over the FACE goes in at (n − M.o) / M.s, its size kept", () => {
    const r = rig();
    const note = r.spawnAt("cons:note", 300, 250);
    const root = r.parentOf(note);
    expect(root).not.toBe(r.mat);
    // the embedding AT THE DROP — the inside is empty then (its arrival is the empty desk's; once the note is in, the arrival re-fits)
    const M = r.M();
    // a drag of (+600, +250): the note's centre lands at (900, 500), the face's own centre
    const live = r.drag(note, [300, 250], [900, 500]);
    expect(r.parentOf(note)).toBe(r.mat);
    const rect = r.rectOf(note);
    expect(rect.w).toBe(200);
    expect(rect.h).toBe(200);
    expect(rect.x).toBeCloseTo((live.cx - M.ox) / M.s - 100, 9);
    expect(rect.y).toBeCloseTo((live.cy - M.oy) / M.s - 100, 9);
    // it took the inside's scale: the 800×600 arrival view is fitted onto the 576×416 face by the tighter ratio (the face is squarer than the view)
    expect(M.s).toBeCloseTo(Math.min(576 / 800, 416 / 600), 12);
    expect(rect.x).not.toBeCloseTo(live.cx - 100 - 580, 3);   // not today's Position subtraction
  });

  it("⌥ held at the release keeps the object on this desk, where it was let go", () => {
    const r = rig();
    const note = r.spawnAt("cons:note", 300, 250);
    const root = r.parentOf(note);
    const live = r.drag(note, [300, 250], [900, 500], true);
    expect(r.parentOf(note)).toBe(root);
    const rect = r.rectOf(note);
    expect(rect.x + 100).toBeCloseTo(live.cx, 9);
    expect(rect.y + 100).toBeCloseTo(live.cy, 9);
  });

  it("the centre over the BORDER, not the face, is a plain move — though the bounds overlap the container", () => {
    const r = rig();
    const note = r.spawnAt("cons:note", 300, 250);
    const root = r.parentOf(note);
    // the pointer ends at 640 in 8 samples of 42.5; the note's centre trails by the slop-eaten sample, landing at 597.5: over the mat
    // (from 580) but not its face (from 612)
    let sampledOnBorder = 0;
    const live = r.drag(note, [300, 250], [640, 500], false, (cx) => {
      // mid-drag, with the bounds overlapping the mat: the drop system names no candidate while the centre is off the face
      if (cx > 580 && cx < 612) { sampledOnBorder += 1; expect(r.world.hasTag(r.mat as never, OverlapCandidate)).toBe(false); }
    });
    expect(sampledOnBorder).toBeGreaterThan(0);
    expect(live.cx).toBeGreaterThan(580);
    expect(live.cx).toBeLessThan(612);
    expect(r.parentOf(note)).toBe(root);
    expect(r.rectOf(note).x + 100).toBeCloseTo(live.cx, 9);
  });

  it("a coalesced final move + release re-validates the stale candidate: the centre must still be over the face AT the release", () => {
    const r = rig();
    const note = r.spawnAt("cons:note", 300, 250);
    const root = r.parentOf(note);
    // drag onto the face (the drop system names the mat), then move back to the border and release IN ONE TICK. The note trails
    // the pointer by the slop-eaten first sample (~75 px here), so a pointer at 675 lays its centre at ~600: over the mat (580),
    // short of the face (612).
    r.mouse("move", 300, 250, 0); r.step();
    r.mouse("down", 300, 250, 1); r.step();
    for (let i = 1; i <= 8; i++) { r.mouse("move", 300 + (600 * i) / 8, 250 + (250 * i) / 8, 1); r.step(); }
    expect(r.world.hasTag(r.mat as never, OverlapCandidate)).toBe(true);
    r.mouse("move", 675, 500, 1);
    r.mouse("up", 675, 500, 0);
    r.step(4);
    expect(r.parentOf(note)).toBe(root);
    const cx = r.rectOf(note).x + 100;
    expect(cx).toBeGreaterThan(580);
    expect(cx).toBeLessThan(612);
  });

  it("a container that does not accept the object is scenery: a plain move, never a fly-back", () => {
    const r = rig("cons:tray");
    const note = r.spawnAt("cons:note", 300, 250);
    const root = r.parentOf(note);
    const live = r.drag(note, [300, 250], [900, 500]);
    expect(r.parentOf(note)).toBe(root);
    expect(r.world.has(note as never, TransformTween)).toBe(false);
    expect(r.rectOf(note).x + 100).toBeCloseTo(live.cx, 9);
  });

  it("`interaction.drop: \"never\"` offers the widget to no container: its Provides is empty and it stays a root object (D-D18)", () => {
    const r = rig();
    const board = r.spawnAt("cons:board", 300, 250);
    expect(r.world.get(board as never, Provides)?.list ?? "[]").toBe("[]");
    const root = r.parentOf(board);
    const live = r.drag(board, [300, 250], [900, 500]);
    expect(r.parentOf(board)).toBe(root);
    expect(r.rectOf(board).x + 100).toBeCloseTo(live.cx, 9);
    // the note beside it still declares what it offers
    const note = r.spawnAt("cons:note", 300, 250);
    expect(r.world.get(note as never, Provides)?.list).toBe(JSON.stringify(["note"]));
  });
});
