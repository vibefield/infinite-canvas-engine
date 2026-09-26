// The DESK LAYER — what a host mounts (design-015 §3, plan D-D0.6; D2a-world): `deskLayer(opts)`
// returns a factory structurally assignable to `@ice/react`'s `GroundLayerFactory`, so
// `<InfiniteCanvas ground={deskLayer({ … })} chrome={false}>` mounts the desk exactly as it mounted
// the ground, until D5 turns the host into `<Desk>` by deletion. This is the host half — the one
// module beside host/surface.ts that may touch the DOM: it inserts its canvas before the content
// plane (the ground slot's place), acquires its OWN device (`navigator.gpu`, or the `gpu` handed in),
// installs the submit instrument before anything can submit, makes the swap chain, compiles the
// ground from the app's object kinds (`Ground.create` — `available()` is false until it resolves),
// reads the OS's reduced-motion preference into the ambient, and hands the DOM-free reflector
// (compose/reflector.ts) what it needs: a `ground()` slot, a canvas sizer. It registers ONE
// reflector, sets the interaction stack's pick source (`framePick.current`) over the kinds' mirrors
// and clears it at dispose, and registers the `ground` transition plane so a nav flight can prepare.
//
// The parity hooks live on the HANDLE, never in durable props (the brief's pinned detail):
// `pinMat` (the clocks, the plate, the gobo's opacity, the wind), `pinRaster` (a committed ink
// raster on one note), `clearRasters`, `setPlate` / `setNoise` / `setGlyphs` (the product never
// fed the mat before — the render map's finding #2; the blue noise is the desk's own, the plates
// are the app's generated ones), `configureMat` (the rulers as the app's mat config). Instruments:
// `submits()`, `stats()`, `wakes()`, `geometryOf`, `fluxOf`, `lastInputs`.

import type { Entity, FramePickSlot, GridConfig as CoreGridConfig, PresentationTransitionAdapter, ReflectorDef, WidgetType, World } from "@ice/core";
import { type Ambient, type AmbientMode, type AmbientPin, createAmbient } from "../compose/ambient";
import { createDeskBuilder, type DeskBuilder } from "../compose/builder";
import { createPickSource } from "../compose/pick";
import { createDeskReflector, type DeskReflector, type DeskReflectorStats, type DeskWakes } from "../compose/reflector";
import { acquire } from "../engine/device";
import { Ground, type GroundFrameInputs } from "../ground";
import type { KindProgram } from "../kind";
import type { ObjectFlux, ObjectKind } from "../kinds/world";
import { DEFAULT_GRID, type GridConfig } from "../mat/grid";
import type { GlyphAtlasMeta, MatConfig, PlateName } from "../mat/layout";
import { MAT_SHADER_FILES, matShaders } from "../mat/shaders";
import { objectKindOf } from "../object";
import { blueNoise } from "../assets/blue-noise.gen";
import { PAPER_KIND, type PaperKind } from "../kinds/paper";
import { shaderText } from "../shaders";
import { instrumentSubmits, type SubmitInstrument } from "../submit-instrument";
import type { GroundTheme, Palette } from "../theme";
import { surface } from "./surface";

export interface DeskLayerOptions {
  /** The theme in force at the mount (the app's `themeFrom(name, palette)`). */
  readonly theme: GroundTheme;
  /** The app's palette — what each kind's `theme()` reads its look from (`PaperPalette`, `MiniMatPalette`). */
  readonly palette: Palette;
  /**
   * The OBJECT widget types this desk draws, beyond the engine catalog's own: their kinds are registered
   * with the ground and join the builder's journal. The catalog's object types are always included.
   */
  readonly objects?: readonly WidgetType[];
  /** Render-only kinds to register beside the objects' (a program with no world half yet). */
  readonly kinds?: readonly KindProgram[];
  /** The ambient policy (design-015 §4.6): `idle` by default. */
  readonly ambient?: AmbientMode;
  /** How long after the last touch the wind blows, ms (20 000). */
  readonly ambientIdleMs?: number;
  /** The root's grid at the mount: the mat's config (its gobo, its rulers) and the lattice's fade-in. */
  readonly grid?: GridConfig;
  /** The device pixel ratio the canvas is capped at (2). */
  readonly maxDpr?: number;
  /** `navigator.gpu` unless a host hands another. */
  readonly gpu?: GPU;
  /** Called once with the layer's OWN device, before anything submits — after the submit instrument is installed. */
  readonly onDevice?: (device: GPUDevice) => void;
  /** The layer's name in the reflector roster. */
  readonly name?: string;
}

/** The pinned still a parity scene states: the clocks, the plate and the gobo's opacity, the wind (0 = a still). */
export interface MatPin extends AmbientPin {
  readonly plate?: PlateName;
  readonly opacity?: number;
  readonly wind?: number;
}

