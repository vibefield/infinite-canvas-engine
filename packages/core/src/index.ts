/**
 * @ice/core — schema+prefabs+sovereignty · phase groups/pipeline · L0–L4 systems ·
 * scene systems · doc kit · publish step · engine facade · reflector registry.
 * Import wall: strata-ecs + @ice/kernel ONLY — never react/dom/three (enforced).
 */
// Informational only; must track packages/ice/package.json version on publish.
export const CORE_VERSION = "0.5.0";

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
  defineTickSystem,
  enumOf,
  field,
  // Query-only for apps (`Not(Local)` = remote presence peers); strata-owned,
  // auto-applied by the ephemeral store on spawn, never transmitted.
  Local,
} from "@vibecook/strata-ecs";
export type {
  Batch,
  Component,
  Condition,
  Entity,
  OrderPlace,
  Pipeline,
  Query,
  Relation,
  Resource,
  System,
  SystemCtx,
  Tag,
  TickSystem,
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
export { createPipelineRegistry, PHASE_GROUPS, type AnySystem, type PhaseGroup, type PipelineRegistry } from "./engine/pipeline";
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
export { createFrameControl, SETTLE_CAP, type FrameControl } from "./engine/frame-control";
// The guest runtime (petition I14): the named frame slot for work the engine
// did not write, under a circuit breaker. The behavior framework compiles onto
// it (design-009); hosts reach it as `engine.guests`.
export {
  createGuestRegistry,
  GUEST_BUDGET,
  type GuestFactory,
  type GuestFrame,
  type GuestGeneration,
  type GuestInstance,
  type GuestLedgerRecord,
  type GuestRegistry,
  type GuestRegistryOpts,
  type GuestRun,
  type GuestSpec,
  type GuestStatus,
} from "./engine/guests";

// --- The behavior framework (design-009): ICE's SECOND product surface -------
// `defineWidget` (faces) · `defineBehavior` (logic + state) · `defineTool`
// (input policy). `store:` routes everything — where data lives, who sees it,
// what survives, which write vocabulary the hooks receive, at which cadence.
export { behaviors, defineBehavior } from "./behavior/define-behavior";
export {
  BEHAVIOR_DEFAULT_PHASE,
  BEHAVIOR_PHASES,
  type AnyBehaviorAttachSpec,
  type AnyBehaviorDef,
  type BehaviorAttachSpec,
  type BehaviorChanges,
  type BehaviorCtxBase,
  type BehaviorCtxFor,
  type BehaviorFrame,
  type BehaviorHandle,
  type BehaviorHooks,
  type BehaviorPhase,
  type BehaviorQuery,
  type BehaviorQuerySpec,
  type BehaviorRead,
  type BehaviorSchema,
  type BehaviorSpec,
  type BehaviorStore,
  type BehaviorTx,
  type BehaviorWorld,
  type DataOf,
  type DurableBehaviorCtx,
  type EphemeralBehaviorCtx,
  type PeerFacet,
  type RuntimeBehaviorCtx,
} from "./behavior/types";
export { compileBehavior, isDurableEligible, type CompiledBehavior } from "./behavior/compile";

// Write-path guards.
export { devGuardsEnabled, setDevGuards } from "./guards/dev";
export { createLiveWriter, type LiveWriter, type LiveWriterOpts } from "./guards/live-writer";
export { guardedTransaction, type GuardedTx, type GuardedTxOpts } from "./guards/guarded-tx";
export { writeRuntimeResource } from "./guards/resource-writer";

// The component/tag/relation/resource catalog (design-001 §5, faithful transcription).
export * from "./catalog";

// Engine helpers: PhaseSet + Just* markers (design-003 §4.2), version stamps (design-002 §4).
export * from "./helpers/phase-set";
export * from "./helpers/version-stamps";
// The drain-in-runIf idiom (petition I15): a change-collector gate that stashes
// its delta for the body, so a skipped system stamps NOTHING (design-002 §4's
// guard rule). Engine-internal since M6; exported because every derived
// consumer outside core — plugin systems, and the behavior framework's own
// delivery loop — needs exactly this and would otherwise hand-roll it.
export * from "./helpers/churn-guard";
// Catalog-adjacent ops (app-handler write paths).
export * from "./ops/arrange";
export * from "./ops/selection";
export * from "./ops/cascade";
export * from "./ops/claims";
export * from "./ops/gestures";
export * from "./ops/point-pick";
// Sibling order (petition 8): THE per-frame stacking source — frame parent,
// pull-based ordinal cache, and the one comparator paint/pick/drop share.
export * from "./ops/sibling-order";
// Port-schema → kernel PortSlot resolution (2026-07-16: exported for the
// @ice/ground wires pass — rendered and picked anchors agree by construction;
// retires the wires reflector's local-resolver TODO).
export { portSlots, portSlotOf } from "./ops/port-geometry";

// The interaction stack (design-003): input queue, commit seam, install.
export { createInputQueue, NO_MODS, type InputEvent, type InputEventKind, type InputMods, type InputQueue } from "./input/queue";
export {
  createRecordingCommitSink,
  type CommitIntent,
  type CommitCreate,
  type CommitOrder,
  type CommitReparent,
  type CommitSink,
  type CommitWrite,
} from "./engine/commit-sink";
export {
  ensureCanvasSurface,
  installInteractionCore,
  installInteractionStack,
  type InteractionCore,
  type InteractionCoreOpts,
  type InteractionStack,
} from "./interaction/install";
export { anyGestureNonTerminal, isMidGesture } from "./interaction/gesture-status";
export type { MarqueeBuffer } from "./systems/l3-marquee";
export { DEFAULT_SPAWN_PROFILES, type SingleKindName, type SpawnProfiles } from "./systems/l2-recognize";
export { createCursorSync } from "./systems/l4-cursor";
// M8 node-editor core (design-004 §6, design-003 §5.8): wire sync, port
// materialization, connect gesture + its out-of-ECS preview buffer.
export { createWireSync, type WireSyncSystem } from "./systems/l1-wires";
export { createPortMaterialize } from "./systems/l3-ports";
export {
  createConnectSystems,
  type ConnectSystems,
  type WirePreviewBuffer,
} from "./systems/l3-connect";

// The doc kit (design-001 §6, design-005 §6): envelope, version gate, sessions.
export {
  ENGINE_SCHEMA_VERSION,
  ENVELOPE_MAGIC,
  ENVELOPE_VERSION,
  EnvelopeError,
  decodeEnvelope,
  encodeEnvelope,
  type EnvelopeHeader,
} from "./doc/envelope";
export {
  gateVerdict,
  readDocVersionReport,
  stampEngineMeta,
  type DocVersionReport,
  type GateVerdict,
} from "./doc/version-gate";
export { createDocCommitSink, createReadOnlyCommitSink } from "./doc/doc-commit-sink";
// Durable undo/redo availability resource (strata plan-undo U2) — re-exported
// so react's useUndoStatus takes the typed observeResource path (the import
// wall forbids react reaching @vibecook/strata-ecs/durable directly).
export { DurableUndoStatus } from "@vibecook/strata-ecs/durable";
export type { DurableUndoStatusValue } from "@vibecook/strata-ecs/durable";
export {
  createDocSession,
  openDocSession,
  type DocSession,
  type DocSessionOpts,
  type OpenDocResult,
} from "./doc/doc-kit";
export { runMigrations, type MigrationCtx, type MigrationOutcome } from "./doc/migrate";

// The widget runtime core (design-005 §2 + design-004 §2): props DSL,
// defineWidget compiler, equip, spawn, cull/LRU/mount store.
export { p, type JsonShape, type PropSpec, type PropsDecl, type StandardSchemaV1 } from "./widget/props";
export {
  WidgetEquipped,
  defineWidget,
  renames,
  widgets,
  type SizeMode,
  type WidgetDef,
  type WidgetGroup,
  type WidgetInteraction,
  type WidgetPortDecl,
  type WidgetBehaviorDecl,
  type WidgetBehaviorEntry,
  type WidgetRename,
  type WidgetRenameEntry,
  type WidgetSurface,
  type WidgetType,
} from "./widget/define-widget";
export { createWidgetEquipSystem } from "./widget/equip";
export { attachSpawnBehaviors, attachSpawnParent, spawnWidget, widgetSpawnInits, type SpawnWidgetOpts } from "./widget/spawn";
export { setWidgetProps } from "./widget/set-props";
export {
  createWidgetRuntime,
  installWidgetRuntime,
  type MountEntry,
  type WidgetMountStore,
  type WidgetRuntime,
} from "./widget/mount-store";

// Reviewed default constants (citations point at the owning design sections).
export * from "./settings/defaults";
// Ground-layer (P0) pass configs — plain data shared by @ice/ground, the react
// facade, and apps (2026-07-16 extraction; neither may import the other).
export * from "./settings/ground-config";

// --- M4 camera slice (design-003 §5 item 9 + simulate tail) ---
// Sole exception to the no-barrel-edit rule: the camera-sim factory + its
// runtime resource, exported so the DOM demo and integration can wire them.
export { CameraInertia, createCameraSystems, type CameraSystems } from "./systems/camera-sim";

// --- M5 app-facing doc kit slice (design-005 §6.5–6.6): autosave + dumb relay ---
export {
  restoreAutosave,
  startAutosave,
  type Autosave,
  type AutosaveOpts,
  type AutosaveState,
  type AutosaveStatus,
  type AutosaveStorageRead,
  type AutosaveStorageWrite,
  type CancelScheduled,
  type RestoreResult,
} from "./doc/autosave";
export {
  attachBroadcastRelay,
  type BroadcastRelay,
  type BroadcastRelayOpts,
  type RelayChannel,
} from "./doc/broadcast-relay";

// --- M6 measurement + chrome + breakpoints (design-004 §2 measure, §5 chrome, §8 LOD) ---
export { createMeasureQueue, type MeasureEvent, type MeasureQueue } from "./input/measure-queue";
export { createMeasureIngest } from "./systems/measure-ingest";
export { createBreakpointSystem, createSelectionChromeSystem } from "./systems/chrome";

// --- M8 nested canvas (design-004 §7): membership, nav ops, integrity ---
export {
  createActiveMembership,
  createNestedCanvas,
  currentNavEntry,
  currentNavFrame,
  type NavOpts,
  type NestedCanvas,
  type NestedCanvasOpts,
} from "./nav/nested-canvas";
// design-006 T1: the flight resource (T2's reflector consumes it) + system factory.
export {
  abortNavFlight,
  createNavFlight,
  navFlightActive,
  NavTransition,
  startNavFlight,
} from "./systems/nav-flight";

// --- M9 presence layer (design-005 §6.5, design-001 §5.6) ---
export {
  attachPresence,
  createPresencePublish,
  createRemoteCursorsSystem,
  DEFAULT_PRESENCE_TTL_MS,
  installPresence,
  type InstallPresenceOpts,
  type PresenceOpts,
  type PresencePublishOpts,
  type PresenceSession,
} from "./presence";

// --- M9 transport/bootstrap kit (design-005 §6.5): join protocol + byte channels ---
export {
  joinDoc,
  offerBase,
  type BootstrapClock,
  type JoinDocOpts,
  type JoinResult,
} from "./doc/bootstrap";
export {
  broadcastChannelByteChannel,
  webSocketByteChannel,
  type ByteChannel,
  type OwnedByteChannel,
  type WebSocketLike,
} from "./doc/channels";

// --- M10 published facade (design-005 §3-§4): tools + createCanvasEngine ---
export {
  createDrawTool,
  defineTool,
  tools,
  type CanvasDragRoute,
  type Tool,
  type ToolDef,
  type ToolGates,
  type ToolRoute,
  type WidgetDragRoute,
} from "./tools/define-tool";
export {
  createCanvasEngine,
  type CanvasDocs,
  type CanvasEngine,
  type CanvasEngineOpts,
  type StageControl,
  type CanvasOps,
} from "./facade/create-canvas-engine";
export { createDrawBehavior } from "./systems/l3-draw";
