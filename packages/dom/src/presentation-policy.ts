/**
 * The Q5 DEFAULT, as policy (design-012 §6.3, §11 Q5; plan §2 "hysteresis").
 *
 * `live-dom` at rest, `composited` on drag — native caret, native text
 * selection and threaded scroll while the user reads and types, and the
 * compositor's true z and unified effects while things move. The fidelity seam
 * appears only during motion, where motion masks it.
 *
 * This file is the POLICY. The mechanism it drives is
 * `presentation-mode.ts`'s one `setPresentation` door, and it deliberately
 * owns no reparenting of its own: a second place that moved hosts would be a
 * second place that could desynchronise the DOM from the compositor registry.
 *
 * ── Why demotion is debounced and promotion is not ────────────────────────
 * Promotion must be INSTANT: it happens on pickup, and the first composited
 * frame may already lag one paint event (~1.7 ms), which the gesture masks.
 * Waiting would put that lag in the middle of a drag instead.
 *
 * Demotion must WAIT. A drop is not the end of motion — inertia is still
 * settling, and design-004's gesture protocol can re-grab within a frame or
 * two (a drag that continues after a momentary release, a snap that retargets).
 * Demoting on the release edge would promote and demote repeatedly through one
 * user gesture, and every one of those transitions costs a slot free and a
 * re-copy. One settle window collapses the whole burst into a single decision.
 *
 * The window is TIME, not frames: the cost being avoided is re-rasterisation,
 * which is paid in milliseconds and does not get cheaper on a fast display.
 *
 * ── WHAT POLICY MAY NOT DECIDE (S8) ───────────────────────────────────────
 * Two classes of entity are out of its hands, and it reads both from the
 * widget-type registry rather than being told about them, so that an app
 * cannot forget to wire the answer:
 *
 *  - PINNED types (`defineWidget({ presentation: { pin } })`) — §6.3's "a
 *    widget type may pin either mode". Skipped on BOTH edges, so a pin holds
 *    through a whole gesture instead of being restored after it.
 *  - Kinds with no live-dom mode. See `eligible` below; for a GL island this
 *    is not a no-op but a source eviction.
 */
import {
  Grab,
  defineQuery,
  presentationIsLegal,
  type Entity,
  type ReflectorDef,
  type World,
} from "@ice/core";
import type { PresentationRegistry } from "./presentation-mode";
import { declaredPresentation, widgetSurfaceKind } from "./widget-surfaces";

/** `Grab` IS the motion signal — the same cell the lift and P3 promote read. */
const grabQuery = defineQuery([Grab]);

export interface PresentationPolicyOptions {
  /**
   * How long after the last release before a card demotes, in ms. Default 250:
   * long enough to swallow a re-grab and the tail of an inertial settle, short
   * enough that a dropped card is back on the native text path before anyone
   * reaches for it.
   */
  readonly settleMs?: number;
  /** Clock seam, for tests. Defaults to `performance.now()`. */
  readonly now?: () => number;
  /**
   * EXTRA entities this policy must not touch, beyond the ones their widget
   * type already pinned via `defineWidget({ presentation: { pin } })` — which
   * this policy reads for itself (see `isPinned` below). An app-level override
   * for a decision made per instance rather than per type.
   */
  readonly pinned?: (entity: Entity) => boolean;
}

export interface PresentationPolicy extends ReflectorDef {
  /** Promotions performed (the churn instrument). */
  promotions(): number;
  /** Demotions performed. */
  demotions(): number;
  /** Entities waiting out the settle window. */
  settling(): number;
  dispose(): void;
}

