/**
 * @ice/core — schema+prefabs+sovereignty · phase groups/pipeline · L0–L4 systems ·
 * scene systems · doc kit · publish step · engine facade · reflector registry.
 * Import wall: strata-ecs + @ice/kernel ONLY — never react/dom/three (enforced).
 */
export const CORE_VERSION = "0.0.0";

export { defineSchemaOnce, hmrInvalidateOnSchemaChange } from "./boot/hmr";

// Strata surface re-exported for downstream packages: dom/react/r3f reach
// strata ONLY through core (design-002 §6 — strata is core's sole runtime
// dependency; the import walls make a direct dep a CI failure).
export {
  All,
  Any,
  Not,
  Related,
  createWorld,
  defineQuery,
  defineSystem,
  enumOf,
  field,
} from "@vibecook/strata-ecs";
export type {
  Batch,
  Component,
  Condition,
  Entity,
  Pipeline,
  Query,
  Relation,
  Resource,
  System,
  SystemCtx,
  Tag,
  World,
} from "@vibecook/strata-ecs";

// Schema wrappers (record metadata, delegate to strata) + registries.
export {
  defineComponent,
  defineRelation,
  defineResource,
  defineTag,
  schemaMeta,
  type ComponentMeta,
  type RawSchema,
  type RelationMeta,
  type ResourceMeta,
} from "./schema/meta";

// Prefabs — sovereignty at the entity level (design-001 §2).
// (__resetPrefabsForTests is deliberately NOT re-exported — test-only, import from the module.)
export {
  definePrefab,
  init,
  PrefabId,
  prefabs,
  type ComponentInit,
  type FieldWrite,
  type Prefab,
  type PrefabClass,
  type PrefabDef,
} from "./schema/prefab";

// Spawn routing (the class IS the spawn path).
export { instantiate, type EphSpawner, type SpawnTarget } from "./engine/instantiate";

// The frame contract (design-002): FrameInfo clock, phase-group pipeline,
// reflector registry, and the engine facade that owns step(now).
export { FrameInfo, setFrameInfo } from "./engine/frame-info";
export { createPipelineRegistry, PHASE_GROUPS, type PhaseGroup, type PipelineRegistry } from "./engine/pipeline";
export {
  createReflectorRegistry,
  type ReflectorDef,
  type ReflectorObserve,
  type ReflectorQuerySpec,
  type ReflectorRegistry,
} from "./engine/reflectors";
export {
  createEngine,
  type Engine,
  type EngineOpts,
  type FrameTelemetry,
  type PublishHook,
  type SystemRunRecord,
} from "./engine/engine";

// Write-path guards.
export { devGuardsEnabled, setDevGuards } from "./guards/dev";
export { createLiveWriter, type LiveWriter, type LiveWriterOpts } from "./guards/live-writer";
export { guardedTransaction, type GuardedTx } from "./guards/guarded-tx";
export { writeRuntimeResource } from "./guards/resource-writer";

// The component/tag/relation/resource catalog (design-001 §5, faithful transcription).
export * from "./catalog";

// Engine helpers: PhaseSet + Just* markers (design-003 §4.2), version stamps (design-002 §4).
export * from "./helpers/phase-set";
export * from "./helpers/version-stamps";

// Catalog-adjacent ops (app-handler write paths).
export * from "./ops/selection";
export * from "./ops/cascade";
export * from "./ops/claims";

// Reviewed default constants (citations point at the owning design sections).
export * from "./settings/defaults";
