/**
 * The pointer router's GL path (design-004 §4, rev 2 corrected).
 *
 * At EVENT time (outside the tick — world reads are verified-unrestricted)
 * the router runs its own synchronous point-pick against THE spatial index
 * via core's `pickTopAt` — the identical narrow-phase the in-tick `picking`
 * system runs, so the two can never disagree. It does NOT consult last-frame
 * `Targets`: that relation is absent for a touch's first event (the pointer
 * entity doesn't exist yet at down) and stale for fast mouse crossings —
 * rev 1 of the design ate the first tap on every interactive GL widget.
 * `Targets` remains the in-tick authority; this pick is a routing decision,
 * not a second truth.
 *
 * Hit a GL-view widget → island-local convert (kernel, THE Y-flip) → raycast
 * the island's scene through its ortho camera → dispatch synthetic events to
 * the intersected objects' R3F handlers. A handler calling
 * `stopPropagation()` claims the event: the adapter flags the fact
 * `surfaceHandled` and recognizers skip it (`HandledByWidget`, the M4 spine).
 *
 * Capture semantics (per island): a claimed down captures the pointer — its
 * moves/ups go to that island until up/cancel, mirroring how DOM widget
 * content holds `setPointerCapture` for sustained interactions. Hover
 * enter/leave are synthesized from pick transitions on buttonless moves.
 *
 * R3F-INTERNAL-ADJACENT (the one acknowledged spot, implementation-plan
 * risks): handlers are read from `object.__r3f.handlers` — the instance
 * state R3F v9 attaches to every declaratively-created three object. No
 * other R3F internal is touched; the dispatcher owns its own event shape.
 * Mid-event ordering note (design-004 §4): handlers may run engine ops —
 * legal; such mutations land immediately while the same event's position
 * facts land next tick via the queue.
 */
import { Raycaster, Vector2, type Intersection, type Object3D } from "three";
import { screenToWorld, worldToIsland } from "@ice/kernel";
import type { SpatialIndex } from "@ice/kernel";
import {
  Camera,
  PrefabId,
  Position,
  Size,
  pickTopAt,
  widgets,
  type Entity,
  type World,
} from "@ice/core";
import type { GLBridge } from "./bridge";

/** The synthetic event island handlers receive (R3F-handler-compatible core). */
export interface IslandPointerEvent {
  readonly type: string;
  readonly nativeEvent: PointerEvent;
  /** Island-local intersection point (three world = island space). */
  readonly point: Intersection["point"] | undefined;
  readonly distance: number;
  readonly object: Object3D;
  readonly eventObject: Object3D;
  readonly intersections: readonly Intersection[];
  readonly entity: Entity;
  stopPropagation(): void;
  readonly stopped: boolean;
}

type HandlerName =
  | "onPointerDown"
  | "onPointerMove"
  | "onPointerUp"
  | "onPointerCancel"
  | "onPointerOver"
  | "onPointerOut"
  | "onClick";

/** R3F v9 instance state — the single internal-adjacent touchpoint. */
interface R3FInstance {
  eventCount?: number;
  handlers?: Partial<Record<HandlerName, (ev: IslandPointerEvent) => void>>;
}

function handlersOf(obj: Object3D): R3FInstance["handlers"] | undefined {
  const inst = (obj as unknown as { __r3f?: R3FInstance }).__r3f;
  if (inst === undefined || (inst.eventCount ?? 0) === 0) return undefined;
  return inst.handlers;
}

export interface GLPointerRouterDeps {
  readonly world: World;
  readonly bridge: GLBridge;
  readonly index: SpatialIndex<Entity>;
}

export interface GLPointerRouter {
  /** The adapter's `glRoute` seam. True = island content claimed the event. */
  route(kind: "down" | "move" | "up" | "cancel", screenX: number, screenY: number, native: PointerEvent): boolean;
}

