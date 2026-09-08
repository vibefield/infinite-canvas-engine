// @vitest-environment happy-dom
/**
 * The STRATIFIED profile's ground on the engine — `groundField` (design-013 §8
 * C2, D-C2.3/D-C2.4), the rows the old `program-host.test.ts` carried re-pointed
 * at the one host:
 *
 *  - the canvas-type SWITCH changes the root slot's config (the type's glyph and
 *    grid, resolved at every switch), and the composited factory gets the same
 *    for free (one host, two factories);
 *  - the wires/guides GATES follow the type;
 *  - `configureGrid` lands on top of the type's grid and survives a switch;
 *  - a live PORTAL's slot takes its INSIDE type's config, with no frames;
 *  - the flight's DEPARTED slot keeps the config it was drawn with at the cut;
 *  - a REFUSED adapter leaves the layer unavailable, loudly, and the app alive;
 *  - the handle carries no `compose` (so the composited profile refuses it);
 *  - an UNREGISTERED glyph draws as the dot (the field's own law).
 *
 * `Ground.create` is replaced by a fake that records what it is handed (the
 * pipelines are Dawn's and Chrome's to run — the oracle and the desktop rig);
 * the device comes through a stub `GPU`, so the acquisition path is the real one.
 */
import {
  Camera,
  type CanvasType,
  createCanvasEngine,
  defineCanvasType,
  defineContainer,
  defineWidget,
  type Entity,
  NavTransition,
  tools,
  Viewport,
  widgets,
} from "@ice/core";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Field } from "../../src/field/field";
import { DEFAULT_FIELD_CONFIG, type FieldConfig, type FieldFrame } from "../../src/field/layout";
import { FIELD_SHADER_FILES, fieldShaders } from "../../src/field/shaders";
import { Ground, type GroundFrameInputs } from "../../src/compose/ground";
import { groundCompose, type GroundComposeHandle, groundField, type GroundFieldHandle } from "../../src/compose/host";
import { FIT } from "../../src/nav/flight";
import { FOLDER_FACE } from "../../src/nav/portal";
import { shaderText } from "../../src/shaders";
import { ENGINE_THEMES } from "../../src/theme";
import { must } from "./must";
import { installGpuGlobals, type Recorded, stubDevice, stubEncoder, stubGpu, stubPass } from "./stub-gpu";

// One widget type per FILE (global registry; no test reset).
const CARD = widgets.get("fh:card") ?? defineWidget({ type: "fh:card", surface: "dom", component: null, defaultSize: { w: 200, h: 120 } });
const INSIDE = defineCanvasType({
  id: "fh:inside",
  semanticVersion: 1,
  semantic: { placement: { widgets: [CARD] } },
  presentation: {
    ground: { glyph: "line", grid: { dotAlpha: 0.3 }, wires: false, guides: true },
    camera: { arrival: "fit", padding: FIT.pad, minZoom: FIT.minZoom, maxZoom: FIT.maxZoom },
  },
});
const FOLDER = widgets.get("fh:folder") ?? defineContainer({
  type: "fh:folder", canvas: INSIDE, component: null, defaultSize: { w: 329, h: 345 },
  portal: { top: FOLDER_FACE.top, right: FOLDER_FACE.right, bottom: FOLDER_FACE.bottom, left: FOLDER_FACE.left }, provides: ["widget"],
});
const ROOT = defineCanvasType({
  id: "fh:root",
  semanticVersion: 1,
  semantic: { placement: { widgets: [CARD, FOLDER] } },
  presentation: {
    ground: { glyph: "needle", grid: { dotAlpha: 0.7, magnet: { reach: 90 } }, wires: true, guides: true },
    camera: { arrival: "fit", padding: FIT.pad, minZoom: FIT.minZoom, maxZoom: FIT.maxZoom },
  },
});
const TOOLS = [must(tools.get("select"), "the select tool"), must(tools.get("pan"), "the pan tool")];
const FOLDER_AT = { x: 700, y: 100, w: 329, h: 345 };

