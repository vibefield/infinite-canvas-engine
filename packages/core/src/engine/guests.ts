/**
 * The guest runtime (petition I14 — the literal PA-28 "spine scheduler").
 *
 * A GUEST is frame-cadence work the engine did not write: a plugin's declared
 * system, a host's derived-state job, and (from design-009) every compiled
 * behavior. Guests get a NAMED slot in the frame contract — design-002 §1 as
 * amended 2026-08-15:
 *
 *     setFrameInfo → sync → tick → GUESTS → publish hooks → notify → reflect
 *
 * Guests run BEFORE the publish hooks so derived state has settled by the time
 * presence I/O reads it, and before `notify()` so the same frame reflects their
 * writes. Three properties the engine owes anything it hosts here:
 *
 * 1. **Fault isolation.** A throwing guest is caught, struck, and skipped — it
 *    never kills the loop, its neighbours, or the frame. (Engine systems and
 *    publish hooks keep propagating loudly by design; guests are the untrusted
 *    tier, and the breaker below is what makes hosting them honest.)
 * 2. **The snapshot rule.** `runAll` iterates a snapshot with a liveness check,
 *    so a guest that adds or removes guests mid-run never skips a neighbour —
 *    the bug this same release fixed in the publish-hook and reflector loops.
 *    A guest added during a run starts NEXT frame.
 * 3. **A circuit breaker, named honestly.** A main-thread body cannot be
 *    preempted: by the time we measure, the frame is already spent. What the
 *    breaker guarantees is that no guest hurts the canvas TWICE sustained.
 *
 * GENERATIONS. `make(gen)` builds a per-generation instance; the generation
 * boundary in ICE is `world.reset()` (doc close/switch — the world is reset in
 * place, so systems, observers and this registry all survive while every entity
 * dies). On reset we mark the generation dirty and rebuild at the TOP of the
 * next guest step — never inside the observer emit, where structural writes are
 * illegal and user code has no business running. `gen.signal` aborts when the
 * generation ends or the guest is removed.
 *
 * THE LEDGER IS HOST-INJECTABLE. Downstream (VibeField) an engine is per-doc, so
 * a registry-local ledger would reset on every doc switch and hand chronic
 * offenders a fresh probation forever. `add({ledger})` seeds prior state and
 * `onLedgerChange` reports every transition, so the host persists across
 * generations it owns.
 */
import type { World } from "@vibecook/strata-ecs";
import { devGuardsEnabled } from "../guards/dev";

/** Frame facts a guest may read (FrameInfo, pre-read by the engine). */
export interface GuestFrame {
  readonly dtMs: number;
  readonly tick: number;
  /** Accumulated CLAMPED dt — under-reports across freezes; never accumulate
   *  wall time from it (frame-info.ts). */
  readonly clock: number;
}

export type GuestRun = (frame: GuestFrame) => void;

export interface GuestInstance {
  run: GuestRun;
  dispose?: () => void;
  /**
   * "I still owe visible work." Feeds the frame gate's settle walk, so a
   * freeze taken mid-derive parks only AFTER the guest has caught up — the
   * canvas is never photographed between a structural change and its reflow.
   * A guest with no owed-work notion simply omits it (the frame gate then
   * treats it as quiet, which is the honest default).
   */
  busy?: () => boolean;
}

export interface GuestGeneration {
  readonly world: World;
  /** Aborts at generation teardown (world reset), removal, or engine dispose. */
  readonly signal: AbortSignal;
}

export type GuestFactory = (gen: GuestGeneration) => GuestInstance | GuestRun;

/** The persistable half of a guest's breaker state. */
export interface GuestLedgerRecord {
  /** Cumulative over-budget/fault strikes (never reset by resume — honesty). */
  readonly strikes: number;
  readonly suspended: boolean;
}

export interface GuestSpec {
  /** Stable id — the ledger key, the profiler lane name, the doctor's row. */
  readonly id: string;
  readonly make: GuestFactory;
  /** Per-invocation budget request; the effective budget is
   *  `min(budgetMs, seamCapMs)` — no single guest may claim the whole seam. */
  readonly budgetMs?: number;
  /** RESERVED. Hosted guests run in the publish slot only — and that is now the
   *  settled shape, not a v1 placeholder: M13 reached pipeline cadence through
   *  `addDriven` (behaviors run as pipeline systems and CHARGE this breaker)
   *  instead of widening this field. A wider value would mean a second way to
   *  put foreign code in the tick that `addDriven` already provides. */
  readonly phase?: "publish";
  /** Seed prior breaker state (host-persisted across engine generations). */
  readonly ledger?: GuestLedgerRecord;
}

