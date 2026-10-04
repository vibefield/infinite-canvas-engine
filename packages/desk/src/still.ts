// THE STILL (petition I30 — a kind author's pixel proof through the published door; VibeField's DK-7 conformance harness, its
// playground's `--still`, its plugin template's still test): ONE frame of a desk on the caller's device, drawn into a readable
// texture and read back — no canvas, no swap chain, no host. The desk's own oracle pattern (one still of a kind on a bare mat,
// through Dawn in Node — the `webgpu` package — or a browser's device, held to a golden of its own), reached through
// `@vibecook/ice/desk` alone (design-016 K-L1: a plugin and its tooling import nothing of ICE but what the SDK re-exports).
//
// Two halves:
//  - THE HOST-LESS DESK (`createStillDesk`): the cutting mat from the GENERATED shader text (`shaderText(MAT_SHADER_FILES)` —
//    no file read, Node and a browser alike; the .wgsl files on disk are the same bytes, `gen:check`), the slot set over the
//    kinds (`createSlotSet` — each kind's pass in an error scope of its own, petition I24), the desk's own blue noise, the pool
//    a live inside spawns from. The Node oracle draws its 116 stills on this desk (oracle/frame.mjs `createOracleDesk`), so its
//    goldens pin the desk every still is drawn on.
//  - THE WORLD and its frame (`createStill`): core's engine over the given object types, its document open, laid by `stage`
//    through the doors a desk layer's handle has — durable spawns (`engine.ops.spawnWidget`), a kind's asset for a still
//    (`pinAsset` — the desk clock's pinned hour) and a lift held (`pinFlux`) — then the desk's own builder makes the frame from
//    it (the records, the live insides) under the still's camera, and `captureFrame` (petition I23's GPU half) draws it once
//    into `capture/still` through `encodeFrame` — the one encoding of a frame the swap chain, the capture door and the oracle
//    share — and reads it back.
// A still is its facts and its pins: no desk state (a kind is handed no `local`, as the oracle draws a plugin's kind), no
// chrome (no marks, no hand, no tray), the mat at rest (`STILL_MAT_FRAME`; no plate is uploaded — the gobo lights it whole).
// Everything made for it — the passes, the mat, the still, the readback, the engine and its document — is released before the
// promise settles, whatever it settles with.

import { Camera, type CanvasEngine, createCanvasEngine, type Entity, Viewport, type WidgetType, type World } from "@ice/core";
import { blueNoise } from "./assets/blue-noise.gen";
import { createDeskBuilder, type DeskBuilder } from "./compose/builder";
import { looksOf } from "./compose/reflector";
import { type CaptureBytes, captureFrame, createSlotSet, type GroundFrameInputs, type SlotSet, SlotPool } from "./ground";
import type { KindProgram } from "./kind";
import type { ObjectFlux, ObjectKind } from "./kinds/world";
import { DEFAULT_GRID } from "./mat/grid";
import { CuttingMat } from "./mat/mat-pass";
import { MAT_SHADER_FILES, matShaders } from "./mat/shaders";
import { objectKindOf } from "./object";
import { shaderText } from "./shaders";
import { MARKS, MAT, type Palette, type ThemeName, themeFrom } from "./theme";

// ---------------------------------------------------------------- the host-less desk

export interface StillDeskOptions {
  /** The caller's device — drawn with, never destroyed. */
  readonly device: GPUDevice;
  /** The colour target's format the passes are made for. */
  readonly format: GPUTextureFormat;
  /** The kinds' programs, the registry (names unique, strata known — `createSlotSet`'s rule). */
  readonly kinds: readonly KindProgram[];
  /** A GPU error the kinds' creation window caught that no kind raises alone (petition I24); absent: said on the console. */
  readonly onError?: (error: GPUError) => void;
}

/** The passes a still is drawn with: the mat, the root slot over the kinds, the pool a live inside spawns from. */
export interface StillDesk {
  readonly mat: CuttingMat;
  readonly root: SlotSet;
  readonly pool: SlotPool;
  /** The pool's slots, the card, every kind's root pass (a missing kind's face among them), the missing faces, the mat — `Ground.dispose`'s order. Idempotent. */
  dispose(): void;
}

/**
 * THE HOST-LESS DESK (petition I30): the mat made first — every kind's pass is made on it — from the generated shader text, then the
 * root slot over `kinds` (a kind refused at create is MISSING: `root.faults`), the desk's own blue noise (the plates are a host's),
 * and the pool. The Node oracle's desk and every `createStill`'s.
 */
