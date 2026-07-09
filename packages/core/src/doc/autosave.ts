/**
 * The autosave kit (design-005 §6.6; design-001 §6.5 envelope-at-rest).
 *
 * Persists a `DocSession` to app-owned storage on a debounce (default 800 ms)
 * with a max-wait ceiling (default 10 s), DEFERRED while the user is mid-gesture
 * so a save never captures a half-applied interaction. What it writes is an
 * ENVELOPE (`session.exportEnvelope(savedAt)`) — never raw Loro bytes — so the
 * restore path can read the header and gate/quarantine BEFORE any import.
 *
 * CHANGE-SUBSCRIPTION SURFACE (the one this kit rides): `DurableStore`'s
 * `subscribeOutbound(fn: (bytes) => void): Unsubscribe` (durable-store.ts) fires
 * SYNCHRONOUSLY on each sealed LOCAL commit and NOT on remote imports
 * (`onLocalBatch` early-returns on `origin !== "local"`). That is exactly the
 * autosave trigger: a peer persists what it authored; remote changes are
 * persisted by whichever peer originated them (its own local commit fires its
 * own autosave). No polling — the design's `store.exportSnapshot()` length/
 * frontier poll is the last-resort fallback and is not needed here.
 *
 * Clock and scheduler are injectable so tests are deterministic with NO real
 * timers; the design's `requestIdleCallback` optimization is just an alternate
 * `schedule` an app can pass. `flush()` forces a synchronous save (the
 * beforeunload path); `stop()` unsubscribes and cancels the timer.
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
  /** Force a save of the current document now and await it (beforeunload / explicit save). */
  flush(): Promise<void>;
  /** Unsubscribe and cancel any pending timer. Idempotent. */
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

  let dirty = false;
  let firstDirtyAt = 0;
  let cancelTimer: CancelScheduled | undefined;
  let saving = false;
  let inflight: Promise<void> = Promise.resolve();
  let lastSavedAt: number | undefined;
  let errored = false;
  let stopped = false;

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
    if (stopped) return;
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
    void save();
  }

  function save(): Promise<void> {
    if (!dirty) return inflight;
    dirty = false;
    saving = true;
    const at = now();
    const bytes = session.exportEnvelope(at);
    const p = (async (): Promise<void> => {
      try {
        await storage.put(bytes);
        lastSavedAt = at;
        errored = false;
      } catch (err) {
        errored = true;
        dirty = true; // keep the doc marked so a later change or flush retries
        throw err;
      } finally {
        saving = false;
      }
    })();
    inflight = p.catch(() => undefined); // swallow for the shared awaiter; callers of save() see the throw
    return p;
  }

  const markDirty = (): void => {
    if (stopped) return;
    if (!dirty) firstDirtyAt = now();
    dirty = true;
    arm();
  };

  const unsub = session.store.subscribeOutbound(() => markDirty());

  return {
    async flush(): Promise<void> {
      clearTimer();
      // Force-write the current document even mid-gesture: the doc holds only
      // committed state (the in-flight gesture commits at JustEnded), so every
      // frame is a consistent one to persist.
      if (dirty) {
        await save().catch(() => undefined);
      }
      await inflight;
    },
    stop(): void {
      if (stopped) return;
      stopped = true;
      clearTimer();
      unsub();
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
