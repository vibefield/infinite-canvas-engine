/**
 * The GL-LEG WITNESS, through the real React path (design-012 §9 S5's named
 * gap, closed here).
 *
 * S5 landed the producer half — islands render on the app-owned device and
 * publish `gl` sources — and measured it by reading render targets back
 * directly, because the compositor had no `gl` leg to draw them with. Its
 * island-parity rig therefore proves three's output is right; it does not
 * prove anything reaches a screen. This rig closes that: a REAL
 * `<Canvas gl={islandRendererFactory}>` with a REAL `<GLViews compositor={…}>`,
 * mounted by React, whose islands are drawn by ground's `WidgetQuadPass` onto
 * the compositor's own target — the first time that whole chain has executed.
 *
 * ── The orientation question, asked HERE rather than inherited ────────────
 * S5 measured the y-flip at the TARGET level (513 px unflipped vs 9,531
 * flipped) and I do not re-derive it. But "the flip belongs in the pipeline"
 * and "my leg applies it correctly" are different claims, and only the second
 * one is about this code. So the rig composites the same island BOTH ways
 * through the real pass and grades which one agrees with the island's own
 * pixels — the same two-orientation method, applied one layer down.
 *
 * ── Two witness laws inherited from S5, both load-bearing ─────────────────
 *  (a) A fresh WebGPURenderer's FIRST paint differs slightly (84 opaque-
 *      interior px) and converges after any event-loop turn. Everything here
 *      repaints before grading.
 *  (b) WebGL `readRenderTargetPixels` is bottom-up while WebGPU
 *      `copyTextureToBuffer` is top-down. This rig is WebGPU on BOTH sides —
 *      the compositor target and the island target are read the same way — so
 *      there is no row-order normalisation to do, and doing one anyway would
 *      manufacture the very phantom the law warns about. Stated rather than
 *      silently skipped.
 *
 * Mounted from `composited-app.html`, driven by `scripts/composited-app.mjs`.
 */
