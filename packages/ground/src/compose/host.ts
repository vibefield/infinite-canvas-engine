// The ground as a LAYER of the new composited profile (design-013 §8 B2): one
// canvas in the L0 slot, one reflector — GpuCompose — drawing into the swap
// chain straight from the world. The factory has the shape the React facade's
// `ground` prop expects (`GroundLayerFactory`, mirrored structurally — this
// package may not import react) and returns a handle the `compositedNext`
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
import { Camera, type Entity, FrameInfo, type FramePreviewStore, type GridConfig, type ReflectorDef, Viewport, type World } from "@ice/core";
import type { ShellGeometry } from "../card/geometry";
import type { CardMotion } from "../card/motion";
import type { CardProgram } from "../card/program";
import type { FieldConfig } from "../field/layout";
import type { GlyphProgram } from "../field/program";
import { GROUND_SHADERS } from "../shaders";
import type { GroundTheme } from "../theme";
import { createFrameBuilder, type FrameBuilderOptions, type FrameBuilderStats, type WakeReason } from "./frame-inputs";
import { Ground } from "./ground";

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
}

/** The mount context the React facade hands a `ground` factory — the fields this layer needs, mirrored structurally. */
export interface GroundComposeContext {
  readonly host: { readonly container: HTMLElement; readonly contentPlane: HTMLElement };
  readonly world: World;
  /** ICE's preview store (`engine.previews`): a container's inside for its live portal. Absent = no portals. */
  readonly previews?: FramePreviewStore;
}

/** The compose layer's instruments: the ground's redraws and the last build's counts. */
export interface GroundComposeStats extends FrameBuilderStats {
  readonly redraws: number;
}

export interface GroundCompose {
  /** GpuCompose — the profile registers it LAST (after the renders): design-013 §6's order. */
  readonly gpuCompose: ReflectorDef;
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
  /** A card's geometry as last drawn (the rig's witness; B3b's hit test) — the program's, on the engine's head. */
  geometryOf(e: Entity): ShellGeometry | undefined;
  /** A card's springs as last stepped — flux, never a world fact. */
  motionOf(e: Entity): CardMotion | undefined;
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
    const builder = createFrameBuilder(world, { ...(opts.cards ?? {}), ...(opts.card !== undefined ? { program: opts.card } : {}), ...(ctx.previews !== undefined ? { previews: ctx.previews } : {}) });
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
    let theme = opts.theme;
    let gridPending: Partial<GridConfig> | null = null;

    Ground.create({ device: opts.device, canvas, ...GROUND_SHADERS, ...(opts.card !== undefined ? { card: opts.card } : {}), ...(opts.grids !== undefined ? { grids: opts.grids } : {}) }).then(
      (g) => {
        if (opts.config) g.fieldConfig = opts.config;
        if (gridPending) { g.fieldConfig = fieldConfigOf(g.fieldConfig, gridPending); gridPending = null; }
        ground = g;
        dirty = true;   // the deferred pre-ready flushes are owed one paint
      },
      (e: unknown) => { failed = true; console.error("[ice] ground/compose: Ground.create failed", e); },
    );
    const unsubs: Array<() => void> = [
      world.reactive.observeResource(Camera, () => { dirty = true; }),
      world.reactive.observeResource(Viewport, () => { dirty = true; }),
      builder.observe(() => { dirty = true; }),
    ];

    const gpuCompose: ReflectorDef = {
      name: "ground/gpu-compose",
      always: true,
      flush(w) {
        if (ground === null) return;
        // the world's dirt is PULLED every frame (the journal drains); the out-of-world wakes set `dirty`
        if (builder.changed()) dirty = true;
        if (!dirty) return;
        const cam = w.getResource(Camera);
        const vp = w.getResource(Viewport);
        if (cam === undefined || vp === undefined || vp.w <= 0 || vp.h <= 0) return;   // no viewport yet: stay dirty, paint when it exists
        const dpr = Math.min(vp.dpr > 0 ? vp.dpr : 1, maxDpr);
        const width = Math.max(1, Math.round(vp.w * dpr));
        const height = Math.max(1, Math.round(vp.h * dpr));
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
        dirty = false;
        // the frame's dt, ms clamped by the engine (design-002 §1) — a first frame before FrameInfo exists steps one nominal frame
        const dtMs = w.getResource(FrameInfo)?.dt ?? 16;
        const built = builder.build({ x: cam.x, y: cam.y, zoom: cam.zoom }, { width: vp.w, height: vp.h, dpr }, dtMs / 1000, theme, ground.fieldConfig);
        ground.render({
          view: { camX: cam.x, camY: cam.y, zoom: cam.zoom, width: vp.w, height: vp.h, dpr },
          pointer: { x: 0, y: 0, on: false },
          sources: built.sources,
          frames: built.frames,
          ...(built.portals.length ? { portals: built.portals } : {}),
          theme,
        });
        redraws += 1;
        if (builder.live()) dirty = true;   // a spring still moves: the next frame paints too
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
        builder.dispose();
        canvas.remove();
        ground?.dispose();
        ground = null;
      },
      compose: {
        gpuCompose,
        canvas,
        available: () => ground !== null && !failed,
        redraws: () => redraws,
        setTheme(next) { theme = next; dirty = true; },
        stats: () => ({ redraws, ...builder.stats() }),
        wakes: () => builder.wakes(),
        geometryOf: (e) => builder.geometryOf(e),
        motionOf: (e) => builder.motionOf(e),
      },
    };
  };
}
