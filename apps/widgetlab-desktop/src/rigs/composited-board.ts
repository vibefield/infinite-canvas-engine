/**
 * The S2 exit rig (design-012 §9 S2): a static all-composited board, pixel-
 * compared against the STRATIFIED render of the same board.
 *
 * The board is the same DOM in both arms — the same host nodes, the same
 * markup, the same CSS. Only WHO PAINTS changes:
 *
 *   stratified — hosts sit in the camera-transformed content plane and the
 *                browser paints them. This is the ORACLE.
 *   composited — the same hosts are reparented into the L1 `layoutsubtree`
 *                canvas (where they lay out, hit-test, and are never painted),
 *                HiC copies each into an atlas slot, and the compositor draws
 *                them as GPU quads.
 *
 * A difference is therefore attributable: it is the compositor, not the
 * content. And because promotion is a REPARENT of the same node, the arms
 * cannot drift the way two hand-built boards would.
 *
 * TWO WITNESSES, deliberately (the S1 lesson: a single witness can agree with
 * itself about a defect):
 *
 *   1. the WINDOW capture, in the main process — end to end, through whatever
 *      the OS compositor did;
 *   2. the compositor's OWN texture, read straight back off the GPU and
 *      compared against the stratified window capture. Layer-independent: it
 *      shares no code path with witness 1 below the page.
 *
 * Every capture is CONTENT-GUARDED before any diff is believed. Two blanks
 * compare perfectly equal, and on Electron 43.1.1 `drawImage` from a live
 * WebGPU canvas is silently blank (S1 finding 1) — so a rig that forgets the
 * guard grades blanks as passes.
 *
 * Mounted from `composited-board.html`, driven by `scripts/composited-board.mjs`.
 */
import {
  Camera,
  MeasuredSize,
  Opacity,
  Position,
  Size,
  Viewport,
  acquireCompositorDevice,
  createCompositorSourceRegistry,
  createEngine,
  createWorld,
  type Entity,
  type EngineGpu,
  type MountEntry,
} from "@ice/core";
import {
  changedElements,
  createDomSourceBinder,
  createCompositorReflector,
  createWidgetQuadPass,
  createWorldQuadFacts,
  instrumentSubmits,
  markAsSourceCanvas,
  onPaint,
  type CompositeTarget,
  type SubmitInstrument,
} from "@ice/ground";
import {
  createCanvasHost,
  createDomWidgetsReflector,
  createDomWritebackReflector,
  createPlanes,
  createPresentationRegistry,
  createSourceCanvas,
} from "@ice/dom";

export type Variant = "stratified" | "composited";

/** A deterministic board: no animation, no gradients that could dither. */
const COLS = 4;
const CARD_W = 150;
const CARD_H = 90;
const GAP = 24;
const MARGIN = 40;

const PALETTE = [
  ["#1b3a5c", "#e8c547"],
  ["#4a1b5c", "#54e8c5"],
  ["#5c1b1b", "#e8a047"],
  ["#1b5c2e", "#c5e847"],
  ["#2e2e5c", "#e84754"],
  ["#5c4a1b", "#47c5e8"],
];

interface Card {
  readonly entity: Entity;
  readonly title: string;
}

/** Minimal mount store — the rig measures presentation, not the mount policy. */
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

/**
 * The card's visual. Identical bytes in both arms — only the painter differs.
 *
 * `text` exists to SEPARATE two questions the S2 exit conflates. design-012 §5
 * names a fidelity seam it accepts: privacy-preserving paint strips subpixel
 * AA, so composited text is grayscale-AA and a live-dom card's glyphs need not
 * match it byte for byte. Geometry, colour and blending have no such licence.
 * A text-free board therefore asks "is the compositor exact?" and a text board
 * measures the seam — and mixing them would let a real geometry error hide
 * inside an expected text difference.
 */
function paintCard(target: HTMLElement, index: number, title: string, text: boolean): void {
  const [bg, fg] = PALETTE[index % PALETTE.length] as [string, string];
  target.style.cssText =
    `width:100%;height:100%;box-sizing:border-box;display:flex;flex-direction:column;font:600 13px/1.2 -apple-system,system-ui,sans-serif;overflow:hidden;background:${bg};border:3px solid ${fg};color:#ffffff;`;
  const bar = document.createElement("div");
  bar.style.cssText = `height:18px;background:${fg};`;
  const label = document.createElement("div");
  label.style.cssText = "padding:8px 10px;letter-spacing:0.4px;height:17px;box-sizing:content-box;";
  // A same-sized block keeps both boards geometrically identical, so the only
  // variable between them is the presence of glyphs.
  if (text) label.textContent = title;
  const rows = document.createElement("div");
  rows.style.cssText = "padding:0 10px;display:flex;gap:4px;";
  for (let i = 0; i < 4; i++) {
    const chip = document.createElement("span");
    chip.style.cssText = `width:14px;height:14px;background:${i % 2 === 0 ? fg : "#ffffff"};`;
    rows.appendChild(chip);
  }
  target.append(bar, label, rows);
}

