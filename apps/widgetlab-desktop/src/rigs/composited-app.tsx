/**
 * The C0 exit witness (design-013 §8, Phase C's opening slice): the PRODUCT's own
 * GL cards draw on the ground's device.
 *
 * Every island the other rigs render is UNLIT — flat `MeshBasicMaterial`, no
 * lights, no environment. The board's seven GL cards are not: they carry
 * `meshStandardMaterial` / `meshPhysicalMaterial`, analytic lights and a PMREM
 * `scene.environment`. Before this rig no lit node-material path and no PMREM
 * sampling had ever run on the app-owned device in this repo, and a black card is
 * exactly what a broken one looks like from a screenshot.
 *
 * So this rig seeds the REAL board (`createDemoEngine` + the App's own
 * `seedDemoScene`) and mounts the App's OWN Canvas wiring — `BoardGLCanvas`, the
 * component the product renders, not a copy of it. What is graded is the shipping
 * path.
 *
 * Measured, in order:
 *  1. mount   — the composited profile, the ground on the app-owned device, and the
 *               WEBGPU environment generator taken (D-C0.1: the branch is on the
 *               BACKEND, and `three`'s WebGL PMREM would have thrown here);
 *  2. board   — the seven GL cards each render into the private target Residency
 *               named, realise a handle, write a destination, and draw in `own` mode;
 *  3. lit     — none of them is blank or black, read off its OWN texture;
 *  4. parity  — the gold knot (meshPhysicalMaterial, metalness 1, envMapIntensity
 *               1.4 — the PMREM card) and the matte sphere (meshStandardMaterial
 *               under two point lights) against a WebGL CONTROL that renders THE
 *               SAME Scene object, noise floors first. The environment
 *               discriminates: the same control with `scene.environment = null`
 *               must be a materially different picture, or the match proves nothing;
 *  5. ground  — what the compose DRAWS at the card's centre is what three RENDERED;
 *  6. idle    — a settled board with every island's demand paused submits nothing;
 *  7. strict  — the StrictMode double mount built ONE renderer, and a real unmount
 *               → remount disposes it and builds one more (D-C0.4).
 *
 * Mounted from `composited-app.html`, driven by `scripts/composited-app.mjs`.
 */
import {
  acquireCompositorDevice,
  Camera,
  Position,
  PrefabId,
  RequestedDemand,
  Size,
  SurfaceDemand,
  TextureRef,
  Viewport,
  defineQuery,
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
import { cuttingMat, needleGlyph, vfFrame } from "@ice/ground/packs";
import { createGLBridge, type GLBridge, type IslandRender } from "@ice/r3f";
import { compositedProfile, InfiniteCanvas, type InfiniteCanvasHandle } from "@ice/react";
import { StrictMode, useEffect, useRef, useState, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import {
  PMREMGenerator,
  SRGBColorSpace,
  WebGLRenderer,
  WebGLRenderTarget,
  type Texture,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { createDemoEngine, seedDemoScene } from "../App";
import { BoardGLCanvas, envGeneratorBackend, islandRendererCensus } from "../BoardGLCanvas";

type RGB = readonly [number, number, number];

/** The board's GL card types, in `widgets/gl.ts` order. */
const GL_TYPES = [
  "matte-sphere-card",
  "crystal-widget",
  "torus-knot-card",
  "floating-cube-widget",
  "gold-knot-card",
  "shapes-card",
  "orbit-cube-card",
] as const;

/** The two the cross-backend grade runs on, and why each is here. */
const GRADED = [
  { type: "gold-knot-card", why: "meshPhysicalMaterial, metalness 1, clearcoat, envMapIntensity 1.4 — the PMREM card" },
  { type: "matte-sphere-card", why: "meshStandardMaterial under two point lights + ambient — the analytic-lights card" },
] as const;

// --- capture + grading (the islands rig's method, on C0's two arms) ----------

interface Capture {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}
interface CaptureStats {
  readonly id: string;
  readonly type: string;
  readonly arm: string;
  readonly width: number;
  readonly height: number;
  readonly distinctColors: number;
  readonly inkPixels: number;
  readonly meanLuma: number;
  readonly inkCentroidX: number;
  readonly inkCentroidY: number;
  readonly hash: string;
}
interface DiffResult {
  readonly totalPixels: number;
  readonly differingPixels: number;
  readonly differingBeyond1: number;
  /**
   * Pixels differing by more than 16/255 — the SHARP number. A metallic clearcoat's
   * specular comes off a mip chain the two backends build with different filters, so
   * `beyond1` counts a broad haze of last-bit disagreement; `beyond16` counts pixels
   * that are actually a different colour, which is the claim worth gating.
   */
  readonly differingBeyond16: number;
  readonly maxChannelDelta: number;
  readonly meanAbsDelta: number;
  readonly differingPct: number;
  readonly beyond1Pct: number;
  readonly beyond16Pct: number;
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
  const encoder = device.createCommandEncoder({ label: "c0/readback" });
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

function statsOf(id: string, type: string, arm: string, cap: Capture): CaptureStats {
  const colours = new Set<number>();
  let ink = 0;
  let sx = 0;
  let sy = 0;
  let luma = 0;
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
        luma += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      }
      hash = Math.imul(hash ^ r, 16777619) ^ g;
      hash = Math.imul(hash ^ b, 16777619) ^ a;
    }
  }
  return {
    id,
    type,
    arm,
    width: cap.width,
    height: cap.height,
    distinctColors: colours.size,
    inkPixels: ink,
    meanLuma: ink === 0 ? 0 : luma / ink,
    inkCentroidX: ink === 0 ? -1 : sx / ink / cap.width,
    inkCentroidY: ink === 0 ? -1 : sy / ink / cap.height,
    hash: (hash >>> 0).toString(16),
  };
}

function diffCaptures(a: Capture, b: Capture): DiffResult {
  const total = Math.min(a.width * a.height, b.width * b.height);
  let differing = 0;
  let beyond1 = 0;
  let beyond16 = 0;
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
    if (worst > 16) beyond16 += 1;
    if (worst > maxDelta) maxDelta = worst;
  }
  return {
    totalPixels: total,
    differingPixels: differing,
    differingBeyond1: beyond1,
    differingBeyond16: beyond16,
    maxChannelDelta: maxDelta,
    meanAbsDelta: sum / (total * 4),
    differingPct: total === 0 ? 0 : (differing / total) * 100,
    beyond1Pct: total === 0 ? 0 : (beyond1 / total) * 100,
    beyond16Pct: total === 0 ? 0 : (beyond16 / total) * 100,
  };
}