export interface GuestStatus {
  readonly id: string;
  readonly status: "running" | "suspended" | "failed";
  /** Last invocation, ms. */
  readonly lastMs: number;
  /** p95 over the rolling window, ms. */
  readonly p95Ms: number;
  readonly strikes: number;
  readonly budgetMs: number;
}

/**
 * A guest whose CADENCE its owner drives (design-009 §7): compiled behaviors
 * run as ordinary pipeline systems, in their declared phase, inside the tick —
 * so nothing here can call their bodies. What they still need is everything
 * ELSE a guest gets: one breaker, one ledger, one doctor row, one seam total.
 * That is what this handle is — the breaker, detached from the scheduler.
 */
export interface DrivenGuest {
  /** Breaker verdict. Cheap and never throws — poll it from a system `runIf`. */
  suspended(): boolean;
  /**
   * Run `body` inside this guest's fault domain, ACCRUING its cost into the
   * current frame's charge. Returns false when the guest is suspended (the
   * body did not run) or the body threw (contained).
   *
   * Accrual, not per-call recording, is what makes the budget mean "per frame"
   * for a CHUNKED body: a tick system's body runs once per matching chunk, and
   * recording each chunk as its own invocation would compare a 2ms frame budget
   * against a fraction of the work it was meant to bound. The accrued total is
   * closed as ONE invocation at the guest slot, every frame.
   */
  run(body: () => void): boolean;
  /**
   * Report a fault the caller already CONTAINED — a per-instance hook throw
   * that the delivery loop caught so one bad node cannot kill a 1000-node
   * behavior (BF-D18). It takes the ordinary throw ladder.
   */
  fault(err: unknown): void;
  /** Idempotent. */
  remove(): void;
}

export interface DrivenGuestSpec {
  readonly id: string;
  readonly budgetMs?: number;
  readonly ledger?: GuestLedgerRecord;
  /** Owed-work reporter for the frame gate's settle walk. */
  readonly busy?: () => boolean;
}

export interface GuestRegistry {
  /** Register a guest. Returns a remover (idempotent; disposes the instance). */
  add(spec: GuestSpec): () => void;
  /**
   * Register a guest the registry does NOT call (see {@link DrivenGuest}).
   * Its cost still lands in this frame's seam total, its strikes in the same
   * ledger, and its row in `list()`.
   */
  addDriven(spec: DrivenGuestSpec): DrivenGuest;
  /** Live status for devtools/doctor — never throws, safe to poll. */
  list(): readonly GuestStatus[];
  /** Fires whenever a guest's persistable breaker state changes. */
  onLedgerChange(cb: (id: string, record: GuestLedgerRecord) => void): () => void;
  /** Clear a suspension (the doctor's explicit action). Cumulative strikes
   *  survive; the rolling window is cleared so probation starts fresh. */
  resume(id: string): void;
}

/** The engine-facing half (step drives it; hosts never see these). */
export interface GuestRegistryInternal extends GuestRegistry {
  runAll(frame: GuestFrame): void;
  /** Any live guest reporting owed work — the engine's settle reporter. */
  anyBusy(): boolean;
  dispose(): void;
}

/**
 * Breaker constants (design-009 §12 / door ED-D3). Exported so tests and the
 * downstream doctor cite ONE source rather than re-deriving thresholds.
 */
export const GUEST_BUDGET = {
  /** Default per-invocation budget when a guest declares none. */
  defaultBudgetMs: 2,
  /** The whole guest seam's sustained budget — also the per-guest ceiling. */
  seamCapMs: 8,
  /** Rolling window length, in invocations. */
  window: 120,
  /** Trip: more than this many of the last `window` invocations over budget. */
  overBudgetTrip: 30,
  /** Trip: this many CONSECUTIVE invocations at ≥ `heavyFactor` × budget. */
  consecutiveHeavy: 3,
  heavyFactor: 4,
  /** Trip: this many CONSECUTIVE invocations over `stallMs` (one GC pause or
   *  debugger breakpoint must never suspend — hence 2, not 1). */
  consecutiveStall: 2,
  stallMs: 50,
  /** Trip: this many consecutive throws. */
  consecutiveThrows: 3,
  /** Frames the whole seam may sit over `seamCapMs` before the worst offender
   *  is suspended. */
  seamOverFrames: 3,
} as const;