interface Capture {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

function stats(px: Uint8Array | Uint8ClampedArray) {
  const counts = new Map<number, number>();
  for (let i = 0; i < px.length; i += 4) {
    const k = ((px[i] as number) << 24) | ((px[i + 1] as number) << 16) | ((px[i + 2] as number) << 8) | (px[i + 3] as number);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let mode = 0;
  for (const n of counts.values()) if (n > mode) mode = n;
  const total = px.length / 4;
  return { distinct: counts.size, ink: total - mode, total };
}

function diff(a: Uint8Array | Uint8ClampedArray, b: Uint8Array | Uint8ClampedArray) {
  if (a.length !== b.length) return { error: `length ${a.length} vs ${b.length}`, differing: -1, maxDelta: -1, total: 0 };
  let differing = 0;
  let maxDelta = 0;
  let sum = 0;
  for (let i = 0; i < a.length; i += 4) {
    let d = 0;
    for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs((a[i + c] as number) - (b[i + c] as number)));
    if (d > 0) differing++;
    if (d > maxDelta) maxDelta = d;
    sum += d;
  }
  return { differing, maxDelta, meanAbsDelta: sum / (a.length / 4), total: a.length / 4, error: null };
}

export interface BoardRig {
  ready: Promise<void>;
  /** Switch every card to this presentation and settle the frame. */
  run(variant: Variant, n?: number, text?: boolean): Promise<Record<string, unknown>>;
  /** Read the compositor's own colour target straight off the GPU. */
  readCompositor(): Promise<Capture>;
  /** Composite with a quad corner radius and measure the covered area. */
  roundedArea(radiusCss: number, opacity: number): Promise<Record<string, number>>;
  /** Compare a stored compositor readback against a supplied RGBA buffer. */
  idle(ms: number): Promise<Record<string, number>>;
  atlas(): Record<string, number>;
  teardown(): void;
}

export function mountBoardRig(): BoardRig {
  const container = document.createElement("div");
  container.style.cssText =
    "position:absolute;inset:0;background:#101010;overflow:hidden;";
  document.body.appendChild(container);

  const world = createWorld();
  const engine = createEngine(world);
  const host = createCanvasHost(container);
  const planes = createPlanes(host);
  const store = makeStore();
  const presentation = createPresentationRegistry();
  const sources = createCompositorSourceRegistry();

  // L0's canvas goes in FIRST so it paints under the content plane; in the
  // composited arm the content plane is empty and this is the only picture.
  const gpuCanvas = document.createElement("canvas");
  gpuCanvas.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;";
  container.insertBefore(gpuCanvas, container.firstChild);

  // L1 — the source canvas. Composited hosts become its immediate children.
  const l1 = createSourceCanvas(
    container,
    { markAsSourceCanvas, onPaint, changedElements },
    { onDirty: (hosts) => { paintEvents++; binder?.markDirtyHosts(hosts); } },
  );

  let paintEvents = 0;
  /**
   * Quad corner radius, in CSS px, for the SDF probe. Zero for the parity arms:
   * a DOM card's own border-radius is rasterised INTO its atlas pixels, so
   * asking the shader to round the quad as well would clip an already-round
   * corner twice. The SDF path exists for sources whose pixels are a plain
   * rectangle (islands at S5), and this is how S2 validates it.
   */
  let quadRadius = 0;
  let gpu: EngineGpu | undefined;
  let instrument: SubmitInstrument | undefined;
  let binder: ReturnType<typeof createDomSourceBinder> | undefined;
  let compositor: ReturnType<typeof createCompositorReflector> | undefined;
  let context: GPUCanvasContext | undefined;
  let format: GPUTextureFormat = "bgra8unorm";
  let lastTexture: GPUTexture | undefined;

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

  const cards: Card[] = [];

  const ready = (async () => {
    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth;
    const h = container.clientHeight;
    gpuCanvas.width = Math.round(w * dpr);
    gpuCanvas.height = Math.round(h * dpr);
    // L1's BITMAP is the region in which element paint records are cached
    // (measured: scripts/hic-paint-record.mjs). A host outside it cannot be
    // copied at all, and one straddling its edge copies a partial card while
    // raising no error — so this is a correctness call, not a tuning one.
    l1.resize(w, h, dpr);

    gpu = await acquireCompositorDevice();
    // Instrument at `queue.submit` BEFORE any consumer, so nothing can hide
    // work from the idle-zero measurement.
    instrument = instrumentSubmits(gpu.device);

    context = gpuCanvas.getContext("webgpu") as GPUCanvasContext;
    format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
      device: gpu.device,
      format,
      alphaMode: "premultiplied",
      // COPY_SRC is what makes witness 2 possible: the compositor's own target,
      // read back off the GPU without going through the window.
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });

    world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
    world.setResource(Viewport, { w, h, dpr });

    const facts = createWorldQuadFacts(world, { radius: () => quadRadius });
    binder = createDomSourceBinder(gpu.device, sources, (e) => facts(e), {
      // A board this size fits one page; the hint spares it the growth ladder
      // (the allocator's finding 6: six reallocations without it).
      firstPageSize: { width: 2048, height: 2048 },
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
      quadPass: createWidgetQuadPass({
        device: gpu.device,
        format,
        registry: sources,
        // Paint order = L1's own child sequence = sibling order (petition 8).
        order: () => domWidgets.compositedEntities(),
        facts,
        resolve: (e, s) => (binder as NonNullable<typeof binder>).resolve(e, s as never),
      }),
      device: gpu.device,
      target,
      prepare: (frame) => (binder as NonNullable<typeof binder>).sync(frame),
      clearValue: { r: 0, g: 0, b: 0, a: 0 },
    });

    // Roster order (plan §4.3): placements before the composite that reads them.
    engine.registerReflector(domWidgets);
    engine.registerReflector(writeback);
    engine.registerReflector(compositor);
  })();

  function spawn(n: number): void {
    if (cards.length >= n) return;
    for (let i = cards.length; i < n; i++) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const entity = world.spawn({
        components: [
          [Position, { x: MARGIN + col * (CARD_W + GAP), y: MARGIN + row * (CARD_H + GAP) }],
          [Size, { w: CARD_W, h: CARD_H }],
        ],
      });
      cards.push({ entity, title: `CARD ${String(i).padStart(2, "0")}` });
    }
    store.set(cards.map((c) => ({ entity: c.entity, hidden: false })));
  }

  /** One engine step plus a rAF, so layout and the composite both settle. */
  const settle = async (times = 3): Promise<void> => {
    for (let i = 0; i < times; i++) {
      engine.step(performance.now());
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    }
  };

  /**
   * Composite one frame and read the compositor's colour target back off the
   * GPU — witness 2.
   *
   * The copy is enqueued SYNCHRONOUSLY after `engine.step()`, in the same task.
   * `getCurrentTexture()` hands out a swap-chain texture that is destroyed once
   * the frame is presented, so reading it after an `await` copies from a dead
   * texture: "Destroyed texture [...WebgpuSwapChainTexture...] used in a
   * submit". Enqueue first, await second.
   */
  async function compositeAndRead(): Promise<Capture> {
    const device = (gpu as EngineGpu).device;
    const width = gpuCanvas.width;
    const height = gpuCanvas.height;
    const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
    const buffer = device.createBuffer({
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    // Force a composite so `lastTexture` is this frame's, not a stale one.
    compositor?.mark("promotion");
    engine.step(performance.now());
    const texture = lastTexture;
    if (texture === undefined) {
      buffer.destroy();
      throw new Error("rig: the compositor never acquired a target");
    }
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
    // Unpad rows, and normalise BGRA→RGBA so both witnesses speak one language.
    const out = new Uint8Array(width * height * 4);
    const bgra = format.startsWith("bgra");
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

  /**
   * THE SDF ORACLE. A rounded rect's area is mathematics, not a restatement of
   * the shader: w·h − (4−π)r². Summing the composited alpha gives the covered
   * area INCLUDING antialiased partial coverage, so the two can be compared
   * directly — and a shader that rounded the wrong corners, used the wrong
   * radius, or hard-cut instead of antialiasing would all miss it.
   *
   * Comparing against a CPU re-implementation of the same SDF would prove only
   * that it was transcribed twice.
   */
  async function roundedArea(radiusCss: number, opacity: number) {
    quadRadius = radiusCss;
    for (const c of cards) {
      // Opacity is an optional rider; `1` is the no-component default, so
      // setting it explicitly is equivalent and avoids a detach path.
      if (world.has(c.entity, Opacity)) world.edit(c.entity).set(Opacity, { a: opacity });
      else world.addComponent(c.entity, Opacity, { a: opacity });
    }
    compositor?.mark("promotion");
    await settle(2);
    const cap = await compositeAndRead();
    let alphaSum = 0;
    for (let i = 3; i < cap.data.length; i += 4) alphaSum += cap.data[i] as number;
    const dpr = window.devicePixelRatio || 1;
    const r = radiusCss * dpr;
    const w = CARD_W * dpr;
    const h = CARD_H * dpr;
    // (4 − π)r² is the area the four quarter-circle corners remove from the rect.
    const expectedPerCard = w * h - (4 - Math.PI) * r * r;
    quadRadius = 0;
    return {
      radiusCss,
      radiusDevice: r,
      opacity,
      cards: cards.length,
      coveredArea: alphaSum / 255,
      expectedArea: expectedPerCard * cards.length * opacity,
    };
  }

  const store2 = new Map<string, Capture>();

  return {
    ready,

    async run(variant, n = 12, text = true) {
      await ready;
      spawn(n);
      for (const c of cards) presentation.set(c.entity, variant === "composited" ? "composited" : "live-dom");
      await settle();
      // Fill each host's portal target once — the same nodes in both arms.
      for (const [i, c] of cards.entries()) {
        const content = domWidgets.hostFor(c.entity);
        if (content !== undefined && content.dataset.painted !== String(text)) {
          content.replaceChildren();
          paintCard(content, i, c.title, text);
          content.dataset.painted = String(text);
        }
      }
      await settle(4);

      const cap = await compositeAndRead().catch((e) => {
        console.error(`[rig] compositor readback failed: ${String(e)}`);
        return null;
      });
      if (cap !== null) store2.set(variant, cap);
      const s = cap === null ? null : stats(cap.data);
      return {
        variant,
        cards: cards.length,
        canvasHosts: domWidgets.canvasHostCount(),
        sources: sources.size(),
        writebackWrites: writeback.writes(),
        composites: compositor?.composites() ?? 0,
        copies: binder?.copies() ?? 0,
        pendingCopies: binder?.pending() ?? 0,
        refusedCopies: binder?.refusedCopies() ?? 0,
        compositorDistinct: s?.distinct ?? 0,
        compositorInk: s?.ink ?? 0,
        compositorTotal: s?.total ?? 0,
        width: gpuCanvas.width,
        height: gpuCanvas.height,
      };
    },

    async readCompositor() {
      return compositeAndRead();
    },

    roundedArea,

    async idle(ms) {
      await ready;
      const before = instrument?.total() ?? 0;
      const paintsBefore = paintEvents;
      let frames = 0;
      const t0 = performance.now();
      await new Promise<void>((resolve) => {
        const tick = () => {
          frames++;
          engine.step(performance.now());
          if (performance.now() - t0 >= ms) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      return {
        ms,
        frames,
        submits: (instrument?.total() ?? 0) - before,
        paintEvents: paintEvents - paintsBefore,
        composites: compositor?.composites() ?? 0,
        quiet: compositor?.quiet() ?? 0,
      };
    },

    atlas() {
      const w = binder?.atlas.waste();
      return {
        pages: w?.pages ?? 0,
        slots: w?.slots ?? 0,
        packingWastePct: w === undefined ? 0 : w.packingWastePct * 100,
        allocationWastePct: w === undefined ? 0 : w.allocationWastePct * 100,
        occupiedBytes: w?.occupiedBytes ?? 0,
        allocatedBytes: w?.allocatedBytes ?? 0,
      };
    },

    teardown() {
      compositor?.dispose();
      binder?.dispose();
      writeback.dispose();
      domWidgets.dispose();
      l1.dispose();
      planes.dispose();
      host.dispose();
      container.remove();
      store2.clear();
    },
  };
}

declare global {
  interface Window {
    __boardRig?: BoardRig;
    __boardDiff?: typeof diff;
    __boardStats?: typeof stats;
  }
}

window.__boardRig = mountBoardRig();
window.__boardDiff = diff;
window.__boardStats = stats;
