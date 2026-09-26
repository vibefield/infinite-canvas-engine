/**
 * The phase-group pipeline (design-002 §2): eleven groups in a fixed order, registration order
 * inside a group, empty groups omitted. The `present:infra` twelfth group (design-013 D1) left at
 * design-015 D5b with the surface infra trio it was made for; the facts worth pinning are that the
 * list is design-002's again and that a behaviour still cannot name a phase outside its store's
 * legal table.
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
  it("is design-002 §2's eleven, input first, present then cleanup last", () => {
    const at = (name: string): number => PHASE_GROUPS.indexOf(name as (typeof PHASE_GROUPS)[number]);
    expect(at("cleanup")).toBe(at("present") + 1);
    expect(PHASE_GROUPS[0]).toBe("input");
    expect(PHASE_GROUPS[PHASE_GROUPS.length - 1]).toBe("cleanup");
    expect(PHASE_GROUPS).toHaveLength(11);
    expect(PHASE_GROUPS).not.toContain("present:infra");
  });
});

describe("assemble()", () => {
  const noop = () => defineTickSystem(() => {}, { name: "noop" });

  it("emits the groups in PHASE_GROUPS order, whatever order they were added in", () => {
    // Registration order inside a group is run order; ACROSS groups it must be
    // irrelevant, because that is the only ordering contract the engine has.
    const reg = createPipelineRegistry();
    reg.add("cleanup", noop());
    reg.add("present", noop());
    reg.add("derive", noop());
    reg.add("input", noop());
    expect(reg.assemble().map((ph) => ph.name)).toEqual(["input", "derive", "present", "cleanup"]);
  });

  it("omits an EMPTY group — an app pays nothing for a phase it does not use", () => {
    const reg = createPipelineRegistry();
    reg.add("present", noop());
    expect(reg.assemble().map((ph) => ph.name)).toEqual(["present"]);
  });

  it("drops the group again when its last system is removed", () => {
    const reg = createPipelineRegistry();
    reg.add("present", noop());
    const remove = reg.add("cleanup", noop(), noop());
    expect(reg.assemble().map((ph) => ph.name)).toEqual(["present", "cleanup"]);
    remove();
    expect(reg.assemble().map((ph) => ph.name)).toEqual(["present"]);
  });

  it("keeps registration order INSIDE a group", () => {
    const reg = createPipelineRegistry();
    const first = defineTickSystem(() => {}, { name: "first" });
    const second = defineTickSystem(() => {}, { name: "second" });
    reg.add("present", first, second);
    const group = reg.assemble().find((ph) => ph.name === "present");
    expect(group?.systems).toEqual([first, second]);
  });
});

describe("behaviours may NOT declare a phase outside their store's table", () => {
  it("the runtime table is the four design-009 phases", () => {
    for (const legal of Object.values(BEHAVIOR_PHASES)) {
      expect(legal).not.toContain("cleanup");
    }
    expect(BEHAVIOR_PHASES.runtime).toEqual(["simulate", "derive", "present", "publish"]);
  });

  it("defineBehavior refuses an engine-only phase at definition, naming the legal set", () => {
    expect(() =>
      defineBehavior("pipe:illegalPhase", {
        store: "runtime",
        // The TYPE refuses this too — `BehaviorPhase` never widened. The cast
        // is what a JS caller would reach the runtime with, and the guard is
        // what stops them there.
        phase: "cleanup" as "present",
        schema: { n: p.number({ default: 0 }) },
      }),
    ).toThrow(/cleanup/);
    expect(() =>
      defineBehavior("pipe:illegalPhase2", {
        store: "runtime",
        phase: "cleanup" as "present",
        schema: { n: p.number({ default: 0 }) },
      }),
    ).toThrow(/simulate \| derive \| present \| publish/);
  });
});

describe("the world runs the groups in order", () => {
  it("steps derive, then present, then cleanup, in one frame", async () => {
    const { createEngine } = await import("../src");
    const world = createWorld();
    const engine = createEngine(world);
    const order: string[] = [];
    engine.addSystems(
      "cleanup",
      defineTickSystem(() => order.push("cleanup"), { name: "cleanup" }),
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
    expect(order).toEqual(["derive", "present", "cleanup"]);
  });
});
