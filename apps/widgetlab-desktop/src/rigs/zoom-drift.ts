/**
 * THE ZOOM-DRIFT RIG — open item (a) of the design-012 M18 fix wave.
 *
 * The question, restated from the ledger:
 *
 *   `dom-writeback.ts` sizes each L1 host's CSS box at `world × LIVE zoom`.
 *   `dom-source-binder.ts` sizes that host's atlas slot at `world × dpr × BAND`,
 *   and band hysteresis (`isOutOfBand`: re-band only when `zoom/band` leaves
 *   `[0.5, 2]`) lets the live zoom drift to just under 2× the band before the
 *   slot is resized. `copyElementImageToTexture` takes NO extent — arity 2,
 *   destination origin only — so it writes whatever the element rasterises to
 *   at the slot's origin. IF the element rasterises at its effective DEVICE
 *   size, a drifted card writes a raster up to 2× its slot in each axis,
 *   straight across the 2 px gutters into whatever is packed next door.
 *
 * The binder's header says the two "cannot disagree because they compute from
 * the same cells". They compute from the same cells and multiply them by
 * DIFFERENT numbers; that claim is what this rig is here to grade.
 *
 * ── Why this cannot be a unit test ────────────────────────────────────────
 * Every unit test in the tree fakes `copySlot`. The answer hinges on what
 * Chromium's HTML-in-Canvas implementation actually RASTERISES an element to,
 * and on how far the extent-less copy then writes into the destination
 * texture. Only a live Electron run with the `CanvasDrawElement` flag knows.
 *
 * ── The three arms ────────────────────────────────────────────────────────
 *
 *   A1 `rasterExtent`  — MEASURE the raster, do not infer it. Copy a host of a
 *                        known CSS size into a deliberately OVERSIZED texture
 *                        pre-cleared to a sentinel colour, read it back, and
 *                        take the bounding box of everything that is no longer
 *                        the sentinel. Swept over CSS sizes (the zoom axis) and
 *                        over the L1 bitmap scale, so "which scale governs the
 *                        raster" is measured rather than assumed to be dpr.
 *
 *   A2 `contamination` — the REAL seam. A real `createSourceCanvas`, the real
 *                        `createDomWritebackReflector` sizing the hosts, the
 *                        real `createDomSourceBinder` owning a real atlas page.
 *                        Two cards are packed side by side; the whole page is
 *                        then cleared to a sentinel; card A's live zoom is
 *                        driven to `drift × band` WITHOUT crossing the re-band
 *                        threshold; only A is marked dirty. Every non-sentinel
 *                        pixel outside A's own slot rect is therefore A's copy,
 *                        and nothing else.
 *
 *   A2 control         — the identical path with the live zoom left AT the
 *                        band. An A-vs-A leg before any A-vs-B claim: "144 px
 *                        of a neighbour overwritten" is a confident number
 *                        about nothing until the same path at zoom == band
 *                        scores zero.
 *
 * TWO WITNESSES for the pixel claim, and they share no code below this file:
 * A1's oversized-probe bounding box PREDICTS the overflow rect from the
 * element's own raster; A2's sentinel scan MEASURES what landed in the real
 * atlas page. A prediction and a measurement that agree are a finding; either
 * alone is a story.
 *
 * CONTENT-GUARDED THROUGHOUT. A blank readback contaminates nothing and would
 * grade as a clean pass, and on this host a dead GL bind keeps the DOM while
 * mounting nothing — so A's own slot is graded for real ink and real colour
 * variety BEFORE any contamination number is believed.
 *
 * Mounted from `zoom-drift.html`, driven by `scripts/zoom-drift.mjs`.
 */