export interface DeskLayerStatus { readonly state: "pending" | "ready" | "failed"; readonly message?: string }

/** The mount context — the fields of react's `GroundLayerFactory` context this layer reads, mirrored structurally (react never imports the desk). */
export interface DeskLayerContext {
  readonly host: { readonly container: HTMLElement; readonly contentPlane: HTMLElement };
  readonly world: World;
  readonly framePick?: FramePickSlot;
  readonly transitions?: { register(adapter: PresentationTransitionAdapter): () => void };
  readonly catalog?: { widgetTypes(): readonly WidgetType[] };
}

export interface DeskLayerHandle {
  /** The drawing reflector — the facade registers it right after the plane transform, where the ground layer has always gone. */
  readonly reflector: ReflectorDef & { available(): boolean };
  /** The react `grid` prop's re-tune (the old ground's magnet grid): the desk keeps only its fade-in. */
  configureGrid(cfg: Partial<CoreGridConfig>): void;
  dispose(): void;
  /** The canvas in the ground slot. */
  readonly canvas: HTMLCanvasElement;
  /** The device is acquired and `Ground.create` resolved. */
  available(): boolean;
  status(): DeskLayerStatus;
  /** The layer's OWN device once acquired. */
  device(): GPUDevice | undefined;
  /** The ground once made (a rig's door to a pass: `ground()?.pass("paper")`). */
  ground(): Ground | null;
  /** The theme changed (and, with it, the palette): the looks are remade, the next frame re-renders. */
  setTheme(theme: GroundTheme, palette?: Palette): void;
  /** The mat's config over the current one (the rulers, the gobo): the root's grid. */
  configureMat(mat: Partial<MatConfig>): void;
  /** The lattice's fade-in window. */
  configureFadeIn(fadeIn: GridConfig["fadeIn"]): void;
  /** A 512² rgba8 plate into slot `c` or `b` — the app's generated plates (never the study's). */
  setPlate(name: PlateName, bytes: Uint8Array<ArrayBuffer>): void;
  /** The 128² blue-noise tile; the desk's own is uploaded at the mount. */
  setNoise(bytes: Uint8Array<ArrayBuffer>): void;
  /** The rulers' and the mini mats' glyph atlas (RULER.md). */
  setGlyphs(bytes: Uint8Array<ArrayBuffer>, meta: GlyphAtlasMeta): void;
  /** Pin the mat for a still (a parity scene): the clocks, the plate, the gobo's opacity; `wind` > 0 unpins the clocks. `null` unpins everything. */
  pinMat(pin: MatPin | null): void;
  /** Pin a committed ink raster on a note (r8 rows, `w × h`): allocated in the paper pass's pages in call order. Returns false when the pages are full or the pass is not here. */
  pinRaster(entity: Entity, bytes: Uint8Array<ArrayBuffer>, meta: { readonly w: number; readonly h: number }): boolean;
  /** Every raster forgotten and the pages carved afresh (a scene reload — the oracle's `reset(true)`). */
  clearRasters(): void;
  /** Pin an object's spring targets for a still (a scene's `held` = `{ lift: 1 }`, never a `Grab`); `undefined` unpins. */
  pinFlux(entity: Entity, targets: Partial<Pick<ObjectFlux, "lift" | "hover" | "ring">> | undefined): void;
  /** Every flux pin lifted. */
  clearFlux(): void;
  /** The ambient policy, live: the mode, the idle window. */
  setAmbient(mode: AmbientMode, idleMs?: number): void;
  ambient(): Ambient;
  /** The submit instrument on the layer's device (installed before anything submits); undefined before the device. */
  submits(): SubmitInstrument | undefined;
  redraws(): number;
  stats(): DeskReflectorStats;
  wakes(): DeskWakes;
  geometryOf(e: Entity): unknown | undefined;
  fluxOf(e: Entity): ObjectFlux | undefined;
  lastInputs(): GroundFrameInputs | null;
  /** The frame dirty and not yet drawn (a rig's settle witness). */
  dirty(): boolean;
  readonly builder: DeskBuilder;
  /**
   * The DOM-free reflector behind `reflector` — named `desk`, never `compose`: react's
   * `GroundLayerHandle.compose?` is the ground's COMPOSE handle (the composited profile reads its
   * `sourceCanvas` seam off it, infinite-canvas.tsx), and the desk is not one. The slot stays absent.
   */
  readonly desk: DeskReflector;
}

export type DeskLayerFactory = (ctx: DeskLayerContext) => DeskLayerHandle;

