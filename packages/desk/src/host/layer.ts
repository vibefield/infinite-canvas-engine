// The DESK LAYER — what a host mounts (design-015 §3, plan D-D0.6; D2a-world): `deskLayer(opts)`
// returns a factory structurally assignable to `@ice/dom`'s `LayerFactory` (D5b: `createDeskHost`,
// wrapped by `@ice/react`'s `<Desk layer={deskLayer({ … })}>`, mounts the desk exactly as
// `<InfiniteCanvas ground={…}>` mounted the ground until D5 turned the host into `<Desk>` by
// deletion). This is the host half — the one module beside host/surface.ts that may touch the DOM:
// it prepends its canvas to the container, draws with the ENGINE's device when the context carries one (D7: one device
// per engine) and otherwise acquires its OWN (`navigator.gpu`, or the `gpu` handed in),
// makes the swap chain (the submit instrument waits to be asked for — K2), compiles the
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
//
// The TEXT (D2c, design-015 §6.1): each object kind's own state on this desk (`kind.local(host)` —
// the note's WRITING, over the root paper pass's pages and the app's text raster, `opts.text`) is made
// here and threaded through the builder; the ONE focused editor (host/editor.ts) sits in the
// container and writes through the note's typing session (objects/typing.ts) into `opts.docs`. The
// drawing reflector is wrapped, not changed: before it, every kind's local is ticked on ONE clock
// (`performance.now()` — the rAF clock lags wall time headless) and may wake an `ink` frame (a wipe,
// a blink, a face landing); after it, the editor follows the drawn note. A committed raster is
// pinned through the writing, so a note that leaves the desk gives its rect back (the page-slot leak).
//
// And the desk's chrome (D4a): the ground is made with the marks pass, the builder reads the interaction
// stack's marquee preview through the context's `readMarquee`, and the handle's `selection` is the one
// source a screen-space selection menu is placed from — the marks' box around the selection as drawn,
// published after every frame it changed.

