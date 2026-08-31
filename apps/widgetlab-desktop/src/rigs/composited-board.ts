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
  type SurfaceDemand,
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
  type DomWritebackHosts,
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
  /** Does the transform REPLACE layout inside layoutsubtree? (§5 law 1) */
  transformSemantics(): Promise<Record<string, unknown>>;
  /** Stale-hit-region policies (§5 law 2). */
  hitTest(policy: "visible-only" | "write-all" | "park"): Promise<Record<string, unknown>>;
  /** Click accuracy WHILE the camera moves (§5 law 3). */
  midGestureHits(samples: number): Promise<Record<string, number>>;
  /** A pure pan must upload zero bytes (§4.2 guard). */
  panUpload(frames: number): Promise<Record<string, number>>;
  /** Screen rect of card `index`, for real input from the main process. */
  targetRect(index: number): Record<string, unknown>;
  /** Put a real <input> inside a composited card; returns its screen rect. */
  addInput(index: number): Promise<Record<string, unknown>>;
  /** Focus/value of that input — read after the runner sends real events. */
  inputState(): Record<string, unknown>;
  /** Paint-event and upload counters (the §4.2 characterisation). */
  dirtCounters(): Record<string, number>;
  /** What changedElements NAMES for a pure content edit. */
  characterizeContentDirt(): Promise<Record<string, unknown>>;
  /** Add/remove a CSS-keyframe animation inside a card. */
  animateCard(index: number, on: boolean): void;
  /** Uploads vs paint events for an animating card at a demand bucket. */
  animationProbe(
    index: number,
    bucket: 0 | 2 | 5 | 10 | 15 | 30 | 60,
    ms: number,
  ): Promise<Record<string, number>>;
  /** Bulk arrival under a per-composite copy budget. */
  bootStagger(budget: number, maxFrames: number): Promise<Record<string, number>>;
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
    {
      onDirty: (hosts, event) => {
        paintEvents++;
        if (rawTaps.size > 0) {
          const raw = changedElements(event);
          for (const tap of rawTaps) tap(raw);
        }
        // THE §4.2 GUARD. `changedElements` names the drawable, so "we moved
        // it" and "its content changed" are indistinguishable in the event.
        // The write-back knows which it is: it flags each host it writes, and
        // this consumes ONE event per write. Anything left over is content.
        const content: Element[] = [];
        for (const host of hosts) {
          if (writeback.consumeTransformWrite(host)) selfNamed++;
          else content.push(host);
        }
        namedHosts += content.length;
        binder?.markDirtyHosts(content);
      },
    },
  );

  /** Extra listeners on the canvas's paint events, for characterisation. */
  const rawTaps = new Set<(elements: readonly Element[]) => void>();
  const rawPaintTap = (fn: (elements: readonly Element[]) => void) => {
    rawTaps.add(fn);
    return () => rawTaps.delete(fn);
  };

  let paintEvents = 0;
  /** Hosts named by paint events as CONTENT dirt (after the §4.2 filter). */
  let namedHosts = 0;
  /** Per-entity demand, set by the S4 probes. */
  const demands = new Map<Entity, SurfaceDemand>();
  /** Hosts named as themselves — the write-back's own paint events. */
  let selfNamed = 0;
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
  const hostsSeam: DomWritebackHosts = {
    hostElementFor: (e) => domWidgets.hostElementFor(e),
    compositedEntities: () => domWidgets.compositedEntities(),
    compositedRevision: () => domWidgets.compositedRevision(),
  };
  const writeback = createDomWritebackReflector(hostsSeam, world);

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
      demand: (e) => demands.get(e),
      // Paint events are a compositor dirty source (§4) — the wake that makes
      // dom dirt reach a composite at all.
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
      prepare: (frame) => {
        const b = binder as NonNullable<typeof binder>;
        b.sync(frame);
        // Stay awake while copies are owed — a budget without this strands
        // them the moment the board goes quiet.
        if (b.pending() > 0) compositor?.mark("dom");
      },
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


  // ── S3 probes: the bench's regression corpus, on the real implementation ──

  const viewSize = () => ({ w: container.clientWidth, h: container.clientHeight });

  /** Where a card lands on screen, in CSS px, at a given camera. */
  function screenRect(entity: Entity, cam: { x: number; y: number; zoom: number }) {
    const pos = world.get(entity, Position);
    const size = world.get(entity, Size);
    return {
      x: ((pos?.x ?? 0) - cam.x) * cam.zoom,
      y: ((pos?.y ?? 0) - cam.y) * cam.zoom,
      w: (size?.w ?? 0) * cam.zoom,
      h: (size?.h ?? 0) * cam.zoom,
    };
  }

  const setCamera = (c: { x: number; y: number; zoom: number }) =>
    world.setResource(Camera, { ...c, gesturing: false });

  /**
   * `layoutsubtree` SEMANTICS (hic-bench §3, probes/transform-compose.js).
   *
   * Inside the source canvas the transform REPLACES layout instead of
   * composing with it: with `transform:none` a host's rect is (0,0) no matter
   * what `left`/`top` say. Every placement in this codebase is an ABSOLUTE
   * screen position because of this, so it is worth a standing test rather
   * than a comment — if it ever composed instead, every write-back would be
   * doubly offset and the compositor would still look fine.
   */
  async function transformSemantics() {
    const entity = cards[1]?.entity as Entity;
    const el = domWidgets.hostElementFor(entity) as HTMLElement;
    const read = () => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const saved = el.style.transform;
    const savedLeft = el.style.left;
    const savedTop = el.style.top;

    el.style.left = "300px";
    el.style.top = "200px";
    el.style.transform = "";
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    const noTransform = read();

    el.style.transform = "matrix(1,0,0,1,120,60)";
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    const translated = read();

    el.style.transform = saved;
    el.style.left = savedLeft;
    el.style.top = savedTop;
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    return { left: 300, top: 200, noTransform, translated };
  }

  /**
   * STALE HIT REGIONS (hic-bench §3, probes/stale-hit-regions.js).
   *
   * Reproduces the bench's arm ordering exactly: every host is written at an
   * END camera, the camera then moves to START, and the policy under test is
   * applied. Off-screen hosts still holding END transforms land inside the
   * START viewport and intercept clicks meant for the cards actually there.
   */
  async function hitTest(policy: "visible-only" | "write-all" | "park") {
    const view = viewSize();
    // The board is 4 columns tall, so ROWS are the variable. START shows the
    // first seven rows — 28 cards, which is the bench's own probe count — and
    // END is far enough down that rows 10-17 are the visible ones there. At
    // START those hold END transforms that land squarely inside the viewport.
    // The row pitch is CARD_H + GAP; an END offset that is an exact multiple of
    // it makes each off-screen host land squarely on a visible card's CENTRE,
    // which is where the probe clicks. An arbitrary offset (1200) intrudes into
    // the viewport but lands BETWEEN centres and steals nothing — intrusion
    // alone is not the defect.
    const END = { x: 0, y: (CARD_H + GAP) * 10, zoom: 1 };
    const START = { x: 0, y: 0, zoom: 1 };

    // Seed: EVERY host placed at the END camera.
    setCamera(END);
    const seed = createDomWritebackReflector(hostsSeam, world, { park: false });
    seed.flush(world);
    seed.dispose();

    setCamera(START);
    if (policy === "visible-only") {
      // The DEFECT, applied by hand: this policy is not something the
      // reflector will do, so the rig has to stage it to prove it is wrong.
      for (const entity of domWidgets.compositedEntities()) {
        const r = screenRect(entity, START);
        if (r.x + r.w < 0 || r.y + r.h < 0 || r.x > view.w || r.y > view.h) continue;
        const el = domWidgets.hostElementFor(entity) as HTMLElement;
        el.style.width = `${r.w}px`;
        el.style.height = `${r.h}px`;
        el.style.transform = `matrix(1,0,0,1,${r.x},${r.y})`;
      }
    } else {
      const wb = createDomWritebackReflector(hostsSeam, world, { park: policy === "park" });
      wb.flush(world);
      wb.dispose();
    }
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));

    // Probe every card whose CENTRE is on screen at START.
    let checked = 0;
    let correct = 0;
    let stolenByOffscreen = 0;
    let hitNothing = 0;
    const examples: Array<Record<string, unknown>> = [];
    for (const entity of domWidgets.compositedEntities()) {
      const r = screenRect(entity, START);
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      if (!(cx > 0 && cy > 0 && cx < view.w && cy < view.h)) continue;
      checked++;
      const at = document.elementFromPoint(cx, cy);
      const owner = at?.closest?.("[data-ice-entity]") ?? null;
      const got = owner?.getAttribute("data-ice-entity") ?? null;
      if (got === String(entity)) {
        correct++;
        continue;
      }
      if (got === null) hitNothing++;
      else {
        // Was the thief a card that is NOT on screen at this camera?
        const thief = Number(got) as unknown as Entity;
        const tr = screenRect(thief, START);
        const onScreen = tr.x + tr.w > 0 && tr.y + tr.h > 0 && tr.x < view.w && tr.y < view.h;
        if (!onScreen) stolenByOffscreen++;
      }
      if (examples.length < 3) examples.push({ want: String(entity), got, at: { cx, cy } });
    }
    // GRADE THE STAGING, not just the outcome. If no off-screen host is
    // actually sitting inside the viewport, "visible-only passes" means the
    // rig failed to reproduce the defect — not that the defect is gone.
    let potentialThieves = 0;
    for (const entity of domWidgets.compositedEntities()) {
      const r = screenRect(entity, START);
      const onScreen = r.x + r.w > 0 && r.y + r.h > 0 && r.x < view.w && r.y < view.h;
      if (onScreen) continue;
      const el = domWidgets.hostElementFor(entity) as HTMLElement;
      const box = el.getBoundingClientRect();
      const intrudes =
        box.width > 0 && box.x + box.width > 0 && box.y + box.height > 0 && box.x < view.w && box.y < view.h;
      if (intrudes) potentialThieves++;
    }
    return {
      policy,
      checked,
      correct,
      wrong: checked - correct,
      stolenByOffscreen,
      hitNothing,
      potentialThieves,
      examples,
    };
  }

  /**
   * MID-GESTURE ACCURACY (hic-bench §3): deferring the write-back to the end of
   * a gesture costs every click for its duration (0/24, hit regions up to
   * 881 px off). This pans, and clicks WHILE panning.
   */
  async function midGestureHits(samples: number) {
    const view = viewSize();
    let landed = 0;
    let checked = 0;
    let maxOffset = 0;
    for (let i = 0; i < samples; i++) {
      setCamera({ x: i * 12, y: i * 6, zoom: 1 });
      engine.step(performance.now());
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
      const cam = { x: i * 12, y: i * 6, zoom: 1 };
      // Pick a card that is on screen at this instant.
      const target = domWidgets.compositedEntities().find((e) => {
        const r = screenRect(e, cam);
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        return cx > 40 && cy > 40 && cx < view.w - 40 && cy < view.h - 40;
      });
      if (target === undefined) continue;
      const r = screenRect(target, cam);
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      checked++;
      const el = domWidgets.hostElementFor(target) as HTMLElement;
      const box = el.getBoundingClientRect();
      maxOffset = Math.max(maxOffset, Math.abs(box.x - r.x), Math.abs(box.y - r.y));
      const at = document.elementFromPoint(cx, cy);
      const got = at?.closest?.("[data-ice-entity]")?.getAttribute("data-ice-entity") ?? null;
      if (got === String(target)) landed++;
    }
    return { checked, landed, maxOffset };
  }

  /**
   * THE §4.2 GUARD. A pure pan must upload ZERO bytes (hic-bench §3: camera
   * motion costs zero paints and zero uploads), even though writing transforms
   * back costs a fixed 2 paint events per frame. This measures both halves: the
   * paint events the write-back provokes, how many hosts they NAME, and the
   * copies that resulted.
   */
  async function panUpload(frames: number) {
    // DRAIN FIRST. Earlier probes leave slots owed a copy, and the pan's first
    // composite pays that debt — which reads as "the pan uploaded", when the
    // pan did nothing of the sort. (Measured: exactly one copy, on frame 0,
    // with zero refusals.) Same discipline as the bench draining its queue
    // before timing: an arm that starts dirty is charged for the previous one.
    for (let i = 0; i < 20 && (binder?.pending() ?? 0) > 0; i++) {
      compositor?.mark("dom");
      engine.step(performance.now());
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    }
    const pendingAtStart = binder?.pending() ?? 0;
    const copiesBefore = binder?.copies() ?? 0;
    const paintsBefore = paintEvents;
    const namedBefore = namedHosts;
    const selfBefore = selfNamed;
    const refusedBefore = binder?.refusedCopies() ?? 0;
    const submitsBefore = instrument?.total() ?? 0;
    // WHICH frame does a copy happen on, and was it preceded by a refusal?
    // "one copy in 600 frames" is a number; the frame it lands on is a cause.
    const copyFrames: number[] = [];
    let running = copiesBefore;
    for (let i = 0; i < frames; i++) {
      setCamera({ x: i * 2, y: i, zoom: 1 });
      engine.step(performance.now());
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
      const now = binder?.copies() ?? 0;
      if (now !== running) {
        if (copyFrames.length < 8) copyFrames.push(i);
        running = now;
      }
    }
    return {
      frames,
      copies: (binder?.copies() ?? 0) - copiesBefore,
      paintEvents: paintEvents - paintsBefore,
      contentNamed: namedHosts - namedBefore,
      selfNamed: selfNamed - selfBefore,
      refused: (binder?.refusedCopies() ?? 0) - refusedBefore,
      pendingAtStart,
      firstCopyFrame: copyFrames.length === 0 ? -1 : (copyFrames[0] as number),
      copyFrameCount: copyFrames.length,
      submits: (instrument?.total() ?? 0) - submitsBefore,
      writebacks: writeback.writes(),
      parked: writeback.parked(),
    };
  }

  /**
   * NATIVE INPUT through a composited card (design-012 §5 "Input routing", §1.1
   * interactive latency). The card's pixels are on the GPU; its DOM is an
   * unpainted canvas child. Focus, typing and the caret must still work, with
   * no router involved — that is the whole argument for L1 hosts.
   *
   * Input is driven ONLY through this app's own `webContents.sendInputEvent`
   * from the runner. No OS-level injection.
   */
  async function addInput(index: number) {
    // The camera may be anywhere after the pan probes, and a card that is
    // off-screen is PARKED at (-100000,-100000) — where no click can reach it.
    // Bring it back before aiming real input at it.
    setCamera({ x: 0, y: 0, zoom: 1 });
    await settle(3);
    const entity = cards[index]?.entity as Entity;
    const content = domWidgets.hostFor(entity) as HTMLElement;
    let input = content.querySelector("input");
    if (input === null) {
      input = document.createElement("input");
      input.id = "probe-input";
      input.value = "";
      input.style.cssText =
        "width:120px;height:20px;margin:4px 10px;font:12px system-ui;box-sizing:border-box;";
      content.appendChild(input);
    }
    // The mutation self-schedules a paint event, which re-copies the slot.
    await settle(4);
    const r = input.getBoundingClientRect();
    return { entity: String(entity), x: r.x, y: r.y, w: r.width, h: r.height };
  }

  function inputState() {
    const input = document.getElementById("probe-input") as HTMLInputElement | null;
    const active = document.activeElement;
    return {
      exists: input !== null,
      focused: input !== null && active === input,
      value: input?.value ?? null,
      activeTag: active?.tagName ?? null,
      // Proof the focused element really is inside the L1 canvas subtree.
      activeInsideCanvas: active !== null && l1.canvas.contains(active),
    };
  }

  /**
   * WHAT DOES `changedElements` NAME for a content edit?
   *
   * The §4.2 guard has to tell a placement write apart from a content change,
   * and the two candidate discriminators need different code. If the platform
   * reports the mutated DESCENDANT, the guard is structural (a host named as
   * itself is a placement write). If it reports the DRAWABLE — the immediate
   * canvas child — then no structural signal exists and the guard must be
   * temporal (filter what we just wrote).
   *
   * hic-bench §2 says changedElements "names the right card", which is
   * consistent with BOTH readings, so it is measured here instead.
   */
  async function characterizeContentDirt() {
    const entity = cards[2]?.entity as Entity;
    const content = domWidgets.hostFor(entity) as HTMLElement;
    const host = domWidgets.hostElementFor(entity) as HTMLElement;
    let label = content.querySelector<HTMLElement>("[data-probe-label]");
    if (label === null) {
      label = document.createElement("div");
      label.setAttribute("data-probe-label", "");
      label.style.cssText = "padding:0 10px;font:12px system-ui;color:#fff;";
      content.appendChild(label);
      await settle(3);
    }

    const seen: Array<{ raw: string; isHost: boolean; isDescendant: boolean }> = [];
    const off = rawPaintTap((elements) => {
      for (const el of elements) {
        seen.push({
          raw: el.tagName + (el.getAttribute("data-probe-label") === null ? "" : "[probe-label]"),
          isHost: el === host,
          isDescendant: el !== host && host.contains(el),
        });
      }
    });
    // A pure CONTENT edit: no transform, no size, deep inside the card.
    label.textContent = `edit-${Date.now()}`;
    await settle(4);
    off();
    return {
      entity: String(entity),
      named: seen.length,
      namedTheHost: seen.filter((x) => x.isHost).length,
      namedADescendant: seen.filter((x) => x.isDescendant).length,
      samples: seen.slice(0, 5),
    };
  }

  /**
   * DEMAND (design-012 §4, decision 7; hic-bench §5).
   *
   * A CSS-keyframe card self-invalidates at 239.9 paint events/s — 2 per
   * display tick at 120 Hz — with nothing calling `requestPaint`. Uploading its
   * slot at that rate is the whole reason demand governs dom sources and not
   * only live video.
   *
   * The probe animates ONE card and counts UPLOADS, not paint events, because
   * throttling cannot and does not stop the events: Chromium raises them
   * either way and the main-thread paint cost stays. What demand buys is the
   * GPU bandwidth.
   */
  function animateCard(index: number, on: boolean): void {
    const entity = cards[index]?.entity as Entity;
    const content = domWidgets.hostFor(entity) as HTMLElement;
    let bar = content.querySelector<HTMLElement>("[data-anim]");
    if (on && bar === null) {
      const style = document.getElementById("rig-keyframes") ?? document.createElement("style");
      style.id = "rig-keyframes";
      // A PAINT-DIRTYING property, deliberately. An animation on `transform`
      // or `opacity` runs on the compositor thread and never invalidates the
      // display list: measured, it raised ~120 paint events/s while naming
      // ZERO elements, so it cost no uploads at all and made a demand test
      // look like it was working when nothing was being throttled.
      // `background-color` cannot be compositor-animated, so it re-rasterises
      // the card — which is the hazard demand exists for.
      style.textContent =
        "@keyframes rigpulse{from{background-color:#ffffff}to{background-color:#ff3355}}";
      if (style.parentNode === null) document.head.appendChild(style);
      bar = document.createElement("div");
      bar.setAttribute("data-anim", "");
      bar.style.cssText =
        "width:30px;height:10px;background:#ffffff;animation:rigpulse 0.4s linear infinite alternate;";
      content.appendChild(bar);
    } else if (!on && bar !== null) {
      bar.remove();
    }
  }

  async function animationProbe(index: number, bucket: 0 | 2 | 5 | 10 | 15 | 30 | 60, ms: number) {
    const entity = cards[index]?.entity as Entity;
    if (bucket === 60) demands.delete(entity);
    else demands.set(entity, { mode: "live", fpsBucket: bucket, interactive: false });

    // Settle first so the arm is not charged for the previous one.
    for (let i = 0; i < 10 && (binder?.pending() ?? 0) > 0; i++) {
      engine.step(performance.now());
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    }
    const copiesBefore = binder?.copies() ?? 0;
    const paintsBefore = paintEvents;
    const namedBefore = namedHosts;
    const throttledBefore = binder?.throttled() ?? 0;
    const t0 = performance.now();
    let frames = 0;
    await new Promise<void>((resolve) => {
      const tick = () => {
        frames++;
        engine.step(performance.now());
        if (performance.now() - t0 >= ms) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const elapsed = performance.now() - t0;
    const copies = (binder?.copies() ?? 0) - copiesBefore;
    const paints = paintEvents - paintsBefore;
    return {
      bucket,
      ms: elapsed,
      frames,
      copies,
      paintEvents: paints,
      // The two rates the doctrine distinguishes: what Chromium raises, and
      // what the compositor chose to upload.
      paintEventsPerSecond: (paints / elapsed) * 1000,
      copiesPerSecond: (copies / elapsed) * 1000,
      // Did those paint events NAME anything? A compositor-animated property
      // raises events that name nothing, which is not the same as a throttle
      // working — this is how the two are told apart.
      namedHosts: namedHosts - namedBefore,
      throttled: (binder?.throttled() ?? 0) - throttledBefore,
    };
  }

  /**
   * BOOT STAGGERING (design-012 §8 gate 2). A full-board repaint is 111 ms at
   * N=200 — about 13 display frames — so bulk arrival must be BUDGETED rather
   * than merely fast. This measures that the budget is honoured AND that the
   * work still completes, which is the half a budget can quietly break: the
   * compositor has to stay awake while copies are owed.
   */
  async function bootStagger(budget: number, maxFrames: number) {
    const b = binder as NonNullable<typeof binder>;
    b.setCopyBudget(budget);
    // Force every slot to re-copy, the way a fresh boot would.
    for (const c of cards) b.atlas.markDirty(c.entity);
    const owedAtStart = b.pending();
    const copiesBefore = b.copies();
    const refusedBefore = b.refusedCopies();
    let frames = 0;
    let maxPerFrame = 0;
    let previous = copiesBefore;
    while (b.pending() > 0 && frames < maxFrames) {
      compositor?.mark("dom");
      engine.step(performance.now());
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
      frames++;
      const now = b.copies();
      maxPerFrame = Math.max(maxPerFrame, now - previous);
      previous = now;
    }
    b.setCopyBudget(Number.POSITIVE_INFINITY);
    return {
      budget,
      owedAtStart,
      frames,
      copied: b.copies() - copiesBefore,
      maxPerFrame,
      stillOwed: b.pending(),
      refused: b.refusedCopies() - refusedBefore,
    };
  }

  /** Where a card is on screen right now — the runner aims real input here. */
  function targetRect(index: number) {
    const cam = world.getResource(Camera) ?? { x: 0, y: 0, zoom: 1 };
    const entity = cards[index]?.entity as Entity;
    const r = screenRect(entity, cam);
    return { entity: String(entity), ...r };
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
    transformSemantics,
    hitTest,
    midGestureHits,
    panUpload,
    targetRect,
    addInput,
    inputState,
    characterizeContentDirt,
    animateCard,
    animationProbe,
    bootStagger,
    dirtCounters: () => ({
      paintEvents,
      selfNamed,
      contentNamed: namedHosts,
      copies: binder?.copies() ?? 0,
      refused: binder?.refusedCopies() ?? 0,
    }),

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
