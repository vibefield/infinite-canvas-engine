/**
 * The Widget Surface contract, answered — once per presentation profile
 * (design-012 §6; plan §5 S8's "both profiles typecheck against one
 * interface").
 *
 * `core/surface/contract.ts` finalises the QUESTIONS: what kind of pixels does
 * this widget have, where are they coming from right now, and what rate is it
 * held to. This file is where the two profiles answer them, and it lives in
 * `dom` because that is the one package that hosts widgets under BOTH — the
 * stratified planes (P1/P2/P3) and the L1 source canvas are neighbours here,
 * and neither `ground` nor `r3f` can be imported by the other.
 *
 * The kind is read from the WIDGET-TYPE REGISTRY, not from the compositor's
 * source registry, and that is the load-bearing choice: a widget has a kind
 * from the moment it spawns, while a source appears only once the compositor
 * has something to sample. Asking the source registry would have made a card's
 * kind flicker into existence one frame after the card did — and would have
 * answered `undefined` for every live-dom widget on the board, which is most
 * of them at rest.
 *
 * ── ERRATA 2026-09-06 (A1b, design-013 §5) ────────────────────────────────
 * This header used to say the profiles differ because "COMPOSITED reads the
 * live `PresentationRegistry` — the ONE door `setPresentation` writes", and
 * this module exported `declaredPresentation`, `presentationPinned` and
 * `widgetPresentationPins` for the policy that drove it. The registry, the
 * policy and the `defineWidget({ presentation })` declaration behind those
 * three are DELETED. Where a card presents is the world's `SurfaceTarget`,
 * written by the entity's kind behaviour and read through `effectiveTarget`.
 *
 * ── WHERE THE TWO PROFILES ACTUALLY DIFFER ────────────────────────────────
 * Only in the target answer, and only because one of them has a choice:
 *
 *  - COMPOSITED reads the world's `SurfaceTarget` — the kind behaviour's
 *    choice, which a grab moves and a settle window moves back.
 *  - STRATIFIED derives it from the KIND, because it has no promotion to
 *    read: a dom widget's pixels come from a natively painted P1 host and a
 *    gl widget's from a P2 island texture, and neither changes at runtime.
 *    That is `effectiveTarget(kind, "dom")` — the same coercion every reader
 *    goes through, applied to equip's own resting default — so the two
 *    profiles cannot drift about what a kind rests on. The standard
 *    behaviours DO still run in a stratified app and still write
 *    `SurfaceTarget` on a grab; nothing there observes it, and this view
 *    deliberately does not report a promotion the profile cannot perform.
 */
import {
  PAUSED_SURFACE_DEMAND,
  PrefabId,
  SurfaceDemand,
  SurfaceKind,
  SurfaceTarget,
  createWidgetSurfaceView,
  effectiveTarget,
  widgets,
  type Entity,
  type SurfaceDemandValue,
  type SurfaceKindValue,
  type WidgetSurfaceView,
  type World,
} from "@ice/core";

/**
 * The widget type behind an entity, or `undefined` for anything that is not a
 * defined widget (a port entity, a ghost, a bare prefab).
 */
function widgetTypeOf(world: World, entity: Entity) {
  const type = world.get(entity, PrefabId)?.id;
  return typeof type === "string" ? widgets.get(type) : undefined;
}

/** An entity's authored surface kind. */
export function widgetSurfaceKind(world: World, entity: Entity): SurfaceKindValue | undefined {
  return widgetTypeOf(world, entity)?.surface;
}

/**
 * The entity's kind as the WORLD holds it, defaulting to `dom`.
 *
 * `SurfaceKind` is stamped at equip, so an entity that has not been equipped —
 * or is not a widget at all — carries none. `dom` is the honest default there:
 * it is the one kind `effectiveTarget` lets choose, so a bare entity keeps the
 * behaviour it always had, and no reader has to invent its own fallback.
 */
function kindInWorld(world: World, entity: Entity): "dom" | "gl" | "video" {
  const kind = world.get(entity, SurfaceKind)?.kind;
  return kind === "gl" || kind === "video" ? kind : "dom";
}

/** The declared target as the world holds it; equip's `dom` when unstamped. */
function targetInWorld(world: World, entity: Entity): "dom" | "gpu" {
  return world.get(entity, SurfaceTarget)?.target === "gpu" ? "gpu" : "dom";
}

/** The CLAMP as the world holds it; equip's paused default when unstamped. */
function demandInWorld(world: World, entity: Entity): SurfaceDemandValue {
  const cell = world.get(entity, SurfaceDemand);
  if (cell === undefined) return PAUSED_SURFACE_DEMAND;
  return {
    mode: cell.mode === "live" ? "live" : "paused",
    fpsBucket: cell.fpsBucket as SurfaceDemandValue["fpsBucket"],
    interactive: cell.interactive,
  };
}

export interface WidgetSurfaceDemandSeam {
  /** What this entity is held to now. Defaults are the caller's to decide. */
  readonly demandOf: (entity: Entity) => SurfaceDemandValue;
  /** Where a request goes. Omit when the profile has no consumer for one. */
  readonly requestDemand?: (entity: Entity, demand: SurfaceDemandValue) => void;
}

export interface CompositedSurfacesOptions extends Partial<WidgetSurfaceDemandSeam> {
  readonly world: World;
}

/**
 * The composited profile's answers: the target is READ from the world, never
 * derived, and the demand is the CLAMP the Demand system wrote rather than an
 * app callback. `demandOf` stays overridable for a host that throttles from
 * somewhere else; omitted, the world answers.
 */
export function compositedSurfaces(opts: CompositedSurfacesOptions): WidgetSurfaceView {
  const { world } = opts;
  const demandOf = opts.demandOf ?? ((entity: Entity) => demandInWorld(world, entity));
  return createWidgetSurfaceView({
    kindOf: (entity) => widgetSurfaceKind(world, entity),
    targetOf: (entity) => effectiveTarget(kindInWorld(world, entity), targetInWorld(world, entity)),
    demandOf,
    ...(opts.requestDemand !== undefined ? { requestDemand: opts.requestDemand } : {}),
  });
}

export interface StratifiedSurfacesOptions extends WidgetSurfaceDemandSeam {
  readonly world: World;
}

/**
 * The stratified profile's answers: the target is DERIVED from the kind (see
 * the header). It keeps its app-supplied demand seam — this profile has no
 * compositor to clamp for, so what throttles a self-animating card is the
 * app's business, exactly as it was.
 */
export function stratifiedSurfaces(opts: StratifiedSurfacesOptions): WidgetSurfaceView {
  const { world } = opts;
  return createWidgetSurfaceView({
    kindOf: (entity) => widgetSurfaceKind(world, entity),
    targetOf: (entity) => effectiveTarget(kindInWorld(world, entity), "dom"),
    demandOf: opts.demandOf,
    ...(opts.requestDemand !== undefined ? { requestDemand: opts.requestDemand } : {}),
  });
}
