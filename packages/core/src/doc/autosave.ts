/**
 * The autosave kit (design-005 §6.6; design-001 §6.5 envelope-at-rest).
 *
 * Persists a `DocSession` to app-owned storage on a debounce (default 800 ms)
 * with a max-wait ceiling (default 10 s), DEFERRED while the user is mid-gesture
 * so a save never captures a half-applied interaction. What it writes is an
 * ENVELOPE (`session.exportEnvelope(savedAt)`) — never raw Loro bytes — so the
 * restore path can read the header and gate/quarantine BEFORE any import.
 *
 * CHANGE-SUBSCRIPTION SURFACE: two triggers, plus an initial arm.
 * - `DurableStore.subscribeOutbound` (durable-store.ts) fires SYNCHRONOUSLY on
 *   each sealed LOCAL commit and never on remote imports.
 * - `DocSession.subscribeRemote` (doc-kit) fires after each successful
 *   `applyRemote`. The original design left remote changes to "whichever peer
 *   originated them" — but that peer persists to ITS storage, not this one's:
 *   a joiner that received edits and closed restored a STALE local backup
 *   (2026-07-13 review). Local autosave must reflect the last-seen document.
 * - Autosave starts DIRTY: state that predates startAutosave() (a seeded or
 *   freshly-joined doc) reaches storage after the first debounce, not only
 *   after the next edit (same review — a seeded doc could close unsaved).
 * No polling — the design's `store.exportSnapshot()` length/frontier poll is
 * the last-resort fallback and is not needed here.
 *
 * Clock and scheduler are injectable so tests are deterministic with NO real
 * timers; the design's `requestIdleCallback` optimization is just an alternate
 * `schedule` an app can pass. `flush()` forces an awaited save; `close()`
 * captures and durably serializes the final revision; `stop()` explicitly
 * discards pending state.
 *
 * RESTORE (`restoreAutosave`): reads storage → `openDocSession`. Incompatible or
 * corrupt bytes NEVER throw and NEVER brick boot (the M5 exit criterion) —
 * they come back as `{ status: "quarantined", reason, bytes }` so the app can
 * stash the bytes aside and start fresh.
 */
import { Any, defineQuery } from "@vibecook/strata-ecs";
import type { World } from "@vibecook/strata-ecs";
import {
  Camera,
  Drag,
  GesturePhases,
  LongPress,
  Pinch,
  Tap,
  WheelPan,
  WheelZoom,
} from "../catalog";
import { openDocSession, type DocSession, type DocSessionOpts } from "./doc-kit";
import type { DocVersionReport } from "./version-gate";

/** The app-owned write side of storage (localStorage, IndexedDB, fs, cloud — WHERE is app-owned). */
export interface AutosaveStorageWrite {
  put(bytes: Uint8Array): Promise<void> | void;
  /** Optional opaque Loro-update journal. `put` replaces the checkpoint and
   * clears its journal; `append` durably extends the current checkpoint. */
  append?(bytes: Uint8Array): Promise<void> | void;
}

/** The app-owned read side of storage (restore path). */
export interface AutosaveStorageRead {
  get(): Promise<Uint8Array | undefined> | Uint8Array | undefined;
}

/** Cancels a scheduled callback (the return of an injected `schedule`). */
export type CancelScheduled = () => void;

export interface AutosaveOpts {
  readonly storage: AutosaveStorageWrite;
  /** The session's world — read for the gesture-deferral gate (never written). */
  readonly world: World;
  /** Quiet-period before a save (default 800 ms). */
  readonly debounceMs?: number;
  /** Hard ceiling from the first unsaved change to a forced save (default 10 s). */
  readonly maxWaitMs?: number;
  /** Wall-clock source; the engine never reads a clock itself (default `Date.now`). */
  readonly now?: () => number;
  /** Timer factory; return a canceller (default `setTimeout`/`clearTimeout`). */
  readonly schedule?: (fn: () => void, ms: number) => CancelScheduled;
  /** Compact after this many journal records (default 64). */
  readonly checkpointEvery?: number;
  /** Compact before the journal exceeds this many bytes (default 4 MiB). */
  readonly maxJournalBytes?: number;
}

