/**
 * THE PUBLIC FACTORY BUILDS THE WHOLE THING — and a quiet frame never acquires.
 *
 * Two claims carried onto the new leg at B8, from tests the deletion takes:
 *
 *  1. `factory-parity.test.ts` (design-012 §4). Two defects lived in the gap
 *     between a factory's promise and its wiring, and BOTH were invisible to a
 *     rig that hand-assembles its own parts — which is what every rig in this
 *     repo does, and why they held green: `groundHost` built a quad pass with
 *     no facts and never built a dom binder at all, and `ground({ lift })`
 *     plumbed a driver it never advanced. The class recurs, so the test goes
 *     through the FACTORY and asserts the handle is COMPLETE — every field the
 *     profile reads, filled the way the mount fills it. (The roster's own half
 *     of this claim — that the profile leaves no stub behind when the slots are
 *     full — lives in `@ice/react`'s profile test, which is where the profile
 *     is; `@ice/react` may not import this package.)
 *
 *  2. `compositor-reflector.test.ts`'s ORDERING assertion: a quiet frame must
 *     return BEFORE the swap-chain texture is acquired. Acquiring is work and
 *     commits the frame to a present, so "check dirt, then acquire" and
 *     "acquire, then check dirt" draw the same pixels and are not the same
 *     program. On this leg the acquire is `Ground.render`'s single
 *     `surface.view()`, so a fake Ground counting that call is the same
 *     instrument the old test pointed at its fake target.
 */
import { Camera, createCanvasEngine, defineCanvasType, defineWidget, alwaysGpu, type Entity, tools, Viewport, widgets, FrameInfo } from "@ice/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Ground } from "../../src/compose/ground";
import { groundCompose, type GroundComposeHandle } from "../../src/compose/host";
import { FIT } from "../../src/nav/flight";
import { THEMES } from "../../oracle/fixtures/vf-theme";
import { must } from "./must";

// `createPages` and the ingest read the browser's usage-flag namespace.
(globalThis as unknown as { GPUTextureUsage?: unknown }).GPUTextureUsage ??= {
  TEXTURE_BINDING: 4,
  COPY_DST: 8,
  COPY_SRC: 2,
  RENDER_ATTACHMENT: 16,
};

// One widget type per FILE (global registry; no test reset).
const CARD = widgets.get("mt:card") ?? defineWidget({ type: "mt:card", surface: "dom", component: null, defaultSize: { w: 200, h: 120 }, behaviors: [alwaysGpu] });
const ROOT = defineCanvasType({
  id: "mt:root",
  semanticVersion: 1,
  semantic: { placement: { widgets: [CARD] } },
  presentation: { camera: { arrival: "fit", padding: FIT.pad, minZoom: FIT.minZoom, maxZoom: FIT.maxZoom } },
});
const TOOLS = [must(tools.get("select"), "the select tool"), must(tools.get("pan"), "the pan tool")];

/** A GPUDevice stand-in: it hands back textures and swallows every encode. */
function fakeDevice(): GPUDevice {
  let n = 0;
  return {
    limits: { maxTextureDimension2D: 4096 },
    createTexture(d: GPUTextureDescriptor) {
      const size = d.size as number[];
      const name = `${String(d.label ?? "tex")}#${n++}`;
      return {
        label: name,
        format: "rgba8unorm",
        width: size[0] ?? 1,
        height: size[1] ?? 1,
        depthOrArrayLayers: size[2] ?? 1,
        createView: (v?: GPUTextureViewDescriptor) => ({ label: name, dimension: v?.dimension ?? "2d" }) as unknown as GPUTextureView,
        destroy: () => {},
      } as unknown as GPUTexture;
    },
    createCommandEncoder: () => ({
      copyTextureToTexture: () => {},
      copyExternalImageToTexture: () => {},
      finish: () => ({}) as unknown as GPUCommandBuffer,
    }) as unknown as GPUCommandEncoder,
    queue: { submit: () => {}, copyExternalImageToTexture: () => {} },
  } as unknown as GPUDevice;
}

/**
 * A Ground whose surface counts acquisitions, exactly as the real one does:
 * `Ground.render` calls `this.surface.view()` once, and nothing else on this
 * class touches the swap chain (pinned below against the real source, so this
 * fake cannot quietly stop mirroring it).
 */
function fakeGround() {
  const self = {
    acquired: 0,
    pagesSet: 0,
    disposed: false,
    fieldConfig: { glyphs: [] } as unknown,
    frames: { runCount: 3 },
    surface: { view: () => { self.acquired += 1; return {} as GPUTextureView; } },
    setPages: () => { self.pagesSet += 1; },
    render: () => { self.surface.view(); },
    dispose: () => { self.disposed = true; },
  };
  return self;
}

