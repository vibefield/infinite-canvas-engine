/**
 * Camera/viewport/tools (design-001 §5.7) + culling, chrome, cursors,
 * breakpoints, navigation (design-001 §5.8, reconciled additions).
 *
 * These are the §2 rule-7 residue (resources with no entity) plus the
 * derive-owned runtime prefabs. All resources here are runtime — Camera writes
 * go through the resource only (no shadow copy). Widgets are positioned in world
 * units inside their plane; the camera is applied as one transform per plane, so
 * there is deliberately no per-widget screen-bounds component — screen-space
 * values are derived only for chrome and cursors (small N).
 *
 * Defaults policy (see catalog/index.ts): resources carry full defaults (a single
 * live value that must initialize sanely — origin, zoom 1, select tool). Derived
 * fields carry zero/identity defaults; enum-identity fields that must be specific
 * per entity (HandleSpec.anchor, GuideLine.axis, CursorVisual.kind) stay bare.
 */
import { enumOf, field } from "@vibecook/strata-ecs";
import { defineComponent, defineRelation, defineResource, defineTag } from "../schema/meta";
import { SNAP_DEFAULTS } from "../settings/defaults";

// --- runtime resources (design-001 §5.7) ---

/** The single live camera (F2). `gesturing` gates the compositor DPR (design-004). */
export const Camera = defineResource("Camera", {
  x: field("f64", { default: 0 }),
  y: field("f64", { default: 0 }),
  zoom: field("f32", { default: 1 }),
  gesturing: field("bool", { default: false }),
});

/** Viewport size + device pixel ratio. */
export const Viewport = defineResource("Viewport", {
  w: field("f32", { default: 0 }),
  h: field("f32", { default: 0 }),
  dpr: field("f32", { default: 1 }),
});

/** The active tool id (defaults to select). */
export const ActiveTool = defineResource("ActiveTool", { id: field("string", { default: "select" }) });

/**
 * Stage presentation phase (2026-07-19, the widget-tray quiesce): app chrome
 * that covers or recedes the canvas takes a BACKGROUND HOLD via
 * `ce.stage.background(name)` — refcounted here (facade-owned tokens, this
 * resource is the world-truth mirror). While holds > 0 the stage stops
 * DISCRETIONARY per-frame work — animated GL islands freeze on their retained
 * textures (compositor gate, the design-006 §8.2 flight-freeze posture) —
 * but the world STAYS LIVE: systems tick, ops reflect, remote edits apply,
 * tweens land. Backgrounding is rendering policy; whether the canvas is
 * INTERACTABLE stays the overlay's own concern (its backdrop). Deliberately
 * NOT a full step-pause: a menu panel floats over a still-visible canvas,
 * and a frozen world would leave undo/collab visually stale (rev-2 decision,
 * recorded — a stricter frozen-world mode would be a separate concept).
 * That separate concept is now BUILT (2026-08-04): see {@link FrameMode}.
 * Holds keep their exact meaning — nothing here stretched.
 */
export const StageMode = defineResource("StageMode", {
  backgroundHolds: field("u32", { default: 0 }),
});

/**
 * Frame gate mirror (2026-08-04) — the stricter sibling {@link StageMode}'s
 * rev-2 decision named and left for later.
 *
 * A background hold is presentation policy over a LIVE world. A freeze
 * (`engine.frame.freeze(name)`) stops the host loop outright: no step, so no
 * systems, no publish, no notify, no reflectors, no rAF — for chrome that
 * COVERS the canvas, where every frame drawn behind it is work nobody can see.
 * This resource is the world-truth mirror of that refcount; the tokens live on
 * the control, out of ECS, exactly as stage holds do.
 *
 * Reading it tells you the engine is frozen. It cannot tell you a frame is
 * coming, because while the count is non-zero none is — and for the same
 * reason nothing can OBSERVE it while frozen (a parked world fires no
 * observers). It exists for inspection: devtools, tests, and consumers that
 * want the fact in hand on thaw.
 */
export const FrameMode = defineResource("FrameMode", {
  freezeHolds: field("u32", { default: 0 }),
});

/** Global snap toggle + threshold in screen px (scaled by zoom at use, design-003 §5.2). */
export const SnapConfig = defineResource("SnapConfig", {
  enabled: field("bool", { default: SNAP_DEFAULTS.enabled }),
  thresholdPx: field("f32", { default: SNAP_DEFAULTS.thresholdPx }),
});