export type AutosaveStatus = "idle" | "pending" | "deferred" | "saving" | "saved" | "error";

export interface AutosaveState {
  readonly status: AutosaveStatus;
  /** Wall-clock ms of the last successful save (via the injected `now`), or undefined. */
  readonly lastSavedAt: number | undefined;
  /** True while there are unsaved changes (a timer is armed or deferred). */
  readonly pending: boolean;
}

export interface Autosave {
  /** Force a save of the current document now and await it. Rejects when persistence fails. */
  flush(): Promise<void>;
  /**
   * Capture the final document synchronously, serialize it behind any in-flight
   * write, and stop only after storage acknowledges it. Rejects on failure and
   * may be retried; no document mutation should occur after close begins.
   */
  close(): Promise<void>;
  /** Discard pending state immediately. Idempotent; never use for a normal close. */
  stop(): void;
  /** A pull-based status read for a per-frame HUD (design demo). */
  state(): AutosaveState;
}

const gestureQ = defineQuery([Any(Tap, LongPress, Drag, Pinch, WheelPan, WheelZoom)]);
const P = GesturePhases;

/**
 * Any recognizer NOT in a terminal phase ⇒ a gesture is in flight (mirrors the
 * cleanup.ts terminal definition: Failed/Cancelled/Ended, plus Recognized-Tap).
 * A save while this holds could straddle a gesture's pre-commit runtime edits.
 */
function anyGestureNonTerminal(world: World): boolean {
  let active = false;
  world.query(gestureQ).each((b) => {
    for (const r of b) {
      const e = b.entity(r);
      const terminal =
        world.hasTag(e, P.tags.Failed) ||
        world.hasTag(e, P.tags.Cancelled) ||
        world.hasTag(e, P.tags.Ended) ||
        (world.hasTag(e, P.tags.Recognized) && world.has(e, Tap));
      if (!terminal) {
        active = true;
        return;
      }
    }
  });
  return active;
}

function defaultSchedule(fn: () => void, ms: number): CancelScheduled {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
}

/**
 * Begin autosaving `session` to `opts.storage`. Debounced with a max-wait
 * ceiling, deferred while a gesture (or `Camera.gesturing`) is live. Returns the
 * control surface; call `stop()` at teardown.
 */