interface Entry {
  readonly spec: GuestSpec;
  readonly budgetMs: number;
  /** Driven entries have no factory and no instance — their owner calls them. */
  readonly driven: boolean;
  /** Driven entries report owed work directly (there is no instance to ask). */
  readonly busyFn: (() => boolean) | undefined;
  /** ms accrued by `DrivenGuest.run` since the last settle (see the doc there). */
  accruedMs: number;
  accrued: boolean;
  /** Any contained fault since the last settle — the ladder counts frames. */
  faultedThisFrame: boolean;
  instance: GuestInstance | null;
  controller: AbortController | null;
  alive: boolean;
  /** `make` threw — no instance, no runs, reported once. */
  failed: boolean;
  suspended: boolean;
  /** The first invocation of each generation is exempt from TIMING strikes
   *  (module warmup, JIT, first-touch allocation — not a hostile body). */
  warmupPending: boolean;
  /** Rolling durations, ms (bounded by GUEST_BUDGET.window). */
  window: number[];
  overInWindow: number;
  consecutiveHeavy: number;
  consecutiveStall: number;
  consecutiveThrows: number;
  lastMs: number;
  strikes: number;
}

export interface GuestRegistryOpts {
  /**
   * Dev leniency: while true, TIMING strikes log and never suspend (the throw
   * ladder still bites). Wired to `engine.enableTelemetry()` — i.e. devtools
   * attached — so stepping in a debugger cannot suspend a healthy guest.
   */
  readonly lenient?: () => boolean;
  readonly onFault?: (id: string, err: unknown) => void;
  readonly onNotice?: (message: string) => void;
}

