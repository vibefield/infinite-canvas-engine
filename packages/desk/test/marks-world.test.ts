// @vitest-environment node
// The desk's MARKS FROM THE WORLD (design-015 §7; D4a): the builder's chrome half (compose/marks.ts) on a
// real engine and document — the facts read (Selected, Locked, Grab, Resizable, core's snap chrome, the
// marquee's preview, a drag's recognizer), the flux stepped by dt and SNAPPED at its ends (B7's trap): the
// lock-on (180 ms) and its presence (120 ms in and out), several's union (220 ms / 120 ms), the tape pressed
// (240 ms, the second strip 60 ms later) and lifted (160 ms), the vellum's fold (240 ms) from where it let go,
// the laser's strike (160 ms) on a NEW alignment, the tape's give on a drag that meets it; the menu's anchor.
import { Captures, createCanvasEngine, Drag, GestureActive, GuideLine, LocalPointer, type MarqueeBuffer, Pointer, PointerScreen, Position, Resizable, RoutedMove, Viewport } from "@ice/core";
import { describe, expect, it } from "vitest";
import { createDeskBuilder } from "../src/compose/builder";
import { DEFAULT_GRID } from "../src/mat/grid";
import { MiniMat, Note } from "../src/objects";
import { minimatKind, paperKind } from "../src/kinds";
import { MARKS } from "../src/theme";
import { PALETTE, PENS, SURFACES, THEMES, VINYLS } from "../oracle/fixtures/vf-theme";
import { must } from "./must";

const VP = { width: 1200, height: 800, dpr: 2 };
const CAM = { x: 0, y: 0, zoom: 1 };
const DT = 1 / 60;
const palette = { ...PALETTE.light, papers: { yellow: SURFACES.note }, pens: PENS, vinyls: VINYLS };
const LOOKS = new Map<string, unknown>([["paper", must(paperKind().theme)(palette, "light")], ["minimat", must(minimatKind().theme)(palette, "light")]]);

function makeDesk() {
  const ce = createCanvasEngine({ widgets: [Note, MiniMat] });
  ce.docs.create();
  ce.world.setResource(Viewport, { w: VP.width, h: VP.height, dpr: VP.dpr });
  let now = 0;
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; ce.step(now); } };
  const note = (cx: number, cy: number) => ce.ops.spawnWidget("desk.note", { x: cx - 100, y: cy - 100, props: { seed: 7 }, undoable: false });
  const marquee: MarqueeBuffer = { rect: null, hits: [] };
  const builder = createDeskBuilder(ce.world, { objects: [Note, MiniMat], marquee: () => marquee });
  const build = (dt = DT) => { builder.changed(); return builder.build(CAM, VP, dt, THEMES.light, DEFAULT_GRID, LOOKS); };
  /** Frames until nothing moves (bounded), and the last frame's marks. */
  const settle = () => { let n = 0; let b = build(); while (builder.live() && n < 600) { b = build(); n += 1; } return { n, marks: b.marks }; };
  return { ce, world: ce.world, step, note, builder, build, settle, marquee };
}
const ms = (frames: number) => frames * DT * 1000;