import {
  Camera,
  Position,
  Size,
  Viewport,
  acquireCompositorDevice,
  createCompositorSourceRegistry,
  createWorld,
  type EngineGpu,
  type Entity,
} from "@ice/core";
import {
  changedElements,
  copyElementToTexture,
  createDomSourceBinder,
  createWorldQuadFacts,
  markAsSourceCanvas,
  onPaint,
} from "@ice/ground";
import {
  createDomWritebackReflector,
  createSourceCanvas,
  type DomWritebackHosts,
} from "@ice/dom";
import { fboPixelSize, isOutOfBand, selectBand } from "@ice/kernel";

/** World size of the drifting card and its neighbour. */
const CARD_W = 80;
const CARD_H = 48;

/**
 * The sentinel. Opaque magenta, and deliberately absent from both cards'
 * palettes: a pixel that is still exactly this was not written by the copy.
 * Opaque so that a written-but-TRANSPARENT pixel (0,0,0,0) still counts as
 * written — the copy composites onto transparency, and a transparent write is
 * every bit as much a write into a neighbour's slot as an opaque one.
 */
const SENTINEL = { r: 1, g: 0, b: 1, a: 1 } as const;
const SENTINEL_RGBA = [255, 0, 255, 255] as const;

/** Card A's palette — what contaminating pixels should look like. */
const A_BG = "#1b3a5c";
const A_INK = "#e8c547";
/** Card B's palette. Nothing of B's is written during the drift leg. */
const B_BG = "#1b5c2e";
const B_INK = "#47c5e8";

export interface RasterExtentRow {
  readonly label: string;
  readonly cssW: number;
  readonly cssH: number;
  readonly dpr: number;
  /** The L1 bitmap's device px per CSS px, the second candidate scale. */
  readonly bitmapScale: number;
  /** Written-pixel bounding box in the probe texture, or null when nothing landed. */
  readonly bbox: { x: number; y: number; w: number; h: number } | null;
  readonly written: number;
  readonly distinct: number;
  /** `bbox.w / cssW` — the scale the raster actually used. */
  readonly scaleX: number | null;
  readonly scaleY: number | null;
  readonly validationError: string | null;
}

export interface ContaminationRun {
  readonly drift: number;
  readonly band: number;
  readonly liveZoom: number;
  readonly reBanded: boolean;
  readonly dpr: number;
  readonly page: { width: number; height: number };
  readonly slotA: { x: number; y: number; w: number; h: number };
  readonly slotB: { x: number; y: number; w: number; h: number };
  /** Host A's CSS box after the write-back, and the device raster it predicts. */
  readonly hostACss: { w: number; h: number };
  /** CONTENT GUARD — A's own slot, after the copy. */
  readonly slotAInk: number;
  readonly slotADistinct: number;
  /** Non-sentinel pixels anywhere outside A's slot rect. THE FINDING. */
  readonly escaped: number;
  readonly escapedBbox: { x: number; y: number; w: number; h: number } | null;
  /** Of those, the ones inside B's slot rect — a neighbour's pixels, overwritten. */
  readonly intoNeighbour: number;
  /** Of those, the ones in the 2 px gutter ring immediately around A. */
  readonly intoGutter: number;
  /** Copies the atlas made and refused during the drifted flush. */
  readonly copies: number;
  readonly refused: number;
  readonly copyError: string | null;
  readonly validationError: string | null;
}

export interface ZoomDriftRig {
  readonly ready: Promise<void>;
  host(): Record<string, unknown>;
  /** A1 — what does Chromium rasterise an L1 host to? */
  rasterExtent(): Promise<RasterExtentRow[]>;
  /** A2 — one contamination run at `drift × band` live zoom. */
  contamination(drift: number): Promise<ContaminationRun>;
  /** The band arithmetic this host would use, reported so the rig cannot lie about it. */
  bandMath(drift: number): Record<string, number | boolean>;
  teardown(): void;
}

