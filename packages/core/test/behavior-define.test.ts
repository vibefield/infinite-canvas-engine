/**
 * `defineBehavior` + the compiler (design-009 §4.1, §7 — M13a exits).
 *
 * The compiler is the novel surface and the review broke its access derivation
 * twice, so these traces pin the SHAPE it produces — the SPLIT, the reads
 * partition, the collector attestation — not just the fact that it produced
 * something.
 *
 * Behavior names are file-unique ("bd:*"): strata's schema registry has no
 * public reset, so a name defined here must not collide with another file's.
 */
import { createWorld, field } from "@vibecook/strata-ecs";
import type { Component, Tag } from "@vibecook/strata-ecs";
import { afterEach, describe, expect, it } from "vitest";
import { compileBehavior, partitionReads, type BehaviorSystemHooks } from "../src/behavior/compile";
import { __resetBehaviorsForTests, defineBehavior } from "../src/behavior/define-behavior";
import { Culled, Position } from "../src/catalog";
import { defineComponent, defineRelation, defineResource, defineTag, schemaMeta } from "../src/schema/meta";
import { definePrefab, init, __resetPrefabsForTests } from "../src/schema/prefab";
import { p } from "../src/widget/props";

const Glow = defineComponent("bdGlow", { v: field("f64", { default: 0 }) });
const Flagged = defineTag("bdFlagged");
const Parented = defineRelation("bdParented", { ordered: true });
const Weather = defineResource("bdWeather", { t: field("f64", { default: 0 }) });

/** Inert hook set — the compiler only needs the shape, never the behavior. */
const NO_HOOKS: BehaviorSystemHooks = {
  shouldDeliver: () => false,
  deliver: () => {},
  shouldTick: () => false,
  tickChunk: () => {},
  charge: () => true,
  suspended: () => false,
  onSuspendedFrame: () => {},
};

afterEach(() => {
  __resetBehaviorsForTests();
});

describe("definition-time validation (§4.1)", () => {
  it("requires a <namespace>:<name>", () => {
    for (const bad of ["nocolon", ":leading", "trailing:", "a:b:c", "with space:x"]) {
      expect(() => defineBehavior(bad, { store: "runtime" })).toThrow(/namespace/);
    }
    expect(() => defineBehavior("bd.ok:name-1", { store: "runtime" })).not.toThrow();
  });

  it("refuses durable-only keys on non-durable behaviors", () => {
    expect(() => defineBehavior("bd:d1", { store: "runtime", derived: true } as never)).toThrow(/durable-only/);
    expect(() => defineBehavior("bd:d2", { store: "ephemeral", version: 2 } as never)).toThrow(/durable-only/);
    expect(() => defineBehavior("bd:d3", { store: "runtime", migrate: {} } as never)).toThrow(/durable-only/);
  });

  it("refuses deriveDuringGesture without derived — it opts out of a rule that would not apply", () => {
    expect(() =>
      defineBehavior("bd:dg", { store: "durable", deriveDuringGesture: true } as never),
    ).toThrow(/suppression/);
  });

  it("holds durable to derive-only, and states why", () => {
    expect(() => defineBehavior("bd:ph1", { store: "durable", phase: "simulate" })).toThrow(
      /settled-input phase/,
    );
    expect(() => defineBehavior("bd:ph2", { store: "ephemeral", phase: "derive" })).toThrow(/not legal/);
    expect(() => defineBehavior("bd:ph3", { store: "runtime", phase: "present" })).not.toThrow();
  });

  it("refuses reads: and writes: entries that are not registered schema", () => {
    const stranger = { id: 999, name: "stranger" } as unknown as Component;
    expect(() => defineBehavior("bd:r1", { store: "runtime", reads: [stranger] })).toThrow(/reads:/);
    expect(() => defineBehavior("bd:r2", { store: "runtime", writes: [stranger] })).toThrow(/writes:/);
    // A tag is a legal READ but never a value-write target.
    expect(() => defineBehavior("bd:r3", { store: "runtime", writes: [Flagged as unknown as Component] })).toThrow(
      /writes:/,
    );
  });

  it("refuses writes: on an ephemeral behavior — it has no cross-entity vocabulary", () => {
    expect(() => defineBehavior("bd:eph1", { store: "ephemeral", writes: [Glow] })).toThrow(/OWN facet/);
  });

  it("refuses a non-p.* schema field and an unbounded p.json", () => {
    expect(() => defineBehavior("bd:s1", { store: "runtime", schema: { n: 3 as never } })).toThrow(/p\.\* spec/);
    expect(() =>
      defineBehavior("bd:s2", { store: "runtime", schema: { j: { kind: "json" } as never } }),
    ).toThrow(/BOUNDED/);
  });

  it("refuses a hook that is not a function, and tick.while without on.tick", () => {
    expect(() => defineBehavior("bd:h1", { store: "runtime", on: { init: 1 as never } })).toThrow(/not a function/);
    expect(() => defineBehavior("bd:h2", { store: "runtime", tick: { while: "visible" } })).toThrow(/no on\.tick/);
  });

  it("refuses a gapped migrate chain (unlike widgets, which only warn)", () => {
    expect(() =>
      defineBehavior("bd:m1", { store: "durable", version: 3, migrate: { 2: (x) => x } }),
    ).toThrow(/gaps at fromVersion\(s\) \[1\]/);
    expect(() =>
      defineBehavior("bd:m2", { store: "durable", version: 2, migrate: { 1: (x) => x, 5: (x) => x } }),
    ).toThrow(/outside the migratable range/);
  });
});

