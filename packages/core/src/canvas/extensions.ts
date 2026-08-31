/**
 * Governed Canvas SDK logic definitions.
 *
 * These handles are immutable declarations. Like WidgetType/Tool/CanvasType,
 * their process registries are authoring-time identity stores only; an
 * EngineCatalog decides which declarations exist in one engine.
 */
import type {
  Component,
  Entity,
  Relation,
  Resource,
  Tag,
} from "@vibecook/strata-ecs";
import type { CanvasSessionValue } from "./session";

export type CanvasReadFacet = Component | Tag | Relation | Resource;

export interface CanvasRuntimeChanges {
  readonly full: boolean;
  readonly changed: readonly Entity[];
  readonly removed: readonly Entity[];
}

export interface CanvasScopedReader {
  readonly frame: Entity;
  readonly children: readonly Entity[];
  read<S>(entity: Entity, component: Component<S>): S;
  get<S>(entity: Entity, component: Component<S>): S | undefined;
  hasTag(entity: Entity, tag: Tag): boolean;
  getRelation(entity: Entity, relation: Relation): Entity | undefined;
  getRelations(entity: Entity, relation: Relation): readonly Entity[];
  getReverse(entity: Entity, relation: Relation): readonly Entity[];
  getResource<S>(resource: Resource<S>): S | undefined;
}

export interface CanvasRuntimeExtensionContext extends CanvasScopedReader {
  readonly session: CanvasSessionValue & { readonly state: "attached" };
  readonly changes: CanvasRuntimeChanges;
  readonly signal: AbortSignal;
  /** Set one declared runtime-only output on the frame owner or a direct child. */
  set<S>(entity: Entity, component: Component<S>, value: S): void;
  /** Remove one declared runtime-only output owned by this extension. */
  remove(entity: Entity, component: Component): void;
}

export interface CanvasRuntimeExtensionDef {
  readonly id: string;
  /** Runtime/cache identity only; never a document requirement. */
  readonly version: number;
  readonly phase?: "derive";
  readonly after?: readonly string[];
  readonly before?: readonly string[];
  readonly reads?: readonly CanvasReadFacet[];
  readonly writesRuntime?: readonly Component[];
  readonly budgetMs?: number;
  run(context: CanvasRuntimeExtensionContext): void;
}

export interface CanvasRuntimeExtension extends CanvasRuntimeExtensionDef {
  readonly __canvasRuntimeExtension: true;
  readonly phase: "derive";
  readonly after: readonly string[];
  readonly before: readonly string[];
  readonly reads: readonly CanvasReadFacet[];
  readonly writesRuntime: readonly Component[];
}

export interface FrameBehaviorWriteContext extends CanvasScopedReader {
  readonly canvasTypeId: string;
  /** Absolute, change-only component write queued into this behavior's transaction. */
  set<S>(entity: Entity, component: Component<S>, value: S): void;
  remove(entity: Entity, component: Component): void;
  setRelation(entity: Entity, relation: Relation, target: Entity): void;
  removeRelation(entity: Entity, relation: Relation, target?: Entity): void;
}

export interface FrameBehaviorDef {
  readonly id: string;
  readonly version: number;
  readonly phase?: "postSettle";
  readonly after?: readonly string[];
  readonly before?: readonly string[];
  readonly reads?: readonly CanvasReadFacet[];
  readonly writesDurable?: readonly Component[];
  readonly writesRelations?: readonly Relation[];
  readonly budget?: { readonly entities?: number; readonly ms?: number };
  run(context: FrameBehaviorWriteContext): void;
}

export interface FrameBehavior extends FrameBehaviorDef {
  readonly __frameBehavior: true;
  readonly phase: "postSettle";
  readonly after: readonly string[];
  readonly before: readonly string[];
  readonly reads: readonly CanvasReadFacet[];
  readonly writesDurable: readonly Component[];
  readonly writesRelations: readonly Relation[];
  readonly budget: { readonly entities: number; readonly ms: number };
}

export type ExistingPlacementPosture = "preserve-and-warn" | "repair";

export interface CanvasSemanticMigrationContext extends CanvasScopedReader {
  readonly canvasTypeId: string;
  readonly from: number;
  readonly to: number;
  set<S>(entity: Entity, component: Component<S>, value: S): void;
  remove(entity: Entity, component: Component): void;
  setRelation(entity: Entity, relation: Relation, target: Entity): void;
  removeRelation(entity: Entity, relation: Relation, target?: Entity): void;
  /** Explicit frame-ownership repair; target must be a live valid frame. */
  reparent(entity: Entity, targetFrame: Entity): void;
}

export interface CanvasSemanticMigration {
  readonly from: number;
  readonly to: number;
  readonly reads?: readonly CanvasReadFacet[];
  readonly writes?: readonly (Component | Relation)[];
  readonly existingPlacement: ExistingPlacementPosture;
  migrate(context: CanvasSemanticMigrationContext): void;
}

