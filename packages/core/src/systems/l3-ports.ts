/**
 * L3 — port materialization (design-004 §6 ports & wires runtime; `derive`
 * phase, BEFORE `selectionChrome`). The LOCKED gating from design-004 §6 /
 * design-001 §5.3: port ENTITIES are runtime and on-demand, so steady-state
 * pan/zoom with the select tool spawns ZERO ports.
 *
 * Three triggers materialize a widget's declared ports (registry decl → kernel
 * `portAnchor`; a port carries Port + PortAnchor + PortOf → widget, and NO
 * Position/Size — `spatialSync` must never see it; design-004 §6, the
 * SelectionBox precedent). Because ports carry no Position/Size, this system
 * gives them their OWN tiny world AABB in the shared spatial index so they are
 * pickable (design-003 §3 port tier):
 *   (a) connect tool → widgets in viewport+overscan (`200/zoom`); materialize at
 *       the overscan band, keep across a ×1.5 hysteresis band;
 *   (b) any local pointer `Targets` a ported widget → that widget's ports;
 *   (c) an Active `RoutedConnect` drag → COMPATIBLE ports (accepts-key
 *       intersection with the source port; empty accepts = wildcard) light up
 *       STAGED by distance-to-pointer, capped to the nearest 256 within the
 *       `portLightUpRadiusPx` screen radius (rev 2: "all visible" at a 10k
 *       zoomed-out view meant multi-second fills + sustained pick churn).
 *
 * Spawn budget ≤ `portSpawnPerFrame` (64) per frame — staging spreads a big
 * light-up across frames. A widget's ports reap when every trigger lapsed for
 * `portReapGraceMs`, or immediately if the widget died. Anchors recompute each
 * frame and rewrite Port entities + index entries CHANGE-ONLY (a still widget
 * churns nothing). `SpatialVersion` bumps only on a real index change.
 */
import type { Entity, SystemCtx, TickSystem, World } from "@vibecook/strata-ecs";
import { defineQuery, defineTickSystem } from "@vibecook/strata-ecs";
import {
  type AABB,
  type CameraState,
  type SpatialIndex,
  intersectsAABB,
  portAnchor,
  screenToWorld,
} from "@ice/kernel";
import {
  Camera,
  Captures,
  Drag,
  GestureActive,
  LocalPointer,
  Pointer,
  PointerScreen,
  Port,
  PortAnchor,
  PortOf,
  Position,
  RoutedConnect,
  Size,
  Targets,
  Viewport,
  Watches,
} from "../catalog";
import { widgetTypeFor } from "../canvas/engine-catalog";
import { ActiveTool } from "../catalog/camera-derived";
import { FrameInfo } from "../engine/frame-info";
import { SpatialVersion, bumpVersion } from "../helpers/version-stamps";
import { portSlots } from "../ops/port-geometry";
import { PrefabId } from "../schema/prefab";
import { GRAPH_PICK_DEFAULTS, RUNTIME_BUDGETS } from "../settings/defaults";
import type { WidgetPortDecl } from "../widget/define-widget";

/** A materialized port: its entity + last-written anchor (change-only bookkeeping). */
interface PortRec {
  entity: Entity;
  ax: number;
  ay: number;
}

/** Per-widget materialization state (a derived cache, not world state). */
interface WidgetPorts {
  ports: Map<string, PortRec>;
  lastTriggerMs: number;
}

/** A pending spawn, ordered by distance-to-pointer so staging fills nearest-first. */
interface SpawnReq {
  widget: Entity;
  portId: string;
  ax: number;
  ay: number;
  dist: number;
}

const H = GRAPH_PICK_DEFAULTS.portIndexHalfWorld;

const portedQ = defineQuery([Pointer, LocalPointer]);
const connectDragQ = defineQuery([Drag, RoutedConnect, GestureActive]);

/** The port declarations of a ported widget, or undefined (not a widget / no ports). */
function portedDeclsOf(
  world: World,
  ctx: SystemCtx,
  e: Entity,
): readonly WidgetPortDecl[] | undefined {
  const type = ctx.get(e, PrefabId)?.id;
  if (typeof type !== "string") return undefined;
  const decls = widgetTypeFor(world, type)?.ports;
  return decls !== undefined && decls.length > 0 ? decls : undefined;
}

