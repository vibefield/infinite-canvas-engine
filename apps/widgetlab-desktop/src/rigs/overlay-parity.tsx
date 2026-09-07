/**
 * The C1 exit witness (design-013 §8, "pixel parity of a wires/guides scene, old
 * renderer vs new"): ONE world, ONE camera, TWO grounds.
 *
 *   A — the OLD leg: `ground({ grid: { dotAlpha: 0 }, wires, guides })` on three's
 *       WebGPURenderer with MSAA, its wires and guides the `soup-mesh` over a
 *       `MeshBasicNodeMaterial`. The grid is turned OFF rather than tuned out of
 *       the way: `dotAlpha: 0` makes `collectMagnetLevels` emit zero instances at
 *       every rung (`magnet-collect.ts:94`), so the pass draws nothing at all and
 *       no grid pixel can enter the diff.
 *   B — the NEW leg: `Ground` with the two soup OVERLAYS and nothing else — no
 *       cards (`frames: []`), no sources, and the field at `inkAlpha: 0`.
 *
 * Both sides collect from the same world, so what is being compared is the
 * RASTERISER, not the geometry: the collectors themselves are pinned
 * byte-for-byte by `packages/ground/test/overlay-collectors.test.ts`.
 *
 * The comparison is CLASSIFIED, because the two rasterisers do not antialias the
 * same way (three asks for MSAA; the engine's swap chain has none). Every device
 * pixel is rastered on the CPU from the same triangles and labelled:
 *   interior — its 3×3 neighbourhood is one flat colour, so no edge filter of any
 *              kind can reach it. This is the exit number.
 *   edge     — a triangle boundary passes through the neighbourhood. Reported with
 *              its own maxΔ; never used to hide an offset, because an offset would
 *              move interior pixels too.
 * Both are stated against an A-vs-A control taken in the same run: the same canvas
 * drawn twice and read back twice, which is the floor the two-sided number has to
 * be read against.
 *
 * This rig is a ONE-TIME witness: the old leg dies at C2 (design-013's Phase C
 * plan, D-C2.5) and this page and its script go with it.
 *
 * Mounted from `overlay-parity.html`, driven by `scripts/overlay-parity.mjs`.
 */
import {
  Camera,
  Culled,
  Drag,
  DEFAULT_SNAP_GUIDES_CONFIG,
  DEFAULT_WIRES_CONFIG,
  GuideLine,
  Port,
  PortAnchor,
  Position,
  PrefabId,
  RoutedConnect,
  Selected,
  Size,
  SpacingBar,
  Viewport,
  Wire,
  WireFrom,
  WirePorts,
  WireTo,
  acquireCompositorDevice,
  createWorld,
  defineWidget,
  type Entity,
  type SnapGuidesConfig,
  type WirePreviewBuffer,
  type WiresConfig,
  type World,
} from "@ice/core";
import { ground, type GroundLayer } from "@ice/ground";
import { createOverlays, DEFAULT_FIELD_CONFIG, Ground, GROUND_SHADERS, type OverlayFrame, type TriSoup } from "@ice/ground/compose";
import { linearToSrgb } from "@ice/ground/packs";
import { THEMES } from "@ice/ground/oracle/fixtures/vf-theme";

type RGB = [number, number, number];

/** The viewport both grounds are sized to, CSS px. */
const VIEW = { w: 1280, h: 808 } as const;
/** The camera both sides collect under: the origin at 1:1, so world px ARE screen px. */
const CAM = { x: 0, y: 0, zoom: 1, gesturing: false } as const;

/**
 * The product's configs, WIDENED — the same object handed to both sides, so nothing
 * about the comparison is asymmetric. The widths are the one deliberate departure from
 * the defaults: a 1.5 px wire at dpr 2 is three device px across, every one of them
 * inside an antialiasing band, so a scene at the shipped widths has almost no INTERIOR
 * to compare. The geometry is the same code at any width; the area is what makes the
 * pixel claim mean something.
 */