/** A Ground that records what it is handed: its config, every render's inputs. */
function fakeGround(device: GPUDevice) {
  const self = {
    device,
    disposed: false,
    fieldConfig: DEFAULT_FIELD_CONFIG as FieldConfig,
    renders: [] as GroundFrameInputs[],
    field: { stats: { bakes: 0 } },
    frames: { runCount: 0 },
    setPages: () => {},
    render(inputs: GroundFrameInputs) { self.renders.push(inputs); device.queue.submit([]); return { frames: inputs.frames.length }; },
    dispose: () => { self.disposed = true; },
  };
  return self;
}

interface Mounted {
  readonly ce: ReturnType<typeof createCanvasEngine>;
  readonly container: HTMLElement;
  readonly gpu: ReturnType<typeof stubDevice>;
  ground(): ReturnType<typeof fakeGround>;
  step(n?: number): void;
  last(): GroundFrameInputs;
}

/** Let the acquisition and the (mocked) creation settle: a macrotask drains every microtask hop. */
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

interface BoardOpts {
  /** Leave the catalog off: a live portal's inside type then resolves to nothing. */
  readonly catalog?: false;
  /**
   * Drive the canvas seam by hand instead of the engine's. `type()` answers the SAME type for
   * ever, so `fire()` is a canvas-session change that is not a type change — a board entered
   * inside a board, which the engine's own seam has no widget pair here to produce.
   */
  readonly seam?: { type(): CanvasType | undefined; subscribe(onChange: () => void): () => void; fire(): void };
}

/**
 * A canvas seam the test drives: `set` is a session change that CHANGES the type (what
 * `enterContainer` does through the engine's own seam), `fire` one that does not — a board entered
 * inside a board, which these two widget types have no pair to produce.
 */
function drivenSeam(initial: CanvasType) {
  let type = initial;
  const subs = new Set<() => void>();
  return {
    type: () => type as CanvasType | undefined,
    subscribe: (cb: () => void) => { subs.add(cb); return () => { subs.delete(cb); }; },
    set(next: CanvasType) { type = next; for (const cb of subs) cb(); },
    fire() { for (const cb of subs) cb(); },
  };
}

async function board(opts: BoardOpts = {}): Promise<Mounted & { handle: GroundFieldHandle; folder: Entity; card: Entity }> {
  const gpu = stubDevice();
  let created: ReturnType<typeof fakeGround> | null = null;
  vi.spyOn(Ground, "create").mockImplementation(async (o) => { created = fakeGround(o.device); return created as unknown as Ground; });
  const ce = createCanvasEngine({ widgets: [CARD, FOLDER], canvasTypes: [ROOT, INSIDE], rootCanvas: ROOT, presentationFallback: ROOT, tools: TOOLS });
  ce.docs.create();
  ce.world.setResource(Viewport, { w: 1600, h: 900, dpr: 1 });
  ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  const container = document.createElement("div");
  const contentPlane = document.createElement("div");
  container.appendChild(contentPlane);
  document.body.appendChild(container);
  const handle = groundField({ gpu: stubGpu(gpu.device) })({
    host: { container, contentPlane }, world: ce.world, canvas: opts.seam ?? ce.canvas, previews: ce.previews, transitions: ce.transitions,
    ...(opts.catalog === false ? {} : { catalog: ce.catalog }),
  });
  ce.engine.registerReflector(handle.reflector);
  const card = ce.ops.spawnWidget("fh:card", { x: 100, y: 100, w: 200, h: 120, undoable: false });
  const folder = ce.ops.spawnWidget("fh:folder", { ...FOLDER_AT, undoable: false });
  ce.world.sync();
  let now = 0;
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; ce.step(now); } };
  step();
  ce.ops.spawnWidget("fh:card", { x: 0, y: 0, w: 200, h: 120, parent: folder, undoable: false });
  ce.world.sync();
  await settle();
  step(3);
  const ground = () => must(created, "the fake ground");
  return { ce, container, gpu, handle, folder, card, ground, step, last: () => must(ground().renders.at(-1), "a render") };
}

