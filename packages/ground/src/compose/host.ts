// The ground as a LAYER of ICE's two presentation profiles (design-013 §8 B2,
// C2): one canvas in the L0 slot, one reflector drawing into the swap chain
// straight from the world, on the frame builder's dirty union (`frame-inputs.ts`),
// a camera or viewport change, a pole's move, a theme or type switch, or while
// a spring still moves — and never otherwise (idle-zero: a quiet frame does not
// touch the swap chain).
//
// ONE HOST, TWO FACTORIES (D-C2.3). `groundCompose` is the COMPOSITED profile's
// ground: it is handed the app-owned device and draws everything — the field,
// every card's frame in plate mode with its content term (B3a–B6), the DOM
// boundary (B3b), the live portals and the flight's second slot (B7), the root
// slot's overlays (C1). `groundField` is the STRATIFIED profile's ground (C2,
// what design-011's three-based `groundHost` used to be): it acquires its OWN
// device, runs the same builder for the SOURCES, the portals and the flight —
// the frame pass draws no cards (`frames: []` in every slot; the DOM draws
// them) — the same overlays, and the app's magnet POLES. Both are the one
// function below, differing by a MODE record, never by a copy: the field, the
// portals and the flight are the same code, and a second engine host would be
// the two-leg problem design-013 exists to end.
//
// PER-SLOT CONFIGS (D-C2.4). A canvas type DECLARES its ground
// (`presentation.ground: { glyph, grid, wires, guides }`); the host resolves
// the root slot's field config from the CURRENT type at every switch, a live
// portal's from its container's INSIDE type (the catalog's binding), and the
// flight's departed slot keeps the config it was drawn with at the cut. The
// react `grid` prop's re-tunes land on top of every one of them.
//
// POLES (D-C2.2). A pole flagged as the local pointer rides the field's
// analytic cursor term — its motion redraws and never re-bakes the atlas; every
// other pole is a degenerate source (`compose/poles.ts`).
//
// The factories have the shape the React facade's `ground` prop expects
// (`GroundLayerFactory`, mirrored structurally — this package may not import
// react); the composited profile recognises its handle by the `compose` field,
// the stratified one needs nothing of it.
//
// The reflector's PLACE in the roster is the profile's to fix (§6: the renders'
// queue ops before GpuCompose's submit, by registration order): the compose
// handle's own `reflector` is an inert slot and GpuCompose is handed to the
// profile through `compose`, to be registered last; the field handle's
// `reflector` IS its drawing reflector — the stratified roster has nothing to
// order it after.
//
// Reflector contract (design-002 §5): post-notify, output-only, never writes
// ECS, never reads layout — the viewport comes from the `Viewport` resource
// the facade's ResizeObserver writes, never from the container; the frame's dt
// from `FrameInfo` (clamped by the engine), never from a clock of its own.
import {
  Camera,
  type CanvasType,
  type EngineCatalog,
  type Entity,
  FrameInfo,
  type FramePickSlot,
  type FramePreviewStore,
  type GridConfig,
  NavTransition,
  PartTap,
  PrefabId,
  type PresentationTransitionAdapter,
  type ReflectorDef,
  type SnapGuidesConfig,
  Viewport,
  type WirePreviewBuffer,
  type WiresConfig,
  type World,
} from "@ice/core";
import type { RasterStrategy } from "@ice/kernel";
import { shellProgram } from "../card/program";
import { ENGINE_THEMES, LINES } from "../theme";
import { createDomHostWriter } from "./dom-compose";
import { createDomRender, type DomRender, type DomRenderStats, type DomRenderTuning } from "./dom-render";
import { type ContentResidency, createContentResidency } from "./residency";
import { createVideoIngest, type VideoIngest } from "./video-ingest";
import type { ShellGeometry } from "../card/geometry";
import type { CardMotion } from "../card/motion";
import type { CardProgram } from "../card/program";
import type { FrameInstance } from "../card/frame-pass";
import { acquire } from "../engine/device";
import { DEFAULT_FIELD_CONFIG, type FieldConfig, type FieldSource } from "../field/layout";
import type { GlyphProgram } from "../field/program";
import { changedElements, markAsSourceCanvas, onPaint, probeHic } from "../hic-adapter";
import { GROUND_SHADERS } from "../shaders";
import type { GroundTheme } from "../theme";
import { createFrameBuilder, type FlightInputs, type FrameBuilderOptions, type FrameBuilderStats, type WakeReason } from "./frame-inputs";
import { Ground, type GroundFrameInputs, type SlotInputs } from "./ground";
import { createOverlays, type OverlayStats } from "./overlays";
import { NO_POINTER, type PackedPoles, packPoles, type PoleSource } from "./poles";

/** The options both factories share: the look, the field, the builder's knobs, the overlays' look, the poles. */
export interface GroundHostOptions {
  /** The host's projection of its palette (a product's `--vf-*`; the lab's fixture) — the clear colour and every frame colour. */
  readonly theme?: GroundTheme;
  /** The field's BASE config; ICE's own defaults (`ENGINE_GRID`) unless a host projects its product's. A canvas type's declaration and the `grid` re-tunes layer over it. */
  readonly config?: FieldConfig;
  /** An initial `grid` re-tune (the old `ground({ grid })`): the same partial `configureGrid` and the react prop take, applied before the first frame. */
  readonly grid?: Partial<GridConfig>;
  /** The device-pixel ratio the canvas is capped at. */
  readonly maxDpr?: number;
  /** Grid programs beyond the engine's dot and line (`needleGlyph`, `cuttingMat` from `@ice/ground/packs`). */
  readonly grids?: readonly GlyphProgram[];
  /** The frame builder's knobs (material, lift, gate, cap …); the product's by default. */
  readonly cards?: Omit<FrameBuilderOptions, "previews" | "program" | "residency" | "insideConfig">;
  /**
   * The wires OVERLAY's look (design-013 C1): core's `WiresConfig` partial, the same
   * vocabulary the react prop takes. The overlay is registered either way — the canvas
   * type's `presentation.ground.wires` is what turns it off — so this is the colours and
   * the widths, never the switch.
   */
  readonly wires?: Partial<WiresConfig>;
  /** The snap guides overlay's look; `presentation.ground.guides` is its switch. */
  readonly guides?: Partial<SnapGuidesConfig>;
  /**
   * Magnet pole sources (design-010 §3.3; D-C2.2) — live app-authored objects, so they
   * live HERE, not in the plain-data GridConfig. Nothing wired ⇒ the field is card-only.
   * A pole flagged `pointer` rides the analytic cursor; the rest are sources.
   */
  readonly poles?: PoleSource | readonly PoleSource[];
}

