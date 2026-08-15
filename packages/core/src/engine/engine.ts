/**
 * The engine facade — owner of the outer frame (design-002 §1):
 *
 *   step(now):
 *     setFrameInfo        FrameInfo resource — value write, pre-tick
 *     world.sync()        durable + presence drains land; projections place
 *     world.tick(...)     the phase-group pipeline (pipeline.ts)
 *     guests              [2026-08-15, petition I14] the NAMED guest slot:
 *                         plugin/host frame work under a circuit breaker
 *                         (guests.ts). BEFORE publish so derived state has
 *                         settled when presence I/O reads it, and before
 *                         notify so the same frame reflects it. Guests are
 *                         fault-ISOLATED — the one tier here that is.
 *     publish hooks       POST-TICK, PRE-NOTIFY: presence I/O home — eph
 *                         structural ops are illegal for the whole tick, this
 *                         step is theirs; `world.*` is legal here (outside the
 *                         tick). Hooks throw LOUDLY (unlike reflectors) — a
 *                         broken publish pre-notify must not be silently
 *                         half-applied.
 *     notify()            THE settled point — observers fire once per frame
 *     reflect             reflector registry flush (post-notify, output-only)
 *
 * The engine is scheduler-free: `step(now)` is the whole surface, and the DOM
 * package owns the rAF loop (core never touches the platform). Telemetry is
 * opt-in — `world.observe` costs a `performance.now()` pair per system when
 * armed, so benches leave it off.
 */
import type { World } from "@vibecook/strata-ecs";
import type { AnySystem } from "./pipeline";
import { createFrameControl, type FrameControl } from "./frame-control";
import { FrameInfo, setFrameInfo } from "./frame-info";
import { createGuestRegistry, type GuestRegistry, type GuestRegistryInternal } from "./guests";
import { createPipelineRegistry, type PhaseGroup } from "./pipeline";
import { createReflectorRegistry, type ReflectorDef } from "./reflectors";

export type PublishHook = (world: World) => void;

/**
 * One registered publish hook. The `alive` flag is what makes removal exact
 * under the snapshot rule (below): the same function may be registered twice,
 * so liveness cannot be a Set membership test on the function itself.
 */
interface PublishEntry {
  readonly hook: PublishHook;
  alive: boolean;
}

export interface SystemRunRecord {
  readonly phase: string;
  readonly system: string;
  readonly ran: boolean;
  readonly micros: number;
}

/** One frame's run/skip + timing readout (design-002 §4: F1's honest telemetry). */
export interface FrameTelemetry {
  readonly tick: number;
  readonly totalMicros: number;
  readonly systems: readonly SystemRunRecord[];
  readonly phaseFlushMicros: ReadonlyMap<string, number>;
  readonly reflectorsFlushed: readonly string[];
  /**
   * Total reflector-flush cost, µs (post-notify — OUTSIDE the tick, which is
   * why it can never appear in `phaseFlushMicros`: that map is keyed by strata
   * PHASE names and reflect is not a phase. Devtools' "reflect" lane read that
   * map until 2026-08-15 and therefore never reported at all).
   */
  readonly reflectMicros: number;
  /** Per-reflector flush cost, µs, for the same frame (registration order). */
  readonly reflectorMicros: ReadonlyMap<string, number>;
}

export interface EngineOpts {
  /** Reflector fault sink (default: console.error, skip this frame). */
  readonly onReflectorFault?: (name: string, err: unknown) => void;
  /** Guest fault sink (default: console.error). A guest throwing is contained
   *  by the breaker; hosts route this to their own diagnostics. */
  readonly onGuestFault?: (id: string, err: unknown) => void;
  /**
   * Guest breaker notices — suspensions and lenient-mode overruns (default:
   * console.warn). Hosts SHOULD route this: a suspended derived guest means
   * derived state silently stops updating, which reads to a user as a broken
   * document rather than a broken plugin (design-009 §7).
   */
  readonly onGuestNotice?: (message: string) => void;
}

export interface Engine {
  readonly world: World;
  /** Register systems into a canonical phase group. Returns a remover. */
  addSystems(group: PhaseGroup, ...systems: readonly AnySystem[]): () => void;
  /** Register a post-notify output reflector (design-002 §5). Returns an unregister. */
  registerReflector(def: ReflectorDef): () => void;
  /** All registered reflector names (devtools; telemetry-independent). */
  reflectorNames(): readonly string[];
  /** Register a publish-step hook (post-tick, pre-notify presence I/O). Returns a remover. */
  onPublish(hook: PublishHook): () => void;
  /**
   * The guest runtime (petition I14): frame-cadence work the engine did not
   * write — plugin systems, host derived-state jobs, compiled behaviors — run
   * in a named slot between the tick and the publish hooks, each fault-isolated
   * and budgeted by a circuit breaker (guests.ts).
   */
  readonly guests: GuestRegistry;
  /** Run one full frame. `now` in ms (rAF timestamp or a test counter). */
  step(now: number): void;
  /**
   * The frame gate (2026-08-04): freeze/thaw plus the settle protocol a host
   * loop consults before each frame. It lives HERE, next to the step it
   * governs, so every host gets it without a new argument — and so a
   * subsystem holding only the `Engine` (the GL compositor) can report itself
   * busy. `step()` itself stays unconditional: the gate governs the loop, not
   * the primitive, which keeps headless hosts and traces driving frames by
   * hand exactly as before.
   */
  readonly frame: FrameControl;
  /** Arm per-system run/skip + µs collection (idempotent; costs timer calls per system).
   *  Also puts the guest breaker in LENIENT mode — devtools attached means a
   *  debugger breakpoint must not suspend a healthy guest. */
  enableTelemetry(): void;
  /** Tear down guest instances (the facade calls this from `dispose()`). */
  disposeGuests(): void;
  /** The most recent completed frame's readout (undefined until telemetry armed + one step). */
  lastFrame(): FrameTelemetry | undefined;
}

