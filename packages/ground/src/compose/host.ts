// The ground as a LAYER of the new composited profile (design-013 §8 B2): one
// canvas in the L0 slot, one reflector — GpuCompose — drawing into the swap
// chain straight from the world. The factory has the shape the React facade's
// `ground` prop expects (`GroundLayerFactory`, mirrored structurally — this
// package may not import react) and returns a handle the `composited`
// profile recognises by its `compose` field.
//
// What it draws (B3a): the world's cards — every widget Active in the nav
// frame as a card frame in plate mode over the theme's surface, with the
// springs (reveal on `Selected`, the lift on `Grab`, the heat on the drop
// pair), and a live portal for every container past the gate, its inside from
// ICE's preview store — on the frame builder's dirty union (`frame-inputs.ts`),
// a camera or viewport change, or while a spring still moves; and never
// otherwise (idle-zero: a quiet frame does not touch the swap chain). B3b
// takes the DOM boundary — chrome-less hosts clipped by the same `resolve()`
// — and the router's frame hit test. The reflector's PLACE in the roster is
// the profile's to fix (§6: the renders' queue ops before GpuCompose's submit,
// by registration order), so the handle's own `reflector` is an inert slot and
// GpuCompose is handed to the profile through `compose`, to be registered last.
//
// Reflector contract (design-002 §5): post-notify, output-only, never writes
// ECS, never reads layout — the viewport comes from the `Viewport` resource
// the facade's ResizeObserver writes, never from the container; the frame's dt
// from `FrameInfo` (clamped by the engine), never from a clock of its own.
import { Camera, type Entity, FrameInfo, type FramePickSlot, type FramePreviewStore, type GridConfig, NavTransition, PartTap, type PresentationTransitionAdapter, type ReflectorDef, Viewport, type World } from "@ice/core";
import type { RasterStrategy } from "@ice/kernel";
import { shellProgram } from "../card/program";
import { LINES } from "../theme";
import { createDomHostWriter } from "./dom-compose";
import { createDomRender, type DomRender, type DomRenderStats } from "./dom-render";
import { type ContentResidency, createContentResidency } from "./residency";
import { createVideoIngest, type VideoIngest } from "./video-ingest";
import type { ShellGeometry } from "../card/geometry";
import type { CardMotion } from "../card/motion";
import type { CardProgram } from "../card/program";
import type { FieldConfig } from "../field/layout";
import type { GlyphProgram } from "../field/program";
import { changedElements, markAsSourceCanvas, onPaint, probeHic } from "../hic-adapter";
import { GROUND_SHADERS } from "../shaders";
import type { GroundTheme } from "../theme";
import { createFrameBuilder, type FlightInputs, type FrameBuilderOptions, type FrameBuilderStats, type WakeReason } from "./frame-inputs";
import { Ground, type GroundFrameInputs } from "./ground";

export interface GroundComposeOptions {
  /** The app-owned device (`acquireCompositorDevice().device`); three adopts the same one for islands. */
  readonly device: GPUDevice;
  /** The host's projection of its palette (a product's `--vf-*`; the lab's fixture) — the clear colour and every frame colour. */
  readonly theme: GroundTheme;
  /** The field's config; ICE's own defaults (`ENGINE_GRID`) unless a host projects its product's. */
  readonly config?: FieldConfig;
  /** The device-pixel ratio the canvas is capped at. */
  readonly maxDpr?: number;
  /** The card program (design-014): the engine's shell unless the app registers its own (`vfFrame()` from `@ice/ground/packs`). */
  readonly card?: CardProgram<ShellGeometry>;
  /** Grid programs beyond the engine's dot (`needleGlyph`, `cuttingMat` from `@ice/ground/packs`). */
  readonly grids?: readonly GlyphProgram[];
  /** A release on a card program's PART (`close`, `lock` …): the app's action. Routed at B3b. */
  readonly onPart?: (entity: Entity, part: string) => void;
  /** The frame builder's knobs (material, lift, gate, cap …); the product's by default. */
  readonly cards?: Omit<FrameBuilderOptions, "previews" | "program">;
  /**
   * How each surface kind wants its pixels rastered (design-013 §9 Q1). Declared ONCE, here:
   * the profile reads it off this handle and hands the SAME function to Residency, and DomRender
   * calls `geometry()` with it — one strategy, two readers, nothing to drift. Default `band`.
   */
  readonly raster?: (kind: "dom" | "gl" | "video") => RasterStrategy;
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
   * addresses. Absent = no DOM writes; `hostOf` absent = no DomRender.
   */
  readonly hosts?: { contentOf(entity: Entity): HTMLElement | undefined; hostOf?(entity: Entity): HTMLElement | undefined };
  /** The interaction stack's frame pick slot: the ground's hit test over its last-drawn geometry goes here (B3b). Absent = the boxes pick. */
  readonly framePick?: FramePickSlot;
  /**
   * The presentation transition coordinator (`engine.transitions`): the ground OWNS the `ground`
   * plane (B7). A cross-type flight is gated on every required plane preparing, and a canvas
   * type with a ground program requires this one — without an owner every enter into a folder
   * is a snap. The ground needs no preparation: its second slot is built from the world each
   * frame, so the adapter prepares instantly and retains nothing. Absent = no registration.
   */
  readonly transitions?: { register(adapter: PresentationTransitionAdapter): () => void };
}