beforeAll(() => installGpuGlobals());
beforeEach(() => { vi.spyOn(globalThis.console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

describe("groundField · the canvas type's declaration is the root slot's config (D-C2.4)", () => {
  it("resolves the ROOT slot from the current type — its glyph and its grid — and again at every switch", async () => {
    const m = await board();
    expect(m.handle.field.available()).toBe(true);
    expect(m.ground().fieldConfig).toMatchObject({ glyph: "needle", inkAlpha: 0.7, reach: 90 });
    m.ce.ops.enterContainer(m.folder, { transition: "none" });
    m.step(2);
    expect(m.ground().fieldConfig).toMatchObject({ glyph: "line", inkAlpha: 0.3, reach: DEFAULT_FIELD_CONFIG.reach });
    m.ce.ops.exitContainer({ transition: "none" });
    m.step(2);
    expect(m.ground().fieldConfig).toMatchObject({ glyph: "needle", inkAlpha: 0.7, reach: 90 });
    m.handle.dispose();
  });

  it("the wires/guides GATES follow the type: on at the root, the wires off inside", async () => {
    const m = await board();
    expect(m.handle.field.stats().overlays).toMatchObject({ wiresOn: true, guidesOn: true });
    m.ce.ops.enterContainer(m.folder, { transition: "none" });
    m.step(2);
    expect(m.handle.field.stats().overlays).toMatchObject({ wiresOn: false, guidesOn: true });
    m.handle.dispose();
  });

  it("configureGrid lands on top of the type's grid, one level deep on the magnet block, and survives a switch", async () => {
    const m = await board();
    m.handle.configureGrid({ dotAlpha: 0.2, magnet: { polarity: -1 } });
    m.step();
    expect(m.ground().fieldConfig).toMatchObject({ glyph: "needle", inkAlpha: 0.2, reach: 90, polarity: -1 });
    m.ce.ops.enterContainer(m.folder, { transition: "none" });
    m.step(2);
    // the inside's own glyph and reach, the prop's alpha and polarity over them
    expect(m.ground().fieldConfig).toMatchObject({ glyph: "line", inkAlpha: 0.2, reach: DEFAULT_FIELD_CONFIG.reach, polarity: -1 });
    m.handle.dispose();
  });

  it("a live portal's slot takes its INSIDE type's config, and carries no frames — nor does the root (the DOM draws the cards)", async () => {
    const m = await board();
    const inputs = m.last();
    expect(inputs.frames).toHaveLength(0);
    expect(inputs.config).toBeUndefined();   // the root's config is `ground.fieldConfig` (set above), never carried per frame
    const portal = must(inputs.portals?.[0], "the folder's live portal");
    expect(portal.config).toMatchObject({ glyph: "line", inkAlpha: 0.3 });
    expect(portal.frames).toHaveLength(0);
    expect(portal.sources.length).toBe(1);   // the inside's one card still bends the inside's field
    // the root's sources are the two on-screen cards (the card and the folder)
    expect(inputs.sources).toHaveLength(2);
    m.handle.dispose();
  });

  it("the flight's DEPARTED slot keeps the parent's config at the cut while the root takes the inside's", async () => {
    const m = await board();
    m.ce.ops.enterContainer(m.folder);   // a flight: the Viewport is real
    m.step();
    const cut = m.last();
    expect(m.ground().fieldConfig.glyph).toBe("line");
    const out = must(cut.outgoing, "the departed slot");
    expect(out.config).toMatchObject({ glyph: "needle", inkAlpha: 0.7, reach: 90 });
    expect(out.frames).toHaveLength(0);
    expect(out.order).toBe("under");
    expect(out.sources.length).toBe(2);
    m.handle.dispose();
  });

  it("the handle carries `field`, never `compose` — the composited profile has nothing to mistake it for", async () => {
    const m = await board();
    expect((m.handle as { compose?: unknown }).compose).toBeUndefined();
    expect(m.handle.reflector.name).toBe("ground/field");
    expect(m.handle.field.device()).toBe(m.gpu.device);
    expect(m.handle.field.status()).toEqual({ state: "ready" });
    m.handle.dispose();
    expect(m.gpu.destroyed).toBe(1);   // the device is the layer's own: destroyed last
    expect(m.handle.field.device()).toBeUndefined();
  });
});

describe("groundField · a refused adapter (D-C2.3)", () => {
  it("leaves the layer unavailable and says so on the console; the app steps on", async () => {
    const create = vi.spyOn(Ground, "create");
    const ce = createCanvasEngine({ widgets: [CARD, FOLDER], canvasTypes: [ROOT, INSIDE], rootCanvas: ROOT, presentationFallback: ROOT, tools: TOOLS });
    ce.docs.create();
    ce.world.setResource(Viewport, { w: 1600, h: 900, dpr: 1 });
    ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
    const container = document.createElement("div");
    const contentPlane = document.createElement("div");
    container.appendChild(contentPlane);
    document.body.appendChild(container);
    const handle = groundField({ gpu: stubGpu(null) })({ host: { container, contentPlane }, world: ce.world, canvas: ce.canvas });
    ce.engine.registerReflector(handle.reflector);
    await settle();
    let now = 0;
    for (let i = 0; i < 5; i++) { now += 16; ce.step(now); }   // nothing throws in the frame
    expect(handle.reflector.available()).toBe(false);
    expect(handle.field.status().state).toBe("failed");
    expect(handle.field.status().message).toMatch(/requestAdapter\(\) returned null/);
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/ground\/field: no ground/), expect.any(Error));
    expect(create).not.toHaveBeenCalled();
    expect(handle.field.redraws()).toBe(0);
    expect(container.querySelectorAll("canvas")).toHaveLength(1);   // the canvas is there, blank; the DOM planes are above it
    handle.dispose();
    expect(container.querySelectorAll("canvas")).toHaveLength(0);
  });
});

describe("groundCompose · the composited profile gets the per-slot configs for free (one host)", () => {
  it("the root switch changes its config too", async () => {
    const gpu = stubDevice();
    let created: ReturnType<typeof fakeGround> | null = null;
    vi.spyOn(Ground, "create").mockImplementation(async (o) => { created = fakeGround(o.device); return created as unknown as Ground; });
    const ce = createCanvasEngine({ widgets: [CARD, FOLDER], canvasTypes: [ROOT, INSIDE], rootCanvas: ROOT, presentationFallback: ROOT, tools: TOOLS });
    ce.docs.create();
    ce.world.setResource(Viewport, { w: 1600, h: 900, dpr: 1 });
    ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
    const container = document.createElement("div");
    const contentPlane = document.createElement("div");
    container.appendChild(contentPlane);
    document.body.appendChild(container);
    const handle: GroundComposeHandle = groundCompose({ device: gpu.device, theme: ENGINE_THEMES.dark })({ host: { container, contentPlane }, world: ce.world, canvas: ce.canvas, catalog: ce.catalog, previews: ce.previews });
    ce.engine.registerReflector(handle.reflector);
    ce.engine.registerReflector(handle.compose.gpuCompose);
    const folder = ce.ops.spawnWidget("fh:folder", { ...FOLDER_AT, undoable: false });
    ce.world.sync();
    await settle();
    let now = 0;
    const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; ce.step(now); } };
    step(3);
    const g = must(created as ReturnType<typeof fakeGround> | null, "the fake ground");
    expect(g.fieldConfig).toMatchObject({ glyph: "needle", inkAlpha: 0.7 });
    // and its portal, from the inside's type — with the folder's frame still drawn (this is the composited ground)
    const inputs = must(g.renders.at(-1), "a render");
    expect(inputs.frames).toHaveLength(1);
    expect(must(inputs.portals?.[0], "the portal").config).toMatchObject({ glyph: "line", inkAlpha: 0.3 });
    ce.ops.enterContainer(folder, { transition: "none" });
    step(2);
    expect(g.fieldConfig).toMatchObject({ glyph: "line", inkAlpha: 0.3 });
    handle.dispose();
    expect(gpu.destroyed).toBe(0);   // the app's device is the app's
  });
});

