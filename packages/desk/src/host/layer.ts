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
// `pinMat` (the clocks, the plate, the gobo's opacity, the wind), `pinAsset` (a kind's own asset on one
// object — a note's greeked writing; K8a: the kind's shape, never the desk's), `setPlate` / `setNoise` / `setGlyphs` (the product never
// fed the mat before — the render map's finding #2; the blue noise is the desk's own, the plates
// are the app's generated ones), `configureMat` (the rulers as the app's mat config). Instruments:
// `submits()`, `stats()`, `wakes()`, `geometryOf`, `fluxOf`, `lastInputs`.
//
// The TEXT (D2c, design-015 §6.1): each object kind's own state on this desk (`kind.local(host)` —
// the note's WRITING, over the root paper pass's pages and the app's text raster, `opts.text`) is made
// here and threaded through the builder; the ONE focused editor — the DESK's since K8a (host/editor.ts), made whatever kinds
// are registered — sits in the container and is LEASED by the text parts the objects declare (`defineObject({ host: { text } })`:
// the note's body writes through the note's typing session into `opts.docs`; the layer names no kind). The
// drawing reflector is wrapped, not changed: before it, every kind's local is ticked on ONE clock
// (`performance.now()` — the rAF clock lags wall time headless) and may wake an `ink` frame (a wipe,
// a blink, a face landing); after it, the editor follows the part it is lent to. A committed raster is
// pinned through the writing, so a note that leaves the desk gives its rect back (the page-slot leak).
//
// And the desk's chrome (D4a): the ground is made with the marks pass, the builder reads the interaction
// stack's marquee preview through the context's `readMarquee`, and the handle's `selection` is the one
// source a screen-space selection menu is placed from — the marks' box around the selection as drawn,
// published after every frame it changed.

