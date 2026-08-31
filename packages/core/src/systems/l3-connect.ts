/**
 * L3 — connect behavior (design-003 §5 item 8, §4.5 connectClaim; design-004 §6;
 * `ctl:claim` + `ctl:behave`). The node-editor core gesture: drag from a source
 * port to a compatible target port, commit ONE wire.
 *
 * `connectClaim` (JustActive × RoutedConnect): latch the source port — the
 * recognizer's `Captures` target must be a Port entity (dragRoute guarantees it,
 * or the connect tool started the drag). Recognizer field-sets are per-kind
 * (Drag), so per-gesture claim state lives in a closure Map keyed by recognizer
 * (the `tweenStart`/camera-sim precedent), holding the source WIDGET + port id +
 * world anchor + accepts-keys. The preview buffer arms here.
 *
 * `connectBehavior` (a TICK system, like marquee, so it can CLEAR the preview the
 * frame after the gesture ends): per Active frame it writes the out-of-ECS
 * `WirePreviewBuffer` (source anchor → pointer world, snapped to a COMPATIBLE
 * port anchor when the watched pointer `Targets` one; type check via the widgets'
 * port decls; self-wire never compatible). On `JustEnded` over a compatible port
 * it commits `{kind:"connect", wires:[{from,to,fromPort,toPort}]}` (the doc sink
 * spawns the wire); elsewhere it commits nothing.
 *
 * PREVIEW CONTINUITY — SIMPLIFICATION ACCEPTED (design-003 §5.8 / design-002 §8):
 * the preview clears on JustEnded+1 (one linger frame) rather than persisting
 * until the projected wire entity places (the promote-sweep analog). Full
 * continuity — hand the preview off to the freshly-synced wire with no blink —
 * is polish deferred; the one-frame gap is invisible in practice.
 */
import type { Entity, System, SystemCtx, TickSystem, World } from "@vibecook/strata-ecs";
import { defineQuery, defineSystem, defineTickSystem } from "@vibecook/strata-ecs";
import { type CameraState, type SpatialIndex, portAnchor, screenToWorld } from "@ice/kernel";
import {
  Camera,
  Captures,
  Drag,
  GesturePhases,
  Port,
  PortOf,
  PointerScreen,
  Position,
  RoutedConnect,
  Size,
  Targets,
  Watches,
} from "../catalog";
import { widgetTypeFor } from "../canvas/engine-catalog";
import type { CommitSink } from "../engine/commit-sink";
import { portSlots } from "../ops/port-geometry";
import type { WirePickSource } from "../ops/point-pick";
import { PrefabId } from "../schema/prefab";

const P = GesturePhases;

/**
 * The out-of-ECS connect preview (design-004 §6; the marquee-buffer precedent).
 * `sx,sy` = source port world anchor; `tx,ty` = the projected endpoint (pointer
 * world, or a snapped compatible-port anchor); `compatible` gates the landing.
 */
export interface WirePreviewBuffer {
  active: boolean;
  compatible: boolean;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
}

/** Latched at claim: the source port, by value (survives a reaped source port). */
interface SourceLatch {
  widget: Entity;
  portId: string;
  ax: number;
  ay: number;
  accepts: readonly string[];
}

export interface ConnectSystems {
  connectClaim: System;
  connectBehavior: TickSystem;
  previewBuffer: WirePreviewBuffer;
}

const connectClaimQ = defineQuery([Drag, P.justTags.Active, RoutedConnect]);
const connectDragQ = defineQuery([Drag, RoutedConnect]);

/** Port declarations of a ported widget, or undefined (not a widget / no ports). */
function declsOf(world: World, ctx: SystemCtx, e: Entity) {
  const type = ctx.get(e, PrefabId)?.id;
  if (typeof type !== "string") return undefined;
  const decls = widgetTypeFor(world, type)?.ports;
  return decls !== undefined && decls.length > 0 ? decls : undefined;
}

/** World anchor of one port on a widget, or undefined if unresolvable. */
function anchorOf(world: World, ctx: SystemCtx, widget: Entity, portId: string): { x: number; y: number } | undefined {
  const decls = declsOf(world, ctx, widget);
  if (decls === undefined) return undefined;
  const slot = portSlots(decls).get(portId);
  const pos = ctx.get(widget, Position);
  const size = ctx.get(widget, Size);
  if (slot === undefined || pos === undefined || size === undefined) return undefined;
  return portAnchor({ x: pos.x, y: pos.y, width: size.w, height: size.h }, slot);
}

/** Empty accepts on either side = wildcard; otherwise the key lists must intersect. */
function compatible(source: readonly string[], candidate: readonly string[]): boolean {
  if (source.length === 0 || candidate.length === 0) return true;
  return source.some((k) => candidate.includes(k));
}

/**
 * Signature carries the full graph-slice wiring (design brief) though connect
 * reads only `Targets` today:
 * @param _world reserved (systems reach world state via `ctx`).
 * @param _index reserved (future: a fresh event-time port pick to drop the
 *   one-frame `Targets` staleness on snapping — the router's pattern).
 * @param _wires reserved (the wire narrow-phase source; connect reads `Targets`).
 */