/** Empty accepts on either side = wildcard; otherwise the key lists must intersect. */
function compatible(source: readonly string[], candidate: readonly string[]): boolean {
  if (source.length === 0 || candidate.length === 0) return true;
  return source.some((k) => candidate.includes(k));
}

const portAabb = (ax: number, ay: number): AABB => ({
  minX: ax - H,
  minY: ay - H,
  maxX: ax + H,
  maxY: ay + H,
});

export function createPortMaterialize(world: World, index: SpatialIndex<Entity>): TickSystem {
  // Derived cache (not world state): widget → its materialized ports + last trigger.
  const byWidget = new Map<Entity, WidgetPorts>();

  const getWP = (widget: Entity): WidgetPorts => {
    let wp = byWidget.get(widget);
    if (wp === undefined) {
      wp = { ports: new Map(), lastTriggerMs: 0 };
      byWidget.set(widget, wp);
    }
    return wp;
  };

  return defineTickSystem(
    (ctx) => {
      const cam0 = ctx.getResource(Camera);
      const cam: CameraState = { x: cam0?.x ?? 0, y: cam0?.y ?? 0, zoom: cam0?.zoom ?? 1 };
      const zoom = cam.zoom || 1;
      const now = ctx.getResource(FrameInfo)?.now ?? 0;
      const tool = ctx.getResource(ActiveTool)?.id ?? "select";

      const requests: SpawnReq[] = [];
      const keepAlive = new Set<Entity>();

      // Rect of a widget (world) or undefined if it lost its geometry.
      const rectOf = (w: Entity): { x: number; y: number; width: number; height: number } | undefined => {
        const p = ctx.get(w, Position);
        const s = ctx.get(w, Size);
        if (p === undefined || s === undefined) return undefined;
        return { x: p.x, y: p.y, width: s.w, height: s.h };
      };

      // --- trigger (a): connect tool × viewport+overscan, ×1.5 keep hysteresis ---
      if (tool === "connect") {
        const vp = ctx.getResource(Viewport);
        const tl = screenToWorld(0, 0, cam);
        const br = screenToWorld(vp?.w ?? 0, vp?.h ?? 0, cam);
        const over = RUNTIME_BUDGETS.cullOverscanWorldPerZoom / zoom;
        const spawnBand: AABB = { minX: tl.x - over, minY: tl.y - over, maxX: br.x + over, maxY: br.y + over };
        const keep = over * 1.5;
        const keepBand: AABB = { minX: tl.x - keep, minY: tl.y - keep, maxX: br.x + keep, maxY: br.y + keep };
        for (const entry of index.search(keepBand)) {
          const w = entry.id;
          const decls = portedDeclsOf(world, ctx, w);
          if (decls === undefined) continue;
          keepAlive.add(w); // in the keep band → hysteresis holds it
          if (!intersectsAABB(entry, spawnBand)) continue;
          const rect = rectOf(w);
          if (rect === undefined) continue;
          for (const [portId, slot] of portSlots(decls)) {
            const a = portAnchor(rect, slot);
            requests.push({ widget: w, portId, ax: a.x, ay: a.y, dist: 0 });
          }
        }
      }

      // --- trigger (b): a local pointer Targets a ported widget ---
      ctx.query(portedQ).each((b) => {
        for (const r of b) {
          const p = b.entity(r);
          const t = ctx.getRelation(p, Targets);
          if (t === undefined) continue;
          const decls = portedDeclsOf(world, ctx, t);
          if (decls === undefined) continue;
          const rect = rectOf(t);
          if (rect === undefined) continue;
          keepAlive.add(t);
          for (const [portId, slot] of portSlots(decls)) {
            const a = portAnchor(rect, slot);
            requests.push({ widget: t, portId, ax: a.x, ay: a.y, dist: 0 });
          }
        }
      });

      // --- trigger (c): Active RoutedConnect drag → compatible nearby ports ---
      const R = RUNTIME_BUDGETS.portLightUpRadiusPx / zoom;
      ctx.query(connectDragQ).each((b) => {
        for (const r of b) {
          const rec = b.entity(r);
          const srcPort = ctx.getRelation(rec, Captures);
          if (srcPort === undefined || !ctx.isAlive(srcPort) || !ctx.has(srcPort, Port)) continue;
          const srcWidget = ctx.getRelation(srcPort, PortOf);
          if (srcWidget === undefined) continue;
          const srcId = ctx.get(srcPort, Port)?.id;
          const srcDecls = portedDeclsOf(world, ctx, srcWidget);
          const srcAccepts =
            srcDecls?.find((d) => d.id === srcId)?.accepts ?? ([] as readonly string[]);
          keepAlive.add(srcWidget); // keep the source's ports so Captures never dangles

          const pointer = ctx.getRelations(rec, Watches)[0];
          if (pointer === undefined) continue;
          const ps = ctx.get(pointer, PointerScreen);
          if (ps === undefined) continue;
          const pw = screenToWorld(ps.x, ps.y, cam);

          const candidates: SpawnReq[] = [];
          for (const entry of index.search({ minX: pw.x - R, minY: pw.y - R, maxX: pw.x + R, maxY: pw.y + R })) {
            const w = entry.id;
            if (w === srcWidget) continue;
            const decls = portedDeclsOf(world, ctx, w);
            if (decls === undefined) continue;
            const rect = rectOf(w);
            if (rect === undefined) continue;
            for (const [portId, slot] of portSlots(decls)) {
              const accepts = decls.find((d) => d.id === portId)?.accepts ?? [];
              if (!compatible(srcAccepts, accepts)) continue;
              const a = portAnchor(rect, slot);
              const dist = Math.hypot(a.x - pw.x, a.y - pw.y);
              if (dist > R) continue;
              candidates.push({ widget: w, portId, ax: a.x, ay: a.y, dist });
            }
          }
          // Nearest-256 within the radius (design-004 §6 cap).
          candidates.sort((x, y) => x.dist - y.dist);
          for (let i = 0; i < candidates.length && i < 256; i++) {
            const c = candidates[i];
            if (c === undefined) continue;
            keepAlive.add(c.widget);
            requests.push(c);
          }
        }
      });

      let changed = false;

      // Refresh the trigger clock for every kept-alive widget (grace timer reset).
      for (const w of keepAlive) getWP(w).lastTriggerMs = now;

      // Spawn missing ports nearest-first, within the per-frame budget (staging).
      requests.sort((a, b) => a.dist - b.dist);
      let budget = RUNTIME_BUDGETS.portSpawnPerFrame;
      for (const req of requests) {
        if (budget <= 0) break;
        const wp = getWP(req.widget);
        if (wp.ports.has(req.portId)) continue; // already materialized
        const decls = portedDeclsOf(world, ctx, req.widget);
        const slot = decls !== undefined ? portSlots(decls).get(req.portId) : undefined;
        if (slot === undefined) continue;
        const port = ctx.spawn({
          components: [
            [Port, { id: req.portId, side: slot.side, index: slot.index }],
            [PortAnchor, { x: req.ax, y: req.ay }],
          ],
        });
        ctx.setRelation(port, PortOf, req.widget); // PortOf is arity "one"
        index.upsert(port, portAabb(req.ax, req.ay));
        wp.ports.set(req.portId, { entity: port, ax: req.ax, ay: req.ay });
        budget -= 1;
        changed = true;
      }

      // Anchor upkeep (change-only) + reap on lapse/grace or widget death.
      const reap: Entity[] = [];
      for (const [widget, wp] of byWidget) {
        const rect = rectOf(widget);
        const dead = !ctx.isAlive(widget) || rect === undefined;
        if (dead || now - wp.lastTriggerMs > RUNTIME_BUDGETS.portReapGraceMs) {
          for (const rec of wp.ports.values()) {
            if (ctx.isAlive(rec.entity)) ctx.destroy(rec.entity);
            index.remove(rec.entity);
            changed = true;
          }
          reap.push(widget);
          continue;
        }
        const slots = portSlots(portedDeclsOf(world, ctx, widget) ?? []);
        for (const [portId, rec] of wp.ports) {
          const slot = slots.get(portId);
          if (slot === undefined || !ctx.isAlive(rec.entity)) continue;
          const a = portAnchor(rect, slot);
          if (a.x !== rec.ax || a.y !== rec.ay) {
            ctx.edit(rec.entity).set(PortAnchor, { x: a.x, y: a.y });
            index.upsert(rec.entity, portAabb(a.x, a.y));
            rec.ax = a.x;
            rec.ay = a.y;
            changed = true;
          }
        }
      }
      for (const w of reap) byWidget.delete(w);

      if (changed) bumpVersion(world, SpatialVersion);
    },
    { name: "portMaterialize", access: { write: [PortAnchor] } },
  );
}
