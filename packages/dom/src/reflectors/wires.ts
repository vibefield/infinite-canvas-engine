/**
 * The wires reflector (design-004 §1 P0 "WIRES" pass; design-001 §5.3).
 *
 * P0 is the ground stratum: the grid canvas paints first, the wires canvas next
 * (this file), the content plane on top. Wires therefore render UNDER widget
 * content — a node graph's edges sit behind its nodes — with no z-index
 * bookkeeping: the wires canvas is inserted immediately before the content plane
 * (after the grid canvas), so DOM order is the strata order (§1: stacking is
 * stratified). Like the grid, it is a SCREEN-space canvas covering the full
 * viewport; the camera is applied per-draw via the kernel `worldToScreen` seam
 * rather than by a CSS plane transform, so panning re-strokes the curves at any
 * zoom with no seams.
 *
 * Wire geometry NEVER reads a port ENTITY (design-001 §5.3): endpoints resolve
 * from the wire's `WireFrom`/`WireTo` widgets (durable `Position`/`Size`) and the
 * two `WirePorts` ids looked up against the widget type's static port schema
 * (`PrefabId` -> `widgets.get(type).ports`); the kernel `portAnchor` places each
 * anchor on the widget rect and `wireCubic` builds the curve. Because that path
 * touches only durable geometry + the type registry — never a runtime port
 * entity — a wire whose endpoint is CULLED (off-viewport, no DOM host, no
 * materialized port) still draws by construction. This mirrors core's audited
 * `systems/l1-wires.ts` endpoint resolver, so pick and render agree. The connect-
 * drag preview and the materialized port dots share this one canvas.
 *
 * Change-only (design-002 §5): the reflector is `always: true` (the connect
 * preview is an out-of-ECS buffer with no ECS stamp, exactly like the marquee
 * buffer the chrome reflector consumes), but a full re-stroke happens only when
 * something visible changed — private observers on Camera / [Position,Size] /
 * [Wire] / [Selected] / ports / [RoutedConnect] arm a dirty flag, and the preview
 * buffer is diffed by value each frame. A static scene with an idle preview
 * re-strokes zero times after first paint.
 *
 * Fault isolation mirrors the grid: `getContext("2d")` returns `null` in happy-
 * dom (and on context loss), so `available()` reports false and `flush` is a
 * permanent silent no-op; every draw is wrapped so a driver failure degrades to
 * unavailable rather than a throwing reflector (design-002 §5).
 *
 * Law 10: reflectors run post-notify, write output only, never read layout or
 * write ECS — this flush touches only the wires canvas 2D context.
 */
import {
  Camera,
  defineQuery,
  type Entity,
  MeasuredSize,
  Port,
  PortAnchor,
  Position,
  PrefabId,
  type ReflectorDef,
  RoutedConnect,
  Selected,
  Size,
  widgets,
  type WidgetType,
  Wire,
  WireFrom,
  WirePorts,
  WireTo,
  type World,
} from "@ice/core";
import {
  type CameraState,
  type Cubic,
  type PortSide,
  type PortSlot,
  portAnchor,
  type Rect,
  wireCubic,
  worldToScreen,
} from "@ice/kernel";
import type { CanvasHost } from "../host";

/**
 * The connect-drag preview buffer (structural mirror of the core
 * `WirePreviewBuffer` the graph-systems slice produces in
 * `core/src/systems/l3-connect.ts`, exposed on `installInteractionStack` as
 * `wirePreview`). Coords are WORLD-space; `active` gates drawing; `compatible`
 * picks solid (snapped to a compatible port) vs dashed (free / incompatible).
 *
 * TODO(integration): once core exports its buffer type, import it here and drop
 * this local — the lead reconciles field names if they diverge.
 */
export interface WirePreview {
  /** Source anchor (world). */
  sx: number;
  sy: number;
  /** Target / cursor (world). */
  tx: number;
  ty: number;
  active: boolean;
  compatible: boolean;
}