// --- the ground canvas readback (2026-09 finding: toDataURL, never drawImage) ---

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

// --- the React tree: the product's ground, the product's Canvas --------------

/** The rig toggles the GL root off and on — D-C0.4's real unmount → remount. */
let setGlMountedExternal: ((v: boolean) => void) | null = null;

function RigApp({
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
  const [glMounted, setGlMounted] = useState(true);
  useEffect(() => {
    setGlMountedExternal = setGlMounted;
    return () => {
      setGlMountedExternal = null;
    };
  }, []);
  // The App's own ground options, verbatim (App.tsx's `groundFactory`).
  const factory = useRef(
    groundCompose({
      device: gpu.device,
      theme: THEMES.dark,
      card: vfFrame(),
      grids: [needleGlyph, cuttingMat],
    }),
  );
  const ground = useRef((ctx: GroundComposeContext) => {
    const handle = factory.current(ctx);
    onGround(handle);
    return handle;
  });
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
      {gl !== null && glMounted && (
        <BoardGLCanvas
          engine={engine.engine}
          bridge={gl.bridge}
          store={engine.runtime.store}
          plane={gl.plane}
          gpu={gpu}
          onIslandRender={onIsland}
        />
      )}
    </InfiniteCanvas>
  );
}

// --- the rig ----------------------------------------------------------------