const WIRES: WiresConfig = { ...DEFAULT_WIRES_CONFIG, wireWidth: 9, selectedWidth: 15, portRadius: 13 };
const GUIDES: SnapGuidesConfig = { ...DEFAULT_SNAP_GUIDES_CONFIG, lineWidth: 7, tickPx: 14 };

const NODE = defineWidget({
  type: "op:node", surface: "dom", component: null, defaultSize: { w: 120, h: 72 },
  ports: [{ id: "out", side: "e" }, { id: "in", side: "w" }],
});

/**
 * The scene, covering every branch of both collectors: three committed wires
 * (one of them SELECTED — the wider stroke and the other colour), materialized
 * PORT DOTS under a routed connect (so they take `portActiveColor`), a wire
 * whose endpoint is out of scope (`Culled ∧ ¬Active` — it must draw on neither
 * side), full-span guides on both axes, a bounded span, and a spacing bar on
 * each axis with its end ticks. The connect PREVIEW is a phase of its own.
 */
function buildScene(world: World): { readonly nodes: Entity[]; readonly connect: Entity } {
  const spawn = (x: number, y: number): Entity =>
    world.spawn({ components: [[PrefabId, { id: NODE.type }], [Position, { x, y }], [Size, { w: 120, h: 72 }]] });
  const nodes = [spawn(120, 120), spawn(520, 200), spawn(300, 420), spawn(860, 380), spawn(660, 620)];
  const wire = (a: Entity, b: Entity, selected: boolean): void => {
    const e = world.spawn({ components: [[WirePorts, { from: "out", to: "in" }]], tags: [Wire] });
    world.setRelation(e, WireFrom, a);
    world.setRelation(e, WireTo, b);
    if (selected) world.addTag(e, Selected);
  };
  wire(nodes[0] as Entity, nodes[1] as Entity, false);
  wire(nodes[1] as Entity, nodes[3] as Entity, true);
  wire(nodes[2] as Entity, nodes[4] as Entity, false);
  // out of scope: the endpoint carries the non-member stamp, so this wire draws on neither side
  const away = spawn(1000, 700);
  world.addTag(away, Culled);
  wire(nodes[4] as Entity, away, false);
  // materialized port dots, and the routed connect that turns them to their active colour
  for (const [x, y] of [[240, 156], [520, 236], [420, 456], [860, 416], [660, 656]] as const) {
    world.spawn({ components: [[PortAnchor, { x, y }]], tags: [Port] });
  }
  // The routed connect: the tag turns the port dots to their active colour, and the `Drag`
  // on it is the DIRT the preview rides — the old pass observes `[RoutedConnect, Drag]`
  // and the new driver journals `Drag`, so writing it is how a preview change wakes both.
  const connect = world.spawn({ components: [[Drag, { startX: 0, startY: 0, totalX: 0, totalY: 0, velX: 0, velY: 0, zoomAtClaim: 1 }]], tags: [RoutedConnect] });
  // the guides: two full spans, a bounded one, and a bar on each axis
  world.spawn({ components: [[GuideLine, { axis: "x", at: 400, from: 0, to: 0 }]] });
  world.spawn({ components: [[GuideLine, { axis: "y", at: 300, from: 0, to: 0 }]] });
  world.spawn({ components: [[GuideLine, { axis: "x", at: 900, from: 120, to: 560 }]] });
  world.spawn({ components: [[SpacingBar, { axis: "x", from: 160, to: 460, perp: 720, gap: 300 }]] });
  world.spawn({ components: [[SpacingBar, { axis: "y", from: 120, to: 520, perp: 1120, gap: 400 }]] });
  return { nodes, connect };
}

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const frames = async (n: number) => { for (let i = 0; i < n; i++) await frame(); };
const bytes = (c: readonly [number, number, number]): RGB => [Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255)];

/**
 * Pixels off a live WebGPU canvas, composited over `bg`. `drawImage` from such a
 * canvas is silently blank; `toDataURL` → decode → draw is the route that works.
 * Side A's canvas is TRANSPARENT (three clears to alpha 0 so the page shows
 * through), so the fill is what puts the two sides on the same ground.
 */