describe("the marks from the world (compose/marks.ts, through the builder)", () => {
  it("a selection locks on over 180 ms and is whole in 120 — snapped, the builder quiet after; deselected, its brackets fade out over 120 ms where it lies, then nothing", () => {
    const { ce, step, note, build, builder, settle } = makeDesk();
    const a = note(300, 250);
    step(3);
    expect(settle().marks.objects).toEqual([]);
    ce.ops.setSelection([a]);
    const first = build().marks.objects[0];
    expect(first?.style).toBe("brackets");
    expect(first?.t).toBeCloseTo(DT * 1000 / MARKS.clocks.lockOn, 9);
    expect(first?.alpha).toBeCloseTo(DT * 1000 / MARKS.clocks.leave, 9);
    expect(builder.live()).toBe(true);
    const { n, marks } = settle();
    expect(ms(n + 1)).toBeGreaterThanOrEqual(MARKS.clocks.lockOn - 1);
    expect(marks.objects.map((o) => [o.style, o.t, o.alpha])).toEqual([["brackets", 1, 1]]);
    expect(builder.live()).toBe(false);
    ce.ops.clearSelection();
    const leaving = build().marks.objects[0];
    expect(leaving?.alpha).toBeCloseTo(1 - DT * 1000 / MARKS.clocks.leave, 9);
    expect(settle().marks.objects).toEqual([]);
    expect(builder.live()).toBe(false);
    // selected again: the lock-on runs again from the start
    ce.ops.setSelection([a]);
    expect(build().marks.objects[0]?.t).toBeCloseTo(DT * 1000 / MARKS.clocks.lockOn, 9);
  });

  it("several: member ticks under one union that locks on over 220 ms; back to one, the union is gone at once (desk.js draws it only while several are selected), the one wears brackets and the other's fade", () => {
    const { ce, step, note, build, settle } = makeDesk();
    const a = note(300, 250);
    const b = note(700, 420);
    step(3);
    ce.ops.setSelection([a, b]);
    const f = build().marks;
    expect(f.objects.map((o) => o.style)).toEqual(["member", "member"]);
    expect(f.union?.t).toBeCloseTo(DT * 1000 / MARKS.clocks.union, 9);
    const at = settle().marks;
    expect(at.union?.t).toBe(1); expect(at.union?.alpha).toBe(1);
    expect(at.union?.box.x0).toBeLessThan(200 + 1); expect(at.union?.box.x1).toBeGreaterThan(800 - 1);
    ce.ops.setSelection([a]);
    const one = build().marks;
    expect(one.union).toBeNull();
    // the one wears its brackets, whole; the one that left keeps fading brackets where it lies (desk.js: a leaving mark is drawn while no several is)
    expect(one.objects.map((o) => [o.style, o.alpha < 1])).toEqual([["brackets", false], ["brackets", true]]);
    expect(settle().marks.objects.map((o) => o.style)).toEqual(["brackets"]);
  });

  it("the tape: pressed over 240 ms, the second strip 60 ms behind; lifted over 160 ms; a taped object's selection has no knobs where an untaped resizable one's has", () => {
    const { ce, world, step, note, build, settle } = makeDesk();
    const a = note(300, 250);
    const b = note(700, 250);
    world.addTag(a, Resizable);
    world.addTag(b, Resizable);
    step(3);
    ce.ops.setLocked([a], true);
    step(1);
    const pressed = build().marks.tape[0];
    expect(pressed?.press[0]).toBeCloseTo((DT * 1000) / MARKS.clocks.tapePress, 9);
    expect(pressed?.press[1]).toBe(0);
    expect(settle().marks.tape[0]?.press).toEqual([1, 1]);
    ce.ops.setSelection([a]);
    expect(settle().marks.objects[0]?.knobs).toBe(false);
    ce.ops.setSelection([b]);
    expect(settle().marks.objects.find((o) => o.alpha === 1)?.knobs).toBe(true);
    ce.ops.setLocked([a], false);
    step(1);
    expect(build().marks.tape[0]?.alpha).toBeCloseTo(1 - (DT * 1000) / MARKS.clocks.tapeLift, 9);
    expect(settle().marks.tape).toEqual([]);
  });

  it("the vellum: drawn from the marquee's preview — what it touches ticked, never the tape — and released, it folds from where it let go onto the selection over 240 ms", () => {
    const { ce, step, note, build, settle, marquee, builder } = makeDesk();
    const a = note(300, 250);
    note(700, 250);
    const c = note(300, 600);
    step(3);
    ce.ops.setLocked([c], true);
    step(1);
    settle();
    marquee.rect = { x: 150, y: 100, w: 400, h: 650 };
    marquee.hits = [a];
    expect(builder.changed()).toBe(true);
    const drawn = build().marks;
    expect(drawn.marquee?.rect).toEqual({ x0: 150, y0: 100, x1: 550, y1: 750 });
    expect(drawn.marquee?.count).toBe(1);
    expect(drawn.objects.map((o) => o.style)).toEqual(["member"]);
    marquee.rect = null;
    marquee.hits = [];
    ce.ops.setSelection([a]);
    expect(builder.changed()).toBe(true);
    const folding = build().marks;
    expect(folding.marquee).toBeNull();
    expect(folding.union?.box.x0).toBeCloseTo(150, 9);   // the fold's first frame: where the vellum let go
    const { marks } = settle();
    expect(marks.union).toBeNull();
    expect(marks.objects.map((o) => o.style)).toEqual(["brackets"]);
  });

  it("the laser: core's GuideLine entities drawn over the objects on them, a NEW alignment strikes and settles over 160 ms; the builder wakes when they come and go", () => {
    const { world, step, note, build, settle, builder } = makeDesk();
    note(300, 250);
    step(3);
    settle();
    const g = world.spawn({ components: [[GuideLine, { axis: "y", at: 150, from: 0, to: 0 }]] });
    expect(builder.changed()).toBe(true);
    const lit = build().marks;
    expect(lit.guides.map((x) => [x.axis, x.at, x.type])).toEqual([["y", 150, "edge"]]);
    expect(lit.strike).toBeCloseTo(1 - (DT * 1000) / MARKS.clocks.strike, 9);
    expect(lit.guides[0]?.span).toEqual([200 - 14, 400 + 14]);
    expect(settle().marks.strike).toBe(0);
    world.destroy(g);
    expect(builder.changed()).toBe(true);
    expect(build().marks.guides).toEqual([]);
  });

  it("a drag that meets tape: the taped object shivers 2.2 px and settles in 360 ms; an untaped one does not; nothing is written", () => {
    const { ce, world, step, note, build, builder, settle } = makeDesk();
    const a = note(300, 250);
    const b = note(700, 250);
    step(3);
    ce.ops.setLocked([a], true);
    step(1);
    settle();
    const cx = (e: number) => (must(builder.geometryOf(e as never)) as { centre: readonly [number, number] }).centre[0];
    expect(cx(a)).toBe(300);
    const rec = world.spawn({ components: [[Drag, { startX: 300, startY: 250 }]], tags: [GestureActive, RoutedMove] });
    world.setRelation(rec, Captures, a);
    expect(builder.changed()).toBe(true);
    const xs: number[] = [];
    for (let i = 0; i < 30; i++) { build(); xs.push(cx(a) - 300); }
    expect(Math.max(...xs.map(Math.abs))).toBeGreaterThan(1.5);
    expect(Math.max(...xs.map(Math.abs))).toBeLessThanOrEqual(MARKS.give.px);
    expect(settle().n).toBeLessThan(60);
    expect(cx(a)).toBe(300);
    const rec2 = world.spawn({ components: [[Drag, { startX: 700, startY: 250 }]], tags: [GestureActive, RoutedMove] });
    world.setRelation(rec2, Captures, b);
    builder.changed();
    for (let i = 0; i < 5; i++) { build(); expect(cx(b)).toBe(700); }
    expect(world.get(a, Position)).toEqual({ x: 200, y: 150 });   // the give is flux: the taped note's Position never moved
  });

  it("the menu's anchor: the brackets' box (6 out) for one, the union's (10 out) for several, whether all are taped, a gesture on", () => {
    const { ce, world, step, note, settle, builder } = makeDesk();
    const a = note(300, 250);
    const b = note(700, 250);
    step(3);
    settle();
    expect(builder.anchor().box).toBeNull();
    ce.ops.setSelection([a]);
    settle();
    const one = builder.anchor();
    expect(one.count).toBe(1); expect(one.locked).toBe(false); expect(one.gesturing).toBe(false);
    const f = must(settle().marks.objects[0]).frame;
    const ex = Math.abs(Math.cos(f.angle)) * f.hx + Math.abs(Math.sin(f.angle)) * f.hy;
    expect(one.box?.x0).toBeCloseTo(f.cx - ex - 6, 9);   // the brackets' box: 6 out
    ce.ops.setLocked([a, b], true);
    ce.ops.setSelection([a, b]);
    step(1);
    settle();
    const two = builder.anchor();
    expect(two.count).toBe(2); expect(two.locked).toBe(true);
    const u = must(settle().marks.union).box;
    expect(two.box).toEqual({ x0: u.x0 - 10, y0: u.y0 - 10, x1: u.x1 + 10, y1: u.y1 + 10 });   // the union's box: 10 out
    const p = world.spawn({ components: [[Pointer, { id: "mouse", device: "mouse", owner: "" }], [PointerScreen, { x: 10, y: 10 }]], tags: [LocalPointer] });
    const rec = world.spawn({ components: [[Drag, {}]], tags: [GestureActive] });
    expect(builder.changed()).toBe(true);
    settle();
    expect(builder.anchor().gesturing).toBe(true);
    world.destroy(rec);
    world.destroy(p);
    builder.changed();
    settle();
    expect(builder.anchor().gesturing).toBe(false);
  });
});
