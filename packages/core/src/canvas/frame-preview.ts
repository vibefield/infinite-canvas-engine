/**
 * Demand-driven, immutable semantic previews for container frames.
 *
 * This store intentionally has no timer and no eager frame index. A frame pays
 * for observers and projection work only while at least one consumer is
 * subscribed. Projection authors receive declared, bounded plain reads rather
 * than a World or document handle.
 */
import {
  Related,
  defineQuery,
  type Component,
  type Entity,
  type Relation,
  type World,
} from "@vibecook/strata-ecs";
import type { DurableStore } from "@vibecook/strata-ecs/durable";
import {
  CameraLimits,
  ChildOf,
  MeasuredSize,
  Position,
  Size,
  Viewport,
} from "../catalog";
import { PrefabId } from "../schema/prefab";
import { schemaMeta } from "../schema/meta";
import type { CanvasDiagnostic } from "./diagnostics";
import type { EngineCatalog } from "./engine-catalog";
import { CanvasSession } from "./session";
import type {
  FrameProjection,
  FrameProjectionChildRef,
  FrameProjectionRelationRow,
} from "./frame-projection";
import {
  resolveFrameChildren,
  resolveFrameView,
  resolvePortal,
  type CanvasRect,
} from "./frame-view";

export const FRAME_PREVIEW_DEFAULT_CHILDREN = 128;
export const FRAME_PREVIEW_DEFAULT_BYTES = 256 * 1024;
export const FRAME_PREVIEW_MAX_CHILDREN = 256;
export const FRAME_PREVIEW_MAX_BYTES = 512 * 1024;
/** Smallest budget that can contain the mandatory immutable preview envelope. */
export const FRAME_PREVIEW_MIN_BYTES = 512;

export type FramePreviewValidity = "valid" | "incompatible" | "malformed-parent";

export interface FramePreviewChild {
  readonly key: string;
  readonly widgetType: string;
  readonly rect: CanvasRect;
  readonly order: number;
  readonly validity: FramePreviewValidity;
  readonly previewModel?: unknown;
}

export interface FramePreviewSnapshot {
  readonly revision: number;
  readonly frameKey: string;
  readonly bounds: CanvasRect;
  readonly resolvedView: { readonly x: number; readonly y: number; readonly zoom: number };
  /** Destination viewport used by the shared arrival-camera solve. */
  readonly viewport: { readonly width: number; readonly height: number };
  readonly portal: CanvasRect;
  readonly totalChildren: number;
  readonly truncated: boolean;
  readonly children: readonly FramePreviewChild[];
  readonly facets: Readonly<Record<string, unknown>>;
}

export interface FramePreviewBudgets {
  readonly children?: number;
  readonly bytes?: number;
}

export interface FramePreviewStats {
  readonly activeFrames: number;
  readonly observers: number;
  readonly rebuilds: number;
  readonly projectionRuns: number;
}

export interface FramePreviewStore {
  /** Pure snapshot read. It never arms observers or performs a projection. */
  snapshot(frame: Entity): FramePreviewSnapshot;
  /** First subscriber activates; the last exact inverse removes every observer. */
  subscribe(frame: Entity, onChange: () => void): () => void;
  /** Re-arm active entries after a document import/reset invalidates reactivity. */
  rebind(): void;
  stats(): FramePreviewStats;
  dispose(): void;
}

export interface FramePreviewStoreOpts {
  readonly world: World;
  readonly catalog: EngineCatalog;
  readonly session: () => {
    readonly documentEpoch: number;
    readonly store?: Pick<DurableStore, "keyOf">;
  };
  readonly diagnostics: () => readonly CanvasDiagnostic[];
  readonly budgets?: FramePreviewBudgets;
  readonly onFault?: (projectionId: string, error: unknown) => void;
}

type Entry = {
  readonly frame: Entity;
  readonly listeners: Set<() => void>;
  snapshot: FramePreviewSnapshot;
  signature: string;
  revision: number;
  unsubs: (() => void)[];
  childUnsubs: (() => void)[];
  effectiveChildren: readonly Entity[];
  observedChildren: readonly Entity[];
  observedShape: string;
  scheduled: boolean;
  projectionFailed: string | undefined;
};