export function createPresentationPolicy(
  world: World,
  presentation: PresentationRegistry,
  options: PresentationPolicyOptions = {},
): PresentationPolicy {
  const settleMs = options.settleMs ?? 250;
  const now = options.now ?? (() => performance.now());
  /** Entities this policy promoted — it demotes only what it promoted. */
  const owned = new Set<Entity>();
  /** entity → when its settle window expires. */
  const settling = new Map<Entity, number>();
  let promotions = 0;
  let demotions = 0;
  let dirty = true;

  // A grab or a release is the only thing that can change this policy's mind,
  // so the flush is gated on that stamp rather than running every frame.
  const unobserve = world.reactive.observeQuery(
    grabQuery,
    () => {
      dirty = true;
    },
    { cols: [] },
  );

  /**
   * A pin is a WIDGET-TYPE fact first (design-012 §6.3: "a widget type may pin
   * either mode"), read here rather than passed in, so an app cannot forget to
   * wire it and quietly get a pinned card dragged out of its declared mode.
   * `options.pinned` is an additional per-instance veto, not the mechanism.
   */
  const isPinned = (entity: Entity): boolean =>
    declaredPresentation(world, entity)?.pin !== undefined || options.pinned?.(entity) === true;

  /**
   * Does this entity's kind have a live-dom↔composited choice to make at all?
   *
   * ONLY `dom` surfaces do. A GL island's pixels are a texture in every mode it
   * has, and promoting one is not merely pointless — it is DESTRUCTIVE. Island
   * sources are registered in the compositor's source registry KEYED BY ENTITY
   * (`r3f/webgpu-sources.ts`), and a promotion moves the widget's host under
   * the L1 canvas, where `domWidgets` registers a `dom` source for the same
   * entity. `register` replaces, so the island's `gl` source would be evicted
   * by its own chrome host, and the compositor would atlas-copy a card body
   * where the 3D content used to be. Nothing witnessed this because the S6
   * drag witness drags a DOM card; the guard is here so nothing has to.
   */
  const eligible = (entity: Entity): boolean => {
    const kind = widgetSurfaceKind(world, entity);
    // Refuses only what is KNOWN to have no live-dom mode. An entity with no
    // widget type keeps the behaviour it always had: it has no island source
    // to evict either, so there is nothing for a stricter reading to protect.
    return kind === undefined || presentationIsLegal(kind, "live-dom");
  };

  return {
    name: "presentationPolicy",
    // `always` because the settle window expires on a CLOCK, not on a stamp:
    // nothing writes ECS when 250 ms pass, so a purely observed reflector would
    // leave a dropped card composited until the user touched something else.
    always: true,

    flush(_w: World) {
      const at = now();
      const grabbed = new Set<Entity>();
      world.query(grabQuery).each((chunk) => {
        for (let row = 0; row < chunk.count; row++) grabbed.add(chunk.entity(row));
      });

      if (dirty) {
        dirty = false;
        for (const entity of grabbed) {
          if (isPinned(entity) || !eligible(entity)) continue;
          settling.delete(entity); // a re-grab cancels a pending demotion
          if (presentation.set(entity, "composited")) {
            owned.add(entity);
            promotions++;
          }
        }
        // Released: start the window rather than demoting now.
        for (const entity of owned) {
          if (grabbed.has(entity) || settling.has(entity)) continue;
          settling.set(entity, at + settleMs);
        }
      }

      if (settling.size === 0) return;
      for (const [entity, due] of settling) {
        if (at < due) continue;
        settling.delete(entity);
        owned.delete(entity);
        // A pin acquired mid-gesture (or an app veto that arrived late) stops
        // the demotion too — `owned` is already dropped, so the card simply
        // stays where the pin wants it.
        if (isPinned(entity)) continue;
        // A despawned card needs no demotion — domWidgets already dropped its
        // host and its registration when it left the store.
        if (!world.isAlive(entity)) {
          presentation.clear(entity);
          continue;
        }
        if (presentation.set(entity, "live-dom")) demotions++;
      }
    },

    promotions: () => promotions,
    demotions: () => demotions,
    settling: () => settling.size,

    dispose() {
      unobserve();
      owned.clear();
      settling.clear();
    },
  };
}
