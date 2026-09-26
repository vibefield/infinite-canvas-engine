// @vitest-environment node
// THE OPENING from the world (design-015 §8; D4b): `Held` is the fact and the builder's HAND its flux — picked up, the
// carry rises on the island ease over 560 ms and the object leaves the desk's rows and its marks for a slot of its own
// under the pose's camera (the notebook rising toward the desk eye, its cover swinging on the palm's spring); put down,
// it shuts, flies home over 440 ms and lands — the desk's again, the brackets back on. A harness pins the carry for a
// still. The desk copy behind the hand depends on the desk alone: the held object's own facts never bump its count.
// And the GROUND on a fake device: a held frame is the copy (once per stamp, blurred), the bare hand slot and the two
// composites; the copy is reused while the stamp stands; at a carry of 0 the frame is the rest frame's path.
import { Camera, createCanvasEngine, HeldView, Viewport } from "@ice/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDeskBuilder } from "../src/compose/builder";
import { looksOf } from "../src/compose/reflector";
import { Ground, type GroundFrameInputs } from "../src/ground";
import { HOLD_SHADER_FILES, holdShaders } from "../src/hold/shaders";
import { HOLD, readingTarget } from "../src/hold/pose";
import { FLUX_REST, type NotebookGeometry, notebookKind, type ObjectContext, paperKind, rectOf } from "../src/kinds";
import { MARKS_SHADER_FILES, marksShaders } from "../src/marks/shaders";
import { DEFAULT_GRID } from "../src/mat/grid";
import { MAT_SHADER_FILES, matShaders } from "../src/mat/shaders";
import type { NotebookDraw } from "../src/notebook/pass";
import { Note, Notebook } from "../src/objects";
import { lampOf } from "../src/paper/paper";
import { shaderText } from "../src/shaders";
import { NOTEBOOK_LOOK, notebookRuleInk, PALETTE, PENS, SURFACES, THEMES, VINYLS } from "../oracle/fixtures/vf-theme";
import { fakeDevice, fakeSurface, installGpuFlags } from "./fake-gpu";
import { must } from "./must";

const VP = { width: 1200, height: 800, dpr: 2 };
const CAM = { x: 0, y: 0, zoom: 1 };
const DT = 1 / 60;
const palette = { ...PALETTE.light, papers: { yellow: SURFACES.note }, pens: PENS, vinyls: VINYLS, notebooks: { ...NOTEBOOK_LOOK, rule: notebookRuleInk()[3] } };
const KINDS = [paperKind(), notebookKind()];
const LOOKS = looksOf(KINDS, palette, THEMES.light);

function makeDesk() {
  const ce = createCanvasEngine({ widgets: [Note, Notebook] });
  ce.docs.create();
  ce.world.setResource(Viewport, { w: VP.width, h: VP.height, dpr: VP.dpr });
  ce.world.setResource(Camera, { ...CAM, gesturing: false });
  let now = 0;
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; ce.step(now); } };
  // the book's case centred at (300, 400), turned 0.08 rad; a note at (900, 300)
  const book = ce.ops.spawnWidget("desk.notebook", { x: 300 - 90, y: 400 - 126, props: { seed: 3, angle: 0.08 }, undoable: false });
  const note = ce.ops.spawnWidget("desk.note", { x: 800, y: 200, props: { seed: 7 }, undoable: false });
  step(3);
  const locals = new Map([["notebook", must(notebookKind().local)({ pass: () => undefined })]]);
  const builder = createDeskBuilder(ce.world, { objects: [Note, Notebook], locals });
  const build = (opts?: Parameters<typeof builder.build>[6]) => { builder.changed(); return builder.build(CAM, VP, DT, THEMES.light, DEFAULT_GRID, LOOKS, opts); };
  return { ce, world: ce.world, step, builder, build, book, note };
}

