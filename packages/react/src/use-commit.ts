/**
 * `useCommit` + `useUndoStatus` — the sanctioned widget durable-write path and
 * the undo/redo status subscription (design-005 §2 M6 field amendment,
 * 2026-07-10: "widgets also need a SANCTIONED commit path").
 *
 * A widget commits a prop edit through {@link useCommit}: it resolves the
 * CURRENT doc session (`engine.docs.current()`) and runs a
 * {@link guardedTransaction} against that session's store — one transaction per
 * call, eligibility-guarded, absolute writes only. The session is resolved at
 * CALL time (not hook time) so a widget rendered doc-less that gains a doc later
 * commits correctly without re-mounting.
 */
import { DurableUndoStatus, guardedTransaction, type GuardedTx, type GuardedTxOpts } from "@ice/core";
import { useCallback, useRef, useSyncExternalStore } from "react";
import { useCanvasEngine } from "./engine-context";

/** A durable commit: run `fn` against the current doc session's store, one tx. */
export type Commit = (fn: (tx: GuardedTx) => void, opts?: GuardedTxOpts) => void;

/**
 * The widget commit seam. The returned function throws with guidance when no
 * document is attached (commits need a durable store — call
 * `engine.docs.create()/open()/join()` first).
 */
export function useCommit(): Commit {
  const engine = useCanvasEngine();
  return useCallback(
    (fn, opts) => {
      const session = engine.docs.current();
      if (session === undefined) {
        throw new Error(
          "ice: useCommit — no active document. Attach one with engine.docs.create()/open()/join() before committing widget edits.",
        );
      }
      guardedTransaction(session.store, engine.world, fn, opts);
    },
    [engine],
  );
}

export interface UndoStatus {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

const NO_UNDO: UndoStatus = { canUndo: false, canRedo: false };

/**
 * Undo/redo availability for the current document (drives toolbar
 * disablement) — the design-005 §5 path: the `DurableUndoStatus` RESOURCE
 * (strata plan-undo U2, re-exported through @ice/core) via
 * `observeResource`. A resource subscription is WORLD-level, so it survives
 * document swaps — no remount needed, the earlier onHistoryChange-per-store
 * caveat is gone. Fires at notify(), equality-suppressed; snapshot identity
 * is stable while the flags are unchanged.
 */
export function useUndoStatus(): UndoStatus {
  const engine = useCanvasEngine();
  const last = useRef<UndoStatus>(NO_UNDO);
  const subscribe = useCallback(
    (onChange: () => void) => engine.world.reactive.observeResource(DurableUndoStatus, onChange),
    [engine],
  );
  const getSnapshot = useCallback(() => {
    const status = engine.world.getResource(DurableUndoStatus);
    const canUndo = status?.canUndo ?? false;
    const canRedo = status?.canRedo ?? false;
    if (last.current.canUndo !== canUndo || last.current.canRedo !== canRedo) {
      last.current = { canUndo, canRedo };
    }
    return last.current;
  }, [engine]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
