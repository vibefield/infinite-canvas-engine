/**
 * The B5 exit witness (design-013 §8): under the NEW composited profile a `gl`
 * island renders into the PRIVATE target Residency allocated for it, and the
 * ground draws that texture as the card's content in `own` mode.
 *
 * The whole chain executes for real: `<InfiniteCanvas profile={composited}
 * ground={groundCompose(…)}>` mounts the ground on the app-owned device, the
 * app portals a `<Canvas gl={islandRendererFactory({ device })}>` with a REAL
 * `<GLViews>` into the P2 plane, `<GLViews>` reads the ground's content seam
 * off the React context and installs an IslandRender into the roster's island
 * slot, and GpuCompose samples what three just rendered — in the same tick.
 *
 * Measured, in order:
 *  1. boot     — the profile mounts, the island renders, the residency records
 *                a written destination, the ground draws a TEXTURED card, and
 *                the z-run split is real (a dom card, the island, a dom card:
 *                three runs, because a run breaks where the own texture does);
 *  2. pixels   — off the ground canvas: the island's ink at the card's centre
 *                (not the plate), the card's PLATE where the island's texture
 *                is transparent (§10.2's second `over`), and the island's
 *                top-left mark landing top-left (islands are NOT flipped);
 *  3. parity   — the island's own target read back and compared against the
 *                SAME scene rendered by a plain WebGL three renderer, with the
 *                noise floor first (two warm repaints bit-identical) and the
 *                ink centroid on both arms; plus the ground's drawn pixels
 *                against arm A's own, which is the B5-specific claim: what the
 *                compose draws IS what three rendered;
 *  4. idle     — a still island submits nothing over a quiet window;
 *  5. demand   — an animating island renders at its bucket's rate, and a
 *                paused one renders not at all (design-013 D10, the clamp the
 *                old pass never read);
 *  6. resize   — 30 frames of Size writes leave ONE live target, N disposals,
 *                and no GPU errors: the pin-blind-resize class, dissolved.
 *
 * Mounted from `composited-islands.html`, driven by
 * `scripts/composited-islands.mjs`.
 */
import {
  acquireCompositorDevice,
  Camera,
  createCanvasEngine,
  defineCanvasType,
  defineWidget,
  RequestedDemand,
  Size,
  SurfaceDemand,
  TextureRef,
  tools,
  Viewport,
  type CanvasEngine,
  type EngineGpu,
  type Entity,
} from "@ice/core";
import { instrumentSubmits, type SubmitInstrument } from "@ice/ground";
import {
  groundCompose,
  type GroundComposeContext,
  type GroundComposeHandle,
} from "@ice/ground/compose";
import { THEMES } from "@ice/ground/oracle/fixtures/vf-theme";
import { createGLBridge, GLViews, useIslandFrame, type GLBridge, type IslandRender } from "@ice/r3f";
import { islandRendererFactory } from "@ice/r3f/webgpu";
import { compositedProfile, InfiniteCanvas, type InfiniteCanvasHandle } from "@ice/react";
import { Canvas } from "@react-three/fiber";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";

type RGB = readonly [number, number, number];

// --- the probe island -------------------------------------------------------

/** The card, in world units. Island-local space is the same box, centre-origin and Y-UP. */
const CARD = { w: 240, h: 160 } as const;
/** Its ink at the card's centre. */
const INK = 0x2e86ff;
/** The TOP-LEFT mark: scene −x, +y must land top-left on screen (islands are not flipped). */
const MARK = 0xffd400;
/** A foot below centre, so the picture is not one blob and its mass is unmistakably ABOVE centre. */
const FOOT = 0x1b3a5c;

/**
 * The scene, built ONCE as a function so both arms get identical geometry and
 * materials from the same construction rather than from two descriptions of
 * it. Flat `meshBasicMaterial`, no lights: the grading compares colours, and a
 * lit material would make brightness depend on normals and MSAA instead of on
 * what was drawn.
 */