describe("the hand in the builder (design-015 §8)", () => {
  it("picked up: the carry rises on the island ease to 1 in 560 ms; the object leaves the desk's rows and its marks for its own slot; the pose seam's frame lands on the reading target; the cover swings open past 42 %", () => {
    const { ce, build, builder, book } = makeDesk();
    let f = build();
    expect(f.objects).toHaveLength(2);
    expect(f.held).toBeUndefined();
    ce.ops.open(book);
    f = build();
    const h0 = must(f.held);
    expect(h0.entity).toBe(book);
    expect(h0.e).toBeGreaterThan(0);
    expect(h0.e).toBeLessThan(0.2);
    expect(h0.settled).toBe(false);
    expect(h0.landing).toBe(false);
    expect(f.objects).toHaveLength(1);   // the note alone: the book is the hand's
    expect(f.marks.objects).toHaveLength(0);   // selected, but no brackets while in hand
    expect(builder.hand()).toBe(h0);
    expect(builder.live()).toBe(true);
    // the pose IS a camera for the notebook's kind: the eye's — the desk's zoom kept, the book rising
    expect(h0.inputs.view.zoom).toBe(1);
    expect(h0.inputs.grid.mat.gobo.opacity).toBe(0);   // dapple 0 in hand
    let e = h0.e;
    for (let i = 0; i < 34; i++) { f = build(); const h = must(f.held); expect(h.e).toBeGreaterThanOrEqual(e); e = h.e; }
    const h1 = must(f.held);
    expect(h1.e).toBe(1);
    expect(h1.settled).toBe(true);
    // the frame: the spread (360 × 252, left of the spine) at the reading size, centred in the box, square
    const t = readingTarget({ cx: 210, cy: 400, w: 360, h: 252 }, VP, true);
    expect(h1.frame.cx).toBeCloseTo(t.cx, 6);
    expect(h1.frame.cy).toBeCloseTo(t.cy, 6);
    expect(h1.frame.hx).toBeCloseTo(180 * t.s, 6);
    expect(h1.frame.s).toBeCloseTo(t.s, 6);
    expect(h1.frame.settled).toBe(true);
    // the eye kind rose toward the eye by H·(1 − 1/grow): the pose's desk height is far below the mat
    const G = builder.geometryOf(book) as NotebookGeometry;
    expect(G.pose.desk).toBeLessThan(-900);
    expect(G.angle).toBe(0);   // the tilt let go
    // the cover: open past 42 % of the pickup, settled open on the palm's spring
    for (let i = 0; i < 120 && builder.live(); i++) f = build();
    expect((must(f.held).inputs.object.record as NotebookDraw).theta).toBeCloseTo(Math.PI, 2);
    expect(builder.live()).toBe(false);   // settled in hand: nothing moves, the desk sleeps
    expect(h1.inputs.filter).toEqual({ saturate: 1, brightness: 1 });   // by day the hand's light is the desk's
  });

  it("put down: it shuts first, flies home over 440 ms, lands — the desk's again with its brackets on; picked up again mid-flight it turns back from where it is", () => {
    const { ce, build, builder, book } = makeDesk();
    ce.ops.open(book);
    for (let i = 0; i < 160 && (builder.hand()?.settled !== true || builder.live()); i++) build();
    ce.ops.putDown();
    let f = build();
    const h = must(f.held);
    expect(h.landing).toBe(true);
    expect(f.objects).toHaveLength(1);   // still in the hand while it flies home
    // the close lead: the carry holds while the cover starts to shut
    expect(h.e).toBeCloseTo(1, 6);
    let landed = -1;
    for (let i = 1; i <= 120; i++) { f = build(); if (f.held === undefined) { landed = i; break; } }
    // home after the lead (140 ms) + 440 ms, landed once the cover is under 0.02 — well inside 2 s
    expect(landed).toBeGreaterThan(20);
    expect(landed).toBeLessThan(80);
    expect(f.objects).toHaveLength(2);
    expect(f.marks.objects).toHaveLength(1);   // it stays selected: the brackets lock back on
    expect(builder.hand()).toBeUndefined();
    // picked up again while flying home: the clock turns from the carry it had
    ce.ops.open(book);
    for (let i = 0; i < 40; i++) build();
    ce.ops.putDown();
    for (let i = 0; i < 12; i++) f = build();
    const mid = must(f.held).e;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    ce.ops.open(book);
    f = build();
    const back = must(f.held);
    expect(back.landing).toBe(false);
    expect(back.e).toBeGreaterThanOrEqual(mid);
    expect(back.e).toBeLessThan(mid + 0.2);
  });

  it("a harness pins the carry for a still: e held, the cover snapped (shut under 42 % unless the pin says open), settled only at 1", () => {
    const { ce, build, book } = makeDesk();
    ce.ops.open(book);
    let f = build({ hold: { e: 0.42 } });
    let h = must(f.held);
    expect(h.e).toBe(0.42);
    expect(h.settled).toBe(false);
    expect(h.frame.settled).toBe(false);
    expect((h.inputs.object.record as NotebookDraw).theta).toBe(0);
    f = build({ hold: { e: 0.42, open: true } });
    expect((must(f.held).inputs.object.record as NotebookDraw).theta).toBeCloseTo(Math.PI, 9);
    f = build({ hold: { e: 1 } });
    h = must(f.held);
    expect(h.settled).toBe(true);
    expect((h.inputs.object.record as NotebookDraw).theta).toBeCloseTo(Math.PI, 9);
    expect(h.inputs.dim).toBeCloseTo(HOLD.dim, 9);
    expect(h.inputs.blur).toBe(HOLD.blur);
  });

  it("the desk copy's count: the held object's own facts (its HeldView) never bump it; another object's do", () => {
    const { ce, world, build, builder, book, note } = makeDesk();
    ce.ops.open(book);
    for (let i = 0; i < 160 && (builder.hand()?.settled !== true || builder.live()); i++) build();
    const seq0 = must(builder.hand()).deskSeq;
    // the user brings it closer: the HeldView write is the held object's alone
    world.removeComponent(book, HeldView);
    world.addComponent(book, HeldView, { zoom: 1.5, panX: 20, panY: 0 });
    expect(builder.changed()).toBe(true);
    let f = builder.build(CAM, VP, DT, THEMES.light, DEFAULT_GRID, LOOKS);
    let h = must(f.held);
    expect(h.deskSeq).toBe(seq0);
    expect(h.frame.hx).toBeCloseTo(180 * readingTarget({ cx: 210, cy: 400, w: 360, h: 252 }, VP, true).s * 1.5, 6);
    expect(h.frame.cx).toBeCloseTo(readingTarget({ cx: 210, cy: 400, w: 360, h: 252 }, VP, true).cx + 20, 6);
    // the note changes: the desk behind moved, the copy must be remade
    ce.ops.setWidgetProps(note, { pen: "red" });
    f = build();
    h = must(f.held);
    expect(h.deskSeq).toBeGreaterThan(seq0);
  });

  it("by night the hand keeps a reading light: the day's light mixed in by the carry, saturate .62 · brightness .82 at the top", () => {
    const { ce, builder, book } = makeDesk();
    const looks = looksOf(KINDS, { ...palette, ...PALETTE.dark, notebooks: palette.notebooks, papers: palette.papers, pens: palette.pens, vinyls: palette.vinyls }, THEMES.dark);
    ce.ops.open(book);
    builder.changed();
    const f = builder.build(CAM, VP, DT, THEMES.dark, DEFAULT_GRID, looks, { hold: { e: 1 } });
    const h = must(f.held);
    expect(h.inputs.filter.saturate).toBeCloseTo(HOLD.light.saturate, 9);
    expect(h.inputs.filter.brightness).toBeCloseTo(HOLD.light.brightness, 9);
    expect(h.inputs.light.night).toBe(0);   // the day's light, whole, at e = 1
    const half = builder.build(CAM, VP, DT, THEMES.dark, DEFAULT_GRID, looks, { hold: { e: 0.5 } });
    expect(must(half.held).inputs.light.night).toBeCloseTo(THEMES.dark.matLight.night * 0.5, 9);
  });
});