/** Per-container view-state memory — a runtime rider on container widgets (design-001 §5.7). */
export const ContainerCamera = defineComponent("ContainerCamera", {
  x: field("f64", { default: 0 }),
  y: field("f64", { default: 0 }),
  zoom: field("f32", { default: 1 }),
});

// --- derived tags (design-001 §5.8) ---

/** Widget's ChildOf chain roots in the CURRENT nav frame (activeMembership system). */
export const Active = defineTag("Active");

/** In the viewport. Invariant: Active widgets are Visible ⊕ Culled. */
export const Visible = defineTag("Visible");

/** Outside the viewport. */
export const Culled = defineTag("Culled");

/** LOD tier + the effective size it was computed from (5 thresholds, width AND height). */
export const WidgetBreakpoint = defineComponent("WidgetBreakpoint", {
  tier: field(enumOf(["micro", "compact", "normal", "expanded", "detailed"]), { default: "normal" }),
  w: field("u16", { default: 0 }),
  h: field("u16", { default: 0 }),
});

/** Session rider on auto-sized widgets (ResizeObserver → queue → ingest; never committed). */
export const MeasuredSize = defineComponent("MeasuredSize", {
  w: field("f32", { default: 0 }),
  h: field("f32", { default: 0 }),
});

// --- chrome prefabs (pooled entities, reaped when the source empties) ---

/** Selection outline rect. */
export const SelectionBox = defineComponent("SelectionBox", {
  x: field("f64", { default: 0 }),
  y: field("f64", { default: 0 }),
  w: field("f32", { default: 0 }),
  h: field("f32", { default: 0 }),
});

/** A resize handle's anchor (the one chrome kind behaviors capture). */
export const HandleSpec = defineComponent("HandleSpec", {
  anchor: enumOf(["nw", "n", "ne", "e", "se", "s", "sw", "w"]),
});

/** A snap guide line along one axis. `from == to` ⇒ full-viewport line (v1's full-canvas alignment look — design-003 §6). */
export const GuideLine = defineComponent("GuideLine", {
  axis: enumOf(["x", "y"]),
  at: field("f64", { default: 0 }),
  from: field("f64", { default: 0 }),
  to: field("f64", { default: 0 }),
});

/**
 * One equal-spacing gap segment (snap chrome's second visual, design-003 §6):
 * a bar along `axis` spanning `from`→`to` at perpendicular position `perp`,
 * marking a gap of `gap` world units. The kernel indicator's two segments
 * flatten to two entities (v1 `u_spacings` parity).
 */
export const SpacingBar = defineComponent("SpacingBar", {
  axis: enumOf(["x", "y"]),
  from: field("f64", { default: 0 }),
  to: field("f64", { default: 0 }),
  perp: field("f64", { default: 0 }),
  gap: field("f32", { default: 0 }),
});

/** Marquee selection rect. */
export const MarqueeBox = defineComponent("MarqueeBox", {
  x: field("f64", { default: 0 }),
  y: field("f64", { default: 0 }),
  w: field("f32", { default: 0 }),
  h: field("f32", { default: 0 }),
});

/** Cursor appearance — local (OS cursor) vs remote (custom node). */
export const CursorVisual = defineComponent("CursorVisual", {
  kind: enumOf(["local", "remote"]),
  pressed: field("bool", { default: false }),
});

/** cursor → pointer or presence peer. */
export const Follows = defineRelation("Follows", { arity: "one" });

/** chrome → its source (recognizer, selection). */
export const VisualOf = defineRelation("VisualOf", { arity: "one" });

// --- navigation stack (session NavEntry prefab, design-004 §7) ---

/** Depth of a nav entry (root = 0). */
export const NavDepth = defineComponent("NavDepth", { d: field("u8", { default: 0 }) });

/** Camera stored on a nav entry. */
export const NavCamera = defineComponent("NavCamera", {
  x: field("f64", { default: 0 }),
  y: field("f64", { default: 0 }),
  zoom: field("f32", { default: 1 }),
});

/** nav entry → container widget. */
export const NavFrame = defineRelation("NavFrame", { arity: "one" });

/** The canvas background entity, so picking always resolves to *something* (design-001 §4). */
export const CanvasSurface = defineTag("CanvasSurface");
