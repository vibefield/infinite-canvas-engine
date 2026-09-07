// The ground as a LAYER of the new composited profile (design-013 §8 B2): one
// canvas in the L0 slot, one reflector — GpuCompose — drawing into the swap
// chain straight from the world. The factory has the shape the React facade's
// `ground` prop expects (`GroundLayerFactory`, mirrored structurally — this
// package may not import react) and returns a handle the `compositedNext`
// profile recognises by its `compose` field.
//
// What B2 draws: an EMPTY board — the field under ICE's own defaults and the
// theme's clear colour — on a camera or viewport change and never otherwise
// (idle-zero: a quiet frame does not touch the swap chain). B3 fills the frame
// from the world: the cards, the side tables, the portals from the preview
// store. The reflector's PLACE in the roster is the profile's to fix (§6: the
// renders' queue ops before GpuCompose's submit, by registration order), so the
// handle's own `reflector` is an inert slot and GpuCompose is handed to the
// profile through `compose`, to be registered last.
//
// Reflector contract (design-002 §5): post-notify, output-only, never writes
// ECS, never reads layout — the viewport comes from the `Viewport` resource
// the facade's ResizeObserver writes, never from the container.
import { Camera, type GridConfig, type ReflectorDef, Viewport, type World } from "@ice/core";
import type { FieldConfig } from "../field/layout";
import { GROUND_SHADERS } from "../shaders";
import type { GroundTheme } from "../theme";
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
}

/** The mount context the React facade hands a `ground` factory — the two fields this layer needs, mirrored structurally. */
export interface GroundComposeContext {
  readonly host: { readonly container: HTMLElement; readonly contentPlane: HTMLElement };
  readonly world: World;
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

    Ground.create({ device: opts.device, canvas, ...GROUND_SHADERS }).then(
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
    ];

    const gpuCompose: ReflectorDef = {
      name: "ground/gpu-compose",
      always: true,
      flush(w) {
        if (!dirty || ground === null) return;
        const cam = w.getResource(Camera);
        const vp = w.getResource(Viewport);
        if (cam === undefined || vp === undefined || vp.w <= 0 || vp.h <= 0) return;   // no viewport yet: stay dirty, paint when it exists
        const dpr = Math.min(vp.dpr > 0 ? vp.dpr : 1, maxDpr);
        const width = Math.max(1, Math.round(vp.w * dpr));
        const height = Math.max(1, Math.round(vp.h * dpr));
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
        dirty = false;
        ground.render({
          view: { camX: cam.x, camY: cam.y, zoom: cam.zoom, width: vp.w, height: vp.h, dpr },
          pointer: { x: 0, y: 0, on: false },
          sources: [],
          frames: [],
          theme,
        });
        redraws += 1;
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
      },
    };
  };
}
