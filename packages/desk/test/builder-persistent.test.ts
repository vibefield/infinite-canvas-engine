// @vitest-environment node
// PERSISTENT RECORDS in the builder (design-015 §4.3, §2.5; D6) — a real engine, a real document, the desk's own notes and
// mini mats. Pinned: a camera move resolves and records NOTHING — every visible record is the last build's very object, so
// the passes write none (the counter design-015 §11.4 asks for); a fact write remakes that ONE object's record; a spring
// moving remakes its object every build until it snaps; a look (a theme) or a zoom rung remakes them all; the cull rides the
// engine's spatial index with a hysteresis band — a pan within the band asks it nothing, past it once — and draws exactly
// what the linear cull draws; `verify` finds no reused record that a fresh resolve would have made otherwise, and catches one
// when a look is changed under the builder's feet (the control that proves the checker bites).
import { createCanvasEngine, type Entity, Grab, NO_ENTITY, Position, Viewport } from "@ice/core";
import { describe, expect, it } from "vitest";
import { createDeskBuilder, type SpatialSource } from "../src/compose/builder";
import { minimatKind, paperKind } from "../src/kinds";
import { DEFAULT_GRID } from "../src/mat/grid";
import { MiniMat, Note } from "../src/objects";
import { PALETTE, PENS, SURFACES, THEMES, VINYLS } from "../oracle/fixtures/vf-theme";
import { must } from "./must";

const VP = { width: 1200, height: 800, dpr: 2 };
const CAM = { x: 0, y: 0, zoom: 1 };
const DT = 1 / 60;
const palette = { ...PALETTE.light, papers: { yellow: SURFACES.note }, pens: PENS, vinyls: VINYLS };
const looksOf = () => new Map<string, unknown>([["paper", must(paperKind().theme)(palette, "light")], ["minimat", must(minimatKind().theme)(palette, "light")]]);
const LOOKS = looksOf();

function makeDesk(indexed = false) {
  const ce = createCanvasEngine({ widgets: [Note, MiniMat] });
  ce.docs.create();
  ce.world.setResource(Viewport, { w: VP.width, h: VP.height, dpr: VP.dpr });
  let now = 0;
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; ce.step(now); } };
  const note = (cx: number, cy: number, props: Record<string, unknown> = {}) => ce.ops.spawnWidget("desk.note", { x: cx - 100, y: cy - 100, props: { seed: 7, ...props }, undoable: false });
  const mat = (cx: number, cy: number, w = 640, h = 480) => ce.ops.spawnWidget("desk.minimat", { x: cx - w / 2, y: cy - h / 2, w, h, props: { name: "Inbox" }, undoable: false });
  /** The engine's own index, its searches counted. */
  const searches: unknown[] = [];
  const spatial: SpatialSource = { search: (b) => { searches.push(b); return ce.stack.index.search(b); } };
  const builder = createDeskBuilder(ce.world, { objects: [Note, MiniMat], ...(indexed ? { spatial } : {}) });
  const build = (cam = CAM, looks = LOOKS, dt = DT) => { builder.changed(); return builder.build(cam, VP, dt, THEMES.light, DEFAULT_GRID, looks); };
  /** Build until the springs settle (bounded). */
  const settle = (cam = CAM): number => { let n = 0; do { build(cam); n += 1; } while (builder.live() && n < 600); return n; };
  return { ce, world: ce.world, step, builder, build, settle, note, mat, searches };
}