interface Mounted {
  readonly profile: string;
  readonly canvases: number;
  readonly available: boolean;
  readonly redraws: number;
  readonly envBackend: string | null;
  readonly gpuErrors: number;
}
interface CardFacts {
  readonly type: string;
  readonly found: boolean;
  readonly handle: number;
  readonly mode: string;
  readonly srgb: boolean;
  /** three's render target for the card's current handle. */
  readonly targetSize: readonly [number, number];
  /** The GPUTexture the residency holds for that handle — the DESTINATION. */
  readonly textureSize: readonly [number, number];
  /** The card's world box, and what the destination's scale over it works out to (dpr × band). */
  readonly worldSize: readonly [number, number];
  readonly rasterScale: number;
}
interface Board {
  readonly seeded: number;
  readonly glCards: number;
  readonly cards: number;
  readonly textured: number;
  readonly rendered: number;
  readonly targets: number;
  readonly unrealised: number;
  readonly written: number;
  readonly realized: number;
  readonly facts: readonly CardFacts[];
  readonly gpuErrors: number;
  readonly note?: string;
}
interface Frozen {
  readonly paused: number;
  readonly renderedAfter: number;
}
interface Idle {
  readonly frames: number;
  readonly submits: number;
  readonly redraws: number;
  readonly rendered: number;
}
interface GroundVsIsland {
  readonly type: string;
  readonly ground: RGB;
  readonly own: RGB;
  readonly delta: number;
  /** The island texel the probe was taken at — flat and opaque, chosen near the centre. */
  readonly texel: readonly [number, number];
  /** Where on the ground canvas that texel landed, in device px. */
  readonly centre: readonly [number, number];
  readonly canvas: readonly [number, number];
  /** The card's destination was realised again after the camera move. */
  readonly realised: boolean;
}
interface Remount {
  readonly afterUnmount: ReturnType<typeof islandRendererCensus>;
  readonly afterRemount: ReturnType<typeof islandRendererCensus>;
  readonly islandGone: boolean;
  readonly renderedAgain: number;
  readonly texturedAgain: number;
  readonly gpuErrors: number;
}

interface AppRig {
  readonly ready: Promise<void>;
  mount(): Promise<Mounted>;
  board(): Promise<Board>;
  freeze(): Promise<Frozen>;
  /** The composited arm: a read of the card's own island texture. */
  captureIsland(type: string, arm: string): Promise<CaptureStats>;
  /** The control arm: THE SAME `Scene` object, rendered by a plain WebGL renderer. */
  captureControl(type: string, arm: string, withEnv: boolean): Promise<CaptureStats>;
  diff(a: string, b: string): DiffResult;
  groundVsIsland(type: string): Promise<GroundVsIsland>;
  idle(ms: number): Promise<Idle>;
  census(): ReturnType<typeof islandRendererCensus>;
  remountGl(): Promise<Remount>;
}

const frame = (): Promise<void> => new Promise<void>((r) => requestAnimationFrame(() => r()));
const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await frame();
};

/** Narrow-or-throw, hoisted above the boot IIFE that uses it. */
function must<T>(v: T | null | undefined, what: string): T {
  if (v === null || v === undefined) throw new Error(`rig: no ${what}`);
  return v;
}