export interface GroundComposeOptions extends GroundHostOptions {
  /** The app-owned device (`acquireCompositorDevice().device`); three adopts the same one for islands. */
  readonly device: GPUDevice;
  /** The compose host's theme is the product's — required here, where `groundField` may fall back to the engine's. */
  readonly theme: GroundTheme;
  /** The card program (design-014): the engine's shell unless the app registers its own (`vfFrame()` from `@ice/ground/packs`). */
  readonly card?: CardProgram<ShellGeometry>;
  /** A release on a card program's PART (`close`, `lock` …): the app's action. Routed at B3b. */
  readonly onPart?: (entity: Entity, part: string) => void;
  /**
   * How each surface kind wants its pixels rastered (design-013 §9 Q1). Declared ONCE, here:
   * the profile reads it off this handle and hands the SAME function to Residency, and DomRender
   * calls `geometry()` with it — one strategy, two readers, nothing to drift. Default `band`.
   */
  readonly raster?: (kind: "dom" | "gl" | "video") => RasterStrategy;
  /**
   * DomRender's levers (2026-09-09; `compose/dom-render.ts` header): the per-flush copy
   * budget and the batched 2D route. Absent ⇒ one element copy per dirty card, no budget —
   * the behaviour before them.
   */
  readonly dom?: DomRenderTuning;
}

export interface GroundFieldOptions extends GroundHostOptions {
  /** `navigator.gpu` unless a host hands another (a test's fake, Dawn's `create([])` in Node). */
  readonly gpu?: GPU;
  /**
   * Called once with the layer's OWN device, before the first frame — where a rig installs
   * `instrumentSubmits`, where an app attaches its diagnostics. The device is the layer's:
   * `dispose()` destroys it last.
   */
  readonly onDevice?: (device: GPUDevice) => void;
}

/** The mount context the React facade hands a `ground` factory — the fields this layer needs, mirrored structurally. */
export interface GroundComposeContext {
  readonly host: { readonly container: HTMLElement; readonly contentPlane: HTMLElement };
  readonly world: World;
  /** ICE's preview store (`engine.previews`): a container's inside for its live portal. Absent = no portals. */
  readonly previews?: FramePreviewStore;
  /**
   * The DOM hosts by entity, both halves (B3b + B4): `contentOf` is the dom reflector's `hostFor`
   * (the inner `data-ice-content` portal target) — DomCompose clips, lifts and fades it; `hostOf`
   * is `hostElementFor`, the OUTER host that reparents onto L1 and the node the element copy
   * addresses. Absent = no DOM writes; `hostOf` absent = no DomRender. The field host reads neither.
   */
  readonly hosts?: { contentOf(entity: Entity): HTMLElement | undefined; hostOf?(entity: Entity): HTMLElement | undefined };
  /** The interaction stack's frame pick slot: the ground's hit test over its last-drawn geometry goes here (B3b). Absent = the boxes pick. The field host leaves it alone (the DOM picks). */
  readonly framePick?: FramePickSlot;
  /**
   * The presentation transition coordinator (`engine.transitions`): the ground OWNS the `ground`
   * plane (B7). A cross-type flight is gated on every required plane preparing, and a canvas
   * type that declares a ground requires this one — without an owner every enter into a folder
   * is a snap. The ground needs no preparation: its second slot is built from the world each
   * frame, so the adapter prepares instantly and retains nothing. Absent = no registration.
   */
  readonly transitions?: { register(adapter: PresentationTransitionAdapter): () => void };
  /**
   * The current canvas type and its switch (`engine.canvas`): the ROOT slot's field config
   * (D-C2.4) and the overlay GATE (C1, D-C1.3) are both read off it at the mount and again on
   * every switch. Absent (a headless mount, a lab) = the base config, both overlays on.
   */
  readonly canvas?: { type(): CanvasType | undefined; subscribe(onChange: () => void): () => void };
  /**
   * The engine's catalog (`engine.catalog`), for a live PORTAL slot's config: the container's
   * inside canvas type is the catalog's binding (`canvasForContainer`), the same place the
   * preview store resolves the inside's arrival view. Absent = a portal draws with the config
   * its parent was built with.
   */
  readonly catalog?: Pick<EngineCatalog, "canvasForContainer">;
  /** The connect-drag preview buffer (`stack.wirePreview`) — the wires overlay's preview stroke. Absent = none. */
  readonly readWirePreview?: () => WirePreviewBuffer;
}
/** The same mount context, by the stratified factory's name. */
export type GroundFieldContext = GroundComposeContext;

/**
 * A render's place in the roster (design-013 §6 reflectors 5–7), filled AFTER the mount by
 * whoever owns the source: the ground itself (DomRender, B4), the r3f island root
 * (IslandRender, B5), the producer (VideoIngest, B6). The profile registers a forwarder for
 * each slot in §6's order, so a render installed later still runs before GpuCompose's submit.
 * `flush` follows the reflector contract: post-notify, never writes ECS, never reads layout.
 */
export interface RenderSlot {
  current: { readonly name: string; flush(world: World): void } | null;
}
export interface RenderSlots {
  readonly dom: RenderSlot;
  readonly island: RenderSlot;
  readonly video: RenderSlot;
}

/**
 * The L1 source canvas's half of the ground (B4). `@ice/dom` may not import `@ice/ground`, and
 * `hic-adapter` is the only module allowed to name a HiC symbol — so the canvas is the facade's
 * to build and the ADAPTER's to configure, meeting at this shape (the same injection
 * `SourceCanvasEffects` already uses).
 */
export interface SourceCanvasSlot {
  readonly effects: {
    markAsSourceCanvas(canvas: HTMLCanvasElement): void;
    onPaint(canvas: HTMLCanvasElement, handler: (event: Event) => void): () => void;
    changedElements(event: Event): readonly Element[];
  };
  /** A paint event named these immediate canvas children: they owe a copy. */
  onDirty(hosts: readonly Element[]): void;
}