import { Camera, closeTray, type Entity, focusTray, frameParent, heldEntity, InsertGhost, type FramePickSlot, type HeldPoseSlot, type HeldPoseSource, HeldTool, type MarqueeBuffer, type MenuActionDef, type NavFace, type NavGeometrySlot, NavTransition, NO_ENTITY, openTray, type PointPick, PrefabId, type PresentationTransitionAdapter, type ReflectorDef, scrollTray, selectedEntities, setTrayCategory, toggleTray, Tray, trayCategories, trayCategory, type TrayCategory, trayEntity, trayEntryCount, trayFocus, type TrayFocusMove, trayOpen, type TrayPoseSlot, type TrayPoseSource, type TrayScreenFrame, Viewport, type WidgetType, type World } from "@ice/core";
import { screenToWorld } from "@ice/kernel";
import { flightCamera } from "../nav/flight";
import { type Ambient, type AmbientMode, type AmbientPin, createAmbient } from "../compose/ambient";
import { createDeskBuilder, type DeskBuilder, type HeldBuild, type HoldPin, type SpatialSource } from "../compose/builder";
import { type BudgetStats, createRasterBudget } from "../engine/budget";
import { createRasterQueue, type RasterQueueStats } from "../engine/rasters";
import type { RecordStoreStats } from "../engine/records";
import { HOLD, type HoldOptions, type HoldReserves } from "../hold/pose";
import { HOLD_SHADER_FILES, holdShaders } from "../hold/shaders";
import { heldSlots, type SelectionAnchor, withKindActs } from "../compose/marks";
import { createPickSource } from "../compose/pick";
import { createDeskReflector, type DeskReflector, type DeskReflectorStats, type DeskWakes, looksOf } from "../compose/reflector";
import { acquire, adopt, type Gpu, type GpuOptions } from "../engine/device";
import { createKindFaults, KIND_MISSING, type KindFault } from "../faults";
import { type CaptureBytes, type CaptureOptions, checkCapture, Ground, type GroundFrameInputs } from "../ground";
import type { KindProgram } from "../kind";
import type { ObjectFlux, ObjectKind } from "../kinds/world";
import { DEFAULT_GRID, type GridConfig } from "../mat/grid";
import type { GlyphAtlasMeta, MatConfig, PlateName } from "../mat/layout";
import { MAT_SHADER_FILES, matShaders } from "../mat/shaders";
import { MARKS_SHADER_FILES, marksShaders } from "../marks/shaders";
import { driversOf, hostOf, objectKindOf } from "../object";
import type { ObjectSprings } from "../kit/springs";
import { blueNoise } from "../assets/blue-noise.gen";
import type { KindDriver, KindLocal, ObjectDomHost } from "../kinds/world";
import { worldChildren } from "../compose/children";
import { BLOB_STORE, type BlobStore, PICTURE_DECODER } from "../kit/blobs";
import { createServices, type Lent, service } from "../kit/services";
import { decodePicture } from "./picture";
import { NO_DOCS, type TypingDocs } from "../docs";
import { TEXT_RASTER, type TextRaster } from "../kit/raster";
import type { DeskEditor, TextPart } from "../kit/editor";
import { createDeskEditor } from "./editor";
import type { InsideView } from "../kit/inside";
import { shaderText } from "../shaders";
import { instrumentMemory, type MemoryLedger } from "../gpu-memory";
import { createGpuProfiler, type GpuProfiler } from "../gpu-profiler";
import { instrumentSubmits, type SubmitInstrument } from "../submit-instrument";
import type { GroundTheme, Palette } from "../theme";
import { surface } from "./surface";
import { DRAWER, type TrayOptions } from "../tray/drawer";
import type { TrayFluxState, TrayPin } from "../tray/flux";
import type { TrayLaid } from "../tray/pass";
import { trayShaders } from "../tray/shaders";

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
  /**
   * THE HAND as the host's chrome needs it (petition I20), read at the mount: the held object's reading fit keeps `top` CSS px under
   * the view's top (`HOLD.top`, 56 — a phone keeps `HOLD.topPhone`) and `band` above its foot (`HOLD.band`, 72 — the held bar's band),
   * and the held bar travels `travelMs` (M1; the bar is the host's — the anchor carries it, `HeldAnchor.travelMs`; absent, the bar's
   * own). Each a finite number ≥ 0; absent, `HOLD`'s.
   */
  readonly hold?: HoldOptions;
  /**
   * THE DRAWER as the host's chrome needs it (petition I21), read at the mount: its `foot` inset, CSS px (0) — the pegboard's laid
   * content ends this far above the board's bottom edge (the face's clip ends there, the veil lays the plain board over it and feathers
   * out over `DRAWER.fade` above it — the header's mirror), where a host's line floats over the board; the scroll's range grows by it,
   * so the last line is still reached; the board runs to its edge. A finite number ≥ 0; absent, 0.
   */
  readonly tray?: TrayOptions;
  /**
   * THE ROOM'S OTHER PEOPLE (petition I26), read at the mount: `false` — the host draws its peers itself (VibeField draws each by
   * face, from `usePresencePeers`), so the host the layer is mounted in (`@ice/dom`'s `createDeskHost`, `<Desk>`) mounts no remote
   * cursors — no plane, no reflector; the layer says so on its handle (`DeskLayerHandle.cursors`). The presence session,
   * `usePresencePeers` and the local OS and open-hand cursors are untouched. Absent or `true`, the host draws them, as ever.
   */
  readonly cursors?: boolean;
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
   * More SERVICES the host lends its kinds (K8a, kit/services.ts), each under its key — `service(KEY, value)` — beside the three it
   * lends by name (`text` → `TEXT_RASTER`, `blobs` → `BLOB_STORE`, and `PICTURE_DECODER`, the desk's own decode). A plugin kind
   * `use`s one by its key; a name lent twice (here, or by an object's DOM half) is a mount error.
   */
  readonly services?: readonly Lent[];
  /**
   * THE RASTER BUDGET (D6, design-015 §11.4), bytes: what every kind's raster caches may hold together — a board's ink (its strokes
   * are the truth; evicted, it replays when next drawn), a notebook page's CPU raster, the calendar's tiles. The least recently used
   * off-screen raster goes first. Default 192 MB.
   */
  readonly rasterBudget?: number;
  /**
   * THE FRAME'S RASTER BUDGET (K6b, design-016 §6), ms: what one frame spends making the rasters the kinds asked of the queue
   * (engine/rasters.ts — a note's ink at a new band, a board's strokes on coming on screen); the rest wait their turn, their old
   * raster standing. Default `RASTER_BUDGET_MS` (4).
   */
  readonly rasterMs?: number;
  /**
   * Keep the device's LIVE GPU MEMORY by label from the boot on (gpu-memory.ts, design-016 §4 — the profiler's memory table): a
   * map entry per texture or buffer MADE, nothing per frame. Off by default (D-K2.2): a resource made before the ledger cannot be
   * found after it (WebGPU has no enumeration), so it is the one instrument a host decides on at the mount.
   */
  readonly gpuLedger?: boolean;
}

/**
 * The raster budget a host does not size: 256 MB — D6's 192 (about ten whiteboards' ink at the law's density, the notebook's
 * eight page rasters and the calendar's tiles beside them) and 64 more since the PICTURES joined it (K6a, K-L4): their
 * thumbnail array (1.4 MB a picture, always kept) and the details a frame binds — each its print's chain from the finest level
 * it samples, so together at most about four texels a device pixel of the prints on screen (≈ 82 MB were prints to tile a
 * 2400 × 1600 screen), where before every picture's whole chain stood outside any budget.
 */
export const DEFAULT_RASTER_BUDGET = 256 * 1024 * 1024;

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
 *
 * `faults` (petition I24) — the KINDS this desk draws as MISSING, each its name and why, in the order they went: refused at create (a
 * pass that would not compile, a pipeline that failed validation) or quarantined at three strikes (a `resolve`, `record`, `chip`, `hit`,
 * `tick` or `due` that threw — src/faults.ts). Absent while none is. One kind's fault is that kind's: the state does not move for it
 * (`ready` stays `ready`), its objects wear the desk's missing face, nothing of it is called again. Each is said ONCE — the status
 * moves when a kind goes missing (`onStatus` hears it; a kind refused at the boot rides the boot's own `ready`), never again for it.
 */
export interface DeskLayerStatus { readonly state: "pending" | "ready" | "degraded" | "failed"; readonly message?: string; readonly faults?: readonly KindFault[] }

/** The mount context — the fields of `@ice/dom`'s `LayerContext` this layer reads, mirrored structurally (dom never imports the desk). */
export interface DeskLayerContext {
  readonly host: { readonly container: HTMLElement };
  readonly world: World;
  readonly framePick?: FramePickSlot;
  /**
   * The interaction stack's exact pick out of the tick (`stack.pickAt`, petition I27 — what a press at a screen point would touch now,
   * through `framePick` above): the handle's `pick` answers a host through it. Absent (a bare host), `pick` answers null.
   */
  readonly pickAt?: (sx: number, sy: number) => PointPick | undefined;
  /** The nav geometry seam (design-015 §9, D2b): the desk sets its word on its containers' drawn faces here, clears it at dispose. */
  readonly navGeometry?: NavGeometrySlot;
  /** The held pose seam (design-015 §8, D4b): the desk publishes where the object in hand is ON SCREEN as it drew it; core's held input maps every pointer through it. */
  readonly heldPose?: HeldPoseSlot;
  /** The tray pose seam (design-017 §4, K3): the desk publishes where the pegboard drawer is ON SCREEN as it drew it; core's tray input hit-tests through it. */
  readonly trayPose?: TrayPoseSlot;
  readonly transitions?: { register(adapter: PresentationTransitionAdapter): () => void };
  readonly catalog?: { widgetTypes(): readonly WidgetType[] };
  /** The interaction stack's marquee preview (`stack.marqueeBuffer`, out of the ECS): the vellum the marks draw (D4a). */
  readonly readMarquee?: () => MarqueeBuffer;
  /** The engine's spatial index (`stack.index`; design-015 §2.5, D6): the cull's broad phase. Absent, every member is tested. */
  readonly spatial?: SpatialSource;
  /** The engine's device (`engine.compositorDevice`, D7): the layer draws with it and never acquires its own — ONE device per engine. */
  readonly gpu?: { readonly adapter: GPUAdapter; readonly device: GPUDevice };
  /**
   * The engine's frame gate (K7a — the SLEEP, `@ice/core` frame-control.ts): the layer registers the desk's wake (when its reflector,
   * its kinds and its drivers are next due), wakes a sleeping loop for what arrives outside a step, and on a step a registered time
   * alone started (`settled`) asks only what is due. Absent (a headless host): every part is asked every step, as before.
   */
  readonly frame?: {
    wake(reason: string): void;
    wakeWhen(name: string, due: (now: number) => number): () => void;
    settled(): boolean;
  };
  /** The engine's ops the layer runs on its host's word (petition I37): the tray's keyboard lay. Absent (a bare host), `tray.lay` throws. */
  readonly ops?: { layFromTray(type: string, at: { readonly x: number; readonly y: number }): Entity | undefined };
}

/** The selection menu's source (D4a): the marks' anchor as of the last frame, and a subscription that fires when it changes. */
export interface SelectionSource {
  anchor(): SelectionAnchor;
  subscribe(listener: () => void): () => void;
}

/**
 * The object under a screen point as the desk's own pick resolves it (petition I27 — `DeskLayerHandle.pick`): what a press there
 * touches, so what a primary click there selects — the host selects it through the engine's ops (`ops.setSelection([entity])`) and
 * reads its acts off the selection's anchor.
 */
export interface PickResult {
  readonly entity: Entity;
  /** Its object type (its `PrefabId`) — what the host names it by and finds its type with (`engine.catalog.widget(type)`). */
  readonly type: string;
  /**
   * The canvas it lies in — the frame the pick is made in: the board root on the root desk, the container entered (a mini mat whose
   * desk is the view); `NO_ENTITY` in a world with no document.
   */
  readonly canvas: Entity;
  /**
   * Its kind's PART under the point (design-014): `""` the object itself — its body or its frame, which a click selects; a named part
   * (the calendar's roll, corner and foot) is the kind's own — a click there works the part and selects nothing.
   */
  readonly part: string;
}


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
  /** Each kind's `tick`, asked (K7a): at rest a kind is asked only when it is due — the registered-wake witness. */
  readonly kindTicks: Readonly<Record<string, number>>;
  /** The drivers asked (`idle`, then `follow`): none on a step a registered time alone started (K7a). */
  readonly driverAsks: number;
  /** The mount's own cost as its boot went (petition I25). */
  readonly boot: DeskLayerBoot;
}

/**
 * THE MOUNT'S COST (petition I25 — a desk's kinds are compiled at its mount, so a host that changes them remounts, and may veil it):
 * the boot's milestones, ms since the mount (the factory's call, on `performance.now()`'s clock), each absent until it happens — for
 * good on a boot that failed. `device`: the device in hand (the adapter and the device asked for, or the engine's adopted); `compiled`:
 * the passes compiled (`Ground.create` resolved — the status `ready`); `presented`: the first frame's GPU work done
 * (`queue.onSubmittedWorkDone()` after its submit — the compositor's from then).
 */
export interface DeskLayerBoot {
  readonly device?: number;
  readonly compiled?: number;
  readonly presented?: number;
}

/**
 * The pegboard tray's door (design-017; K3) — the app's `a` and a rig's hand: the facts through core's tray ops (the one writer beside
 * the tray's input), the flux's pins and its state.
 */
/** A specimen as the last frame drew it (K5a — the tray door's witness): its type, kind, tag and accessory, its rect and pegs on screen (CSS px), the scale its kind drew it at. */
export interface TraySpecimenSeen {
  readonly type: string;
  readonly kind: string;
  readonly label: string;
  readonly accessory: string;
  readonly screen: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
  readonly pegs: readonly (readonly [number, number])[];
  readonly zoom: number;
  /** K5b: its object as drawn on screen (the fit inside the hang). */
  readonly object: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
}

/** What the tray carried in the last frame drawn (K5b — the door's witness): its type and phase, the ghost it presents (absent: the copy), its object's rect on screen, its scale. */
export interface TrayCarriedSeen {
  readonly type: string;
  readonly phase: string;
  readonly ghost?: number;
  readonly screen: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
  readonly zoom: number;
}

/**
 * Where the tray's BAR is placed from (design-018 §5 — `<TrayBar>`, @ice/react, reads it structurally): the drawer as the last frame
 * DREW it — its outline's top-left and width, its slide, its HEADER (R4) — the view, the hand, the category model its chips show, and
 * the theme's night. A fact the bar follows is never a pixel it guesses: the pill rides `drawer.y` exactly, frame by frame, and the
 * chips lie in the header as drawn.
 */
export interface TrayAnchor {
  /** The drawer is out (the fact: its slide may still be on its way). */
  readonly open: boolean;
  /**
   * The drawer's outline as drawn this frame (CSS px; its bottom runs on under the view) and its slide — null before its first frame, or
   * while a pin hides it — and its HEADER (design-018 R4, `DRAWER.header`): the clear band under the edge's inside, from `y` for `h`,
   * where nothing of the board's content shows and the bar lays its chips.
   */
  readonly drawer: { readonly x: number; readonly y: number; readonly w: number; readonly p: number; readonly header: { readonly y: number; readonly h: number } } | null;
  readonly view: { readonly width: number; readonly height: number };
  /** The theme's night, 0 day … 1 the Moon (`MatLight.night`): the bar's label tape steps back by it as the specimens' tags do (design-018 R4). */
  readonly night: number;
  /** An object is IN HAND (not flying home): the selection menu has the view's foot — the bar steps aside. */
  readonly held: boolean;
  /** How many entries the drawer's frame hangs, every category (0: nothing to offer here — the bar steps aside). */
  readonly entries: number;
  /** The category the drawer shows ("" all) and the categories its frame hangs, in the lay's order (design-018 §6). */
  readonly category: string;
  readonly categories: readonly TrayCategory[];
  /**
   * Petition I37 — the board's KEYBOARD FOCUS: the focused specimen's type (`id`) and its object as the last frame drew it (`rect`,
   * CSS px — the fit inside its hang, what a press there grabs; null while the drawer is not drawn), scrolled into the board's face
   * when the focus moved to it; null with nothing focused — so null too until the board is first laid (the step after the desk's
   * first drawn frame: `focus` has no order to walk before it, and a host asks again after it). The desk draws no ring: the host
   * does, from `rect`.
   */
  readonly focused: { readonly id: string; readonly rect: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number } | null } | null;
}

