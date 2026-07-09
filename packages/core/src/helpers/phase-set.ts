/**
 * PhaseSet — an exclusive tag-encoded state machine with one-tick transition markers
 * (design-003 §4.2, design-002 §2/§3).
 *
 * A phase set is a small, fixed list of mutually-exclusive phases (e.g. a recognizer's
 * `possible → active → ended`). For each phase it mints two tags via the schema wrapper:
 *   - a persistent phase tag   `${name}:${phase}`      — "the entity is in this phase"
 *   - a one-tick `Just` marker `${name}:just-${phase}` — "the entity ENTERED this phase this frame"
 *
 * Why two tags: terminal phases persist through the reap window (design-003 §4.1), so a
 * behavior that acted on the persistent tag would fire on every frame the tag lingers.
 * Behaviors therefore **edge-trigger on the `Just*` markers only** — discrete actions and
 * terminal handling fire exactly once (design-003 §4.2: shift-tap toggles once, commits
 * never double). The persistent tag is for per-frame work that legitimately repeats.
 *
 * Transition timing: `set` mutates through the caller's structural writer. When that writer
 * is a {@link SystemCtx} the add/remove are DEFERRED to the current strata-phase flush
 * (design-002 §3); consumers in a LATER sub-phase see the new phase the same frame, and
 * that ordering is guaranteed by the sub-phase pipeline layout (design-002 §2), never by
 * immediate application. When the writer is the `World` (app handlers / setup) the writes
 * are immediate. The one-tick markers are cleared by the cleanup phase via
 * {@link PhaseSet.clearMarkers} over {@link PhaseSet.allMarkerTags}.
 */

import type { Entity, Tag } from "@vibecook/strata-ecs";
import { devGuardsEnabled } from "../guards/dev";
import { defineTag } from "../schema/meta";

/**
 * The minimal structural-write surface `set`/`clearMarkers` need. Both `SystemCtx` (deferred
 * to the phase flush) and `World` (immediate) satisfy it structurally — the transition is
 * agnostic to which, and the timing follows from the writer (see the module doc).
 */
export interface StructuralTagWriter {
  addTag(e: Entity, t: Tag): void;
  removeTag(e: Entity, t: Tag): void;
}

/** The minimal read surface `current` needs — again satisfied by both `SystemCtx` and `World`. */
export interface TagReader {
  hasTag(e: Entity, t: Tag): boolean;
}

/** The handle returned by {@link definePhaseSet}. `P` is the literal union of phase names. */
export interface PhaseSet<P extends string> {
  /** The set name — the prefix of every minted tag. */
  readonly name: string;
  /** The phases in declaration order (the scan order of {@link PhaseSet.current}). */
  readonly phases: readonly P[];
  /** Persistent phase tags, keyed by phase name. */
  readonly tags: Readonly<Record<P, Tag>>;
  /** One-tick `Just<Phase>` marker tags, keyed by phase name. */
  readonly justTags: Readonly<Record<P, Tag>>;
  /** Every marker tag — the cleanup phase clears these once the frame's edges are consumed. */
  readonly allMarkerTags: readonly Tag[];
  /**
   * Transition `e` into `next`: drop the current phase tag + its now-stale marker and add
   * `next` + its fresh `Just` marker (exclusivity is enforced by clearing every phase tag,
   * so a mis-set entity converges). Unknown `next` throws. A transition to the phase the
   * entity is already in is a no-op with a DEV warn (detected only when `m` can also read —
   * `SystemCtx`/`World` both can).
   */
  set(m: StructuralTagWriter, e: Entity, next: P): void;
  /** The entity's current phase, or `undefined` if it holds none. Small-N `hasTag` scan. */
  current(world: TagReader, e: Entity): P | undefined;
  /** Clear every one-tick marker off `e` (the cleanup-phase step). */
  clearMarkers(m: StructuralTagWriter, e: Entity): void;
}

/** Narrow a structural writer that also happens to read (for the DEV double-set guard). */
function hasReader(m: object): m is TagReader {
  return "hasTag" in m && typeof (m as TagReader).hasTag === "function";
}

/**
 * Define an exclusive PhaseSet: one persistent tag + one one-tick `Just` marker per phase.
 * Handles are process-global schema constants (hold them as module constants). See the module
 * doc for transition timing and the edge-trigger contract.
 */
export function definePhaseSet<const P extends string>(name: string, phases: readonly P[]): PhaseSet<P> {
  const tags = {} as Record<P, Tag>;
  const justTags = {} as Record<P, Tag>;
  const allMarkerTags: Tag[] = [];
  for (const phase of phases) {
    tags[phase] = defineTag(`${name}:${phase}`);
    const marker = defineTag(`${name}:just-${phase}`);
    justTags[phase] = marker;
    allMarkerTags.push(marker);
  }

  const set: PhaseSet<P>["set"] = (m, e, next) => {
    const nextTag = tags[next];
    if (nextTag === undefined) {
      throw new Error(
        `ice: definePhaseSet("${name}").set — unknown phase "${next}" (known: ${phases.join(", ")}).`,
      );
    }
    if (devGuardsEnabled() && hasReader(m) && m.hasTag(e, nextTag)) {
      // Already in `next` — the transition is a no-op. Warn and skip so the fresh marker
      // is not re-emitted (which would edge-trigger downstream behaviors a second time).
      console.warn(`ice: definePhaseSet("${name}").set — entity is already in phase "${next}"; no-op.`);
      return;
    }
    // Exclusivity: clear every phase tag + every marker (no-op for absent ones), then set
    // `next` + its marker. This subsumes "remove the current phase + its stale marker" and
    // converges a mis-set entity to exactly one phase.
    for (const phase of phases) {
      m.removeTag(e, tags[phase]);
      m.removeTag(e, justTags[phase]);
    }
    m.addTag(e, nextTag);
    m.addTag(e, justTags[next]);
  };

  const current: PhaseSet<P>["current"] = (world, e) => {
    for (const phase of phases) {
      if (world.hasTag(e, tags[phase])) return phase;
    }
    return undefined;
  };

  const clearMarkers: PhaseSet<P>["clearMarkers"] = (m, e) => {
    for (const marker of allMarkerTags) m.removeTag(e, marker);
  };

  return { name, phases, tags, justTags, allMarkerTags, set, current, clearMarkers };
}