describe("the handle", () => {
  it("generates a namespaced component and every field's default", () => {
    const B = defineBehavior("bd:handle", {
      store: "runtime",
      schema: {
        n: p.number({ default: 7 }),
        s: p.string(),
        flag: p.boolean({ default: true }),
        mode: p.enum(["a", "b"], { default: "b" }),
        ref: p.entityKey(),
      },
    });
    expect(schemaMeta.component(B.component as Component)?.name).toBe("behavior:bd:handle");
    expect(B.defaults).toEqual({ n: 7, s: "", flag: true, mode: "b", ref: "" });
    expect(B.with({ n: 9 })).toEqual({ behavior: B, data: { n: 9 } });
  });

  it("reuses the handle on a same-shape re-definition and adopts the NEW hooks", () => {
    const first = () => {};
    const second = () => {};
    const A = defineBehavior("bd:redefine", { store: "runtime", schema: { n: p.number() }, on: { init: first } });
    const B = defineBehavior("bd:redefine", { store: "runtime", schema: { n: p.number() }, on: { init: second } });
    // Same handle — its component, collector and live instances stay valid...
    expect(B).toBe(A);
    // ...but a hot reload must not leave yesterday's code running.
    expect(B.on.init).toBe(second);
  });

  it("throws when the same name is re-declared with a different shape", () => {
    defineBehavior("bd:collide", { store: "runtime", schema: { n: p.number() } });
    expect(() => defineBehavior("bd:collide", { store: "runtime", schema: { n: p.string() } })).toThrow(
      /DIFFERENT shape/,
    );
    expect(() => defineBehavior("bd:collide", { store: "durable", schema: { n: p.number() } })).toThrow(
      /DIFFERENT shape/,
    );
  });
});

describe("the SPLIT rule (BF-D16/BF-D17)", () => {
  it("compiles ONE system when there is no tick hook", () => {
    const B = defineBehavior("bd:nosplit", {
      store: "runtime",
      writes: [Glow],
      on: { changed: () => {} },
    });
    const c = compileBehavior(B, NO_HOOKS);
    expect(c.systems).toHaveLength(1);
    expect(c.tick).toBeUndefined();
    expect(c.delivery.name).toBe("behavior:bd:nosplit:deliver");
  });

  it("compiles TWO when it ticks — delivery carries every write, tick carries own ONLY", () => {
    const B = defineBehavior("bd:split", {
      store: "runtime",
      writes: [Glow],
      on: { changed: () => {}, tick: () => {} },
    });
    const c = compileBehavior(B, NO_HOOKS);
    expect(c.systems).toHaveLength(2);
    expect(c.delivery.access?.write).toEqual([B.component, Glow]);
    // The whole point: a ticking system carrying broad declared writes would
    // blanket-stamp them every frame and wake every downstream observer.
    expect(c.tickAccess?.write).toEqual([B.component]);
    expect(c.tick?.name).toBe("behavior:bd:split:tick");
  });

  it("declares the two co-writers of the own component order-independent", () => {
    const B = defineBehavior("bd:orderind", { store: "runtime", on: { tick: () => {} } });
    const c = compileBehavior(B, NO_HOOKS);
    expect(c.delivery.access?.orderIndependent).toEqual([B.component]);
    expect(c.tickAccess?.orderIndependent).toEqual([B.component]);
  });

  it("a non-ticking behavior makes no attestation at all", () => {
    const B = defineBehavior("bd:noattest", { store: "runtime", on: { changed: () => {} } });
    const c = compileBehavior(B, NO_HOOKS);
    expect(c.delivery.access?.orderIndependent).toBeUndefined();
  });
});