async function readbackOver(canvas: HTMLCanvasElement, bg: RGB): Promise<ImageData> {
  const url = canvas.toDataURL("image/png");
  const img = new Image();
  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("readback decode")); img.src = url; });
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext("2d", { willReadFrequently: true });
  if (g === null) throw new Error("readback 2d");
  g.fillStyle = `rgb(${bg[0]},${bg[1]},${bg[2]})`;
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0);
  return g.getImageData(0, 0, c.width, c.height);
}

interface Tri { readonly x: Float64Array; readonly y: Float64Array; readonly c: [number, number, number, number] }
/** A soup's triangles in draw order, in CSS px. */
function trianglesOf(soup: TriSoup | undefined): Tri[] {
  if (soup === undefined) return [];
  const out: Tri[] = [];
  for (let t = 0; t < soup.vertexCount / 3; t++) {
    const x = new Float64Array(3);
    const y = new Float64Array(3);
    for (let k = 0; k < 3; k++) { x[k] = soup.positions[(t * 3 + k) * 3] as number; y[k] = soup.positions[(t * 3 + k) * 3 + 1] as number; }
    const c: [number, number, number, number] = [0, 1, 2, 3].map((k) => soup.colors[t * 3 * 4 + k] as number) as [number, number, number, number];
    out.push({ x, y, c });
  }
  return out;
}

/**
 * The CPU raster, TWICE. Composite every triangle whose device-pixel CENTRE is
 * inside it, in draw order, over the background — once with the colour as the
 * config names it (`plain`, what the new pass writes) and once with that colour
 * put through three's OUTPUT ENCODE (`srgb`).
 *
 * The second chain is the C1 finding, not a fudge. three treats a material's
 * colour as WORKING SPACE (linear): it composites the overlays in linear light on a
 * transparent canvas and converts to `outputColorSpace` on the way out, and the
 * browser then puts that canvas over the page. So the old leg has always drawn
 * `linearToSrgb` of a LINEAR composite of colours the config wrote in sRGB — lighter
 * than asked for wherever a layer is opaque, and differently coloured wherever two
 * translucent layers overlap. The engine's pass composites in the config's own byte
 * space and writes exactly what it names. Predicting BOTH sides from the same
 * triangles is what separates "the two rasterisers put the geometry in different
 * places" (they do not) from "the two colour chains disagree" (they do, by exactly
 * this — measured, not assumed).
 *
 * Then each pixel is labelled INTERIOR when its 3×3 neighbourhood carries one
 * identical composite, EDGE otherwise: no antialiasing filter, MSAA or otherwise,
 * can change a pixel whose whole neighbourhood is flat, so an interior difference
 * is a real difference.
 */
