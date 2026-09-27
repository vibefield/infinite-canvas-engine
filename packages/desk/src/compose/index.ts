// `@ice/desk/compose` — the desk FROM THE WORLD, the DOM-free half (design-015 §4.4–§4.6;
// D2a-world): the builder (the frame's objects as records, the flux, the ghosts), the pick source
// over the kinds' mirrors, the ambient policy (the wind that idles), the reflector that draws
// only on pulled dirt, and the submit instrument that proves it. The host half — the canvas, the
// device, the layer factory a React or vanilla host mounts — is src/host/ (`deskLayer`, in `@ice/desk`'s root barrel).
export { AMBIENT_DEFAULTS, type Ambient, type AmbientMode, type AmbientOptions, type AmbientPhase, type AmbientPin, type AmbientState, createAmbient } from "./ambient";
export { type BuildViewport, type BuildWork, type BuiltDesk, createDeskBuilder, type DeskBuilder, type DeskBuilderOptions, type DeskBuilderStats, type DeskWakeReason, type HeldBuild, type HoldPin } from "./builder";
export { createMarksCollector, type MarkRow, type MarksCollector, type MenuSlot, menuSlots, type SelectionAnchor, withKindActs } from "./marks";
export { createPickSource } from "./pick";
export { tapHit } from "./tap";
export { createDeskReflector, type DeskReflector, type DeskReflectorOptions, type DeskReflectorStats, type DeskWakes } from "./reflector";
export { instrumentSubmits, type SubmitHook, type SubmitInstrument, tapSubmits, type UploadTally } from "../submit-instrument";
export { type Ablation, ablateKinds, type KindCost, type KindCostOptions, type KindCostReport, kindsIn, type Sampled, withoutKind } from "../gpu-ablation";
export { createGpuProfiler, type GpuFrameCounts, type GpuFrameReport, type GpuProfileStats, type GpuProfiler, type GpuProfilerOptions, type Rolling, rolling, busyOf, spanOf, type TraceEvent, type TraceJson, traceOf } from "../gpu-profiler";
export { instrumentPasses, type KindDraws, type PassCounts, type PassFrame, type PassInstrument, type PassInstrumentOptions, type PassTime, type PassTiming, readTimestamps, TIMESTAMP_QUANTUM_NS, UNQUANTISED_TIMESTAMPS_FLAG } from "../pass-instrument";
export { type FormatBlock, formatBlock, type GpuMemory, type GpuMemoryRow, instrumentMemory, type MemoryLedger, regionBytes, textureBytes } from "../gpu-memory";
export { type BudgetStats, createRasterBudget, type RasterBudget } from "../engine/budget";
export { createRasterQueue, RASTER_BUDGET_MS, rasterPriority, type RasterQueue, type RasterQueueOptions, type RasterQueueStats, type RasterRun, type RasterWait } from "../engine/rasters";
export { createRecordStore, type RecordStore, type RecordStoreStats } from "../engine/records";
