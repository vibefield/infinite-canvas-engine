// @vitest-environment node
// The DESK BUILDER (design-015 §4.4; D2a-world): the world's objects as the ground's records. A
// real engine, a real document, the desk's own objects — the builder reads the facts (Position/
// Size, the props, the sibling order, Selected, Grab, Active) and runs the flux (the springs, the
// ghosts) outside the world. Pinned: paint order (the stratum first, the sibling sequence within,
// the Grab set last); the cull by rect ⊕ reach against the view ⊕ 200 px; a deleted object's
// GHOST fading 220 ms in its last paint position then forgotten; every spring SNAPPING to its
// target; the hover from the mouse pointer's exact hit; the pulled dirt; the pick geometry.
import { ChildOf, createCanvasEngine, Grab, LocalPointer, NO_ENTITY, Pointer, PointerScreen, TouchesExact, Viewport } from "@ice/core";
import { describe, expect, it } from "vitest";
import { createDeskBuilder } from "../src/compose/builder";
import { DEFAULT_GRID } from "../src/mat/grid";
import type { MiniMatInstance } from "../src/minimat/layout";
import { MiniMat, Note } from "../src/objects";
import type { PaperInstance } from "../src/paper/layout";
import { PALETTE, PENS, SURFACES, THEMES, VINYLS } from "../oracle/fixtures/vf-theme";
import { paperKind, minimatKind } from "../src/kinds";
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
  // the centred spawn the app makes: ICE's Position is the top-left
  const note = (cx: number, cy: number, props: Record<string, unknown> = {}) => ce.ops.spawnWidget("desk.note", { x: cx - 100, y: cy - 100, props: { seed: 7, ...props }, undoable: false });
  const mat = (cx: number, cy: number, w = 640, h = 480) => ce.ops.spawnWidget("desk.minimat", { x: cx - w / 2, y: cy - h / 2, w, h, props: { name: "Inbox" }, undoable: false });
  const builder = createDeskBuilder(ce.world, { objects: [Note, MiniMat] });
  const build = (cam = CAM, dt = DT) => { builder.changed(); return builder.build(cam, VP, dt, THEMES.light, DEFAULT_GRID, LOOKS); };
  /** Build until the springs settle (bounded). */
  const settle = (cam = CAM): number => { let n = 0; do { build(cam); n += 1; } while (builder.live() && n < 600); return n; };
  const kinds = (b: ReturnType<typeof build>) => b.objects.map((o) => o.kind);
  const centres = (b: ReturnType<typeof build>) => b.objects.map((o) => (o.record as PaperInstance | MiniMatInstance).geometry.centre.join(","));
  return { ce, world: ce.world, step, builder, build, settle, note, mat, kinds, centres };
}

describe("the desk builder · paint order (design-015 §4.2, D-D4)", () => {
  it("draws the frame's objects stratum first (a sheet under every thing), the sibling sequence within, and the Grab set LAST", () => {
    const { ce, world, step, build, note, mat, centres } = makeDesk();
    const a = note(300, 250);
    const m = mat(700, 400);
    const b = note(900, 250);
    step(3);   // membership stamps Active; equip stamps Stratum
    let f = build();
    expect(f.stats.active).toBe(3);
    // the mini mat (sheets) first though spawned second; the notes in sibling order
    expect(centres(f)).toEqual(["700,400", "300,250", "900,250"]);
    // the sibling order moves: b to the bottom → b before a among the things, the sheet still first
    ce.ops.reorder([b], "bottom");
    step();
    f = build();
    expect(centres(f)).toEqual(["700,400", "900,250", "300,250"]);
    // the carried set paints last: b grabbed (the lift signal) leaves its ordinal and goes after a
    world.addComponent(b, Grab, { x: 800, y: 150, w: 200, h: 200, parent: NO_ENTITY, prev: NO_ENTITY, ord: 0 });
    world.sync();
    f = build();
    expect(centres(f)).toEqual(["700,400", "300,250", "900,250"]);
    // a grabbed SHEET still lists before the things — the ground draws strata in order whatever the list says
    world.removeComponent(b, Grab);
    world.addComponent(m, Grab, { x: 380, y: 160, w: 640, h: 480, parent: NO_ENTITY, prev: NO_ENTITY, ord: 0 });
    world.sync();
    f = build();
    expect(f.objects.map((o) => o.kind)).toEqual(["paper", "paper", "minimat"]);
    expect(must(f.objects[2]).kind).toBe("minimat");
    expect(a).not.toBe(b);
  });
});