import { Camera, type Entity, type FramePickSlot, type HeldPoseSlot, type HeldPoseSource, HeldTool, type MarqueeBuffer, type NavFace, type NavGeometrySlot, NavTransition, type PresentationTransitionAdapter, type ReflectorDef, Viewport, type WidgetType, type World } from "@ice/core";
import { flightCamera } from "../nav/flight";
import { type Ambient, type AmbientMode, type AmbientPin, createAmbient } from "../compose/ambient";
import { createDeskBuilder, type DeskBuilder, type HeldBuild, type HoldPin, type SpatialSource } from "../compose/builder";
import { type BudgetStats, createRasterBudget } from "../engine/budget";
import type { RecordStoreStats } from "../engine/records";
import { HOLD_SHADER_FILES, holdShaders } from "../hold/shaders";
import { heldSlots, type SelectionAnchor } from "../compose/marks";
import { createPickSource } from "../compose/pick";
import { createDeskReflector, type DeskReflector, type DeskReflectorStats, type DeskWakes, looksOf } from "../compose/reflector";
import { acquire, adopt, type Gpu, type GpuOptions } from "../engine/device";
import { Ground, type GroundFrameInputs } from "../ground";
import type { KindProgram } from "../kind";
import type { ObjectFlux, ObjectKind } from "../kinds/world";
import { DEFAULT_GRID, type GridConfig } from "../mat/grid";
import type { GlyphAtlasMeta, MatConfig, PlateName } from "../mat/layout";
import { MAT_SHADER_FILES, matShaders } from "../mat/shaders";
import { MARKS_SHADER_FILES, marksShaders } from "../marks/shaders";
import { driversOf, objectKindOf } from "../object";
import type { ObjectSprings } from "../springs";
import { blueNoise } from "../assets/blue-noise.gen";
import type { PaperWriting } from "../kinds/paper";
import type { KindDriver, KindLocal } from "../kinds/world";
import { worldChildren } from "../compose/children";
import type { BlobStore } from "../photo/blobs";
import { decodePicture } from "./picture";
import { NO_DOCS, type TypingDocs } from "../docs";
import type { TextRaster } from "../paper/raster";
import { createNoteEditor, type NoteEditor } from "./editor";
import { printRaster } from "./print";
import { createCalendarInput } from "./calendar-input";
import type { InsideView } from "../minimat/inside";
import { shaderText } from "../shaders";
import { instrumentMemory, type MemoryLedger } from "../gpu-memory";
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
  /** The objects' springs (springs.ts `SPRINGS`): the builder reads these numbers every frame, so a host that keeps the object may tune them live (the dev panel — D5a). */
  readonly springs?: ObjectSprings;
  /** The device pixel ratio the canvas is capped at (2). */
  readonly maxDpr?: number;
  /** Where the layer acquires its OWN device when the engine has none (`engine.compositorDevice` — then it draws with that): `navigator.gpu` unless a host hands another. */
  readonly gpu?: GPU;
  /** Called once with the layer's OWN device, before anything submits. */
  readonly onDevice?: (device: GPUDevice) => void;
  /** The layer's name in the reflector roster. */
  readonly name?: string;
  /** The app's text raster (`inkRaster({ faces: penFaces({ … }) })`, D2c): absent, no note is written live — the pinned rasters only. */
  readonly text?: TextRaster;
  /** The document a note's typing session commits into — the facade's `engine.docs` (D2c); absent, typing stays runtime-only. */
  readonly docs?: TypingDocs;
  /** A typing session ends after this long without input, ms (1000). */
  readonly idleMs?: number;
  /** The app's byte store (D3w, D-D12): a print's picture by the hash its `blob` prop names; absent, prints draw their paper alone. */
  readonly blobs?: BlobStore;
  /**
   * THE RASTER BUDGET (D6, design-015 §11.4), bytes: what every kind's raster caches may hold together — a board's ink (its strokes
   * are the truth; evicted, it replays when next drawn), a notebook page's CPU raster, the calendar's tiles. The least recently used
   * off-screen raster goes first. Default 192 MB.
   */
  readonly rasterBudget?: number;
  /**
   * Keep the device's LIVE GPU MEMORY by label from the boot on (gpu-memory.ts, design-016 §4 — the profiler's memory table): a
   * map entry per texture or buffer MADE, nothing per frame. Off by default (D-K2.2): a resource made before the ledger cannot be
   * found after it (WebGPU has no enumeration), so it is the one instrument a host decides on at the mount.
   */
  readonly gpuLedger?: boolean;
}

/** The raster budget a host does not size: 192 MB — about ten whiteboards' ink at the law's density, the notebook's eight page rasters and the calendar's tiles beside them. */
export const DEFAULT_RASTER_BUDGET = 192 * 1024 * 1024;

/** The pinned still a parity scene states: the clocks, the plate and the gobo's opacity, the wind (0 = a still). */
export interface MatPin extends AmbientPin {
  readonly plate?: PlateName;
  readonly opacity?: number;
  readonly wind?: number;
}

/**
 * The layer's honest state: `pending` until the device and the pipelines are here; `ready`; `degraded` — the device reported an error
 * nobody captured (out of memory, a validation or an internal error): the desk still draws what it can, but a frame — or every frame,
 * an attachment left invalid — may be lost, and the state never reads `ready` again on its own (D7); `failed` — no desk (refused, or
 * the device lost). `message` names the cause.
 */
export interface DeskLayerStatus { readonly state: "pending" | "ready" | "degraded" | "failed"; readonly message?: string }