interface Raster {
  /** The 3×3 neighbourhood carries one composite: no edge FILTER can reach this pixel. */
  readonly interior: Uint8Array;
  /**
   * …and it is further than a CSS px from every triangle EDGE, the SEAMS between two
   * stroke quads included. Flatness alone is not enough for the old side: where two
   * segment quads of a polyline meet at an angle they leave a sub-pixel wedge along the
   * seam, and MSAA samples it while a centre-rule raster cannot see it — so a pixel whose
   * nine centres are all inside can still come back at half coverage on the old renderer.
   * That is a real difference between the two pictures (the old leg's joins carry faint
   * dark seams; the new one's do not) and it is reported as its own band rather than
   * folded into either claim.
   */
  readonly deep: Uint8Array;
  readonly ink: Uint8Array;
  readonly plain: Int32Array;
  readonly srgb: Int32Array;
  readonly painted: number;
}
function classify(tris: readonly Tri[], w: number, h: number, dpr: number, bg: RGB): Raster {
  const plain = new Int32Array(w * h);
  const srgb = new Int32Array(w * h);
  const base = (bg[0] << 16) | (bg[1] << 8) | bg[2];
  plain.fill(base);
  srgb.fill(base);
  // the old chain's accumulator: PREMULTIPLIED linear colour and coverage, over a transparent canvas
  const lin = new Float32Array(w * h * 3);
  const cov = new Float32Array(w * h);
  const ink = new Uint8Array(w * h);
  const nearEdge = new Float32Array(w * h).fill(Number.POSITIVE_INFINITY);
  let painted = 0;
  const blend = (key: Int32Array, i: number, c: readonly number[], a: number): void => {
    const k = key[i] as number;
    const out = [16, 8, 0].map((sh, j) => Math.round(Math.min(255, Math.max(0, (c[j] as number) * 255 * a + ((k >> sh) & 255) * (1 - a)))));
    key[i] = ((out[0] as number) << 16) | ((out[1] as number) << 8) | (out[2] as number);
  };
  for (const t of tris) {
    if (t.c[3] < 0.002) continue;
    const a = t.c[3];
    const raw = [t.c[0], t.c[1], t.c[2]];
    const x0 = Math.max(0, Math.floor(Math.min(t.x[0] as number, t.x[1] as number, t.x[2] as number) * dpr) - 1);
    const x1 = Math.min(w - 1, Math.ceil(Math.max(t.x[0] as number, t.x[1] as number, t.x[2] as number) * dpr) + 1);
    const y0 = Math.max(0, Math.floor(Math.min(t.y[0] as number, t.y[1] as number, t.y[2] as number) * dpr) - 1);
    const y1 = Math.min(h - 1, Math.ceil(Math.max(t.y[0] as number, t.y[1] as number, t.y[2] as number) * dpr) + 1);
    const L0 = Math.hypot((t.x[1] as number) - (t.x[0] as number), (t.y[1] as number) - (t.y[0] as number));
    const L1 = Math.hypot((t.x[2] as number) - (t.x[1] as number), (t.y[2] as number) - (t.y[1] as number));
    const L2 = Math.hypot((t.x[0] as number) - (t.x[2] as number), (t.y[0] as number) - (t.y[2] as number));
    for (let Y = y0; Y <= y1; Y++) for (let X = x0; X <= x1; X++) {
      const px = (X + 0.5) / dpr;
      const py = (Y + 0.5) / dpr;
      const e0 = ((t.x[1] as number) - (t.x[0] as number)) * (py - (t.y[0] as number)) - ((t.y[1] as number) - (t.y[0] as number)) * (px - (t.x[0] as number));
      const e1 = ((t.x[2] as number) - (t.x[1] as number)) * (py - (t.y[1] as number)) - ((t.y[2] as number) - (t.y[1] as number)) * (px - (t.x[1] as number));
      const e2 = ((t.x[0] as number) - (t.x[2] as number)) * (py - (t.y[2] as number)) - ((t.y[0] as number) - (t.y[2] as number)) * (px - (t.x[2] as number));
      const i = Y * w + X;
      // the distance to this triangle's nearest edge, whether the pixel is inside it or not:
      // a seam is an edge shared by two quads, and a pixel just inside one is just inside the other
      const near = Math.min(Math.abs(e0) / Math.max(L0, 1e-9), Math.abs(e1) / Math.max(L1, 1e-9), Math.abs(e2) / Math.max(L2, 1e-9));
      if (near < (nearEdge[i] as number)) nearEdge[i] = near;
      if (!((e0 >= 0 && e1 >= 0 && e2 >= 0) || (e0 <= 0 && e1 <= 0 && e2 <= 0))) continue;
      blend(plain, i, raw, a);
      // …and the same triangle into the linear premultiplied accumulator
      const A = cov[i] as number;
      for (let j = 0; j < 3; j++) lin[i * 3 + j] = (lin[i * 3 + j] as number) * (1 - a) + (raw[j] as number) * a;
      cov[i] = A * (1 - a) + a;
      if (ink[i] === 0) { ink[i] = 1; painted++; }
    }
  }
  // Resolve the old chain: unpremultiply, encode to sRGB, then let the browser put the
  // canvas over the page background — which is where the two chains meet again.
  for (let i = 0; i < w * h; i++) {
    if (ink[i] !== 1) continue;
    const A = cov[i] as number;
    if (A <= 0) continue;
    const out = [0, 1, 2].map((j) => {
      const c = linearToSrgb(Math.min(1, Math.max(0, (lin[i * 3 + j] as number) / A))) * 255;
      return Math.round(Math.min(255, Math.max(0, c * A + (bg[j] as number) * (1 - A))));
    });
    srgb[i] = ((out[0] as number) << 16) | ((out[1] as number) << 8) | (out[2] as number);
  }
  const interior = new Uint8Array(w * h);
  const deep = new Uint8Array(w * h);
  /** A CSS px clear of every edge — comfortably past a device pixel's worth of MSAA samples at dpr 2. */
  const CLEAR = 1;
  for (let Y = 1; Y < h - 1; Y++) for (let X = 1; X < w - 1; X++) {
    const i = Y * w + X;
    const k = plain[i] as number;
    let flat = true;
    for (let dy = -1; dy <= 1 && flat; dy++) for (let dx = -1; dx <= 1; dx++) if (plain[i + dy * w + dx] !== k) { flat = false; break; }
    if (!flat) continue;
    interior[i] = 1;
    if ((nearEdge[i] as number) > CLEAR) deep[i] = 1;
  }
  return { interior, deep, ink, plain, srgb, painted };
}