describe("the ground's held frame on a fake device", () => {
  const undo: (() => void)[] = [];
  beforeAll(() => { undo.push(installGpuFlags()); });
  afterAll(() => { for (const u of undo.splice(0)) u(); });

  async function mount() {
    const log: string[] = [];
    const { device, queue } = fakeDevice(log);
    const kinds = [paperKind()];
    const ground = await Ground.create({ device, surface: fakeSurface(2400, 1600), mat: matShaders(shaderText(MAT_SHADER_FILES)), kinds, marks: marksShaders(shaderText(MARKS_SHADER_FILES)), hold: holdShaders(shaderText(HOLD_SHADER_FILES)) });
    const paper = must(kinds[0]);
    const look = must(paper.theme)(palette, "light");
    const view = { camX: 0, camY: 0, zoom: 1, width: 1200, height: 800, dpr: 2 };
    const ctx: ObjectContext = { entity: 7 as never, rect: rectOf({ x: 300, y: 250 }, { w: 200, h: 200 }), props: { seed: 7 }, flux: FLUX_REST, look, theme: THEMES.light, lamp: lampOf(DEFAULT_GRID.mat.plane), view, grid: DEFAULT_GRID, dt: DT };
    const record = paper.record(paper.resolve(ctx), ctx);
    const rest: GroundFrameInputs = { view, theme: THEMES.light, objects: [{ kind: "paper", record }] };
    const held = (e: number, stamp: string): GroundFrameInputs => ({
      ...rest,
      objects: [],
      held: { object: { kind: "paper", record }, view: { ...view, zoom: 2.5 }, grid: DEFAULT_GRID, e, blur: 14, dim: HOLD.dim * e, filter: { saturate: 1, brightness: 1 }, light: THEMES.light.matLight, stamp },
    });
    const passes = (): string[] => log.filter((l) => l.startsWith("pass ")).map((l) => l.slice(5));
    /** The log's lines inside the pass named — up to its `end`. */
    const inside = (pass: string): string[] => { const i = log.indexOf(`pass ${pass}`); if (i < 0) return []; const j = log.indexOf("end", i); return log.slice(i + 1, j < 0 ? undefined : j); };
    return { ground, queue, log, rest, held, passes, inside };
  }

  it("a held frame: the desk copy (once per stamp) blurred through the Kawase chain, the bare hand slot, the two composites — two submits, then one while the stamp stands; at a carry of 0 the rest path", async () => {
    const { ground, queue, log, rest, held, passes, inside } = await mount();
    ground.render(rest);   // the first frame also records the mat's wind pass (its gobo clock moved from nothing)
    log.length = 0;
    ground.render(rest);
    expect(passes()).toEqual(["ground"]);
    expect(queue.submits).toBe(2);
    queue.submits = 0;
    log.length = 0;
    ground.render(held(0.5, "a"));
    expect(passes()).toEqual(["hold/copy", "hold/down-1", "hold/down-2", "hold/up-2", "hold/up-1", "hold/hand", "hold"]);
    expect(queue.submits).toBe(2);   // the copy's own submit, then the frame's
    // the copy draws the mat; the hand slot is BARE — its one object over a frame already there
    expect(inside("hold/copy").some((l) => l === "pipeline mat/mat")).toBe(true);
    expect(inside("hold/hand").some((l) => l === "pipeline mat/mat")).toBe(false);
    expect(inside("hold/hand").some((l) => l.startsWith("pipeline paper"))).toBe(true);
    // the frame: the desk composite then the hand composite, one fullscreen triangle each
    expect(inside("hold").filter((l) => l.startsWith("pipeline"))).toEqual(["pipeline hold/desk", "pipeline hold/hand"]);
    expect(inside("hold").filter((l) => l === "draw 3")).toHaveLength(2);
    log.length = 0;
    // the desk stands (the same stamp): the copy is reused — no copy, no blur, one submit
    ground.render(held(0.8, "a"));
    expect(passes()).toEqual(["hold/hand", "hold"]);
    expect(queue.submits).toBe(3);
    log.length = 0;
    // the desk moved (a new stamp): the copy is remade
    ground.render(held(0.8, "b"));
    expect(passes()[0]).toBe("hold/copy");
    log.length = 0;
    // the carry at 0: the rest frame's own path, byte for byte the same code
    ground.render({ ...rest, held: { ...must(held(0, "c").held), e: 0 } });
    expect(passes()).toEqual(["ground"]);
  });
});