function buildProbeScene(): { scene: Scene; camera: OrthographicCamera; meshes: Mesh[] } {
  const body = new Mesh(new PlaneGeometry(160, 60), new MeshBasicMaterial({ color: INK }));
  body.position.set(0, 25, 0);
  const mark = new Mesh(new PlaneGeometry(30, 20), new MeshBasicMaterial({ color: MARK }));
  mark.position.set(-55, 58, 1);
  const foot = new Mesh(new PlaneGeometry(60, 20), new MeshBasicMaterial({ color: FOOT }));
  foot.position.set(0, -55, 0);
  // ROTATED on purpose. Everything else in this scene is axis-aligned on whole device
  // pixels, so its edges carry no partial coverage and the two backends agree bit for
  // bit — a parity number about nothing. This edge is the one that makes MSAA and the
  // rasteriser matter, which is what a cross-backend diff is supposed to measure.
  foot.rotation.z = 0.35;
  const scene = new Scene();
  scene.add(body, mark, foot);
  const camera = new OrthographicCamera(-CARD.w / 2, CARD.w / 2, CARD.h / 2, -CARD.h / 2, 0.1, 2000);
  camera.position.set(0, 0, 500);
  camera.updateProjectionMatrix();
  return { scene, camera, meshes: [body, mark, foot] };
}

/** Sample points in ISLAND-LOCAL coordinates (centre origin, Y up). */
const PROBE = {
  ink: [0, 25] as const,
  /** Between the body's bottom edge (y = −5) and the foot's top (y = −45): nothing is drawn. */
  clear: [0, -25] as const,
  mark: [-55, 58] as const,
  /** The mark's mirror. A flipped or rotated capture would put the mark here. */
  antiMark: [55, -58] as const,
};

function IslandProbeView(): ReactElement {
  const [scene] = useState(() => buildProbeScene());
  return <primitive object={scene.scene.clone(true)} />;
}

/** The animating twin: a live `useIslandFrame` is the animation signal (the island turns Hot). */
function AnimatedProbeView(): ReactElement {
  const [scene] = useState(() => buildProbeScene());
  const ticks = useRef(0);
  useIslandFrame(() => {
    ticks.current += 1;
    (window as unknown as { __islandTicks?: number }).__islandTicks = ticks.current;
  });
  return <primitive object={scene.scene.clone(true)} />;
}

const ISLAND = defineWidget({
  type: "b5:island",
  surface: "gl",
  animated: false,
  component: IslandProbeView,
  sizeMode: "fixed",
  defaultSize: { w: CARD.w, h: CARD.h },
  interaction: { selectable: false, movable: false },
});
const ANIMATED = defineWidget({
  type: "b5:island-animated",
  surface: "gl",
  animated: true,
  component: AnimatedProbeView,
  sizeMode: "fixed",
  defaultSize: { w: CARD.w, h: CARD.h },
  interaction: { selectable: false, movable: false },
});
/** A plain DOM card, so the z order really interleaves and the run split is real. */
const CARD_DOM = defineWidget({
  type: "b5:card",
  surface: "dom",
  component: () => <div style={{ width: "100%", height: "100%" }} />,
  sizeMode: "fixed",
  defaultSize: { w: CARD.w, h: CARD.h },
});
const ROOT = defineCanvasType({
  id: "b5:root",
  semanticVersion: 1,
  semantic: { placement: { widgets: [ISLAND, ANIMATED, CARD_DOM] } },
  presentation: { camera: { arrival: "identity" } },
});

// --- capture + grading (island-parity's method, on B5's two arms) ------------

interface Capture {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}
interface CaptureStats {
  readonly id: string;
  readonly arm: string;
  readonly width: number;
  readonly height: number;
  readonly distinctColors: number;
  readonly inkPixels: number;
  readonly inkCentroidX: number;
  readonly inkCentroidY: number;
  readonly hash: string;
}
interface DiffResult {
  readonly totalPixels: number;
  readonly differingPixels: number;
  readonly differingBeyond1: number;
  readonly maxChannelDelta: number;
  readonly meanAbsDelta: number;
  readonly differingPct: number;
}

const captures = new Map<string, Capture>();
let captureSeq = 0;