export async function createStillDesk(opts: StillDeskOptions): Promise<StillDesk> {
  const mat = await CuttingMat.create(opts.device, opts.format, matShaders(shaderText(MAT_SHADER_FILES)));
  let root: SlotSet;
  try {
    root = await createSlotSet(opts.device, opts.format, mat, opts.kinds, opts.onError);
  } catch (err) {
    mat.dispose();
    throw err;
  }
  mat.setNoise(blueNoise());
  const pool = new SlotPool(root);
  let disposed = false;
  return {
    mat, root, pool,
    dispose() {
      if (disposed) return;
      disposed = true;
      pool.dispose();
      root.card?.dispose();
      for (const k of [...root.kinds.values()].reverse()) k.pass.dispose();
      root.missing?.dispose();
      mat.dispose();
    },
  };
}

// ---------------------------------------------------------------- the still

/** The formats a still is drawn in — the kinds' pipelines are made for it; the bytes come back RGBA either way. */
export type StillFormat = "rgba8unorm" | "bgra8unorm";
const FORMATS: readonly StillFormat[] = ["rgba8unorm", "bgra8unorm"];
const THEMES: readonly ThemeName[] = ["light", "dark"];

/**
 * The palette a still is drawn with when its caller names none: the desk's own tokens — the clear colour the mat's sage (the mat
 * covers it at rest), the selection the pencil (a still draws no marks). A kind's `theme(palette, name)` reads its look from the
 * palette, so a kind that needs roles of its own falls back to its own colours under this one (the desk clock's dials do) — or a
 * caller extends it (`{ ...STILL_PALETTE, clocks: … }`).
 */
export const STILL_PALETTE: Palette = { canvasBg: MAT.ground, select: MARKS.inks.pencil };

/** What `stage` is handed: the still's world and the two doors a desk layer's handle pins a still with. */
export interface StillStage {
  /**
   * The still's engine — core's `createCanvasEngine({ widgets: objects })`, its document open (`docs.create()`), its `Viewport` and
   * `Camera` the still's. Lay objects with its ops: `engine.ops.spawnWidget(type, { x, y, w?, h?, props?, parent?, undoable: false })`
   * (`x`, `y` the TOP-LEFT, world units; `w`, `h` the type's size when absent; `parent` a container's entity — its inside), any fact
   * with the rest (`ops.setWidgetProps`, …). A world unit is a CSS px at zoom 1.
   */
  readonly engine: CanvasEngine;
  /** `engine.world` — the facts a stage reads back. */
  readonly world: World;
  /**
   * A kind's ASSET on `e` for this still (`ObjectContext.asset`, in the shape the kind defines — `DeskLayerHandle.pinAsset`'s door):
   * the desk clock's `{ at }` stands its hands at a pinned hour, so a still never reads the wall clock. Kept by entity, met or not.
   */
  pinAsset(e: Entity, asset: unknown): void;
  /** `e`'s springs held for this still (`DeskLayerHandle.pinFlux`'s door): `{ lift: 1 }` draws it lifted, as a held object sits. */
  pinFlux(e: Entity, targets: Partial<Pick<ObjectFlux, "lift" | "hover">>): void;
}

export interface StillOptions {
  /** The caller's device — Dawn's in Node (`acquire({ gpu: create([]) })`, the `webgpu` package), a browser's — drawn with, never destroyed. */
  readonly device: GPUDevice;
  /** The still's texture format (the kinds' pipelines are made for it): `rgba8unorm` (the oracle's) or `bgra8unorm`. */
  readonly format: StillFormat;
  /** The view, CSS px. */
  readonly size: { readonly width: number; readonly height: number };
  /** Device px per CSS px: the still is `round(width × dpr)` × `round(height × dpr)` (`attachmentOf`'s rule). */
  readonly dpr: number;
  /**
   * The OBJECT TYPES the still's world holds — `defineObject`'s, a plugin's own: each one's kind is compiled on the still's desk (a
   * kind is named once whatever types share it), and only these types can be spawned. A type with no desk kind is refused at the call.
   */
  readonly objects: readonly WidgetType[];
  /** `light` (the Sun — the default) or `dark` (the Moon): the mat's light and the kinds' looks. */
  readonly theme?: ThemeName;
  /** The host's palette each kind's `theme()` reads its look from; `STILL_PALETTE` when absent. */
  readonly palette?: Palette;
  /**
   * The camera, ICE's (`Camera`: the world point at the still's top-left, and the zoom). Absent: the world's ORIGIN at the still's
   * centre, at zoom 1 — `{ x: −width / 2, y: −height / 2, zoom: 1 }` — so an object spawned about (0, 0) lies in the middle.
   */
  readonly camera?: { readonly x: number; readonly y: number; readonly zoom: number };
  /** Lay the still's world (a stage may be async); the frame is made from what it leaves. */
  readonly stage: (stage: StillStage) => void | Promise<void>;
}