/** Read an rgba8unorm texture back, unpadding rows. */
async function readTexture(
  device: GPUDevice,
  texture: GPUTexture,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
  const buffer = device.createBuffer({
    size: bytesPerRow * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder({ label: "zoom-drift-readback" });
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
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const src = y * bytesPerRow;
    out.set(padded.subarray(src, src + width * 4), y * width * 4);
  }
  return out;
}

/**
 * Clear a texture to the sentinel through a RENDER PASS rather than
 * `writeTexture`. A render-pass clear covers the whole page whatever its width
 * is; `writeTexture` would owe a 256-byte row alignment the allocator never
 * promised to give us.
 */
function clearToSentinel(device: GPUDevice, texture: GPUTexture): void {
  const encoder = device.createCommandEncoder({ label: "zoom-drift-seed" });
  encoder
    .beginRenderPass({
      colorAttachments: [
        {
          view: texture.createView(),
          loadOp: "clear",
          clearValue: SENTINEL,
          storeOp: "store",
        },
      ],
    })
    .end();
  device.queue.submit([encoder.finish()]);
}

const isSentinel = (px: Uint8Array, i: number): boolean =>
  px[i] === SENTINEL_RGBA[0] &&
  px[i + 1] === SENTINEL_RGBA[1] &&
  px[i + 2] === SENTINEL_RGBA[2] &&
  px[i + 3] === SENTINEL_RGBA[3];

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const inside = (r: Rect, x: number, y: number): boolean =>
  x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

/** Written-pixel bounding box + count, against the sentinel. */
function writtenBounds(
  px: Uint8Array,
  width: number,
  height: number,
): { bbox: Rect | null; written: number; distinct: number } {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let written = 0;
  const colours = new Set<number>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (isSentinel(px, i)) continue;
      written++;
      colours.add(
        ((px[i] as number) << 24) |
          ((px[i + 1] as number) << 16) |
          ((px[i + 2] as number) << 8) |
          (px[i + 3] as number),
      );
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return {
    bbox: maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
    written,
    distinct: colours.size,
  };
}

/** Two animation frames — layout, style and the host's paint record all settle. */
const settle = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/** A card's visible content. Opaque to its own edges, so its raster bbox IS its box. */
function fillCard(el: HTMLElement, bg: string, ink: string, title: string): void {
  el.style.background = bg;
  el.style.boxSizing = "border-box";
  el.style.border = `2px solid ${ink}`;
  el.style.overflow = "hidden";
  el.innerHTML = "";
  const bar = document.createElement("div");
  bar.style.cssText = `height:30%;background:${ink};`;
  const label = document.createElement("div");
  label.style.cssText = `font:700 11px/1.2 system-ui,sans-serif;color:${ink};padding:4px;`;
  label.textContent = title;
  el.append(bar, label);
}

export function mountZoomDriftRig(): ZoomDriftRig {
  const container = document.createElement("div");
  container.style.cssText =
    "position:absolute;inset:0;background:#101010;overflow:hidden;";
  document.body.appendChild(container);

  const world = createWorld();
  const registry = createCompositorSourceRegistry();

  // L1 — the real source canvas. Its BITMAP is what element paint records are
  // recorded against (source-canvas.ts header), so it is sized to the container
  // at device resolution exactly as the product does.
  const l1 = createSourceCanvas(
    container,
    { markAsSourceCanvas, onPaint, changedElements },
    {},
  );

  let paintEvents = 0;
  const offPaint = onPaint(l1.canvas, () => {
    paintEvents++;
  });

  /** The two hosts, immediate children of L1 — the only depth the copy accepts. */
  const makeHost = (bg: string, ink: string, title: string): HTMLElement => {
    const el = document.createElement("div");
    el.style.position = "absolute";
    el.style.left = "0";
    el.style.top = "0";
    fillCard(el, bg, ink, title);
    l1.canvas.appendChild(el);
    return el;
  };

  const hostA = makeHost(A_BG, A_INK, "A");
  const hostB = makeHost(B_BG, B_INK, "B");

  const entityA = world.spawn({
    components: [
      [Position, { x: 20, y: 20 }],
      [Size, { w: CARD_W, h: CARD_H }],
    ],
  });
  const entityB = world.spawn({
    components: [
      [Position, { x: 20 + CARD_W + 20, y: 20 }],
      [Size, { w: CARD_W, h: CARD_H }],
    ],
  });
  const hostFor = new Map<Entity, HTMLElement>([
    [entityA, hostA],
    [entityB, hostB],
  ]);

  const hostsSeam: DomWritebackHosts = {
    hostElementFor: (e) => hostFor.get(e),
    compositedEntities: () => hostFor.keys(),
    // Membership never changes here; a constant revision is honest, not a stub.
    compositedRevision: () => 1,
  };
  const writeback = createDomWritebackReflector(hostsSeam, world);

  let gpu: EngineGpu | undefined;
  let dpr = 1;

  const setZoom = (zoom: number): void => {
    world.setResource(Camera, { x: 0, y: 0, zoom, gesturing: false });
  };

  const ready = (async () => {
    dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth;
    const h = container.clientHeight;
    l1.resize(w, h, dpr);
    world.setResource(Viewport, { w, h, dpr });
    // Parking is off the question here — a parked host is written off-viewport
    // and would leave the drift measurement about a card nobody is looking at.
    setZoom(1);
    gpu = await acquireCompositorDevice();
    await settle();
  })();

  /**
   * A1 — the raster extent, measured against a probe texture that is far larger
   * than anything the element can rasterise to. `origin` is (0,0), so a written
   * bounding box anchored at (0,0) whose size exceeds the CSS box by some factor
   * IS the scale the platform used.
   */
  async function rasterExtent(): Promise<RasterExtentRow[]> {
    const device = (gpu as EngineGpu).device;
    const PROBE = 1024;
    const rows: RasterExtentRow[] = [];

    const probe = device.createTexture({
      label: "zoom-drift-probe",
      size: { width: PROBE, height: PROBE },
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });

    // B is parked far off so it can never share the probe with A.
    hostB.style.transform = "matrix(1,0,0,1,-100000,-100000)";

    const measure = async (
      label: string,
      cssW: number,
      cssH: number,
      bitmapScale: number,
    ): Promise<void> => {
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      // Resizing the bitmap CLEARS the canvas and drops every paint record with
      // it, so the settle below is load-bearing, not politeness.
      l1.resize(cw, ch, bitmapScale);
      hostA.style.width = `${cssW}px`;
      hostA.style.height = `${cssH}px`;
      hostA.style.transform = "matrix(1,0,0,1,24,24)";
      await settle();
      await settle();

      clearToSentinel(device, probe);
      device.pushErrorScope("validation");
      let threw: string | null = null;
      try {
        copyElementToTexture(device.queue, hostA, probe, { x: 0, y: 0 });
      } catch (error) {
        threw = String(error);
      }
      const scoped = await device.popErrorScope();
      await device.queue.onSubmittedWorkDone();
      const px = await readTexture(device, probe, PROBE, PROBE);
      const { bbox, written, distinct } = writtenBounds(px, PROBE, PROBE);
      rows.push({
        label,
        cssW,
        cssH,
        dpr,
        bitmapScale,
        bbox,
        written,
        distinct,
        scaleX: bbox === null ? null : bbox.w / cssW,
        scaleY: bbox === null ? null : bbox.h / cssH,
        validationError: threw ?? (scoped === null ? null : scoped.message),
      });
    };

    // The zoom axis: one world card at a sequence of live zooms, expressed as
    // the CSS box the write-back would give it.
    for (const zoom of [1, 1.5, 1.9, 2.5]) {
      await measure(
        `zoom ${zoom} @ bitmap dpr`,
        Math.round(CARD_W * zoom * 1000) / 1000,
        Math.round(CARD_H * zoom * 1000) / 1000,
        dpr,
      );
    }
    // The scale axis: the SAME CSS box against a bitmap at half device
    // resolution. If the raster follows the bitmap rather than dpr, this row
    // reads a different scale — and the mechanism is not the one the ledger
    // guessed at.
    await measure("zoom 1 @ bitmap 1x", CARD_W, CARD_H, 1);
    await measure("zoom 1.9 @ bitmap 1x", CARD_W * 1.9, CARD_H * 1.9, 1);

    // Restore the product configuration for A2.
    l1.resize(container.clientWidth, container.clientHeight, dpr);
    await settle();
    probe.destroy();
    return rows;
  }

  /** What the kernel's band ladder does with a drift multiplier, reported not assumed. */
  function bandMath(drift: number): Record<string, number | boolean> {
    const band = selectBand(1);
    const liveZoom = band * drift;
    return {
      band,
      liveZoom,
      reBanded: isOutOfBand(liveZoom, band),
      slotW: fboPixelSize(CARD_W, CARD_H, dpr, band).width,
      slotH: fboPixelSize(CARD_W, CARD_H, dpr, band).height,
      predictedRasterW: CARD_W * liveZoom * dpr,
      predictedRasterH: CARD_H * liveZoom * dpr,
    };
  }

  /**
   * A2 — the real seam. One binder, one atlas page, two packed slots, and a
   * live zoom driven to `drift × band`.
   *
   * `drift === 1` is the CONTROL: identical code path, identical copy, zoom
   * sitting exactly at the band.
   */
  async function contamination(drift: number): Promise<ContaminationRun> {
    const device = (gpu as EngineGpu).device;

    // A fresh binder per run so no earlier leg's slots, bands or change guards
    // can carry into this one.
    let clock = 0;
    /**
     * The clock seam, advanced hard on every read so the demand throttle can
     * never defer a mark — this rig measures geometry, not cadence.
     */
    const tick = (): number => {
      clock += 1000;
      return clock;
    };
    const facts = createWorldQuadFacts(world);
    const binder = createDomSourceBinder(device, registry, (e) => facts(e), {
      // One pinned page: both cards seat on one shelf, so B is literally the
      // neighbour A would run into, and the page geometry is not a growth
      // ladder's accident.
      firstPageSize: { width: 512, height: 512 },
      maxPageSize: 512,
      now: tick,
    });
    const unregA = registry.register(entityA, { kind: "dom", host: hostA });
    const unregB = registry.register(entityB, { kind: "dom", host: hostB });

    try {
      const band = selectBand(1);
      const liveZoom = band * drift;

      // ── 1. At the band. Place both slots and land both copies. ────────────
      setZoom(band);
      writeback.flush(world);
      await settle();
      await settle();
      const frameAt = (zoom: number) => ({
        width: container.clientWidth * dpr,
        height: container.clientHeight * dpr,
        dpr,
        camera: { x: 0, y: 0, zoom },
      });
      binder.sync(frameAt(band));
      await device.queue.onSubmittedWorkDone();
      // One more sync: a host promoted this same turn has no paint record yet,
      // and the binder's refusal path deliberately retries on the next frame.
      await settle();
      binder.markDirtyHosts([hostA, hostB]);
      binder.sync(frameAt(band));
      await device.queue.onSubmittedWorkDone();

      const placeA = binder.atlas.placementOf(entityA);
      const placeB = binder.atlas.placementOf(entityB);
      if (placeA === undefined || placeB === undefined) {
        throw new Error(
          `rig: no atlas placement (A=${placeA === undefined ? "none" : "ok"} ` +
            `B=${placeB === undefined ? "none" : "ok"}) — the copy never landed`,
        );
      }
      const page = placeA.texture;
      // The allocator speaks `{width,height}`; every count below is in the
      // rig's own `{w,h}` pixel-rect vocabulary. Converted once, here.
      const toRect = (r: { x: number; y: number; width: number; height: number }): Rect => ({
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
      });
      const slotA = toRect(placeA.rect);
      const slotB = toRect(placeB.rect);

      // ── 2. Seed the WHOLE page. Every non-sentinel pixel from here on is
      //       attributable to the ONE copy below, and to nothing else. ───────
      clearToSentinel(device, page);
      await device.queue.onSubmittedWorkDone();

      // ── 3. Drift the live zoom. The write-back resizes A's host to
      //       `world × liveZoom`; the binder holds the band. ─────────────────
      setZoom(liveZoom);
      writeback.flush(world);
      await settle();
      await settle();
      const hostACss = {
        w: Number.parseFloat(hostA.style.width),
        h: Number.parseFloat(hostA.style.height),
      };

      // ── 4. ONE copy, A only, into the slot the band still owns. ───────────
      device.pushErrorScope("validation");
      binder.markDirtyHosts([hostA]);
      binder.sync(frameAt(liveZoom));
      const scoped = await device.popErrorScope();
      await device.queue.onSubmittedWorkDone();

      // ── 5. Read the page and attribute every written pixel. ───────────────
      const px = await readTexture(device, page, page.width, page.height);
      let slotAInk = 0;
      const slotAColours = new Set<number>();
      let escaped = 0;
      let intoNeighbour = 0;
      let intoGutter = 0;
      let minX = page.width;
      let minY = page.height;
      let maxX = -1;
      let maxY = -1;
      // The 2 px gutter ring around A — dead space no quad samples, and the
      // first thing an oversized raster crosses.
      const gutterRing: Rect = {
        x: slotA.x - 2,
        y: slotA.y - 2,
        w: slotA.w + 4,
        h: slotA.h + 4,
      };
      for (let y = 0; y < page.height; y++) {
        for (let x = 0; x < page.width; x++) {
          const i = (y * page.width + x) * 4;
          const written = !isSentinel(px, i);
          if (inside(slotA, x, y)) {
            if (written) {
              slotAInk++;
              slotAColours.add(
                ((px[i] as number) << 24) |
                  ((px[i + 1] as number) << 16) |
                  ((px[i + 2] as number) << 8) |
                  (px[i + 3] as number),
              );
            }
            continue;
          }
          if (!written) continue;
          escaped++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          if (inside(slotB, x, y)) intoNeighbour++;
          else if (inside(gutterRing, x, y)) intoGutter++;
        }
      }

      const error = binder.atlas.lastCopyError();
      return {
        drift,
        band,
        liveZoom,
        reBanded: binder.bandOf(entityA) !== band,
        dpr,
        page: { width: page.width, height: page.height },
        slotA,
        slotB,
        hostACss,
        slotAInk,
        slotADistinct: slotAColours.size,
        escaped,
        escapedBbox:
          maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
        intoNeighbour,
        intoGutter,
        copies: binder.copies(),
        refused: binder.refusedCopies(),
        copyError: error === null || error === undefined ? null : String(error),
        validationError: scoped === null ? null : scoped.message,
      };
    } finally {
      unregA();
      unregB();
      binder.dispose();
    }
  }

  return {
    ready,
    host: () => ({
      dpr,
      ua: navigator.userAgent,
      chrome: (navigator.userAgent.match(/Chrome\/([\d.]+)/) ?? [])[1] ?? null,
      electron: (navigator.userAgent.match(/Electron\/([\d.]+)/) ?? [])[1] ?? null,
      l1Bitmap: { width: l1.canvas.width, height: l1.canvas.height },
      // The layoutsubtree discriminator: a sized child of a PLAIN canvas is
      // fallback content and measures 0×0.
      hostLaidOut: hostA.getBoundingClientRect().width > 0,
      paintEvents,
      device: gpu !== undefined,
      maxTextureDimension2D: gpu?.device.limits.maxTextureDimension2D ?? null,
    }),
    rasterExtent,
    contamination,
    bandMath,
    teardown() {
      offPaint();
      writeback.dispose();
      l1.dispose();
      container.remove();
    },
  };
}

declare global {
  interface Window {
    __zoomDrift?: ZoomDriftRig;
  }
}

window.__zoomDrift = mountZoomDriftRig();