export interface DeskTrayDoor {
  /** Open the drawer: refused (false) while an object is in hand; gestures in flight cancel. */
  open(): boolean;
  close(): void;
  /** Open or close; returns whether it is open now. */
  toggle(): boolean;
  isOpen(): boolean;
  /** The board's scroll, CSS px past its top — set when given (any value: a rig's 10⁶ rows down), and returned. */
  scroll(px?: number): number;
  /** The facts and the flux as of now, the drawer as last drawn (the pose seam's answer) and what the pass last laid. */
  state(): TrayFluxState & { readonly frame: TrayScreenFrame | undefined; readonly laid: TrayLaid | null; readonly specimens: readonly TraySpecimenSeen[]; readonly tags: number; readonly slots: number; readonly carried: readonly TrayCarriedSeen[]; readonly presented: readonly number[] };
  /** Pin the drawer for a still — the slide, the band, or hidden; `null` unpins. */
  pin(pin: TrayPin | null): void;
  /**
   * design-018 §6 — the category the drawer shows ("" all): set when given (core's `setTrayCategory` — the lay lays only its
   * entries, the board starts at its top, and it falls back to all when the frame hangs none of it), and returned.
   */
  category(id?: string): string;
  /** design-018 §6 — the categories the drawer's frame hangs, in the lay's order: each its id, its label and its count (a host's chips). */
  categories(): readonly TrayCategory[];
  /** design-018 §5 — what the bar is placed from, as of the last frame drawn. */
  anchor(): TrayAnchor;
  /**
   * design-018 §5 — tell `listener` after each frame that moved what `anchor()` says: the drawer as drawn (its slide, frame by frame),
   * open or shut, the category or the categories, the hand, the entries, the view, the focus (I37). Never at rest: no frame, no call.
   */
  subscribe(listener: () => void): () => void;
  /**
   * Petition I37 — THE BOARD'S KEYBOARD FOCUS (core's `focusTray`): `next`/`prev` along the specimens the lay hangs, in its order (row
   * by row, across the categories when the drawer shows all; from none `next` is the first and `prev` the last; the ends stay),
   * `first`/`last`, or a type by its id (one the board does not hang changes nothing). Returns the focused type ("" — nothing hung).
   * The board scrolls the specimen into its face by the next frame, and `anchor().focused` then says where it is drawn. The order
   * is the lay's record (`TrayContent.order`): until the board is first laid — the step after the desk's first drawn frame, the
   * drawer shut or out — there is none, so `focus` answers "" and moves nothing; a host asks again after it (`subscribe` is told
   * when the board is laid: `anchor().entries` turns non-zero).
   */
  focus(to: TrayFocusMove | string): string;
  /**
   * Petition I37 — LAY the tray's own take (`ops.layFromTray`): `id` — the focused specimen when absent — CENTRED on `at`: CSS px of
   * the view (`space: "screen"`, the default — the space `pick` and `capture` take; the view's centre when `at` is absent) or a world
   * point of the current frame (`space: "world"`). What a drag-off's drop makes — the type at its natural size, the entry's take
   * props, ONE undo step, selected — and the board folds as a handed take's does. Undefined when refused: nothing focused, a type the
   * board does not hang now, an object in hand. Throws without the engine's ops in the mount context (`createDeskHost` hands them),
   * on a malformed point, and as `ops.spawnWidget` does (a read-only document).
   */
  lay(id?: string, opts?: { readonly at?: { readonly x: number; readonly y: number }; readonly space?: "screen" | "world" }): Entity | undefined;
}

