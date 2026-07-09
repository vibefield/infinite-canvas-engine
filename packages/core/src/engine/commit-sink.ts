/**
 * The commit seam (design-001 §3 gesture protocol × implementation-plan M4/M5).
 *
 * Behaviors end a gesture with ONE commit (design-002 decision 4). Until the
 * durable layer lands (M5), commits are recorded as INTENTS through this seam:
 * the M4 frame traces assert runtime state + commit intents, and M5 swaps in a
 * doc-backed sink that turns an intent into one `guardedTransaction` per
 * gesture (liveness guards re-checked inside the tx via live edges + keyOf —
 * the intent carries the already-liveness-filtered write set, but the doc sink
 * re-guards because the doc is the authority).
 *
 * The seam is deliberately dumb data: no callbacks into behaviors, no partial
 * application — a whole gesture outcome in one value.
 */
import type { Component, Entity } from "@vibecook/strata-ecs";

/** One absolute component write inside a commit (whole-value, design-001 §2). */
export interface CommitWrite {
  readonly entity: Entity;
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous write list; the value is validated against the component schema at apply time
  readonly component: Component<any>;
  readonly value: Record<string, unknown>;
}

/** A structural reparent riding a consume outcome (design-003 §5.5). */
export interface CommitReparent {
  readonly entity: Entity;
  readonly container: Entity;
}

export interface CommitIntent {
  /** Outcome kind — traces assert on it. */
  readonly kind: "move" | "consume" | "resize" | "connect" | "create" | "delete";
  /** The recognizer (or op source) that owned the gesture. */
  readonly gesture: Entity;
  readonly writes: readonly CommitWrite[];
  readonly reparents?: readonly CommitReparent[];
}

export interface CommitSink {
  commit(intent: CommitIntent): void;
}

/** The M4 default: record intents for traces/devtools; commit nothing. */
export function createRecordingCommitSink(): CommitSink & { readonly intents: CommitIntent[] } {
  const intents: CommitIntent[] = [];
  return {
    intents,
    commit(intent) {
      intents.push(intent);
    },
  };
}