/** The instruments both hosts keep: the ground's redraws, the root field's bakes, the last build's counts. */
export interface GroundHostStats extends FrameBuilderStats {
  readonly redraws: number;
  /** The ROOT slot's atlas bakes so far (D-C2.2's witness: a local-pointer gesture adds none; a remote pole's move adds one). */
  readonly bakes: number;
  /** The flight's second slot as last drawn (B7): its kind, progress and record count; `null` at rest. */
  readonly outgoing: { readonly kind: "enter" | "exit"; readonly p: number; readonly frozen: boolean; readonly frames: number; readonly at: number | null } | null;
  /** The root slot's overlays as last collected (design-013 C1): the two soups' vertex counts and their gate. */
  readonly overlays: OverlayStats;
  /** The poles as last packed: sources PREPENDED to the builder's, whether one rode the analytic pointer, and the pole wakes so far. */
  readonly poles: { readonly sources: number; readonly pointer: boolean; readonly wakes: number };
  /**
   * Live portal slots whose INSIDE canvas type did not resolve, cumulative (D-C4.4's neighbour in
   * the C4 wave): the slot fell back to its parent's config — the old silent behaviour, now counted.
   * A climbing count with a catalog attached is a container whose `canvasForContainer` binding is
   * missing, drawn in the wrong grid rather than refused.
   */
  readonly portalsUnresolved: number;
}

export interface GroundComposeStats extends GroundHostStats {
  /**
   * Z-runs in the LAST frame drawn (B5). A run breaks only where the `own` texture changes,
   * so this counts the card pass's bind-group switches — and > 1 is the witness that a
   * textured card really is interleaved in z with plate ones rather than drawn beside them.
   */
  readonly runs: number;
}

/** The field host's stats: the compose host's, plus how many frame records the cards pass was handed — 0 by construction (the DOM draws the cards). */
export interface GroundFieldStats extends GroundHostStats {
  readonly drawnFrames: number;
}

export interface GroundCompose {
  /** GpuCompose — the profile registers it LAST (after the renders): design-013 §6's order. */
  readonly gpuCompose: ReflectorDef;
  /**
   * DomCompose (B3b) — the profile registers it just BEFORE GpuCompose: it runs the frame's
   * build (the world's dirt, the springs) and writes every DOM card's boundary — `clip-path`
   * from the program's inner shape, the lift on `transform`, the hold's opacity — on the
   * content element; GpuCompose then draws the same geometry. Present only with `hosts`.
   */
  readonly domCompose?: ReflectorDef;
  /**
   * The content residency (B4a): the render reflectors realise the texture table's handles
   * here and say what they wrote; the builder draws `page`/`own` from it. The profile attaches
   * its table at install.
   */
  readonly residency: ContentResidency;
  /**
   * VideoIngest (B6) — the producer's door for a live surface: `register` claims the stable
   * texture Residency will name, `arrive` hands over each frame, and the copy happens in the
   * `video` render slot before GpuCompose's submit. Installed at the mount; a board with no
   * live surface costs it nothing.
   */
  readonly video: VideoIngest;
  /** The three render slots (§6 reflectors 5–7); the profile forwards each in order. */
  readonly renders: RenderSlots;
  /**
   * What the L1 SOURCE CANVAS needs and only the HiC adapter can supply (B4): the injected
   * effects `@ice/dom`'s `createSourceCanvas` takes, and the dirt latch a paint event feeds.
   * The facade builds the canvas from this and passes it to the dom reflector, which parents
   * every `gpu`-target host under it. `null` when the host has no HTML-in-Canvas: nothing is
   * refused, DomRender simply never copies and every card draws its plate.
   */
  readonly sourceCanvas: SourceCanvasSlot | null;
  /** DomRender's instruments (B4) — copies, refusals, the clamp's parked/deferred sets, the page array. Present only with `hosts.hostOf`. */
  readonly domRender: { stats(): DomRenderStats } | null;
  /** The raster strategy this ground was built with — the profile hands the SAME function to Residency (§9 Q1). */
  readonly raster?: (kind: "dom" | "gl" | "video") => RasterStrategy;
  /** The canvas in the L0 slot. */
  readonly canvas: HTMLCanvasElement;
  /** `Ground.create` resolved; false while the pipelines compile or after a failure. */
  available(): boolean;
  /** Whole-frame renders so far — the churn instrument (0 on an idle scene). */
  redraws(): number;
  /** The host's projection changed (a theme switch): the next frame re-renders. */
  setTheme(theme: GroundTheme): void;
  /** The redraw count and the last build's counts (cards, portals, the cap). */
  stats(): GroundComposeStats;
  /** What woke the builder, and how often, since the mount — names the fact behind a churning frame. */
  wakes(): Readonly<Record<WakeReason, number>>;
  /** DOM boundary writes so far, and clip polygons computed (B3b's churn instruments). */
  domWrites(): { readonly writes: number; readonly clips: number };
  /** A card's geometry as last drawn (the rig's witness; B3b's hit test) — the program's, on the engine's head. */
  geometryOf(e: Entity): ShellGeometry | undefined;
  /** A card's springs as last stepped — flux, never a world fact. */
  motionOf(e: Entity): CardMotion | undefined;
  /** The inputs of the last render, as handed to `Ground.render` — the rig's witness for what a frame was built from. */
  lastInputs(): GroundFrameInputs | null;
}

/** Where the field host is in its life: acquiring its device and compiling, drawing, or stopped — and why. */
export interface GroundFieldStatus {
  readonly state: "pending" | "ready" | "failed";
  readonly message?: string;
}

/** The field host's instruments: what `GroundCompose` keeps that the stratified profile can read, and the layer's own device. */
export interface GroundField {
  /** The canvas in the L0 slot — opaque, cleared to the theme's ground; the DOM planes sit above it. */
  readonly canvas: HTMLCanvasElement;
  /** The device is acquired and `Ground.create` resolved; false while pending, after a refused adapter, a failed compile, a lost device. */
  available(): boolean;
  status(): GroundFieldStatus;
  /** The layer's OWN device once acquired — a diagnostic seam (`instrumentSubmits`, a rig's error count); `undefined` before, and after a refusal. */
  device(): GPUDevice | undefined;
  /** Whole-frame renders so far — the churn instrument (0 on an idle scene). */
  redraws(): number;
  /** The host's projection changed (a theme switch): the next frame re-renders. */
  setTheme(theme: GroundTheme): void;
  stats(): GroundFieldStats;
  wakes(): Readonly<Record<WakeReason, number>>;
  /** A card's silhouette as last built — what the field bent around (the rig's witness). */
  geometryOf(e: Entity): ShellGeometry | undefined;
  /** The inputs of the last render, as handed to `Ground.render`: every slot's config, sources and (empty) frames. */
  lastInputs(): GroundFrameInputs | null;
  /** The ROOT slot's field config as resolved now — the current type's declaration under the `grid` re-tunes (D-C2.4). */
  config(): FieldConfig;
}