describe("the desk builder · the cull", () => {
  it("an object off the view by more than its kind's reach plus the 200 px margin is not drawn; one just inside is; the cull follows the camera", () => {
    const { step, build, builder, note } = makeDesk();
    // its rect's left edge 60 px past the view AND past its own reach: only the 200 px margin draws it (a margin of 0 would not)
    const near = note(1200 + builder.reach() + 60 + 100, 400);
    const far = note(1200 + 200 + builder.reach() + 100 + 5, 400);   // past the margin and its own reach: culled
    step(3);
    let f = build();
    expect(f.stats.active).toBe(2);
    expect(f.stats.objects).toBe(1);
    expect(f.stats.culled).toBe(1);
    expect(builder.geometryOf(near)).toBeDefined();
    expect(builder.geometryOf(far)).toBeUndefined();
    // pan right: the far note comes in
    f = build({ x: 400, y: 0, zoom: 1 });
    expect(f.stats.objects).toBe(2);
    expect(builder.geometryOf(far)).toBeDefined();
    // zoomed out the margin is 200 CSS px in world units too (200 / zoom)
    f = build({ x: -3000, y: -3000, zoom: 0.1 });
    expect(f.stats.objects).toBe(2);
  });
});

describe("the desk builder · the springs snap (B7's trap)", () => {
  it("selection: the ring rises over frames and lands EXACTLY on 1, the builder no longer live; deselection lands on 0", () => {
    const { ce, step, build, builder, settle, note } = makeDesk();
    const a = note(300, 250);
    step(3);
    build();
    expect(must(builder.fluxOf(a)).ring).toBe(0);
    ce.ops.setSelection([a]);
    build();
    const mid = must(builder.fluxOf(a)).ring;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(builder.live()).toBe(true);
    const n = settle();
    expect(n).toBeGreaterThan(5);
    expect(must(builder.fluxOf(a)).ring).toBe(1);   // snapped, not 0.9997
    expect(builder.live()).toBe(false);
    // D4a: the kind's own ring is retired — it is handed 0, so the selected note's pixels are the unselected note's —
    // and the MARKS carry the selection: its brackets, locked on and whole
    const G = builder.geometryOf(a) as { ring: number };
    expect(G.ring).toBe(0);
    const at = build().marks;
    expect(at.objects.map((o) => [o.style, o.t, o.alpha])).toEqual([["brackets", 1, 1]]);
    ce.ops.clearSelection();
    settle();
    expect(must(builder.fluxOf(a)).ring).toBe(0);
    expect(build().marks.objects).toEqual([]);   // the leave ran to its end: nothing drawn
  });

  it("the hold: Grab lifts a note on the same spring and lands on 1; its release lands on 0", () => {
    const { world, step, build, builder, settle, note } = makeDesk();
    const a = note(300, 250);
    step(3);
    build();
    world.addComponent(a, Grab, { x: 200, y: 150, w: 200, h: 200, parent: NO_ENTITY, prev: NO_ENTITY, ord: 0 });
    world.sync();
    build();
    expect(must(builder.fluxOf(a)).lift).toBeGreaterThan(0);
    settle();
    expect(must(builder.fluxOf(a)).lift).toBe(1);
    const held = builder.geometryOf(a) as { lift: number; scale: number };
    expect(held.lift).toBe(12);
    expect(held.scale).toBe(1.03);
    world.removeComponent(a, Grab);
    world.sync();
    settle();
    expect(must(builder.fluxOf(a)).lift).toBe(0);
  });
});