const encoder = new TextEncoder();
const EMPTY_RECT: CanvasRect = Object.freeze({ x: 0, y: 0, width: 0, height: 0 });
const EMPTY_VIEW = Object.freeze({ x: 0, y: 0, zoom: 1 });
const EMPTY_FACETS: Readonly<Record<string, unknown>> = Object.freeze({});
const BASE_COMPONENTS: readonly Component[] = Object.freeze([
  Position,
  Size,
  MeasuredSize,
  PrefabId,
]);
const MAX_OPAQUE_DURABLE_KEY_BYTES = 1024;

function assertLoweredBudget(
  label: string,
  requested: number | undefined,
  fallback: number,
  minimum: number,
  hardMax: number,
): number {
  const value = requested ?? fallback;
  if (!Number.isSafeInteger(value) || value < minimum || value > hardMax) {
    throw new Error(
      `ice: ${label} must be an integer between ${minimum} and ${hardMax}.`,
    );
  }
  return value;
}

function opaqueKey(
  store: Pick<DurableStore, "keyOf"> | undefined,
  documentEpoch: number,
  entity: Entity,
): string {
  const durable = store?.keyOf(entity);
  if (durable === undefined) return `${documentEpoch}:${entity}`;
  const value = String(durable);
  // Keys are presentation-only and never accepted by mutation APIs. Avoid one
  // hostile/legacy durable key consuming the entire bounded snapshot.
  return encoder.encode(value).byteLength <= MAX_OPAQUE_DURABLE_KEY_BYTES
    ? value
    : `${documentEpoch}:${entity}`;
}

function emptySnapshot(frameKey: string): FramePreviewSnapshot {
  return Object.freeze({
    revision: 0,
    frameKey,
    bounds: EMPTY_RECT,
    resolvedView: EMPTY_VIEW,
    viewport: Object.freeze({ width: 0, height: 0 }),
    portal: EMPTY_RECT,
    totalChildren: 0,
    truncated: false,
    children: Object.freeze([]),
    facets: EMPTY_FACETS,
  });
}

/** Strict plain-data clone. Sorting keys makes its JSON encoding canonical. */
function plain(value: unknown, seen = new Set<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("projection output contains a non-finite number");
    return value;
  }
  if (typeof value !== "object") {
    throw new Error(`projection output contains non-JSON value ${typeof value}`);
  }
  if (seen.has(value)) throw new Error("projection output contains a cycle");
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null && !Array.isArray(value)) {
    throw new Error("projection output contains a non-plain object");
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return Object.freeze(value.map((item) => plain(item, seen)));
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = plain((value as Record<string, unknown>)[key], seen);
    }
    return Object.freeze(out);
  } finally {
    seen.delete(value);
  }
}

function canonical(value: unknown): string {
  return JSON.stringify(value);
}

function bytes(value: unknown): number {
  return encoder.encode(canonical(value)).byteLength;
}

function parseJsonCell(value: unknown, fallback: string | undefined): unknown {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    try {
      return JSON.parse(fallback ?? "null");
    } catch {
      return null;
    }
  }
}

function uniqueComponents(projection: FrameProjection | undefined): readonly Component[] {
  const out: Component[] = [];
  const seen = new Set<Component>();
  for (const component of [...BASE_COMPONENTS, ...(projection?.reads ?? [])]) {
    if (seen.has(component)) continue;
    seen.add(component);
    out.push(component);
  }
  return out;
}

function validityFor(
  entity: Entity,
  diagnostics: readonly CanvasDiagnostic[],
): FramePreviewValidity {
  let validity: FramePreviewValidity = "valid";
  for (const diagnostic of diagnostics) {
    if (diagnostic.entity !== entity) continue;
    if (
      diagnostic.code === "malformed-parent" ||
      diagnostic.code === "child-of-cycle" ||
      diagnostic.code === "depth-limit"
    ) {
      return "malformed-parent";
    }
    if (diagnostic.code === "incompatible-placement" || diagnostic.code === "unknown-widget") {
      validity = "incompatible";
    }
  }
  return validity;
}