interface Band { readonly px: number; readonly differing: number; readonly max: number; readonly mean: number }
interface Acc { px: number; differing: number; max: number; sum: number }
const acc = (): Acc => ({ px: 0, differing: 0, max: 0, sum: 0 });
const seal = (b: Acc): Band => ({ px: b.px, differing: b.differing, max: b.max, mean: b.px === 0 ? 0 : Math.round((b.sum / b.px) * 1000) / 1000 });
const add = (b: Acc, d: number): void => { b.px++; b.sum += d; if (d > 0) b.differing++; if (d > b.max) b.max = d; };
const at = (img: ImageData, i: number): RGB => [img.data[i * 4] as number, img.data[i * 4 + 1] as number, img.data[i * 4 + 2] as number];
const keyAt = (key: Int32Array, i: number): RGB => { const k = key[i] as number; return [(k >> 16) & 255, (k >> 8) & 255, k & 255]; };
const delta = (a: RGB, b: RGB): number => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

interface Compare {
  readonly size: string;
  /** A vs B, on interior pixels the raster says carry soup — the measured consequence of the two colour chains. */
  readonly soup: Band;
  /** A vs B, on interior pixels with no soup at all: the two grounds' bare backgrounds. */
  readonly bare: Band;
  /** A vs B in the edge band — reported, never asserted on. */
  readonly edge: Band;
  /** The new ground against the CPU raster with the colour AS CONFIGURED, on DEEP pixels. */
  readonly newVsRaster: Band;
  /** The old renderer against the same raster with the colour through three's output encode, on DEEP pixels. */
  readonly oldVsSrgbRaster: Band;
  /** The same two, on interior pixels that are flat but sit within a CSS px of an edge — the SEAM band. */
  readonly newSeam: Band;
  readonly oldSeam: Band;
  /** Interior soup pixels a side left at the bare background — a HOLE the geometry says should be painted. */
  readonly coverA: number;
  readonly coverB: number;
  readonly coverPx: number;
  /** Interior pixels the raster says carry NO soup where a side painted anyway — the other half of the same claim. */
  readonly spillA: number;
  readonly spillB: number;
  readonly spillPx: number;
  readonly worst: { readonly at: [number, number]; readonly a: RGB; readonly b: RGB; readonly raster: RGB; readonly srgbRaster: RGB } | null;
  /** The deep pixel where the OLD side departs furthest from its own predicted chain — the diagnostic for whatever is left. */
  readonly worstOld: { readonly at: [number, number]; readonly a: RGB; readonly srgbRaster: RGB; readonly raster: RGB } | null;
}