export function startAutosave(session: DocSession, opts: AutosaveOpts): Autosave {
  const { storage, world } = opts;
  const debounceMs = opts.debounceMs ?? 800;
  const maxWaitMs = opts.maxWaitMs ?? 10_000;
  const now = opts.now ?? (() => Date.now());
  const schedule = opts.schedule ?? defaultSchedule;
  const checkpointEvery = opts.checkpointEvery ?? 64;
  const maxJournalBytes = opts.maxJournalBytes ?? 4 * 1024 * 1024;

  let dirty = false;
  let firstDirtyAt = 0;
  let cancelTimer: CancelScheduled | undefined;
  let saving = false;
  let lastSavedAt: number | undefined;
  let errored = false;
  let lastWriteError: unknown;
  let stopped = false;
  let closing = false;
  let closeBytes: Uint8Array | undefined;
  let closeSavedAt = 0;
  let closeInFlight: Promise<void> | undefined;
  let forceCheckpoint = true;
  let journalEntries = 0;
  let journalBytes = 0;
  let pendingUpdates: Uint8Array[] = [];
  // The serialized writer: at most ONE storage.put is ever in flight. A save
  // requested while a put runs does NOT start a second put — the running loop
  // re-runs with FRESHLY exported bytes once the current put settles. So two
  // puts never interleave and never land out of order; the newest document
  // always wins (latest-wins), and a slow put can never be clobbered by a
  // faster one started later. `writing` (a flag, not the promise) is the gate:
  // a run that finishes synchronously — e.g. a put that throws before any await
  // — must clear it WITHOUT racing the `writeInFlight = runWrites()` assignment.
  let writing = false;
  let writeInFlight: Promise<void> = Promise.resolve();

  const deferred = (): boolean =>
    world.getResource(Camera)?.gesturing === true || anyGestureNonTerminal(world);

  const clearTimer = (): void => {
    if (cancelTimer !== undefined) {
      cancelTimer();
      cancelTimer = undefined;
    }
  };

  const arm = (): void => {
    clearTimer();
    if (stopped || closing) return;
    const elapsed = now() - firstDirtyAt;
    // Debounce, but never later than the max-wait ceiling from the first change.
    const delay = Math.max(0, Math.min(debounceMs, maxWaitMs - elapsed));
    cancelTimer = schedule(onTimer, delay);
  };

  function onTimer(): void {
    cancelTimer = undefined;
    if (stopped || !dirty) return;
    if (deferred()) {
      // Can't persist mid-gesture; poll again a debounce later. The gesture's own
      // JustEnded commit also re-arms us the moment it lands (subscribeOutbound).
      cancelTimer = schedule(onTimer, debounceMs);
      return;
    }
    requestWrite();
  }

  /**
   * Persist the LATEST document until nothing is dirty. One loop owns the sole
   * `storage.put` call site, so writes are strictly serialized; each iteration
   * re-exports, so a change that arrives mid-put is written on the next pass
   * (latest-wins) rather than lost under a stale in-flight put. This never
   * rejects: a throwing/rejecting put is caught, recorded as status "error",
   * and left dirty for the next change/flush to retry — a persistent failure
   * breaks out instead of spinning.
   */
  async function runWrites(): Promise<void> {
    try {
      while (dirty && !stopped && !closing) {
        const at = now();
        const nextUpdate = pendingUpdates[0];
        // Read the optional appender once per pass, bound to its storage object:
        // a method-shorthand optional does not narrow through the `canAppend`
        // alias, and an unbound extraction would break a `this`-using storage.
        const append = storage.append?.bind(storage);
        const canAppend =
          append !== undefined &&
          !forceCheckpoint &&
          nextUpdate !== undefined &&
          journalEntries < checkpointEvery &&
          journalBytes + nextUpdate.byteLength <= maxJournalBytes;
        if (canAppend) {
          pendingUpdates.shift();
          dirty = pendingUpdates.length > 0;
          saving = true;
          try {
            await append(nextUpdate);
            journalEntries += 1;
            journalBytes += nextUpdate.byteLength;
            lastSavedAt = at;
            errored = false;
            lastWriteError = undefined;
          } catch (err) {
            // The full current snapshot includes this update. A checkpoint is
            // both the recovery path and compaction, including lost-ACK cases.
            forceCheckpoint = true;
            dirty = true;
            lastWriteError = err;
          } finally {
            saving = false;
          }
          continue;
        }

        const bytes = session.exportEnvelope(at);
        pendingUpdates = [];
        dirty = false; // optimistic: a change during the await re-sets it
        saving = true;
        try {
          await storage.put(bytes);
          forceCheckpoint = false;
          journalEntries = 0;
          journalBytes = 0;
          lastSavedAt = at;
          errored = false;
          lastWriteError = undefined;
        } catch (err) {
          errored = true;
          lastWriteError = err;
          forceCheckpoint = true;
          dirty = true; // keep marked so a later change/flush retries
          break; // do not spin on a persistent failure
        } finally {
          saving = false;
        }
      }
    } finally {
      writing = false;
    }
  }

  /** Kick (or join) the serialized writer; returns the in-flight write promise. */
  function requestWrite(): Promise<void> {
    if (stopped || closing) return writeInFlight;
    if (!writing) {
      writing = true;
      writeInFlight = runWrites();
    }
    return writeInFlight;
  }

  const markDirty = (): void => {
    if (stopped || closing) return;
    if (!dirty) firstDirtyAt = now();
    dirty = true;
    arm();
  };

  const journal = (bytes: Uint8Array): void => {
    pendingUpdates.push(bytes.slice());
    markDirty();
  };
  const unsubOutbound = session.store.subscribeOutbound(journal);
  const unsubRemote = session.subscribeRemote(journal);
  // Start dirty: the document AS HANDED IN (seeded, opened, joined) is unsaved
  // state — without this, a doc with no post-start edits never reaches storage.
  markDirty();

  return {
    async flush(): Promise<void> {
      if (stopped) {
        await writeInFlight; // stop() semantics: nothing new persists after stop
        return;
      }
      clearTimer();
      // Force-write the current document even mid-gesture: the doc holds only
      // committed state (the in-flight gesture commits at JustEnded), so every
      // frame is a consistent one to persist. Serialized like every other save —
      // if a put is already running this joins it, and the queued dirty state is
      // written when that put settles. ALWAYS exports — a flush must never be a
      // silent no-op (2026-07-13 review: the beforeunload path relied on it).
      forceCheckpoint = true;
      dirty = true;
      requestWrite();
      await writeInFlight;
      if (lastWriteError !== undefined) throw lastWriteError;
    },
    close(): Promise<void> {
      if (stopped) return writeInFlight;
      if (!closing) {
        closing = true;
        clearTimer();
        unsubOutbound();
        unsubRemote();
        // Capture before the caller can detach/reset the world. This exact
        // envelope is serialized behind the current background write below.
        closeSavedAt = now();
        closeBytes = session.exportEnvelope(closeSavedAt);
        dirty = false;
      }
      if (closeInFlight !== undefined) return closeInFlight;
      const finalBytes = closeBytes;
      if (finalBytes === undefined) return Promise.reject(new Error("ice: autosave close lost its final envelope"));
      closeInFlight = (async () => {
        await writeInFlight;
        try {
          await storage.put(finalBytes);
          lastSavedAt = closeSavedAt;
          lastWriteError = undefined;
          errored = false;
          stopped = true;
        } catch (err) {
          lastWriteError = err;
          errored = true;
          throw err;
        }
      })();
      void closeInFlight.catch(() => {
        // A caller may retry close() after recovering the storage path.
        closeInFlight = undefined;
      });
      return closeInFlight;
    },
    stop(): void {
      if (stopped) return;
      stopped = true;
      clearTimer();
      if (!closing) {
        unsubOutbound();
        unsubRemote();
      }
      // Semantics: a put already in flight runs to completion (a promise cannot
      // be cancelled); the writer loop's `!stopped` guard then DROPS any queued
      // newer write — nothing is persisted after stop() beyond the put already
      // awaiting. Call flush() before stop() to force a final save.
    },
    state(): AutosaveState {
      const status: AutosaveStatus = saving
        ? "saving"
        : errored
          ? "error"
          : dirty
            ? deferred()
              ? "deferred"
              : "pending"
            : lastSavedAt !== undefined
              ? "saved"
              : "idle";
      return { status, lastSavedAt, pending: dirty };
    },
  };
}

