/**
 * The snap-guides reflector (design-004 §1 P0 as-built amendment, 2026-07-16 —
 * James: guides at the GROUND stratum; design-003 §6).
 *
 * P0 stacking is DOM order: grid canvas → wires canvas → THIS canvas → content
 * plane. Alignment lines and equal-spacing bars therefore render UNDER widget
 * content — v1's guides-under-content look, reinstated knowingly (the doc
 * amendment records the evidence: the drag-lift fade leaves the dragged card
 * 75 % translucent so guides read through it, and spacing bars live in the
 * inter-card gaps P0 shows fully). Like the grid and wires, this is a
 * SCREEN-space canvas covering the viewport; the camera applies per-stroke via
 * the kernel `worldToScreen` seam, so widths stay screen-constant at any zoom.
 *
 * Data: pooled `GuideLine` / `SpacingBar` entities the core `snapSystem`
 * maintains (design-003 §6 — pool grows with the kernel result; NO silent
 * caps, v1's MAX_GUIDES=16 truncation is banned; this renderer draws whatever
 * exists). `GuideLine.from == to` ⇒ full-viewport line (v1's full-canvas
 * alignment look); a bounded span draws only [from, to]. A `SpacingBar` is a
 * segment along its axis at perpendicular `perp` with 4px end ticks (v1
 * `u_spacings` end-bars, verbatim look: magenta, α 0.8 guides / 0.7 bars).
 *
 * Change-only (design-002 §5): `always: true` with a private dirty flag —
 * observers on Camera and the two chrome queries (attach/detach/value) arm it;
 * an idle scene re-strokes zero times, and the guide-reap frame gets exactly
 * one clearing redraw. Fault isolation mirrors wires: no 2D context (happy-dom
 * / context loss) ⇒ `available() === false`, flush is a silent no-op.
 *
 * Law 10: reflectors run post-notify, write output only, never read layout or
 * write ECS — this flush touches only the guides canvas 2D context.
 */
import {
  Camera,
  defineQuery,
  GuideLine,
  type ReflectorDef,
  SpacingBar,
  type World,
} from "@ice/core";
import { type CameraState, worldToScreen } from "@ice/kernel";
import type { CanvasHost } from "../host";

/** v1 `DEFAULT_SNAP_GUIDE_CONFIG` (SnapGuideRenderer.ts), field for field. */
export interface SnapGuidesConfig {
  /** Guide line + spacing bar color as [r, g, b] in 0-1 range. */
  color: [number, number, number];
  /** Stroke width in screen px (constant across zoom). */
  lineWidth: number;
  /** Alignment-line alpha. */
  guideAlpha: number;
  /** Equal-spacing bar alpha. */
  spacingAlpha: number;
  /** End-tick half-length in screen px (v1 shader barHeight). */
  tickPx: number;
}

export const DEFAULT_SNAP_GUIDES_CONFIG: SnapGuidesConfig = {
  color: [1.0, 0.0, 0.55], // v1 magenta/pink
  lineWidth: 1,
  guideAlpha: 0.8,
  spacingAlpha: 0.7,
  tickPx: 4,
};

const guideQ = defineQuery([GuideLine]);
const barQ = defineQuery([SpacingBar]);

function cssColor(rgb: readonly [number, number, number], alpha: number): string {
  const c = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);
  return `rgba(${c(rgb[0])}, ${c(rgb[1])}, ${c(rgb[2])}, ${alpha})`;
}

export interface SnapGuidesReflector extends ReflectorDef {
  /** False under happy-dom / on context loss — flush is then a silent no-op. */
  available(): boolean;
  /** Redraw count (the churn instrument): zero on a static idle scene. */
  redraws(): number;
  /** Detach the canvas + tear down the private observers and ResizeObserver. */
  dispose(): void;
}

