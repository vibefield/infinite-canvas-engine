// @vitest-environment happy-dom
/**
 * The field host's DIRTY UNION and its idle-zero (design-013 §8 C2 — the rows
 * `layer.test.ts` carried for the old reflector, re-pointed at the one host):
 * a still scene submits nothing however many ticks pass, and each of the
 * facts the ground draws from — the camera, the viewport, a card's move, a
 * pole's move, a theme change, a canvas switch — wakes EXACTLY one redraw and
 * one submit.
 *
 * And D-C2.2's witness at the host: the fake Ground below holds a REAL `Field`
 * on the stub device, so the atlas bake count is the engine's own. A local
 * pointer gesture — 60 pointer writes, 60 redraws — bakes NOTHING; a remote
 * cursor moving bakes once per move.
 */
import {
  Camera,
  createCanvasEngine,
  CursorVisual,
  defineCanvasType,
  defineWidget,
  LocalPointer,
  Pointer,
  PointerScreen,
  PointerWorld,
  Position,
  tools,
  Viewport,
  widgets,
} from "@ice/core";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Field } from "../../src/field/field";
import { FIELD_SHADER_FILES, fieldShaders } from "../../src/field/shaders";
import { Ground, type GroundFrameInputs } from "../../src/compose/ground";
import { groundField, type GroundFieldHandle } from "../../src/compose/host";
import { cursorVisualPoles, localPointerPoles } from "../../src/compose/poles";
import { shaderText } from "../../src/shaders";
import { ENGINE_THEMES } from "../../src/theme";
import { must } from "./must";
import { installGpuGlobals, type Recorded, stubDevice, stubEncoder, stubGpu, stubPass } from "./stub-gpu";

const CARD = widgets.get("fd:card") ?? defineWidget({ type: "fd:card", surface: "dom", component: null, defaultSize: { w: 200, h: 120 } });
const ROOT = defineCanvasType({ id: "fd:root", semanticVersion: 1, semantic: { placement: { widgets: [CARD] } }, presentation: { ground: { glyph: "dot" } } });
const OTHER = defineCanvasType({ id: "fd:other", semanticVersion: 1, semantic: { placement: { widgets: [CARD] } }, presentation: { ground: { glyph: "dot", grid: { dotAlpha: 0.5 } } } });
const TOOLS = [must(tools.get("select"), "the select tool"), must(tools.get("pan"), "the pan tool")];
const SHADERS = fieldShaders(shaderText(FIELD_SHADER_FILES));

/** A Ground with a REAL root Field: every render prepares and draws it, so its bake count is the engine's. */
async function halfRealGround(device: GPUDevice) {
  const field = await Field.create(device, "rgba8unorm", SHADERS);
  const seen: Recorded = { pipelines: [], draws: [] };
  const self = {
    field,
    frames: { runCount: 0 },
    renders: [] as GroundFrameInputs[],
    get fieldConfig() { return field.config; },
    set fieldConfig(c) { field.config = c; },
    setPages: () => {},
    render(inputs: GroundFrameInputs) {
      self.renders.push(inputs);
      field.prepare(stubEncoder(seen), inputs, inputs.sources, inputs.theme);
      field.draw(stubPass(seen));
      device.queue.submit([]);
      return { frames: inputs.frames.length };
    },
    dispose: () => field.dispose(),
  };
  return self;
}

const settle = () => new Promise<void>((r) => setTimeout(r, 0));

async function mount() {
  const gpu = stubDevice();
  let created: Awaited<ReturnType<typeof halfRealGround>> | null = null;
  vi.spyOn(Ground, "create").mockImplementation(async (o) => { created = await halfRealGround(o.device); return created as unknown as Ground; });
  const ce = createCanvasEngine({ widgets: [CARD], canvasTypes: [ROOT, OTHER], rootCanvas: ROOT, presentationFallback: ROOT, tools: TOOLS });
  ce.docs.create();
  ce.world.setResource(Viewport, { w: 1600, h: 900, dpr: 1 });
  ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  const container = document.createElement("div");
  const contentPlane = document.createElement("div");
  container.appendChild(contentPlane);
  document.body.appendChild(container);
  const handle: GroundFieldHandle = groundField({ gpu: stubGpu(gpu.device), poles: [localPointerPoles(), cursorVisualPoles()] })({
    host: { container, contentPlane }, world: ce.world, canvas: ce.canvas, catalog: ce.catalog, previews: ce.previews,
  });
  ce.engine.registerReflector(handle.reflector);
  const card = ce.ops.spawnWidget("fd:card", { x: 100, y: 100, w: 200, h: 120, undoable: false });
  ce.world.sync();
  await settle();
  let now = 0;
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; ce.step(now); } };
  step(5);   // the mount's owed paint, the board's arrival
  const ground = () => must(created, "the ground");
  const redraws = () => handle.field.redraws();
  const bakes = () => ground().field.stats.bakes;
  return { ce, world: ce.world, gpu, handle, card, step, ground, redraws, bakes };
}