/** What the composited factory returns: the facade's `GroundLayerHandle` shape, plus `compose`. */
export interface GroundComposeHandle {
  /** The ground-layer slot the facade registers first — inert here: the drawing is `compose.gpuCompose`'s, registered last. */
  readonly reflector: ReflectorDef & { available(): boolean };
  configureGrid(cfg: Partial<GridConfig>): void;
  dispose(): void;
  readonly compose: GroundCompose;
}

/** What the stratified factory returns: the facade's `GroundLayerHandle` shape, plus `field` — and NO `compose`, so the composited profile refuses it. */
export interface GroundFieldHandle {
  /** The drawing reflector itself (`ground/field`): the facade registers it right after the planes, where the stratified roster has always had its ground. */
  readonly reflector: ReflectorDef & { available(): boolean };
  configureGrid(cfg: Partial<GridConfig>): void;
  dispose(): void;
  readonly field: GroundField;
}

export type GroundComposeFactory = (ctx: GroundComposeContext) => GroundComposeHandle;
export type GroundFieldFactory = (ctx: GroundFieldContext) => GroundFieldHandle;

// ---------------------------------------------------------------- configs

/**
 * The react `grid` prop's config onto the field's: what maps, maps — the
 * magnet block's glyph, reach, polarity, alignment and needle size, the ink and
 * its alpha. `fadeIn` and `dotRadius` are the field's own laws (`ENGINE_GRID`);
 * the magnet block's `widgets`, `widgetStrength`, `widgetRadius`, `maxSources`
 * and `fadeZoom` are the old magnet grid's vocabulary with no field reader
 * (named in C2's landing log).
 */
export function fieldConfigOf(base: FieldConfig, cfg: Partial<GridConfig>): FieldConfig {
  const m = cfg.magnet ?? {};
  return {
    ...base,
    ...(m.glyph !== undefined ? { glyph: m.glyph } : {}),
    ...(m.reach !== undefined ? { reach: m.reach } : {}),
    ...(m.polarity !== undefined ? { polarity: m.polarity } : {}),
    ...(m.alwaysAlign !== undefined ? { alwaysAlign: m.alwaysAlign } : {}),
    ...(m.needleLength !== undefined ? { halfLen: m.needleLength } : {}),
    ...(m.needleWidth !== undefined ? { halfWidth: m.needleWidth } : {}),
    ...(cfg.dotColor !== undefined ? { ink: cfg.dotColor } : {}),
    ...(cfg.dotAlpha !== undefined ? { inkAlpha: cfg.dotAlpha } : {}),
  };
}

/** `configureGrid`'s merge: one level deep on the magnet block, so `{ magnet: { reach: 80 } }` never clobbers the rest of it. */
export function mergeGridConfig(a: Partial<GridConfig>, b: Partial<GridConfig>): Partial<GridConfig> {
  return { ...a, ...b, ...(a.magnet !== undefined || b.magnet !== undefined ? { magnet: { ...(a.magnet ?? {}), ...(b.magnet ?? {}) } } : {}) };
}

/** A canvas type's ground declaration (`presentation.ground`), as the host reads it. */
export type GroundDeclaration = { readonly glyph?: string; readonly grid?: Partial<GridConfig> } | undefined;

/**
 * A slot's field config (D-C2.4): the base, the canvas type's declaration over
 * it — its glyph, then its grid partial — and the `grid` re-tunes over that.
 * The base itself when there is nothing to apply.
 */
export function slotFieldConfig(base: FieldConfig, declaration: GroundDeclaration, overrides: Partial<GridConfig>): FieldConfig {
  const glyph = declaration?.glyph;
  const grid = declaration?.grid;
  const hasOverrides = Object.keys(overrides).length > 0;
  if (glyph === undefined && grid === undefined && !hasOverrides) return base;
  let cfg = glyph !== undefined ? { ...base, glyph } : base;
  if (grid !== undefined) cfg = fieldConfigOf(cfg, grid);
  if (hasOverrides) cfg = fieldConfigOf(cfg, overrides);
  return cfg;
}

/**
 * The theme `groundField()` falls back to when a host projects none (D-C4.4): the OS
 * preference AT THE MOUNT, read once. A dark product that ported `ground()` to
 * `groundField()` verbatim used to get a white viewport; it now gets its own end of the
 * pair. Not live-tracked — a switch while the app runs is the app's `setTheme`, which is
 * the only place that knows what else moves with it. Light where `matchMedia` is absent
 * (Node, a lab, the oracle).
 */
export function defaultTheme(): GroundTheme {
  return globalThis.matchMedia?.("(prefers-color-scheme: dark)")?.matches === true ? ENGINE_THEMES.dark : ENGINE_THEMES.light;
}

// ---------------------------------------------------------------- the host

/** How the one host is built: the composited profile's (a device handed in, the cards drawn) or the stratified profile's (its own device, sources only). */
type HostMode =
  | { readonly kind: "composited"; readonly opts: GroundComposeOptions }
  | { readonly kind: "stratified"; readonly opts: GroundFieldOptions };

const NO_FRAMES: readonly FrameInstance[] = Object.freeze([]);

/**
 * A slot DRESSED by the host, its nested portals too: the analytic pointer on every slot
 * (the cursor is a SCREEN point — the same point in a portal's inside, in the departed frame
 * under its own camera, in the root — so the cut moves no pixel near it), and under the
 * stratified profile the frames dropped (the field host draws no cards in any slot, D-C2.3).
 */
function dressSlot<T extends SlotInputs>(s: T, pointer: SlotInputs["pointer"], frames: boolean): T {
  return {
    ...s,
    pointer,
    ...(frames ? {} : { frames: NO_FRAMES }),
    ...(s.portals !== undefined ? { portals: s.portals.map((p) => dressSlot(p, pointer, frames)) } : {}),
  };
}

