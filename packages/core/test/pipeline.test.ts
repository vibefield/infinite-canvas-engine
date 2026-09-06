/**
 * The phase-group pipeline, and the `present:infra` amendment (design-002 §2 +
 * design-013 D1, 2026-09-06).
 *
 * D1's whole argument is about ORDER ACROSS A PLUGIN BOUNDARY. The behaviour
 * runtime appends a behaviour's systems to its phase group when the BEHAVIOUR
 * registers, so a pack's kind behaviour registered after boot would run after
 * an infra trio that had registered into `present` at profile install — and its
 * `SurfaceTarget = gpu` on grab would reach residency one frame late. A
 * sub-phase is the fix because a strata phase boundary is the only structural
 * settle point the engine can promise. So the two facts worth pinning are that
 * the group runs after `present`, and that a behaviour cannot enter it.
 */
import { createWorld, defineTickSystem } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import {
  BEHAVIOR_PHASES,
  PHASE_GROUPS,
  createPipelineRegistry,
  defineBehavior,
  p,
} from "../src";

describe("PHASE_GROUPS", () => {
  it("puts present:infra immediately after present, and before cleanup", () => {
    const at = (name: string): number => PHASE_GROUPS.indexOf(name as (typeof PHASE_GROUPS)[number]);
    expect(at("present:infra")).toBe(at("present") + 1);
    expect(at("cleanup")).toBe(at("present:infra") + 1);
    expect(PHASE_GROUPS[0]).toBe("input");
    expect(PHASE_GROUPS[PHASE_GROUPS.length - 1]).toBe("cleanup");
    expect(PHASE_GROUPS).toHaveLength(12);
  });
});

describe("assemble()", () => {
  const noop = () => defineTickSystem(() => {}, { name: "noop" });

  it("emits the groups in PHASE_GROUPS order, whatever order they were added in", () => {
    // Registration order inside a group is run order; ACROSS groups it must be
    // irrelevant, because that is the only ordering contract the engine has.
    const reg = createPipelineRegistry();
    reg.add("cleanup", noop());
    reg.add("present:infra", noop());
    reg.add("present", noop());
    reg.add("input", noop());
    expect(reg.assemble().map((ph) => ph.name)).toEqual([
      "input",
      "present",
      "present:infra",
      "cleanup",
    ]);
  });

  it("omits an EMPTY present:infra — a stratified app pays nothing for it", () => {
    const reg = createPipelineRegistry();
    reg.add("present", noop());
    expect(reg.assemble().map((ph) => ph.name)).toEqual(["present"]);
  });

  it("drops the group again when its last system is removed", () => {
    const reg = createPipelineRegistry();
    reg.add("present", noop());
    const remove = reg.add("present:infra", noop(), noop());
    expect(reg.assemble().map((ph) => ph.name)).toEqual(["present", "present:infra"]);
    remove();
    expect(reg.assemble().map((ph) => ph.name)).toEqual(["present"]);
  });

  it("keeps registration order INSIDE present:infra — Band before Demand", () => {
    const reg = createPipelineRegistry();
    const band = defineTickSystem(() => {}, { name: "surfaceBand" });
    const demand = defineTickSystem(() => {}, { name: "surfaceDemand" });
    reg.add("present:infra", band, demand);
    const group = reg.assemble().find((ph) => ph.name === "present:infra");
    expect(group?.systems).toEqual([band, demand]);
  });
});

describe("behaviours may NOT declare present:infra", () => {
  it("is absent from every store's legal phase table", () => {
    // `present:infra` is engine vocabulary, like `ctl:*`. A behaviour that
    // wants to run before infra declares `present`, which is where it belongs.
    for (const legal of Object.values(BEHAVIOR_PHASES)) {
      expect(legal).not.toContain("present:infra");
    }
    expect(BEHAVIOR_PHASES.runtime).toEqual(["simulate", "derive", "present", "publish"]);
  });

  it("defineBehavior refuses it at definition, naming the legal set", () => {
    expect(() =>
      defineBehavior("pipe:illegalPhase", {
        store: "runtime",
        // The TYPE refuses this too — `BehaviorPhase` never widened. The cast
        // is what a JS caller would reach the runtime with, and the guard is
        // what stops them there.
        phase: "present:infra" as "present",
        schema: { n: p.number({ default: 0 }) },
      }),
    ).toThrow(/present:infra/);
    expect(() =>
      defineBehavior("pipe:illegalPhase2", {
        store: "runtime",
        phase: "present:infra" as "present",
        schema: { n: p.number({ default: 0 }) },
      }),
    ).toThrow(/simulate \| derive \| present \| publish/);
  });
});

describe("the world runs the group", () => {
  it("steps present:infra systems after present ones, in one frame", async () => {
    const { createEngine } = await import("../src");
    const world = createWorld();
    const engine = createEngine(world);
    const order: string[] = [];
    engine.addSystems(
      "present:infra",
      defineTickSystem(() => order.push("infra"), { name: "infra" }),
    );
    engine.addSystems(
      "present",
      defineTickSystem(() => order.push("present"), { name: "present" }),
    );
    engine.addSystems(
      "derive",
      defineTickSystem(() => order.push("derive"), { name: "derive" }),
    );
    engine.step(16);
    expect(order).toEqual(["derive", "present", "infra"]);
  });
});
