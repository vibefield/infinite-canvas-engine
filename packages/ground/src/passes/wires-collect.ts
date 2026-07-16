/**
 * Wires collector — the pure ECS→triangles half of the wires pass. Port of
 * the 2D-canvas wires reflector's drawing, kernel-tessellated:
 *
 * - Wire geometry NEVER reads a port ENTITY (design-001 §5.3): endpoints
 *   resolve from the wire's `WireFrom`/`WireTo` widgets + `WirePorts` ids
 *   against the type registry's static port schema (core `portSlots` — the
 *   old local resolver's TODO, retired), so a CULLED endpoint still draws.
 * - Cubics build in WORLD space then map control points through the kernel
 *   `worldToScreen` seam — bezier curves are affine-invariant, so the mapped
 *   cubic IS the screen curve — and `tessellateCubic` (0.25 px tolerance)
 *   flattens with density that tracks zoom for free.
 * - Connect preview: solid when snapped-compatible, dashed [6,4] otherwise
 *   (dash placement from the tessellation's arc-length prefix).
 * - Materialized port dots: triangle-fan discs, active color while any
 *   connect drag is routed.
 */
import {
  DEFAULT_WIRES_CONFIG,
  Drag,
  MeasuredSize,
  Port,
  PortAnchor,
  Position,
  PrefabId,
  RoutedConnect,
  Selected,
  Size,
  Wire,
  WireFrom,
  WirePorts,
  WireTo,
  defineQuery,
  portSlots,
  widgets,
  type Entity,
  type WidgetType,
  type WirePreviewBuffer,
  type WiresConfig,
  type World,
} from "@ice/core";
import {
  portAnchor,
  tessellateCubic,
  wireCubic,
  worldToScreen,
  type Cubic,
  type PortSlot,
  type Rect,
  type Tessellation,
} from "@ice/kernel";
import type { GroundFrame } from "../pass";
import { SoupBuilder, parseCssColor, type Rgba, type TriSoup } from "./soup-collect";

export const wireQ = defineQuery([Wire]);
export const geometryQ = defineQuery([Position, Size]);
export const measuredQ = defineQuery([MeasuredSize]);
export const selectedQ = defineQuery([Selected]);
export const portQ = defineQuery([Port, PortAnchor]);
export const routedConnectQ = defineQuery([RoutedConnect]);
/** A live connect drag moves the preview every frame — Drag value dirt covers it. */
export const connectDragQ = defineQuery([RoutedConnect, Drag]);

const TESSELLATION_TOLERANCE_PX = 0.25;
const DASH_PX = 6;
const GAP_PX = 4;

/** Effective widget rect: non-zero MeasuredSize over Size (design-004 §2). */
function readRect(world: World, e: Entity): Rect | undefined {
  const p = world.get(e, Position);
  if (p === undefined) return undefined;
  const measured = world.get(e, MeasuredSize);
  const s = measured !== undefined && measured.w > 0 ? measured : world.get(e, Size);
  if (s === undefined) return undefined;
  return { x: p.x, y: p.y, width: s.w, height: s.h };
}

/** Per-type slot cache (schemas are immutable; mirrors core ops/port-geometry). */
const slotCache = new Map<string, Map<string, PortSlot>>();
function slotOf(wt: WidgetType, portId: string): PortSlot | undefined {
  let slots = slotCache.get(wt.type);
  if (slots === undefined) {
    slots = portSlots(wt.ports);
    slotCache.set(wt.type, slots);
  }
  return slots.get(portId);
}