import {
  Active,
  Camera,
  Grab,
  MeasuredSize,
  NO_ENTITY,
  Position,
  PrefabId,
  Size,
  Viewport,
  Visible,
  acquireCompositorDevice,
  createCompositorSourceRegistry,
  createEngine,
  createWorld,
  defineWidget,
  type CompositorSource,
  type Entity,
  type EngineGpu,
  type MountEntry,
} from "@ice/core";
import {
  changedElements,
  createCompositorReflector,
  createDomSourceBinder,
  createWidgetQuadPass,
  createLiftDriver,
  createWorldQuadFacts,
  instrumentSubmits,
  markAsSourceCanvas,
  onPaint,
  resolveGlSource,
  type CompositeTarget,
  type QuadTexture,
  type SubmitInstrument,
} from "@ice/ground";
import {
  createCanvasHost,
  createDomWidgetsReflector,
  createDomWritebackReflector,
  createPlanes,
  createPresentationPolicy,
  createPresentationRegistry,
  createSourceCanvas,
} from "@ice/dom";
import { GLViews, createGLBridge, type GLBridge } from "@ice/r3f";
import { widgets } from "@ice/core";
import { islandRendererFactory } from "@ice/r3f/webgpu";
import { Canvas } from "@react-three/fiber";
import { useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";

// --- the island widget ------------------------------------------------------

/**
 * Island-local space is origin-CENTRE and Y-UP (kernel Law 13), so a mesh at
 * +y is ABOVE centre in the scene. After the compositor's flip it must appear
 * in the UPPER half on screen — which is the whole orientation test, and the
 * reason this scene is deliberately asymmetric top-to-bottom.
 *
 * Flat `meshBasicMaterial`, no lights: the grading compares colours, and a lit
 * material would make brightness depend on normals and MSAA rather than on
 * which way up the image is.
 */
function IslandProbeView(): ReactElement {
  return (
    <>
      {/* BRIGHT bar, above centre. */}
      <mesh position={[0, 55, 0]}>
        <planeGeometry args={[150, 60]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      {/* DIM bar, below centre. */}
      <mesh position={[0, -55, 0]}>
        <planeGeometry args={[150, 60]} />
        <meshBasicMaterial color="#1b3a5c" />
      </mesh>
      {/* A mid band so the two halves are never confused with an empty target. */}
      <mesh position={[0, 0, 0]}>
        <planeGeometry args={[60, 24]} />
        <meshBasicMaterial color="#e8c547" />
      </mesh>
    </>
  );
}

export const IslandProbe = defineWidget({
  type: "island-probe",
  surface: "gl",
  animated: false,
  component: IslandProbeView,
  sizeMode: "fixed",
  defaultSize: { w: 200, h: 200 },
  interaction: { selectable: false, movable: false },
});

/**
 * Proof that R3F committed inside the Canvas. Without it, "no island" is
 * ambiguous between "GLViews filtered it out" and "the Canvas never mounted" —
 * two different bugs with two different fixes.
 */
function CanvasProbe({ onMount }: { onMount: () => void }): null {
  useEffect(() => {
    onMount();
  }, [onMount]);
  return null;
}

// --- plumbing ---------------------------------------------------------------

const CARD_W = 200;
const CARD_H = 200;

function makeStore() {
  let snapshot: readonly MountEntry[] = [];
  const listeners = new Set<() => void>();
  return {
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getSnapshot: () => snapshot,
    set(entries: readonly MountEntry[]) {
      snapshot = entries;
      for (const l of listeners) l();
    },
  };
}

interface Capture {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

/** Box-average a capture down to `n`×`n`, so two different resolutions compare. */
function downsample(cap: Capture, region: { x: number; y: number; w: number; h: number }, n: number) {
  const out = new Float64Array(n * n * 3);
  for (let gy = 0; gy < n; gy++) {
    for (let gx = 0; gx < n; gx++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      const x0 = region.x + Math.floor((gx * region.w) / n);
      const x1 = region.x + Math.floor(((gx + 1) * region.w) / n);
      const y0 = region.y + Math.floor((gy * region.h) / n);
      const y1 = region.y + Math.floor(((gy + 1) * region.h) / n);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          if (x < 0 || y < 0 || x >= cap.width || y >= cap.height) continue;
          const i = (y * cap.width + x) * 4;
          r += cap.data[i] as number;
          g += cap.data[i + 1] as number;
          b += cap.data[i + 2] as number;
          count++;
        }
      }
      const at = (gy * n + gx) * 3;
      out[at] = count === 0 ? 0 : r / count;
      out[at + 1] = count === 0 ? 0 : g / count;
      out[at + 2] = count === 0 ? 0 : b / count;
    }
  }
  return out;
}

/** Mean absolute channel difference between two downsampled grids. */
function gridDelta(a: Float64Array, b: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs((a[i] as number) - (b[i] as number));
  return sum / a.length;
}

/** Flip a downsampled grid vertically — for the two-orientation comparison. */
function flipGrid(grid: Float64Array, n: number): Float64Array {
  const out = new Float64Array(grid.length);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const from = (y * n + x) * 3;
      const to = ((n - 1 - y) * n + x) * 3;
      out[to] = grid[from] as number;
      out[to + 1] = grid[from + 1] as number;
      out[to + 2] = grid[from + 2] as number;
    }
  }
  return out;
}

/** Mean luminance of the top half minus the bottom half of a grid. */
function topMinusBottom(grid: Float64Array, n: number): number {
  let top = 0;
  let bottom = 0;
  let topN = 0;
  let bottomN = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const at = (y * n + x) * 3;
      const lum =
        0.2126 * (grid[at] as number) + 0.7152 * (grid[at + 1] as number) + 0.0722 * (grid[at + 2] as number);
      if (y < n / 2) {
        top += lum;
        topN++;
      } else {
        bottom += lum;
        bottomN++;
      }
    }
  }
  return top / Math.max(1, topN) - bottom / Math.max(1, bottomN);
}

export interface AppRig {
  ready: Promise<void>;
  mount(): Promise<Record<string, unknown>>;
  /** Composite once and grade the island: orientation, agreement, placement. */
  gradeIsland(flip: boolean): Promise<Record<string, unknown>>;
  /** Does a dom card ordered ABOVE the island cover it? (one pass, true z) */
  mixedZ(): Promise<Record<string, unknown>>;
  /** THE S6 WITNESS: drag a card UNDER a GL widget, sampling every frame. */
  dragUnder(steps: number): Promise<Record<string, unknown>>;
  teardown(): void;
}