/** Read a GPUTexture back, row-padding removed. Row 0 is the TOP row (WebGPU's own order). */
async function readTexture(device: GPUDevice, texture: GPUTexture): Promise<Capture> {
  const width = texture.width;
  const height = texture.height;
  const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
  const buffer = device.createBuffer({
    size: bytesPerRow * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder({ label: "b5/readback" });
  encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, { width, height });
  device.queue.submit([encoder.finish()]);
  await buffer.mapAsync(GPUMapMode.READ);
  const src = new Uint8Array(buffer.getMappedRange());
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    data.set(src.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4);
  }
  buffer.unmap();
  buffer.destroy();
  return { width, height, data };
}

/** WebGL reads BOTTOM-UP; every capture in this rig is normalised to row 0 = top. */
function flipRows(data: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data.length);
  const stride = width * 4;
  for (let y = 0; y < height; y++) {
    out.set(data.subarray((height - 1 - y) * stride, (height - y) * stride), y * stride);
  }
  return out;
}

function statsOf(id: string, arm: string, cap: Capture): CaptureStats {
  const colours = new Set<number>();
  let ink = 0;
  let sx = 0;
  let sy = 0;
  let hash = 2166136261;
  for (let y = 0; y < cap.height; y++) {
    for (let x = 0; x < cap.width; x++) {
      const i = (y * cap.width + x) * 4;
      const r = cap.data[i] as number;
      const g = cap.data[i + 1] as number;
      const b = cap.data[i + 2] as number;
      const a = cap.data[i + 3] as number;
      colours.add((r << 24) | (g << 16) | (b << 8) | a);
      if (a > 8) {
        ink += 1;
        sx += x;
        sy += y;
      }
      hash = Math.imul(hash ^ r, 16777619) ^ g;
      hash = Math.imul(hash ^ b, 16777619) ^ a;
    }
  }
  return {
    id,
    arm,
    width: cap.width,
    height: cap.height,
    distinctColors: colours.size,
    inkPixels: ink,
    inkCentroidX: ink === 0 ? -1 : sx / ink / cap.width,
    inkCentroidY: ink === 0 ? -1 : sy / ink / cap.height,
    hash: (hash >>> 0).toString(16),
  };
}

function diffCaptures(a: Capture, b: Capture): DiffResult {
  const total = Math.min(a.width * a.height, b.width * b.height);
  let differing = 0;
  let beyond1 = 0;
  let maxDelta = 0;
  let sum = 0;
  for (let i = 0; i < total * 4; i += 4) {
    let worst = 0;
    for (let c = 0; c < 4; c++) {
      const d = Math.abs((a.data[i + c] as number) - (b.data[i + c] as number));
      sum += d;
      if (d > worst) worst = d;
    }
    if (worst > 0) differing += 1;
    if (worst > 1) beyond1 += 1;
    if (worst > maxDelta) maxDelta = worst;
  }
  return {
    totalPixels: total,
    differingPixels: differing,
    differingBeyond1: beyond1,
    maxChannelDelta: maxDelta,
    meanAbsDelta: sum / (total * 4),
    differingPct: total === 0 ? 0 : (differing / total) * 100,
  };
}

/** The stratified arm: the SAME scene, rendered by a plain WebGL three renderer. */
function stratifiedCapture(width: number, height: number): Capture {
  const renderer = new WebGLRenderer({ antialias: false, alpha: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  const rt = new WebGLRenderTarget(width, height, { samples: 4 });
  rt.texture.colorSpace = SRGBColorSpace;
  const { scene, camera, meshes } = buildProbeScene();
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, true, false);
  renderer.render(scene, camera);
  const raw = new Uint8Array(width * height * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, width, height, raw);
  renderer.setRenderTarget(null);
  rt.dispose();
  for (const m of meshes) {
    m.geometry.dispose();
    (m.material as MeshBasicMaterial).dispose();
  }
  renderer.dispose();
  return { width, height, data: flipRows(new Uint8ClampedArray(raw.buffer.slice(0)), width, height) };
}

// --- the ground canvas readback (the 2026-09 finding: toDataURL, never drawImage) ---

async function groundReadback(canvas: HTMLCanvasElement): Promise<ImageData> {
  const url = canvas.toDataURL("image/png");
  const img = new Image();
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("readback decode"));
    img.src = url;
  });
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext("2d");
  if (g === null) throw new Error("readback 2d");
  g.drawImage(img, 0, 0);
  return g.getImageData(0, 0, c.width, c.height);
}

