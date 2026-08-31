/** One semantic placement authority for facade mutation and typed drop paths. */
import type { Entity, World } from "@vibecook/strata-ecs";
import { BoardRoot, ChildOf } from "../catalog/scene";
import { PrefabId } from "../schema/prefab";
import { canvasPackId } from "./define-canvas-type";
import type { EngineCatalog } from "./engine-catalog";

export type PlacementReason =
  | "ok"
  | "unknown-widget"
  | "pack-disabled"
  | "target-dead"
  | "target-not-frame"
  | "unknown-canvas"
  | "canvas-pack-disabled"
  | "frame-behavior-unavailable"
  | "widget-not-allowed"
  | "ingress-rejected"
  | "cycle"
  | "malformed-parent"
  | "depth-limit";

export type PlacementDecision =
  | { readonly ok: true; readonly canvasTypeId: string; readonly targetFrame: Entity }
  | {
      readonly ok: false;
      readonly reason: Exclude<PlacementReason, "ok">;
      readonly message: string;
    };

export interface PlacementAuthority {
  canPlace(widgetTypeId: string, targetFrame: Entity): PlacementDecision;
  canIngress(widgetTypeId: string, targetContainer: Entity): PlacementDecision;
  validateReparent(entity: Entity, targetFrame: Entity): PlacementDecision;
  assertPlace(widgetTypeId: string, targetFrame: Entity, operation: string): void;
  assertReparent(entity: Entity, targetFrame: Entity, operation: string): void;
}

export interface PlacementAuthorityOpts {
  readonly world: World;
  readonly catalog: EngineCatalog;
  readonly rootCanvasTypeId: () => string | undefined;
  readonly packEnabled?: (id: string, version: number) => boolean;
  /** False while a required semantic FrameBehavior is faulted/suspended. */
  readonly canvasWritable?: (canvasTypeId: string) => boolean;
  readonly maxDepth?: number;
}

const fail = (
  reason: Exclude<PlacementReason, "ok">,
  message: string,
): PlacementDecision => ({ ok: false, reason, message });

