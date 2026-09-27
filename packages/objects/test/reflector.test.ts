// @vitest-environment node
// The desk's REFLECTOR (design-015 §2.4, §4.4; D2a-world) on a fake device: a real engine, a real
// document, the desk's objects, a real `Ground` on stubs — the reflector registered where the
// facade puts the ground layer. IDLE-ZERO: the first frame paints (one submit); a quiet tick
// paints nothing (no getCurrentTexture, no submit); a Position write, a camera write, a theme
// switch each paint ONE frame; a selection paints until its spring settles and then stops; the
// ambient in `live` mode paints every frame and `still` never on its own; the pull happens every
// tick even before the ground is here, and the first frame after it arrives paints.
import { Camera, createCanvasEngine, Grab, NO_ENTITY, Viewport, writeRuntimeResource } from "@ice/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAmbient, createDeskBuilder, createDeskReflector, Ground } from "@ice/desk";
import { looksOf } from "../../desk/src/compose/reflector";
import { HOLD_SHADER_FILES, holdShaders } from "../../desk/src/hold/shaders";
import { minimatKind } from "../src/minimat/kind";
import { notebookKind } from "../src/notebook/kind";
import { paperKind } from "../src/paper/kind";
import { MAT_SHADER_FILES, matShaders } from "../../desk/src/mat/shaders";
import { MiniMat, Note, Notebook } from "../src";
import { shaderText } from "../src/shaders";
import { NOTEBOOK_LOOK, notebookRuleInk, PALETTE, PENS, SURFACES, THEMES, VINYLS } from "../oracle/fixtures/vf-theme";
import { fakeDevice, fakeSurface, installGpuFlags } from "../../desk/test/fake-gpu";
import { must } from "../../desk/test/must";

const palette = { ...PALETTE.light, papers: { yellow: SURFACES.note }, pens: PENS, vinyls: VINYLS };

async function mount(mode: "idle" | "live" | "still" = "still") {
  const ce = createCanvasEngine({ widgets: [Note, MiniMat] });
  ce.docs.create();
  ce.world.setResource(Viewport, { w: 1200, h: 800, dpr: 2 });
  const { device, queue } = fakeDevice();
  const kinds = [paperKind(), minimatKind()];
  let ground: Ground | null = null;
  const sizes: string[] = [];
  const builder = createDeskBuilder(ce.world, { objects: [Note, MiniMat] });
  const ambient = createAmbient({ mode, idleMs: 100, settleMs: 100, random: () => 0.5 });
  const desk = createDeskReflector({ world: ce.world, builder, kinds, ambient, ground: () => ground, attach: { resize: (w, h) => sizes.push(`${w}x${h}`) }, theme: THEMES.light, palette });
  ce.engine.registerReflector(desk.reflector);
  let now = 0;
  const step = (n = 1): number => { const before = queue.submits; for (let i = 0; i < n; i++) { now += 16; ce.step(now); } return queue.submits - before; };
  const arrive = async (): Promise<void> => { ground = await Ground.create({ device, surface: fakeSurface(2400, 1600), mat: matShaders(shaderText(MAT_SHADER_FILES)), kinds }); desk.ready(); };
  return { ce, world: ce.world, queue, desk, builder, ambient, step, arrive, sizes, kinds };
}