/** The modal colour of a 5×5 patch centred at device px (x, y) — an edge texel cannot outvote it. */
function modal(img: ImageData, x: number, y: number): RGB {
  const counts = new Map<number, number>();
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const px = Math.min(Math.max(Math.round(x + dx), 0), img.width - 1);
      const py = Math.min(Math.max(Math.round(y + dy), 0), img.height - 1);
      const i = (py * img.width + px) * 4;
      const key = ((img.data[i] as number) << 16) | ((img.data[i + 1] as number) << 8) | (img.data[i + 2] as number);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  let best = 0;
  let bestN = -1;
  for (const [k, n] of counts) if (n > bestN) [best, bestN] = [k, n];
  return [(best >> 16) & 255, (best >> 8) & 255, best & 255];
}

const hexRgb = (hex: number): RGB => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const bytes = (c: RGB): RGB => [Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255)];

// --- the rig ----------------------------------------------------------------

interface Mounted {
  readonly profile: string;
  readonly canvases: number;
  readonly available: boolean;
  readonly redraws: number;
  readonly gpuErrors: number;
}
interface Boot {
  readonly cards: number;
  readonly textured: number;
  readonly runs: number;
  readonly rendered: number;
  readonly targets: number;
  readonly written: number;
  readonly realized: number;
  readonly ownMode: string;
  readonly srgb: boolean;
  readonly targetSize: readonly [number, number];
  readonly rasterSize: readonly [number, number];
  readonly gpuErrors: number;
  readonly note?: string;
}
interface Pixels {
  readonly ink: RGB;
  readonly clear: RGB;
  readonly mark: RGB;
  readonly antiMark: RGB;
  readonly expect: { readonly ink: RGB; readonly mark: RGB; readonly plate: RGB };
}
interface Idle {
  readonly frames: number;
  readonly submits: number;
  readonly redraws: number;
  readonly rendered: number;
}
interface Demand {
  readonly ms: number;
  readonly rendered: number;
  readonly skippedBudget: number;
  readonly skippedPaused: number;
  readonly ticks: number;
}
interface Resize {
  readonly frames: number;
  readonly handles: number;
  readonly targets: number;
  readonly disposed: number;
  readonly rendered: number;
  readonly gpuErrors: number;
  readonly liveEveryFrame: boolean;
  /** Handles this card retired that STILL hold a target — the leak, if there is one. */
  readonly staleTargets: number;
  /** The current ref names a live target at the end. */
  readonly currentLive: boolean;
}

interface CrossKindZ {
  readonly samples: number;
  /** Samples on which the probe point was NOT the island's ink — i.e. the dom card covered it. */
  readonly covered: number;
  /** The island's own colour at that point, read before the cover existed (the control). */
  readonly islandInk: RGB;
  readonly seen: readonly string[];
  readonly runs: number;
  readonly plate: RGB;
  readonly gpuErrors: number;
}
interface IslandsRig {
  readonly ready: Promise<void>;
  mount(): Promise<Mounted>;
  boot(): Promise<Boot>;
  pixels(): Promise<Pixels>;
  /** `repaint` forces the island to paint again first — the difference between a COLD first paint and a warm one. */
  captureIsland(arm: string, repaint?: boolean): Promise<CaptureStats>;
  captureStratified(arm: string): Promise<CaptureStats>;
  compareGroundToIsland(): Promise<{ ink: RGB; own: RGB; delta: number }>;
  diff(a: string, b: string): DiffResult;
  idle(ms: number): Promise<Idle>;
  animate(bucket: number, ms: number): Promise<Demand>;
  pause(ms: number): Promise<Demand>;
  resize(frames: number): Promise<Resize>;
  /**
   * CROSS-KIND Z (B8 R7, ported from the old `app-witness` rig): a DOM card at a
   * LATER ordinal must cover a GL island in the same pass, on every frame — the
   * two kinds share one z order, or a card pops out from under another.
   */
  crossKindZ(samples: number): Promise<CrossKindZ>;
}