interface HostInternals {
  readonly canvas: HTMLCanvasElement;
  readonly draw: ReflectorDef;
  readonly domCompose: ReflectorDef | null;
  readonly residency: ContentResidency | null;
  readonly video: VideoIngest | null;
  readonly renders: RenderSlots | null;
  readonly sourceCanvas: SourceCanvasSlot | null;
  readonly domRender: DomRender | null;
  available(): boolean;
  status(): GroundFieldStatus;
  device(): GPUDevice | undefined;
  redraws(): number;
  setTheme(theme: GroundTheme): void;
  stats(): GroundHostStats & { readonly runs: number; readonly drawnFrames: number };
  wakes(): Readonly<Record<WakeReason, number>>;
  domWrites(): { readonly writes: number; readonly clips: number };
  geometryOf(e: Entity): ShellGeometry | undefined;
  motionOf(e: Entity): CardMotion | undefined;
  lastInputs(): GroundFrameInputs | null;
  config(): FieldConfig;
  configureGrid(cfg: Partial<GridConfig>): void;
  dispose(): void;
}

function createGroundHost(mode: HostMode, ctx: GroundComposeContext): HostInternals {
  const composited = mode.kind === "composited";
  const opts = mode.opts;
  const compose = mode.kind === "composited" ? mode.opts : null;
  const { host, world } = ctx;
  const maxDpr = opts.maxDpr ?? 2;
  const program = compose?.card ?? shellProgram;
  const poles: readonly PoleSource[] = opts.poles === undefined ? [] : Array.isArray(opts.poles) ? opts.poles : [opts.poles as PoleSource];

  // ---- the configs (D-C2.4): the base, the type's declaration, the re-tunes
  const base = opts.config ?? DEFAULT_FIELD_CONFIG;
  let overrides: Partial<GridConfig> = opts.grid ?? {};
  const configFor = (type: CanvasType | undefined): FieldConfig => slotFieldConfig(base, type?.presentation?.ground, overrides);
  const currentType = (): CanvasType | undefined => {
    try {
      return ctx.canvas?.type();
    } catch {
      return undefined;   // a headless or half-built canvas seam must not take the ground down
    }
  };
  let rootType = currentType();
  let rootConfig = configFor(rootType);
  // the config the departed frame was drawn with at the cut — the flight's second slot keeps it (a switch flips the root's)
  let departedConfig = rootConfig;
  /** A live portal's config from its container's INSIDE type (the catalog's binding); the parent's when nothing resolves — COUNTED, never silent. */
  let portalsUnresolved = 0;
  const insideConfig = (container: Entity, config: FieldConfig): FieldConfig => {
    const id = world.get(container, PrefabId)?.id;
    const type = typeof id === "string" ? ctx.catalog?.canvasForContainer(id) : undefined;
    if (type === undefined) { portalsUnresolved += 1; return config; }
    return configFor(type);
  };

  // ---- the content pipeline (composited only): the residency, the renders, the video door
  const residency = composited ? createContentResidency(world) : null;
  const renders: RenderSlots | null = composited ? { dom: { current: null }, island: { current: null }, video: { current: null } } : null;
  // The video render is the ground's own (B6): the producer drives it from outside, so its
  // slot is filled here rather than after the mount like the dom and island renders.
  const video = compose !== null && residency !== null ? createVideoIngest({ device: compose.device, world, residency }) : null;
  if (renders !== null && video !== null) renders.video.current = video.reflector;
  const builder = createFrameBuilder(world, {
    ...(opts.cards ?? {}),
    ...(compose?.card !== undefined ? { program: compose.card } : {}),
    ...(ctx.previews !== undefined ? { previews: ctx.previews } : {}),
    ...(residency !== null ? { residency } : {}),
    insideConfig,
  });
  // The ROOT slot's overlays (design-013 C1): the wires under the cards, the guides over them,
  // gated by the canvas type and collected in screen px on the frames whose facts or camera moved.
  const overlays = createOverlays(world, {
    ...(opts.wires !== undefined ? { wires: opts.wires } : {}),
    ...(opts.guides !== undefined ? { guides: opts.guides } : {}),
    ...(ctx.canvas !== undefined ? { canvas: ctx.canvas } : {}),
    ...(ctx.readWirePreview !== undefined ? { readWirePreview: ctx.readWirePreview } : {}),
  });
  const doc = host.container.ownerDocument;
  const canvas = doc.createElement("canvas");
  canvas.style.position = "absolute";
  canvas.style.left = "0";
  canvas.style.top = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  // P0 is never a DOM hit target (the router owns picking, design-004 §4).
  canvas.style.pointerEvents = "none";
  // The whole ground stratum is this ONE canvas, immediately before content (the old layer's placement).
  host.container.insertBefore(canvas, host.contentPlane);

  let ground: Ground | null = null;
  /** The device was lost: the layer is over for good (D-C4.3) — nothing renders, and a late `Ground.create` is released. */
  let ended = false;
  let status: GroundFieldStatus = { state: "pending" };
  let ownDevice: GPUDevice | null = null;
  let disposed = false;
  let dirty = true;
  let redraws = 0;
  let poleWakes = 0;
  let lastPages: GPUTextureView | null = null;
  let theme: GroundTheme = opts.theme ?? defaultTheme();
  // The boundary writer is keyed by the ELEMENT (D-C4.8), so it needs no liveness oracle and no sweep.
  const writer = composited && ctx.hosts !== undefined ? createDomHostWriter(program, ctx.hosts.contentOf) : null;
  let domWrites = 0;
  // DomRender (B4, §6 reflector 5). Built EAGERLY — the dirt latch has to be
  // able to take a paint event from the first one — but installed into its
  // roster slot only once `Ground.create` resolves, so nothing copies into a
  // page array that no frame can yet sample. Its debt is kept meanwhile.
  const hostOf = composited ? ctx.hosts?.hostOf : undefined;
  const domRender: DomRender | null =
    hostOf === undefined || compose === null || residency === null
      ? null
      : createDomRender({
          device: compose.device,
          world,
          residency,
          hosts: { hostOf },
          ...(compose.raster !== undefined ? { raster: compose.raster } : {}),
          ...(compose.dom !== undefined ? { tuning: compose.dom } : {}),
        });
  // The L1 source canvas is the FACADE's to build (it owns the container and
  // the viewport it must be resized with); what only this package can supply
  // is the adapter's effects and the dirt latch. `null` when the host has no
  // HTML-in-Canvas — including the `layoutsubtree` capability, which
  // `probeHic` reports but does not require: a canvas whose children do not
  // lay out would host every promoted card at 0×0.
  const probe = domRender === null ? null : probeHic(doc);
  const sourceCanvas: SourceCanvasSlot | null =
    domRender === null || probe === null || !probe.supported || !probe.capabilities.layoutSubtree
      ? null
      : { effects: { markAsSourceCanvas, onPaint, changedElements }, onDirty: (els) => domRender.markDirtyHosts(els) };
  // The frame's build happens ONCE per tick, in the first of the ground's reflectors to run
  // (DomCompose when the profile registers it, else the draw); the other draws what was built.
  let builtTick = -1;
  let pending: { readonly view: { camX: number; camY: number; zoom: number; width: number; height: number; dpr: number }; readonly built: ReturnType<typeof builder.build>; readonly flight: FlightInputs | null; readonly overlays: ReturnType<typeof overlays.build>; readonly poles: PackedPoles } | null = null;
  let lastFlight: GroundHostStats["outgoing"] = null;
  let lastInputs: GroundFrameInputs | null = null;
  let lastPoles: PackedPoles = { pointer: NO_POINTER, sources: [] };
  let drawnFrames = 0;
  const ensureBuilt = (w: World): boolean => {
    const tick = w.getResource(FrameInfo)?.tick ?? -1;
    const first = !(tick >= 0 && builtTick === tick);
    if (first) {
      builtTick = tick;
      // The world's dirt is PULLED every frame (the journal drains); the out-of-world wakes set
      // `dirty`. ALL THREE pulls run unconditionally, and ABOVE the pre-ready return (D-C4.9's
      // third pull; the return used to skip every one of them): a short-circuit would leave a
      // journal undrained and its next `changed()` would answer for two frames at once.
      const builderDirt = builder.changed();
      const overlayDirt = overlays.changed();
      let poleDirt = false;
      for (const s of poles) if (s.changed?.(w) === true) poleDirt = true;
      if (poleDirt) poleWakes += 1;   // a pulled pole move is the same fact the subscription reports
      if (builderDirt || overlayDirt || poleDirt) dirty = true;
    }
    if (ground === null || ended) return false;   // pre-ready, or the layer is over (D-C4.3)
    if (!first) return pending !== null;
    if (!dirty) { pending = null; return false; }
    const cam = w.getResource(Camera);
    const vp = w.getResource(Viewport);
    if (cam === undefined || vp === undefined || vp.w <= 0 || vp.h <= 0) { pending = null; return false; }   // no viewport yet: stay dirty, paint when it exists
    const dpr = Math.min(vp.dpr > 0 ? vp.dpr : 1, maxDpr);
    const width = Math.max(1, Math.round(vp.w * dpr));
    const height = Math.max(1, Math.round(vp.h * dpr));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    dirty = false;
    // the frame's dt, ms clamped by the engine (design-002 §1) — a first frame before FrameInfo exists steps one nominal frame
    const dtMs = w.getResource(FrameInfo)?.dt ?? 16;
    const camera = { x: cam.x, y: cam.y, zoom: cam.zoom };
    const viewport = { width: vp.w, height: vp.h, dpr };
    const built = builder.build(camera, viewport, dtMs / 1000, theme, rootConfig);
    // a nav flight's second slot (B7): the departed frame beside the arriving one, in the config it was drawn with at the cut
    const flight = builder.flight(camera, viewport, theme, departedConfig);
    // the root's overlays, in the LIVE camera's screen px (D-C1.3): the frame the collectors see is this one
    const over = overlays.build({ width: vp.w, height: vp.h, dpr, camera });
    // the poles (D-C2.2), read on the dirty frame only: the pointer onto the analytic term, the rest as sources
    const packed = poles.length === 0 ? lastPoles : packPoles(poles.flatMap((s) => s.read(w)), camera);
    pending = { view: { camX: cam.x, camY: cam.y, zoom: cam.zoom, width: vp.w, height: vp.h, dpr }, built, flight, overlays: over, poles: packed };
    if (builder.live()) dirty = true;   // a spring still moves: the next frame paints too
    return true;
  };
  // The frame pick source (B3b, composited only — the DOM picks under the stratified profile): the router asks the ground what is
  // under a point on a card — its last-drawn geometry through the program's own hit test. A card the builder has no geometry for
  // (before the first build, before its first draw, after a failed creation) answers `undefined`, never `outside`: the router
  // keeps the box tier's hit, so a card is clickable from the moment it exists (B9 review blocker 1).
  const framePick = composited ? ctx.framePick : undefined;
  const pickSource = {
    pad: () => { const r = opts.cards?.radius ?? 0; return (program.reach?.(r) ?? program.source(0, 0, 1, r).hx) + LINES.ring + 2; },
    hit: (e: Entity, x: number, y: number): string | undefined => { const G = builder.geometryOf(e); return G === undefined ? undefined : program.pick(G, x, y); },
    // a spring still moves: the geometry under a STILL pointer is changing, so the router picks again (B9 review)
    live: () => builder.live(),
  };
  if (framePick !== undefined) framePick.current = pickSource;

  // ---- the device: the app's (composited), or the layer's own (stratified) — async either way,
  // and a refusal is a loud error and an unavailable layer, never a throw in the frame.
  const fail = (what: string, e: unknown): void => {
    status = { state: "failed", message: `${what}: ${e instanceof Error ? e.message : String(e)}` };
    console.error(`[ice] ground/${composited ? "compose" : "field"}: ${what}`, e);
  };
  /**
   * THE LAYER IS OVER (D-C4.3). A lost device cannot draw, and the ground kept rendering into a
   * dead one: the last opaque frame stayed painted while the DOM panned above it. The layer ends
   * instead — the ground disposed and nulled (so no `render` ever runs again, including one
   * resolving after the loss), the canvas removed so the page shows through, `available()` false
   * and `status()` `failed` for the facade to read. Idempotent; NOT a dispose (the host's
   * subscriptions and its own device are `dispose()`'s, whoever mounted it).
   */
  const endLayer = (): void => {
    if (ended) return;
    ended = true;
    const g = ground;
    ground = null;
    g?.dispose();
    canvas.remove();
  };
  const createOn = (device: GPUDevice): Promise<Ground> =>
    Ground.create({ device, canvas, ...GROUND_SHADERS, ...(compose?.card !== undefined ? { card: compose.card } : {}), ...(opts.grids !== undefined ? { grids: opts.grids } : {}), overlays: overlays.programs });
  const acquireOwn = (own: GroundFieldOptions): Promise<GPUDevice> => {
    const gpu = own.gpu ?? (typeof navigator !== "undefined" ? navigator.gpu : undefined);
    if (gpu === undefined) return Promise.reject(new Error("WebGPU is unavailable here (no navigator.gpu)"));
    return acquire({
      gpu,
      label: "ground/field",
      onLost: (info) => { if (disposed || ended) return; fail("the device was lost", new Error(`${info.reason}: ${info.message}`)); endLayer(); },
      onError: (error) => { console.error("[ice] ground/field: uncaptured GPU error", error.message); },
    }).then((g) => {
      ownDevice = g.device;
      // Disposed while the adapter answered (StrictMode's double mount, HMR): the device is nobody's — destroy it here, or it leaks whole.
      if (disposed) { g.device.destroy(); ownDevice = null; throw new Error("disposed before the device arrived"); }
      own.onDevice?.(g.device);
      return g.device;
    });
  };
  // The COMPOSITED device is the app's — subscribing to its loss is free and the layer's end is the
  // same (D-C4.3). The app owns the device itself; what ends here is this ground on it.
  if (compose !== null) {
    void compose.device.lost?.then((info) => {
      if (disposed || ended) return;
      fail("the device was lost", new Error(`${info.reason}: ${info.message}`));
      endLayer();
    });
  }
  // the composited path calls `Ground.create` synchronously (its device is in hand); the field path first acquires its own
  const created: Promise<Ground> = mode.kind === "composited" ? createOn(mode.opts.device) : acquireOwn(mode.opts).then(createOn);
  created
    .then(
      (g) => {
        // Disposed while the pipelines compiled (StrictMode's double mount, HMR), or the device was
        // lost while they did (D-C4.3): the ground is nobody's — release it here, or it leaks whole.
        if (disposed || ended) { g.dispose(); return; }
        g.fieldConfig = rootConfig;
        ground = g;
        status = { state: "ready" };
        // The render is the ground's own, and it takes §6's slot 5 — before
        // DomCompose and GpuCompose, so its copies are queue ops already
        // ordered against the submit that samples them.
        if (renders !== null && domRender !== null) renders.dom.current = domRender;
        dirty = true;   // the deferred pre-ready flushes are owed one paint
      },
      (e: unknown) => { if (disposed) return; fail(composited ? "Ground.create failed" : "no ground — the adapter, the device or the pipelines were refused", e); },
    );
  // the ground plane's transition adapter (B7): prepared the moment it is asked — the flight IS the second slot
  const detachTransition = ctx.transitions?.register({ id: composited ? "@ice/ground/compose" : "@ice/ground/field", plane: "ground", prepare: () => null }) ?? null;
  let lastTap = 0;
  const unsubs: Array<() => void> = [
    world.reactive.observeResource(Camera, () => { dirty = true; }),
    world.reactive.observeResource(Viewport, () => { dirty = true; }),
    // a flight writes its progress every tick (and the camera): the departed slot moves
    world.reactive.observeResource(NavTransition, () => { dirty = true; }),
    builder.observe(() => { dirty = true; }),
    // a canvas switch flips the overlay gate: the next frame repaints without them (or with them)
    overlays.observe(() => { dirty = true; }),
    // A canvas switch re-resolves the ROOT slot's config (D-C2.4). The departed slot's config is
    // snapshotted at EVERY canvas-session change and BEFORE the root re-resolves (D-C4.2): the cut
    // takes the config the departed frame was drawn with, and a SAME-TYPE enter (board → board) is
    // a cut like any other. Taking it only past the type test left the second slot drawing in the
    // config from before the last type change, and the enter popped.
    ...(ctx.canvas !== undefined
      ? [ctx.canvas.subscribe(() => {
          if (disposed) return;
          departedConfig = rootConfig;
          dirty = true;
          const next = currentType();
          if (next === rootType) return;
          rootType = next;
          rootConfig = configFor(rootType);
          if (ground !== null) ground.fieldConfig = rootConfig;
        })]
      : []),
    // a pole's move is an out-of-world wake (a pointer entity's write, a halo's ease, a remote cursor)
    ...poles.map((s) => s.subscribe(world, () => { poleWakes += 1; dirty = true; })),
    // a tap on a card program's PART (B3b): the router hands it over as a resource; the app's action is `onPart`
    ...(compose !== null
      ? [world.reactive.observeResource(PartTap, () => {
          const t = world.getResource(PartTap);
          if (t === undefined || t.seq === lastTap) return;
          lastTap = t.seq;
          // Handed to the app OUTSIDE the notify — on a microtask, after this frame's synchronous step has returned. The app's
          // action is an op (a close button despawns), and a structural write inside an observer's emit is ignored by strata's
          // dev build (a console error) and unguarded in prod (B9 review).
          const { target, part } = t;
          queueMicrotask(() => { if (!disposed) compose.onPart?.(target, part ?? ""); });
        })]
      : []),
  ];

  // DomCompose (B3b, composited only): the build, then the DOM boundary of every card on screen.
  const domCompose: ReflectorDef | null = writer === null ? null : {
    name: "ground/dom-compose",
    always: true,
    flush(w) {
      if (!ensureBuilt(w)) return;
      domWrites += writer.write(builder.entries());
    },
  };

  const draw: ReflectorDef = {
    name: composited ? "ground/gpu-compose" : "ground/field",
    always: true,
    flush(w) {
      // The destroy list is drained on EVERY roster tick, drawn or not: a render slot can realise (and so retire) textures on a frame that
      // paints nothing — a hidden or zero-size canvas — and what a retired texture was last sampled by is an earlier frame's submit, already issued.
      if (!ensureBuilt(w) || ground === null || pending === null) { residency?.collect(); return; }
      const { view, built, flight, overlays: over, poles: packed } = pending;
      pending = null;
      lastPoles = packed;
      // the page array every `page` card samples — rebound only when the residency re-realised it (growth, D-B4.1)
      if (residency !== null) {
        const pages = residency.pagesView();
        if (pages !== lastPages) { ground.setPages(pages); lastPages = pages; }
      }
      // every slot is dressed with the pointer; the field host drops every slot's frames — its sources and portals kept (D-C2.3)
      const pointer = packed.pointer;
      const frames = composited ? built.frames : NO_FRAMES;
      const portals = built.portals.map((p) => dressSlot(p, pointer, composited));
      const outgoing = flight === null ? null : dressSlot(flight.outgoing, pointer, composited);
      // The poles come FIRST (D-C4.9): `packSources` truncates at `MAX_SOURCES` in order, so past
      // the cap a crowded board drops its far CARDS and never the cursor that is being looked at.
      const sources: readonly FieldSource[] = packed.sources.length === 0 ? built.sources : [...packed.sources, ...built.sources];
      const inputs: GroundFrameInputs = {
        view,
        pointer,
        sources,
        frames,
        ...(portals.length ? { portals } : {}),
        ...(over !== undefined ? { overlays: over } : {}),
        ...(flight !== null && outgoing !== null ? { present: flight.present, outgoing, lodZoom: flight.lodZoom } : {}),
        theme,
      };
      lastInputs = inputs;
      const stats = ground.render(inputs);
      drawnFrames = stats.frames;
      lastFlight = flight === null || outgoing === null ? null : { kind: flight.kind, p: flight.p, frozen: flight.frozen, frames: outgoing.frames.length, at: outgoing.at ?? null };
      redraws += 1;
      residency?.collect();   // the destroy list, after this frame's submit
    },
  };

  return {
    canvas,
    draw,
    domCompose,
    residency,
    video,
    renders,
    sourceCanvas,
    domRender,
    available: () => ground !== null && status.state === "ready",
    status: () => status,
    device: () => (composited ? compose?.device : ownDevice ?? undefined),
    redraws: () => redraws,
    setTheme(next) { theme = next; dirty = true; },
    stats: () => ({
      redraws,
      bakes: ground?.field.stats.bakes ?? 0,
      outgoing: lastFlight,
      runs: ground?.frames.runCount ?? 0,
      drawnFrames,
      overlays: overlays.stats(),
      poles: { sources: lastPoles.sources.length, pointer: lastPoles.pointer.on, wakes: poleWakes },
      portalsUnresolved,
      ...builder.stats(),
    }),
    wakes: () => builder.wakes(),
    domWrites: () => ({ writes: domWrites, clips: writer?.clips ?? 0 }),
    geometryOf: (e) => builder.geometryOf(e),
    motionOf: (e) => builder.motionOf(e),
    lastInputs: () => lastInputs,
    config: () => rootConfig,
    configureGrid(cfg) {
      overrides = mergeGridConfig(overrides, cfg);
      rootConfig = configFor(rootType);
      // At REST the departed slot's config and the root's are one config, so a re-tune moves both
      // (D-C4.2). Mid-flight it must not: the second slot draws the frame that departed, in the
      // config the cut left it with.
      if (world.getResource(NavTransition)?.active !== true) departedConfig = rootConfig;
      if (ground !== null) ground.fieldConfig = rootConfig;
      dirty = true;
    },
    dispose() {
      disposed = true;
      for (const u of unsubs) u();
      unsubs.length = 0;
      if (framePick !== undefined && framePick.current === pickSource) framePick.current = null;
      detachTransition?.();
      if (renders !== null && renders.dom.current === domRender) renders.dom.current = null;
      domRender?.dispose();
      writer?.dispose();
      builder.dispose();
      overlays.dispose();
      if (renders !== null && video !== null && renders.video.current === video.reflector) renders.video.current = null;
      video?.dispose();
      residency?.dispose();
      canvas.remove();
      ground?.dispose();
      ground = null;
      // the device is the layer's own under the stratified profile: destroyed LAST, after everything on it
      if (ownDevice !== null) { ownDevice.destroy(); ownDevice = null; }
    },
  };
}