export function createGuestRegistry(world: World, opts?: GuestRegistryOpts): GuestRegistryInternal {
  const entries: Entry[] = [];
  let snapshot: Entry[] = [];
  let snapshotDirty = true;
  let generationDirty = false;
  let disposed = false;
  let seamOverFrames = 0;
  const ledgerSubs = new Set<(id: string, record: GuestLedgerRecord) => void>();

  const lenient = opts?.lenient ?? (() => false);
  const onFault =
    opts?.onFault ??
    ((id: string, err: unknown) => {
      console.error(`[ice] guest "${id}" threw — skipped this frame`, err);
    });
  const onNotice =
    opts?.onNotice ??
    ((message: string) => {
      console.warn(`[ice] ${message}`);
    });

  const emitLedger = (e: Entry): void => {
    const record: GuestLedgerRecord = { strikes: e.strikes, suspended: e.suspended };
    for (const cb of ledgerSubs) cb(e.spec.id, record);
  };

  const strike = (e: Entry, reason: string, suspendNow: boolean): void => {
    e.strikes++;
    if (suspendNow && !e.suspended) {
      e.suspended = true;
      disposeInstance(e); // a suspended guest holds no live resources
      onNotice(`guest "${e.spec.id}" SUSPENDED — ${reason}`);
    }
    emitLedger(e);
  };

  const disposeInstance = (e: Entry): void => {
    const inst = e.instance;
    const controller = e.controller;
    e.instance = null;
    e.controller = null;
    // dispose() FIRST, abort SECOND (design-009 §4.3): a teardown that guards
    // on `signal.aborted` — a thoroughly reasonable thing to write — would
    // skip its own cleanup if the signal fired first.
    if (inst?.dispose !== undefined) {
      try {
        inst.dispose();
      } catch (err) {
        // Teardown-sweep discipline: a throwing dispose must not stop the sweep.
        onFault(e.spec.id, err);
      }
    }
    controller?.abort();
  };

  const makeInstance = (e: Entry): void => {
    if (e.driven || e.suspended || !e.alive || disposed) return;
    const controller = new AbortController();
    try {
      const made = e.spec.make({ world, signal: controller.signal });
      e.instance = typeof made === "function" ? { run: made } : made;
      e.controller = controller;
      e.failed = false;
      e.warmupPending = true;
    } catch (err) {
      controller.abort();
      e.instance = null;
      e.controller = null;
      e.failed = true;
      onFault(e.spec.id, err);
    }
  };

  const stopResetWatch = world.observe({
    onReset: () => {
      // Do NOT rebuild here: user factories may write structurally, which is
      // illegal inside an observer emit. Mark and rebuild at the next step's
      // top, before any guest runs against dead handles.
      generationDirty = true;
    },
  });

  const rebuildGeneration = (): void => {
    for (const e of entries) disposeInstance(e);
    for (const e of entries) makeInstance(e);
    // A driven guest keeps no instance to rebuild, but it DOES get a fresh
    // warmup exemption: the first frame of a new generation pays the same
    // first-touch costs (rebuilt caches, cold paths) that exempt hosted guests.
    for (const e of entries) if (e.driven) e.warmupPending = true;
  };

  const p95 = (samples: readonly number[]): number => {
    if (samples.length === 0) return 0;
    const sorted = [...samples].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
    return sorted[idx] ?? 0;
  };

  /** The guest whose suspension buys the seam the most: most strikes, then p95. */
  const worstOffender = (): Entry | null => {
    let worst: Entry | null = null;
    for (const e of snapshot) {
      if (!e.alive || e.suspended || e.instance === null) continue;
      if (worst === null) {
        worst = e;
        continue;
      }
      if (e.overInWindow !== worst.overInWindow) {
        if (e.overInWindow > worst.overInWindow) worst = e;
        continue;
      }
      if (p95(e.window) > p95(worst.window)) worst = e;
    }
    return worst;
  };

  const record = (e: Entry, ms: number): void => {
    e.lastMs = ms;
    e.window.push(ms);
    if (ms > e.budgetMs) e.overInWindow++;
    if (e.window.length > GUEST_BUDGET.window) {
      const dropped = e.window.shift() ?? 0;
      if (dropped > e.budgetMs) e.overInWindow--;
    }

    // Warmup: the first invocation of a generation is measured and reported,
    // but cannot itself strike (module eval + first-touch costs are not a
    // hostile body). Consecutive counters start clean after it.
    if (e.warmupPending) {
      e.warmupPending = false;
      e.consecutiveHeavy = 0;
      e.consecutiveStall = 0;
      return;
    }

    e.consecutiveStall = ms > GUEST_BUDGET.stallMs ? e.consecutiveStall + 1 : 0;
    e.consecutiveHeavy = ms >= e.budgetMs * GUEST_BUDGET.heavyFactor ? e.consecutiveHeavy + 1 : 0;

    const timingTrip =
      e.overInWindow > GUEST_BUDGET.overBudgetTrip ||
      e.consecutiveHeavy >= GUEST_BUDGET.consecutiveHeavy ||
      e.consecutiveStall >= GUEST_BUDGET.consecutiveStall;

    if (!timingTrip) return;

    const why =
      e.consecutiveStall >= GUEST_BUDGET.consecutiveStall
        ? `${e.consecutiveStall} consecutive invocations over ${GUEST_BUDGET.stallMs}ms`
        : e.consecutiveHeavy >= GUEST_BUDGET.consecutiveHeavy
          ? `${e.consecutiveHeavy} consecutive invocations ≥ ${GUEST_BUDGET.heavyFactor}× its ${e.budgetMs}ms budget`
          : `${e.overInWindow} of the last ${e.window.length} invocations over its ${e.budgetMs}ms budget`;

    if (lenient()) {
      // Devtools attached: report, never suspend. Counters reset so one paused
      // breakpoint does not queue a suspension for the moment devtools detach.
      e.consecutiveHeavy = 0;
      e.consecutiveStall = 0;
      e.overInWindow = 0;
      e.window.length = 0;
      onNotice(`guest "${e.spec.id}" over budget (${why}) — not suspended: devtools attached`);
      return;
    }
    strike(e, why, true);
  };

  const makeEntry = (spec: GuestSpec, driven: boolean, busy: (() => boolean) | undefined): Entry => ({
    spec,
    // No guest may claim more than the whole seam.
    budgetMs: Math.max(0, Math.min(spec.budgetMs ?? GUEST_BUDGET.defaultBudgetMs, GUEST_BUDGET.seamCapMs)),
    driven,
    busyFn: busy,
    accruedMs: 0,
    accrued: false,
    faultedThisFrame: false,
    instance: null,
    controller: null,
    alive: true,
    failed: false,
    suspended: spec.ledger?.suspended ?? false,
    warmupPending: true,
    window: [],
    overInWindow: 0,
    consecutiveHeavy: 0,
    consecutiveStall: 0,
    consecutiveThrows: 0,
    lastMs: 0,
    strikes: spec.ledger?.strikes ?? 0,
  });

  return {
    add(spec) {
      if (disposed) throw new Error(`ice: guests.add("${spec.id}") after the registry was disposed`);
      if (spec.phase !== undefined && spec.phase !== "publish") {
        throw new Error(
          `ice: guests.add("${spec.id}") — phase "${spec.phase}" is reserved; v1 hosts the publish slot only (pipeline phases arrive with the behavior framework)`,
        );
      }
      if (entries.some((e) => e.spec.id === spec.id && e.alive)) {
        throw new Error(`ice: guest "${spec.id}" is already registered`);
      }

      const entry = makeEntry(spec, false, undefined);
      entries.push(entry);
      snapshotDirty = true;
      makeInstance(entry);

      return () => {
        if (!entry.alive) return;
        entry.alive = false;
        disposeInstance(entry);
        const i = entries.indexOf(entry);
        if (i !== -1) entries.splice(i, 1);
        snapshotDirty = true;
      };
    },

    addDriven(spec) {
      if (disposed) throw new Error(`ice: guests.addDriven("${spec.id}") after the registry was disposed`);
      if (entries.some((e) => e.spec.id === spec.id && e.alive)) {
        throw new Error(`ice: guest "${spec.id}" is already registered`);
      }
      const entry = makeEntry(
        { id: spec.id, make: DRIVEN_NO_FACTORY, ...(spec.budgetMs !== undefined ? { budgetMs: spec.budgetMs } : {}), ...(spec.ledger !== undefined ? { ledger: spec.ledger } : {}) },
        true,
        spec.busy,
      );
      entries.push(entry);
      snapshotDirty = true;

      return {
        suspended: () => entry.suspended || !entry.alive || disposed,
        run(body) {
          if (entry.suspended || !entry.alive || disposed) return false;
          const t0 = performance.now();
          try {
            body();
            entry.accruedMs += performance.now() - t0;
            entry.accrued = true;
            return true;
          } catch (err) {
            entry.accruedMs += performance.now() - t0;
            entry.accrued = true;
            entry.faultedThisFrame = true;
            entry.consecutiveThrows++;
            onFault(entry.spec.id, err);
            strike(
              entry,
              `${entry.consecutiveThrows} consecutive throws`,
              entry.consecutiveThrows >= GUEST_BUDGET.consecutiveThrows,
            );
            return false;
          }
        },
        fault(err) {
          if (!entry.alive || disposed) return;
          entry.faultedThisFrame = true;
          entry.accrued = true; // ensure the settle pass sees this frame
          entry.consecutiveThrows++;
          onFault(entry.spec.id, err);
          strike(
            entry,
            `${entry.consecutiveThrows} consecutive throws`,
            entry.consecutiveThrows >= GUEST_BUDGET.consecutiveThrows,
          );
        },
        remove() {
          if (!entry.alive) return;
          entry.alive = false;
          const i = entries.indexOf(entry);
          if (i !== -1) entries.splice(i, 1);
          snapshotDirty = true;
        },
      };
    },

    runAll(frame) {
      if (disposed) return;
      if (generationDirty) {
        generationDirty = false;
        rebuildGeneration();
      }
      if (snapshotDirty) {
        snapshot = entries.slice();
        snapshotDirty = false;
      }

      // Close out every driven guest's frame FIRST: they ran during the tick,
      // so their cost is already spent by the time this slot opens, and the
      // seam total below has to include it or the cap it enforces is fiction.
      let seamMs = 0;
      for (const e of snapshot) {
        if (!e.driven || !e.accrued) continue;
        const ms = e.accruedMs;
        e.accruedMs = 0;
        e.accrued = false;
        seamMs += ms;
        // The throw ladder counts FRAMES, not calls: a chunked body runs many
        // times per frame, and clearing the counter on the first clean chunk
        // after a faulting one would mean three consecutive bad frames never
        // add up to three.
        if (!e.faultedThisFrame) e.consecutiveThrows = 0;
        e.faultedThisFrame = false;
        record(e, ms);
      }

      for (const e of snapshot) {
        if (e.driven || !e.alive || e.suspended || e.instance === null) continue;
        const t0 = performance.now();
        try {
          const returned: unknown = e.instance.run(frame);
          // An async body evades BOTH the bracket and the catch: the awaited
          // remainder runs outside the frame with no budget and no fault
          // domain. `(frame) => void` accepts any return type, so only a
          // runtime check catches it. Treated as a FAULT, not a slow frame:
          // under dev guards it suspends immediately (a contract violation is
          // a bug to fix, not a perf blip to ride out); in production it takes
          // the ordinary throw ladder. It is never re-thrown — a guest must not
          // be able to kill the frame, which is the whole point of this tier.
          if (typeof (returned as { then?: unknown } | null | undefined)?.then === "function") {
            const ms = performance.now() - t0;
            seamMs += ms;
            e.consecutiveThrows++;
            onFault(
              e.spec.id,
              new Error(
                `guest "${e.spec.id}" run() returned a thenable — guest bodies MUST be synchronous`,
              ),
            );
            strike(
              e,
              "an async run() body",
              devGuardsEnabled() || e.consecutiveThrows >= GUEST_BUDGET.consecutiveThrows,
            );
            continue;
          }
          const ms = performance.now() - t0;
          seamMs += ms;
          e.consecutiveThrows = 0;
          record(e, ms);
        } catch (err) {
          const ms = performance.now() - t0;
          seamMs += ms;
          e.lastMs = ms;
          e.consecutiveThrows++;
          onFault(e.spec.id, err);
          strike(
            e,
            `${e.consecutiveThrows} consecutive throws`,
            e.consecutiveThrows >= GUEST_BUDGET.consecutiveThrows,
          );
        }
      }

      // The seam cap: the canvas never pays twice for the whole guest tier.
      if (seamMs > GUEST_BUDGET.seamCapMs) {
        seamOverFrames++;
        if (seamOverFrames >= GUEST_BUDGET.seamOverFrames && !lenient()) {
          const worst = worstOffender();
          seamOverFrames = 0;
          if (worst !== null) {
            strike(
              worst,
              `the guest seam ran over ${GUEST_BUDGET.seamCapMs}ms for ${GUEST_BUDGET.seamOverFrames} consecutive frames and this was its worst offender`,
              true,
            );
          }
        }
      } else {
        seamOverFrames = 0;
      }
    },

    anyBusy() {
      for (const e of entries) {
        if (!e.alive || e.suspended) continue;
        const busy = e.driven ? e.busyFn : e.instance?.busy;
        if (busy === undefined) continue;
        try {
          if (busy()) return true;
        } catch (err) {
          // A throwing predicate must not wedge the settle walk at the cap.
          onFault(e.spec.id, err);
        }
      }
      return false;
    },

    list() {
      return entries.map((e) => ({
        id: e.spec.id,
        status: e.suspended ? "suspended" : e.failed ? "failed" : "running",
        lastMs: e.lastMs,
        p95Ms: p95(e.window),
        strikes: e.strikes,
        budgetMs: e.budgetMs,
      }));
    },

    onLedgerChange(cb) {
      ledgerSubs.add(cb);
      return () => {
        ledgerSubs.delete(cb);
      };
    },

    resume(id) {
      const e = entries.find((x) => x.spec.id === id && x.alive);
      if (e === undefined || !e.suspended) return;
      e.suspended = false;
      e.window.length = 0;
      e.overInWindow = 0;
      e.consecutiveHeavy = 0;
      e.consecutiveStall = 0;
      e.consecutiveThrows = 0;
      makeInstance(e); // a fresh instance: the suspended one was disposed
      emitLedger(e);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      stopResetWatch();
      for (const e of entries) {
        e.alive = false;
        disposeInstance(e);
      }
      entries.length = 0;
      snapshot = [];
      ledgerSubs.clear();
    },
  };
}

/** Placeholder factory for driven entries — never called (see `makeInstance`). */
const DRIVEN_NO_FACTORY: GuestFactory = () => {
  throw new Error("ice: internal — a driven guest has no factory");
};