function endpointAnchor(
  world: World,
  widget: Entity | undefined,
  portId: string,
): { anchor: Rect; slot: PortSlot } | undefined {
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

/** Map a world cubic's control points to screen (affine ⇒ exact curve map). */
function cubicToScreen(c: Cubic, cam: GroundFrame["camera"]): Cubic {
  const p0 = worldToScreen(c.x0, c.y0, cam);
  const p1 = worldToScreen(c.x1, c.y1, cam);
  const p2 = worldToScreen(c.x2, c.y2, cam);
  const p3 = worldToScreen(c.x3, c.y3, cam);
  return { x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, x3: p3.x, y3: p3.y };
}

/** Point at arc length `d` via the tessellation's prefix sums (binary search + lerp). */
function pointAtLength(t: Tessellation, d: number): { x: number; y: number } {
  const arc = t.arcLength;
  const n = arc.length;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((arc[mid] as number) < d) lo = mid + 1;
    else hi = mid;
  }
  const i = Math.max(1, lo);
  const a = arc[i - 1] as number;
  const b = arc[i] as number;
  const f = b > a ? (d - a) / (b - a) : 0;
  const x0 = t.points[(i - 1) * 2] as number;
  const y0 = t.points[(i - 1) * 2 + 1] as number;
  const x1 = t.points[i * 2] as number;
  const y1 = t.points[i * 2 + 1] as number;
  return { x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f };
}

/** Emit a dashed stroke along the tessellation (straight dash segments — canvas parity at 6px dashes). */
function dashedStroke(soup: SoupBuilder, t: Tessellation, width: number, c: Rgba): void {
  const total = t.arcLength[t.arcLength.length - 1] as number;
  for (let d = 0; d < total; d += DASH_PX + GAP_PX) {
    const a = pointAtLength(t, d);
    const b = pointAtLength(t, Math.min(d + DASH_PX, total));
    soup.segment(a.x, a.y, b.x, b.y, width, c);
  }
}

export function collectWires(
  world: World,
  frame: GroundFrame,
  config: WiresConfig = DEFAULT_WIRES_CONFIG,
  preview?: WirePreviewBuffer,
): TriSoup {
  const soup = new SoupBuilder();
  const cam = frame.camera;
  const wireColor = parseCssColor(config.wireColor);
  const selectedColor = parseCssColor(config.selectedColor);

  // Committed wires.
  world.query(wireQ).each((batch) => {
    for (const r of batch) {
      const wire = batch.entity(r);
      const ports = world.get(wire, WirePorts);
      if (ports === undefined) continue;
      const from = endpointAnchor(world, world.getRelation(wire, WireFrom), ports.from ?? "");
      const to = endpointAnchor(world, world.getRelation(wire, WireTo), ports.to ?? "");
      if (from === undefined || to === undefined) continue;
      const cubic = wireCubic(
        portAnchor(from.anchor, from.slot),
        from.slot.side,
        portAnchor(to.anchor, to.slot),
        to.slot.side,
      );
      const selected = world.hasTag(wire, Selected);
      const t = tessellateCubic(cubicToScreen(cubic, cam), TESSELLATION_TOLERANCE_PX);
      soup.polyline(t.points, selected ? config.selectedWidth : config.wireWidth, selected ? selectedColor : wireColor);
    }
  });

  // Connect-drag preview (world coords in the buffer; horizontal-stub cubic —
  // the old reflector's readable stand-in until the wire commits real sides).
  if (preview?.active === true) {
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
    const t = tessellateCubic(cubicToScreen(cubic, cam), TESSELLATION_TOLERANCE_PX);
    if (preview.compatible) soup.polyline(t.points, config.wireWidth, selectedColor);
    else dashedStroke(soup, t, config.wireWidth, wireColor);
  }

  // Materialized port dots.
  const connecting = world.firstOf(routedConnectQ) !== undefined;
  const dotColor = parseCssColor(connecting ? config.portActiveColor : config.portColor);
  world.query(portQ).each((batch) => {
    const ax = batch.col(PortAnchor).x;
    const ay = batch.col(PortAnchor).y;
    for (const r of batch) {
      const s = worldToScreen(ax[r] as number, ay[r] as number, cam);
      soup.disc(s.x, s.y, config.portRadius, dotColor);
    }
  });

  return soup.build();
}