function compare(A: ImageData, B: ImageData, cls: Raster, bg: RGB): Compare {
  const blank = seal(acc());
  if (A.width !== B.width || A.height !== B.height) {
    return { size: `${A.width}x${A.height} vs ${B.width}x${B.height}`, soup: blank, bare: blank, edge: blank, newVsRaster: blank, oldVsSrgbRaster: blank, newSeam: blank, oldSeam: blank, coverA: -1, coverB: -1, coverPx: 0, spillA: -1, spillB: -1, spillPx: 0, worst: null, worstOld: null };
  }
  const soup = acc();
  const bare = acc();
  const edge = acc();
  const nvr = acc();
  const ovr = acc();
  const nseam = acc();
  const oseam = acc();
  let coverA = 0;
  let coverB = 0;
  let coverPx = 0;
  let spillA = 0;
  let spillB = 0;
  let spillPx = 0;
  let worst: Compare["worst"] = null;
  let worstD = -1;
  let worstOld: Compare["worstOld"] = null;
  let worstOldD = -1;
  for (let i = 0; i < A.width * A.height; i++) {
    const a = at(A, i);
    const b = at(B, i);
    const d = delta(a, b);
    if (cls.interior[i] !== 1) { add(edge, d); continue; }
    if (cls.ink[i] !== 1) {
      add(bare, d);
      // the raster says nothing lands here; a side that painted it put a triangle where none belongs
      spillPx++;
      if (delta(a, bg) > 0) spillA++;
      if (delta(b, bg) > 0) spillB++;
      continue;
    }
    add(soup, d);
    const raster = keyAt(cls.plain, i);
    const srgbRaster = keyAt(cls.srgb, i);
    if (cls.deep[i] === 1) {
      add(nvr, delta(b, raster));
      const od = delta(a, srgbRaster);
      add(ovr, od);
      if (od > worstOldD) { worstOldD = od; worstOld = { at: [i % A.width, Math.floor(i / A.width)], a, srgbRaster, raster }; }
    }
    else { add(nseam, delta(b, raster)); add(oseam, delta(a, srgbRaster)); }
    // COVERAGE: the raster says this pixel carries soup, so neither side may have left it bare
    coverPx++;
    if (delta(a, bg) === 0) coverA++;
    if (delta(b, bg) === 0) coverB++;
    if (cls.deep[i] === 1 && d > worstD) { worstD = d; worst = { at: [i % A.width, Math.floor(i / A.width)], a, b, raster, srgbRaster }; }
  }
  return { size: `${A.width}x${A.height}`, soup: seal(soup), bare: seal(bare), edge: seal(edge), newVsRaster: seal(nvr), oldVsSrgbRaster: seal(ovr), newSeam: seal(nseam), oldSeam: seal(oseam), coverA, coverB, coverPx, spillA, spillB, spillPx, worst, worstOld };
}

interface Mounted {
  readonly dpr: number;
  readonly css: [number, number];
  readonly device: [number, number];
  readonly oldReady: boolean;
  readonly oldBackend: string;
  readonly newReady: boolean;
  readonly gpuErrors: number;
  readonly bg: RGB;
}
interface Drawn {
  readonly preview: string;
  readonly wires: number;
  readonly guides: number;
  readonly redrawsA: number;
  readonly gpuErrors: number;
  readonly inkA: number;
  readonly inkB: number;
}
interface ParityRig {
  readonly ready: Promise<void>;
  mount(): Promise<Mounted>;
  draw(preview: "none" | "solid" | "dashed"): Promise<Drawn>;
  diff(): Promise<Compare & { readonly painted: number }>;
  controlA(): Promise<Compare>;
  controlB(): Promise<Compare>;
}

