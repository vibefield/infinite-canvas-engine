/**
 * L1 — wire geometry sync (design-004 §6 ports & wires runtime; `react` phase,
 * AFTER `spatialSync`).
 *
 * A wire is a durable reified edge (Wire tag + WireFrom/WireTo → widgets +
 * WirePorts ids). Its RENDER + PICK geometry is a pure function of the two
 * endpoint widget rects and their port declarations (design-001 §5.3: geometry
 * never reads a port entity — culled endpoints resolve by construction). This
 * TICK system (strata 0.5.0) recomputes each wire's cubic once per frame and
 * keeps a private cache so the shared spatial index only churns on real
 * movement — exactly the `spatialSync` idiom, and the reason it must run every
 * frame: it is a `SpatialVersion` writer and cannot gate on the version it bumps.
 *
 * Per wire: resolve WireFrom/WireTo → endpoint Position+Size + the port slot
 * (PrefabId → widget registry → decl → kernel `portAnchor`) → `wireCubic` →
 * `cubicAABB`. Endpoint or declaration unresolvable (mid-projection, a despawned
 * widget, a removed port id) ⇒ the wire leaves the index (invisible to picking;
 * the renderer draws nothing for it). The cache also feeds the `WirePickSource`
 * the point-pick narrow-phases against (`ops/point-pick`), and exposes the
 * screen-constant pick slop as `slopWorld = wirePickSlopPx / zoom`.
 */
import type { Component, Entity, TickSystem, World } from "@vibecook/strata-ecs";
import { defineQuery, defineTickSystem } from "@vibecook/strata-ecs";
import { type AABB, type Cubic, type SpatialIndex, cubicAABB, portAnchor, wireCubic } from "@ice/kernel";
import { Camera, Position, Size, Wire, WireFrom, WirePorts, WireTo } from "../catalog";
import { widgetTypeFor } from "../canvas/engine-catalog";
import { SpatialVersion, bumpVersion } from "../helpers/version-stamps";
import { portSlotOf } from "../ops/port-geometry";
import type { WirePickSource } from "../ops/point-pick";
import { PrefabId } from "../schema/prefab";
import { GRAPH_PICK_DEFAULTS } from "../settings/defaults";

/** The structural read the endpoint resolver needs (World and SystemCtx both satisfy it). */
interface AnchorReader {
  get<S>(e: Entity, c: Component<S>): S | undefined;
}

interface WireCacheEntry {
  fx: number;
  fy: number;
  tx: number;
  ty: number;
  fromSide: string;
  toSide: string;
  cubic: Cubic;
  aabb: AABB;
}

export interface WireSyncSystem {
  wireSync: TickSystem;
  /** The narrow-phase source `pickTopAt` consults for wire entries. */
  wires: WirePickSource;
}

const wireQ = defineQuery([Wire, WirePorts]);

/** Endpoint anchor (world) for a wire's end, or undefined if unresolvable. */
function endpointAnchor(
  reader: AnchorReader,
  world: World,
  widget: Entity | undefined,
  portId: string,
): { x: number; y: number; side: string } | undefined {
  if (widget === undefined) return undefined;
  const pos = reader.get(widget, Position);
  const size = reader.get(widget, Size);
  if (pos === undefined || size === undefined) return undefined;
  const type = reader.get(widget, PrefabId)?.id;
  const decls = typeof type === "string" ? widgetTypeFor(world, type)?.ports : undefined;
  if (decls === undefined) return undefined;
  const slot = portSlotOf(decls, portId);
  if (slot === undefined) return undefined;
  const a = portAnchor({ x: pos.x, y: pos.y, width: size.w, height: size.h }, slot);
  return { x: a.x, y: a.y, side: slot.side };
}

export function createWireSync(world: World, index: SpatialIndex<Entity>): WireSyncSystem {
  // Private per-wire geometry cache — the compare-and-skip that keeps this cheap
  // while it runs every frame (it is the SpatialVersion writer, spatialSync idiom).
  const cache = new Map<Entity, WireCacheEntry>();

  const wireSync = defineTickSystem(
    (ctx) => {
      const seen = new Set<Entity>();
      let changed = false;

      ctx.query(wireQ).each((batch) => {
        for (const row of batch) {
          const wire = batch.entity(row);
          const ports = ctx.read(wire, WirePorts);
          const from = endpointAnchor(ctx, world, ctx.getRelation(wire, WireFrom), ports.from ?? "");
          const to = endpointAnchor(ctx, world, ctx.getRelation(wire, WireTo), ports.to ?? "");
          if (from === undefined || to === undefined) {
            // Unresolvable this frame — drop from the index (renderer draws nothing).
            if (cache.has(wire)) {
              index.remove(wire);
              cache.delete(wire);
              changed = true;
            }
            continue;
          }
          seen.add(wire);
          const prev = cache.get(wire);
          if (
            prev !== undefined &&
            prev.fx === from.x &&
            prev.fy === from.y &&
            prev.tx === to.x &&
            prev.ty === to.y &&
            prev.fromSide === from.side &&
            prev.toSide === to.side
          ) {
            continue; // geometry unchanged — no index churn
          }
          const cubic = wireCubic(
            { x: from.x, y: from.y },
            from.side as "n" | "e" | "s" | "w",
            { x: to.x, y: to.y },
            to.side as "n" | "e" | "s" | "w",
          );
          const aabb = cubicAABB(cubic);
          index.upsert(wire, aabb);
          cache.set(wire, {
            fx: from.x,
            fy: from.y,
            tx: to.x,
            ty: to.y,
            fromSide: from.side,
            toSide: to.side,
            cubic,
            aabb,
          });
          changed = true;
        }
      });

      // Sweep wires that despawned (or went unresolvable and were never re-added).
      const gone: Entity[] = [];
      for (const e of cache.keys()) if (!seen.has(e)) gone.push(e);
      for (const e of gone) {
        index.remove(e);
        cache.delete(e);
        changed = true;
      }

      if (changed) bumpVersion(world, SpatialVersion);
    },
    { name: "wireSync" },
  );

  const wires: WirePickSource = {
    cubicOf: (e) => cache.get(e)?.cubic,
    get slopWorld() {
      const zoom = world.getResource(Camera)?.zoom ?? 1;
      return GRAPH_PICK_DEFAULTS.wirePickSlopPx / (zoom || 1);
    },
  };

  return { wireSync, wires };
}