describe("the reads partition (the id-space trap)", () => {
  it("routes each read KIND to its own mechanism", () => {
    const Other = defineBehavior("bd:other", { store: "runtime", schema: { n: p.number() } });
    const B = defineBehavior("bd:partition", {
      store: "runtime",
      reads: [Glow, Flagged, Parented, Weather, Other],
    });
    const parts = partitionReads(B);
    expect(parts.components).toEqual([Glow, Other.component]);
    expect(parts.tags).toEqual([Flagged]);
    expect(parts.relations).toEqual([Parented]);
    expect(parts.resources).toEqual([Weather]);
  });

  it("keeps TAGS out of access.read — ids are dense per KIND, so a tag id would whitelist a component", () => {
    const B = defineBehavior("bd:tagpartition", { store: "runtime", reads: [Glow, Flagged] });
    const c = compileBehavior(B, NO_HOOKS);
    expect(c.deliveryAccess.read).toEqual([Glow]);
    expect(c.deliveryAccess.read).not.toContain(Flagged as unknown as Component);
    // The tag still reaches the COLLECTOR, which is components-and-tags aware.
    expect(c.collect.tags).toEqual([Flagged]);
  });

  it("attests coarse:false on every framework collector", () => {
    const B = defineBehavior("bd:coarse", { store: "runtime", reads: [Glow] });
    const c = compileBehavior(B, NO_HOOKS);
    expect(c.collect.coarse).toBe(false);
    expect(c.collect.components?.[0]).toBe(B.component);
  });

  it("does not repeat a written component in the read declaration", () => {
    const B = defineBehavior("bd:readwrite", { store: "runtime", reads: [Glow], writes: [Glow] });
    const c = compileBehavior(B, NO_HOOKS);
    expect(c.deliveryAccess.write).toContain(Glow);
    expect(c.deliveryAccess.read).toBeUndefined();
  });
});

describe("the static divergence refusal (§3)", () => {
  it("refuses a durable-eligible writes: target on a tick-only behavior", () => {
    __resetPrefabsForTests();
    definePrefab("bdCard", { store: "durable", components: [init(Position, { x: 0, y: 0 })] });
    const B = defineBehavior("bd:tickonlywrite", {
      store: "runtime",
      writes: [Position],
      on: { tick: () => {} },
    });
    expect(() => compileBehavior(B, NO_HOOKS)).toThrow(/cannot commit/);
    __resetPrefabsForTests();
  });

  it("allows the same declaration once a commit-capable hook exists", () => {
    __resetPrefabsForTests();
    definePrefab("bdCard2", { store: "durable", components: [init(Position, { x: 0, y: 0 })] });
    const B = defineBehavior("bd:tickandchanged", {
      store: "runtime",
      writes: [Position],
      on: { tick: () => {}, changed: () => {} },
    });
    expect(() => compileBehavior(B, NO_HOOKS)).not.toThrow();
    __resetPrefabsForTests();
  });

  it("leaves a runtime-only writes: target alone", () => {
    const B = defineBehavior("bd:runtimewrite", { store: "runtime", writes: [Glow], on: { tick: () => {} } });
    expect(() => compileBehavior(B, NO_HOOKS)).not.toThrow();
  });
});

describe("tick scope", () => {
  it("compiles Not(Culled) into the query when declared, and matches everything otherwise", () => {
    const world = createWorld();
    const Visible = defineBehavior("bd:visibleonly", {
      store: "runtime",
      tick: { while: "visible" },
      on: { tick: () => {} },
    });
    const All = defineBehavior("bd:allinstances", { store: "runtime", on: { tick: () => {} } });
    const vc = compileBehavior(Visible, NO_HOOKS);
    const ac = compileBehavior(All, NO_HOOKS);

    const e = world.spawn({ components: [[Visible.component, {}], [All.component, {}]] });
    world.addTag(e, Culled);

    const matched = (q: NonNullable<typeof vc.tick>["query"]): number => {
      let n = 0;
      world.query(q as never).each((b) => {
        n += b.count;
      });
      return n;
    };
    // Default is EVERY instance (Law 14: an off-screen spring still settles);
    // suspension is the author's declaration, never the framework's discovery.
    expect(matched(ac.tick?.query as never)).toBe(1);
    expect(matched(vc.tick?.query as never)).toBe(0);
  });
});