/** The object kinds behind widget types, deduplicated by name. */
function kindsOf(types: readonly WidgetType[], extra: readonly KindProgram[]): { kinds: KindProgram[]; objectKinds: ObjectKind[] } {
  const byName = new Map<string, KindProgram>();
  const objectKinds: ObjectKind[] = [];
  for (const t of types) {
    const k = objectKindOf(t);
    if (k === undefined || byName.has(k.name)) continue;
    byName.set(k.name, k);
    objectKinds.push(k);
  }
  for (const k of extra) if (!byName.has(k.name)) byName.set(k.name, k);
  return { kinds: [...byName.values()], objectKinds };
}

export function deskLayer(opts: DeskLayerOptions): DeskLayerFactory {
  return (ctx) => {
    const { host, world } = ctx;
    const doc = host.container.ownerDocument;
    const view = doc.defaultView;
    // the OBJECT types: the catalog's, plus the app's — their kinds are the ground's registry
    const types = new Set<WidgetType>([...(ctx.catalog?.widgetTypes() ?? []).filter((t) => t.surface === "object"), ...(opts.objects ?? [])]);
    const { kinds, objectKinds } = kindsOf([...types], opts.kinds ?? []);
    const canvas = doc.createElement("canvas");
    canvas.style.position = "absolute";
    canvas.style.left = "0";
    canvas.style.top = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    canvas.style.pointerEvents = "none";   // the router owns picking; the canvas is never a DOM hit target
    host.container.insertBefore(canvas, host.contentPlane);

    let ground: Ground | null = null;
    let ownDevice: GPUDevice | null = null;
    let instrument: SubmitInstrument | undefined;
    let status: DeskLayerStatus = { state: "pending" };
    let disposed = false;
    let ended = false;
    let grid: GridConfig = opts.grid ?? DEFAULT_GRID;
    const rasters = new Map<Entity, { readonly layer: number; readonly x: number; readonly y: number; readonly w: number; readonly h: number }>();

    // reduced motion ⇒ still (design-015 §4.6), read from the OS at the mount and followed live
    const motionQuery = view?.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
    const ambient = createAmbient({
      ...(opts.ambient !== undefined ? { mode: opts.ambient } : {}),
      ...(opts.ambientIdleMs !== undefined ? { idleMs: opts.ambientIdleMs } : {}),
      reducedMotion: motionQuery?.matches === true,
    });
    const syncMotion = (): void => { ambient.configure({ reducedMotion: motionQuery?.matches === true }); compose.wake("ambient"); };
    motionQuery?.addEventListener("change", syncMotion);

    const builder = createDeskBuilder(world, { objects: [...types] });
    const compose = createDeskReflector({
      world, builder, kinds: objectKinds, ambient,
      ground: () => ground,
      attach: { resize: (w, h) => { if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; } } },
      theme: opts.theme, palette: opts.palette, grid,
      ...(opts.maxDpr !== undefined ? { maxDpr: opts.maxDpr } : {}),
      ...(opts.name !== undefined ? { name: opts.name } : {}),
    });

    // the pick source (design-015 §4.5): the kinds' mirrors on the builder's geometry — set now, `undefined` for what it cannot see yet (B9)
    const pick = createPickSource(builder);
    const framePick = ctx.framePick;
    if (framePick !== undefined) framePick.current = pick;
    // the ground plane's transition adapter: prepared the moment it is asked — the desk's second slot is built from the world (D2b)
    const detachTransition = ctx.transitions?.register({ id: "@ice/desk", plane: "ground", prepare: () => null }) ?? null;

    const fail = (what: string, e: unknown): void => {
      status = { state: "failed", message: `${what}: ${e instanceof Error ? e.message : String(e)}` };
      console.error(`[ice] desk: ${what}`, e);
    };
    /** The layer is over (a lost device): nothing renders again, the canvas leaves, `available()` is false. */
    const endLayer = (): void => {
      if (ended) return;
      ended = true;
      const g = ground;
      ground = null;
      g?.dispose();
      canvas.remove();
    };
    const gpu = opts.gpu ?? (typeof navigator !== "undefined" ? navigator.gpu : undefined);
    const boot: Promise<void> = gpu === undefined
      ? Promise.reject(new Error("WebGPU is unavailable here (no navigator.gpu)"))
      : acquire({
          gpu,
          label: "desk",
          onLost: (info) => { if (disposed || ended) return; fail("the device was lost", new Error(`${info.reason}: ${info.message}`)); endLayer(); },
          onError: (error) => { console.error("[ice] desk: uncaptured GPU error", error.message); },
        }).then(async (g) => {
          if (disposed) { g.device.destroy(); throw new Error("disposed before the device arrived"); }
          ownDevice = g.device;
          instrument = instrumentSubmits(g.device);   // before anything can submit: the idle-zero witness counts from boot
          opts.onDevice?.(g.device);
          const made = await Ground.create({ device: g.device, surface: surface(g.device, canvas), mat: matShaders(shaderText(MAT_SHADER_FILES)), kinds });
          if (disposed || ended) { made.dispose(); return; }
          made.mat.setNoise(blueNoise());   // the desk's own noise; the plates are the app's (`setPlate`)
          made.grid = grid;
          ground = made;
          status = { state: "ready" };
          compose.ready();
        });
    boot.catch((e: unknown) => { if (!disposed) fail("no desk — the adapter, the device or the pipelines were refused", e); });

    const paperPass = (): PaperKind["pass"] | undefined => (ground?.pass(PAPER_KIND) as PaperKind | undefined)?.pass;
    const setGrid = (next: GridConfig): void => { grid = next; if (ground !== null) ground.grid = next; compose.configureGrid(next); };

    return {
      reflector: compose.reflector,
      configureGrid(cfg) { if (cfg.fadeIn !== undefined) setGrid({ ...grid, fadeIn: [cfg.fadeIn[0], cfg.fadeIn[1]] }); },
      canvas,
      available: () => ground !== null && status.state === "ready",
      status: () => status,
      device: () => ownDevice ?? undefined,
      ground: () => ground,
      setTheme: (t, p) => compose.setTheme(t, p),
      configureMat: (mat) => setGrid({ ...grid, mat: { ...grid.mat, ...mat, ...(mat.gobo !== undefined ? { gobo: { ...grid.mat.gobo, ...mat.gobo } } : {}), ...(mat.ruler !== undefined ? { ruler: { ...grid.mat.ruler, ...mat.ruler } } : {}) } }),
      configureFadeIn: (fadeIn) => setGrid({ ...grid, fadeIn }),
      setPlate(name, bytes) { ground?.mat.setPlate(name, bytes); compose.wake("pin"); },
      setNoise(bytes) { ground?.mat.setNoise(bytes); compose.wake("pin"); },
      setGlyphs(bytes, meta) { ground?.mat.setGlyphs(bytes, meta); compose.wake("pin"); },
      pinMat(pin) {
        if (pin === null) { ambient.pin(null); compose.wake("pin"); return; }
        const still = (pin.wind ?? 0) <= 0;
        ambient.pin(still ? { ...(pin.time !== undefined ? { time: pin.time } : {}), ...(pin.goboTime !== undefined ? { goboTime: pin.goboTime } : {}), ...(pin.noise !== undefined ? { noise: pin.noise } : {}) } : null);
        if (pin.plate !== undefined || pin.opacity !== undefined) {
          setGrid({ ...grid, mat: { ...grid.mat, gobo: { ...grid.mat.gobo, ...(pin.plate !== undefined ? { plate: pin.plate } : {}), ...(pin.opacity !== undefined ? { opacity: pin.opacity } : {}) } } });
        }
        compose.wake("pin");
      },
      pinRaster(entity, bytes, meta) {
        const pass = paperPass();
        if (pass === undefined) return false;
        const old = rasters.get(entity);
        if (old !== undefined) pass.free(old);
        const rect = pass.alloc(meta.w, meta.h);
        if (rect === null) { rasters.delete(entity); builder.pin(entity, undefined); compose.wake("pin"); return false; }
        const uv = pass.write(rect, bytes);
        rasters.set(entity, rect);
        builder.pin(entity, { layer: rect.layer, uv });
        compose.wake("pin");
        return true;
      },
      clearRasters() {
        for (const e of rasters.keys()) builder.pin(e, undefined);
        rasters.clear();
        paperPass()?.reset(true);
        compose.wake("pin");
      },
      pinFlux(entity, targets) { builder.pinFlux(entity, targets); compose.wake("pin"); },
      clearFlux() { builder.clearFlux(); compose.wake("pin"); },
      setAmbient(mode, idleMs) { ambient.configure({ mode, ...(idleMs !== undefined ? { idleMs } : {}) }); compose.wake("ambient"); },
      ambient: () => ambient,
      submits: () => instrument,
      redraws: () => compose.redraws(),
      stats: () => compose.stats(),
      wakes: () => compose.wakes(),
      geometryOf: (e) => builder.geometryOf(e),
      fluxOf: (e) => builder.fluxOf(e),
      lastInputs: () => compose.lastInputs(),
      dirty: () => compose.dirty(),
      builder,
      desk: compose,
      dispose() {
        disposed = true;
        motionQuery?.removeEventListener("change", syncMotion);
        if (framePick !== undefined && framePick.current === pick) framePick.current = null;
        detachTransition?.();
        compose.dispose();
        builder.dispose();
        canvas.remove();
        ground?.dispose();
        ground = null;
        if (ownDevice !== null) { ownDevice.destroy(); ownDevice = null; }   // the layer's own device: destroyed last
      },
    };
  };
}
