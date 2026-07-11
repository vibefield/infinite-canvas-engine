/**
 * Recognizers & gestures — the L2 runtime recognizer prefabs (design-001 §5.5,
 * design-003 §4).
 *
 * Identity is the KIND component (its presence is the kind; its fields are the
 * working value). Phase is a tag-of-set flipped by the engine PhaseSet helper
 * (strata has no one-of primitive; `Pending` was dropped as dead machinery). All
 * in-flight state lives on the recognizer entity or the grabbed widgets — no
 * singleton trackers — so N concurrent same-kind gestures are structural.
 *
 * Field set for each kind matches design-003 §4.2's revised table (which adds
 * `zoomAtClaim` to Drag and Pinch over design-001 §5.5).
 *
 * Defaults policy (see catalog/index.ts): kind components and per-frame working
 * riders are runtime scratch spawned/written by systems, so they carry full
 * zero/identity defaults (ergonomic `ctx.spawn`). Origin-latch riders that MUST
 * carry real values (Grab, Down) stay bare so a defaulted origin can't silently
 * corrupt a cancel-restore.
 */
import { enumOf, field } from "@vibecook/strata-ecs";
import { definePhaseSet } from "../helpers/phase-set";
import { defineComponent, defineRelation, defineTag } from "../schema/meta";

// --- kind components (design-003 §4.2) ---

/** Continuous drag. Origin from dead-zone exit; totals/velocities accumulate; `zoomAtClaim` anchors widget-move math. */
export const Drag = defineComponent("Drag", {
  startX: field("f64", { default: 0 }),
  startY: field("f64", { default: 0 }),
  totalX: field("f32", { default: 0 }),
  totalY: field("f32", { default: 0 }),
  velX: field("f32", { default: 0 }),
  velY: field("f32", { default: 0 }),
  zoomAtClaim: field("f32", { default: 1 }),
});

/** Discrete tap — claims at up within the tap window & slop. */
export const Tap = defineComponent("Tap", { downAt: field("f64", { default: 0 }) });

/** Discrete-with-tail: claims at the long-press hold, then tracks cur X/Y per frame (touch marquee rides it). */
export const LongPress = defineComponent("LongPress", {
  downAt: field("f64", { default: 0 }),
  startX: field("f64", { default: 0 }),
  startY: field("f64", { default: 0 }),
  curX: field("f64", { default: 0 }),
  curY: field("f64", { default: 0 }),
});

/** Continuous two-finger pinch. `startDist` re-baselines at activation; `cx/cy` is the centroid. */
export const Pinch = defineComponent("Pinch", {
  startDist: field("f32", { default: 0 }),
  startZoom: field("f32", { default: 1 }),
  cx: field("f64", { default: 0 }),
  cy: field("f64", { default: 0 }),
  zoomAtClaim: field("f32", { default: 1 }),
});

/** Continuous wheel pan (`Simultaneous` — never claims pointers). `anchorX/Y` is the screen anchor. */
export const WheelPan = defineComponent("WheelPan", {
  dx: field("f32", { default: 0 }),
  dy: field("f32", { default: 0 }),
  anchorX: field("f32", { default: 0 }),
  anchorY: field("f32", { default: 0 }),
});

/** Continuous wheel zoom (`Simultaneous`). `pinch` is the accumulated zoom signal; `anchorX/Y` the pin point. */
export const WheelZoom = defineComponent("WheelZoom", {
  pinch: field("f32", { default: 0 }),
  anchorX: field("f32", { default: 0 }),
  anchorY: field("f32", { default: 0 }),
});

// --- phases (exclusive set + one-tick Just* markers; flipped via the PhaseSet helper) ---

/**
 * The recognizer lifecycle as ONE PhaseSet (design-003 §4.2): six mutually-exclusive
 * phases. Each mints a persistent `Gesture<Phase>` tag AND a one-tick `GestureJust<Phase>`
 * marker (plain concatenation — the doc vocabulary "GesturePossible"… is unchanged), so
 * behaviors edge-trigger discrete/terminal actions on the markers exactly once while a
 * terminal tag lingers through the reap window (§4.2, §4.1). The named phase tags below
 * are re-exports of `GesturePhases.tags.*` for ergonomics + `ops/claims` compatibility.
 * `GesturePossible` etc. is the ONLY definition path for these tag names (strata's schema
 * registry is process-global — a second `defineTag("GesturePossible")` would throw).
 */