export function createEngine(world: World, opts?: EngineOpts): Engine {
  const pipeline = createPipelineRegistry();
  const reflectors = createReflectorRegistry(
    world,
    opts?.onReflectorFault ? { onFault: opts.onReflectorFault } : undefined,
  );
  const publishHooks: PublishEntry[] = [];
  // The per-frame SNAPSHOT (rebuilt only when the registration set changes, so
  // steady state allocates nothing). Iterating the live array let a hook that
  // removed itself — or an earlier hook — shift the array under the index-based
  // iterator and silently SKIP its neighbour that frame. The contract now:
  // every hook registered at frame start runs exactly once, unless it is
  // unregistered before its turn; a hook registered DURING publish runs next
  // frame (deterministic, and the same rule design-009 gives behaviors).
  let publishSnapshot: PublishEntry[] = [];
  let publishDirty = true;
  const frame = createFrameControl(world);

  let telemetryArmed = false;
  // Telemetry armed ⇒ devtools attached ⇒ the breaker reports timing overruns
  // instead of suspending (the throw ladder still bites). Read through a
  // closure so arming later still reaches the registry.
  const guests: GuestRegistryInternal = createGuestRegistry(world, {
    lenient: () => telemetryArmed,
    ...(opts?.onGuestFault ? { onFault: opts.onGuestFault } : {}),
    ...(opts?.onGuestNotice ? { onNotice: opts.onGuestNotice } : {}),
  });
  // A freeze must not photograph the canvas between a structural change and the
  // guest-owned reflow that answers it (design-002 §1's settle protocol).
  frame.settleWhile("guests", () => guests.anyBusy());
  let last: FrameTelemetry | undefined;
  let building: {
    tick: number;
    systems: SystemRunRecord[];
    phaseFlushMicros: Map<string, number>;
  } | null = null;

  return {
    world,
    frame,
    guests,

    addSystems(group, ...systems) {
      return pipeline.add(group, ...systems);
    },

    reflectorNames() {
      return reflectors.names();
    },
    registerReflector(def) {
      return reflectors.register(def);
    },

    onPublish(hook) {
      const entry: PublishEntry = { hook, alive: true };
      publishHooks.push(entry);
      publishDirty = true;
      return () => {
        if (!entry.alive) return;
        entry.alive = false;
        const i = publishHooks.indexOf(entry);
        if (i !== -1) publishHooks.splice(i, 1);
        publishDirty = true;
      };
    },

    step(now) {
      setFrameInfo(world, now);
      world.sync();
      world.tick(pipeline.assemble());
      const info = world.getResource(FrameInfo);
      guests.runAll({
        dtMs: info?.dt ?? 0,
        tick: info?.tick ?? 0,
        clock: info?.clock ?? 0,
      });
      if (publishDirty) {
        publishSnapshot = publishHooks.slice();
        publishDirty = false;
      }
      for (const entry of publishSnapshot) {
        if (entry.alive) entry.hook(world);
      }
      world.reactive.notify();
      reflectors.flushAll();
    },

    enableTelemetry() {
      if (telemetryArmed) return;
      telemetryArmed = true;
      reflectors.armTelemetry();
      world.observe({
        onTickStart(tick) {
          building = { tick, systems: [], phaseFlushMicros: new Map() };
        },
        onSystemRun(phaseName, system, ran, micros) {
          building?.systems.push({ phase: phaseName, system, ran, micros });
        },
        onPhaseFlush(phaseName, micros) {
          building?.phaseFlushMicros.set(phaseName, micros);
        },
        onTickEnd(tick, micros) {
          if (building === null || building.tick !== tick) return;
          last = {
            tick,
            totalMicros: micros,
            systems: building.systems,
            phaseFlushMicros: building.phaseFlushMicros,
            // step() overwrites these post-notify — captured lazily below.
            reflectorsFlushed: [],
            reflectMicros: 0,
            reflectorMicros: new Map(),
          };
          building = null;
        },
      });
    },

    disposeGuests() {
      guests.dispose();
    },

    lastFrame() {
      if (last === undefined) return undefined;
      // Reflector flush happens after onTickEnd, so splice the registry's
      // latest readout in at read time (same frame: step() is synchronous).
      return {
        ...last,
        reflectorsFlushed: reflectors.lastFlushed(),
        reflectMicros: reflectors.lastFlushMicros(),
        reflectorMicros: reflectors.lastFlushDetail(),
      };
    },
  };
}