const frame = (): Promise<void> => new Promise<void>((r) => requestAnimationFrame(() => r()));
const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await frame();
};

function App({
  engine,
  gpu,
  onGround,
  onIsland,
  onBridge,
}: {
  engine: CanvasEngine;
  gpu: EngineGpu;
  onGround: (h: GroundComposeHandle) => void;
  onIsland: (r: IslandRender | null) => void;
  onBridge: (b: GLBridge) => void;
}): ReactElement {
  const [gl, setGl] = useState<{ bridge: GLBridge; plane: HTMLDivElement } | null>(null);
  const factory = useRef(
    groundCompose({ device: gpu.device, theme: THEMES.dark }),
  );
  const ground = useRef((ctx: GroundComposeContext) => {
    const handle = factory.current(ctx);
    onGround(handle);
    return handle;
  });
  const canvasGl = useRef(islandRendererFactory({ device: gpu.device }));
  const onReady = useRef((handle: InfiniteCanvasHandle) => {
    const bridge = createGLBridge(engine.engine, { transitions: engine.transitions, gpu: engine.gpu });
    const plane = handle.host.container.ownerDocument.createElement("div");
    plane.style.cssText = "position:absolute;inset:0;pointer-events:none;";
    handle.host.container.insertBefore(plane, handle.planes.lifted);
    onBridge(bridge);
    setGl({ bridge, plane });
  });
  useEffect(() => () => gl?.bridge.uninstall(), [gl]);
  return (
    <InfiniteCanvas
      engine={engine}
      ground={ground.current}
      profile={compositedProfile}
      onReady={onReady.current}
      className="h-full w-full"
    >
      {gl !== null &&
        createPortal(
          <Canvas
            orthographic
            frameloop="never"
            gl={canvasGl.current}
            style={{ pointerEvents: "none", position: "absolute", inset: 0 }}
          >
            <GLViews
              engine={engine.engine}
              bridge={gl.bridge}
              store={engine.runtime.store}
              onIslandRender={onIsland}
            />
          </Canvas>,
          gl.plane,
        )}
    </InfiniteCanvas>
  );
}

/** Narrow-or-throw, hoisted above the boot IIFE that uses it. */
function must<T>(v: T | null | undefined, what: string): T {
  if (v === null || v === undefined) throw new Error(`rig: no ${what}`);
  return v;
}

