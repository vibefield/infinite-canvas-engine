/**
 * setWidgetProps — the validated widget UPDATE op (2026-07-13 review finding:
 * spawn ran every prop through its Standard Schema, but the update path — raw
 * `useCommit` writes — bypassed bounds/enum/json-shape checks entirely).
 * Mirrors spawn semantics: unknown props throw, invalid values throw BEFORE
 * any write, json values shape-validate then ride their string cell, and one
 * call = one whole-group transaction = one undo step.
 */
import { describe, expect, it } from "vitest";
import { createWorld } from "@vibecook/strata-ecs";
import { createDocSession, defineWidget, p, setWidgetProps, spawnWidget, widgets } from "../src";

const GAUGE = "setprops:gauge";
const gauge =
  widgets.get(GAUGE) ??
  defineWidget({
    type: GAUGE,
    surface: "dom",
    component: {},
    props: {
      level: p.number({ default: 1, min: 0, max: 10 }),
      mode: p.enum(["auto", "manual"], { default: "auto" }),
      tags: p.json(p.array({ kind: "string" }), { default: [] }),
    },
  });

const group = (() => {
  const g = gauge.groups[0];
  if (g === undefined) throw new Error("ice test: gauge widget has no groups");
  return g;
})();

function rig() {
  const world = createWorld();
  const session = createDocSession(world);
  const entity = spawnWidget(session.store, world, GAUGE, { x: 0, y: 0 });
  world.sync();
  return { world, session, entity };
}

describe("setWidgetProps: the update path enforces the prop schema", () => {
  it("valid updates land as ONE whole-group write (one undo step), json serialized", () => {
    const { world, session, entity } = rig();
    setWidgetProps(session.store, world, entity, { level: 7, mode: "manual", tags: ["a", "b"] });
    world.sync();
    const cell = world.get(entity, group.component) as { level: number; mode: string; tags: string };
    expect(cell.level).toBe(7);
    expect(cell.mode).toBe("manual");
    expect(cell.tags).toBe('["a","b"]'); // json rides its string cell

    expect(session.store.undo()).toBe(true); // ONE step reverts the whole update
    world.sync();
    const back = world.get(entity, group.component) as { level: number; mode: string };
    expect(back.level).toBe(1);
    expect(back.mode).toBe("auto");
  });

  it("out-of-bounds numbers, bad enums, and wrong-shape json throw BEFORE any write", () => {
    const { world, session, entity } = rig();
    expect(() => setWidgetProps(session.store, world, entity, { level: 11 })).toThrow(/max 10/);
    expect(() => setWidgetProps(session.store, world, entity, { mode: "turbo" })).toThrow(/expected one of/);
    expect(() => setWidgetProps(session.store, world, entity, { tags: [1, 2] })).toThrow(/expected string/);
    // A mixed update with one bad value writes NOTHING (validate-before-tx).
    expect(() => setWidgetProps(session.store, world, entity, { level: 3, mode: "turbo" })).toThrow();
    world.sync();
    const cell = world.get(entity, group.component) as { level: number };
    expect(cell.level).toBe(1); // untouched
  });

  it("unknown props and non-widget entities throw", () => {
    const { world, session, entity } = rig();
    expect(() => setWidgetProps(session.store, world, entity, { nope: 1 })).toThrow(/unknown prop/);
    const plain = world.spawn({});
    expect(() => setWidgetProps(session.store, world, plain, { level: 2 })).toThrow(/not a defined widget/);
  });
});