const INACTIVE_PREVIEW: WirePreview = { sx: 0, sy: 0, tx: 0, ty: 0, active: false, compatible: false };

/** Minimal-neutral wire styling (design-004 §6 chrome is subdued; wires defer to content). */
export interface WiresConfig {
  /** Default wire stroke (CSS color). */
  wireColor: string;
  /** Accent stroke for a Selected wire. */
  selectedColor: string;
  wireWidth: number;
  selectedWidth: number;
  /** Materialized-port dot radius (CSS px) + colors (idle vs during a connect drag). */
  portRadius: number;
  portColor: string;
  portActiveColor: string;
}

export const DEFAULT_WIRES_CONFIG: WiresConfig = {
  wireColor: "rgba(120, 132, 145, 0.9)",
  selectedColor: "#4a90d9",
  wireWidth: 1.5,
  selectedWidth: 2,
  portRadius: 4,
  portColor: "rgba(120, 132, 145, 0.9)",
  portActiveColor: "#4a90d9",
};

const wireQ = defineQuery([Wire]);
const geometryQ = defineQuery([Position, Size]);
const selectedQ = defineQuery([Selected]);
const portQ = defineQuery([Port, PortAnchor]);
const routedConnectQ = defineQuery([RoutedConnect]);

export interface WiresReflector extends ReflectorDef {
  /** False under happy-dom / on context loss — flush is then a silent no-op. */
  available(): boolean;
  /** Full re-stroke count (the churn instrument): one per frame that actually redrew, zero on a static idle scene. */
  redraws(): number;
  /** Detach the canvas + tear down the private observers and ResizeObserver. */
  dispose(): void;
}

/**
 * Effective widget rect (design-004 §2): `MeasuredSize` where present and non-
 * zero, else `Size` — so wire anchors track the visually-rendered box of an
 * auto-sized node. Field names map to the kernel `Rect` (width/height).
 */
function readRect(world: World, e: Entity): Rect | undefined {
  const p = world.get(e, Position);
  if (p === undefined) return undefined;
  const measured = world.get(e, MeasuredSize);
  const s = measured !== undefined && measured.w > 0 ? measured : world.get(e, Size);
  if (s === undefined) return undefined;
  return { x: p.x, y: p.y, width: s.w, height: s.h };
}

/**
 * Resolve a widget type's ports to kernel `PortSlot`s (side + even-distribution
 * index/count), cached per type since the schema is immutable. Mirrors core's
 * `ops/port-geometry.ts` `portSlots` EXACTLY (ports on a side numbered by explicit
 * `index` else declaration order; side `count` drives the even spacing), so the
 * rendered anchor agrees with the picked one by construction.
 *
 * TODO(integration): swap for the core `portSlotOf` export once the graph-systems
 * slice adds it to the `@ice/core` barrel (the import wall requires the package root).
 */
function makePortSlotResolver(): (wt: WidgetType, portId: string) => PortSlot | undefined {
  const cache = new Map<string, Map<string, PortSlot>>();
  const build = (wt: WidgetType): Map<string, PortSlot> => {
    const bySide = new Map<PortSide, WidgetType["ports"][number][]>();
    for (const d of wt.ports) {
      let list = bySide.get(d.side);
      if (list === undefined) {
        list = [];
        bySide.set(d.side, list);
      }
      list.push(d);
    }
    const out = new Map<string, PortSlot>();
    for (const [side, list] of bySide) {
      for (let i = 0; i < list.length; i++) {
        const d = list[i];
        if (d === undefined) continue;
        out.set(d.id, { side, index: d.index ?? i, count: list.length });
      }
    }
    return out;
  };
  return (wt, portId) => {
    let slots = cache.get(wt.type);
    if (slots === undefined) {
      slots = build(wt);
      cache.set(wt.type, slots);
    }
    return slots.get(portId);
  };
}