export const GesturePhases = definePhaseSet("Gesture", [
  "Possible",
  "Active",
  "Recognized",
  "Ended",
  "Failed",
  "Cancelled",
] as const);

/** Recognizer alive, not yet claiming. */
export const GesturePossible = GesturePhases.tags.Possible;

/** Continuous kinds' claiming phase + per-frame work gate. */
export const GestureActive = GesturePhases.tags.Active;

/** Discrete kinds' terminal claim. */
export const GestureRecognized = GesturePhases.tags.Recognized;

/** Continuous kinds' terminal (release). */
export const GestureEnded = GesturePhases.tags.Ended;

/** Recognizer failed its predicate or lost arbitration. */
export const GestureFailed = GesturePhases.tags.Failed;

/** Recognizer cancelled (pointercancel / integrity / CancelRequest). */
export const GestureCancelled = GesturePhases.tags.Cancelled;

/** Suspended (a pinch suspends the single-pointer recognizers) — "suspend, don't kill". */
export const GestureSuspended = defineTag("GestureSuspended");

/**
 * The recognizer latched a `Captures` target at spawn (design-003 §4.1 integrity).
 * Relations auto-clear on target despawn, so "had a capture, has none now" is
 * detectable only with this spawn-time mark — integrity cancels on that edge loss.
 */
export const HadCapture = defineTag("HadCapture");

/** Runs alongside claims without competing (wheel pan/zoom) — keeps zoom-while-dragging legal. */
export const Simultaneous = defineTag("Simultaneous");

// --- route tags (latched at drag activation; never change mid-gesture, design-003 §4.4) ---

export const RoutedMove = defineTag("RoutedMove");
export const RoutedResize = defineTag("RoutedResize");
export const RoutedConnect = defineTag("RoutedConnect");
export const RoutedMarquee = defineTag("RoutedMarquee");
export const RoutedPan = defineTag("RoutedPan");
/** Draw-tool drag: the release rect creates a widget (design-005 §3, M10). */
export const RoutedDraw = defineTag("RoutedDraw");

// --- recognizer relations ---

/** recognizer → watched pointer(s). */
export const Watches = defineRelation("Watches", { arity: "many" });

/** recognizer → grabbed entity (widget/port/handle/canvas), latched at down. */
export const Captures = defineRelation("Captures", { arity: "one" });

/** recognizer → affected widgets (live edge set; remote despawns auto-clear their edge). */
export const Drags = defineRelation("Drags", { arity: "many" });

/** pointer → the recognizer that claimed it (arbitration output, design-003 §4.3). */
export const ClaimedBy = defineRelation("ClaimedBy", { arity: "one" });

/** recognizer → candidate container under the dragged bounds (design-003 §5 dropSystem). */
export const DropTarget = defineRelation("DropTarget", { arity: "one" });

// --- per-gesture riders ---

/**
 * Per-dragged-widget origin, attached at claim time with the CURRENT transform embedded
 * (design-001 §3, design-003 §4.5). Bare on purpose: a defaulted zero origin would corrupt
 * the cancel-restore of Position/StackZ.
 */
export const Grab = defineComponent("Grab", {
  x: "f64",
  y: "f64",
  w: "f32",
  h: "f32",
  z: "f64",
});

/** Snap offset — in the Drag prefab's essential set (present from spawn, zeroed — writers never race an attach). */
export const SnapState = defineComponent("SnapState", {
  dx: field("f32", { default: 0 }),
  dy: field("f32", { default: 0 }),
});

/**
 * The down point + timestamp latched on the recognizer at spawn (design-003 §4.1). Bare: it must
 * carry the real down sample.
 */
export const Down = defineComponent("Down", { x: "f64", y: "f64", ms: "f64" });

/** On widgets, toggled O(1) when the drop candidate changes (design-001 §5.5). */
export const OverlapCandidate = defineTag("OverlapCandidate");

/**
 * Fly-back tween easing Position → target (design-003 §5 move outcome; design-001 §3 amends the
 * per-cell guard so a live tween IS the diverging authority until reconvergence).
 *
 * Minimal shape not spelled out field-by-field in design-001 §5: the target (`toX/toY`) and
 * `durationMs` are supplied at attach (bare); `elapsedMs` starts at 0 and the tween system advances
 * it, removing the component on arrival.
 */
export const TransformTween = defineComponent("TransformTween", {
  toX: "f64",
  toY: "f64",
  durationMs: "f32",
  elapsedMs: field("f32", { default: 0 }),
});