/** One still: `width` × `height` device px, rows top-down and tightly packed, four bytes a pixel in RGBA order, alpha as drawn. */
export interface Still {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array<ArrayBuffer>;
  /**
   * Release the still. Idempotent. A still holds nothing on the device: every texture, buffer and pass `createStill` made — and
   * its engine and document — is released before its promise settles, so the memory ledger (`instrumentMemory`) reads what it
   * read before the call even before this is called; it is the still's one door for a release, kept for the petition's shape.
   */
  dispose(): void;
}

/** A positive finite number, or a throw naming it. */
const positive = (what: string, v: number): number => {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) throw new Error(`createStill: ${what} must be a positive finite number (got ${String(v)})`);
  return v;
};
/** A finite number, or a throw naming it. */
const finite = (what: string, v: number): number => {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`createStill: ${what} must be a finite number (got ${String(v)})`);
  return v;
};

/** The kinds behind the still's object types, each named once; a type with none is the caller's error. */
function kindsOf(objects: readonly WidgetType[]): ObjectKind[] {
  const byName = new Map<string, ObjectKind>();
  for (const t of objects) {
    const k = objectKindOf(t);
    if (k === undefined) throw new Error(`createStill: "${t.type}" is not a desk object — a still draws object types (\`defineObject\`)`);
    if (!byName.has(k.name)) byName.set(k.name, k);
  }
  return [...byName.values()];
}

/** The error filters a still's frame is drawn under (the oracle's probe's three). */
const SCOPES: readonly GPUErrorFilter[] = ["validation", "out-of-memory", "internal"];
/** A device with error scopes — every WebGPU device; a unit's stub may have none (its frame is then not watched). */
const watched = (device: GPUDevice): boolean => typeof (device as { pushErrorScope?: unknown }).pushErrorScope === "function";
const pushScopes = (device: GPUDevice): void => { if (watched(device)) for (const f of SCOPES) device.pushErrorScope(f); };
/** The three popped at once (no await between them): the first error any held. */
const popScopes = (device: GPUDevice): Promise<GPUError | null> =>
  watched(device) ? Promise.all(SCOPES.map(() => device.popErrorScope())).then((errors) => errors.find((e) => e !== null) ?? null) : Promise.resolve(null);
const gpuError = (e: GPUError): string => `${e.constructor?.name ?? "GPUError"}: ${e.message}`;

/**
 * Stills on ONE device are drawn one at a time: each makes its kinds' passes inside error scopes of its own (petition I24's window)
 * and draws its frame inside three more, and two at once would take each other's. A caller may ask for several together.
 */
const queues = new WeakMap<GPUDevice, Promise<unknown>>();
function inTurn<T>(device: GPUDevice, run: () => Promise<T>): Promise<T> {
  const turn = (queues.get(device) ?? Promise.resolve()).then(run);
  queues.set(device, turn.then(() => undefined, () => undefined));
  return turn;
}

/**
 * ONE STILL of a desk on the caller's device (petition I30) — `opts.stage` lays the world, the desk's builder makes the frame from
 * it under the still's camera, and the frame is drawn into a readable texture of `size × dpr` and read back as RGBA. A malformed
 * option throws at the call; the promise rejects — with everything made for it released — when a kind is refused at create (its
 * reason, petition I24), a GPU error is raised while the kinds are made or the frame is drawn, the stage or a kind's world half
 * throws, or the device is lost before the bytes are read.
 */
export function createStill(opts: StillOptions): Promise<Still> {
  if (typeof opts !== "object" || opts === null) throw new Error("createStill: options are required");
  if (typeof opts.device !== "object" || opts.device === null) throw new Error("createStill: `device` is required — the caller's GPUDevice");
  if (!FORMATS.includes(opts.format)) throw new Error(`createStill: format must be ${FORMATS.map((f) => `"${f}"`).join(" or ")} (got ${String(opts.format)})`);
  const width = positive("size.width", opts.size?.width);
  const height = positive("size.height", opts.size?.height);
  const dpr = positive("dpr", opts.dpr);
  if (!Array.isArray(opts.objects)) throw new Error("createStill: `objects` must be a list of object types (`defineObject`)");
  const kinds = kindsOf(opts.objects);
  const theme = opts.theme ?? "light";
  if (!THEMES.includes(theme)) throw new Error(`createStill: theme must be "light" or "dark" (got ${String(theme)})`);
  const cam = opts.camera === undefined
    ? { x: -width / 2, y: -height / 2, zoom: 1 }
    : { x: finite("camera.x", opts.camera.x), y: finite("camera.y", opts.camera.y), zoom: positive("camera.zoom", opts.camera.zoom) };
  if (typeof opts.stage !== "function") throw new Error("createStill: `stage` must be a function — it lays the still's world");
  const plan: StillPlan = { width, height, dpr, kinds, theme, palette: opts.palette ?? STILL_PALETTE, cam };
  return inTurn(opts.device, () => drawStill(opts, plan));
}

