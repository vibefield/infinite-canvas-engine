// @vitest-environment node
// THE OPENING from the world (design-015 §8; D4b): `Held` is the fact and the builder's HAND its flux — picked up, the
// carry rises on the island ease over 560 ms and the object leaves the desk's rows and its marks for a slot of its own
// under the pose's camera (the notebook rising toward the desk eye, its cover swinging on the palm's spring); put down,
// it shuts, flies home over 440 ms and lands — the desk's again, the brackets back on. A harness pins the carry for a
// still. The desk copy behind the hand depends on the desk alone: the held object's own facts never bump its count.
// And the GROUND on a fake device: a held frame is the copy (once per stamp, blurred), the bare hand slot and the two
// composites; the copy is reused while the stamp stands; at a carry of 0 the frame is the rest frame's path.
import { Camera, createCanvasEngine, type Entity, HeldView, Viewport } from "@ice/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDeskBuilder, createPickSource, Ground, type GroundFrameInputs, HOLD, readingTarget, FLUX_REST, type ObjectContext, rectOf, MARKS_SHADER_FILES, marksShaders, DEFAULT_GRID } from "@ice/desk";
import { worldChildren } from "../../desk/src/compose/children";
import { looksOf } from "../../desk/src/compose/reflector";
import { HOLD_SHADER_FILES, holdShaders } from "../../desk/src/hold/shaders";
import { boardKind } from "../src/board/kind";
import { CALENDAR_KIND, type CalendarKind, calendarKind, createPads } from "../src/calendar/kind";
import { NOTEBOOK_KIND, type NotebookGeometry, type NotebookKind, notebookKind } from "../src/notebook/kind";
import { paperKind } from "../src/paper/kind";
import { MAT_SHADER_FILES, matShaders } from "../../desk/src/mat/shaders";
import type { NotebookDraw } from "../src/notebook/pass";
import { Board, Calendar, Note, Notebook } from "../src";
import { lampOf } from "../src/paper/paper";
import { shaderText } from "../src/shaders";
import { calendarDraw, notebookDraw } from "../../desk/oracle/frame.mjs";
import { BOARD_LOOK, CALENDAR_LOOK, MARKERS, NOTEBOOK_LOOK, notebookRuleInk, PALETTE, PENS, SURFACES, THEMES, VINYLS } from "../../desk/oracle/fixtures/vf-theme";
import { fakeDevice, fakeSurface, installGpuFlags } from "../../desk/test/fake-gpu";
import { must } from "../../desk/test/must";

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

  it("a kind with NO cover (the whiteboard, the desk calendar — no `openness`): once the carry settles nothing of it moves, and the desk sleeps in hand (D7)", () => {
    const kindsPalette = { ...palette, board: BOARD_LOOK, markers: MARKERS, calendars: CALENDAR_LOOK };
    const looks = looksOf([boardKind(), calendarKind()], kindsPalette, THEMES.light);
    for (const [type, props] of [["desk.board", { cap: "blue" }], ["desk.calendar", { month: "2026-09" }]] as const) {
      const ce = createCanvasEngine({ widgets: [Board, Calendar] });
      ce.docs.create();
      ce.world.setResource(Viewport, { w: VP.width, h: VP.height, dpr: VP.dpr });
      ce.world.setResource(Camera, { ...CAM, gesturing: false });
      const e = ce.ops.spawnWidget(type, { x: 200, y: 200, props, undoable: false });
      for (let i = 1; i <= 3; i++) ce.step(i * 16);
      const locals = new Map([["calendar", createPads({ pass: () => undefined, children: worldChildren(ce.world) })]]);
      const builder = createDeskBuilder(ce.world, { objects: [Board, Calendar], locals });
      const build = () => { builder.changed(); return builder.build(CAM, VP, DT, THEMES.light, DEFAULT_GRID, looks); };
      build();
      ce.ops.open(e);
      let settledAt = -1;
      for (let i = 0; i < 90 && settledAt < 0; i++) { build(); if (builder.hand()?.settled === true) settledAt = i; }
      expect(settledAt, type).toBeGreaterThan(20);   // the carry's 560 ms on the island ease
      build();
      expect(builder.hand()?.entity, type).toBe(e);
      expect(builder.live(), `${type}: live once settled`).toBe(false);
      for (let i = 0; i < 60; i++) build();   // a second in hand, still: nothing asks for a frame
      expect(builder.live(), type).toBe(false);
    }
  });

  it("something LANDS on a desk object while one is in hand (a picture, a replay, tiles, a wipe let go): the copy's count moves ONCE; a restless kind with nothing landed (the ink drying) or a landing on the held object never moves it (D7)", () => {
    const ce = createCanvasEngine({ widgets: [Note, Notebook] });
    ce.docs.create();
    ce.world.setResource(Viewport, { w: VP.width, h: VP.height, dpr: VP.dpr });
    ce.world.setResource(Camera, { ...CAM, gesturing: false });
    const book = ce.ops.spawnWidget("desk.notebook", { x: 300 - 90, y: 400 - 126, props: { seed: 3, angle: 0.08 }, undoable: false });
    const note = ce.ops.spawnWidget("desk.note", { x: 800, y: 200, props: { seed: 7 }, undoable: false });
    for (let i = 1; i <= 3; i++) ce.step(i * 16);
    const lands = new Map<Entity, number>();
    const books = must(notebookKind().local)({ pass: () => undefined });
    // the notebook's own local, its word on landings replaced: the held book's landings are the test's to move
    const bookLocal = new Proxy(books, { get: (t, k) => (k === "landed" ? (e: Entity) => lands.get(e) ?? 0 : Reflect.get(t, k)) });
    const paperLocal = { draw: () => ({}), layoutOf: () => undefined, landed: (e: Entity) => lands.get(e) ?? 0 };
    const builder = createDeskBuilder(ce.world, { objects: [Note, Notebook], locals: new Map<string, unknown>([["notebook", bookLocal], ["paper", paperLocal]]) as never });
    const build = (restless: string[] = []) => { builder.changed(); return builder.build(CAM, VP, DT, THEMES.light, DEFAULT_GRID, LOOKS, { restless: new Set(restless) }); };
    build();
    ce.ops.open(book);
    for (let i = 0; i < 160 && (builder.hand()?.settled !== true || builder.live()); i++) build();
    const seq0 = must(builder.hand()).deskSeq;
    build(["paper"]);   // restless, nothing landed (the ink drying, a caret): the desk behind stands
    expect(must(builder.hand()).deskSeq).toBe(seq0);
    lands.set(note, 1);   // a picture, a raster, a wipe let go — on the note behind the hand
    build(["paper"]);
    expect(must(builder.hand()).deskSeq).toBe(seq0 + 1);
    build(["paper"]);   // once
    expect(must(builder.hand()).deskSeq).toBe(seq0 + 1);
    lands.set(book, 1);   // on the HELD book: its own, never the desk's
    build(["notebook"]);
    expect(must(builder.hand()).deskSeq).toBe(seq0 + 1);
  });

  it("flying home it is picked where it is DRAWN (D7 #11): the pick lists it lifted, hits it through the pose the build drew, and its rest rect answers nothing", () => {
    const { ce, step, build, builder } = makeDesk();
    // a book whose rest is far off to the left, so its rest rect and its drawn pose (the reading target, mid-screen) cannot overlap
    const far = ce.ops.spawnWidget("desk.notebook", { x: -3000 - 90, y: 400 - 126, props: { seed: 5, angle: 0 }, undoable: false });
    step(2);
    const pick = createPickSource(builder);
    ce.ops.open(far);
    for (let i = 0; i < 160 && (builder.hand()?.settled !== true || builder.live()); i++) build();
    ce.ops.putDown();
    const f = build();
    const h = must(f.held);
    expect(h.entity).toBe(far);
    expect(h.landing).toBe(true);
    expect(pick.lifted?.()).toContain(far);
    // where it is drawn: the pose seam's frame on screen, through the desk camera (screen == world here) — the book itself
    const drawn = pick.hit(far, CAM.x + h.frame.cx / CAM.zoom, CAM.y + h.frame.cy / CAM.zoom);
    expect(drawn).toBeDefined();
    expect(drawn).not.toBe("outside");
    // where its facts say it rests — the case centred at (−3000, 400) — nothing: a drag there moves nothing mid-flight
    expect(pick.hit(far, -3000, 400)).toBe("outside");
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
    const dark = { ...PALETTE.dark, notebooks: palette.notebooks, papers: palette.papers, pens: palette.pens, vinyls: palette.vinyls };
    const looks = looksOf(KINDS, dark, THEMES.dark);
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

  it("a notebook in hand over a desk with another notebook and a pad, the copy remade frame after frame: the layered passes keep the copy's targets and meshes APART from the hand's — nothing is made or given back after the first held frame; the hold's end gives the copy's back (D7)", async () => {
    const { device } = fakeDevice();
    const made: string[] = [];
    const dropped: string[] = [];
    const texture = device.createTexture.bind(device);
    const buffer = device.createBuffer.bind(device);
    device.createTexture = (d) => {
      made.push(`texture ${d.label}`);
      const t = texture(d);
      const destroy = t.destroy.bind(t);
      t.destroy = () => { dropped.push(`texture ${d.label}`); destroy(); };
      return t;
    };
    device.createBuffer = (d) => {
      made.push(`buffer ${d.label}`);
      const b = buffer(d);
      const destroy = b.destroy.bind(b);
      b.destroy = () => { dropped.push(`buffer ${d.label}`); destroy(); };
      return b;
    };
    const ground = await Ground.create({ device, surface: fakeSurface(2400, 1600), mat: matShaders(shaderText(MAT_SHADER_FILES)), kinds: [paperKind(), notebookKind(), calendarKind()], hold: holdShaders(shaderText(HOLD_SHADER_FILES)) });
    (must(ground.pass(NOTEBOOK_KIND)) as NotebookKind).ruleInk = notebookRuleInk();
    (must(ground.pass(CALENDAR_KIND)) as CalendarKind).alpha = CALENDAR_LOOK.alpha;
    const view = { camX: -600, camY: -400, zoom: 1, width: 1200, height: 800, dpr: 2 };
    // the desk behind the hand: a second notebook and a pad; in hand, a notebook at its reading size
    const desk = [{ kind: NOTEBOOK_KIND, record: notebookDraw({ x: -250, y: 0, angle: 0.04, cover: "orbit", seed: 7 }) }, { kind: CALENDAR_KIND, record: calendarDraw({ x: 250, y: 0, month: "2026-09", weekStart: 1 }, 0) }];
    const book = { kind: NOTEBOOK_KIND, record: notebookDraw({ x: 0, y: 0, angle: 0, cover: "orbit", seed: 3 }) };
    const rest: GroundFrameInputs = { view, theme: THEMES.light, objects: [...desk, book] };
    const heldFrame = (stamp: string): GroundFrameInputs => ({
      view, theme: THEMES.light, objects: desk,
      held: { object: book, view: { ...view, camX: -240, camY: -160, zoom: 2.5 }, grid: DEFAULT_GRID, e: 1, blur: 14, dim: HOLD.dim, filter: { saturate: 1, brightness: 1 }, light: THEMES.light.matLight, stamp },
    });
    ground.render(rest);
    ground.render(heldFrame("a"));   // the pick-up: the copy's own layers (at half the dpr) and meshes are made
    const layers = made.filter((l) => l === "texture notebook/layer ×4" || l === "texture calendar/layer ×4").length;
    made.length = 0;
    dropped.length = 0;
    // the desk behind moved twice (a new stamp each): the copy remade and the hand redrawn — every target and mesh stands
    ground.render(heldFrame("b"));
    ground.render(heldFrame("c"));
    expect(ground.heldCopies()).toBe(3);
    expect(made).toEqual([]);
    expect(dropped).toEqual([]);
    // the hold's end: the copy's layers given back, the frame's stand
    ground.render(rest);
    expect(dropped.filter((l) => l.startsWith("texture notebook/") || l.startsWith("texture calendar/")).sort()).toEqual(["texture calendar/depth ×4", "texture calendar/layer", "texture calendar/layer ×4", "texture notebook/depth ×4", "texture notebook/layer", "texture notebook/layer ×4"]);
    expect(made.filter((l) => l.startsWith("texture"))).toEqual([]);
    expect(layers).toBe(4);   // up to the pick-up: each kind's layer for the frame and one for the copy — the hand's prepare made none
  });
});