describe("the desk reflector · idle-zero (design-015 §2.4)", () => {
  const undo: (() => void)[] = [];
  beforeAll(() => { undo.push(installGpuFlags()); });
  afterAll(() => { for (const u of undo.splice(0)) u(); });

  it("paints the first frame once the ground is here, and NOTHING on a quiet tick — no submit; the pull runs every tick, ground or no ground", async () => {
    const { ce, desk, step, arrive, sizes, queue } = await mount();
    ce.ops.spawnWidget("desk.note", { x: 200, y: 150, props: { seed: 7 }, undoable: false });
    // no ground yet: ticks pull the dirt (a wake is counted) and draw nothing
    expect(step(3)).toBe(0);
    expect(desk.reflector.available()).toBe(false);
    expect(desk.wakes().world).toBeGreaterThan(0);
    expect(desk.redraws()).toBe(0);
    await arrive();
    expect(desk.reflector.available()).toBe(true);
    expect(step()).toBe(1);   // the owed paint
    expect(desk.redraws()).toBe(1);
    expect(sizes).toEqual(["2400x1600"]);   // the canvas sized from the Viewport × dpr
    expect(must(desk.lastInputs()).objects).toHaveLength(1);
    expect(must(desk.stats().frame).kinds).toEqual({ paper: 1, minimat: 0 });
    // QUIET: twenty ticks, zero submits, no redraw
    expect(step(20)).toBe(0);
    expect(desk.redraws()).toBe(1);
    expect(desk.dirty()).toBe(false);
    expect(queue.submits).toBe(1);
  });

  it("a fact changes → one frame: a Position write, a camera write, a viewport write, a theme switch, a grid change — each exactly one submit, then quiet again", async () => {
    const { ce, world, desk, step, arrive } = await mount();
    const a = ce.ops.spawnWidget("desk.note", { x: 200, y: 150, props: { seed: 7 }, undoable: false });
    await arrive();
    step(2);
    expect(step(5)).toBe(0);
    ce.ops.setWidgetProps(a, { pen: "red" });
    expect(step()).toBe(1);
    expect(step(5)).toBe(0);
    writeRuntimeResource(world, Camera, { x: 100, y: 50, zoom: 1.5, gesturing: false });
    expect(step()).toBe(1);
    expect(must(desk.lastInputs()).view).toMatchObject({ camX: 100, camY: 50, zoom: 1.5 });
    expect(step(5)).toBe(0);
    world.setResource(Viewport, { w: 1000, h: 700, dpr: 2 });
    expect(step()).toBe(1);
    expect(step(5)).toBe(0);
    desk.setTheme(THEMES.dark, palette);
    expect(step()).toBe(1);
    expect(must(desk.lastInputs()).theme).toBe(THEMES.dark);
    expect(step(5)).toBe(0);
    desk.configureGrid({ ...desk.grid(), fadeIn: [8, 16] });
    expect(step()).toBe(1);
    expect(step(5)).toBe(0);
    const w = desk.wakes();
    expect(w.camera).toBe(1); expect(w.viewport).toBe(1); expect(w.theme).toBe(1); expect(w.grid).toBe(1);
  });

  it("a spring keeps the desk awake until it settles, then it sleeps; a selection alone does NOT (the ring's spring is gone — D6); a ghost the same", async () => {
    const { ce, desk, step, arrive } = await mount();
    const a = ce.ops.spawnWidget("desk.note", { x: 200, y: 150, props: { seed: 7 }, undoable: false });
    await arrive();
    step(2);
    expect(step(5)).toBe(0);
    // a selection: the marks' brackets lock on over a dozen frames (D4a's own motion), then quiet — no spring rises for a retired ring
    // (before D6 the ring's spring kept the desk painting for a second)
    ce.ops.setSelection([a]);
    let selected = 0;
    for (let i = 0; i < 60; i++) selected += step();
    expect(selected).toBeGreaterThan(0);
    expect(selected).toBeLessThan(30);
    expect(step(10)).toBe(0);
    // the lift (a Grab): every tick paints while the spring rises …
    ce.world.addComponent(a, Grab, { x: 200, y: 150, w: 200, h: 200, parent: NO_ENTITY, prev: NO_ENTITY, ord: 0 });
    ce.world.sync();
    const first = step();
    expect(first).toBe(1);
    expect(step(10)).toBe(10);
    // … then it settles (the snap) and the desk sleeps
    let painted = 0;
    for (let i = 0; i < 200; i++) painted += step();
    expect(painted).toBeGreaterThan(0);
    expect(painted).toBeLessThan(200);
    expect(step(10)).toBe(0);
    expect(must(desk.stats().frame).kinds.paper).toBe(1);
    ce.world.removeComponent(a, Grab);
    ce.world.sync();
    for (let i = 0; i < 200 && step() > 0; i++);
    expect(step(10)).toBe(0);
    // the delete: the ghost fades over 220 ms of frames, then nothing
    ce.ops.deleteSelection();
    expect(step()).toBe(1);
    expect(desk.stats().ghosts).toBe(1);
    let ghostFrames = 0;
    for (let i = 0; i < 60; i++) ghostFrames += step();
    expect(ghostFrames).toBeGreaterThan(5);
    expect(ghostFrames).toBeLessThan(60);
    expect(desk.stats().ghosts).toBe(0);
    expect(step(10)).toBe(0);
  });

  it("the ambient: `live` paints every frame; `still` never on its own; `idle` paints while touched and sleeps after the ease", async () => {
    const live = await mount("live");
    await live.arrive();
    live.step();
    expect(live.step(10)).toBe(10);
    expect(live.desk.stats().ambient.phase).toBe("live");
    const still = await mount("still");
    await still.arrive();
    still.step();
    expect(still.step(10)).toBe(0);
    const idle = await mount("idle");   // idleMs 100, settleMs 100 (the fixture's)
    await idle.arrive();
    idle.step();
    expect(idle.step(10)).toBe(0);   // never touched: still
    writeRuntimeResource(idle.world, Camera, { x: 1, y: 0, zoom: 1, gesturing: false });   // a camera move is a touch
    expect(idle.step()).toBe(1);
    expect(idle.desk.stats().ambient.phase).toBe("live");
    let painted = 0;
    for (let i = 0; i < 30; i++) painted += idle.step();   // 480 ms: past the 100 ms window and the 100 ms ease
    expect(painted).toBeGreaterThan(5);
    expect(painted).toBeLessThan(30);
    expect(idle.desk.stats().ambient.phase).toBe("still");
    expect(idle.step(10)).toBe(0);
  });

  it("looksOf: each kind's theme() by name; a kind without one has no look", () => {
    const { theme: _dropped, ...bare } = paperKind();
    const looks = looksOf([paperKind(), minimatKind(), { ...bare, name: "bare" }], palette, THEMES.light);
    expect([...looks.keys()].sort()).toEqual(["minimat", "paper"]);
    expect((looks.get("paper") as { papers: Record<string, unknown> }).papers.yellow).toBeDefined();
  });
});