beforeAll(() => installGpuGlobals());
beforeEach(() => { vi.spyOn(globalThis.console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

describe("groundField · idle-zero and the dirty union", () => {
  it("a still scene submits NOTHING over 120 ticks; every fact the ground draws from wakes exactly one redraw", async () => {
    const m = await mount();
    expect(m.redraws()).toBeGreaterThan(0);
    const settled = m.gpu.submits;
    expect(settled).toBe(m.redraws());   // one submit per redraw, none besides
    m.step(120);
    expect(m.gpu.submits).toBe(settled);
    expect(m.redraws()).toBe(settled);

    // the camera
    m.world.setResource(Camera, { x: 40, y: 0, zoom: 1, gesturing: false });
    m.step(3);
    expect(m.redraws()).toBe(settled + 1);
    // the viewport
    m.world.setResource(Viewport, { w: 1500, h: 900, dpr: 1 });
    m.step(3);
    expect(m.redraws()).toBe(settled + 2);
    expect(m.handle.field.canvas.width).toBe(1500);   // and the canvas followed the resource, not a ResizeObserver
    // a source's move (a card's Position — the builder's pulled dirt)
    m.world.edit(m.card).set(Position, { x: 140, y: 100 });
    m.step(3);
    expect(m.redraws()).toBe(settled + 3);
    // a theme change
    m.handle.field.setTheme(ENGINE_THEMES.dark);
    m.step(3);
    expect(m.redraws()).toBe(settled + 4);
    // a re-tune (the react `grid` prop's path)
    m.handle.configureGrid({ dotAlpha: 0.5 });
    m.step(3);
    expect(m.redraws()).toBe(settled + 5);
    expect(m.gpu.submits).toBe(m.redraws());
    m.handle.dispose();
  });

  it("a pole's move is a wake: the pole subscription, not a frame of its own", async () => {
    const m = await mount();
    const cursor = m.world.spawn({ components: [[Position, { x: 300, y: 300 }], [CursorVisual, { kind: "remote", pressed: false }]] });
    m.step(3);
    const before = m.redraws();
    m.step(30);
    expect(m.redraws()).toBe(before);   // a still cursor is still
    m.world.edit(cursor).set(Position, { x: 320, y: 300 });
    m.step(3);
    expect(m.redraws()).toBe(before + 1);
    expect(m.handle.field.stats().poles.wakes).toBeGreaterThan(0);
    m.handle.dispose();
  });
});

describe("groundField · D-C2.2: the local pointer rides the analytic term, a remote pole is a source", () => {
  it("60 pointer writes are 60 redraws and 0 bakes; a remote cursor's 5 moves are 5 bakes", async () => {
    const m = await mount();
    // the adapter's shape: PointerScreen is the EVENT cell (ingest writes it per event), PointerWorld the derive's (a tick behind) — here both by hand
    const mouse = m.world.spawn({ components: [[Pointer, { id: "mouse-1", device: "mouse" }], [PointerScreen, { x: 10, y: 10 }], [PointerWorld, { x: 0, y: 0 }]], tags: [LocalPointer] });
    m.step(3);
    const inputs0 = must(m.ground().renders.at(-1), "a render");
    expect(inputs0.pointer).toEqual({ x: 10, y: 10, on: true, strength: 1 });
    expect(inputs0.sources.every((s) => s.hx > 0)).toBe(true);   // the pointer is NOT among the sources
    const bakes0 = m.bakes();
    const redraws0 = m.redraws();
    for (let i = 1; i <= 60; i++) {
      m.world.edit(mouse).set(PointerScreen, { x: 10 + i * 7, y: 10 + i * 3 });
      m.world.edit(mouse).set(PointerWorld, { x: 10 + i * 7, y: 10 + i * 3 });
      m.step();
    }
    expect(m.redraws()).toBe(redraws0 + 60);
    // and the derive's per-tick PointerWorld rewrite is NOT a wake: 30 such writes, 0 redraws
    const quiet = m.redraws();
    for (let i = 0; i < 30; i++) { m.world.edit(mouse).set(PointerWorld, { x: 10 + 60 * 7, y: 10 + 60 * 3 }); m.step(); }
    expect(m.redraws()).toBe(quiet);
    expect(m.bakes()).toBe(bakes0);   // THE WITNESS: pointer motion never re-bakes the atlas
    expect(must(m.ground().renders.at(-1), "a render").pointer).toEqual({ x: 10 + 60 * 7, y: 10 + 60 * 3, on: true, strength: 1 });

    const remote = m.world.spawn({ components: [[Position, { x: 500, y: 500 }], [CursorVisual, { kind: "remote", pressed: false }]] });
    m.step(3);
    const withRemote = must(m.ground().renders.at(-1), "a render");
    expect(withRemote.sources.filter((s) => s.hx === 0 && s.hy === 0 && s.r === 0)).toEqual([{ cx: 500, cy: 500, hx: 0, hy: 0, r: 0, strength: 1 }]);
    const bakes1 = m.bakes();
    for (let i = 1; i <= 5; i++) {
      m.world.edit(remote).set(Position, { x: 500 + i * 10, y: 500 });
      m.step();
    }
    expect(m.bakes()).toBe(bakes1 + 5);   // a source moved: one bake per move
    expect(m.handle.field.stats().poles).toMatchObject({ sources: 1, pointer: true });
    m.handle.dispose();
  });
});