/** The mount context — the fields of `@ice/dom`'s `LayerContext` this layer reads, mirrored structurally (dom never imports the desk). */
export interface DeskLayerContext {
  readonly host: { readonly container: HTMLElement };
  readonly world: World;
  readonly framePick?: FramePickSlot;
  /** The nav geometry seam (design-015 §9, D2b): the desk sets its word on its containers' drawn faces here, clears it at dispose. */
  readonly navGeometry?: NavGeometrySlot;
  /** The held pose seam (design-015 §8, D4b): the desk publishes where the object in hand is ON SCREEN as it drew it; core's held input maps every pointer through it. */
  readonly heldPose?: HeldPoseSlot;
  readonly transitions?: { register(adapter: PresentationTransitionAdapter): () => void };
  readonly catalog?: { widgetTypes(): readonly WidgetType[] };
  /** The interaction stack's marquee preview (`stack.marqueeBuffer`, out of the ECS): the vellum the marks draw (D4a). */
  readonly readMarquee?: () => MarqueeBuffer;
  /** The engine's spatial index (`stack.index`; design-015 §2.5, D6): the cull's broad phase. Absent, every member is tested. */
  readonly spatial?: SpatialSource;
  /** The engine's device (`engine.compositorDevice`, D7): the layer draws with it and never acquires its own — ONE device per engine. */
  readonly gpu?: { readonly adapter: GPUAdapter; readonly device: GPUDevice };
}

/** The selection menu's source (D4a): the marks' anchor as of the last frame, and a subscription that fires when it changes. */
export interface SelectionSource {
  anchor(): SelectionAnchor;
  subscribe(listener: () => void): () => void;
}

/** A note's writing as a still states it for the far LOD (kinds/paper.ts `PaperWriting`): the text's left edge, its em, each line's baseline and width, note units. */
export type GreekPin = PaperWriting;

/**
 * The desk's MAIN-THREAD time (D6): every flush of the layer's reflector — the kinds' ticks, the pull, the build and the
 * render when a frame is due — counted and timed since the mount; `frames` are the flushes that drew, `frameMs` their share.
 * At rest a tick that draws nothing must cost next to nothing (design-015 §11.4: ≤ 0.1 ms of main thread per second).
 */
export interface DeskLayerPerf {
  readonly ticks: number;
  readonly ms: number;
  readonly frames: number;
  readonly frameMs: number;
}