export function createSnapGuidesReflector(
  host: CanvasHost,
  world: World,
  opts: { config?: Partial<SnapGuidesConfig> } = {},
): SnapGuidesReflector {
  const config: SnapGuidesConfig = { ...DEFAULT_SNAP_GUIDES_CONFIG, ...opts.config };
  const doc = host.container.ownerDocument;

  const canvas = doc.createElement("canvas");
  canvas.style.position = "absolute";
  canvas.style.left = "0";
  canvas.style.top = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  // P0 is never a DOM hit target (the router does its own spatial-index pick).
  canvas.style.pointerEvents = "none";
  // Immediately before the content plane. Created AFTER the wires reflector's
  // canvas (registration order in the react host), so within P0 it stacks
  // grid → wires → guides → content: guides overlay wires, sit under widgets.
  host.container.insertBefore(canvas, host.contentPlane);

  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext("2d");
  } catch {
    ctx = null;
  }

  let dpr = 1;
  let cssW = 0;
  let cssH = 0;

  // Private dirt (wires idiom): guides/bars are pure ECS chrome, so the two
  // query observers + Camera cover every visible change; the flush self-gates.
  let dirty = true;
  let drewLast = false;
  let redraws = 0;
  const wake = () => {
    dirty = true;
  };
  const unsubs: Array<() => void> = [
    world.reactive.observeResource(Camera, wake),
    world.reactive.observeQuery(guideQ, wake, { cols: [GuideLine] }),
    world.reactive.observeQuery(barQ, wake, { cols: [SpacingBar] }),
  ];

  function applySize(cssWidth: number, cssHeight: number): void {
    dpr = doc.defaultView?.devicePixelRatio ?? 1;
    cssW = cssWidth;
    cssH = cssHeight;
    const bufW = Math.max(1, Math.round(cssWidth * dpr));
    const bufH = Math.max(1, Math.round(cssHeight * dpr));
    if (canvas.width !== bufW) canvas.width = bufW;
    if (canvas.height !== bufH) canvas.height = bufH;
    dirty = true; // resize resets context state; a redraw is owed
  }

  const initialRect = host.container.getBoundingClientRect();
  applySize(initialRect.width, initialRect.height);

  let ro: ResizeObserver | null = null;
  try {
    ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      applySize(entry.contentRect.width, entry.contentRect.height);
    });
    ro.observe(host.container);
  } catch {
    ro = null;
  }

  function line(c2d: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
    c2d.beginPath();
    c2d.moveTo(x0, y0);
    c2d.lineTo(x1, y1);
    c2d.stroke();
  }

  /** One alignment line: axis "x" = vertical at world-x `at`; "y" = horizontal. */
  function drawGuide(
    c2d: CanvasRenderingContext2D,
    cam: CameraState,
    g: { axis: string; at: number; from: number; to: number },
  ): boolean {
    // Off-viewport cull only when the container has a measured size (happy-dom
    // reports 0×0 — there, stroke unconditionally like wires does).
    const fullSpan = g.from === g.to;
    if (g.axis === "x") {
      const sx = worldToScreen(g.at, 0, cam).x;
      if (cssW > 0 && (sx < -1 || sx > cssW + 1)) return false;
      const y0 = fullSpan ? 0 : worldToScreen(0, g.from, cam).y;
      const y1 = fullSpan ? cssH : worldToScreen(0, g.to, cam).y;
      line(c2d, sx, y0, sx, y1);
    } else {
      const sy = worldToScreen(0, g.at, cam).y;
      if (cssH > 0 && (sy < -1 || sy > cssH + 1)) return false;
      const x0 = fullSpan ? 0 : worldToScreen(g.from, 0, cam).x;
      const x1 = fullSpan ? cssW : worldToScreen(g.to, 0, cam).x;
      line(c2d, x0, sy, x1, sy);
    }
    return true;
  }

  /**
   * One equal-spacing segment + its 4px end ticks. Kernel axis semantics
   * (v1 shader verbatim): axis "x" = a HORIZONTAL gap along x at world-y
   * `perp`; axis "y" = a vertical gap along y at world-x `perp`.
   */
  function drawBar(
    c2d: CanvasRenderingContext2D,
    cam: CameraState,
    s: { axis: string; from: number; to: number; perp: number },
  ): boolean {
    const t = config.tickPx;
    if (s.axis === "x") {
      const a = worldToScreen(s.from, s.perp, cam);
      const b = worldToScreen(s.to, s.perp, cam);
      if (cssW > 0 && (Math.max(a.x, b.x) < 0 || Math.min(a.x, b.x) > cssW)) return false;
      line(c2d, a.x, a.y, b.x, b.y);
      line(c2d, a.x, a.y - t, a.x, a.y + t);
      line(c2d, b.x, b.y - t, b.x, b.y + t);
    } else {
      const a = worldToScreen(s.perp, s.from, cam);
      const b = worldToScreen(s.perp, s.to, cam);
      if (cssH > 0 && (Math.max(a.y, b.y) < 0 || Math.min(a.y, b.y) > cssH)) return false;
      line(c2d, a.x, a.y, b.x, b.y);
      line(c2d, a.x - t, a.y, a.x + t, a.y);
      line(c2d, b.x - t, b.y, b.x + t, b.y);
    }
    return true;
  }

  function redraw(c2d: CanvasRenderingContext2D, cam: CameraState): boolean {
    c2d.setTransform(1, 0, 0, 1, 0, 0);
    c2d.clearRect(0, 0, canvas.width, canvas.height);
    c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    redraws++;
    let drew = false;
    c2d.lineWidth = config.lineWidth;
    c2d.strokeStyle = cssColor(config.color, config.guideAlpha);
    world.query(guideQ).each((batch) => {
      for (const r of batch) {
        const g = world.read(batch.entity(r), GuideLine);
        if (drawGuide(c2d, cam, g)) drew = true;
      }
    });
    c2d.strokeStyle = cssColor(config.color, config.spacingAlpha);
    world.query(barQ).each((batch) => {
      for (const r of batch) {
        const s = world.read(batch.entity(r), SpacingBar);
        if (drawBar(c2d, cam, s)) drew = true;
      }
    });
    return drew;
  }

  return {
    name: "snapGuides",
    // Self-gated on the private dirty flag (wires idiom) — the flush is a
    // cheap boolean check on the every-frame path.
    always: true,
    flush(w: World) {
      if (ctx === null || !dirty) return;
      dirty = false;
      const cam = w.getResource(Camera);
      if (cam === undefined) return;
      // A redraw is owed if anything wants drawing OR the last frame drew
      // (the reap frame must clear its lines exactly once).
      const wants = w.firstOf(guideQ) !== undefined || w.firstOf(barQ) !== undefined;
      if (!wants && !drewLast) return;
      try {
        drewLast = redraw(ctx, cam);
      } catch {
        ctx = null; // context loss ⇒ degrade to a silent no-op, never a throwing reflector
      }
    },
    available: () => ctx !== null,
    redraws: () => redraws,
    dispose() {
      for (const u of unsubs) u();
      unsubs.length = 0;
      ro?.disconnect();
      ro = null;
      canvas.remove();
    },
  };
}
