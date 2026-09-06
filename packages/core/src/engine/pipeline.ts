/**
 * The phase-group pipeline (design-002 §2).
 *
 * Seven canonical GROUPS over twelve strata phases — a strata phase boundary
 * (command-buffer flush) is the only structural settle point, so every stage
 * that must SEE the previous stage's spawns/tags/relations within one frame is
 * a separate strata phase. The `ctl:*` sub-phases are the control sweep's
 * settle points (design-002 decision 2; rev 1's "tail idiom" is dead — the
 * whole system body is iteration-guarded).
 *
 * Registration order within a group is run order; group order is fixed here
 * and is the sole ordering contract (Law: phases/sub-phases only — never
 * registration-time coupling between groups).
 *
 * ── `present:infra` — design-002 §2 amendment, 2026-09-06 (design-013 D1) ──
 * ERRATUM to the paragraph above, which said ELEVEN phases: it is twelve.
 *
 * design-013 §6 orders the present sub-phase as behaviours → Band → Demand →
 * Residency: the kind's behaviour chooses a target, and infra then clamps,
 * bands and allocates from that choice. But the behaviour runtime appends a
 * behaviour's systems to its phase group WHEN THE BEHAVIOUR REGISTERS
 * (`behavior/runtime.ts`, `installExecution → engine.addSystems(phase, …)`), so
 * a pack's kind behaviour registered after boot would run AFTER an infra trio
 * that had registered into `present` at profile install. Its `SurfaceTarget =
 * gpu` on grab would reach Residency one frame late and the card would draw
 * plate-only for a frame — the "absent for a frame" class, and silent.
 *
 * Registration order within a group is not a contract the engine can hold
 * across a plugin boundary. A sub-phase is: it is a real strata phase boundary,
 * the same settle point the `ctl:*` groups exist to give the control sweep. So
 * the infra trio gets its own group after `present`, and the order holds no
 * matter when a behaviour shows up.
 *
 * `BehaviorPhase` (behavior/types.ts) is deliberately UNCHANGED, and its
 * validation table must not admit this group: `present:infra` is engine
 * vocabulary, like `ctl:*`, `input` and `react`. A behaviour that wants to run
 * before infra declares `present`, which is where it already belongs. An empty
 * group is omitted by `assemble()` below, so a stratified app — which installs
 * no infra — pays nothing for its existence.
 */
import { phase } from "@vibecook/strata-ecs";
import type { Pipeline, System, TickSystem } from "@vibecook/strata-ecs";

/** Either system form (strata 0.5.0): chunk-bodied or once-per-dispatch tick. */
export type AnySystem = System | TickSystem;

/** The twelve strata phases, in run order (design-002 §2 table + the D1 amendment). */
export const PHASE_GROUPS = [
  "input",
  "react",
  "ctl:spawn",
  "ctl:recognize",
  "ctl:arbitrate",
  "ctl:claim",
  "ctl:behave",
  "simulate",
  "derive",
  "present",
  // The surface infra trio (Band → Demand → Residency), after every kind
  // behaviour has spoken. Engine vocabulary: behaviours may not declare it.
  "present:infra",
  "cleanup",
] as const;

export type PhaseGroup = (typeof PHASE_GROUPS)[number];

export interface PipelineRegistry {
  /** Append systems to a group (run order = registration order). Returns a remover (HMR). */
  add(group: PhaseGroup, ...systems: readonly AnySystem[]): () => void;
  /**
   * The pipeline value for this frame (design-002 §1: "pipeline is a value,
   * rebuilt per frame"). Cached until the registry changes; empty groups are
   * omitted (an empty phase would flush nothing anyway).
   */
  assemble(): Pipeline;
}

export function createPipelineRegistry(): PipelineRegistry {
  const groups = new Map<PhaseGroup, AnySystem[]>();
  let cached: Pipeline | undefined;

  return {
    add(group, ...systems) {
      let list = groups.get(group);
      if (list === undefined) {
        list = [];
        groups.set(group, list);
      }
      list.push(...systems);
      cached = undefined;
      return () => {
        const current = groups.get(group);
        if (current === undefined) return;
        for (const s of systems) {
          const i = current.indexOf(s);
          if (i !== -1) current.splice(i, 1);
        }
        cached = undefined;
      };
    },

    assemble() {
      if (cached === undefined) {
        const phases = [];
        for (const name of PHASE_GROUPS) {
          const systems = groups.get(name);
          if (systems !== undefined && systems.length > 0) phases.push(phase(name, [...systems]));
        }
        cached = phases;
      }
      return cached;
    },
  };
}