export function createPlacementAuthority(opts: PlacementAuthorityOpts): PlacementAuthority {
  const { world, catalog } = opts;
  const maxDepth = opts.maxDepth ?? 64;

  const frameCanvas = (
    targetFrame: Entity,
  ): { readonly id: string; readonly depth: number } | PlacementDecision => {
    if (!world.isAlive(targetFrame)) return fail("target-dead", "target frame is not live");
    const root = world.getResource(BoardRoot)?.root;
    if (root !== undefined && targetFrame === root) {
      const id = opts.rootCanvasTypeId();
      return id === undefined
        ? fail("unknown-canvas", "attached document has no root CanvasType")
        : { id, depth: 0 };
    }

    const typeId = world.get(targetFrame, PrefabId)?.id;
    const widget = typeof typeId === "string" ? catalog.widget(typeId) : undefined;
    if (widget?.container === undefined) {
      return fail("target-not-frame", "target is neither BoardRoot nor a compiled container");
    }

    let depth = 1;
    let current = targetFrame;
    const seen = new Set<Entity>([current]);
    while (true) {
      const parent = world.getRelation(current, ChildOf);
      if (parent === undefined) {
        return fail("malformed-parent", "container ancestry does not terminate at BoardRoot");
      }
      if (root !== undefined && parent === root) break;
      if (seen.has(parent)) return fail("cycle", "container ancestry contains a ChildOf cycle");
      seen.add(parent);
      const parentType = world.get(parent, PrefabId)?.id;
      const parentWidget = typeof parentType === "string" ? catalog.widget(parentType) : undefined;
      if (parentWidget?.container === undefined) {
        return fail("malformed-parent", "container ancestry passes through a non-container parent");
      }
      depth += 1;
      if (depth > maxDepth) return fail("depth-limit", `frame depth exceeds ${maxDepth}`);
      current = parent;
    }
    return { id: widget.container.canvasTypeId, depth };
  };

  const maxContainerHeight = (rootEntity: Entity): number | PlacementDecision => {
    const seen = new Set<Entity>();
    const walk = (entity: Entity, depth: number): number | PlacementDecision => {
      if (seen.has(entity)) return fail("cycle", "container subtree contains a ChildOf cycle");
      seen.add(entity);
      let highest = depth;
      for (const child of world.getReverse(entity, ChildOf)) {
        const type = world.get(child, PrefabId)?.id;
        const widget = typeof type === "string" ? catalog.widget(type) : undefined;
        if (widget?.container === undefined) continue;
        const nested = walk(child, depth + 1);
        if (typeof nested !== "number") return nested;
        highest = Math.max(highest, nested);
      }
      seen.delete(entity);
      return highest;
    };
    return walk(rootEntity, 1);
  };

  const canPlace = (widgetTypeId: string, targetFrame: Entity): PlacementDecision => {
    const widget = catalog.widget(widgetTypeId);
    if (widget === undefined) return fail("unknown-widget", `widget type "${widgetTypeId}" is not compiled`);
    if (opts.packEnabled !== undefined && !opts.packEnabled(widget.prefab.id, widget.version)) {
      return fail("pack-disabled", `document does not enable widget pack "${widget.prefab.id}"@${widget.version}`);
    }
    const frame = frameCanvas(targetFrame);
    if ("ok" in frame) return frame;
    const canvas = catalog.canvasType(frame.id);
    if (canvas === undefined) return fail("unknown-canvas", `CanvasType "${frame.id}" is not compiled`);
    if (
      opts.packEnabled !== undefined &&
      !opts.packEnabled(canvasPackId(canvas.id), canvas.semanticVersion)
    ) {
      return fail(
        "canvas-pack-disabled",
        `document does not enable CanvasType pack "${canvas.id}"@${canvas.semanticVersion}`,
      );
    }
    if (opts.canvasWritable?.(canvas.id) === false) {
      return fail(
        "frame-behavior-unavailable",
        `CanvasType "${canvas.id}" has an unavailable semantic FrameBehavior`,
      );
    }
    if (!catalog.placementFor(canvas.id).has(widgetTypeId)) {
      return fail(
        "widget-not-allowed",
        `CanvasType "${canvas.id}" does not allow widget "${widgetTypeId}"`,
      );
    }
    if (widget.container !== undefined && frame.depth + 1 > maxDepth) {
      return fail("depth-limit", `creating this container would exceed frame depth ${maxDepth}`);
    }
    return { ok: true, canvasTypeId: canvas.id, targetFrame };
  };

  const canIngress = (widgetTypeId: string, targetContainer: Entity): PlacementDecision => {
    const placed = canPlace(widgetTypeId, targetContainer);
    if (!placed.ok) return placed;
    const targetType = world.get(targetContainer, PrefabId)?.id;
    const target = typeof targetType === "string" ? catalog.widget(targetType) : undefined;
    const ingress = target?.container;
    if (ingress === undefined) return fail("target-not-frame", "ingress target is not a compiled container");
    if (ingress.inheritCanvasPlacement) return placed;
    const candidate = catalog.widget(widgetTypeId);
    if (candidate === undefined) return fail("unknown-widget", `widget type "${widgetTypeId}" is not compiled`);
    const allowed =
      ingress.widgetTypeIds.includes(widgetTypeId) ||
      candidate.provides.some((key) => ingress.accepts.includes(key));
    return allowed
      ? placed
      : fail("ingress-rejected", `container "${targetType}" rejects widget "${widgetTypeId}"`);
  };

  const validateReparent = (entity: Entity, targetFrame: Entity): PlacementDecision => {
    if (!world.isAlive(entity)) return fail("target-dead", "reparent source is not live");
    if (entity === targetFrame) return fail("cycle", "an entity cannot parent itself");
    const typeId = world.get(entity, PrefabId)?.id;
    if (typeof typeId !== "string") return fail("unknown-widget", "reparent source has no WidgetType");
    const boardRoot = world.getResource(BoardRoot)?.root;
    const placed = targetFrame === boardRoot ? canPlace(typeId, targetFrame) : canIngress(typeId, targetFrame);
    if (!placed.ok) return placed;

    let ancestor: Entity | undefined = targetFrame;
    const seen = new Set<Entity>();
    for (let hops = 0; ancestor !== undefined && hops <= maxDepth; hops++) {
      if (ancestor === entity) return fail("cycle", "target frame is inside the entity's subtree");
      if (seen.has(ancestor)) return fail("cycle", "target ancestry contains a ChildOf cycle");
      seen.add(ancestor);
      ancestor = world.getRelation(ancestor, ChildOf);
    }

    const widget = catalog.widget(typeId);
    if (widget === undefined) return fail("unknown-widget", `widget type "${typeId}" is not compiled`);
    if (widget.container !== undefined) {
      const target = frameCanvas(targetFrame);
      if ("ok" in target) return target;
      const height = maxContainerHeight(entity);
      if (typeof height !== "number") return height;
      if (target.depth + height > maxDepth) {
        return fail("depth-limit", `reparent would exceed frame depth ${maxDepth}`);
      }
    }
    return placed;
  };

  return {
    canPlace,
    canIngress,
    validateReparent,
    assertPlace(widgetTypeId, targetFrame, operation) {
      const boardRoot = world.getResource(BoardRoot)?.root;
      const decision =
        targetFrame === boardRoot
          ? canPlace(widgetTypeId, targetFrame)
          : canIngress(widgetTypeId, targetFrame);
      if (!decision.ok) throw new Error(`ice: ${operation} — ${decision.message} (${decision.reason}).`);
    },
    assertReparent(entity, targetFrame, operation) {
      const decision = validateReparent(entity, targetFrame);
      if (!decision.ok) throw new Error(`ice: ${operation} — ${decision.message} (${decision.reason}).`);
    },
  };
}
