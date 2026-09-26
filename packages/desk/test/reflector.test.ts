// @vitest-environment node
// The desk's REFLECTOR (design-015 §2.4, §4.4; D2a-world) on a fake device: a real engine, a real
// document, the desk's objects, a real `Ground` on stubs — the reflector registered where the
// facade puts the ground layer. IDLE-ZERO: the first frame paints (one submit); a quiet tick
// paints nothing (no getCurrentTexture, no submit); a Position write, a camera write, a theme
// switch each paint ONE frame; a selection paints until its spring settles and then stops; the
// ambient in `live` mode paints every frame and `still` never on its own; the pull happens every
// tick even before the ground is here, and the first frame after it arrives paints.
import { Camera, createCanvasEngine, Viewport, writeRuntimeResource } from "@ice/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAmbient } from "../src/compose/ambient";
import { createDeskBuilder } from "../src/compose/builder";
import { createDeskReflector, looksOf } from "../src/compose/reflector";
import { Ground } from "../src/ground";
import { minimatKind, paperKind } from "../src/kinds";
import { MAT_SHADER_FILES, matShaders } from "../src/mat/shaders";
import { MiniMat, Note } from "../src/objects";
import { shaderText } from "../src/shaders";
import { PALETTE, PENS, SURFACES, THEMES, VINYLS } from "../oracle/fixtures/vf-theme";
import { fakeDevice, fakeSurface, installGpuFlags } from "./fake-gpu";
import { must } from "./must";

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

  it("a spring keeps the desk awake until it settles, then it sleeps; a ghost the same", async () => {
    const { ce, desk, step, arrive } = await mount();
    const a = ce.ops.spawnWidget("desk.note", { x: 200, y: 150, props: { seed: 7 }, undoable: false });
    await arrive();
    step(2);
    expect(step(5)).toBe(0);
    ce.ops.setSelection([a]);
    const first = step();
    expect(first).toBe(1);
    // live: every tick paints while the ring rises …
    expect(step(10)).toBe(10);
    // … then it settles (the snap) and the desk sleeps
    let painted = 0;
    for (let i = 0; i < 200; i++) painted += step();
    expect(painted).toBeGreaterThan(0);
    expect(painted).toBeLessThan(200);
    expect(step(10)).toBe(0);
    expect(must(desk.stats().frame).kinds.paper).toBe(1);
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