function mountParityRig(): ParityRig {
  const theme = THEMES.dark;
  const bg = bytes(theme.canvasBg);
  const world = createWorld();
  const root = document.getElementById("root") as HTMLElement;
  let layer: GroundLayer | null = null;
  let newGround: Ground | null = null;
  let canvasB: HTMLCanvasElement | null = null;
  let dpr = 1;
  let gpuErrors = 0;
  let redrawsA = 0;
  const preview: WirePreviewBuffer = { active: false, compatible: false, sx: 0, sy: 0, tx: 0, ty: 0 };
  const driver = createOverlays(world, { wires: WIRES, guides: GUIDES, readWirePreview: () => preview });
  let lastSoups: { wires?: TriSoup; guides?: TriSoup } = {};
  let connect: Entity = 0 as Entity;
  let previewSeq = 0;

  // The two hosts, laid out BEFORE either ground is built: the old layer reads its
  // container's rect at construction (`createLayer`'s `applySize`), so the box has to be real.
  const hostOf = (id: string): { container: HTMLElement; contentPlane: HTMLElement } => {
    const container = document.createElement("div");
    container.id = id;
    container.style.cssText = `position:absolute;width:${VIEW.w}px;height:${VIEW.h}px;overflow:hidden;background:rgb(${bg[0]},${bg[1]},${bg[2]})`;
    const contentPlane = document.createElement("div");
    contentPlane.style.cssText = "position:absolute;inset:0";
    container.appendChild(contentPlane);
    root.appendChild(container);
    return { container, contentPlane };
  };
  const hostA = hostOf("A");
  const hostB = hostOf("B");
  hostA.container.style.left = "0px";
  hostA.container.style.top = "0px";
  hostB.container.style.left = `${VIEW.w}px`;
  hostB.container.style.top = "0px";

  const ready = (async () => {
    connect = buildScene(world).connect;
    world.setResource(Camera, CAM);
    world.setResource(Viewport, { w: VIEW.w, h: VIEW.h, dpr: window.devicePixelRatio || 1 });
    // A — the old leg. `dotAlpha: 0` empties the grid pass; the wires and guides keep their defaults.
    layer = ground({ grid: { dotAlpha: 0 }, wires: WIRES, guides: GUIDES })({
      host: hostA,
      world,
      readWirePreview: () => preview,
    });
    // B — the new leg, on the app-owned device, with the two overlays and nothing else.
    const gpu = await acquireCompositorDevice();
    gpu.device.addEventListener("uncapturederror", () => { gpuErrors += 1; });
    dpr = window.devicePixelRatio || 1;
    const c = document.createElement("canvas");
    c.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;display:block;pointer-events:none";
    c.width = Math.round(VIEW.w * dpr);
    c.height = Math.round(VIEW.h * dpr);
    hostB.container.insertBefore(c, hostB.contentPlane);
    canvasB = c;
    const g = await Ground.create({ device: gpu.device, canvas: c, ...GROUND_SHADERS, overlays: driver.programs });
    // the field draws nothing: the overlays are the whole picture on this side
    g.fieldConfig = { ...DEFAULT_FIELD_CONFIG, inkAlpha: 0 };
    newGround = g;
    // the old renderer's init is async; its reflector says when it is up
    for (let i = 0; i < 600 && layer?.reflector.available() !== true; i++) await frame();
  })();

  const must = <T,>(v: T | null | undefined, what: string): T => { if (v === null || v === undefined) throw new Error(`parity: no ${what}`); return v; };
  const frameOf = (): OverlayFrame => ({ width: VIEW.w, height: VIEW.h, dpr, camera: { x: CAM.x, y: CAM.y, zoom: CAM.zoom } });

  /** Ink = pixels that differ from the flat background, the guard against a blank readback. */
  const inkOf = (img: ImageData): number => {
    let n = 0;
    for (let i = 0; i < img.data.length; i += 4) {
      if (Math.abs((img.data[i] as number) - bg[0]) + Math.abs((img.data[i + 1] as number) - bg[1]) + Math.abs((img.data[i + 2] as number) - bg[2]) > 6) n++;
    }
    return n;
  };

  /** One frame on each side, from the same world. */
  const drawBoth = (): void => {
    driver.changed();   // the PULL — the journal drains here, exactly as the compose host drains it
    const l = must(layer, "the old layer");
    // the old layer is self-gated on its dirty union; `configureGrid` wakes every pass
    l.configureGrid({});
    l.reflector.flush(world);
    redrawsA = l.reflector.redraws();
    const g = must(newGround, "the new ground");
    const overlays = driver.build(frameOf());
    lastSoups = (overlays ?? {}) as { wires?: TriSoup; guides?: TriSoup };
    g.render({
      view: { camX: CAM.x, camY: CAM.y, zoom: CAM.zoom, width: VIEW.w, height: VIEW.h, dpr },
      pointer: { x: 0, y: 0, on: false },
      sources: [],
      frames: [],
      ...(overlays !== undefined ? { overlays } : {}),
      theme,
    });
  };

  const classified = () => {
    const g = must(newGround, "the new ground");
    const tris = [...trianglesOf(lastSoups.wires), ...trianglesOf(lastSoups.guides)];
    return classify(tris, g.surface.size().w, g.surface.size().h, dpr, bg);
  };

  return {
    ready,
    async mount() {
      await ready;
      await frames(2);
      const g = must(newGround, "the new ground");
      return {
        dpr,
        css: [VIEW.w, VIEW.h],
        device: [g.surface.size().w, g.surface.size().h],
        oldReady: must(layer, "the old layer").reflector.available(),
        oldBackend: must(layer, "the old layer").reflector.rendererStatus().backend,
        newReady: true,
        gpuErrors,
        bg,
      };
    },

    async draw(kind) {
      preview.active = kind !== "none";
      preview.compatible = kind === "solid";
      preview.sx = 200; preview.sy = 700; preview.tx = 1000; preview.ty = 560;
      // The buffer lives OUTSIDE the world, so mutating it wakes nobody. In production the
      // connect recognizer advances `Drag` in the same tick, which is the dirt both legs
      // observe; the rig writes it for the same reason and by the same route.
      previewSeq += 1;
      world.edit(connect).set(Drag, { startX: 0, startY: 0, totalX: previewSeq, totalY: 0, velX: 0, velY: 0, zoomAtClaim: 1 });
      drawBoth();
      await frames(2);
      const imgA = await readbackOver(must(document.querySelector("#A canvas"), "canvas A") as HTMLCanvasElement, bg);
      const imgB = await readbackOver(must(canvasB, "canvas B"), bg);
      return {
        preview: kind,
        wires: lastSoups.wires?.vertexCount ?? 0,
        guides: lastSoups.guides?.vertexCount ?? 0,
        redrawsA,
        gpuErrors,
        inkA: inkOf(imgA),
        inkB: inkOf(imgB),
      };
    },

    async diff() {
      const cls = classified();
      const imgA = await readbackOver(must(document.querySelector("#A canvas"), "canvas A") as HTMLCanvasElement, bg);
      const imgB = await readbackOver(must(canvasB, "canvas B"), bg);
      return { ...compare(imgA, imgB, cls, bg), painted: cls.painted };
    },

    /** The FLOOR: the old canvas drawn twice and read back twice — readback and rasteriser determinism, nothing else. */
    async controlA() {
      const cls = classified();
      const first = await readbackOver(must(document.querySelector("#A canvas"), "canvas A") as HTMLCanvasElement, bg);
      const l = must(layer, "the old layer");
      l.configureGrid({});
      l.reflector.flush(world);
      await frames(2);
      const second = await readbackOver(must(document.querySelector("#A canvas"), "canvas A") as HTMLCanvasElement, bg);
      return compare(first, second, cls, bg);
    },

    /** The same floor on the new side. */
    async controlB() {
      const cls = classified();
      const first = await readbackOver(must(canvasB, "canvas B"), bg);
      const g = must(newGround, "the new ground");
      g.render({
        view: { camX: CAM.x, camY: CAM.y, zoom: CAM.zoom, width: VIEW.w, height: VIEW.h, dpr },
        pointer: { x: 0, y: 0, on: false },
        sources: [],
        frames: [],
        ...(Object.keys(lastSoups).length ? { overlays: lastSoups as Record<string, TriSoup> } : {}),
        theme,
      });
      await frames(2);
      const second = await readbackOver(must(canvasB, "canvas B"), bg);
      return compare(first, second, cls, bg);
    },
  };
}

declare global {
  interface Window { __parityRig?: ParityRig }
}
window.__parityRig = mountParityRig();