describe("the desk builder · the hover (the B9 pairing)", () => {
  it("a mini mat under the mouse pointer's EXACT hit rises; a held one does not; a note under it never does", () => {
    const { world, step, build, builder, settle, note, mat } = makeDesk();
    const a = note(300, 250);
    const m = mat(800, 400);
    step(3);
    build();
    const p = world.spawn({ components: [[Pointer, { id: "mouse", device: "mouse", owner: "" }], [PointerScreen, { x: 800, y: 400 }]], tags: [LocalPointer] });
    world.setRelation(p, TouchesExact, m);
    world.sync();
    expect(builder.changed()).toBe(true);   // the hover target moved: dirt
    settle();
    expect(must(builder.fluxOf(m)).hover).toBe(1);
    expect((builder.geometryOf(m) as { lift: number }).lift).toBeCloseTo(10 * 0.2, 12);
    // the pointer moves onto the note: the mat settles down, the note's hover flux stays 0 (a note never hovers)
    world.setRelation(p, TouchesExact, a);
    world.sync();
    settle();
    expect(must(builder.fluxOf(m)).hover).toBe(0);
    expect(must(builder.fluxOf(a)).hover).toBe(1);   // the flux rises — the paper kind ignores it
    expect((builder.geometryOf(a) as { lift: number }).lift).toBe(0);
    // held, a mat does not hover: the lift takes over
    world.setRelation(p, TouchesExact, m);
    world.addComponent(m, Grab, { x: 480, y: 160, w: 640, h: 480, parent: NO_ENTITY, prev: NO_ENTITY, ord: 0 });
    world.sync();
    settle();
    expect(must(builder.fluxOf(m)).hover).toBe(0);
    expect(must(builder.fluxOf(m)).lift).toBe(1);
    expect(build).toBeDefined();
  });
});

describe("the desk builder · delete ghosts", () => {
  it("a deleted note keeps its last record and fades over 220 ms in its last paint position, then is forgotten; nothing lives in the ECS for it", () => {
    const { ce, world, step, build, builder, note, centres } = makeDesk();
    const a = note(300, 250);
    const b = note(600, 250);
    const c = note(900, 250);
    step(3);
    build();
    ce.ops.setSelection([b]);
    ce.ops.deleteSelection();
    step();   // the transaction lands at the next sync; the journal reports the despawn
    expect(world.isAlive(b)).toBe(false);
    let f = build(CAM, 0.05);
    expect(f.stats.ghosts).toBe(1);
    expect(f.objects).toHaveLength(3);
    expect(centres(f)).toEqual(["300,250", "600,250", "900,250"]);   // where it was, between a and c — c's index shifted, the ghost's place did not
    const ghost = f.objects[1]?.record as PaperInstance;
    expect(ghost.geometry.alpha).toBeCloseTo(1 - 0.05 / 0.22, 9);
    expect(builder.live()).toBe(true);
    expect(builder.geometryOf(b)).toBeUndefined();   // no geometry for a dead entity: the pick never finds a ghost
    f = build(CAM, 0.1);
    expect((f.objects[1]?.record as PaperInstance).geometry.alpha).toBeCloseTo(1 - 0.15 / 0.22, 9);
    f = build(CAM, 0.1);   // past 220 ms: gone
    expect(f.stats.ghosts).toBe(0);
    expect(f.objects).toHaveLength(2);
    expect(centres(f)).toEqual(["300,250", "900,250"]);
    expect(builder.live()).toBe(false);
    expect(a).not.toBe(c);
  });
});