/** The outcome of a restore attempt — a tagged union; nothing here ever throws. */
export type RestoreResult =
  | { readonly status: "restored"; readonly session: DocSession }
  | { readonly status: "empty" }
  | {
      readonly status: "quarantined";
      readonly reason: string;
      readonly bytes: Uint8Array;
      readonly report?: DocVersionReport;
    };

/**
 * Load the autosaved document into `world`. Missing/empty storage ⇒
 * `{ status: "empty" }` (the app creates fresh). A successful open ⇒
 * `{ status: "restored", session }` (may be read-only per the version gate).
 * Corrupt or incompatible bytes ⇒ `{ status: "quarantined", reason, bytes }` —
 * NEVER a throw, NEVER a bricked boot (M5 exit criterion): the app stashes the
 * bytes aside and starts fresh.
 */
export async function restoreAutosave(
  world: World,
  storage: AutosaveStorageRead,
  opts?: DocSessionOpts,
): Promise<RestoreResult> {
  const bytes = await storage.get();
  if (bytes === undefined || bytes.length === 0) return { status: "empty" };

  const result = openDocSession(world, bytes, opts ?? {});
  if (result.ok) return { status: "restored", session: result.session };
  return {
    status: "quarantined",
    reason: result.reason,
    bytes,
    ...(result.report !== undefined ? { report: result.report } : {}),
  };
}