interface StillPlan {
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly kinds: readonly ObjectKind[];
  readonly theme: ThemeName;
  readonly palette: Palette;
  readonly cam: { readonly x: number; readonly y: number; readonly zoom: number };
}

async function drawStill(opts: StillOptions, plan: StillPlan): Promise<Still> {
  const { device, format } = opts;
  const { width, height, dpr, cam } = plan;
  let unattributed: GPUError | null = null;
  const desk = await createStillDesk({ device, format, kinds: plan.kinds, onError: (e) => { unattributed ??= e; } });
  let engine: CanvasEngine | undefined;
  let builder: DeskBuilder | undefined;
  try {
    // a kind that could not be made draws nothing of its own: a still of it is no proof of it
    const refused = desk.root.faults?.[0];
    if (refused !== undefined) throw new Error(`createStill: the kind "${refused.kind}" was ${refused.reason}`);
    if (unattributed !== null) throw new Error(`createStill: a GPU error while the kinds were made, no kind's alone — ${gpuError(unattributed)}`);
    const theme = themeFrom(plan.theme, plan.palette);
    const looks = looksOf(plan.kinds, plan.palette, theme);
    // the world: the object types registered, a document open, the still's viewport and camera (after the document — opening one
    // re-seeds the facade's resources)
    engine = createCanvasEngine({ widgets: [...opts.objects] });
    engine.docs.create();
    const world = engine.world;
    world.setResource(Viewport, { w: width, h: height, dpr });
    world.setResource(Camera, { x: cam.x, y: cam.y, zoom: cam.zoom, gesturing: false });
    // the builder first: a pin made by the stage is kept by entity, met or not
    const b = createDeskBuilder(world, { objects: [...opts.objects] });
    builder = b;
    await opts.stage({ engine, world, pinAsset: (e, asset) => b.pin(e, asset), pinFlux: (e, targets) => b.pinFlux(e, targets) });
    // two ticks: what the stage spawned is in the frame's membership and the change journal (a container's children with it)
    engine.step(16);
    engine.step(32);
    b.changed();
    const built = b.build(cam, { width, height, dpr }, 0, theme, DEFAULT_GRID, looks, { now: 0 });
    // the frame as the desk's reflector assembles it, less its chrome: the root desk, its live insides, a flight's departed desk
    const inputs: GroundFrameInputs = {
      view: { camX: cam.x, camY: cam.y, zoom: cam.zoom, width, height, dpr },
      grid: built.grid,
      objects: built.objects,
      ...(built.portals.length > 0 ? { portals: built.portals } : {}),
      ...(built.lodZoom !== undefined ? { lodZoom: built.lodZoom } : {}),
      ...(built.present !== undefined ? { present: built.present } : {}),
      ...(built.light !== undefined ? { light: built.light } : {}),
      ...(built.outgoing !== undefined ? { outgoing: built.outgoing } : {}),
      theme,
    };
    const passes = { root: desk.root, pool: desk.pool, grid: built.grid, marks: null, hold: null, tray: null, traySlots: null };
    pushScopes(device);
    let shot: CaptureBytes | undefined;
    let threw: { readonly err: unknown } | null = null;
    try {
      shot = await captureFrame(device, passes, format, inputs, { stamp: null, stats: null, copies: 0 });
    } catch (err) {
      threw = { err };
    }
    const raised = await popScopes(device);
    if (threw !== null) throw threw.err;
    if (raised !== null) throw new Error(`createStill: a GPU error while the still was drawn — ${gpuError(raised)}`);
    if (shot === undefined) throw new Error("createStill: the device was lost before the still was read back");
    const rgba = shot.bytes;
    // the texture's channel order turned to RGBA (a `bgra8unorm` still's blue and red swap); alpha as drawn
    if (format === "bgra8unorm") {
      for (let i = 0; i < rgba.length; i += 4) {
        const blue = rgba[i] as number;
        rgba[i] = rgba[i + 2] as number;
        rgba[i + 2] = blue;
      }
    }
    return { width: shot.width, height: shot.height, rgba, dispose() {} };
  } finally {
    builder?.dispose();
    engine?.dispose();
    desk.dispose();
  }
}