export function createFramePreviewStore(opts: FramePreviewStoreOpts): FramePreviewStore {
  const { world, catalog } = opts;
  const childBudget = assertLoweredBudget(
    "frame preview child budget",
    opts.budgets?.children,
    FRAME_PREVIEW_DEFAULT_CHILDREN,
    1,
    FRAME_PREVIEW_MAX_CHILDREN,
  );
  const byteBudget = assertLoweredBudget(
    "frame preview byte budget",
    opts.budgets?.bytes,
    FRAME_PREVIEW_DEFAULT_BYTES,
    FRAME_PREVIEW_MIN_BYTES,
    FRAME_PREVIEW_MAX_BYTES,
  );
  const entries = new Map<Entity, Entry>();
  let disposed = false;
  let observerCount = 0;
  let rebuildCount = 0;
  let projectionRuns = 0;

  const reportProjectionFault = (id: string, error: unknown): void => {
    try {
      opts.onFault?.(id, error);
    } catch {
      // Reporting is never allowed to break silhouettes or later listeners.
    }
  };

  const identify = (entity: Entity): string => {
    const current = opts.session();
    return opaqueKey(current.store, current.documentEpoch, entity);
  };

  const definition = (frame: Entity) => {
    const typeId = world.get(frame, PrefabId)?.id;
    if (typeof typeId !== "string") return {};
    const widget = catalog.widget(typeId);
    const binding = widget?.container;
    if (binding === undefined) return {};
    return {
      typeId,
      binding,
      canvas: catalog.canvasForContainer(typeId),
      projection: catalog.frameProjectionForContainer(typeId),
    };
  };

  const isContainer = (entity: Entity): boolean => {
    const typeId = world.get(entity, PrefabId)?.id;
    return typeof typeId === "string" && catalog.widget(typeId)?.container !== undefined;
  };

  const previewModelFor = (entity: Entity, widgetTypeId: string): unknown => {
    const widget = catalog.widget(widgetTypeId);
    if (widget === undefined || widget.instancePreviewProps.length === 0) return undefined;
    const model: Record<string, unknown> = {};
    for (const name of widget.instancePreviewProps) {
      const groupName = widget.propToGroup[name];
      const group = widget.groups.find((candidate) => candidate.name === groupName);
      const spec = group?.fields[name];
      if (group === undefined || spec === undefined) continue;
      const value = (world.get(entity, group.component) as Record<string, unknown> | undefined)?.[
        name
      ];
      if (value !== undefined) {
        model[name] = spec.kind === "json" ? parseJsonCell(value, spec.default) : value;
      }
    }
    return plain(model);
  };

  const relationRows = (
    frame: Entity,
    frameKey: string,
    children: readonly Entity[],
    keys: ReadonlyMap<Entity, string>,
    relation: Relation,
  ): readonly FrameProjectionRelationRow[] => {
    const scope = new Set<Entity>([frame, ...children]);
    const meta = schemaMeta.relation(relation);
    if (meta === undefined) return Object.freeze([]);
    const rows: FrameProjectionRelationRow[] = [];
    const key = (entity: Entity) => (entity === frame ? frameKey : keys.get(entity));
    for (const source of scope) {
      const targets =
        meta.arity === "one"
          ? (() => {
              const target = world.getRelation(source, relation);
              return target === undefined ? [] : [target];
            })()
          : world.getRelations(source, relation);
      for (const target of targets) {
        if (!scope.has(target)) continue;
        const sourceKey = key(source);
        const targetKey = key(target);
        if (sourceKey !== undefined && targetKey !== undefined) {
          rows.push(Object.freeze({ source: sourceKey, target: targetKey }));
        }
      }
    }
    rows.sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target));
    return Object.freeze(rows);
  };

  const runProjection = (
    entry: Entry,
    projection: FrameProjection | undefined,
    frameKey: string,
    children: readonly Entity[],
    refs: readonly FrameProjectionChildRef[],
    keys: ReadonlyMap<Entity, string>,
  ): Readonly<Record<string, unknown>> => {
    if (projection === undefined || entry.projectionFailed === projection.id) return EMPTY_FACETS;
    const declared = new Set(projection.reads);
    const byKey = new Map<string, Entity>();
    for (const child of children) {
      const key = keys.get(child);
      if (key !== undefined) byKey.set(key, child);
    }
    const relations = new Map(
      projection.relations.map((relation) => [
        relation,
        relationRows(entry.frame, frameKey, children, keys, relation),
      ]),
    );
    try {
      projectionRuns += 1;
      const projected = projection.project({
        frameKey,
        children: refs,
        get(childKey, component) {
          if (!declared.has(component)) {
            throw new Error(`FrameProjection "${projection.id}" read an undeclared component.`);
          }
          const entity = byKey.get(childKey);
          return entity === undefined ? undefined : world.get(entity, component);
        },
        relations(relation) {
          const rows = relations.get(relation);
          if (rows === undefined) {
            throw new Error(`FrameProjection "${projection.id}" read an undeclared relation.`);
          }
          return rows;
        },
      });
      const normalized = plain(projected);
      if (
        normalized === null ||
        Array.isArray(normalized) ||
        typeof normalized !== "object"
      ) {
        throw new Error("projection output must be a plain facets record");
      }
      if (bytes(normalized) > byteBudget) {
        throw new Error(`projection output exceeds the ${byteBudget}-byte portal budget`);
      }
      return normalized as Readonly<Record<string, unknown>>;
    } catch (error) {
      entry.projectionFailed = projection.id;
      reportProjectionFault(projection.id, error);
      return EMPTY_FACETS;
    }
  };

  const build = (entry: Entry): void => {
    if (disposed || entry.listeners.size === 0) return;
    rebuildCount += 1;
    const current = opts.session();
    const frameKey = opaqueKey(current.store, current.documentEpoch, entry.frame);
    const def = definition(entry.frame);
    const allChildren = entry.effectiveChildren;
    const scoped = allChildren.slice(0, childBudget);
    const keys = new Map<Entity, string>();
    const refs: FrameProjectionChildRef[] = [];
    const diagnostics = opts.diagnostics();
    const children: FramePreviewChild[] = [];
    for (let order = 0; order < scoped.length; order += 1) {
      const entity = scoped[order] as Entity;
      const widgetType = world.get(entity, PrefabId)?.id;
      if (typeof widgetType !== "string") continue;
      const key = opaqueKey(current.store, current.documentEpoch, entity);
      keys.set(entity, key);
      refs.push(Object.freeze({ key, widgetType, order }));
      const position = world.get(entity, Position) ?? { x: 0, y: 0 };
      const measured = world.get(entity, MeasuredSize);
      const size =
        measured !== undefined && measured.w > 0 && measured.h > 0
          ? measured
          : world.get(entity, Size) ?? { w: 0, h: 0 };
      const previewModel = previewModelFor(entity, widgetType);
      children.push(
        Object.freeze({
          key,
          widgetType,
          rect: Object.freeze({ x: position.x, y: position.y, width: size.w, height: size.h }),
          order,
          validity: validityFor(entity, diagnostics),
          ...(previewModel === undefined ? {} : { previewModel }),
        }),
      );
    }
    let facets = runProjection(
      entry,
      def.projection,
      frameKey,
      scoped,
      Object.freeze(refs),
      keys,
    );
    const view = resolveFrameView(world, entry.frame, def.canvas, { isContainer });
    const portal = resolvePortal(world, entry.frame, def.binding)?.local ?? EMPTY_RECT;
    const viewportResource = world.getResource(Viewport);
    const viewport = Object.freeze({
      width: viewportResource?.w ?? 0,
      height: viewportResource?.h ?? 0,
    });

    const fixedRecord = (value: Readonly<Record<string, unknown>>) => ({
      revision: entry.revision + 1,
      frameKey,
      bounds: view.bounds,
      resolvedView: view.camera,
      viewport,
      portal,
      totalChildren: allChildren.length,
      truncated: allChildren.length > children.length,
      children: [] as readonly FramePreviewChild[],
      facets: value,
    });
    let fixed = fixedRecord(facets);
    let used = bytes(fixed);
    if (used > byteBudget && facets !== EMPTY_FACETS && def.projection !== undefined) {
      const error = new Error(
        `projection output plus fixed record exceeds the ${byteBudget}-byte portal budget`,
      );
      entry.projectionFailed = def.projection.id;
      reportProjectionFault(def.projection.id, error);
      facets = EMPTY_FACETS;
      fixed = fixedRecord(facets);
      used = bytes(fixed);
    }
    const admitted: FramePreviewChild[] = [];
    for (const child of children) {
      const cost = bytes(child) + (admitted.length === 0 ? 0 : 1);
      if (used + cost > byteBudget) break;
      admitted.push(child);
      used += cost;
    }
    const value = {
      frameKey,
      bounds: Object.freeze({ ...view.bounds }),
      resolvedView: Object.freeze({ ...view.camera }),
      viewport,
      portal: Object.freeze({ ...portal }),
      totalChildren: allChildren.length,
      truncated: allChildren.length > admitted.length,
      children: Object.freeze(admitted),
      facets,
    };
    const signature = canonical(value);
    if (signature === entry.signature) return;
    entry.signature = signature;
    entry.revision += 1;
    entry.snapshot = Object.freeze({ revision: entry.revision, ...value });
    for (const listener of [...entry.listeners]) {
      try {
        listener();
      } catch {
        // One UI subscriber cannot block another or poison the projection job.
      }
    }
  };

  const schedule = (entry: Entry): void => {
    if (disposed || entry.listeners.size === 0 || entry.scheduled) return;
    entry.scheduled = true;
    queueMicrotask(() => {
      entry.scheduled = false;
      if (disposed || entry.listeners.size === 0) return;
      rewireChildren(entry);
      build(entry);
    });
  };

  const observe = (entry: Entry, subscribe: () => () => void): void => {
    entry.unsubs.push(subscribe());
    observerCount += 1;
  };

  const clearChildObservers = (entry: Entry): void => {
    for (const unsub of entry.childUnsubs.splice(0)) {
      unsub();
      observerCount -= 1;
    }
  };

  const rewireChildren = (entry: Entry): void => {
    if (!world.isAlive(entry.frame)) {
      if (entry.observedChildren.length > 0) {
        clearChildObservers(entry);
        entry.observedChildren = Object.freeze([]);
      }
      entry.effectiveChildren = Object.freeze([]);
      entry.observedShape = "";
      return;
    }
    const def = definition(entry.frame);
    const effective = resolveFrameChildren(world, entry.frame, { isContainer }).filter(
      (entity) => world.get(entity, PrefabId) !== undefined,
    );
    entry.effectiveChildren = effective;
    const next = effective.slice(0, childBudget);
    const shape = `${def.projection?.id ?? ""}@${def.projection?.version ?? 0}|${next
      .map((entity) => world.get(entity, PrefabId)?.id ?? "")
      .join("\u0000")}`;
    if (
      shape === entry.observedShape &&
      next.length === entry.observedChildren.length &&
      next.every((entity, index) => entity === entry.observedChildren[index])
    ) {
      return;
    }
    clearChildObservers(entry);
    entry.observedChildren = Object.freeze(next);
    entry.observedShape = shape;
    for (const entity of next) {
      const components = [...uniqueComponents(def.projection)];
      const seen = new Set(components);
      const widgetTypeId = world.get(entity, PrefabId)?.id;
      const widget =
        typeof widgetTypeId === "string" ? catalog.widget(widgetTypeId) : undefined;
      for (const name of widget?.instancePreviewProps ?? []) {
        const groupName = widget?.propToGroup[name];
        const group = widget?.groups.find((candidate) => candidate.name === groupName);
        if (group !== undefined && !seen.has(group.component)) {
          seen.add(group.component);
          components.push(group.component);
        }
      }
      for (const component of components) {
        entry.childUnsubs.push(world.reactive.observeValue(entity, component, () => schedule(entry)));
        observerCount += 1;
      }
      if (!isContainer(entity)) {
        const membership = defineQuery([PrefabId, Related(ChildOf, entity)]);
        entry.childUnsubs.push(
          world.reactive.observeQuery(membership, () => schedule(entry), { cols: [] }),
        );
        observerCount += 1;
      }
    }
  };

  const deactivate = (entry: Entry): void => {
    clearChildObservers(entry);
    for (const unsub of entry.unsubs.splice(0)) {
      unsub();
      observerCount -= 1;
    }
    entry.observedChildren = Object.freeze([]);
    entry.effectiveChildren = Object.freeze([]);
    entry.observedShape = "";
    entry.scheduled = false;
  };

  const activate = (entry: Entry): void => {
    const def = definition(entry.frame);
    entry.projectionFailed = undefined;
    // Arm the order stamp before the initial pull, matching sibling-order's
    // membership/reorder contract.
    if (world.isAlive(entry.frame)) world.orderStamp(entry.frame, ChildOf);
    const membership = defineQuery([PrefabId, Related(ChildOf, entry.frame)]);
    observe(entry, () => world.reactive.observeQuery(membership, () => schedule(entry), { cols: [] }));
    for (const relation of def.projection?.relations ?? []) {
      const relationWake = defineQuery([Related(relation)]);
      observe(entry, () =>
        world.reactive.observeQuery(relationWake, () => schedule(entry), { cols: [] }),
      );
    }
    observe(entry, () => world.reactive.observeValue(entry.frame, Position, () => schedule(entry)));
    observe(entry, () => world.reactive.observeValue(entry.frame, Size, () => schedule(entry)));
    observe(entry, () =>
      world.reactive.observeValue(entry.frame, MeasuredSize, () => schedule(entry)),
    );
    observe(entry, () => world.reactive.observeValue(entry.frame, PrefabId, () => schedule(entry)));
    observe(entry, () => world.reactive.observeResource(Viewport, () => schedule(entry)));
    observe(entry, () => world.reactive.observeResource(CameraLimits, () => schedule(entry)));
    observe(entry, () => world.reactive.observeResource(CanvasSession, () => schedule(entry)));
    rewireChildren(entry);
    build(entry);
  };

  const getEntry = (frame: Entity): Entry => {
    const existing = entries.get(frame);
    if (existing !== undefined) return existing;
    const entry: Entry = {
      frame,
      listeners: new Set(),
      snapshot: emptySnapshot(identify(frame)),
      signature: "",
      revision: 0,
      unsubs: [],
      childUnsubs: [],
      effectiveChildren: Object.freeze([]),
      observedChildren: Object.freeze([]),
      observedShape: "",
      scheduled: false,
      projectionFailed: undefined,
    };
    entries.set(frame, entry);
    return entry;
  };

  return {
    snapshot(frame) {
      return getEntry(frame).snapshot;
    },
    subscribe(frame, onChange) {
      if (disposed) return () => {};
      const entry = getEntry(frame);
      const wasInactive = entry.listeners.size === 0;
      // A unique wrapper preserves subscription multiplicity even when two
      // consumers happen to pass the same callback identity.
      const listener = () => onChange();
      entry.listeners.add(listener);
      if (wasInactive) activate(entry);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        entry.listeners.delete(listener);
        if (entry.listeners.size === 0) deactivate(entry);
      };
    },
    rebind() {
      if (disposed) return;
      for (const entry of entries.values()) {
        if (entry.listeners.size === 0) continue;
        deactivate(entry);
        activate(entry);
      }
    },
    stats: () => ({
      activeFrames: [...entries.values()].filter((entry) => entry.listeners.size > 0).length,
      observers: observerCount,
      rebuilds: rebuildCount,
      projectionRuns,
    }),
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const entry of entries.values()) deactivate(entry);
      entries.clear();
    },
  };
}