/** The COMPOSITED profile's ground: the app's device, the cards drawn, the content pipeline — recognised by the handle's `compose`. */
export function groundCompose(opts: GroundComposeOptions): GroundComposeFactory {
  return (ctx) => {
    const h = createGroundHost({ kind: "composited", opts }, ctx);
    const residency = h.residency;
    const video = h.video;
    const renders = h.renders;
    if (residency === null || video === null || renders === null) throw new Error("ice: ground/compose built without its content pipeline");
    return {
      reflector: { name: "ground/compose-slot", always: false, flush() {}, available: () => h.available() },
      configureGrid: (cfg) => h.configureGrid(cfg),
      dispose: () => h.dispose(),
      compose: {
        gpuCompose: h.draw,
        residency,
        video,
        renders,
        sourceCanvas: h.sourceCanvas,
        domRender: h.domRender,
        ...(opts.raster !== undefined ? { raster: opts.raster } : {}),
        ...(h.domCompose !== null ? { domCompose: h.domCompose } : {}),
        canvas: h.canvas,
        available: () => h.available(),
        redraws: () => h.redraws(),
        setTheme: (t) => h.setTheme(t),
        stats: () => { const { drawnFrames: _drawn, ...rest } = h.stats(); return rest; },
        wakes: () => h.wakes(),
        domWrites: () => h.domWrites(),
        geometryOf: (e) => h.geometryOf(e),
        motionOf: (e) => h.motionOf(e),
        lastInputs: () => h.lastInputs(),
      },
    };
  };
}