export function mountCompositedApp(): AppRig {
  const container = document.createElement("div");
  container.style.cssText = "position:absolute;inset:0;background:#101010;overflow:hidden;";
  document.body.appendChild(container);

  const world = createWorld();
  const engine = createEngine(world);
  const host = createCanvasHost(container);
  const planes = createPlanes(host);
  const store = makeStore();
  const presentation = createPresentationRegistry();
  const sources = createCompositorSourceRegistry();

  const gpuCanvas = document.createElement("canvas");
  gpuCanvas.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;";
  container.insertBefore(gpuCanvas, container.firstChild);

  const l1 = createSourceCanvas(
    container,
    { markAsSourceCanvas, onPaint, changedElements },
    { onDirty: (hosts) => { for (const h of hosts) if (!writeback.consumeTransformWrite(h)) binder?.markDirtyHosts([h]); } },
  );

  /** R3F's own canvas never presents in this profile — keep it out of the way. */
  const reactHost = document.createElement("div");
  reactHost.style.cssText =
    "position:absolute;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden;";
  container.appendChild(reactHost);

  let gpu: EngineGpu | undefined;
  let instrument: SubmitInstrument | undefined;
  let binder: ReturnType<typeof createDomSourceBinder> | undefined;
  let compositor: ReturnType<typeof createCompositorReflector> | undefined;
  let context: GPUCanvasContext | undefined;
  let format: GPUTextureFormat = "bgra8unorm";
  let lastTexture: GPUTexture | undefined;
  let bridge: GLBridge | undefined;
  let root: Root | undefined;
  let lift: ReturnType<typeof createLiftDriver> | undefined;
  let quadPass: ReturnType<typeof createWidgetQuadPass> | undefined;
  /** Build the pass and keep a handle, so the rig can read drawn/skipped. */
  const buildQuadPass = (deps: Parameters<typeof createWidgetQuadPass>[0]) => {
    quadPass = createWidgetQuadPass(deps);
    return quadPass;
  };
  /**
   * Rig knob: the two-orientation comparison drives the SAME pass both ways.
   * Production is `false` — see gl-source.ts's orientation note.
   */
  let flipIslands = false;
  /** Set from inside the Canvas subtree — see CanvasProbe. */
  let canvasMounted = false;

  const domWidgets = createDomWidgetsReflector(
    { contentPlane: planes.content, liftedPlane: planes.lifted, sourceCanvas: l1.canvas },
    world,
    store,
    { presentation, sources },
  );
  const writeback = createDomWritebackReflector(
    {
      hostElementFor: (e) => domWidgets.hostElementFor(e),
      compositedEntities: () => domWidgets.compositedEntities(),
      compositedRevision: () => domWidgets.compositedRevision(),
    },
    world,
  );

  let island: Entity | undefined;
  let card: Entity | undefined;
  const order: Entity[] = [];

  const ready = (async () => {
    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth;
    const h = container.clientHeight;
    gpuCanvas.width = Math.round(w * dpr);
    gpuCanvas.height = Math.round(h * dpr);
    l1.resize(w, h, dpr);

    gpu = await acquireCompositorDevice();
    instrument = instrumentSubmits(gpu.device);
    context = gpuCanvas.getContext("webgpu") as GPUCanvasContext;
    format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
      device: gpu.device,
      format,
      alphaMode: "premultiplied",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });

    world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
    world.setResource(Viewport, { w, h, dpr });

    // ONE LIFT: the ease that replaces the CSS spring and the island's own.
    // An explicit scale so the witness can SEE it; a product reads
    // ChromeSettings.liftScale.
    lift = createLiftDriver(world, { scale: 1.08 });
    // TWO facts functions: the binder sizes slots from the card's REAL
    // geometry, the quad pass draws the LIFTED one. Sharing the lifted
    // function re-slots the card on every frame of the ease and composites it
    // as nothing at all — see quad-facts.ts.
    const facts = createWorldQuadFacts(world);
    const displayFacts = createWorldQuadFacts(world, { lift });
    binder = createDomSourceBinder(gpu.device, sources, (e) => facts(e), {
      firstPageSize: { width: 1024, height: 1024 },
      onDirt: () => compositor?.mark("dom"),
    });

    const target: CompositeTarget = {
      format,
      getCurrentTexture: () => {
        const t = (context as GPUCanvasContext).getCurrentTexture();
        lastTexture = t;
        return t;
      },
      size: () => ({ width: gpuCanvas.width, height: gpuCanvas.height, dpr }),
    };

    compositor = createCompositorReflector({
      world,
      registry: sources,
      quadPass: buildQuadPass({
        device: gpu.device,
        format,
        registry: sources,
        order: () => order,
        facts: displayFacts,
        resolve: (entity, source) => {
          const s = source as CompositorSource;
          if (s.kind === "gl") {
            const resolved = resolveGlSource(s);
            // The rig's ONE deviation from production: it can ask the same
            // pass for the wrong orientation, so "flipped is right" is a
            // measurement here and not an assumption.
            return resolved === undefined
              ? undefined
              : ({ ...resolved, flipY: flipIslands } as QuadTexture);
          }
          return (binder as NonNullable<typeof binder>).resolve(entity, s);
        },
      }),
      device: gpu.device,
      target,
      prepare: (frame) => {
        const b = binder as NonNullable<typeof binder>;
        // A lift is presentation dirt with no ECS stamp behind it: `Grab` is
        // written once and the 180 ms that follows changes no cell. Re-marking
        // on "still animating" is what keeps it moving.
        if (lift?.advance() === true) compositor?.mark("promotion");
        b.sync(frame);
        if (b.pending() > 0) compositor?.mark("dom");
      },
      clearValue: { r: 0, g: 0, b: 0, a: 0 },
    });

    // The bridge installs its own reflectors on construction, BEFORE the
    // compositor's — so an island repaints and is composited in the same
    // engine flush rather than one frame late.
    bridge = createGLBridge(engine, {});
    // The Q5 default: promote on grab, demote one settle window after the
    // drop. The drag witness relies on it — nothing promotes the card by hand.
    engine.registerReflector(createPresentationPolicy(world, presentation, { settleMs: 250 }));
    engine.registerReflector(domWidgets);
    engine.registerReflector(writeback);
    engine.registerReflector(compositor);
  })();

  const raf = () => new Promise((r) => requestAnimationFrame(() => r(undefined)));
  const settle = async (times = 4) => {
    for (let i = 0; i < times; i++) {
      engine.step(performance.now());
      await raf();
    }
  };

  async function readTexture(texture: GPUTexture, width: number, height: number): Promise<Capture> {
    const device = (gpu as EngineGpu).device;
    const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
    const buffer = device.createBuffer({
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture },
      { buffer, bytesPerRow, rowsPerImage: height },
      { width, height, depthOrArrayLayers: 1 },
    );
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    await buffer.mapAsync(GPUMapMode.READ);
    const padded = new Uint8Array(buffer.getMappedRange()).slice();
    buffer.unmap();
    buffer.destroy();
    const bgra = format.startsWith("bgra");
    const out = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const s = y * bytesPerRow + x * 4;
        const d = (y * width + x) * 4;
        out[d] = (bgra ? padded[s + 2] : padded[s]) as number;
        out[d + 1] = padded[s + 1] as number;
        out[d + 2] = (bgra ? padded[s] : padded[s + 2]) as number;
        out[d + 3] = padded[s + 3] as number;
      }
    }
    return { width, height, data: out };
  }

  /** Composite once and read the compositor's target, in the SAME task. */
  async function compositeAndRead(): Promise<Capture> {
    compositor?.mark("island");
    engine.step(performance.now());
    const texture = lastTexture;
    if (texture === undefined) throw new Error("rig: the compositor never acquired a target");
    return readTexture(texture, gpuCanvas.width, gpuCanvas.height);
  }

  /** The island's OWN target, straight off the GPU — the oracle. */
  async function islandTargetCapture(): Promise<Capture | null> {
    const source = island === undefined ? undefined : sources.get(island);
    if (source === undefined || source.kind !== "gl") return null;
    const texture = source.texture();
    if (texture === undefined) return null;
    return readTexture(texture, texture.width, texture.height);
  }

  const screenRect = (entity: Entity) => {
    const cam = world.getResource(Camera) ?? { x: 0, y: 0, zoom: 1 };
    const dpr = window.devicePixelRatio || 1;
    const p = world.get(entity, Position);
    const s = world.get(entity, Size);
    const scale = cam.zoom * dpr;
    return {
      x: Math.round(((p?.x ?? 0) - cam.x) * scale),
      y: Math.round(((p?.y ?? 0) - cam.y) * scale),
      w: Math.round((s?.w ?? 0) * scale),
      h: Math.round((s?.h ?? 0) * scale),
    };
  };

  /**
   * Read SEVERAL small sub-rects of a texture in ONE submit.
   *
   * Plural on purpose. `getCurrentTexture()` hands out a swap-chain texture
   * that is destroyed once the frame presents, so a second read issued after
   * the first one's `await` copies from a dead texture — "Destroyed texture
   * [...WebgpuSwapChainTexture...] used in a submit", and the buffer comes back
   * zeroed. Reading three points per frame that way made a correctly
   * composited card look absent for the whole drag. Enqueue every copy first,
   * submit once, then await the maps.
   *
   * 64 px wide is exactly `copyTextureToBuffer`'s 256-byte row alignment.
   */
  async function readRegions(
    texture: GPUTexture,
    points: Array<{ x: number; y: number }>,
    size = 16,
  ): Promise<Uint8Array[]> {
    const device = (gpu as EngineGpu).device;
    const bytesPerRow = 256;
    const buffers = points.map(() =>
      device.createBuffer({
        size: bytesPerRow * size,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      }),
    );
    const encoder = device.createCommandEncoder();
    points.forEach((pt, i) => {
      encoder.copyTextureToBuffer(
        {
          texture,
          origin: { x: Math.max(0, Math.round(pt.x)), y: Math.max(0, Math.round(pt.y)), z: 0 },
        },
        { buffer: buffers[i] as GPUBuffer, bytesPerRow, rowsPerImage: size },
        { width: 64, height: size, depthOrArrayLayers: 1 },
      );
    });
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    const out: Uint8Array[] = [];
    for (const buffer of buffers) {
      await buffer.mapAsync(GPUMapMode.READ);
      out.push(new Uint8Array(buffer.getMappedRange()).slice());
      buffer.unmap();
      buffer.destroy();
    }
    return out;
  }

  /** One region, for callers that are not reading a live swap-chain texture. */
  async function readRegion(texture: GPUTexture, x: number, y: number, size = 16): Promise<Uint8Array> {
    return (await readRegions(texture, [{ x, y }], size))[0] as Uint8Array;
  }

  /** The modal colour of a region — robust to a stray AA pixel at its edge. */
  function modalColour(region: Uint8Array, bgra = format.startsWith("bgra")): number[] {
    const counts = new Map<number, number>();
    for (let i = 0; i < region.length; i += 4) {
      const key =
        ((region[i] as number) << 24) |
        ((region[i + 1] as number) << 16) |
        ((region[i + 2] as number) << 8) |
        (region[i + 3] as number);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    let best = 0;
    let bestN = -1;
    for (const [k, n] of counts) {
      if (n > bestN) {
        best = k;
        bestN = n;
      }
    }
    const c0 = (best >>> 24) & 0xff;
    const c1 = (best >>> 16) & 0xff;
    const c2 = (best >>> 8) & 0xff;
    return bgra ? [c2, c1, c0, best & 0xff] : [c0, c1, c2, best & 0xff];
  }

  /**
   * THE S6 WITNESS (design-012 §9 S6).
   *
   * A dragged DOM card passes UNDER a GL widget at its true sibling ordinal —
   * the inverse of design-004 §1's named accepted consequence, where a
   * picked-up card jumps to P3 and pops above every GL surface on the board.
   *
   * Two fixed screen sample points, because "the island wins" is only
   * meaningful next to "the card is drawn at all":
   *
   *   P_ISLAND  the island's centre, which the card passes through. EVERY
   *             frame must show the island — one frame of card colour is the
   *             z-pop, which is why this is a sequence and not a screenshot.
   *   P_SIDE    left of the island, on the card's path. Frames where the card
   *             covers it must show the CARD. Without this, a card that never
   *             composited at all would pass the z test perfectly.
   */
  async function dragUnder(steps: number) {
    const islandE = island as Entity;
    const cardE = card as Entity;
    // Paint order: card FIRST, island second ⇒ the island is above. This is
    // the ordering the stratified profile cannot honour for a dragged card.
    order.length = 0;
    order.push(cardE, islandE);

    world.edit(cardE).set(Position, { x: -40, y: 170 });
    await settle(4);

    const dpr = window.devicePixelRatio || 1;
    const P_ISLAND = { x: 440, y: 440 };
    const P_SIDE = { x: 96, y: 440 };

    // Pick it up. The POLICY promotes it — the rig never calls setPresentation.
    world.addComponent(cardE, Grab, {
      x: 0,
      y: 0,
      w: 160,
      h: 100,
      parent: NO_ENTITY,
      prev: NO_ENTITY,
      ord: 0,
    });
    await settle(3);
    const promoted = presentation.get(cardE);
    // DIAGNOSTIC: force one re-copy at the host's current, known-good state.
    // If the card appears only after this, the slot was holding pixels captured
    // in some earlier state and nothing had marked it dirty since.
    const refusedBefore = binder?.refusedCopies() ?? 0;
    binder?.atlas.markDirty(cardE);
    compositor?.mark("dom");
    await settle(3);
    const refusedAfter = binder?.refusedCopies() ?? 0;

    // THE SPLIT that matters: read the ATLAS PAGE at the card's own slot. If
    // the slot is transparent the COPY captured nothing; if it is red the copy
    // is fine and the DRAW is at fault. Guessing between those two has already
    // cost three wrong hypotheses.
    let slotSample = "no-slot";
    const placement = binder?.atlas.placementOf(cardE);
    if (placement !== undefined) {
      const px = await readRegion(
        placement.texture,
        placement.rect.x + 16,
        placement.rect.y + 16,
        16,
      );
      slotSample = JSON.stringify(modalColour(px, false)); // atlas pages are rgba8unorm
    }

    const frames: Array<{
      x: number;
      island: number[];
      side: number[];
      cardCentre: number[];
      cardRect: number[];
      drawn: number;
      skipped: number;
      registered: boolean;
      residency: string;
      host: string;
      slotRect: string;
      coversIsland: boolean;
      coversSide: boolean;
      lift: number;
    }> = [];

    for (let i = 0; i < steps; i++) {
      const worldX = -40 + (i * 420) / Math.max(1, steps - 1);
      world.edit(cardE).set(Position, { x: worldX, y: 170 });
      compositor?.mark("promotion");
      engine.step(performance.now());
      const texture = lastTexture;
      if (texture === undefined) continue;
      const cx = worldX * dpr;
      const cw = 160 * dpr;
      const cardCentreX0 = cx + cw / 2;
      const cardCentreY0 = (170 + 50) * dpr;
      const [islandRegion, sideRegion, cardRegion] = await readRegions(texture, [
        { x: P_ISLAND.x - 32, y: P_ISLAND.y - 8 },
        { x: P_SIDE.x - 32, y: P_SIDE.y - 8 },
        { x: cardCentreX0 - 32, y: cardCentreY0 - 8 },
      ]);
      frames.push({
        x: Math.round(worldX),
        island: modalColour(islandRegion as Uint8Array),
        side: modalColour(sideRegion as Uint8Array),
        cardCentre: modalColour(cardRegion as Uint8Array),
        cardRect: [Math.round(cx), Math.round(cardCentreY0 - 100), Math.round(cw), 200],
        // Why is the card not there? These three split it: not registered, no
        // resident slot, or drawn-but-invisible.
        drawn: quadPass?.drawn() ?? -1,
        skipped: quadPass?.skipped() ?? -1,
        registered: sources.has(cardE),
        residency: binder?.atlas.allocator.get(cardE)?.residency ?? "none",
        host: (() => {
          const el = domWidgets.hostElementFor(cardE);
          if (el === undefined) return "no-host";
          const r = el.getBoundingClientRect();
          return `${el.style.width}x${el.style.height} ${el.style.transform} rect=${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)} kids=${el.firstElementChild?.childElementCount ?? -1} parent=${el.parentElement?.tagName ?? "none"}`;
        })(),
        slotRect: (() => {
          const slot = binder?.atlas.allocator.get(cardE);
          return slot === undefined ? "none" : `${slot.rect.width}x${slot.rect.height}@${slot.rect.x},${slot.rect.y}`;
        })(),
        coversIsland: cx <= P_ISLAND.x && cx + cw >= P_ISLAND.x,
        coversSide: cx <= P_SIDE.x && cx + cw >= P_SIDE.x,
        lift: Number((lift?.factsFor(cardE).scale ?? 1).toFixed(3)),
      });
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    }

    world.removeComponent(cardE, Grab);
    await settle(4);
    return {
      promoted,
      afterDrop: presentation.get(cardE),
      refusedDuringPromote: refusedAfter - refusedBefore,
      slotSample,
      frames,
    };
  }

  return {
    ready,

    async mount() {
      await ready;
      const device = (gpu as EngineGpu).device;

      island = world.spawn({
        components: [
          [Position, { x: 120, y: 120 }],
          [Size, { w: CARD_W, h: CARD_H }],
          [PrefabId, { id: "island-probe" }],
        ],
      });
      card = world.spawn({
        components: [
          [Position, { x: 220, y: 220 }],
          [Size, { w: 160, h: 100 }],
        ],
      });
      // ACTIVE + VISIBLE, stamped by hand.
      //
      // The island phase machine reads exactly these two tags
      // (`computeIslandPhase(active, visible, …)`): without `Active` an island
      // is DORMANT — "a texture from another nav frame" — and is never
      // presentable, so it is never published, however many times it paints.
      // Measured before this line existed: the island reached
      // `fboGeneration: 2` (it had painted twice, into a real FBO) and still
      // sat at phase Dormant with an empty registry.
      //
      // In a product these come from the derive systems `installWidgetRuntime`
      // installs (active membership, then cull). This rig drives a hand-rolled
      // mount store because it is measuring the COMPOSITOR, not the membership
      // policy — so it owes the tags those systems would have stamped.
      world.addTag(island, Active);
      world.addTag(island, Visible);
      world.addTag(card, Active);
      world.addTag(card, Visible);
      // Paint order: island FIRST, dom card second ⇒ the card is on top. This
      // ordering is the whole point of one pass — a dom card at its sibling
      // ordinal over a GL widget, in true z.
      order.push(island, card);
      store.set([
        { entity: island, hidden: false },
        { entity: card, hidden: false },
      ]);
      presentation.set(card, "composited");

      root = createRoot(reactHost);
      root.render(
        <Canvas
          orthographic
          frameloop="never"
          gl={islandRendererFactory({ device })}
          style={{ width: "1px", height: "1px" }}
        >
          <CanvasProbe onMount={() => { canvasMounted = true; }} />
          <GLViews
            engine={engine}
            bridge={bridge as GLBridge}
            store={store}
            compositor={{ registry: sources, markPainted: () => compositor?.mark("island") }}
          />
        </Canvas>,
      );

      // Let React commit, the async renderer factory resolve, and three paint.
      //
      // THE CAMERA NUDGE IS NOT DECORATION. The bridge's `r3fAdvance` reflector
      // only calls R3F `advance()` when something latched dirt, and the only
      // global sources of that are Camera/Viewport/StageMode writes. This rig
      // sets both resources once, BEFORE the bridge exists, and then nothing
      // ever moves — so with no nudge the bridge stays quiet forever, three
      // never paints, the island's phase stays Dormant, and it is never
      // published. A live app gets this for free from the first pan, resize or
      // gesture; a rig has to say it out loud. (Measured: without the nudge the
      // Canvas mounted, the widget registered and the entity was alive, and the
      // registry still held only the dom card.)
      let published = false;
      for (let i = 0; i < 60 && !published; i++) {
        world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
        await settle(2);
        published = sources.get(island)?.kind === "gl";
      }
      // WITNESS LAW (a): a fresh WebGPURenderer's FIRST paint differs slightly
      // (84 opaque-interior px, S5) and converges after any event-loop turn.
      // Force several more paints so nothing here grades a first frame.
      for (let i = 0; i < 4; i++) {
        world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
        await settle(2);
      }

      // Fill the dom card so the mixed-z test has something opaque to see.
      const content = domWidgets.hostFor(card);
      if (content !== undefined && content.childElementCount === 0) {
        const fill = document.createElement("div");
        fill.style.cssText = "width:100%;height:100%;background:#d94f4f;";
        content.appendChild(fill);
      }
      await settle(6);

      const source = sources.get(island);
      const glTexture = source?.kind === "gl" ? source.texture() : undefined;
      const registered = widgets.get("island-probe");
      return {
        // Diagnostics that separate the ways "no island" can happen.
        canvasMounted,
        // The island's own phase machine — the direct answer to "why is this
        // not presentable", instead of another guess about the layer above.
        islandStates: [...(bridge?.state.all() ?? [])].map(([e, st]) => ({
          entity: String(e),
          phase: (st as { phase: string }).phase,
          fboGeneration: (st as { fboGeneration: number }).fboGeneration,
        })),
        widgetRegistered: registered !== undefined,
        widgetSurface: registered?.surface ?? null,
        entityAlive: world.isAlive(island),
        storeEntries: store.getSnapshot().length,
        reactHostSize: `${reactHost.clientWidth}x${reactHost.clientHeight}`,
        islandEntity: String(island),
        cardEntity: String(card),
        registered: sources.size(),
        islandKind: source?.kind ?? null,
        islandHasTexture: glTexture !== undefined,
        islandTextureSize: glTexture === undefined ? null : `${glTexture.width}x${glTexture.height}`,
        islandIsSrgb: source?.kind === "gl" ? source.srgb() : null,
        canvasHosts: domWidgets.canvasHostCount(),
        submits: instrument?.total() ?? 0,
        gpuErrors: gpu?.errors().length ?? 0,
      };
    },

    async gradeIsland(flip) {
      flipIslands = flip;
      // Move the dom card CLEAR of the island first. It exists for the mixed-z
      // test, and while it sits over the island every "does the composite match
      // the island's own pixels" number is really measuring the card.
      if (card !== undefined) world.edit(card).set(Position, { x: 900, y: 60 });
      await settle(3);
      const composited = await compositeAndRead();
      const target = await islandTargetCapture();
      const rect = screenRect(island as Entity);

      const N = 24;
      const compositedGrid = downsample(composited, rect, N);
      const targetGrid =
        target === null ? null : downsample(target, { x: 0, y: 0, w: target.width, h: target.height }, N);

      // The island's own target read the same way the compositor target is
      // read (both WebGPU copyTextureToBuffer, both top-down) — so the only
      // orientation difference between them is the one the pass applied.
      const agreeAsIs = targetGrid === null ? null : gridDelta(compositedGrid, targetGrid);
      const agreeFlipped =
        targetGrid === null ? null : gridDelta(compositedGrid, flipGrid(targetGrid, N));

      let ink = 0;
      const distinct = new Set<number>();
      for (let y = rect.y; y < rect.y + rect.h; y++) {
        for (let x = rect.x; x < rect.x + rect.w; x++) {
          if (x < 0 || y < 0 || x >= composited.width || y >= composited.height) continue;
          const i = (y * composited.width + x) * 4;
          const a = composited.data[i + 3] as number;
          if (a > 8) ink++;
          distinct.add(
            ((composited.data[i] as number) << 16) |
              ((composited.data[i + 1] as number) << 8) |
              (composited.data[i + 2] as number),
          );
        }
      }
      return {
        flip,
        rect,
        ink,
        area: rect.w * rect.h,
        distinct: distinct.size,
        // Positive ⇒ the BRIGHT bar (authored above centre in island space)
        // is on top, which is the correct orientation.
        topMinusBottom: topMinusBottom(compositedGrid, N),
        targetTopMinusBottom: targetGrid === null ? null : topMinusBottom(targetGrid, N),
        agreeAsIs,
        agreeFlipped,
        targetSize: target === null ? null : `${target.width}x${target.height}`,
      };
    },

    dragUnder,

    async mixedZ() {
      flipIslands = false;
      // Park the card back OVER the island for this test — the overlap is the
      // whole point.
      if (card !== undefined) world.edit(card).set(Position, { x: 220, y: 220 });
      await settle(3);
      const composited = await compositeAndRead();
      const islandRect = screenRect(island as Entity);
      const cardRect = screenRect(card as Entity);
      // Sample inside the OVERLAP: the dom card paints last, so it wins.
      const x = Math.round(cardRect.x + cardRect.w * 0.25);
      const y = Math.round(cardRect.y + cardRect.h * 0.25);
      const i = (y * composited.width + x) * 4;
      const overlaps =
        cardRect.x < islandRect.x + islandRect.w &&
        cardRect.y < islandRect.y + islandRect.h &&
        x < islandRect.x + islandRect.w &&
        y < islandRect.y + islandRect.h;
      return {
        overlaps,
        at: { x, y },
        rgba: [
          composited.data[i] as number,
          composited.data[i + 1] as number,
          composited.data[i + 2] as number,
          composited.data[i + 3] as number,
        ],
        quadsDrawn: order.length,
      };
    },

    teardown() {
      root?.unmount();
      bridge?.uninstall();
      compositor?.dispose();
      binder?.dispose();
      writeback.dispose();
      domWidgets.dispose();
      l1.dispose();
      planes.dispose();
      host.dispose();
      container.remove();
    },
  };
}

declare global {
  interface Window {
    __appRig?: AppRig;
  }
}

window.__appRig = mountCompositedApp();
