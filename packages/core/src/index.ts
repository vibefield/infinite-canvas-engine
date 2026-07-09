/**
 * @ice/core — schema+prefabs+sovereignty · phase groups/pipeline · L0–L4 systems ·
 * scene systems · doc kit · publish step · engine facade · reflector registry.
 * Import wall: strata-ecs + @ice/kernel ONLY — never react/dom/three (enforced).
 */
export const CORE_VERSION = "0.0.0";

export { defineSchemaOnce, hmrInvalidateOnSchemaChange } from "./boot/hmr";

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