/**
 * The STRATIFIED profile's ground (design-013 C2, D-C2.3): the field, the live
 * portals, the flight's second slot, the wires and the guides — on the engine,
 * on a device of its own, with no card drawn (the DOM draws them above it).
 * Usage:
 *   react apps:      <InfiniteCanvas ground={groundField({ theme, poles })} …>
 *   imperative apps: const layer = groundField()({ host, world, readWirePreview });
 *                    engine.registerReflector(layer.reflector);
 */
export function groundField(opts: GroundFieldOptions = {}): GroundFieldFactory {
  return (ctx) => {
    const h = createGroundHost({ kind: "stratified", opts }, ctx);
    return {
      reflector: { ...h.draw, available: () => h.available() },
      configureGrid: (cfg) => h.configureGrid(cfg),
      dispose: () => h.dispose(),
      field: {
        canvas: h.canvas,
        available: () => h.available(),
        status: () => h.status(),
        device: () => h.device(),
        redraws: () => h.redraws(),
        setTheme: (t) => h.setTheme(t),
        stats: () => { const { runs: _runs, ...rest } = h.stats(); return rest; },
        wakes: () => h.wakes(),
        geometryOf: (e) => h.geometryOf(e),
        lastInputs: () => h.lastInputs(),
        config: () => h.config(),
      },
    };
  };
}