export interface DeskLayerHandle {
  /** The drawing reflector — the facade registers it right after the plane transform, where the ground layer has always gone. */
  readonly reflector: ReflectorDef & { available(): boolean };
  dispose(): void;
  /** The canvas in the ground slot. */
  readonly canvas: HTMLCanvasElement;
  /** The device is acquired and `Ground.create` resolved. */
  available(): boolean;
  status(): DeskLayerStatus;
  /** The device the layer draws with once it is here — the engine's when the context carries one (D7: one device per engine), else the layer's own. */
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
  /** Pin a note's writing lines for its far-LOD chip (a still states them; the live text's layout is D2c's); `undefined` unpins. */
  pinGreek(entity: Entity, writing: GreekPin | undefined): void;
  /** Pin an object's spring targets for a still (a scene's `held` = `{ lift: 1 }`, never a `Grab`); `undefined` unpins. */
  pinFlux(entity: Entity, targets: Partial<Pick<ObjectFlux, "lift" | "hover">> | undefined): void;
  /** Every flux pin lifted. */
  clearFlux(): void;
  /** Live insides on or off (the oracle's `portals: false` — every face draws its far LOD alone). */
  setPortals(on: boolean): void;
  /**
   * A kind's LAW, live (D5a — the dev panel's door): every object of `kind` resolves under `law` from the next build and the
   * root's pass (its slots after it) draws with it; a kind with no live law ignores it. The host owns the law it hands in.
   */
  tuneLaw(kind: string, law: unknown): void;
  /** Pin the root's dressing (the oracle's `lodZoom`); `null` unpins. */
  pinLodZoom(zoom: number | null): void;
  /** Hold every spring and ghost where it is — a still of a moving frame (a rig's flight pin). */
  freeze(on: boolean): void;
  /** Hold the re-dressing ramp at its start (the prototype harness's `redressPinned`). */
  holdRedress(on: boolean): void;
  /** THE HAND PINNED for a still (D4b): the carry amount at `e`, the kind's open motion snapped; `null` unpins. The object itself is picked up through `ops.open`. */
  pinHold(pin: HoldPin | null): void;
  /** The object in hand as of the last frame (D4b) — a rig's witness: its carry, its frame on screen, whether settled or flying home. */
  hand(): HeldBuild | undefined;
  /** THE SEAM's answer for a container under the camera (the live one unless given) — a rig's witness (`DeskBuilder.navFace`). */
  navFace(entity: Entity, cam?: { readonly x: number; readonly y: number; readonly zoom: number }): NavFace | undefined;
  /** The last build's view of a container's inside (a rig's witness). */
  insideViewOf(entity: Entity): InsideView | undefined;
  /**
   * The camera of the flight on now at progress `p` (the prototype's `flightAt`: the endpoints c0 and c1 themselves,
   * `flightCamera` between) — what a rig's flight pin writes each tick; `undefined` when no flight drives.
   */
  flightCameraAt(p: number): { readonly x: number; readonly y: number; readonly zoom: number } | undefined;
  /** The ambient policy, live: the mode, the idle window. */
  setAmbient(mode: AmbientMode, idleMs?: number): void;
  ambient(): Ambient;
  /** The submit instrument on the layer's device — installed the first time it is asked for (K2, D-K2.1: never asked, the queue carries no wrapper), counting from then; undefined before the device. */
  submits(): SubmitInstrument | undefined;
  /** The layer's own main-thread time since the mount (D6, design-015 §11.4's idle gate): a rig diffs two readings. */
  perf(): DeskLayerPerf;
  /** The raster budget's ledger (D6): what the kinds' caches hold, by owner, against the cap; the evictions so far. */
  memory(): BudgetStats;
  /** The device's live GPU memory by label (K2) — kept only under `gpuLedger: true`, from the boot; undefined otherwise or before the device. */
  gpuMemory(): MemoryLedger | undefined;
  /** The kinds' persistent record stores' counters by kind (D6, design-015 §4.3) — the root passes'; a rig diffs two readings. */
  records(): Readonly<Record<string, RecordStoreStats>>;
  redraws(): number;
  stats(): DeskReflectorStats;
  wakes(): DeskWakes;
  geometryOf(e: Entity): unknown | undefined;
  fluxOf(e: Entity): ObjectFlux | undefined;
  lastInputs(): GroundFrameInputs | null;
  /** The frame dirty and not yet drawn, or a kind still moving on its own (a print in the air — D3w): a rig's settle witness. */
  dirty(): boolean;
  readonly builder: DeskBuilder;
  /** A kind's own state on this desk by kind name (D3w: a print's body, a book's or a pad's pinned pose) — `undefined` when it keeps none. */
  local(name: string): KindLocal | undefined;
  /** The one focused editor (D2c) — `undefined` when no note kind is registered. */
  editor(): NoteEditor | undefined;
  /**
   * A kind's DRIVER on this desk by object type (D-D7-A.3) — what the object declared in `defineObject` (the note's typing, the
   * board's pen, the notebook's hand, the print's carry, the calendar's writing + hand + DOM half), or undefined. A rig casts to
   * the kind's own driver type (`PaperDriver`, `CalendarDriver`); the desk itself never names one.
   */
  driver(type: string): KindDriver | undefined;
  /** Where the selection menu goes (D4a): the marks' box around the selection, published after each frame it moved. */
  readonly selection: SelectionSource;
  /**
   * The DOM-free reflector behind `reflector` — named `desk`, never `compose`: react's retired
   * `GroundLayerHandle.compose?` was the ground's COMPOSE handle (the composited profile read its
   * `sourceCanvas` seam off it, until D5b), and the desk was never one. The slot stays absent.
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
    const types = new Set<WidgetType>([...(ctx.catalog?.widgetTypes() ?? []).filter((t) => t.object !== undefined), ...(opts.objects ?? [])]);
    const { kinds, objectKinds } = kindsOf([...types], opts.kinds ?? []);
    // every kind's look from the palette BEFORE the mount touches the page (D7): an incomplete palette throws HERE, leaving no canvas,
    // no listener, no builder behind (the reflector remakes the looks it keeps; this pass only proves they can be made)
    looksOf(objectKinds, opts.palette, opts.theme);
    const canvas = doc.createElement("canvas");
    canvas.style.position = "absolute";
    canvas.style.left = "0";
    canvas.style.top = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    canvas.style.pointerEvents = "none";   // the router owns picking; the canvas is never a DOM hit target
    host.container.prepend(canvas);   // the container's first child: everything screen-space paints over it

    let ground: Ground | null = null;
    let ownDevice: GPUDevice | null = null;
    let drawDevice: GPUDevice | null = null;   // the device the layer draws with: its own, or the engine's (D7)
    let instrument: SubmitInstrument | undefined;
    let ledger: MemoryLedger | undefined;
    let status: DeskLayerStatus = { state: "pending" };
    let disposed = false;
    let ended = false;
    let grid: GridConfig = opts.grid ?? DEFAULT_GRID;

    // reduced motion ⇒ still (design-015 §4.6), read from the OS at the mount and followed live
    const motionQuery = view?.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
    const ambient = createAmbient({
      ...(opts.ambient !== undefined ? { mode: opts.ambient } : {}),
      ...(opts.ambientIdleMs !== undefined ? { idleMs: opts.ambientIdleMs } : {}),
      reducedMotion: motionQuery?.matches === true,
    });
    const syncMotion = (): void => { ambient.configure({ reducedMotion: motionQuery?.matches === true }); compose.wake("ambient"); };

    // each kind's own state on this desk (the note's writing): made once, over its root pass once the ground is here — and told what
    // the builder DRAWS (D6, `KindHost.drawn`: the builder is made after the locals, so the word is bound late)
    const locals = new Map<string, KindLocal>();
    const children = worldChildren(world);   // …and its DATA children (D3w): the host reads them, never the kind
    const print = opts.text !== undefined ? printRaster({ text: opts.text }) : undefined;   // the calendar's print, in the note's hand (D3t-c)
    const drawn = (e: Entity): number | undefined => builder.rankOf(e);   // `builder` is made just below; the word is only asked at a tick
    // THE RASTER BUDGET (D6): one ledger for every kind's raster caches; trimmed once a tick by each kind's word on what is on screen
    const budget = createRasterBudget(opts.rasterBudget ?? DEFAULT_RASTER_BUDGET);
    for (const k of objectKinds) {
      const local = k.local?.({ pass: () => ground?.pass(k.name), text: opts.text, children, blobs: opts.blobs, decode: decodePicture, print, drawn, budget });
      if (local !== undefined) locals.set(k.name, local);
    }
    const keeps = (owner: string, key: string): boolean => locals.get(owner)?.keeps?.(key) ?? false;
    const readMarquee = ctx.readMarquee;
    const builder = createDeskBuilder(world, { objects: [...types], locals, ...(opts.springs !== undefined ? { springs: opts.springs } : {}), ...(readMarquee !== undefined ? { marquee: readMarquee } : {}), ...(ctx.spatial !== undefined ? { spatial: ctx.spatial } : {}) });
    // the selection menu's source: the anchor published whenever a frame moved it — the marks' word, and the hand's (D4b: with an
    // object in hand the menu travels to the foot and becomes the held bar; it hides while the object flies home). D3t-a: the kind's
    // tools as the bar's slots (their swatches from the kind's look) and the mode in hand — core's `HeldTool`, the one slot marked
    const anchorOf = (): SelectionAnchor => {
      const a = builder.anchor();
      const h = builder.hand();
      if (h === undefined) return a;
      const kind = builder.kindOf(h.entity);
      const swatches = kind?.open?.swatches?.(compose.look(kind.name)) ?? {};
      const active = world.isAlive(h.entity) ? (world.get(h.entity, HeldTool)?.id ?? "") : "";
      return { ...a, held: { tools: heldSlots(kind?.open?.tools ?? [], swatches), active, landing: h.landing, settled: h.settled } };
    };
    const listeners = new Set<() => void>();
    let published = "";
    const publish = (): void => {
      const a = anchorOf();
      const key = JSON.stringify(a);
      if (key === published) return;
      published = key;
      for (const l of [...listeners]) l();
    };
    const compose = createDeskReflector({
      onFrame: publish,
      world, builder, kinds: objectKinds, ambient,
      ground: () => ground,
      attach: { resize: (w, h) => { if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; } } },
      theme: opts.theme, palette: opts.palette, grid,
      ...(opts.maxDpr !== undefined ? { maxDpr: opts.maxDpr } : {}),
      ...(opts.name !== undefined ? { name: opts.name } : {}),
    });
    motionQuery?.addEventListener("change", syncMotion);   // armed once `compose` exists (D7: never a listener over a binding in its TDZ)

    // THE KINDS' DRIVERS (D7 #5, D-D7-A.3): each object declared its own in `defineObject` — a pen, a carry, a leaf, the calendar's
    // writing and hand, the note's typing — and the host makes them here from what it lends, never naming a kind; a third-party
    // openable kind with held tools gets its driver the same way. Ticked before the kinds' clocks; idle ones skipped (D7 #14)
    const docs: TypingDocs = opts.docs ?? NO_DOCS;
    const drivers = new Map<string, KindDriver>();
    const kindNamed = (name: string): ((e: Entity) => boolean) | undefined => (objectKinds.some((k) => k.name === name) ? (e) => builder.kindOf(e)?.name === name : undefined);
    for (const t of types) {
      const make = driversOf(t);
      const k = objectKindOf(t);
      if (make === undefined || k === undefined) continue;
      const d = make({
        world, docs, local: locals.get(k.name), look: () => compose.look(k.name), isKind: (e) => builder.kindOf(e)?.name === k.name, kind: kindNamed,
        geometryOf: (e) => builder.geometryOf(e), heldToWorld: (e, x, y) => builder.heldToWorld(e, x, y), hand: () => builder.hand(),
        refused: (e) => builder.meetTape(e), wake: () => compose.wake("ink"),
      });
      if (d !== undefined) drivers.set(t.type, d);
    }
    const driver = (type: string): KindDriver | undefined => drivers.get(type);
    // the ONE focused editor, in the container (screen space) — the note's DOM half (D2c); the calendar's DOM half is lent it (D3t-c)
    const editor = createNoteEditor({
      container: host.container, world, driver, geometryOf: (e) => builder.geometryOf(e), wake: () => compose.wake("ink"),
      ...(opts.idleMs !== undefined ? { idleMs: opts.idleMs } : {}),
    });
    if (editor !== undefined) {
      createCalendarInput({
        container: host.container, world, driver, editor, docs, geometryOf: (e) => builder.geometryOf(e), hand: () => builder.hand(),
        heldToWorld: (e, x, y) => builder.heldToWorld(e, x, y), look: (kind) => compose.look(kind), wake: () => compose.wake("ink"),
      });
    }
    // the drawing reflector, wrapped: the kinds' flux ticked before it on one clock, the editor placed after it
    let moving = false;
    const perf = { ticks: 0, ms: 0, frames: 0, frameMs: 0 };
    const inner = compose.reflector;
    const reflector: ReflectorDef & { available(): boolean } = {
      ...inner,
      flush(w) {
        const now = performance.now();
        const drawn = compose.redraws();
        for (const d of drivers.values()) if (d.idle?.() !== true) d.follow(now);
        let want = false;
        // the kinds whose own state moved (D6): their records are remade this build; the rest stand — told every tick, an empty
        // set included (no word at all would make the builder ask every object whether a kind lifts it)
        const restless = new Set<string>();
        for (const [name, local] of locals) if (local.tick?.(now) === true) { want = true; restless.add(name); }
        if (want) compose.wake("ink");
        compose.restless(restless);
        moving = want;   // D3w: a kind's own motion (a print in the air) keeps the desk from reading quiet between its frames
        inner.flush(w);
        editor?.follow();
        budget.trim(keeps);   // over the cap: the least recently used off-screen rasters go (O(1) when under it)
        // the desk's own main-thread time (D6): this flush, and whether it drew
        const spent = performance.now() - now;
        perf.ticks += 1; perf.ms += spent;
        if (compose.redraws() !== drawn) { perf.frames += 1; perf.frameMs += spent; }
      },
    };

    // the pick source (design-015 §4.5): the kinds' mirrors on the builder's geometry — set now, `undefined` for what it cannot see yet (B9)
    const pick = createPickSource(builder, { moving: () => moving });
    const framePick = ctx.framePick;
    if (framePick !== undefined) framePick.current = pick;
    // the nav geometry seam (design-015 §9): the desk's word on its containers' faces AS DRAWN — core's nav, the zoom-through and the
    // drop-into read it; the cut is exact only on the face as drawn
    const navSource = { face: (container: Entity, cam: { readonly x: number; readonly y: number; readonly zoom: number }) => builder.navFace(container, cam) };
    const navGeometry = ctx.navGeometry;
    if (navGeometry !== undefined) navGeometry.current = navSource;
    // the held pose seam (design-015 §8, D4b): where the object in hand is on screen, as the last frame drew it — the frame the
    // builder made; nothing while it flies home (the desk is the desk's again)
    const poseSource: HeldPoseSource = {
      frame: (e) => { const h = builder.hand(); return h !== undefined && h.entity === e && !h.landing ? h.frame : undefined; },
      // …and which of the kind's parts is under a point of it (D3t-a): its `hit` on the geometry drawn in hand
      part: (e, x, y) => builder.heldPart(e, x, y),
    };
    const heldPose = ctx.heldPose;
    if (heldPose !== undefined) heldPose.current = poseSource;
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
    const events: Pick<GpuOptions, "onLost" | "onError"> = {
          onLost: (info) => { if (disposed || ended) return; fail("the device was lost", new Error(`${info.reason}: ${info.message}`)); endLayer(); },
          onError: (error) => {
            console.error("[ice] desk: uncaptured GPU error", error.message);
            // never silent: a lost submit leaves the desk black while nothing else says so (D7) — a failed layer stays failed
            if (status.state !== "failed") status = { state: "degraded", message: `an uncaptured GPU error — ${error.constructor?.name ?? "GPUError"}: ${error.message}` };
          },
    };
    // ONE device per engine (D7): the ENGINE's device when it has one — drawn with, never destroyed here (the app owns it);
    // otherwise the layer's own
    const shared = ctx.gpu;
    const device: Promise<Gpu> = shared !== undefined
      ? Promise.resolve(adopt(shared.adapter, shared.device, events))
      : gpu === undefined
        ? Promise.reject(new Error("WebGPU is unavailable here (no navigator.gpu)"))
        : acquire({ gpu, label: "desk", ...events });
    const boot: Promise<void> = device.then(async (g) => {
          if (disposed) { if (shared === undefined) g.device.destroy(); throw new Error("disposed before the device arrived"); }
          drawDevice = g.device;
          if (shared === undefined) ownDevice = g.device;
          if (opts.gpuLedger === true) ledger = instrumentMemory(g.device);   // before the ground makes anything
          opts.onDevice?.(g.device);
          const made = await Ground.create({ device: g.device, surface: surface(g.device, canvas), mat: matShaders(shaderText(MAT_SHADER_FILES)), kinds, marks: marksShaders(shaderText(MARKS_SHADER_FILES)), hold: holdShaders(shaderText(HOLD_SHADER_FILES)) });
          if (disposed || ended) { made.dispose(); return; }
          made.mat.setNoise(blueNoise());   // the desk's own noise; the plates are the app's (`setPlate`)
          made.grid = grid;
          ground = made;
          if (status.state === "pending") status = { state: "ready" };   // an error while it booted keeps its word
          compose.ready();
        });
    boot.catch((e: unknown) => { if (!disposed) fail("no desk — the adapter, the device or the pipelines were refused", e); });

    const setGrid = (next: GridConfig): void => { grid = next; if (ground !== null) ground.grid = next; compose.configureGrid(next); };

    return {
      reflector,
      canvas,
      available: () => ground !== null && (status.state === "ready" || status.state === "degraded"),
      status: () => status,
      device: () => drawDevice ?? undefined,
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
      pinGreek(entity, lines) {
        // the greeked lines alone ride the builder's asset (the committed raster lives in the note's writing since D2c)
        builder.pin(entity, lines === undefined ? undefined : { greek: lines });
        compose.wake("pin");
      },
      pinFlux(entity, targets) { builder.pinFlux(entity, targets); compose.wake("pin"); },
      clearFlux() { builder.clearFlux(); compose.wake("pin"); },
      pinHold: (pin) => compose.pinBuild({ hold: pin }),
      hand: () => builder.hand(),
      setPortals: (on) => compose.pinBuild({ portals: on }),
      tuneLaw(kind, law) {
        for (const t of types) { const k = objectKindOf(t); if (k?.name === kind) k.tune?.(law); }
        ground?.root.kinds.get(kind)?.pass.setLaw?.(law);
        builder.invalidate();   // every record was made under the old law (D6)
        compose.wake("pin");
      },
      pinLodZoom: (zoom) => compose.pinBuild({ lodZoom: zoom }),
      freeze: (on) => compose.pinBuild({ freeze: on }),
      holdRedress: (on) => compose.pinBuild({ holdRedress: on }),
      navFace(entity, cam) {
        const c = cam ?? world.getResource(Camera) ?? { x: 0, y: 0, zoom: 1 };
        return builder.navFace(entity, { x: c.x, y: c.y, zoom: c.zoom });
      },
      insideViewOf: (e) => builder.insideViewOf(e),
      flightCameraAt(p) {
        const t = world.getResource(NavTransition);
        const vp = world.getResource(Viewport);
        if (t === undefined || !t.active || vp === undefined) return undefined;
        const c0 = { x: t.c0x, y: t.c0y, zoom: t.c0z };
        const c1 = { x: t.c1x, y: t.c1y, zoom: t.c1z };
        return p <= 0 ? c0 : p >= 1 ? c1 : flightCamera(c0, c1, p, vp.w, vp.h);
      },
      setAmbient(mode, idleMs) { ambient.configure({ mode, ...(idleMs !== undefined ? { idleMs } : {}) }); compose.wake("ambient"); },
      ambient: () => ambient,
      submits() {
        // armed by the first ask (D-K2.1): a window's count needs it armed before the window opens, which asking does
        if (instrument === undefined && drawDevice !== null && !disposed) instrument = instrumentSubmits(drawDevice);
        return instrument;
      },
      perf: () => ({ ...perf }),
      memory: () => budget.stats(),
      gpuMemory: () => ledger,
      records: () => {
        const out: Record<string, RecordStoreStats> = {};
        for (const k of objectKinds) { const s = ground?.pass(k.name)?.records?.(); if (s !== undefined) out[k.name] = s; }
        return out;
      },
      redraws: () => compose.redraws(),
      stats: () => compose.stats(),
      wakes: () => compose.wakes(),
      geometryOf: (e) => builder.geometryOf(e),
      fluxOf: (e) => builder.fluxOf(e),
      lastInputs: () => compose.lastInputs(),
      dirty: () => compose.dirty() || moving,
      builder,
      local: (name) => locals.get(name),
      editor: () => editor,
      driver,
      selection: {
        anchor: () => anchorOf(),
        subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
      },
      desk: compose,
      dispose() {
        disposed = true;
        listeners.clear();
        for (const d of drivers.values()) d.dispose?.();   // the calendar's disposes its DOM half
        editor?.dispose();
        for (const local of locals.values()) local.dispose?.();
        motionQuery?.removeEventListener("change", syncMotion);
        if (framePick !== undefined && framePick.current === pick) framePick.current = null;
        if (navGeometry !== undefined && navGeometry.current === navSource) navGeometry.current = null;
        if (heldPose !== undefined && heldPose.current === poseSource) heldPose.current = null;
        detachTransition?.();
        compose.dispose();
        builder.dispose();
        canvas.remove();
        ground?.dispose();
        ground = null;
        instrument?.detach();   // the engine's device goes on without the layer's wrappers
        instrument = undefined;
        ledger?.detach();
        if (ownDevice !== null) { ownDevice.destroy(); ownDevice = null; }   // the layer's own device: destroyed last
      },
    };
  };
}
