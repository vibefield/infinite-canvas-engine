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
 * ── WHERE THE TWO PROFILES ACTUALLY DIFFER ────────────────────────────────
 * Only in the presentation answer, and only because one of them has a choice:
 *
 *  - COMPOSITED reads the live `PresentationRegistry` — the ONE door
 *    `setPresentation` writes, which policy drives and pins fix.
 *  - STRATIFIED derives it from the kind, because there is nothing to read: a
 *    dom widget's pixels come from a natively painted P1 host (`live-dom`) and
 *    a gl widget's from a P2 island texture (`composited`). Neither can change
 *    at runtime — the profile has no promotion — so a registry would be a map
 *    that never has an entry in it. `picture` never appears: the far-zoom LOD
 *    and tray tiers are design-004 §11's recorded vNext, unbuilt in that
 *    profile, and reporting a mode it cannot enter would be a lie the type
 *    system would happily carry.
 */
import {
  PrefabId,
  createWidgetSurfaceView,
  resolveSurfacePresentation,
  widgets,
  type Entity,
  type ResolvedSurfacePresentation,
  type SurfaceDemand,
  type SurfaceKind,
  type SurfacePresentation,
  type WidgetSurfaceView,
  type World,
} from "@ice/core";
import { DEFAULT_PRESENTATION, type PresentationRegistry } from "./presentation-mode";

/**
 * The widget type behind an entity, or `undefined` for anything that is not a
 * defined widget (a port entity, a ghost, a bare prefab).
 */
function widgetTypeOf(world: World, entity: Entity) {
  const type = world.get(entity, PrefabId)?.id;
  return typeof type === "string" ? widgets.get(type) : undefined;
}

/** An entity's authored surface kind. */
export function widgetSurfaceKind(world: World, entity: Entity): SurfaceKind | undefined {
  return widgetTypeOf(world, entity)?.surface;
}

/**
 * What this entity's TYPE declared about presentation — the compiled
 * `defineWidget({ presentation })`, resolved against its kind.
 *
 * `undefined` for a non-widget entity. A widget that declared nothing still
 * gets an answer (the Q5 default for its kind, `pin: undefined`), because
 * "declared nothing" and "declared the default" must behave identically —
 * every widget on a board is in the first case and the policy may not have two
 * paths through it.
 */
export function declaredPresentation(
  world: World,
  entity: Entity,
): ResolvedSurfacePresentation | undefined {
  return widgetTypeOf(world, entity)?.presentation;
}

/**
 * Is this entity's presentation PINNED by its widget type?
 *
 * Shaped for `createPresentationPolicy({ pinned })`, which is the one consumer:
 * policy skips a pinned entity on both edges — it neither promotes it on grab
 * nor demotes it after the settle window — so a pin holds through a whole
 * gesture rather than being restored after one.
 */
export function presentationPinned(world: World, entity: Entity): boolean {
  return declaredPresentation(world, entity)?.pin !== undefined;
}

/** `pinned` for a world, curried — `createPresentationPolicy({ pinned: … })`. */
export function widgetPresentationPins(world: World): (entity: Entity) => boolean {
  return (entity) => presentationPinned(world, entity);
}

export interface WidgetSurfaceDemandSeam {
  /** What this entity is held to now. Defaults are the caller's to decide. */
  readonly demandOf: (entity: Entity) => SurfaceDemand;
  /** Where a request goes. Omit when the profile has no consumer for one. */
  readonly requestDemand?: (entity: Entity, demand: SurfaceDemand) => void;
}

export interface CompositedSurfacesOptions extends WidgetSurfaceDemandSeam {
  readonly world: World;
  /** The live mode registry — the ONE `setPresentation` door's state. */
  readonly presentation: PresentationRegistry;
}

/** The composited profile's answers: presentation is read, never derived. */
export function compositedSurfaces(opts: CompositedSurfacesOptions): WidgetSurfaceView {
  const { world, presentation } = opts;
  return createWidgetSurfaceView({
    kindOf: (entity) => widgetSurfaceKind(world, entity),
    presentationOf: (entity) => presentation.get(entity),
    demandOf: opts.demandOf,
    ...(opts.requestDemand !== undefined ? { requestDemand: opts.requestDemand } : {}),
  });
}

export interface StratifiedSurfacesOptions extends WidgetSurfaceDemandSeam {
  readonly world: World;
}

/**
 * The stratified profile's answers: presentation is DERIVED from the kind.
 *
 * `resolveSurfacePresentation(kind, undefined)` is reused rather than a literal
 * so the two profiles cannot drift apart on what a kind's resting mode is —
 * the same function that gives a composited dom widget its `live-dom` default
 * is what tells this profile a P1 host paints natively. A declared `default`
 * or `pin` is deliberately NOT consulted: this profile cannot honour one, and
 * reporting a pin it will not act on is worse than reporting the truth.
 */
export function stratifiedSurfaces(opts: StratifiedSurfacesOptions): WidgetSurfaceView {
  const { world } = opts;
  return createWidgetSurfaceView({
    kindOf: (entity) => widgetSurfaceKind(world, entity),
    presentationOf: (entity) => {
      const kind = widgetSurfaceKind(world, entity);
      return kind === undefined
        ? DEFAULT_PRESENTATION
        : (resolveSurfacePresentation(kind, undefined).default satisfies SurfacePresentation);
    },
    demandOf: opts.demandOf,
    ...(opts.requestDemand !== undefined ? { requestDemand: opts.requestDemand } : {}),
  });
}