function mountRig(): IslandsRig {
  let gpu: EngineGpu | undefined;
  let instrument: SubmitInstrument | undefined;
  let engine: CanvasEngine | undefined;
  let ground: GroundComposeHandle | null = null;
  let island: IslandRender | null = null;
  let bridge: GLBridge | null = null;
  const rootEl = document.getElementById("root") as HTMLElement;
  const theme = THEMES.dark;
  let islandCard: Entity | undefined;
  let animatedCard: Entity | undefined;
  const zoom = 1;

  const ready = (async () => {
    gpu = await acquireCompositorDevice();
    instrument = instrumentSubmits(gpu.device);
    const ce = createCanvasEngine({
      widgets: [ISLAND, ANIMATED, CARD_DOM],
      canvasTypes: [ROOT],
      rootCanvas: ROOT,
      presentationFallback: ROOT,
      tools: [must(tools.get("select"), "the select tool"), must(tools.get("pan"), "the pan tool")],
      compositorDevice: gpu,
    });
    ce.docs.create();
    engine = ce;
    createRoot(rootEl).render(
      <App
        engine={ce}
        gpu={gpu}
        onGround={(h) => {
          ground = h;
        }}
        onIsland={(r) => {
          island = r;
        }}
        onBridge={(b) => {
          bridge = b;
        }}
      />,
    );
    await frames(3);
  })();

  const ce = (): CanvasEngine => must(engine, "engine");
  const compose = () => must(ground, "ground handle").compose;
  const isl = (): IslandRender => must(island, "island render");
  const submits = (): number => instrument?.total() ?? 0;
  const redraws = (): number => ground?.compose.redraws() ?? 0;
  const dpr = (): number => ce().world.getResource(Viewport)?.dpr ?? 1;
  const handleOf = (e: Entity): number => ce().world.get(e, TextureRef)?.texture ?? 0;
  const until = async (p: () => boolean, max = 300): Promise<boolean> => {
    for (let i = 0; i < max && !p(); i++) await frame();
    return p();
  };
  /** Island-local (centre origin, Y up) → device px on the ground canvas. */
  const islandToDevice = (card: Entity, lx: number, ly: number): [number, number] => {
    const g = must(compose().geometryOf(card), "geometry");
    const d = dpr();
    return [(g.centre[0] + lx) * zoom * d, (g.centre[1] - ly) * zoom * d];
  };

  return {
    ready,
    async mount() {
      await ready;
      await until(() => (ground?.compose.available() ?? false) && redraws() > 0);
      return {
        profile: compositedProfile.name,
        // the ground's own and (islands) the never-presenting island Canvas — never the L1 source canvas B4 mounts for the copies
        canvases: rootEl.querySelectorAll("canvas:not([data-ice-source-canvas])").length,
        available: ground?.compose.available() ?? false,
        redraws: redraws(),
        gpuErrors: gpu?.errors().length ?? 0,
      };
    },

    async boot() {
      const e = ce();
      const world = e.world;
      world.setResource(Camera, { x: 0, y: 0, zoom, gesturing: false });
      // z order = spawn order: a dom card, an island, a dom card, a second island.
      // A run breaks only where the OWN TEXTURE changes, and a plate card reads none
      // — it rides whichever run it falls in (`runsOf`). So the witness for a real z
      // split is TWO islands with a plate card between them, not one island at all.
      e.ops.spawnWidget("b5:card", { x: 40, y: 40, w: CARD.w, h: CARD.h, undoable: false });
      islandCard = e.ops.spawnWidget("b5:island", { x: 340, y: 40, w: CARD.w, h: CARD.h, undoable: false });
      e.ops.spawnWidget("b5:card", { x: 640, y: 40, w: CARD.w, h: CARD.h, undoable: false });
      e.ops.spawnWidget("b5:island", { x: 940, y: 40, w: CARD.w, h: CARD.h, undoable: false });
      world.sync();
      const ok = await until(() => (island?.stats().rendered ?? 0) >= 2 && compose().stats().textured >= 2);
      await frames(4);

      const card = must(islandCard, "island card");
      const handle = handleOf(card);
      const target = isl().targetOf(handle);
      const size = world.get(card, Size);
      const d = dpr();
      const s = compose().stats();
      const st = isl().stats();
      const content = compose().residency.contentOf(card);
      return {
        cards: s.cards,
        textured: s.textured,
        runs: s.runs,
        rendered: st.rendered,
        targets: st.targets,
        written: compose().residency.stats().written,
        realized: compose().residency.stats().realized,
        ownMode: content.mode,
        srgb: content.mode === "own" && content.srgb,
        targetSize: [target?.width ?? -1, target?.height ?? -1] as const,
        rasterSize: [Math.ceil((size?.w ?? 0) * d), Math.ceil((size?.h ?? 0) * d)] as const,
        gpuErrors: gpu?.errors().length ?? 0,
        ...(ok ? {} : { note: "the island never rendered into a textured card" }),
      };
    },

    async pixels() {
      const card = must(islandCard, "island card");
      const img = await groundReadback(compose().canvas);
      const at = (lx: number, ly: number): RGB => {
        const [x, y] = islandToDevice(card, lx, ly);
        return modal(img, x, y);
      };
      return {
        ink: at(PROBE.ink[0], PROBE.ink[1]),
        clear: at(PROBE.clear[0], PROBE.clear[1]),
        mark: at(PROBE.mark[0], PROBE.mark[1]),
        antiMark: at(PROBE.antiMark[0], PROBE.antiMark[1]),
        expect: { ink: hexRgb(INK), mark: hexRgb(MARK), plate: bytes(theme.card) },
      };
    },

    async captureIsland(arm, repaint = false) {
      const card = must(islandCard, "island card");
      if (repaint) {
        // Island dirt: the same wake a props change raises. One more render into the SAME
        // target, which is what makes a cold-vs-warm comparison about the RENDERER.
        must(bridge, "gl bridge").bumpPaint(card);
        const before = isl().stats().rendered;
        await until(() => isl().stats().rendered > before, 120);
        await frames(2);
      }
      const handle = handleOf(card);
      const texture = compose().residency.textureOf(handle);
      const cap = await readTexture(must(gpu, "gpu").device, must(texture, "a realised island texture"));
      const id = `A${++captureSeq}`;
      captures.set(id, cap);
      return statsOf(id, arm, cap);
    },

    async captureStratified(arm) {
      const card = must(islandCard, "island card");
      const target = isl().targetOf(handleOf(card));
      const cap = stratifiedCapture(must(target, "an island target").width, must(target, "an island target").height);
      const id = `B${++captureSeq}`;
      captures.set(id, cap);
      return statsOf(id, arm, cap);
    },

    async compareGroundToIsland() {
      const card = must(islandCard, "island card");
      const img = await groundReadback(compose().canvas);
      const [x, y] = islandToDevice(card, PROBE.ink[0], PROBE.ink[1]);
      const ink = modal(img, x, y);
      // The same point in the island's OWN texture: island-local → texture uv → texel.
      const handle = handleOf(card);
      const cap = await readTexture(must(gpu, "gpu").device, must(compose().residency.textureOf(handle), "texture"));
      const tx = Math.round(((PROBE.ink[0] + CARD.w / 2) / CARD.w) * cap.width);
      const ty = Math.round(((CARD.h / 2 - PROBE.ink[1]) / CARD.h) * cap.height);
      const i = (Math.min(ty, cap.height - 1) * cap.width + Math.min(tx, cap.width - 1)) * 4;
      const own: RGB = [cap.data[i] as number, cap.data[i + 1] as number, cap.data[i + 2] as number];
      const delta = Math.max(...own.map((v, k) => Math.abs(v - (ink[k] as number))));
      return { ink, own, delta };
    },

    diff(a, b) {
      return diffCaptures(must(captures.get(a), `capture ${a}`), must(captures.get(b), `capture ${b}`));
    },

    async idle(ms) {
      const s0 = submits();
      const r0 = redraws();
      const i0 = isl().stats().rendered;
      const t0 = performance.now();
      let n = 0;
      while (performance.now() - t0 < ms) {
        await frame();
        n++;
      }
      return { frames: n, submits: submits() - s0, redraws: redraws() - r0, rendered: isl().stats().rendered - i0 };
    },

    async animate(bucket, ms) {
      const e = ce();
      const world = e.world;
      if (animatedCard === undefined) {
        animatedCard = e.ops.spawnWidget("b5:island-animated", { x: 340, y: 260, w: CARD.w, h: CARD.h, undoable: false });
        world.sync();
        await frames(6);
      }
      const card = animatedCard;
      // A rig SETUP write, outside the tick — the kind behaviour's own request, by hand.
      world.edit(card).set(RequestedDemand, { mode: "live", fpsBucket: bucket, interactive: false });
      await until(() => world.get(card, SurfaceDemand)?.fpsBucket === bucket, 60);
      const before = isl().stats();
      const ticks0 = (window as unknown as { __islandTicks?: number }).__islandTicks ?? 0;
      const t0 = performance.now();
      while (performance.now() - t0 < ms) await frame();
      const after = isl().stats();
      return {
        ms: performance.now() - t0,
        rendered: after.rendered - before.rendered,
        skippedBudget: after.skippedBudget - before.skippedBudget,
        skippedPaused: after.skippedPaused - before.skippedPaused,
        ticks: ((window as unknown as { __islandTicks?: number }).__islandTicks ?? 0) - ticks0,
      };
    },

    async pause(ms) {
      const world = ce().world;
      const card = must(animatedCard, "animated card");
      world.edit(card).set(RequestedDemand, { mode: "paused", fpsBucket: 0, interactive: false });
      await until(() => world.get(card, SurfaceDemand)?.mode === "paused", 60);
      const before = isl().stats();
      const t0 = performance.now();
      while (performance.now() - t0 < ms) await frame();
      const after = isl().stats();
      return {
        ms: performance.now() - t0,
        rendered: after.rendered - before.rendered,
        skippedBudget: after.skippedBudget - before.skippedBudget,
        skippedPaused: after.skippedPaused - before.skippedPaused,
        ticks: 0,
      };
    },

    async crossKindZ(samples) {
      const e = ce();
      const world = e.world;
      const card = must(islandCard, "island card");
      // A point inside the island's picture, in the RIGHT half — where the
      // covering card will sit. Sampled first WITHOUT it: the control, without
      // which "the island is hidden" could just mean "the island never drew".
      const probe: readonly [number, number] = [40, 25];
      const p0 = islandToDevice(card, probe[0], probe[1]);
      const islandInk = modal(await groundReadback(compose().canvas), p0[0], p0[1]);

      // The cover: a plain DOM card, spawned LAST, overlapping the island's
      // right half. Its ordinal is later, so it is above — and a dom card at
      // rest is the ground's PLATE, a different colour from the island's ink.
      e.ops.spawnWidget("b5:card", { x: 460, y: 40, w: CARD.w, h: CARD.h, undoable: false });
      world.sync();
      await frames(8);

      let covered = 0;
      let n = 0;
      const seen: string[] = [];
      for (let i = 0; i < samples; i++) {
        // Nudge the camera so the ground really redraws each sample: a z order
        // that only holds on a static frame is not a z order.
        world.setResource(Camera, { x: (i % 2) * 0.5, y: 0, zoom, gesturing: false });
        await frames(2);
        const img = await groundReadback(compose().canvas);
        const [x, y] = islandToDevice(card, probe[0], probe[1]);
        const c = modal(img, x, y);
        n++;
        if (c[0] !== islandInk[0] || c[1] !== islandInk[1] || c[2] !== islandInk[2]) covered++;
        if (seen.length < 3) seen.push(`(${c.join(",")})`);
      }
      world.setResource(Camera, { x: 0, y: 0, zoom, gesturing: false });
      await frames(2);
      return {
        samples: n,
        covered,
        islandInk,
        seen,
        runs: compose().stats().runs,
        plate: bytes(theme.card),
        gpuErrors: gpu?.errors().length ?? 0,
      };
    },

    async resize(n) {
      const world = ce().world;
      const card = must(islandCard, "island card");
      const before = isl().stats();
      const handles = new Set<number>([handleOf(card)]);
      let liveEveryFrame = true;
      for (let f = 0; f < n; f++) {
        world.edit(card).set(Size, { w: CARD.w + f * 2, h: CARD.h });
        await frame();
        const handle = handleOf(card);
        handles.add(handle);
        // What the ground samples is the CURRENT ref's target, and it is live.
        if (isl().targetOf(handle) === undefined) liveEveryFrame = false;
      }
      // let the last drain land
      world.edit(card).set(Size, { w: CARD.w, h: CARD.h });
      await frames(6);
      const current = handleOf(card);
      handles.add(current);
      const after = isl().stats();
      // `targets` counts every island on the board; the CLAIM is about this card's own
      // handle history, so count what it retired and still holds.
      const stale = [...handles].filter((h) => h !== current && isl().targetOf(h) !== undefined);
      return {
        frames: n,
        handles: handles.size,
        targets: after.targets,
        disposed: after.disposed - before.disposed,
        rendered: after.rendered - before.rendered,
        gpuErrors: gpu?.errors().length ?? 0,
        liveEveryFrame,
        staleTargets: stale.length,
        currentLive: isl().targetOf(current) !== undefined,
      };
    },
  };
}

declare global {
  interface Window {
    __b5Rig?: IslandsRig;
  }
}
window.__b5Rig = mountRig();