export function createGLPointerRouter({ world, bridge, index }: GLPointerRouterDeps): GLPointerRouter {
  const raycaster = new Raycaster();
  const ndc = new Vector2();

  // pointerId → captured island + the down's claiming object (click pairing).
  const captures = new Map<number, { entity: Entity; downObject: Object3D | undefined }>();
  // entity → objects currently hovered (buttonless-move enter/leave synth).
  const hovered = new Map<Entity, Set<Object3D>>();

  /** Screen → (GL widget entity, island intersections); undefined off-GL. */
  const castAt = (
    screenX: number,
    screenY: number,
  ): { entity: Entity; hits: Intersection[] } | undefined => {
    const cam = world.getResource(Camera);
    if (cam === undefined) return undefined;
    const w = screenToWorld(screenX, screenY, cam);
    const hit = pickTopAt(world, index, w.x, w.y, 0);
    if (hit === undefined) return undefined;
    const type = world.get(hit, PrefabId)?.id;
    const widget = typeof type === "string" ? widgets.get(type) : undefined;
    if (widget === undefined || widget.surface !== "gl") return undefined;
    const handle = bridge.islandFor(hit);
    const pos = world.get(hit, Position);
    const size = world.get(hit, Size);
    if (handle === undefined || pos === undefined || size === undefined || size.w <= 0 || size.h <= 0) {
      return undefined; // culled island (no scene) — the retained texture is not interactive
    }
    const local = worldToIsland(w.x, w.y, { x: pos.x, y: pos.y, width: size.w, height: size.h });
    ndc.set(local.x / (size.w / 2), local.y / (size.h / 2));
    // The event-time raycast must not depend on paint order (a tap can land
    // before the island's first paint sets the camera frustum): write the
    // frustum from the live Size and refresh matrices here. Event-rate, small
    // trees — cheap.
    const cam3 = handle.camera;
    cam3.left = -size.w / 2;
    cam3.right = size.w / 2;
    cam3.top = size.h / 2;
    cam3.bottom = -size.h / 2;
    cam3.updateProjectionMatrix();
    cam3.updateMatrixWorld(true);
    handle.scene.updateMatrixWorld(true);
    raycaster.setFromCamera(ndc, cam3);
    return { entity: hit, hits: raycaster.intersectObjects(handle.scene.children, true) };
  };

  /** R3F bubbling: per intersection, walk up; dedupe eventObjects; stop on stopPropagation. */
  const dispatch = (
    type: HandlerName,
    eventType: string,
    entity: Entity,
    hits: readonly Intersection[],
    native: PointerEvent,
    only?: Object3D,
  ): { stopped: boolean; claimedBy: Object3D | undefined } => {
    const visited = new Set<Object3D>();
    let stopped = false;
    let claimedBy: Object3D | undefined;
    const targets: { obj: Object3D; hit: Intersection | undefined }[] = [];
    if (hits.length === 0 && only !== undefined) {
      targets.push({ obj: only, hit: undefined }); // captured island, ray off content
    }
    for (const hit of hits) {
      for (let obj: Object3D | null = hit.object; obj !== null; obj = obj.parent) {
        if (visited.has(obj)) continue;
        visited.add(obj);
        targets.push({ obj, hit });
      }
    }
    for (const { obj, hit } of targets) {
      const fn = handlersOf(obj)?.[type];
      if (fn === undefined) continue;
      let localStop = false;
      const ev: IslandPointerEvent = {
        type: eventType,
        nativeEvent: native,
        point: hit?.point,
        distance: hit?.distance ?? 0,
        object: hit?.object ?? obj,
        eventObject: obj,
        intersections: hits,
        entity,
        stopPropagation() {
          localStop = true;
        },
        get stopped() {
          return localStop;
        },
      };
      fn(ev);
      if (localStop) {
        stopped = true;
        claimedBy = obj;
        break;
      }
    }
    return { stopped, claimedBy };
  };

  /** Buttonless-move hover synth: over/out from pick transitions. */
  const syncHover = (
    now: { entity: Entity; hits: Intersection[] } | undefined,
    native: PointerEvent,
  ): void => {
    const nowEntity = now?.entity;
    const nowObjs = new Set<Object3D>();
    if (now !== undefined) {
      for (const hit of now.hits) {
        for (let obj: Object3D | null = hit.object; obj !== null; obj = obj.parent) nowObjs.add(obj);
      }
    }
    for (const [entity, prev] of hovered) {
      const gone: Object3D[] = [];
      for (const obj of prev) {
        if (entity !== nowEntity || !nowObjs.has(obj)) gone.push(obj);
      }
      for (const obj of gone) {
        prev.delete(obj);
        handlersOf(obj)?.onPointerOut?.({
          type: "pointerout",
          nativeEvent: native,
          point: undefined,
          distance: 0,
          object: obj,
          eventObject: obj,
          intersections: [],
          entity,
          stopPropagation() {},
          stopped: false,
        });
      }
      if (prev.size === 0) hovered.delete(entity);
    }
    if (now !== undefined && nowEntity !== undefined) {
      let set = hovered.get(nowEntity);
      if (set === undefined) {
        set = new Set();
        hovered.set(nowEntity, set);
      }
      for (const obj of nowObjs) {
        if (set.has(obj) || handlersOf(obj) === undefined) continue;
        set.add(obj);
        handlersOf(obj)?.onPointerOver?.({
          type: "pointerover",
          nativeEvent: native,
          point: undefined,
          distance: 0,
          object: obj,
          eventObject: obj,
          intersections: now.hits,
          entity: nowEntity,
          stopPropagation() {},
          stopped: false,
        });
      }
    }
  };

  return {
    route(kind, screenX, screenY, native) {
      if (kind === "down") {
        const cast = castAt(screenX, screenY);
        if (cast === undefined) return false;
        const { stopped, claimedBy } = dispatch("onPointerDown", "pointerdown", cast.entity, cast.hits, native);
        if (stopped) {
          captures.set(native.pointerId, { entity: cast.entity, downObject: claimedBy });
          return true;
        }
        return false;
      }

      const capture = captures.get(native.pointerId);

      if (kind === "move") {
        if (capture !== undefined) {
          const cast = castAt(screenX, screenY);
          const hits = cast !== undefined && cast.entity === capture.entity ? cast.hits : [];
          dispatch("onPointerMove", "pointermove", capture.entity, hits, native, capture.downObject);
          return true;
        }
        if (native.buttons === 0) syncHover(castAt(screenX, screenY), native);
        return false;
      }

      // up | cancel
      if (capture === undefined) return false;
      captures.delete(native.pointerId);
      const cast = castAt(screenX, screenY);
      const hits = cast !== undefined && cast.entity === capture.entity ? cast.hits : [];
      if (kind === "up") {
        const { claimedBy } = dispatch("onPointerUp", "pointerup", capture.entity, hits, native, capture.downObject);
        // Click pairs down+up on the same claiming object (R3F semantics).
        const clickTarget = claimedBy ?? capture.downObject;
        if (clickTarget !== undefined && clickTarget === capture.downObject) {
          dispatch("onClick", "click", capture.entity, hits, native, clickTarget);
        }
      } else {
        dispatch("onPointerCancel", "pointercancel", capture.entity, hits, native, capture.downObject);
      }
      return true;
    },
  };
}
