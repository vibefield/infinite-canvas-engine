/** Declared, bounded custom facets for semantic container previews. */
import type { Component, Relation } from "@vibecook/strata-ecs";

export interface FrameProjectionChildRef {
  readonly key: string;
  readonly widgetType: string;
  readonly order: number;
}

export interface FrameProjectionRelationRow {
  readonly source: string;
  readonly target: string;
}

export interface FrameProjectionContext {
  readonly frameKey: string;
  readonly children: readonly FrameProjectionChildRef[];
  get<S>(childKey: string, component: Component<S>): S | undefined;
  relations(relation: Relation): readonly FrameProjectionRelationRow[];
}

export interface FrameProjectionDef {
  readonly id: string;
  readonly version?: number;
  readonly reads?: readonly Component[];
  readonly relations?: readonly Relation[];
  project(context: FrameProjectionContext): unknown;
}

export interface FrameProjection extends FrameProjectionDef {
  readonly __frameProjection: true;
  readonly version: number;
  readonly reads: readonly Component[];
  readonly relations: readonly Relation[];
}

export interface CanvasPreviewDeclaration {
  readonly projection?: FrameProjection;
  /** Opaque framework renderer; core only compiles precedence/identity. */
  readonly renderer?: unknown;
  /** Cheap type-level CSS/SVG/atlas token consumed by adapters. */
  readonly background?: unknown;
}

const registry = new Map<string, FrameProjection>();

export const frameProjections = {
  get(id: string): FrameProjection | undefined {
    return registry.get(id);
  },
  all(): readonly FrameProjection[] {
    return [...registry.values()];
  },
};

export function defineFrameProjection(def: FrameProjectionDef): FrameProjection {
  if (typeof def.id !== "string" || def.id.length === 0 || /\s/.test(def.id)) {
    throw new Error("ice: defineFrameProjection — id must be a non-empty stable id without whitespace.");
  }
  const version = def.version ?? 1;
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error(`ice: defineFrameProjection("${def.id}") version must be a positive integer.`);
  }
  if (registry.has(def.id)) {
    throw new Error(`ice: FrameProjection "${def.id}" is already defined.`);
  }
  const reads = [...(def.reads ?? [])];
  const relations = [...(def.relations ?? [])];
  if (new Set(reads).size !== reads.length || new Set(relations).size !== relations.length) {
    throw new Error(`ice: defineFrameProjection("${def.id}") repeats a declared facet.`);
  }
  const projection: FrameProjection = Object.freeze({
    ...def,
    __frameProjection: true as const,
    version,
    reads: Object.freeze(reads),
    relations: Object.freeze(relations),
  });
  registry.set(projection.id, projection);
  return projection;
}
