/**
 * The component / tag / relation / resource CATALOG — the vocabulary contract
 * (design-001 §5, design-003 §4). A faithful transcription: names match the
 * design EXACTLY, since these strings are the durable + cross-peer schema.
 *
 * Everything is defined through the recording wrappers in ../schema/meta (never
 * strata directly), so prefab validation and devtools can introspect the shapes.
 *
 * DEFAULTS POLICY (design-001 §5 says "match the doc"; the task asks for prefab
 * ergonomics — reconciled here):
 *  - Essential geometry/identity a prefab or commit ALWAYS supplies stays bare
 *    (required at spawn): Position, Size, StackZ, WirePorts, Pointer.id/device,
 *    Port.id/side, PresenceInfo.
 *  - Origin-latch riders that MUST carry real values stay bare: Grab, Down —
 *    a defaulted zero origin would corrupt a cancel-restore.
 *  - Enum-identity fields that differ per entity stay bare: HandleSpec.anchor,
 *    GuideLine.axis, CursorVisual.kind, PresenceCursor.device.
 *  - Everything else — runtime accumulators/scratch (recognizer kind components,
 *    per-frame value writes), optional-eligible components (Rotation), derived
 *    state, and resources — carries a zero/identity default so an ad-hoc attach
 *    or `ctx.spawn` needs no boilerplate. Resources especially: one live value
 *    that must initialize sanely (origin, zoom 1, select tool).
 *
 * PrefabId is NOT here — it is defined once in ../schema/prefab (§2 rule 5).
 */
export * from "./scene";
export * from "./graph";
export * from "./pointer";
export * from "./gesture";
export * from "./insert";
export * from "./selection-presence";
export * from "./camera-derived";
export * from "./settings-resources";