interface Mounted {
  readonly handle: GroundComposeHandle;
  readonly ground: ReturnType<typeof fakeGround>;
  readonly ce: ReturnType<typeof createCanvasEngine>;
  readonly container: HTMLElement;
  step(n?: number): void;
  flush(): void;
}

/** Make the host look like a browser with the origin trial on, for `probeHic`. */
function withHic(): void {
  Object.defineProperty(globalThis.navigator, "gpu", { value: {}, configurable: true });
  const proto = globalThis.HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
  proto.requestPaint = () => {};
  proto.getElementTransform = () => new DOMMatrix();
  vi.spyOn(globalThis.HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawElementImage: () => {} } as unknown as CanvasRenderingContext2D);
  vi.stubGlobal("GPUQueue", { prototype: { copyElementImageToTexture: () => {} } });
  // `probeLayoutSubtree` measures a sized child of a `layoutsubtree` canvas;
  // happy-dom lays nothing out, so the discriminator has to be supplied.
  vi.spyOn(globalThis.Element.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, width: 64, height: 32, top: 0, left: 0, right: 64, bottom: 32, toJSON: () => ({}) } as DOMRect);
}

async function mount(opts: { hic?: boolean; hosts?: boolean } = {}): Promise<Mounted> {
  if (opts.hic === true) withHic();
  const ground = fakeGround();
  vi.spyOn(Ground, "create").mockResolvedValue(ground as unknown as Ground);

  const ce = createCanvasEngine({ widgets: [CARD], canvasTypes: [ROOT], rootCanvas: ROOT, presentationFallback: ROOT, tools: TOOLS });
  ce.docs.create();
  ce.world.setResource(Viewport, { w: 1600, h: 900, dpr: 2 });
  ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });

  const container = document.createElement("div");
  const contentPlane = document.createElement("div");
  container.appendChild(contentPlane);
  document.body.appendChild(container);

  const els = new Map<Entity, HTMLElement>();
  const factory = groundCompose({ device: fakeDevice(), theme: THEMES.dark });
  const handle = factory({
    host: { container, contentPlane },
    world: ce.world,
    ...(opts.hosts === false ? {} : { hosts: { contentOf: (e: Entity) => els.get(e), hostOf: (e: Entity) => els.get(e) } }),
  });
  await Promise.resolve();   // let `Ground.create`'s `then` run
  await Promise.resolve();

  let frame = 0;
  return {
    handle,
    ground,
    ce,
    container,
    step: (n = 1) => { for (let i = 0; i < n; i++) { frame += 16; ce.step(frame); } },
    flush: () => { handle.compose.gpuCompose.flush(ce.world); },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
beforeEach(() => {
  vi.spyOn(globalThis.console, "error").mockImplementation(() => {});
});

describe("groundCompose · the factory builds the whole handle (carried from factory-parity at B8)", () => {
  it("fills every slot the profile reads — no part left for a rig to assemble by hand", async () => {
    const m = await mount({ hic: true });
    const c = m.handle.compose;
    // The two reflectors the profile registers itself, at §6's places 8 and 9.
    expect(c.gpuCompose.name).toBe("ground/gpu-compose");
    expect(c.domCompose?.name).toBe("ground/dom-compose");
    // The trunk B4/B5/B6 hang off: the residency, and the producer's door.
    expect(typeof c.residency.attach).toBe("function");
    expect(typeof c.video.register).toBe("function");
    // The three render slots (§6 reflectors 5–7). The ground fills two of them
    // itself; `island` is the r3f root's to fill after ITS mount, so a null
    // here is the design, not a hole.
    expect(c.renders.dom.current?.name).toBe("dom-render");
    expect(c.renders.video.current?.name).toBe("video-ingest");
    expect(c.renders.island.current).toBeNull();
    // DomRender's instruments, and the L1 canvas's half of the adapter.
    expect(c.domRender).not.toBeNull();
    expect(c.sourceCanvas).not.toBeNull();
    expect(typeof c.sourceCanvas?.effects.markAsSourceCanvas).toBe("function");
    // The canvas is IN the container, immediately before the content plane.
    expect(c.canvas.parentElement).toBe(m.container);
    expect(c.canvas.nextElementSibling).toBe(m.container.lastElementChild);
    expect(c.available()).toBe(true);
    m.handle.dispose();
  });

  it("degrades honestly: no hosts ⇒ no DomCompose, no DomRender, no L1 — and the ground still draws", async () => {
    const m = await mount({ hosts: false });
    const c = m.handle.compose;
    expect(c.domCompose).toBeUndefined();
    expect(c.domRender).toBeNull();
    expect(c.sourceCanvas).toBeNull();
    expect(c.renders.dom.current).toBeNull();
    expect(c.renders.video.current).not.toBeNull();   // the producer's door does not depend on the DOM
    m.step(2);
    m.flush();
    expect(c.redraws()).toBeGreaterThan(0);
    m.handle.dispose();
  });

  it("a host without the origin trial gets no L1 canvas, and nothing is refused", async () => {
    const m = await mount();   // happy-dom: `probeHic().supported` is false
    expect(m.handle.compose.sourceCanvas).toBeNull();
    expect(m.handle.compose.domRender).not.toBeNull();   // built anyway; it simply never copies
    expect(m.handle.compose.available()).toBe(true);
    m.handle.dispose();
  });

  it("dispose gives everything back — the canvas, the slots, the Ground", async () => {
    const m = await mount({ hic: true });
    const c = m.handle.compose;
    m.handle.dispose();
    expect(c.canvas.parentElement).toBeNull();
    expect(c.renders.dom.current).toBeNull();
    expect(c.renders.video.current).toBeNull();
    expect(m.ground.disposed).toBe(true);
    expect(c.available()).toBe(false);
  });
});

describe("GpuCompose · a quiet frame returns BEFORE the swap chain is acquired (carried from compositor-reflector at B8)", () => {
  it("an idle tick acquires nothing, however long it idles", async () => {
    const m = await mount({ hic: true });
    m.ce.ops.spawnWidget("mt:card", { x: 0, y: 0, w: 200, h: 120, undoable: false });
    m.ce.world.sync();
    // Settle: the mount owes a paint, the springs move, the board arrives.
    for (let i = 0; i < 40; i++) { m.step(); m.flush(); }
    const settled = m.ground.acquired;
    expect(settled).toBeGreaterThan(0);         // it really does draw
    expect(m.handle.compose.redraws()).toBe(settled);

    // THE PROPERTY. Nothing changes; 120 ticks pass; the swap chain is never
    // touched. Acquiring first and checking dirt after would read 120 here and
    // put the same pixels on screen.
    for (let i = 0; i < 120; i++) { m.step(); m.flush(); }
    expect(m.ground.acquired).toBe(settled);
    expect(m.handle.compose.redraws()).toBe(settled);

    // …and the counterpart, without which the above passes for the wrong
    // reason: a camera move is dirt, and dirt acquires.
    m.ce.world.setResource(Camera, { x: 40, y: 0, zoom: 1, gesturing: false });
    m.step();
    m.flush();
    expect(m.ground.acquired).toBe(settled + 1);
    m.handle.dispose();
  });

  it("a tick with no viewport yet stays dirty and acquires nothing", async () => {
    const m = await mount({ hic: true });
    m.ce.world.setResource(Viewport, { w: 0, h: 0, dpr: 2 });
    m.step(2);
    m.flush();
    expect(m.ground.acquired).toBe(0);
    // The debt is KEPT: the frame paints the moment a viewport exists.
    m.ce.world.setResource(Viewport, { w: 1600, h: 900, dpr: 2 });
    m.step();
    m.flush();
    expect(m.ground.acquired).toBe(1);
    m.handle.dispose();
  });

  it("the fake mirrors the real Ground: `render` is the ONE place that acquires", () => {
    // The instrument above is only worth its assertions while the real class
    // acquires exactly where the fake does. This is the tether.
    const source = readFileSync(join(process.cwd(), "src", "compose", "ground.ts"), "utf8");
    const acquires = source.match(/this\.surface\.view\(\)/g) ?? [];
    expect(acquires.length).toBe(1);
    expect(source).toMatch(/render\(inputs: GroundFrameInputs\)[\s\S]{0,400}this\.surface\.view\(\)/);
  });
});

describe("groundCompose · the reflector contract", () => {
  it("GpuCompose never writes the ECS and never reads layout", async () => {
    const m = await mount({ hic: true });
    m.ce.ops.spawnWidget("mt:card", { x: 0, y: 0, w: 200, h: 120, undoable: false });
    m.ce.world.sync();
    m.step(4);
    const tick = must(m.ce.world.getResource(FrameInfo), "FrameInfo").tick;
    const rects = vi.spyOn(globalThis.Element.prototype, "getBoundingClientRect");
    rects.mockClear();
    m.flush();
    expect(rects).not.toHaveBeenCalled();
    // the flush changed no world fact: the tick is the world's own clock, untouched
    expect(must(m.ce.world.getResource(FrameInfo), "FrameInfo").tick).toBe(tick);
    m.handle.dispose();
  });
});
