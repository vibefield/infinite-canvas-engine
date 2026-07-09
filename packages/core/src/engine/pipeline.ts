/**
 * The phase-group pipeline (design-002 §2).
 *
 * Seven canonical GROUPS over eleven strata phases — a strata phase boundary
 * (command-buffer flush) is the only structural settle point, so every stage
 * that must SEE the previous stage's spawns/tags/relations within one frame is
 * a separate strata phase. The `ctl:*` sub-phases are the control sweep's
 * settle points (design-002 decision 2; rev 1's "tail idiom" is dead — the
 * whole system body is iteration-guarded).
 *
 * Registration order within a group is run order; group order is fixed here
 * and is the sole ordering contract (Law: phases/sub-phases only — never
 * registration-time coupling between groups).
 */
import { phase } from "@vibecook/strata-ecs";
import type { Pipeline, System } from "@vibecook/strata-ecs";

/** The eleven strata phases, in run order (design-002 §2 table). */
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
  "cleanup",
] as const;

export type PhaseGroup = (typeof PHASE_GROUPS)[number];

export interface PipelineRegistry {
  /** Append systems to a group (run order = registration order). Returns a remover (HMR). */
  add(group: PhaseGroup, ...systems: readonly System[]): () => void;
  /**
   * The pipeline value for this frame (design-002 §1: "pipeline is a value,
   * rebuilt per frame"). Cached until the registry changes; empty groups are
   * omitted (an empty phase would flush nothing anyway).
   */
  assemble(): Pipeline;
}

export function createPipelineRegistry(): PipelineRegistry {
  const groups = new Map<PhaseGroup, System[]>();
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