/** Screen-space control points for a world-space cubic (worldToScreen x4). */
function cubicToScreen(c: Cubic, cam: CameraState): Cubic {
  const p0 = worldToScreen(c.x0, c.y0, cam);
  const p1 = worldToScreen(c.x1, c.y1, cam);
  const p2 = worldToScreen(c.x2, c.y2, cam);
  const p3 = worldToScreen(c.x3, c.y3, cam);
  return { x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, x3: p3.x, y3: p3.y };
}

export function createWiresReflector(
  host: CanvasHost,
  world: World,
  opts: { readPreview?: () => WirePreview; config?: Partial<WiresConfig> } = {},
): WiresReflector {
  const config: WiresConfig = { ...DEFAULT_WIRES_CONFIG, ...opts.config };
  const readPreview = opts.readPreview ?? (() => INACTIVE_PREVIEW);
  const doc = host.container.ownerDocument;

  const canvas = doc.createElement("canvas");
  canvas.style.position = "absolute";
  canvas.style.left = "0";
  canvas.style.top = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  // P0 is never a DOM hit target (the router does its own spatial-index pick,
  // design-004 §4) — the wire hit-path is the kernel curve-distance test, not DOM.
  canvas.style.pointerEvents = "none";
  // Immediately before the content plane => after the grid canvas => wires paint
  // above the grid, below content (P0 ground stratum).
  host.container.insertBefore(canvas, host.contentPlane);

  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext("2d");
  } catch {
    ctx = null;
  }

  let dpr = 1;
  const slotOf = makePortSlotResolver();

  // Private dirt: the preview buffer carries no ECS stamp (chrome/dom-widgets
  // pattern), so this reflector is `always` and self-gates. Any change that
  // moves a stroke arms `dirty`; the preview is diffed by value each frame.
  let dirty = true;
  let lastPreviewKey = "";
  let redraws = 0;
  const wake = () => {
    dirty = true;
  };
  const unsubs: Array<() => void> = [
    world.reactive.observeResource(Camera, wake),
    world.reactive.observeQuery(wireQ, wake, { cols: [] }),
    world.reactive.observeQuery(geometryQ, wake, { cols: [Position, Size] }),
    world.reactive.observeQuery(selectedQ, wake, { cols: [] }),
    world.reactive.observeQuery(portQ, wake, { cols: [PortAnchor] }),
    world.reactive.observeQuery(routedConnectQ, wake, { cols: [] }),
  ];

  function applySize(cssWidth: number, cssHeight: number): void {
    dpr = doc.defaultView?.devicePixelRatio ?? 1;
    const bufW = Math.max(1, Math.round(cssWidth * dpr));
    const bufH = Math.max(1, Math.round(cssHeight * dpr));
    if (canvas.width !== bufW) canvas.width = bufW;
    if (canvas.height !== bufH) canvas.height = bufH;
    // Resizing a canvas resets its context state; a re-stroke is owed.
    dirty = true;
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

  /** Stroke one screen-space cubic. */
  function strokeCubic(c2d: CanvasRenderingContext2D, s: Cubic): void {
    c2d.beginPath();
    c2d.moveTo(s.x0, s.y0);
    c2d.bezierCurveTo(s.x1, s.y1, s.x2, s.y2, s.x3, s.y3);
    c2d.stroke();
  }

  /**
   * Resolve a wire endpoint's anchor rect + port slot from its endpoint widget +
   * port id (mirrors core `l1-wires` `endpointAnchor` null-handling: a `string`
   * PrefabId, a registered type, a declared port — anything missing => undefined,
   * and the caller skips the wire).
   */
  function endpointAnchor(widget: Entity | undefined, portId: string): { anchor: Rect; slot: PortSlot } | undefined {
    if (widget === undefined) return undefined;
    const rect = readRect(world, widget);
    if (rect === undefined) return undefined;
    const type = world.get(widget, PrefabId)?.id;
    if (typeof type !== "string") return undefined;
    const wt = widgets.get(type);
    if (wt === undefined) return undefined;
    const slot = slotOf(wt, portId);
    if (slot === undefined) return undefined;
    return { anchor: rect, slot };
  }

  function drawWires(c2d: CanvasRenderingContext2D, cam: CameraState): void {
    world.query(wireQ).each((batch) => {
      for (const r of batch) {
        const wire = batch.entity(r);
        const ports = world.get(wire, WirePorts);
        if (ports === undefined) continue;
        const from = endpointAnchor(world.getRelation(wire, WireFrom), ports.from ?? "");
        const to = endpointAnchor(world.getRelation(wire, WireTo), ports.to ?? "");
        if (from === undefined || to === undefined) continue;
        const a0 = portAnchor(from.anchor, from.slot);
        const a1 = portAnchor(to.anchor, to.slot);
        const cubic = wireCubic(a0, from.slot.side, a1, to.slot.side);
        const selected = world.hasTag(wire, Selected);
        c2d.strokeStyle = selected ? config.selectedColor : config.wireColor;
        c2d.lineWidth = selected ? config.selectedWidth : config.wireWidth;
        c2d.setLineDash([]);
        strokeCubic(c2d, cubicToScreen(cubic, cam));
      }
    });
  }

  function drawPreview(c2d: CanvasRenderingContext2D, cam: CameraState, preview: WirePreview): void {
    if (!preview.active) return;
    // The preview buffer carries no port sides (a free drag), so build a smooth
    // horizontal-stub cubic between the two world points — a readable stand-in
    // until the wire commits and gets its real port sides.
    const stub = Math.max(24, Math.abs(preview.tx - preview.sx) * 0.5);
    const cubic: Cubic = {
      x0: preview.sx,
      y0: preview.sy,
      x1: preview.sx + stub,
      y1: preview.sy,
      x2: preview.tx - stub,
      y2: preview.ty,
      x3: preview.tx,
      y3: preview.ty,
    };
    c2d.strokeStyle = preview.compatible ? config.selectedColor : config.wireColor;
    c2d.lineWidth = config.wireWidth;
    c2d.setLineDash(preview.compatible ? [] : [6, 4]);
    strokeCubic(c2d, cubicToScreen(cubic, cam));
    c2d.setLineDash([]);
  }

  function drawPorts(c2d: CanvasRenderingContext2D, cam: CameraState): void {
    const connecting = world.firstOf(routedConnectQ) !== undefined;
    c2d.fillStyle = connecting ? config.portActiveColor : config.portColor;
    world.query(portQ).each((batch) => {
      const ax = batch.col(PortAnchor).x;
      const ay = batch.col(PortAnchor).y;
      for (const r of batch) {
        const s = worldToScreen(ax[r] as number, ay[r] as number, cam);
        c2d.beginPath();
        c2d.arc(s.x, s.y, config.portRadius, 0, Math.PI * 2);
        c2d.fill();
      }
    });
  }

  function redraw(c2d: CanvasRenderingContext2D, cam: CameraState, preview: WirePreview): void {
    // Clear the full backing buffer (identity), then draw in CSS px (dpr scale).
    c2d.setTransform(1, 0, 0, 1, 0, 0);
    c2d.clearRect(0, 0, canvas.width, canvas.height);
    c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    redraws++;
    drawWires(c2d, cam);
    drawPreview(c2d, cam, preview);
    drawPorts(c2d, cam);
  }

  return {
    name: "wires",
    // The preview buffer has no ECS stamp; self-gate on a private dirty flag
    // (chrome/dom-widgets pattern) rather than the registry's observe dirt.
    always: true,
    flush(w: World) {
      if (ctx === null) return;
      const cam = w.getResource(Camera);
      if (cam === undefined) return;
      const preview = readPreview();
      const previewKey = preview.active
        ? `${preview.sx},${preview.sy},${preview.tx},${preview.ty},${preview.compatible ? 1 : 0}`
        : "";
      if (previewKey !== lastPreviewKey) {
        lastPreviewKey = previewKey;
        dirty = true;
      }
      if (!dirty) return;
      dirty = false;
      try {
        redraw(ctx, cam, preview);
      } catch {
        ctx = null; // context loss => degrade to a silent no-op, never a throwing reflector
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