function stableId(kind: string, id: string): void {
  if (typeof id !== "string" || id.length === 0 || /\s/.test(id)) {
    throw new Error(`ice: ${kind} id must be a non-empty stable id without whitespace.`);
  }
}

function positiveVersion(kind: string, id: string, version: number): void {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error(`ice: ${kind}("${id}") version must be a positive integer.`);
  }
}

function uniqueStrings(kind: string, id: string, values: readonly string[]): readonly string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    stableId(`${kind}("${id}") dependency`, value);
    if (seen.has(value)) {
      throw new Error(`ice: ${kind}("${id}") repeats dependency "${value}".`);
    }
    seen.add(value);
    out.push(value);
  }
  return Object.freeze(out);
}

function uniqueHandles<T extends object>(kind: string, id: string, values: readonly T[]): readonly T[] {
  const seen = new Set<T>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`ice: ${kind}("${id}") repeats a declared facet.`);
    seen.add(value);
  }
  return Object.freeze([...values]);
}

const runtimeRegistry = new Map<string, CanvasRuntimeExtension>();
const frameRegistry = new Map<string, FrameBehavior>();

export const canvasRuntimeExtensions = {
  get(id: string): CanvasRuntimeExtension | undefined {
    return runtimeRegistry.get(id);
  },
  all(): readonly CanvasRuntimeExtension[] {
    return [...runtimeRegistry.values()];
  },
};

export const frameBehaviors = {
  get(id: string): FrameBehavior | undefined {
    return frameRegistry.get(id);
  },
  all(): readonly FrameBehavior[] {
    return [...frameRegistry.values()];
  },
};

export function defineCanvasRuntimeExtension(
  def: CanvasRuntimeExtensionDef,
): CanvasRuntimeExtension {
  stableId("defineCanvasRuntimeExtension", def.id);
  positiveVersion("defineCanvasRuntimeExtension", def.id, def.version);
  if (runtimeRegistry.has(def.id)) {
    throw new Error(`ice: CanvasRuntimeExtension "${def.id}" is already defined.`);
  }
  if (def.phase !== undefined && def.phase !== "derive") {
    throw new Error(`ice: CanvasRuntimeExtension "${def.id}" only supports phase "derive".`);
  }
  if (def.budgetMs !== undefined && (!Number.isFinite(def.budgetMs) || def.budgetMs <= 0)) {
    throw new Error(`ice: CanvasRuntimeExtension "${def.id}" has an invalid budgetMs.`);
  }
  const extension: CanvasRuntimeExtension = Object.freeze({
    ...def,
    __canvasRuntimeExtension: true as const,
    phase: "derive" as const,
    after: uniqueStrings("defineCanvasRuntimeExtension", def.id, def.after ?? []),
    before: uniqueStrings("defineCanvasRuntimeExtension", def.id, def.before ?? []),
    reads: uniqueHandles("defineCanvasRuntimeExtension", def.id, def.reads ?? []),
    writesRuntime: uniqueHandles(
      "defineCanvasRuntimeExtension",
      def.id,
      def.writesRuntime ?? [],
    ),
  });
  runtimeRegistry.set(extension.id, extension);
  return extension;
}

export function defineFrameBehavior(def: FrameBehaviorDef): FrameBehavior {
  stableId("defineFrameBehavior", def.id);
  positiveVersion("defineFrameBehavior", def.id, def.version);
  if (frameRegistry.has(def.id)) {
    throw new Error(`ice: FrameBehavior "${def.id}" is already defined.`);
  }
  if (def.phase !== undefined && def.phase !== "postSettle") {
    throw new Error(`ice: FrameBehavior "${def.id}" only supports phase "postSettle".`);
  }
  const entities = def.budget?.entities ?? 512;
  const ms = def.budget?.ms ?? 2;
  if (!Number.isSafeInteger(entities) || entities < 1 || entities > 100_000) {
    throw new Error(`ice: FrameBehavior "${def.id}" has an invalid entity budget.`);
  }
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new Error(`ice: FrameBehavior "${def.id}" has an invalid time budget.`);
  }
  const behavior: FrameBehavior = Object.freeze({
    ...def,
    __frameBehavior: true as const,
    phase: "postSettle" as const,
    after: uniqueStrings("defineFrameBehavior", def.id, def.after ?? []),
    before: uniqueStrings("defineFrameBehavior", def.id, def.before ?? []),
    reads: uniqueHandles("defineFrameBehavior", def.id, def.reads ?? []),
    writesDurable: uniqueHandles("defineFrameBehavior", def.id, def.writesDurable ?? []),
    writesRelations: uniqueHandles("defineFrameBehavior", def.id, def.writesRelations ?? []),
    budget: Object.freeze({ entities, ms }),
  });
  frameRegistry.set(behavior.id, behavior);
  return behavior;
}

/** Existing pack-gate namespace reserved for semantic frame behavior code. */
export function frameBehaviorPackId(id: string): string {
  return `@ice/frame-behavior/${id}`;
}