describe("the hand under the DEFAULT ambient (design-015 §8, §11.4; D7)", () => {
  const undo: (() => void)[] = [];
  beforeAll(() => { undo.push(installGpuFlags()); });
  afterAll(() => { for (const u of undo.splice(0)) u(); });

  it("picked up with the wind up (`idle`, inside its window): the desk copy is made ONCE and a held, still desk submits NOTHING — the wind's clocks stand in hand; put down, the wind blows again", async () => {
    const ce = createCanvasEngine({ widgets: [Note, Notebook] });
    ce.docs.create();
    ce.world.setResource(Viewport, { w: 1200, h: 800, dpr: 2 });
    const { device, queue } = fakeDevice();
    const kinds = [paperKind(), notebookKind()];
    const ground = await Ground.create({ device, surface: fakeSurface(2400, 1600), mat: matShaders(shaderText(MAT_SHADER_FILES)), kinds, hold: holdShaders(shaderText(HOLD_SHADER_FILES)) });
    const locals = new Map([["notebook", must(kinds[1]?.local)({ pass: () => ground.pass("notebook") })]]);
    const builder = createDeskBuilder(ce.world, { objects: [Note, Notebook], locals });
    let r = 0;
    const ambient = createAmbient({ mode: "idle", idleMs: 20_000, settleMs: 2_000, random: () => { r = (r + 0.37) % 1; return r; } });
    const bookPalette = { ...palette, notebooks: { ...NOTEBOOK_LOOK, rule: notebookRuleInk()[3] } };
    const desk = createDeskReflector({ world: ce.world, builder, kinds, ambient, ground: () => ground, attach: { resize: () => {} }, theme: THEMES.light, palette: bookPalette });
    ce.engine.registerReflector(desk.reflector);
    let now = 0;
    const step = (n = 1): number => { const before = queue.submits; for (let i = 0; i < n; i++) { now += 16; ce.step(now); } return queue.submits - before; };
    const book = ce.ops.spawnWidget("desk.notebook", { x: 210, y: 274, props: { seed: 3, angle: 0.08 }, undoable: false });
    ce.ops.spawnWidget("desk.note", { x: 800, y: 200, props: { seed: 7 }, undoable: false });
    step(3);
    // the wind up: a camera move is a touch (as the pointer's moves before a pick-up are) — the precondition, pinned
    writeRuntimeResource(ce.world, Camera, { x: 1, y: 0, zoom: 1, gesturing: false });
    expect(step()).toBe(1);
    expect(desk.stats().ambient.phase).toBe("live");
    ce.ops.open(book);
    let frames = 0;
    for (let i = 0; i < 240 && (builder.hand()?.settled !== true || builder.live()); i++) frames += step() > 0 ? 1 : 0;
    expect(builder.hand()?.settled).toBe(true);
    expect(frames).toBeGreaterThan(30);   // the pick-up's flight and the cover's swing: a frame each tick
    const copies = ground.heldCopies();
    expect(copies).toBe(1);   // …over ONE desk copy (§8 "rendered ONCE"), not one per frame
    // held and still, the wind's window still open (20 s): no frame is the wind's, no copy is remade (§11.4 "0 per held frame")
    expect(step(120)).toBe(0);
    expect(ground.heldCopies()).toBe(copies);
    // put down: the desk is the ambient's again — inside its window the wind blows, a frame each tick
    ce.ops.putDown();
    for (let i = 0; i < 240 && builder.hand() !== undefined; i++) step();
    expect(builder.hand()).toBeUndefined();
    expect(step(10)).toBe(10);
    expect(desk.stats().ambient.phase).toBe("live");
  });
});