describe("persistent records · the builder (design-015 §4.3; D6)", () => {
  it("a camera move resolves and records NOTHING: every visible record is the last build's object; a fact write remakes that ONE; a look remakes all", () => {
    const { world, step, build, settle, note, mat } = makeDesk();
    const notes = [note(200, 200), note(500, 200), note(800, 200), note(200, 500), note(500, 500)];
    mat(900, 550, 400, 300);
    step(3);
    settle();
    const a = build();
    expect(a.objects.length).toBe(6);
    // a pan: nothing resolved, nothing recorded — the six records are the same six objects
    const b = build({ x: 37, y: 11, zoom: 1 });
    expect(b.stats.work.resolved).toBe(0);
    expect(b.stats.work.recorded).toBe(0);
    expect(b.stats.work.reused).toBe(6);
    expect(b.stats.work.queried).toBe(0);   // the list stood
    expect(b.stats.work.sorted).toBe(0);
    expect(b.objects.map((o) => o.record)).toEqual(a.objects.map((o) => o.record));
    for (let i = 0; i < 6; i++) expect(must(b.objects[i]).record).toBe(must(a.objects[i]).record);   // identity, not equality
    expect(b.objects.map((o) => o.key)).toEqual(a.objects.map((o) => o.key));
    // a fact: one note moves — its record alone is remade; the others are the very same objects
    world.edit(must(notes[2])).set(Position, { x: 750, y: 130 });
    step();
    const c = build({ x: 37, y: 11, zoom: 1 });
    expect(c.stats.work.resolved).toBe(1);
    expect(c.stats.work.recorded).toBe(1);
    expect(c.stats.work.reused).toBe(5);
    const moved = c.objects.find((o) => o.key === (notes[2] as number));
    const before = b.objects.find((o) => o.key === (notes[2] as number));
    expect(moved?.record).not.toBe(before?.record);
    for (const o of c.objects) if (o.key !== (notes[2] as number)) expect(o.record).toBe(b.objects.find((q) => q.key === o.key)?.record);
    // a look (the theme): every record is remade
    const d = build({ x: 37, y: 11, zoom: 1 }, looksOf());
    expect(d.stats.work.recorded).toBe(6);
    expect(d.stats.work.reused).toBe(0);
    // a zoom rung: the note and the mini mat read the zoom (rezoom) — every record is remade; the next pan reuses them again
    const e = build({ x: 37, y: 11, zoom: 1.25 });
    expect(e.stats.work.recorded).toBe(6);
    const f = build({ x: 50, y: 20, zoom: 1.25 });
    expect(f.stats.work.recorded).toBe(0);
    expect(f.stats.work.reused).toBe(6);
  });

  it("a spring moving remakes its object every build until it snaps; then a pan reuses it again", () => {
    const { world, step, build, settle, note } = makeDesk();
    const a = note(300, 250);
    note(700, 250);
    step(3);
    settle();
    world.addComponent(a, Grab, { x: 200, y: 150, w: 200, h: 200, parent: NO_ENTITY, prev: NO_ENTITY, ord: 0 });
    world.sync();
    step();
    const first = build();
    expect(first.stats.work.recorded).toBe(1);   // the lift rises: a's record; the other note stands
    expect(first.stats.work.reused).toBe(1);
    let moving = 0;
    for (let i = 0; i < 400 && build().stats.live; i++) moving += 1;
    expect(moving).toBeGreaterThan(3);
    const settled = build({ x: 5, y: 0, zoom: 1 });
    expect(settled.stats.work.recorded).toBe(0);
    expect(settled.stats.work.reused).toBe(2);
  });

  it("a rezoom kind's record follows its SLOT's zoom: the outer mini mat's face lifted moves its inside's camera, and the mini mat nested inside is remade (rig:nav's cut frame — its lattice was 1 LSB stale)", () => {
    const { ce, step, build, builder, settle, mat } = makeDesk();
    const outer = mat(600, 400, 640, 480);
    step(3);   // the container compiles before it takes children
    // a mini mat INSIDE the outer one, and a note beside it
    const inner = ce.ops.spawnWidget("desk.minimat", { x: -160, y: -120, w: 320, h: 240, props: { name: "Inner" }, parent: outer, undoable: false });
    ce.ops.spawnWidget("desk.note", { x: 200, y: -100, props: { seed: 3 }, parent: outer, undoable: false });
    step(3);
    settle();
    /** The nested mini mat's row in the outer's portal this build (the slot's `objects` are optional on the wire; the portal is not). */
    const nestedIn = (f: ReturnType<typeof build>) => must(f.portals[0]).objects?.find((o) => o.key === (inner as number));
    const f0 = build();
    expect(f0.portals.length).toBe(1);
    const nested0 = nestedIn(f0);
    expect(nested0).toBeDefined();
    // a pan: the inside's records stand with the root's
    expect(nestedIn(build({ x: 20, y: 10, zoom: 1 }))?.record).toBe(nested0?.record);
    // the outer face lifted (a still's pin): the inside camera's zoom moves with the face — the nested mini mat's far-LOD lattice is
    // the inside zoom's, so its record is remade though the root camera stood
    builder.pinFlux(outer, { lift: 1 });
    const nested2 = nestedIn(build({ x: 20, y: 10, zoom: 1 }));
    expect(nested2?.record).not.toBe(nested0?.record);
    const lattice = (r: unknown) => (r as { inside: { lattice: { widths: number[] } } }).inside.lattice.widths;
    expect(lattice(nested2?.record)).not.toEqual(lattice(nested0?.record));
    // …and stands again on the next pan
    expect(nestedIn(build({ x: 30, y: 10, zoom: 1 }))?.record).toBe(nested2?.record);
  });

  it("with the index on, a note let go of falls to 0 and the desk goes quiet — its spring is stepped every build it is drawn (rig:interact's release row)", () => {
    const { world, step, build, builder, settle, note } = makeDesk(true);
    const a = note(300, 250);
    note(900, 250);
    step(3);
    settle();
    world.addComponent(a, Grab, { x: 200, y: 150, w: 200, h: 200, parent: NO_ENTITY, prev: NO_ENTITY, ord: 0 });
    world.sync();
    step();
    settle();
    expect(must(builder.fluxOf(a)).lift).toBe(1);
    // the drag's end: the position lands and the Grab goes in one tick
    world.edit(a).set(Position, { x: 150, y: 100 });
    world.removeComponent(a, Grab);
    world.sync();
    step();
    let builds = 0;
    do { build(); builds += 1; } while (builder.live() && builds < 600);
    expect(builds).toBeGreaterThan(3);
    expect(builder.live()).toBe(false);
    expect(must(builder.fluxOf(a)).lift).toBe(0);
  });

  it("the cull rides the spatial index with a hysteresis band: a pan within it asks nothing, past it once; the drawn set is the linear cull's", () => {
    const linear = makeDesk(false);
    const indexed = makeDesk(true);
    // forty notes over a 6000 × 4000 field, the same on both desks
    for (const d of [linear, indexed]) {
      for (let i = 0; i < 40; i++) d.note(((i * 733) % 6000) - 2000, ((i * 419) % 4000) - 1500);
      d.step(3);
      d.settle();
    }
    // the drawn set by each record's centre (two engines need not deal the same entity ids)
    const keys = (b: ReturnType<typeof linear.build>) => b.objects.map((o) => (o.record as { geometry: { centre: readonly number[] } }).geometry.centre.join(","));
    const at = (x: number, y: number) => ({ x, y, zoom: 1 });
    const l0 = linear.build(at(0, 0));
    const i0 = indexed.build(at(0, 0));
    expect(keys(i0)).toEqual(keys(l0));
    expect(i0.stats.culled).toBe(l0.stats.culled);
    expect(i0.stats.work.visited).toBeLessThan(l0.stats.work.visited);   // the index's answer, not the population
    const asked = indexed.searches.length;
    expect(asked).toBeGreaterThan(0);
    // a pan of 60 units: inside the band (the margin again, 200 at zoom 1) — the index is not asked; the drawn set still matches
    const l1 = linear.build(at(60, 30));
    const i1 = indexed.build(at(60, 30));
    expect(indexed.searches.length).toBe(asked);
    expect(keys(i1)).toEqual(keys(l1));
    // a pan of 900 units: past the band — asked once more; the set matches again
    const l2 = linear.build(at(900, 30));
    const i2 = indexed.build(at(900, 30));
    expect(indexed.searches.length).toBe(asked + 1);
    expect(keys(i2)).toEqual(keys(l2));
    // the world moving (a note re-placed) asks the index again on the next build — a moved object may have entered the view
    const first = i2.objects[0]?.key as number;
    indexed.world.edit(first as unknown as Entity).set(Position, { x: 950, y: 50 });
    indexed.step();
    const before = indexed.searches.length;
    indexed.build(at(900, 30));
    expect(indexed.searches.length).toBe(before + 1);
  });

  it("verify: over a pan, a zoom and a fact write no reused record differs from a fresh resolve — and a look changed in place under the builder is caught", () => {
    const { world, step, build, builder, settle, note, mat } = makeDesk();
    const notes = [note(200, 200), note(500, 200), note(800, 200)];
    mat(900, 550, 400, 300);
    step(3);
    settle();
    builder.verify(true);
    build({ x: 20, y: 10, zoom: 1 });
    build({ x: 40, y: 20, zoom: 1.1 });
    build({ x: 40, y: 20, zoom: 1.1 });
    world.edit(must(notes[0])).set(Position, { x: 120, y: 90 });
    step();
    build({ x: 40, y: 20, zoom: 1.1 });
    build({ x: 60, y: 20, zoom: 1.1 });
    expect(builder.stats().mismatches).toBe(0);
    // THE CONTROL: the paper's look mutated IN PLACE (the reflector never does — it remakes the map): the reused records are stale
    // and a fresh resolve says so — the checker bites
    const looks = looksOf();
    build({ x: 60, y: 20, zoom: 1.1 }, looks);
    expect(builder.stats().mismatches).toBe(0);
    const paper = looks.get("paper") as { papers: Record<string, unknown>; pens: Record<string, unknown> };
    looks.set("paper", { ...paper, papers: { yellow: [0.1, 0.2, 0.3] } });
    build({ x: 70, y: 20, zoom: 1.1 }, looks);
    expect(builder.stats().mismatches).toBe(3);
  });
});
