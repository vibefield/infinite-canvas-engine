/**
 * The engine facade — owner of the outer frame (design-002 §1):
 *
 *   step(now):
 *     setFrameInfo        FrameInfo resource — value write, pre-tick
 *     world.sync()        durable + presence drains land; projections place
 *     world.tick(...)     the phase-group pipeline (pipeline.ts)
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
import { setFrameInfo } from "./frame-info";
import { createPipelineRegistry, type PhaseGroup } from "./pipeline";
import { createReflectorRegistry, type ReflectorDef } from "./reflectors";

export type PublishHook = (world: World) => void;

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
}

export interface EngineOpts {
  /** Reflector fault sink (default: console.error, skip this frame). */
  readonly onReflectorFault?: (name: string, err: unknown) => void;
}

export interface Engine {
  readonly world: World;
  /** Register systems into a canonical phase group. Returns a remover. */
  addSystems(group: PhaseGroup, ...systems: readonly AnySystem[]): () => void;
  /** Register a post-notify output reflector (design-002 §5). Returns an unregister. */
  registerReflector(def: ReflectorDef): () => void;
  /** Register a publish-step hook (post-tick, pre-notify presence I/O). Returns a remover. */
  onPublish(hook: PublishHook): () => void;
  /** Run one full frame. `now` in ms (rAF timestamp or a test counter). */
  step(now: number): void;
  /** Arm per-system run/skip + µs collection (idempotent; costs timer calls per system). */
  enableTelemetry(): void;
  /** The most recent completed frame's readout (undefined until telemetry armed + one step). */
  lastFrame(): FrameTelemetry | undefined;
}

export function createEngine(world: World, opts?: EngineOpts): Engine {
  const pipeline = createPipelineRegistry();
  const reflectors = createReflectorRegistry(
    world,
    opts?.onReflectorFault ? { onFault: opts.onReflectorFault } : undefined,
  );
  const publishHooks: PublishHook[] = [];

  let telemetryArmed = false;
  let last: FrameTelemetry | undefined;
  let building: {
    tick: number;
    systems: SystemRunRecord[];
    phaseFlushMicros: Map<string, number>;
  } | null = null;

  return {
    world,

    addSystems(group, ...systems) {
      return pipeline.add(group, ...systems);
    },

    registerReflector(def) {
      return reflectors.register(def);
    },

    onPublish(hook) {
      publishHooks.push(hook);
      return () => {
        const i = publishHooks.indexOf(hook);
        if (i !== -1) publishHooks.splice(i, 1);
      };
    },

    step(now) {
      setFrameInfo(world, now);
      world.sync();
      world.tick(pipeline.assemble());
      for (const hook of publishHooks) hook(world);
      world.reactive.notify();
      reflectors.flushAll();
    },

    enableTelemetry() {
      if (telemetryArmed) return;
      telemetryArmed = true;
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
            // step() overwrites this post-notify — captured lazily below.
            reflectorsFlushed: [],
          };
          building = null;
        },
      });
    },

    lastFrame() {
      if (last === undefined) return undefined;
      // Reflector flush happens after onTickEnd, so splice the registry's
      // latest readout in at read time (same frame: step() is synchronous).
      return { ...last, reflectorsFlushed: reflectors.lastFlushed() };
    },
  };
}