/** The compose layer's instruments: the ground's redraws and the last build's counts. */
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

export interface GroundComposeStats extends FrameBuilderStats {
  readonly redraws: number;
  /** The flight's second slot as last drawn (B7): its kind, progress and record count; `null` at rest. */
  readonly outgoing: { readonly kind: "enter" | "exit"; readonly p: number; readonly frozen: boolean; readonly frames: number; readonly at: number | null } | null;
  /**
   * Z-runs in the LAST frame drawn (B5). A run breaks only where the `own` texture changes,
   * so this counts the card pass's bind-group switches — and > 1 is the witness that a
   * textured card really is interleaved in z with plate ones rather than drawn beside them.
   */
  readonly runs: number;
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

/** What the factory returns: the facade's `GroundLayerHandle` shape, plus `compose`. */
export interface GroundComposeHandle {
  /** The ground-layer slot the facade registers first — inert here: the drawing is `compose.gpuCompose`'s, registered last. */
  readonly reflector: ReflectorDef & { available(): boolean };
  configureGrid(cfg: Partial<GridConfig>): void;
  dispose(): void;
  readonly compose: GroundCompose;
}

/**
 * The react `grid` prop's config onto the field's: what maps, maps; the rest
 * (spacings, fade-out, level weights — the classic grid's) has no field
 * meaning and is left alone. C2 reshapes the contract itself.
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

export function groundCompose(opts: GroundComposeOptions): (ctx: GroundComposeContext) => GroundComposeHandle {
  return (ctx) => {
    const { host, world } = ctx;
    const maxDpr = opts.maxDpr ?? 2;
    const residency = createContentResidency(world);
    const renders: RenderSlots = { dom: { current: null }, island: { current: null }, video: { current: null } };
    // The video render is the ground's own (B6): the producer drives it from outside, so its
    // slot is filled here rather than after the mount like the dom and island renders.
    const video = createVideoIngest({ device: opts.device, world, residency });
    renders.video.current = video.reflector;
    const builder = createFrameBuilder(world, { ...(opts.cards ?? {}), ...(opts.card !== undefined ? { program: opts.card } : {}), ...(ctx.previews !== undefined ? { previews: ctx.previews } : {}), residency });
    const doc = host.container.ownerDocument;
    const canvas = doc.createElement("canvas");
    canvas.style.position = "absolute";
    canvas.style.left = "0";
    canvas.style.top = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    canvas.style.pointerEvents = "none";
    // The whole ground stratum is this ONE canvas, immediately before content (the old layer's placement).
    host.container.insertBefore(canvas, host.contentPlane);

    let ground: Ground | null = null;
    let failed = false;
    let dirty = true;
    let redraws = 0;
    let lastPages: GPUTextureView | null = null;
    let theme = opts.theme;
    let gridPending: Partial<GridConfig> | null = null;
    const program = opts.card ?? shellProgram;
    const writer = ctx.hosts !== undefined ? createDomHostWriter(program, ctx.hosts.contentOf) : null;
    let domWrites = 0;
    // DomRender (B4, §6 reflector 5). Built EAGERLY — the dirt latch has to be
    // able to take a paint event from the first one — but installed into its
    // roster slot only once `Ground.create` resolves, so nothing copies into a
    // page array that no frame can yet sample. Its debt is kept meanwhile.
    const hostOf = ctx.hosts?.hostOf;
    const domRender: DomRender | null =
      hostOf === undefined
        ? null
        : createDomRender({
            device: opts.device,
            world,
            residency,
            hosts: { hostOf },
            ...(opts.raster !== undefined ? { raster: opts.raster } : {}),
          });
    // The L1 source canvas is the FACADE's to build (it owns the container and
    // the viewport it must be resized with); what only this package can supply
    // is the adapter's effects and the dirt latch. `null` when the host has no
    // HTML-in-Canvas — including the `layoutsubtree` capability, which
    // `probeHic` reports but does not require: a canvas whose children do not
    // lay out would host every promoted card at 0×0.
    const probe = probeHic(doc);
    const sourceCanvas: SourceCanvasSlot | null =
      domRender === null || !probe.supported || !probe.capabilities.layoutSubtree
        ? null
        : { effects: { markAsSourceCanvas, onPaint, changedElements }, onDirty: (els) => domRender.markDirtyHosts(els) };
    // The frame's build happens ONCE per tick, in the first of the ground's reflectors to run
    // (DomCompose when the profile registers it, else GpuCompose); the other draws what was built.
    let builtTick = -1;
    let pending: { readonly view: { camX: number; camY: number; zoom: number; width: number; height: number; dpr: number }; readonly built: ReturnType<typeof builder.build>; readonly flight: FlightInputs | null } | null = null;
    let lastFlight: GroundComposeStats["outgoing"] = null;
    let lastInputs: GroundFrameInputs | null = null;
    const ensureBuilt = (w: World): boolean => {
      if (ground === null) return false;
      const tick = w.getResource(FrameInfo)?.tick ?? -1;
      if (tick >= 0 && builtTick === tick) return pending !== null;
      builtTick = tick;
      // the world's dirt is PULLED every frame (the journal drains); the out-of-world wakes set `dirty`
      if (builder.changed()) dirty = true;
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
      const built = builder.build({ x: cam.x, y: cam.y, zoom: cam.zoom }, { width: vp.w, height: vp.h, dpr }, dtMs / 1000, theme, ground.fieldConfig);
      // a nav flight's second slot (B7): the departed frame beside the arriving one
      const flight = builder.flight({ x: cam.x, y: cam.y, zoom: cam.zoom }, { width: vp.w, height: vp.h, dpr }, theme, ground.fieldConfig);
      pending = { view: { camX: cam.x, camY: cam.y, zoom: cam.zoom, width: vp.w, height: vp.h, dpr }, built, flight };
      if (builder.live()) dirty = true;   // a spring still moves: the next frame paints too
      return true;
    };
    // The frame pick source (B3b): the router asks the ground what is under a point on a card — its last-drawn geometry through the program's own hit test.
    const framePick = ctx.framePick;
    const pickSource = {
      pad: () => program.source(0, 0, 1, opts.cards?.radius ?? 0).hx + LINES.ring + 2,
      hit: (e: Entity, x: number, y: number): string => { const G = builder.geometryOf(e); return G === undefined ? "outside" : program.pick(G, x, y); },
    };
    if (framePick !== undefined) framePick.current = pickSource;

    Ground.create({ device: opts.device, canvas, ...GROUND_SHADERS, ...(opts.card !== undefined ? { card: opts.card } : {}), ...(opts.grids !== undefined ? { grids: opts.grids } : {}) }).then(
      (g) => {
        if (opts.config) g.fieldConfig = opts.config;
        if (gridPending) { g.fieldConfig = fieldConfigOf(g.fieldConfig, gridPending); gridPending = null; }
        ground = g;
        // The render is the ground's own, and it takes §6's slot 5 — before
        // DomCompose and GpuCompose, so its copies are queue ops already
        // ordered against the submit that samples them.
        if (domRender !== null) renders.dom.current = domRender;
        dirty = true;   // the deferred pre-ready flushes are owed one paint
      },
      (e: unknown) => { failed = true; console.error("[ice] ground/compose: Ground.create failed", e); },
    );
    // the ground plane's transition adapter (B7): prepared the moment it is asked — the flight IS the second slot
    const detachTransition = ctx.transitions?.register({ id: "@ice/ground/compose", plane: "ground", prepare: () => null }) ?? null;
    let lastTap = 0;
    const unsubs: Array<() => void> = [
      world.reactive.observeResource(Camera, () => { dirty = true; }),
      world.reactive.observeResource(Viewport, () => { dirty = true; }),
      // a flight writes its progress every tick (and the camera): the departed slot moves
      world.reactive.observeResource(NavTransition, () => { dirty = true; }),
      builder.observe(() => { dirty = true; }),
      // a tap on a card program's PART (B3b): the router hands it over as a resource; the app's action is `onPart`
      world.reactive.observeResource(PartTap, () => {
        const t = world.getResource(PartTap);
        if (t === undefined || t.seq === lastTap) return;
        lastTap = t.seq;
        opts.onPart?.(t.target, t.part ?? "");
      }),
    ];

    // DomCompose (B3b): the build, then the DOM boundary of every card on screen.
    const domCompose: ReflectorDef = {
      name: "ground/dom-compose",
      always: true,
      flush(w) {
        if (!ensureBuilt(w) || writer === null) return;
        domWrites += writer.write(builder.entries());
      },
    };

    const gpuCompose: ReflectorDef = {
      name: "ground/gpu-compose",
      always: true,
      flush(w) {
        if (!ensureBuilt(w) || ground === null || pending === null) return;
        const { view, built, flight } = pending;
        pending = null;
        // the page array every `page` card samples — rebound only when the residency re-realised it (growth, D-B4.1)
        const pages = residency.pagesView();
        if (pages !== lastPages) { ground.setPages(pages); lastPages = pages; }
        const inputs: GroundFrameInputs = {
          view,
          pointer: { x: 0, y: 0, on: false },
          sources: built.sources,
          frames: built.frames,
          ...(built.portals.length ? { portals: built.portals } : {}),
          ...(flight !== null ? { present: flight.present, outgoing: flight.outgoing, lodZoom: flight.lodZoom } : {}),
          theme,
        };
        lastInputs = inputs;
        ground.render(inputs);
        lastFlight = flight === null ? null : { kind: flight.kind, p: flight.p, frozen: flight.frozen, frames: flight.outgoing.frames.length, at: flight.outgoing.at ?? null };
        redraws += 1;
        residency.collect();   // the destroy list, after this frame's submit
      },
    };

    return {
      reflector: { name: "ground/compose-slot", always: false, flush() {}, available: () => ground !== null },
      configureGrid(cfg) {
        if (ground === null) { gridPending = { ...(gridPending ?? {}), ...cfg }; return; }
        ground.fieldConfig = fieldConfigOf(ground.fieldConfig, cfg);
        dirty = true;
      },
      dispose() {
        for (const u of unsubs) u();
        unsubs.length = 0;
        if (framePick !== undefined && framePick.current === pickSource) framePick.current = null;
        detachTransition?.();
        if (renders.dom.current === domRender) renders.dom.current = null;
        domRender?.dispose();
        writer?.dispose();
        builder.dispose();
        if (renders.video.current === video.reflector) renders.video.current = null;
        video.dispose();
        residency.dispose();
        canvas.remove();
        ground?.dispose();
        ground = null;
      },
      compose: {
        gpuCompose,
        residency,
        video,
        renders,
        sourceCanvas,
        domRender,
        ...(opts.raster !== undefined ? { raster: opts.raster } : {}),
        ...(writer !== null ? { domCompose } : {}),
        canvas,
        available: () => ground !== null && !failed,
        redraws: () => redraws,
        setTheme(next) { theme = next; dirty = true; },
        stats: () => ({ redraws, outgoing: lastFlight, runs: ground?.frames.runCount ?? 0, ...builder.stats() }),
        wakes: () => builder.wakes(),
        domWrites: () => ({ writes: domWrites, clips: writer?.clips ?? 0 }),
        geometryOf: (e) => builder.geometryOf(e),
        motionOf: (e) => builder.motionOf(e),
        lastInputs: () => lastInputs,
      },
    };
  };
}