describe("the desk builder · pulled dirt", () => {
  it("changed() answers true for a journaled write, a spawn, a despawn, an order move and a hover change — and false on a quiet tick", () => {
    const { ce, world, step, builder, build, note } = makeDesk();
    const a = note(300, 250);
    step(3);
    build();
    builder.changed();
    expect(builder.changed()).toBe(false);
    expect(builder.changed()).toBe(false);
    ce.ops.setWidgetProps(a, { pen: "red" });
    step();
    expect(builder.changed()).toBe(true);
    build();
    expect((builder.geometryOf(a) as object)).toBeDefined();
    expect(builder.changed()).toBe(false);
    const b = note(500, 250);
    step();
    expect(builder.changed()).toBe(true);
    build();
    ce.ops.reorder([b], "bottom");
    step();
    expect(builder.changed()).toBe(true);
    build();
    expect(builder.changed()).toBe(false);
    // the sibling ORDER alone (a relation move journals no component): the order stamp is the dirt
    const before = builder.wakes().order;
    world.moveRelation(a, ChildOf, "first");
    expect(builder.changed()).toBe(true);
    expect(builder.wakes().order).toBe(before + 1);
    build();
    expect(builder.changed()).toBe(false);
    const w = builder.wakes();
    expect(w.world).toBeGreaterThan(0);
    expect(w.order).toBeGreaterThan(0);
    expect(w.hover).toBe(0);
    world.setResource(Viewport, { w: 1200, h: 800, dpr: 2 });   // a resource is the reflector's to poll, not the builder's dirt
    expect(builder.changed()).toBe(false);
  });

  it("the pick geometry: undefined before the first build, the kind's geometry after, undefined once culled; the reach is the widest kind's", () => {
    const { step, build, builder, note } = makeDesk();
    const a = note(300, 250);
    step(3);
    expect(builder.geometryOf(a)).toBeUndefined();
    expect(builder.kindOf(a)).toBeUndefined();
    build();
    expect(builder.geometryOf(a)).toBeDefined();
    expect(must(builder.kindOf(a)).name).toBe("paper");
    build({ x: 5000, y: 5000, zoom: 1 });
    expect(builder.geometryOf(a)).toBeUndefined();
    expect(builder.reach()).toBe(Math.max(paperKind().reach, minimatKind().reach));
  });

  it("a pinned asset reaches the kind's record and dirties the builder; unpinning removes it", () => {
    const { step, build, builder, note } = makeDesk();
    const a = note(300, 250);
    step(3);
    build();
    builder.changed();
    const uv = { u0: 0, v0: 0, u1: 0.2, v1: 0.2 };
    builder.pin(a, { layer: 1, uv });
    expect(builder.changed()).toBe(true);
    let f = build();
    expect((f.objects[0]?.record as PaperInstance).raster).toEqual({ layer: 1, uv });
    builder.pin(a, undefined);
    f = build();
    expect((f.objects[0]?.record as PaperInstance).raster).toBeUndefined();
  });

  it("a pin made in the SAME task as the spawn — before the builder has met the entity — survives to its first record (the parity scene's ink)", () => {
    // the app's setScene: spawn, then pin the raster, then the first tick — the entity is not yet readable when the pin lands
    const { step, build, builder, note } = makeDesk();
    const a = note(300, 250);
    const uv = { u0: 0, v0: 0, u1: 0.2, v1: 0.2 };
    builder.pin(a, { layer: 0, uv });
    step(3);
    const f = build();
    expect(f.objects).toHaveLength(1);
    expect((f.objects[0]?.record as PaperInstance).raster).toEqual({ layer: 0, uv });
  });

  it("a flux pin holds a spring AT its target with no Grab — snapped at once, not live, the paint order untouched; unpinning lets it fall; clearFlux lifts every pin", () => {
    const { step, build, builder, note, mat, centres, settle } = makeDesk();
    const a = note(300, 250);
    const m = mat(700, 400);
    const b = note(900, 250);
    step(3);
    settle();
    // a parity scene's `held`: the lift at 1 with no Grab — a still, and a's ordinal keeps its place (a Grab would paint it last)
    builder.pinFlux(a, { lift: 1 });
    expect(builder.changed()).toBe(true);
    let f = build();
    expect(builder.fluxOf(a)?.lift).toBe(1);
    expect(builder.live()).toBe(false);
    expect(centres(f)).toEqual(["700,400", "300,250", "900,250"]);
    // unpinned, the spring follows the facts again: it falls, live, and lands on 0
    builder.pinFlux(a, undefined);
    f = build();
    expect(builder.fluxOf(a)?.lift).toBeLessThan(1);
    expect(builder.live()).toBe(true);
    settle();
    expect(builder.fluxOf(a)?.lift).toBe(0);
    // several pins, one clear
    builder.pinFlux(b, { ring: 1 });
    builder.pinFlux(m, { hover: 1 });
    build();
    expect(builder.fluxOf(b)?.ring).toBe(1);
    expect(builder.fluxOf(m)?.hover).toBe(1);
    builder.clearFlux();
    expect(builder.changed()).toBe(true);
    settle();
    expect(builder.fluxOf(b)?.ring).toBe(0);
    expect(builder.fluxOf(m)?.hover).toBe(0);
    expect(builder.changed()).toBe(false);   // a clear with nothing pinned is no wake
  });

  it("dispose lets the journal go: a build after it is empty", () => {
    const { step, build, builder, note } = makeDesk();
    note(300, 250);
    step(3);
    expect(build().objects).toHaveLength(1);
    builder.dispose();
    expect(build().objects).toHaveLength(0);
    expect(builder.changed()).toBe(false);
  });
});
