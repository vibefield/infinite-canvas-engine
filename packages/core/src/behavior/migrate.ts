/**
 * Behavior schema evolution (design-009 §5.5–§5.6, BF-D14) — M13g.
 *
 * Markers are `engine.behavior.<name>.<v>` write-once keys: a monotone key SET,
 * never a mutated cell, so concurrent peers converge on the union instead of
 * racing a single slot. They are a SEPARATE FAMILY from `engine.pack.*`, and
 * that separation is the whole point of this file.
 *
 * **Why not fold them into the pack compare.** The pack compare classifies a
 * doc marker with no local counterpart as `newerInDoc`, which read-onlys the
 * document. For prefabs that is right — an unknown prefab means the doc was
 * written by a newer build. For behaviors it is catastrophic: behaviors ship in
 * PLUGINS, so "no local counterpart" is the ordinary state of every document
 * whose author had a plugin this reader does not. Folding them in would brick a
 * document because a plugin is missing — design-008's exact failure shape,
 * which cost us a release to learn.
 *
 * So behaviors get their own compare with the **absent-is-not-newer** rule:
 *   - a locally-unregistered behavior name is IGNORED ENTIRELY (its cells sit
 *     in the doc un-projected and dormant — strata's projection is
 *     name-registry-driven, so they are inert, not corrupt);
 *   - `v > installed` for an INSTALLED behavior triggers per-behavior DORMANCY
 *     (refuse hook delivery — projection is version-blind, so newer-shaped data
 *     WOULD otherwise flow into older hooks), never a doc verdict;
 *   - `v < installed` runs the migration chain.
 *
 * Behavior version state NEVER affects the document's gate verdict. That is a
 * standing guarantee, and the anti-brick test in CI is what keeps it one.
 */
import type { Component, Entity, World } from "@vibecook/strata-ecs";
import { guardedTransaction } from "../guards/guarded-tx";
import type { LiveWriter } from "../guards/live-writer";
import type { AnyBehaviorDef } from "./types";

export const BEHAVIOR_MARKER_PREFIX = "engine.behavior.";

/**
 * Markers carry the STRING `"1"`, not the boolean `engine.pack.*` uses.
 * `readMeta` is the only key-addressed read the durable store offers and it
 * returns strings only, so a boolean marker would be invisible to every reader
 * that is not enumerating the raw Loro map — which mid-session installs cannot
 * do. Presence is still the semantics; the value is never read.
 */
const MARKER_VALUE = "1";

export function behaviorMarkerKey(name: string, version: number): string {
  return `${BEHAVIOR_MARKER_PREFIX}${name}.${version}`;
}

/**
 * How far ABOVE the installed version to probe for a newer marker. There is no
 * key enumeration on an attached store, so dormancy detection is a bounded
 * scan; a document more than this many versions ahead of this build reads as
 * "not newer" and runs normally, which is the same honest failure a doc from
 * the future has always had.
 */
const PROBE_AHEAD = 16;

export interface BehaviorMeta {
  readMeta(key: string): string | undefined;
  metaTransaction(fn: (meta: { get(key: string): unknown; set(key: string, value: string): void }) => void): void;
}

/** The highest marker version present for `name` (0 = never stamped). */
export function docBehaviorVersion(meta: BehaviorMeta, name: string, installed: number): number {
  let highest = 0;
  for (let v = 1; v <= installed + PROBE_AHEAD; v++) {
    if (meta.readMeta(behaviorMarkerKey(name, v)) !== undefined) highest = v;
  }
  return highest;
}

/** Stamp the marker for `version` if it is not already present (write-once). */
export function stampBehaviorMarker(meta: BehaviorMeta, name: string, version: number): void {
  const key = behaviorMarkerKey(name, version);
  if (meta.readMeta(key) !== undefined) return;
  meta.metaTransaction((m) => {
    if (m.get(key) === undefined) m.set(key, MARKER_VALUE);
  });
}

export type BehaviorVerdict =
  | { readonly kind: "ok" }
  /** The doc is at a NEWER version than this build installs — refuse delivery. */
  | { readonly kind: "dormant"; readonly docVersion: number; readonly installed: number }
  /** The doc is OLDER — the chain has work to do. */
  | { readonly kind: "migrate"; readonly from: number; readonly installed: number }
  /** Older, but the chain cannot reach `installed` from there. */
  | { readonly kind: "unreachable"; readonly from: number; readonly installed: number };

export function classifyBehaviorVersion(b: AnyBehaviorDef, docVersion: number): BehaviorVerdict {
  if (docVersion === 0 || docVersion === b.version) return { kind: "ok" };
  if (docVersion > b.version) return { kind: "dormant", docVersion, installed: b.version };
  for (let v = docVersion; v < b.version; v++) {
    if (typeof b.migrate[v] !== "function") {
      return { kind: "unreachable", from: docVersion, installed: b.version };
    }
  }
  return { kind: "migrate", from: docVersion, installed: b.version };
}

export interface MigrateDeps {
  readonly world: World;
  readonly meta: BehaviorMeta;
  /** The doc store, for the one `{undoable: false}` transaction. */
  // biome-ignore lint/suspicious/noExplicitAny: structural — the guarded-tx doc seam.
  readonly store: any;
  readonly liveWriter?: LiveWriter;
  /** Every entity currently carrying the behavior's component. */
  carriers(): readonly Entity[];
}

/**
 * Run `b`'s migrate chain over every carrier, in ONE non-undoable transaction,
 * then stamp the new marker.
 *
 * A SECOND plan+write pass, not a reuse of the M9 prefab runner: that one
 * filters by `PrefabId`, and a behavior rides entities of any kind — its own
 * component is the only thing that identifies its cells.
 *
 * Returns the number of migrated carriers.
 */
export function runBehaviorMigration(b: AnyBehaviorDef, from: number, deps: MigrateDeps): number {
  const c = b.component as Component;
  const carriers = deps.carriers();
  const plan: { e: Entity; value: Record<string, unknown> }[] = [];
  for (const e of carriers) {
    const current = deps.world.get(e, c) as Record<string, unknown> | undefined;
    if (current === undefined) continue;
    let value: Record<string, unknown> = { ...current };
    for (let v = from; v < b.version; v++) {
      const step = b.migrate[v];
      if (typeof step !== "function") break;
      value = { ...value, ...step(value) };
    }
    plan.push({ e, value });
  }
  if (plan.length > 0) {
    guardedTransaction(
      deps.store,
      deps.world,
      (tx) => {
        for (const { e, value } of plan) tx.edit(e).set(c as Component<unknown>, value);
      },
      // Never an undo step: a migration is not something a user did.
      { undoable: false, ...(deps.liveWriter !== undefined ? { live: deps.liveWriter } : {}) },
    );
  }
  // Stamp even when nothing needed migrating — the marker records that THIS
  // build's version is now represented in the document, which is what stops the
  // runner from re-planning on every registration.
  stampBehaviorMarker(deps.meta, b.name, b.version);
  return plan.length;
}