function mountRig(): AppRig {
  let gpu: EngineGpu | undefined;
  let instrument: SubmitInstrument | undefined;
  let engine: CanvasEngine | undefined;
  let ground: GroundComposeHandle | null = null;
  let island: IslandRender | null = null;
  let bridge: GLBridge | null = null;
  /** The WebGL control arm, built once so two renders of one scene are bit-identical. */
  let control: { renderer: WebGLRenderer; env: Texture } | null = null;
  const rootEl = document.getElementById("root") as HTMLElement;
  const byType = new Map<string, Entity>();
  const widgetQ = defineQuery([PrefabId]);

  const ready = (async () => {
    gpu = await acquireCompositorDevice();
    instrument = instrumentSubmits(gpu.device);
    const ce = createDemoEngine(gpu);
    // Every rig page runs inside the Electron shell, so `hasDesktopBridge()` is
    // true and `createDemoEngine` left the seeding to a switchboard join this
    // one-window harness never makes. Seed the SHIPPING seed on a local doc.
    if (ce.docs.current() === undefined) {
      seedDemoScene(ce, ce.docs.create());
      ce.world.sync();
    }
    engine = ce;
    createRoot(rootEl).render(
      <StrictMode>
        <RigApp
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
        />
      </StrictMode>,
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
  const until = async (p: () => boolean, max = 600): Promise<boolean> => {
    for (let i = 0; i < max && !p(); i++) await frame();
    return p();
  };

  /** entity → PrefabId, rebuilt on demand (the seeds are spawned once and never move type). */
  const indexBoard = (): number => {
    byType.clear();
    const world = ce().world;
    let n = 0;
    world.query(widgetQ).each((b) => {
      for (const r of b) {
        const e = b.entity(r);
        const id = world.get(e, PrefabId)?.id;
        n += 1;
        if (typeof id === "string" && !byType.has(id)) byType.set(id, e);
      }
    });
    return n;
  };
  const entityOf = (type: string): Entity => must(byType.get(type), `a board entity of type ${type}`);

  /**
   * Put a card's centre at the viewport centre at zoom 1.
   *
   * Through `ce.ops`, never `world.setResource(Camera, …)`: the camera is a RUNTIME
   * resource with one sanctioned writer (`writeRuntimeResource`), and a bare
   * `setResource` from a rig leaves the drawn camera exactly where it was — which
   * reads downstream as "the ground drew the card in the wrong place".
   */
  const focus = async (e: Entity): Promise<void> => {
    const world = ce().world;
    const p = must(world.get(e, Position), "position");
    const sz = must(world.get(e, Size), "size");
    const vp = must(world.getResource(Viewport), "viewport");
    ce().ops.zoomTo(1);
    ce().ops.panTo(p.x + sz.w / 2 - vp.w / 2, p.y + sz.h / 2 - vp.h / 2);
    await frames(6);
  };

  /**
   * A card's WORLD point to device px on the ground canvas.
   *
   * `geometryOf().centre` is in WORLD units — the builder writes
   * `[pos.x + size.w / 2, …]` and the camera transform lives in the shader — so the
   * projection is the kernel's `(world − camera) × zoom`, then × dpr. A probe that
   * treats `centre` as a screen coordinate lands on the background and calls it a
   * compose bug, which is what it did before this comment existed.
   */
  const worldToDevice = (wx: number, wy: number): [number, number] => {
    const cam = must(ce().world.getResource(Camera), "camera");
    const d = dpr();
    return [(wx - cam.x) * cam.zoom * d, (wy - cam.y) * cam.zoom * d];
  };

  /**
   * The texel nearest the card's centre whose 5×5 neighbourhood is OPAQUE and flat.
   *
   * The gold knot's centre texel is a hole — transparent, where the ground correctly
   * shows the card's plate — so comparing RGB there compares nothing. And a modal
   * over 5 device px must have something uniform to be modal ABOUT, or resampling
   * decides the answer instead of the compose.
   */
  const flatOpaqueTexel = (cap: Capture): { x: number; y: number; rgb: RGB } | null => {
    const at = (x: number, y: number): readonly [number, number, number, number] => {
      const i = (y * cap.width + x) * 4;
      return [cap.data[i] as number, cap.data[i + 1] as number, cap.data[i + 2] as number, cap.data[i + 3] as number];
    };
    const flat = (x: number, y: number): RGB | null => {
      if (x < 4 || y < 4 || x >= cap.width - 4 || y >= cap.height - 4) return null;
      const c = at(x, y);
      if ((c[3] as number) < 250) return null;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const n = at(x + dx, y + dy);
          if ((n[3] as number) < 250) return null;
          for (let k = 0; k < 3; k++) if (Math.abs((n[k] as number) - (c[k] as number)) > 2) return null;
        }
      }
      return [c[0] as number, c[1] as number, c[2] as number];
    };
    const cx = cap.width >> 1;
    const cy = cap.height >> 1;
    const maxR = Math.max(cap.width, cap.height) >> 1;
    for (let r = 0; r < maxR; r += 2) {
      for (let a = 0; a < 16; a++) {
        const th = (a / 16) * Math.PI * 2;
        const x = Math.round(cx + Math.cos(th) * r);
        const y = Math.round(cy + Math.sin(th) * r);
        const rgb = flat(x, y);
        if (rgb !== null) return { x, y, rgb };
      }
    }
    return null;
  };

  /**
   * The control: the card's REAL island `Scene` and camera, rendered by a plain
   * WebGL three renderer. Not a description of the scene and not a clone — the
   * same object graph the composited arm just drew, so the only variable left is
   * the backend. The environment is swapped for the control renderer's OWN PMREM:
   * a PMREM texture lives on the GPU of the renderer that made it, so the
   * composited arm's is empty here (the 2026-07-19 black-metals field bug).
   */
  const ensureControl = (): { renderer: WebGLRenderer; env: Texture } => {
    if (control === null) {
      const renderer = new WebGLRenderer({ antialias: false, alpha: true });
      renderer.setPixelRatio(1);
      const pmrem = new PMREMGenerator(renderer);
      const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
      control = { renderer, env };
    }
    return control;
  };

  const controlCapture = (e: Entity, width: number, height: number, withEnv: boolean): Capture => {
    const { renderer, env } = ensureControl();
    const handle = must(must(bridge, "gl bridge").islandFor(e), "an island handle for the card");
    const scene = handle.scene;
    const prevEnv = scene.environment;
    scene.environment = withEnv ? env : null;
    renderer.setSize(width, height, false);
    const rt = new WebGLRenderTarget(width, height, { samples: 4, depthBuffer: true, stencilBuffer: false });
    rt.texture.colorSpace = SRGBColorSpace;
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    try {
      renderer.render(scene, handle.camera);
      const raw = new Uint8Array(width * height * 4);
      renderer.readRenderTargetPixels(rt, 0, 0, width, height, raw);
      return { width, height, data: flipRows(new Uint8ClampedArray(raw.buffer.slice(0)), width, height) };
    } finally {
      renderer.setRenderTarget(null);
      rt.dispose();
      scene.environment = prevEnv;
    }
  };

  /**
   * Every GL card's demand, written by hand. A rig SETUP write, outside the tick —
   * the kind behaviour's own request, made from here. Five of the seven cards
   * animate, and a moving scene cannot be graded against a control that renders the
   * SAME `Scene` object: the two arms agree only while nothing advances it.
   */
  const setDemand = async (mode: "paused" | "live"): Promise<number> => {
    const world = ce().world;
    let n = 0;
    for (const type of GL_TYPES) {
      const e = byType.get(type);
      if (e === undefined) continue;
      world.edit(e).set(RequestedDemand, {
        mode,
        fpsBucket: mode === "paused" ? 0 : 60,
        interactive: false,
      });
      n += 1;
    }
    world.sync();
    await until(
      () =>
        GL_TYPES.every((t) => {
          const e = byType.get(t);
          return e === undefined || world.get(e, SurfaceDemand)?.mode === mode;
        }),
      180,
    );
    return n;
  };

  return {
    ready,

    async mount() {
      await ready;
      await until(() => (ground?.compose.available() ?? false) && redraws() > 0);
      // The env generator runs inside the Canvas's first commit; give it a beat.
      await until(() => envGeneratorBackend() !== null, 300);
      return {
        profile: compositedProfile.name,
        // the ground's own and the never-presenting island Canvas — never the L1 source canvas B4 mounts
        canvases: rootEl.querySelectorAll("canvas:not([data-ice-source-canvas])").length,
        available: ground?.compose.available() ?? false,
        redraws: redraws(),
        envBackend: envGeneratorBackend(),
        gpuErrors: gpu?.errors().length ?? 0,
      };
    },

    async board() {
      const world = ce().world;
      const seeded = indexBoard();
      const present = GL_TYPES.filter((t) => byType.has(t));
      // Frame the whole board so every card is mounted and equipped, then wait
      // for the island half: seven renders, seven realised handles.
      ce().ops.frameContent();
      await frames(6);
      const ok = await until(
        () => (island?.stats().rendered ?? 0) >= present.length && compose().stats().textured >= present.length,
      );
      await frames(6);
      const facts: CardFacts[] = [];
      for (const type of GL_TYPES) {
        const e = byType.get(type);
        if (e === undefined) {
          facts.push({
            type,
            found: false,
            handle: 0,
            mode: "-",
            srgb: false,
            targetSize: [-1, -1],
            textureSize: [-1, -1],
            worldSize: [-1, -1],
            rasterScale: -1,
          });
          continue;
        }
        const handle = handleOf(e);
        const target = isl().targetOf(handle);
        const texture = compose().residency.textureOf(handle);
        const size = world.get(e, Size);
        const content = compose().residency.contentOf(e);
        facts.push({
          type,
          found: true,
          handle,
          mode: content.mode,
          srgb: content.mode === "own" && content.srgb,
          targetSize: [target?.width ?? -1, target?.height ?? -1] as const,
          textureSize: [texture?.width ?? -1, texture?.height ?? -1] as const,
          worldSize: [size?.w ?? -1, size?.h ?? -1] as const,
          // dpr × the card's band — an INFORMATION line, not a claim: Residency sizes a
          // destination from `geometry().rasterSize`, so the number moves with the zoom.
          rasterScale: size !== undefined && size.w > 0 ? (target?.width ?? 0) / size.w : -1,
        });
      }
      const s = compose().stats();
      const st = isl().stats();
      return {
        seeded,
        glCards: present.length,
        cards: s.cards,
        textured: s.textured,
        rendered: st.rendered,
        targets: st.targets,
        unrealised: st.unrealised,
        written: compose().residency.stats().written,
        realized: compose().residency.stats().realized,
        facts,
        gpuErrors: gpu?.errors().length ?? 0,
        ...(ok ? {} : { note: "not every GL card reached a textured card" }),
      };
    },

    /**
     * PAUSE every island's demand. Five of the seven cards animate, and a moving
     * scene cannot be graded: the control renders the SAME Scene object, so the
     * two arms agree only while nothing advances it. `RequestedDemand` is a rig
     * SETUP write, outside the tick — the kind behaviour's own request, by hand.
     */
    async freeze() {
      const paused = await setDemand("paused");
      await frames(8);
      const before = isl().stats().rendered;
      await frames(30);
      return { paused, renderedAfter: isl().stats().rendered - before };
    },

    async captureIsland(type, arm) {
      const e = entityOf(type);
      const texture = compose().residency.textureOf(handleOf(e));
      const cap = await readTexture(must(gpu, "gpu").device, must(texture, `a realised texture for ${type}`));
      const id = `A${++captureSeq}`;
      captures.set(id, cap);
      return statsOf(id, type, arm, cap);
    },

    async captureControl(type, arm, withEnv) {
      const e = entityOf(type);
      const target = must(isl().targetOf(handleOf(e)), `an island target for ${type}`);
      const cap = controlCapture(e, target.width, target.height, withEnv);
      const id = `B${++captureSeq}`;
      captures.set(id, cap);
      return statsOf(id, type, arm, cap);
    },

    diff(a, b) {
      return diffCaptures(must(captures.get(a), `capture ${a}`), must(captures.get(b), `capture ${b}`));
    },

    async groundVsIsland(type) {
      const e = entityOf(type);
      // THE CAMERA MOVE COMES OFF THE FREEZE. Residency sizes a destination from the
      // card's band, so a zoom change re-mints its handle — and a fresh destination is
      // EMPTY until something renders it. A paused card renders nothing (the clamp is
      // read before the phase machine's freshness), so probing a frozen board after a
      // zoom reads the card's PLATE and calls it a compose bug. Thaw, move, let the
      // island land on the new handle, freeze again, then read.
      await setDemand("live");
      await focus(e);
      const ok = await until(() => compose().residency.textureOf(handleOf(e)) !== undefined, 240);
      await frames(6);
      await setDemand("paused");
      await frames(6);
      const cap = await readTexture(
        must(gpu, "gpu").device,
        must(compose().residency.textureOf(handleOf(e)), "texture"),
      );
      const spot = must(flatOpaqueTexel(cap), `a flat opaque texel in ${type}'s island texture`);
      // texel → the card's world box → the ground's device px.
      const pos = must(ce().world.get(e, Position), "position");
      const sz = must(ce().world.get(e, Size), "size");
      const probe = worldToDevice(
        pos.x + ((spot.x + 0.5) / cap.width) * sz.w,
        pos.y + ((spot.y + 0.5) / cap.height) * sz.h,
      );
      const img = await groundReadback(compose().canvas);
      const ground0 = modal(img, probe[0], probe[1]);
      const delta = Math.max(...spot.rgb.map((v, k) => Math.abs(v - (ground0[k] as number))));
      return {
        type,
        ground: ground0,
        own: spot.rgb,
        delta,
        texel: [spot.x, spot.y] as const,
        centre: probe,
        canvas: [compose().canvas.width, compose().canvas.height] as const,
        realised: ok,
      };
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

    census: () => islandRendererCensus(),

    async remountGl() {
      // Off the freeze first: a paused card renders nothing, so a remount that had to
      // prove the board draws again would prove nothing.
      await setDemand("live");
      must(setGlMountedExternal, "the rig's GL mount switch")(false);
      // The lease defers its disposal by a task so StrictMode's cleanup-then-remount
      // cannot kill a live renderer; a REAL unmount must therefore be waited out.
      await frames(6);
      await new Promise<void>((r) => setTimeout(r, 60));
      const afterUnmount = islandRendererCensus();
      const islandGone = island === null;
      must(setGlMountedExternal, "the rig's GL mount switch")(true);
      await frames(6);
      const present = GL_TYPES.filter((t) => byType.has(t)).length;
      // The new IslandRender's counter starts at zero — this is the SECOND mount's own
      // renders, not the process's.
      await until(() => (island?.stats().rendered ?? 0) >= present, 400);
      await frames(8);
      return {
        afterUnmount,
        afterRemount: islandRendererCensus(),
        islandGone,
        renderedAgain: island?.stats().rendered ?? 0,
        texturedAgain: compose().stats().textured,
        gpuErrors: gpu?.errors().length ?? 0,
      };
    },
  };
}

declare global {
  interface Window {
    __c0Rig?: AppRig;
  }
}
window.__c0Rig = mountRig();