export function createConnectSystems(
  world: World,
  sink: CommitSink,
  _index: SpatialIndex<Entity>,
  _wires: WirePickSource,
): ConnectSystems {
  const sourceOf = new Map<Entity, SourceLatch>();
  const previewBuffer: WirePreviewBuffer = { active: false, compatible: false, sx: 0, sy: 0, tx: 0, ty: 0 };
  let linger = false;

  const clearPreview = (): void => {
    previewBuffer.active = false;
    previewBuffer.compatible = false;
  };

  const connectClaim = defineSystem(
    connectClaimQ,
    (b, ctx) => {
      for (const r of b) {
        const rec = b.entity(r);
        const srcPort = ctx.getRelation(rec, Captures);
        if (srcPort === undefined || !ctx.isAlive(srcPort) || !ctx.has(srcPort, Port)) continue;
        const portId = ctx.get(srcPort, Port)?.id;
        const widget = ctx.getRelation(srcPort, PortOf);
        if (typeof portId !== "string" || widget === undefined) continue;
        const anchor = anchorOf(world, ctx, widget, portId);
        if (anchor === undefined) continue;
        const decls = declsOf(world, ctx, widget);
        const accepts = decls?.find((d) => d.id === portId)?.accepts ?? [];
        sourceOf.set(rec, { widget, portId, ax: anchor.x, ay: anchor.y, accepts });
        previewBuffer.active = true;
        previewBuffer.sx = anchor.x;
        previewBuffer.sy = anchor.y;
        previewBuffer.tx = anchor.x;
        previewBuffer.ty = anchor.y;
        previewBuffer.compatible = false;
      }
    },
    { name: "connectClaim" },
  );

  /** Resolve the drag's current endpoint: pointer world, snapped to a compatible port. */
  const resolveTarget = (
    ctx: SystemCtx,
    rec: Entity,
    src: SourceLatch,
    cam: CameraState,
  ): { tx: number; ty: number; compatible: boolean; targetWidget?: Entity; targetPortId?: string } => {
    const pointer = ctx.getRelations(rec, Watches)[0];
    if (pointer === undefined) return { tx: src.ax, ty: src.ay, compatible: false };
    const ps = ctx.get(pointer, PointerScreen);
    const pw = ps !== undefined ? screenToWorld(ps.x, ps.y, cam) : { x: src.ax, y: src.ay };

    const t = ctx.getRelation(pointer, Targets);
    if (t !== undefined && ctx.isAlive(t) && ctx.has(t, Port)) {
      const targetWidget = ctx.getRelation(t, PortOf);
      const targetPortId = ctx.get(t, Port)?.id;
      if (
        targetWidget !== undefined &&
        targetWidget !== src.widget && // self-wire is never compatible
        typeof targetPortId === "string"
      ) {
        const decls = declsOf(world, ctx, targetWidget);
        const accepts = decls?.find((d) => d.id === targetPortId)?.accepts ?? [];
        if (compatible(src.accepts, accepts)) {
          const a = anchorOf(world, ctx, targetWidget, targetPortId);
          if (a !== undefined) {
            return { tx: a.x, ty: a.y, compatible: true, targetWidget, targetPortId };
          }
        }
      }
    }
    return { tx: pw.x, ty: pw.y, compatible: false };
  };

  // TICK system (strata 0.5.0): runs every frame so the preview CLEARS the frame
  // after the gesture ends (JustEnded+1), the way marquee clears its buffer.
  const connectBehavior = defineTickSystem(
    (ctx) => {
      const cam0 = ctx.getResource(Camera);
      const cam: CameraState = { x: cam0?.x ?? 0, y: cam0?.y ?? 0, zoom: cam0?.zoom ?? 1 };
      let active = false;

      ctx.query(connectDragQ).each((b) => {
        for (const r of b) {
          const rec = b.entity(r);
          const src = sourceOf.get(rec);
          if (src === undefined) continue;

          if (ctx.hasTag(rec, P.tags.Active)) {
            const res = resolveTarget(ctx, rec, src, cam);
            previewBuffer.active = true;
            previewBuffer.sx = src.ax;
            previewBuffer.sy = src.ay;
            previewBuffer.tx = res.tx;
            previewBuffer.ty = res.ty;
            previewBuffer.compatible = res.compatible;
            active = true;
            continue;
          }

          if (ctx.hasTag(rec, P.justTags.Ended)) {
            const res = resolveTarget(ctx, rec, src, cam);
            // Keep the preview shown at the end pose for this frame (linger).
            previewBuffer.active = true;
            previewBuffer.sx = src.ax;
            previewBuffer.sy = src.ay;
            previewBuffer.tx = res.tx;
            previewBuffer.ty = res.ty;
            previewBuffer.compatible = res.compatible;
            active = true;
            linger = true;
            if (res.compatible && res.targetWidget !== undefined && res.targetPortId !== undefined) {
              sink.commit({
                kind: "connect",
                gesture: rec,
                writes: [],
                wires: [
                  { from: src.widget, to: res.targetWidget, fromPort: src.portId, toPort: res.targetPortId },
                ],
              });
            }
            sourceOf.delete(rec);
          } else if (
            ctx.hasTag(rec, P.justTags.Cancelled) ||
            ctx.hasTag(rec, P.justTags.Failed)
          ) {
            sourceOf.delete(rec); // dropped — nothing commits, preview clears below
          }
        }
      });

      if (active) {
        previewBuffer.active = true;
      } else if (linger) {
        linger = false; // JustEnded+1 — the promised cleanup tick
        clearPreview();
      } else if (previewBuffer.active) {
        clearPreview();
      }
    },
    { name: "connectBehavior" },
  );

  return { connectClaim, connectBehavior, previewBuffer };
}