describe("an unregistered glyph draws as the dot — the field's own law, on the real Field", () => {
  it("a type naming a glyph nothing registered still draws (the dot's rungs), and never refuses the frame", async () => {
    vi.spyOn(globalThis.console, "warn").mockImplementation(() => {});   // it says so once; `line-glyph.test.ts` asserts that
    const { device } = stubDevice();
    const field = await Field.create(device, "rgba8unorm", fieldShaders(shaderText(FIELD_SHADER_FILES)));
    const seen: Recorded = { pipelines: [], draws: [] };
    field.config = { ...DEFAULT_FIELD_CONFIG, glyph: "no-such-glyph" };
    const frame: FieldFrame = { view: { camX: 0, camY: 0, zoom: 1, width: 1200, height: 800, dpr: 1 }, pointer: { x: 0, y: 0, on: false } };
    field.prepare(stubEncoder(seen), frame, [], ENGINE_THEMES.light);
    const stats = field.draw(stubPass(seen));
    expect(stats.surface).toBeNull();
    expect(seen.pipelines.some((p) => p.startsWith("field/dot/"))).toBe(true);
    expect(stats.instances).toBeGreaterThan(0);
    field.dispose();
  });
});

describe("groundField · the DEPARTED slot's config is snapshotted at every session change (D-C4.2)", () => {
  // The cut takes the config the departed frame was DRAWN with. Taking that snapshot only past the
  // type test left two ways to be wrong: a re-tune at rest moved the root and not the departed
  // slot, and a same-type enter (a board inside a board — the stratified rig flies board →
  // whiteboard → board) never refreshed it at all, so the second slot drew in the config from
  // before the last TYPE change and the enter popped.
  it("a SAME-TYPE session change refreshes it: the departed slot flies in the config the root had at the cut", async () => {
    const seam = drivenSeam(ROOT);
    const m = await board({ seam });
    // Two cross-type switches leave the two configs genuinely apart, with no re-tune anywhere
    // near them: the root is back on ROOT's, the departed slot still holds INSIDE's.
    seam.set(INSIDE);
    m.step();
    seam.set(ROOT);
    m.step();
    expect(m.handle.field.config()).toMatchObject({ glyph: "needle", inkAlpha: 0.7, reach: 90 });

    seam.fire();                       // the same type, a new session: a cut like any other
    m.step();
    m.ce.ops.enterContainer(m.folder); // a real flight, on the world's NavTransition
    m.step();
    const out = must(m.last().outgoing, "the departed slot");
    // the frame that departed was drawn in ROOT's config, and that is what it flies in
    expect(out.config).toMatchObject({ glyph: "needle", inkAlpha: 0.7, reach: 90 });
    m.handle.dispose();
  });

  it("a re-tune at REST moves the departed config too; one mid-FLIGHT does not", async () => {
    const m = await board({ seam: drivenSeam(ROOT) });
    m.handle.configureGrid({ dotAlpha: 0.25 });   // at rest: the two configs are one config
    m.step();
    m.ce.ops.enterContainer(m.folder);
    m.step();
    expect(must(m.last().outgoing, "the departed slot").config).toMatchObject({ inkAlpha: 0.25 });

    // mid-flight the departed frame keeps what the cut left it with, whatever the panel does now
    expect(m.ce.world.getResource(NavTransition)?.active).toBe(true);
    m.handle.configureGrid({ dotAlpha: 0.9 });
    m.step();
    expect(m.handle.field.config()).toMatchObject({ inkAlpha: 0.9 });
    expect(must(m.last().outgoing, "the departed slot").config).toMatchObject({ inkAlpha: 0.25 });
    m.handle.dispose();
  });
});