export interface DeskLayerHandle {
  /** The drawing reflector — the facade registers it right after the plane transform, where the ground layer has always gone. */
  readonly reflector: ReflectorDef & { available(): boolean };
  dispose(): void;
  /**
   * Whether the host mounts the room's other people's cursors (petition I26): `deskLayer({ cursors })` as read at the mount, `true`
   * when absent — `@ice/dom`'s `createDeskHost` reads it off the handle (its structural `LayerHandle.cursors`) before it registers them.
   */
  readonly cursors: boolean;
  /** The canvas in the ground slot. */
  readonly canvas: HTMLCanvasElement;
  /** The device is acquired and `Ground.create` resolved. */
  available(): boolean;
  status(): DeskLayerStatus;
  /**
   * Told each time `status()` moves — the boot's end, an uncaptured error, the device lost after the boot (K9: a host says so on
   * its page; a desk that just ended leaves no canvas behind). Returns the unsubscribe; `dispose` drops every listener.
   */
  onStatus(listener: (status: DeskLayerStatus) => void): () => void;
  /** The device the layer draws with once it is here — the engine's when the context carries one (D7: one device per engine), else the layer's own. */
  device(): GPUDevice | undefined;
  /** The ground once made (a rig's door to a pass: `ground()?.pass("paper")`). */
  ground(): Ground | null;
  /** The theme changed (and, with it, the palette): the looks are remade, the next frame re-renders. */
  setTheme(theme: GroundTheme, palette?: Palette): void;
  /**
   * THE CAPTURE DOOR (petition I23 — the covers' still, the thumbnails, "Send to…"): the desk as the LAST PRESENTED frame showed
   * it — the same camera, theme, selection marks, hand and tray (what to hide is the host's, by its own doors, before the call) —
   * as an `ImageBitmap` of `rect` (CSS px of the view; the whole view when absent) at the view's dpr × `scale` (1; a thumbnail
   * asks 0.25). `marks: false` (petition I40 — "Send to…"'s still of the objects) draws THAT capture without the selection's marks
   * (`unselectedMarks`: no brackets, knobs, union, vellum, guides or rulers' extent; a taped object's tape stays), so a selected
   * object comes out as it looks unselected — the selection, the world and the presented frame untouched (no clear-and-restore,
   * no blink a peer could see). Inside: that frame's inputs drawn ONCE MORE into a readable texture at the asked size and read back
   * (`Ground.capture`) — never a copy kept of every frame, never a frame: the swap chain is not touched, the loop is not woken, no
   * frame is counted (`redraws()`, `perf().frames`), and the memory ledger shows the still and its readback as a `capture` line of
   * its own while they live and nothing after. Taken while the frame gate holds (`engine.frame.freeze`), it is the parked frame;
   * live, the most recent. `undefined`, never a throw, while `status()` is `failed` or `degraded`, before the first frame has been
   * presented, or when the device is lost mid-copy (a malformed option throws at the call). Captures serialize; one asked for the
   * same picture (equal options, no frame since) while another is in flight resolves to that one's bitmap.
   */
  capture(opts?: CaptureOptions): Promise<ImageBitmap | undefined>;
  /**
   * THE DESK'S PICK (petition I27 — a host's right-click selects the object under the pointer before it grows the menu): the object
   * at `point` (CSS px of the view, the container's top-left at 0, 0 — a pointer event's client point less the container's rect) as
   * the desk's own pick resolves it. Inside: the interaction stack's exact pick (`stack.pickAt`, through the mount context) — the one
   * body a press's `TouchesExact` is written by, never a second hit path — so the answer is what a primary click there selects: the
   * topmost object by stratum and sibling order through its kind's mirror on the last frame's geometry, its PART reported; on a live
   * mini mat's face the mini mat (its inside's objects are no members of this frame — entered, they pick with it as their canvas).
   * Synchronous; reads the last frame's world — no redraw, no wake, no write; it never selects (the host decides). `null` over the
   * bare mat and its rulers (printed on it), over what is not an object (a resize handle), while an object is in hand or the
   * pegboard drawer is out (the desk inert to the pointer — D4b, design-017 §4), before the first frame, and while `status()` is
   * `pending` or `failed` (`degraded` picks: the desk still draws, a click still selects). A point that is not two finite numbers throws.
   */
  pick(point: { readonly x: number; readonly y: number }): PickResult | null;
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
  /**
   * Pin a kind's own ASSET on an object for a still (K8a — generic: the kind reads it as `ctx.asset`, in a shape the KIND defines —
   * the note's greeked writing is `{ greek }`, `PaperAsset`; the desk never knows it); `undefined` unpins. Until K8a this door was
   * `pinGreek`, a note's writing stated by its shape (`GreekPin`) — the one kind-shaped door on the handle.
   */
  pinAsset(entity: Entity, asset: unknown): void;
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
  /** The layer's own main-thread time since the mount (D6, design-015 §11.4's idle gate): a rig diffs two readings. And the boot's milestones (`boot`, petition I25). */
  perf(): DeskLayerPerf;
  /** The raster budget's ledger (D6): what the kinds' caches hold, by owner, against the cap; the evictions so far. */
  memory(): BudgetStats;
  /** The frame's raster queue (K6b): the asks waiting and held, the runs, the turns, their ms and the most a turn spent. */
  rasters(): RasterQueueStats;
  /** The device's live GPU memory by label (K2) — kept only under `gpuLedger: true`, from the boot; undefined otherwise or before the device. */
  gpuMemory(): MemoryLedger | undefined;
  /**
   * THE GPU PROFILER (K2, design-016 §4) on the layer's device — made on first ask, UNARMED (nothing installed) until `arm()`:
   * each drawn frame's GPU span and passes, its draws by kind, pipelines, bind groups, uploads, and the ledger's memory; the
   * layer's flush is its boundary. Undefined before the device.
   */
  profiler(): GpuProfiler | undefined;
  /** The kinds' persistent record stores' counters by kind (D6, design-015 §4.3) — the root passes'; a rig diffs two readings. */
  records(): Readonly<Record<string, RecordStoreStats>>;
  redraws(): number;
  stats(): DeskReflectorStats;
  wakes(): DeskWakes;
  /**
   * The desk's registered wake taken apart (K7a — "why is the desk awake?"): when each part is next due, on `performance.now()`'s
   * clock (`Infinity`: never on its own) — the reflector's, the drivers' (now while one follows), a kind woken, each kind's `due`,
   * the tray's layers' let-go (`tray`, K7a over K5a) and the raster queue's waiting asks (`rasters`, K6b: now while any wait). A
   * MISSING kind (petition I24) is a row of `kinds` whatever it declares: `KIND_MISSING` (−1 — no time; it is never due, nothing of
   * it runs), and `at` never counts it.
   */
  due(now: number): { readonly at: number; readonly reflector: number; readonly drivers: number; readonly following: readonly string[]; readonly woken: readonly string[]; readonly kinds: Readonly<Record<string, number>>; readonly tray: number; readonly rasters: number };
  geometryOf(e: Entity): unknown | undefined;
  fluxOf(e: Entity): ObjectFlux | undefined;
  lastInputs(): GroundFrameInputs | null;
  /** The frame dirty and not yet drawn, or a kind still moving on its own (a print in the air — D3w): a rig's settle witness. */
  dirty(): boolean;
  readonly builder: DeskBuilder;
  /** A kind's own state on this desk by kind name (D3w: a print's body, a book's or a pad's pinned pose) — `undefined` when it keeps none. */
  local(name: string): KindLocal | undefined;
  /** The desk's ONE focused editor (D2c; the desk's since K8a — made at the mount whatever kinds are registered, leased by every kind that takes text). */
  editor(): DeskEditor;
  /**
   * A kind's DRIVER on this desk by object type (D-D7-A.3) — what the object declared in `defineObject` (the note's typing, the
   * board's pen, the notebook's hand, the print's carry, the calendar's writing + hand + DOM half), or undefined. A rig casts to
   * the kind's own driver type (`PaperDriver`, `CalendarDriver`); the desk itself never names one.
   */
  driver(type: string): KindDriver | undefined;
  /** Where the selection menu goes (D4a): the marks' box around the selection, published after each frame it moved. */
  readonly selection: SelectionSource;
  /** The pegboard tray's door (design-017; K3). */
  readonly tray: DeskTrayDoor;
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

/**
 * A captured still's bytes as the page SHOWS them (I23): the swap chain's channel order turned to RGBA (`bgra8unorm` on most
 * canvases — `getPreferredCanvasFormat`), alpha 255 on every pixel (the canvas is configured `opaque`: the screen never reads the
 * frame's alpha, so the still carries none), and no colour-space conversion or premultiplication on the way in — the bitmap's
 * bytes ARE the frame's, as the oracle's parity holds the page's pixels to Dawn's.
 */
function bitmapOf(c: CaptureBytes): Promise<ImageBitmap> {
  const n = c.width * c.height * 4;
  const rgba = new Uint8ClampedArray(n);
  const b = c.bytes;
  const bgra = c.format.startsWith("bgra");
  for (let i = 0; i < n; i += 4) {
    rgba[i] = b[bgra ? i + 2 : i] as number;
    rgba[i + 1] = b[i + 1] as number;
    rgba[i + 2] = b[bgra ? i : i + 2] as number;
    rgba[i + 3] = 255;
  }
  return createImageBitmap(new ImageData(rgba, c.width, c.height), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
}

/** The kinds told, once a page, that a local `tick` with no `due` keeps the desk awake (K9: nothing else would tell a plugin's author). */
const toldAwake = new Set<string>();
function tellAwake(kind: string): void {
  if (toldAwake.has(kind)) return;
  toldAwake.add(kind);
  console.warn(`[ice] desk: the kind "${kind}" declares a local \`tick\` and no \`due\` — it is due every frame, so the desk never sleeps. Declare \`KindLocal.due(now)\`: now while it moves, a later time, or Infinity until a fact, an input or \`KindHost.wake\` moves it (design-016 K7a).`);
}

/**
 * The kinds told, once a page, that a call the selection's anchor makes of them threw — their `open.readout` (I22: the held bar kept
 * their tools and showed no word) or their `open.swatches` (I24: the tools kept, their slots without a swatch). Contained at the CALL,
 * never a strike against the kind (petition I24's ladder counts what draws the desk): the anchor is recomposed at the HOST's rate — every
 * `selection.anchor()` read besides the frame's publish — and only while the object is in hand, so strikes counted here would let a
 * host's reads decide when a kind goes, and would retire every such kind with its object in hand; and neither call draws the desk.
 */
const toldAnchor = new Set<string>();
function tellAnchor(kind: string, call: "readout" | "swatches", err: unknown): void {
  const key = `${call} ${kind}`;
  if (toldAnchor.has(key)) return;
  toldAnchor.add(key);
  const kept = call === "readout" ? "no word (petition I22)" : "no swatches (petition I24)";
  console.error(`[ice] desk: the kind "${kind}"'s \`open.${call}\` threw — the anchor carries its held tools and ${kept}; said once a page`, err);
}

/** A host's length or time for the desk's chrome (I20, I21): a finite number ≥ 0, or the mount refuses it by its name. */
function hostNumber(name: string, v: number | undefined): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw new Error(`[ice] deskLayer: \`${name}\` is ${String(v)} — a finite number ≥ 0 (CSS px, or ms for a time)`);
  return v;
}

/** The hand as the host set it (I20): the reserves the builder fits by (undefined: `HOLD`'s) and the bar's travel the anchor carries. */
function holdOf(hold: HoldOptions | undefined): { readonly reserves: HoldReserves | undefined; readonly travelMs: number | undefined } {
  const top = hostNumber("hold.top", hold?.top);
  const band = hostNumber("hold.band", hold?.band);
  return { reserves: top === undefined && band === undefined ? undefined : { top: top ?? HOLD.top, band: band ?? HOLD.band }, travelMs: hostNumber("hold.travelMs", hold?.travelMs) };
}

export function deskLayer(opts: DeskLayerOptions): DeskLayerFactory {
  return (ctx) => {
    // THE MOUNT'S COST (petition I25): the boot's milestones, ms from here
    const mountedAt = performance.now();
    const boot: { -readonly [K in keyof DeskLayerBoot]: DeskLayerBoot[K] } = {};
    const { host, world } = ctx;
    const doc = host.container.ownerDocument;
    const view = doc.defaultView;
    // the OBJECT types: the catalog's, plus the app's — their kinds are the ground's registry
    const types = new Set<WidgetType>([...(ctx.catalog?.widgetTypes() ?? []).filter((t) => t.object !== undefined), ...(opts.objects ?? [])]);
    const { kinds, objectKinds } = kindsOf([...types], opts.kinds ?? []);
    // every kind's look from the palette BEFORE the mount touches the page (D7): an incomplete palette throws HERE, leaving no canvas,
    // no listener, no builder behind (the reflector remakes the looks it keeps; this pass only proves they can be made) — and so does
    // a host's malformed number for the hand or the drawer (I20, I21)
    looksOf(objectKinds, opts.palette, opts.theme);
    const hold = holdOf(opts.hold);
    const foot = hostNumber("tray.foot", opts.tray?.foot);
    const cursors = opts.cursors !== false;   // the host's word on the room's other people (I26), told it on the handle
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
    let asked = false;     // the rigs' door asked for the submit instrument: it stays for the layer's life
    let holds = 0;         // the profiler's arms hold it too
    let ledger: MemoryLedger | undefined;
    let profiler: GpuProfiler | undefined;
    let status: DeskLayerStatus = { state: "pending" };
    const statusHeard = new Set<(status: DeskLayerStatus) => void>();
    /** THE KIND BOUNDARY (petition I24, faults.ts): every kind's faults on this desk — the builder, the pick, the tray and the ticks report to it. */
    const faults = createKindFaults();
    /** Every move of the status goes through here, and `onStatus`'s listeners hear it (K9) — carrying the missing kinds once any is (I24). */
    const setStatus = (next: DeskLayerStatus): void => {
      const { faults: _was, ...rest } = next;
      status = faults.size > 0 ? { ...rest, faults: faults.list() } : rest;
      for (const l of [...statusHeard]) l(status);
    };
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
    // THE SERVICES (K8a, kit/services.ts — an open registry by key): the host's own — its text raster, the picture decoder, its byte
    // store, whatever the app lends (`opts.services`) — then what each object's DOM half LENDS (`ObjectHost.lend`: the calendar's
    // print raster, in the host's hand, D3t-c), in registration order, each handed what is lent so far; every kind's world half and
    // every DOM half `use`s any of them by key. A name lent twice throws here, at the mount, naming both lenders
    const services = createServices([
      ...(opts.text !== undefined ? [service(TEXT_RASTER, opts.text)] : []),
      service(PICTURE_DECODER, decodePicture),
      ...(opts.blobs !== undefined ? [service(BLOB_STORE, opts.blobs)] : []),
      ...(opts.services ?? []),
    ]);
    for (const t of types) {
      const lend = hostOf(t)?.lend;
      // …handed the desk's wake for a service whose work LANDS later (K7a — a sleeping loop steps and every kind is asked again)
      if (lend !== undefined) services.lend(lend({ use: services.use, wake: () => ctx.frame?.wake("desk:service") }), `the object "${t.type}"`);
    }
    const drawn = (e: Entity): number | undefined => builder.rankOf(e);   // `builder` is made just below; the word is only asked at a tick
    // THE REGISTERED WAKES (K7a): the kinds a wake named since their last tick
    const frame = ctx.frame;
    const woken = new Set<string>();
    const wakeKind = (name: string): void => { woken.add(name); frame?.wake("desk:kind"); };
    // THE RASTER BUDGET (D6): one ledger for every kind's raster caches; trimmed once a tick by each kind's word on what is on screen
    const budget = createRasterBudget(opts.rasterBudget ?? DEFAULT_RASTER_BUDGET);
    // THE FRAME'S RASTER QUEUE (K6b): the kinds' re-rasters under one budget a frame, its turn once a tick before the build; an ask
    // whose object the last build did not draw is let go (the builder's word, bound late as `drawn` is)
    // …and the TRAY's (K5b): a specimen drawn with its kind's desk state (`tray.local` — a note's word) asks as a desk note does; its
    // ask is run, not let go, and its raster's landing wakes the frame that shows it (the builder holds no specimen to remake)
    const rasters = createRasterQueue({ ...(opts.rasterMs !== undefined ? { budgetMs: opts.rasterMs } : {}), shows: (e) => builder.shows(e) || compose.trayShows(e) });
    const remake = (e: Entity): void => { builder.remake(e); if (compose.trayShows(e)) compose.wake("ink"); };
    // M24 LT1 (design-019 §3.3–§3.5): a frame drawn again with no record remade — the reflector dirtied as a driver's and a DOM half's
    // `wake` dirty it, a sleeping loop woken; the object's durable key, the document's (strata's `DurableStore.keyOf` through the
    // session the host lends); and the frames drawn, the reflector's count — a kind's sight's frame boundary. `compose` is made just
    // below, after the locals: a kind that asks either while its `local()` runs finds no frame yet (0) and nothing to draw
    let composed = false;
    const redraw = (): void => { if (composed) compose.wake("ink"); };
    // the document a driver writes into and a key is read from (D7 #1; the drivers below take it too)
    const docs: TypingDocs = opts.docs ?? NO_DOCS;
    const keyOf = (e: Entity): string | undefined => docs.current()?.store.keyOf(e);
    const frames = (): number => (composed ? compose.redraws() : 0);
    for (const k of objectKinds) {
      const local = k.local?.({ pass: () => ground?.pass(k.name), use: services.use, children, drawn, budget, rasters, remake, wake: () => wakeKind(k.name), redraw, keyOf, frames });
      if (local === undefined) continue;
      locals.set(k.name, local);
      if (local.tick !== undefined && local.due === undefined) tellAwake(k.name);
    }
    const keeps = (owner: string, key: string): boolean => locals.get(owner)?.keeps?.(key) ?? false;
    const readMarquee = ctx.readMarquee;
    const builder = createDeskBuilder(world, { objects: [...types], locals, faults, ...(opts.springs !== undefined ? { springs: opts.springs } : {}), ...(readMarquee !== undefined ? { marquee: readMarquee } : {}), ...(ctx.spatial !== undefined ? { spatial: ctx.spatial } : {}), ...(hold.reserves !== undefined ? { hold: hold.reserves } : {}) });
    // the object types by name (K8a): what an object provides and what acts its type declares are read off its PrefabId
    const typeNamed = new Map([...types].map((t) => [t.type, t] as const));
    // the selection's KIND ACTS (K8a): what every selected object's type declares (`defineObject({ menu })`), read off its PrefabId
    const menuOf = (e: Entity): readonly MenuActionDef[] => { const id = world.isAlive(e) ? world.get(e, PrefabId)?.id : undefined; return typeof id === "string" ? (typeNamed.get(id)?.menu ?? []) : []; };
    /** An object's props as the world holds them now — its type's groups' cells, flat: what a held tool's act reads (`HeldToolApi.props`). */
    const propsOf = (e: Entity): Readonly<Record<string, unknown>> => {
      const id = world.isAlive(e) ? world.get(e, PrefabId)?.id : undefined;
      const props: Record<string, unknown> = {};
      for (const g of (typeof id === "string" ? typeNamed.get(id)?.groups : undefined) ?? []) Object.assign(props, (world.get(e, g.component) as Record<string, unknown> | undefined) ?? {});
      return props;
    };
    // the kind's WORD in hand (I22): its `open.readout` — a string, or read off the world, the object's props and the kind's desk state
    // each time the anchor is recomposed; a throw is the kind's, caught here (the anchor keeps its tools, no word) and said once —
    // never a strike (I24: `tellAnchor` says why)
    const readoutOf = (kind: ObjectKind | undefined, e: Entity): string | undefined => {
      const r = kind?.open?.readout;
      if (r === undefined || kind === undefined) return undefined;
      let word: unknown = r;
      if (typeof r === "function") {
        try { word = r({ world, entity: e, props: () => propsOf(e), local: locals.get(kind.name) }); }
        catch (err) { tellAnchor(kind.name, "readout", err); return undefined; }
      }
      return typeof word === "string" && word.length > 0 ? word : undefined;
    };
    // the bar's slots' colours (D3t-a) from the kind's look — caught as the word is (I24): a throw leaves the slots their glyphs, said once
    const swatchesOf = (kind: ObjectKind | undefined): Readonly<Record<string, string>> => {
      if (kind?.open?.swatches === undefined) return {};
      try { return kind.open.swatches(compose.look(kind.name)); }
      catch (err) { tellAnchor(kind.name, "swatches", err); return {}; }
    };
    // the selection menu's source: the anchor published whenever a frame moved it — the marks' word, and the hand's (D4b: with an
    // object in hand the menu travels to the foot and becomes the held bar; it hides while the object flies home). D3t-a: the kind's
    // tools as the bar's slots (their swatches from the kind's look) and the mode in hand — core's `HeldTool`, the one slot marked;
    // I20: the bar's travel when the host set one; I22: the kind's word in hand when it says one
    const anchorOf = (): SelectionAnchor => {
      const a = builder.anchor();
      // the pegboard tray is out (design-017 §4): the desk under it is inert, so the menu has nothing to act on — it steps away
      if (trayOpen(world)) return { ...a, box: null, count: 0 };
      const h = builder.hand();
      if (h === undefined) return withKindActs(a, selectedEntities(world), menuOf);
      const kind = builder.kindOf(h.entity);
      const swatches = swatchesOf(kind);
      const active = world.isAlive(h.entity) ? (world.get(h.entity, HeldTool)?.id ?? "") : "";
      const readout = readoutOf(kind, h.entity);
      return { ...a, held: { tools: heldSlots(kind?.open?.tools ?? [], swatches), active, landing: h.landing, settled: h.settled, ...(hold.travelMs !== undefined ? { travelMs: hold.travelMs } : {}), ...(readout !== undefined ? { readout } : {}) } };
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
    // the tray bar's source (design-018 §5): the drawer as the last frame drew it, and what its chips show — published after each frame
    // that moved it, as the menu's anchor is (the slide is drawn frame by frame, so the bar rides it exactly; at rest nothing is drawn)
    // the board's keyboard focus (I37): the focused specimen's object as the last frame drew it (none drawn: the drawer shut, or no frame)
    const focusedOf = (): TrayAnchor["focused"] => {
      const id = trayFocus(world);
      if (id === "") return null;
      const seen = compose.traySpecimens().find((f) => f.type === id);
      return { id, rect: seen === undefined ? null : { x0: seen.object.x0, y0: seen.object.y0, x1: seen.object.x1, y1: seen.object.y1 } };
    };
    const trayAnchorOf = (): TrayAnchor => {
      const f = compose.tray.frame();
      const vp = world.getResource(Viewport);
      const h = builder.hand();
      return {
        open: trayOpen(world),
        drawer: f === undefined ? null : { x: f.x, y: f.y, w: f.w, p: f.p, header: { y: f.y + DRAWER.arris, h: DRAWER.header } },
        view: { width: vp?.w ?? 0, height: vp?.h ?? 0 },
        night: compose.theme().matLight.night,
        held: h !== undefined && !h.landing,
        entries: trayEntryCount(world),
        category: trayCategory(world),
        categories: trayCategories(world),
        focused: focusedOf(),
      };
    };
    const trayListeners = new Set<() => void>();
    let trayPublished = "";
    const publishTray = (): void => {
      const key = JSON.stringify(trayAnchorOf());
      if (key === trayPublished) return;
      trayPublished = key;
      for (const l of [...trayListeners]) l();
    };
    // the boot's `presented` (I25): the FIRST frame drawn, its GPU work done — asked once, of the queue it was submitted on (a unit's
    // stub queue may have no `onSubmittedWorkDone`; every WebGPU queue does)
    let presenting = false;
    const firstFrame = (): void => {
      if (presenting) return;
      presenting = true;
      const queue = drawDevice?.queue;
      if (typeof queue?.onSubmittedWorkDone !== "function") return;
      queue.onSubmittedWorkDone().then(() => { boot.presented ??= performance.now() - mountedAt; }, () => {});
    };
    const compose = createDeskReflector({
      onFrame: () => { publish(); publishTray(); firstFrame(); },
      world, builder, kinds: objectKinds, ambient, faults,
      ground: () => ground,
      attach: { resize: (w, h) => { if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; } } },
      theme: opts.theme, palette: opts.palette, grid, locals,
      ...(opts.maxDpr !== undefined ? { maxDpr: opts.maxDpr } : {}),
      ...(foot !== undefined ? { tray: { foot } } : {}),
      ...(opts.name !== undefined ? { name: opts.name } : {}),
      // a frame asked for outside the flush — a pin, an ink landing, the ground arriving, a theme: a sleeping loop wakes (K7a)
      onWake: (reason) => frame?.wake(`desk:${reason}`),
    });
    composed = true;   // the kinds' `redraw` and `frames` reach it from here (M24 LT1)
    motionQuery?.addEventListener("change", syncMotion);   // armed once `compose` exists (D7: never a listener over a binding in its TDZ)

    // THE KINDS' DRIVERS (D7 #5, D-D7-A.3): each object declared its own in `defineObject` — a pen, a carry, a leaf, the calendar's
    // writing and hand, the note's typing — and the host makes them here from what it lends, never naming a kind; a third-party
    // openable kind with held tools gets its driver the same way. Ticked before the kinds' clocks; idle ones skipped (D7 #14)
    const drivers = new Map<string, KindDriver>();
    /** Each driver's kind, by object type — a MISSING kind's drivers are parked (petition I24: they follow nothing; disposed with the layer). */
    const driverKinds = new Map<string, string>();
    const parked: KindDriver[] = [];
    // an INSERT GHOST (core's tray adoption, K5b) is no kind's to drive: its drag is core's until it lands (a print's carry, a pad's
    // hand, a note's typing never take it) — the twin it becomes is theirs
    const ofKind = (e: Entity, name: string): boolean => builder.kindOf(e)?.name === name && !world.has(e, InsertGhost);
    const kindNamed = (name: string): ((e: Entity) => boolean) | undefined => (objectKinds.some((k) => k.name === name) ? (e) => ofKind(e, name) : undefined);
    // …and by what an object PROVIDES (K8a): its type's keys, read off its `PrefabId` — undefined when no type on this desk provides it;
    // an insert ghost provides nothing to a driver (K5b's law above: the calendar never pins the ghost, only the twin it becomes)
    const providing = (key: string): ((e: Entity) => boolean) | undefined =>
      [...types].some((t) => t.provides.includes(key)) ? (e) => { const id = world.isAlive(e) && !world.has(e, InsertGhost) ? world.get(e, PrefabId)?.id : undefined; return typeof id === "string" && typeNamed.get(id)?.provides.includes(key) === true; } : undefined;
    for (const t of types) {
      const make = driversOf(t);
      const k = objectKindOf(t);
      if (make === undefined || k === undefined) continue;
      const d = make({
        world, docs, local: locals.get(k.name), look: () => compose.look(k.name), isKind: (e) => ofKind(e, k.name), kind: kindNamed, provides: providing,
        geometryOf: (e) => builder.geometryOf(e), heldToWorld: (e, x, y) => builder.heldToWorld(e, x, y), hand: () => builder.hand(),
        refused: (e) => builder.meetTape(e), wake: () => compose.wake("ink"),
      });
      if (d !== undefined) { drivers.set(t.type, d); driverKinds.set(t.type, k.name); }
    }
    const driver = (type: string): KindDriver | undefined => drivers.get(type);
    // THE ONE FOCUSED EDITOR (D2c; the DESK's since K8a — host/editor.ts): made here whatever kinds are registered, and LEASED by
    // every kind that takes text; a tap is routed to the text parts the objects declare, in registration order
    const textParts: TextPart[] = [];
    const editor = createDeskEditor({ container: host.container, world, parts: () => textParts, wake: () => compose.wake("ink"), ...(opts.idleMs !== undefined ? { idleMs: opts.idleMs } : {}) });
    // THE OBJECTS' DOM HALVES (K4b, `defineObject({ host })`), in screen space: each object declared its own and the host builds them
    // from what it lends, never naming a kind — their TEXT PARTS first (K8a: the note's body, the calendar's day line), then every
    // half that mounts (the calendar's days and pen lease the editor, D3t-c)
    const domHost = (t: WidgetType): ObjectDomHost => {
      const k = objectKindOf(t);
      return {
        container: host.container, world, docs, use: services.use, editor, object: t, driver: drivers.get(t.type), look: () => (k === undefined ? undefined : compose.look(k.name)),
        geometryOf: (e) => builder.geometryOf(e), hand: () => builder.hand(), heldToWorld: (e, x, y) => builder.heldToWorld(e, x, y),
        wake: () => compose.wake("ink"), ...(opts.idleMs !== undefined ? { idleMs: opts.idleMs } : {}),
      };
    };
    for (const t of types) textParts.push(...(hostOf(t)?.text?.(domHost(t)) ?? []));
    for (const t of types) hostOf(t)?.mount?.(domHost(t));
    // the drawing reflector, wrapped: the kinds' flux ticked before it on one clock, the editor placed after it
    let moving = false;
    /** A driver had something to follow at the last ask (K7a): the desk is due every frame until each is idle again. */
    let following = false;
    const kindTicks: Record<string, number> = {};
    const perf = { ticks: 0, ms: 0, frames: 0, frameMs: 0, driverAsks: 0 };
    // the kinds whose own state moved (D6): their records are remade this build; the rest stand — told every tick, an empty set
    // included (no word at all would make the builder ask every object whether a kind lifts it). ONE set, cleared a tick (K7a)
    const restless = new Set<string>();
    const inner = compose.reflector;
    const reflector: ReflectorDef & { available(): boolean } = {
      ...inner,
      flush(w) {
        const now = performance.now();
        const drawn = compose.redraws();
        // THE REGISTERED WAKES (K7a): a step the loop took for a registered time alone (`settled` — nothing woke it, the tail long
        // run) asks no driver (they follow input, and none came) and ticks only the kinds due now or woken; any other step asks
        // every part, as before. A desk at rest takes no step at all — the loop sleeps (dom/loop.ts).
        const timeAlone = frame?.settled() === true && woken.size === 0 && !compose.dirty();
        if (!timeAlone) {
          following = false;
          for (const d of drivers.values()) {
            perf.driverAsks += 1;
            if (d.idle?.() !== true) { following = true; d.follow(now); }
          }
        }
        let want = false;
        restless.clear();
        for (const [name, local] of locals) {
          if (local.tick === undefined) continue;
          // THE KIND'S BOUNDARY (petition I24): a `due` or a `tick` that throws is a strike, and the kind is not ticked this step
          let call = "due";
          try {
            if (timeAlone && !woken.has(name) && (local.due?.(now) ?? now) > now) continue;
            kindTicks[name] = (kindTicks[name] ?? 0) + 1;
            call = "tick";
            if (local.tick(now)) { want = true; restless.add(name); }
          } catch (err) { faults.strike(name, call, err); }
        }
        woken.clear();
        ground?.idleTray();   // the tray's own slots let their layers go once undrawn a while, as the kinds' ticks do the root's (D-K6a.3, K5a)
        // the raster queue's turn (K6b): after the ticks (a kind's tick may ask), before the build — a raster laid now has its record
        // remade in this build (`remake`), so no frame draws a record whose ink moved under it
        if (rasters.size > 0) rasters.drain();
        if (want) compose.wake("ink");
        compose.restless(restless);
        moving = want;   // D3w: a kind's own motion (a print in the air) keeps the desk from reading quiet between its frames
        inner.flush(w);
        editor.follow();
        budget.trim(keeps);   // over the cap: the least recently used off-screen rasters go (O(1) when under it)
        const drew = compose.redraws() !== drawn;
        // a frame drawn: what is drawn moved, and a raster no longer drawn may be evicted — the asks held for room try again (K6b)
        if (drew) rasters.wake();
        // …and so do rasters still waiting their turn (K6b; those held for room do not: nothing moves until room is made)
        if (rasters.size > 0) moving = true;
        // the desk's own main-thread time (D6): this flush, and whether it drew
        const spent = performance.now() - now;
        perf.ticks += 1; perf.ms += spent;
        if (drew) { perf.frames += 1; perf.frameMs += spent; }
        profiler?.flushed(spent);   // the GPU profiler's frame boundary (K2): returns at once unless armed
      },
    };

    // THE DESK'S REGISTERED WAKE (K7a, `@ice/core` frame-control.ts): after every step the loop asks when the desk is next due — now
    // while a driver follows or a kind was woken, else the soonest of the reflector's (a frame owed, the wind still moving) and each
    // kind's own `due` (a motion now, a blink or a layer's release later, nothing at all); a face landing wakes it
    /** A kind's `due` asked through the boundary (petition I24): a throw is a strike (its name found by its state — only then), never due. */
    const dueOf = (local: KindLocal, now: number): number => {
      try { return local.due?.(now) ?? now; } catch (err) {
        for (const [name, l] of locals) if (l === local) { faults.strike(name, "due", err); break; }
        return Number.POSITIVE_INFINITY;
      }
    };
    const deskDue = (now: number): number => {
      let t = following || woken.size > 0 ? now : compose.due(now);
      // each kind asked AFTER the step (its draw may have landed something); a kind that never said when is due every frame
      for (const local of locals.values()) {
        if (local.tick === undefined) continue;
        const d = dueOf(local, now);
        if (d < t) t = d;
      }
      // the tray's layers (K5a): their release is a TIME — the last tray draw + LAYER_IDLE_MS — so a desk asleep since the drawer
      // shut still gives them back (the tick that polled them no longer comes); the frame's raster queue: asks waiting their turn are
      // due NOW (K6b — it drains over a zoom's next frames), those held for room are not (a drawn frame or a release wakes them)
      const tray = ground?.trayIdleAt() ?? Number.POSITIVE_INFINITY;
      if (tray < t) t = tray;
      if (rasters.size > 0) t = now;
      return t;
    };
    const stopWake = frame?.wakeWhen("desk", deskDue);
    const stopText = opts.text?.onVersion?.(() => frame?.wake("desk:text"));

    /**
     * A kind gone MISSING (petition I24) STOPS COSTING, not merely drawing (design-009 §16.7's word for a suspended behavior): its desk
     * state's `dispose` called and the state let go (no tick, no `due`, no word asked of it again), its drivers parked (disposed with
     * the layer), its raster asks dropped and its charges forgotten, its passes swapped for the missing face in every slot and disposed
     * (the ground's quarantine) — and the desk woken, so the next frame draws its objects in the missing face.
     */
    const retire = (name: string): void => {
      const local = locals.get(name);
      locals.delete(name);
      woken.delete(name);
      for (const [type, kind] of driverKinds) {
        const d = drivers.get(type);
        if (kind === name && d !== undefined) { drivers.delete(type); parked.push(d); }
      }
      rasters.clear(name);
      budget.forget(name);
      try { local?.dispose?.(); } catch (err) { console.error(`[ice] desk: the missing kind "${name}"'s desk state threw in its dispose`, err); }
      ground?.quarantine(name);
      compose.wake("ink");
    };
    // said ONCE (petition I24): the status moves with the kind named (a kind refused at the boot rides the boot's own `ready`)
    faults.subscribe((f) => {
      retire(f.kind);
      if (status.state !== "pending") setStatus(status);
    });

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
    // the tray pose seam (design-017 §4): the drawer as the last frame drew it — its rect mid-slide, the layout's scroll range — and
    // (petition I38) what the tray can draw: core's lay hangs only the kinds this desk was mounted with, so a kind it cannot draw
    // leaves no invisible hang to press, no count, no chip
    const traySource: TrayPoseSource = { frame: () => compose.tray.frame(), draws: (type) => compose.drawsType(type) };
    const trayPose = ctx.trayPose;
    if (trayPose !== undefined) trayPose.current = traySource;
    // the ground plane's transition adapter: prepared the moment it is asked — the desk's second slot is built from the world (D2b)
    const detachTransition = ctx.transitions?.register({ id: "@ice/desk", plane: "ground", prepare: () => null }) ?? null;

    const fail = (what: string, e: unknown): void => {
      console.error(`[ice] desk: ${what}`, e);
      setStatus({ state: "failed", message: `${what}: ${e instanceof Error ? e.message : String(e)}` });
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
            if (status.state !== "failed") setStatus({ state: "degraded", message: `an uncaptured GPU error — ${error.constructor?.name ?? "GPUError"}: ${error.message}` });
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
    const booted: Promise<void> = device.then(async (g) => {
          if (disposed) { if (shared === undefined) g.device.destroy(); throw new Error("disposed before the device arrived"); }
          boot.device = performance.now() - mountedAt;
          drawDevice = g.device;
          if (shared === undefined) ownDevice = g.device;
          if (opts.gpuLedger === true) ledger = instrumentMemory(g.device);   // before the ground makes anything
          opts.onDevice?.(g.device);
          // each kind's pass in its own error scope (petition I24): a kind refused there is MISSING — the rest boot; a GPU error the
          // kinds' window caught that no kind raises alone is the device's, as it would have been
          const made = await Ground.create({ device: g.device, surface: surface(g.device, canvas), mat: matShaders(shaderText(MAT_SHADER_FILES)), kinds, marks: marksShaders(shaderText(MARKS_SHADER_FILES)), hold: holdShaders(shaderText(HOLD_SHADER_FILES)), tray: trayShaders(shaderText), ...(events.onError !== undefined ? { onError: events.onError } : {}) });
          if (disposed || ended) { made.dispose(); return; }
          boot.compiled = performance.now() - mountedAt;
          made.mat.setNoise(blueNoise());   // the desk's own noise; the plates are the app's (`setPlate`)
          made.grid = grid;
          // the kinds refused at create: missing from the first frame, said once — with the boot's own `ready` (the status is still pending)
          for (const f of made.faults()) faults.refuse(f.kind, f.reason);
          // …and a kind QUARANTINED while the ground was made (its desk state's `tick` or `due` threw three times in the boot's frames —
          // they run from the mount on; rig:remount's broken generation): its `retire` found no ground, so the ground is told now — its
          // pass swapped out of every slot for the missing face and disposed, never handed a record (a no-op for a kind refused here)
          for (const f of faults.list()) made.quarantine(f.kind);
          ground = made;
          if (status.state === "pending") setStatus({ state: "ready" });   // an error while it booted keeps its word
          compose.ready();
        });
    booted.catch((e: unknown) => { if (!disposed) fail("no desk — the adapter, the device or the pipelines were refused", e); });

    const setGrid = (next: GridConfig): void => { grid = next; if (ground !== null) ground.grid = next; compose.configureGrid(next); };

    // THE CAPTURE DOOR (petition I23): the GPU half is the ground's (`Ground.capture` — the last frame's inputs drawn once more into a
    // readable still, read back); this half is the page's — the bytes as an `ImageBitmap` — and the door's honesty: nothing while the
    // desk is not `ready` or no frame has been presented, never a throw for a GPU condition. Captures SERIALIZE (one still at a time
    // on the device: a second asked meanwhile waits, and reads the frame that is most recent when its turn comes); one asked for the
    // same picture as the one in flight — equal options, the same frame — shares its answer (two covers rising together, one bitmap).
    let capturing: { readonly key: string; readonly inputs: GroundFrameInputs | null; readonly promise: Promise<ImageBitmap | undefined> } | null = null;
    let captures: Promise<unknown> = Promise.resolve();
    const captureKey = (o: CaptureOptions): string => JSON.stringify([o.scale ?? 1, o.rect === undefined ? null : [o.rect.x, o.rect.y, o.rect.width, o.rect.height], o.marks !== false]);
    const capture = (opts: CaptureOptions = {}): Promise<ImageBitmap | undefined> => {
      checkCapture(opts);   // a malformed option throws HERE, at the call
      const key = captureKey(opts);
      const asked = compose.lastInputs();
      const same = capturing;
      if (same !== null && same.key === key && same.inputs === asked) return same.promise;
      const run: Promise<ImageBitmap | undefined> = captures.then(async () => {
        // honest undefined: the layer ended or was disposed; no desk (`failed`); a desk that may be losing frames (`degraded`); no
        // frame presented yet (the boot's `pending`, or a ready desk that has not drawn — a viewport not yet written)
        const g = ground;
        const inputs = compose.lastInputs();   // the most recent frame when its turn comes
        if (disposed || ended || g === null || status.state !== "ready" || inputs === null) return undefined;
        const bytes = await g.capture(inputs, opts);
        return bytes === undefined ? undefined : await bitmapOf(bytes);
      }).finally(() => { if (capturing?.promise === run) capturing = null; });
      capturing = { key, inputs: asked, promise: run };
      captures = run.catch(() => undefined);   // a refusal never stalls the next capture
      return run;
    };

    // THE DESK'S PICK (petition I27): the stack's exact pick (`ctx.pickAt` — what a press touches, through this layer's pick source
    // above), answered for an object of the frame. Nothing with no desk as last drawn — no ground (it is here only while the status
    // is `ready` or `degraded`: pending, failed, ended and disposed have none) or no frame drawn yet — and nothing while the desk is
    // inert to the pointer: an object in hand (D4b — a click there is the hand's; on the soft desk it puts the object down). The
    // drawer's inertness is the stack's own rule
    const pickAt = ctx.pickAt;
    const pickPoint = (point: { readonly x: number; readonly y: number }): PickResult | null => {
      if (typeof point?.x !== "number" || typeof point.y !== "number" || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        throw new Error(`[ice] desk: pick — the point is ${JSON.stringify(point) ?? String(point)}: { x, y } in CSS px of the view, two finite numbers`);
      }
      if (pickAt === undefined || ground === null || compose.lastInputs() === null || heldEntity(world) !== undefined) return null;
      const hit = pickAt(point.x, point.y);
      // an object has a type: a resize handle, a port, a wire — the frame's chrome — has none, and a click there selects nothing
      const type = hit === undefined ? undefined : world.get(hit.entity, PrefabId)?.id;
      if (hit === undefined || typeof type !== "string") return null;
      return { entity: hit.entity, type, canvas: frameParent(world) ?? NO_ENTITY, part: hit.part };
    };

    return {
      reflector,
      cursors,
      canvas,
      available: () => ground !== null && (status.state === "ready" || status.state === "degraded"),
      status: () => status,
      onStatus(listener) { statusHeard.add(listener); return () => { statusHeard.delete(listener); }; },
      device: () => drawDevice ?? undefined,
      ground: () => ground,
      setTheme: (t, p) => compose.setTheme(t, p),
      capture,
      pick: pickPoint,
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
      pinAsset(entity, asset) {
        // the kind's own asset rides the builder (`ctx.asset`) — the note's greeked lines; its committed raster lives in its writing since D2c
        builder.pin(entity, asset);
        compose.wake("pin");
      },
      pinFlux(entity, targets) { builder.pinFlux(entity, targets); compose.wake("pin"); },
      clearFlux() { builder.clearFlux(); compose.wake("pin"); },
      pinHold: (pin) => compose.pinBuild({ hold: pin }),
      hand: () => builder.hand(),
      setPortals: (on) => compose.pinBuild({ portals: on }),
      tuneLaw(kind, law) {
        if (faults.missing(kind)) return;   // nothing of a missing kind is called again (petition I24)
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
        if (drawDevice !== null && !disposed) { asked = true; instrument ??= instrumentSubmits(drawDevice); }
        return instrument;
      },
      profiler() {
        if (profiler === undefined && drawDevice !== null && !disposed) {
          const d = drawDevice;
          profiler = createGpuProfiler({
            device: d,
            // held while the profiler is armed; off again at its release unless the rigs' door asked for it
            submits: {
              hold: () => { holds += 1; instrument ??= instrumentSubmits(d); return instrument; },
              release: () => { holds -= 1; if (holds === 0 && !asked) { instrument?.detach(); instrument = undefined; } },
            },
            ledger: () => ledger,
          });
        }
        return profiler;
      },
      perf: () => ({ ...perf, kindTicks: { ...kindTicks }, boot: { ...boot } }),
      memory: () => budget.stats(),
      rasters: () => rasters.stats(),
      gpuMemory: () => ledger,
      records: () => {
        const out: Record<string, RecordStoreStats> = {};
        for (const k of objectKinds) { const s = ground?.pass(k.name)?.records?.(); if (s !== undefined) out[k.name] = s; }
        return out;
      },
      redraws: () => compose.redraws(),
      stats: () => compose.stats(),
      wakes: () => compose.wakes(),
      due: (now) => {
        const kinds: Record<string, number> = {};
        for (const [name, local] of locals) if (local.tick !== undefined) kinds[name] = dueOf(local, now);
        // a MISSING kind is a row whatever it declared (petition I24): no time — never due, nothing of it runs
        for (const f of faults.list()) kinds[f.kind] = KIND_MISSING;
        // the drivers with something to follow NOW (their `idle` asked — a rig's question, never the loop's)
        const busy: string[] = [];
        for (const [type, d] of drivers) if (d.idle?.() !== true) busy.push(type);
        return { at: deskDue(now), reflector: compose.due(now), drivers: following ? now : Number.POSITIVE_INFINITY, following: busy, woken: [...woken], kinds, tray: ground?.trayIdleAt() ?? Number.POSITIVE_INFINITY, rasters: rasters.size > 0 ? now : Number.POSITIVE_INFINITY };
      },
      geometryOf: (e) => builder.geometryOf(e),
      fluxOf: (e) => builder.fluxOf(e),
      lastInputs: () => compose.lastInputs(),
      // a kind still moving on its own is one DUE now (K7a): the last tick's want goes stale once the loop sleeps on its drawn frame
      dirty: () => {
        if (compose.dirty() || woken.size > 0) return true;
        const now = performance.now();
        for (const local of locals.values()) if (local.tick !== undefined && dueOf(local, now) <= now) return true;
        return false;
      },
      builder,
      local: (name) => locals.get(name),
      editor: () => editor,
      driver,
      selection: {
        anchor: () => anchorOf(),
        subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
      },
      desk: compose,
      tray: {
        open: () => openTray(world),
        close: () => closeTray(world),
        toggle: () => toggleTray(world),
        isOpen: () => trayOpen(world),
        scroll(px) {
          if (px !== undefined) scrollTray(world, px);
          const e = trayEntity(world);
          return e === undefined ? 0 : (world.get(e, Tray)?.scroll ?? 0);
        },
        state: () => ({
          ...compose.tray.state(), frame: compose.tray.frame(), laid: ground?.tray?.laid ?? null,
          // K5a: the specimens as the last frame drew them — each on screen, its pegs on screen, the scale its kind drew it at — its tags, its slots
          specimens: compose.traySpecimens().map((f) => ({ type: f.type, kind: f.kind, label: f.label, accessory: f.accessory, screen: f.screen, pegs: f.pegs, zoom: f.view.zoom, object: f.object })),
          tags: ground?.marks?.tagsLaid.length ?? 0,
          slots: ground?.traySlots?.size ?? 0,
          // K5b: what the tray carried last frame — the copy, a ghost growing or flying home — and the ghosts it drew for the desk
          carried: compose.trayCarried().map((f) => ({ type: f.type, phase: f.phase, ...(f.ghost !== undefined ? { ghost: f.ghost } : {}), screen: f.screen, zoom: f.view.zoom })),
          presented: [...compose.carry.presented()],
        }),
        pin(pin) { compose.tray.pin(pin); compose.wake("pin"); },
        category(id) {
          if (id !== undefined) setTrayCategory(world, id);
          return trayCategory(world);
        },
        categories: () => trayCategories(world),
        anchor: () => trayAnchorOf(),
        subscribe(listener) { trayListeners.add(listener); return () => { trayListeners.delete(listener); }; },
        focus: (to) => focusTray(world, to),
        lay(id, o = {}) {
          const ops = ctx.ops;
          if (ops === undefined) throw new Error("[ice] desk: tray.lay — the mount context has no engine ops (`createDeskHost` hands them: `LayerContext.ops`)");
          const space = o.space ?? "screen";
          if (space !== "screen" && space !== "world") throw new Error(`[ice] desk: tray.lay — space is "screen" or "world" (got ${String(space)})`);
          const vp = world.getResource(Viewport);
          const point = o.at ?? { x: (vp?.w ?? 0) / 2, y: (vp?.h ?? 0) / 2 };
          if (typeof point?.x !== "number" || typeof point.y !== "number" || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
            throw new Error(`[ice] desk: tray.lay — the point is ${JSON.stringify(point) ?? String(point)}: { x, y }, two finite numbers`);
          }
          const type = id ?? trayFocus(world);
          if (type === "") return undefined;
          const cam = world.getResource(Camera) ?? { x: 0, y: 0, zoom: 1 };
          return ops.layFromTray(type, space === "world" ? point : screenToWorld(point.x, point.y, cam));
        },
      },
      dispose() {
        disposed = true;
        stopWake?.();
        stopText?.();
        listeners.clear();
        trayListeners.clear();
        statusHeard.clear();
        for (const d of [...drivers.values(), ...parked]) d.dispose?.();   // the calendar's disposes its DOM half (a missing kind's parked ones too)
        editor.dispose();
        for (const local of locals.values()) local.dispose?.();
        motionQuery?.removeEventListener("change", syncMotion);
        if (framePick !== undefined && framePick.current === pick) framePick.current = null;
        if (navGeometry !== undefined && navGeometry.current === navSource) navGeometry.current = null;
        if (heldPose !== undefined && heldPose.current === poseSource) heldPose.current = null;
        if (trayPose !== undefined && trayPose.current === traySource) trayPose.current = null;
        detachTransition?.();
        compose.dispose();
        builder.dispose();
        canvas.remove();
        ground?.dispose();
        ground = null;
        profiler?.dispose();
        instrument?.detach();   // the engine's device goes on without the layer's wrappers
        instrument = undefined;
        ledger?.detach();
        if (ownDevice !== null) { ownDevice.destroy(); ownDevice = null; }   // the layer's own device: destroyed last
      },
    };
  };
}