describe("groundField · a LOST device ends the layer (D-C4.3)", () => {
  it("disposes the ground, removes the canvas, and never renders again", async () => {
    const m = await board();
    expect(m.handle.field.available()).toBe(true);
    const drawn = m.ground().renders.length;
    const submits = m.gpu.submits;
    expect(drawn).toBeGreaterThan(0);

    await m.gpu.lose("unknown", "the driver reset");

    expect(m.handle.field.available()).toBe(false);
    expect(m.handle.reflector.available()).toBe(false);
    expect(m.handle.field.status().state).toBe("failed");
    expect(m.handle.field.status().message).toMatch(/the device was lost/);
    expect(m.ground().disposed).toBe(true);
    expect(m.container.querySelectorAll("canvas")).toHaveLength(0);   // the page shows through
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/ground\/field: the device was lost/), expect.any(Error));

    // the layer is over FOR GOOD: dirt keeps arriving and nothing is drawn on the dead device
    m.ce.world.setResource(Camera, { x: 400, y: 0, zoom: 1, gesturing: false });
    m.step(10);
    expect(m.ground().renders.length).toBe(drawn);
    expect(m.gpu.submits).toBe(submits);
    m.handle.dispose();
  });
});

describe("groundField · the default theme follows the OS at the mount (D-C4.4)", () => {
  /** Stub `matchMedia` without `vi.unstubAllGlobals`, which would take the GPU enum globals with it. */
  async function withMatchMedia<T>(answer: ((q: string) => boolean) | null, fn: () => Promise<T>): Promise<T> {
    const had = Object.getOwnPropertyDescriptor(globalThis, "matchMedia");
    const value = answer === null ? undefined : (q: string) => ({ matches: answer(q), media: q, addEventListener: () => {}, removeEventListener: () => {} });
    Object.defineProperty(globalThis, "matchMedia", { value, configurable: true, writable: true });
    try {
      return await fn();
    } finally {
      if (had === undefined) Reflect.deleteProperty(globalThis, "matchMedia");
      else Object.defineProperty(globalThis, "matchMedia", had);
    }
  }

  it("a dark OS gets the dark ground; no matchMedia at all (Node, a lab) gets the light one", async () => {
    const dark = await withMatchMedia((q) => q.includes("dark"), async () => {
      const m = await board();
      const bg = m.last().theme.canvasBg;
      m.handle.dispose();
      return bg;
    });
    expect(dark).toEqual(ENGINE_THEMES.dark.canvasBg);

    const light = await withMatchMedia(null, async () => {
      const m = await board();
      const bg = m.last().theme.canvasBg;
      m.handle.dispose();
      return bg;
    });
    expect(light).toEqual(ENGINE_THEMES.light.canvasBg);
    expect(ENGINE_THEMES.dark.canvasBg).not.toEqual(ENGINE_THEMES.light.canvasBg);
  });
});

describe("groundField · a portal whose inside type does not resolve is COUNTED", () => {
  it("falls back to the parent's config, as it always did — and says how often", async () => {
    const m = await board({ catalog: false });
    const portal = must(m.last().portals?.[0], "the folder's live portal");
    expect(portal.config).toMatchObject({ glyph: "needle", inkAlpha: 0.7 });   // the parent's, not the inside's
    expect(m.handle.field.stats().portalsUnresolved).toBeGreaterThan(0);
    m.handle.dispose();

    const ok = await board();
    expect(must(ok.last().portals?.[0], "the portal").config).toMatchObject({ glyph: "line" });
    expect(ok.handle.field.stats().portalsUnresolved).toBe(0);
    ok.handle.dispose();
  });
});
