/**
 * `maxFacetBytes` — the ephemeral facet byte claim (petition I19).
 *
 * The contract under test, in the petition's own acceptance order: the claim
 * round-trips through `describeBehavior` and is identity-bearing; an
 * over-budget DEFAULT fails the definition (in production too — the check is
 * deliberately outside the dev-guard gate) with no residue; an over-budget
 * `ctx.write` is refused BEFORE mutation with the prior facet intact, is
 * attributed through the ordinary fault ladder in-hook (three frames
 * quarantine the singleton and I17 withdraws the facet), and cannot be
 * bypassed through the blessed captured-closure path; and the measure is
 * canonical UTF-8 JSON of the COMPLETE merged cell, json fields serialized.
 *
 * Plus the round's store-routing audit: an ephemeral behavior's component has
 * exactly two mint paths (ensureFacet defaults, ctx.write) — the imperative
 * attach/detach surface and the durable tx wrapper refuse it, closing the
 * ctx.peers() remote-facet spoof.
 *
 * Names are file-unique ("bfb:*").
 */
import { createWorld } from "@vibecook/strata-ecs";
import type { Entity, World } from "@vibecook/strata-ecs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetBehaviorsForTests,
  behaviors,
  defineBehavior,
  describeBehavior,
  facetBytesOf,
} from "../src/behavior/define-behavior";
import { createBehaviorRuntime, type BehaviorPresence, type BehaviorRuntime } from "../src/behavior/runtime";
import { createEngine, type Engine } from "../src/engine/engine";
import { setDevGuards } from "../src/guards/dev";
import { attachPresence, type PresenceSession } from "../src/presence/presence-kit";
import { createCanvasEngine, defineWidget } from "../src";
import type { CanvasEngine } from "../src";
import { p } from "../src/widget/props";

/** The canonical measure, computed independently of the implementation. */
function bytesOf(cell: Record<string, unknown>): number {
  return new TextEncoder().encode(JSON.stringify(cell)).length;
}

let world: World;
let engine: Engine;
let runtime: BehaviorRuntime;
let presence: PresenceSession | undefined;
let faults: { behavior: string; hook: string; entity: Entity | undefined; message: string }[];
let frame = 0;

beforeEach(() => {
  world = createWorld();
  engine = createEngine(world, { onGuestFault: () => {}, onGuestNotice: () => {} });
  presence = attachPresence(world, { name: "me", color: "#f00" });
  faults = [];
  runtime = createBehaviorRuntime({
    world,
    engine,
    presence: () => presence as BehaviorPresence | undefined,
    onLog: () => {},
    onFault: (behavior, hook, entity, err) =>
      faults.push({ behavior, hook, entity, message: String(err) }),
  });
  frame = 0;
});

afterEach(() => {
  runtime.dispose();
  presence?.detach();
  presence = undefined;
  __resetBehaviorsForTests();
});

function step(): void {
  frame += 16;
  engine.step(frame);
}

function peer(): Entity {
  return (presence as PresenceSession).localPeer;
}

describe("the claim is declarative and identity-bearing", () => {
  it("round-trips through describeBehavior exactly, and is ABSENT when unattested", () => {
    const Bounded = defineBehavior("bfb:described", {
      store: "ephemeral",
      maxFacetBytes: 4096,
      schema: { tool: p.string({ default: "select" }) },
    });
    const Unbounded = defineBehavior("bfb:unattested", {
      store: "ephemeral",
      schema: { tool: p.string({ default: "select" }) },
    });
    expect(describeBehavior(Bounded).maxFacetBytes).toBe(4096);
    expect(Bounded.maxFacetBytes).toBe(4096);
    // A host must be able to tell "no attested bound" from any finite bound.
    expect("maxFacetBytes" in describeBehavior(Unbounded)).toBe(false);
    expect(Unbounded.maxFacetBytes).toBeUndefined();
  });

  it("changing ONLY the claim is a different declaration (the ensure-cache refuses)", () => {
    const spec = { store: "ephemeral", schema: { n: p.number({ default: 0 }) } } as const;
    const first = defineBehavior("bfb:identity", { ...spec, maxFacetBytes: 256 });
    // Identical re-definition: same handle, no throw (the HMR path).
    expect(defineBehavior("bfb:identity", { ...spec, maxFacetBytes: 256 })).toBe(first);
    expect(() => defineBehavior("bfb:identity", { ...spec, maxFacetBytes: 512 })).toThrow(
      /DIFFERENT shape/,
    );
    // Dropping the claim entirely is also a different declaration.
    expect(() => defineBehavior("bfb:identity", spec)).toThrow(/DIFFERENT shape/);
  });

  it("is ephemeral-only, a positive integer, and validated as such", () => {
    expect(() =>
      defineBehavior("bfb:wrongstore", { store: "runtime", maxFacetBytes: 64 }),
    ).toThrow(/ephemeral-only/);
    expect(() =>
      defineBehavior("bfb:zero", { store: "ephemeral", maxFacetBytes: 0 }),
    ).toThrow(/positive integer/);
    expect(() =>
      defineBehavior("bfb:fraction", { store: "ephemeral", maxFacetBytes: 12.5 }),
    ).toThrow(/positive integer/);
    expect(() =>
      defineBehavior("bfb:negative", { store: "ephemeral", maxFacetBytes: -1 }),
    ).toThrow(/positive integer/);
  });
});

describe("the default facet is checked at DEFINITION, before anything can publish", () => {
  const DEFAULT = "x".repeat(10);
  const atBound = bytesOf({ note: DEFAULT }); // {"note":"xxxxxxxxxx"}

  it("a default exactly at the bound registers and publishes", () => {
    const B = defineBehavior("bfb:default-fits", {
      store: "ephemeral",
      maxFacetBytes: atBound,
      schema: { note: p.string({ default: DEFAULT }) },
    });
    expect(facetBytesOf({ ...B.defaults })).toBe(atBound);
    runtime.register(B);
    step();
    expect(world.get(peer(), B.component)).toEqual({ note: DEFAULT });
  });

  it("one byte over fails the definition with NO residue", () => {
    expect(() =>
      defineBehavior("bfb:default-over", {
        store: "ephemeral",
        maxFacetBytes: atBound - 1,
        schema: { note: p.string({ default: DEFAULT }) },
      }),
    ).toThrow(/default facet is \d+ bytes, over/);
    expect(behaviors.get("bfb:default-over")).toBeUndefined();
  });

  it("enforces in PRODUCTION too — the check sits outside the dev-guard gate", () => {
    setDevGuards(false);
    try {
      expect(() =>
        defineBehavior("bfb:default-over-prod", {
          store: "ephemeral",
          maxFacetBytes: atBound - 1,
          schema: { note: p.string({ default: DEFAULT }) },
        }),
      ).toThrow(/over/);
      expect(behaviors.get("bfb:default-over-prod")).toBeUndefined();
    } finally {
      setDevGuards(true);
    }
  });

  it("measures UTF-8 bytes, not UTF-16 code units", () => {
    const EMOJI = "\u{1F3A8}"; // 🎨 — 2 code units, 4 UTF-8 bytes
    const utf16 = JSON.stringify({ e: EMOJI }).length;
    const utf8 = bytesOf({ e: EMOJI });
    expect(utf8).toBeGreaterThan(utf16); // the premise the test rests on
    expect(() =>
      defineBehavior("bfb:utf16-lies", {
        store: "ephemeral",
        maxFacetBytes: utf16,
        schema: { e: p.string({ default: EMOJI }) },
      }),
    ).toThrow(/over/);
    const B = defineBehavior("bfb:utf8-truth", {
      store: "ephemeral",
      maxFacetBytes: utf8,
      schema: { e: p.string({ default: EMOJI }) },
    });
    expect(B.maxFacetBytes).toBe(utf8);
  });
});

describe("ctx.write is measured on the COMPLETE merged cell, before mutation", () => {
  it("at the bound publishes; one byte over is refused, attributed, and leaves the prior facet intact", () => {
    const AT = "A".repeat(4);
    const bound = bytesOf({ s: AT }); // {"s":"AAAA"}
    const script: (string | undefined)[] = [AT, `${AT}A`]; // frame 2 is one byte over
    let tick = 0;
    const B = defineBehavior("bfb:write-bound", {
      store: "ephemeral",
      maxFacetBytes: bound,
      schema: { s: p.string({ default: "" }) },
      on: {
        tick: (_e, _d, _f, ctx) => {
          const s = script[tick++];
          if (s !== undefined) ctx.write({ s });
        },
      },
    });
    runtime.register(B);

    step(); // writes AT — exactly at the bound
    expect(world.get(peer(), B.component)).toEqual({ s: AT });
    expect(faults).toEqual([]);

    step(); // one byte over: refused before mutation, ladder-attributed
    expect(world.get(peer(), B.component)).toEqual({ s: AT }); // prior facet intact
    expect(faults).toHaveLength(1);
    expect(faults[0]).toMatchObject({ behavior: "bfb:write-bound", hook: "tick", entity: peer() });
    expect(faults[0]?.message).toMatch(/maxFacetBytes=\d+/);
  });

  it("measures the MERGED cell — a small patch that tips the total is refused", () => {
    const BIG = "B".repeat(20);
    const bound = bytesOf({ a: "", b: BIG });
    const script: Record<string, string>[] = [{ b: BIG }, { a: "x" }];
    let tick = 0;
    const B = defineBehavior("bfb:merge-bound", {
      store: "ephemeral",
      maxFacetBytes: bound,
      schema: { a: p.string({ default: "" }), b: p.string({ default: "" }) },
      on: {
        tick: (_e, _d, _f, ctx) => {
          const patch = script[tick++];
          if (patch !== undefined) ctx.write(patch);
        },
      },
    });
    runtime.register(B);

    step(); // {b: BIG} → merged {a:"", b:BIG}, exactly at bound
    expect(world.get(peer(), B.component)).toEqual({ a: "", b: BIG });

    step(); // {a:"x"} → merged one byte over, refused whole
    expect(world.get(peer(), B.component)).toEqual({ a: "", b: BIG });
    expect(faults).toHaveLength(1);
  });

  it("measures json fields AS SERIALIZED", () => {
    const bound = bytesOf({ j: JSON.stringify(["ok"]) });
    let ctxWrite: ((patch: Record<string, unknown>) => void) | undefined;
    const B = defineBehavior("bfb:json-bound", {
      store: "ephemeral",
      maxFacetBytes: bound,
      schema: { j: p.json({ kind: "array", item: { kind: "string" } }, { default: [] }) },
      on: {
        init: (_e, _d, ctx) => {
          ctxWrite = (patch) => ctx.write(patch);
        },
      },
    });
    runtime.register(B);
    step();

    ctxWrite?.({ j: ["ok"] }); // serialized: exactly at bound
    expect(world.get(peer(), B.component)).toEqual({ j: JSON.stringify(["ok"]) });
    expect(() => ctxWrite?.({ j: ["ok", "overflow"] })).toThrow(/maxFacetBytes/);
    expect(world.get(peer(), B.component)).toEqual({ j: JSON.stringify(["ok"]) });
  });

  it("three over-budget frames quarantine the singleton and I17 withdraws the facet", () => {
    const bound = bytesOf({ s: "" });
    const B = defineBehavior("bfb:three-strikes", {
      store: "ephemeral",
      maxFacetBytes: bound,
      schema: { s: p.string({ default: "" }) },
      on: {
        tick: (_e, _d, _f, ctx) => ctx.write({ s: "over the bound, every frame" }),
      },
    });
    runtime.register(B);

    step();
    step();
    expect(world.has(peer(), B.component)).toBe(true); // two strikes: still published
    step(); // third consecutive throw: quarantine + withdrawal
    expect(world.has(peer(), B.component)).toBe(false);
    expect(runtime.list()[0]?.quarantined).toBe(true);
    expect(faults).toHaveLength(3);

    step(); // and ensureFacet must NOT re-mint a quarantined singleton
    expect(world.has(peer(), B.component)).toBe(false);
  });

  it("the captured-closure path cannot bypass the bound", () => {
    const AT = "C".repeat(6);
    const bound = bytesOf({ s: AT });
    let publish: ((s: string) => void) | undefined;
    const B = defineBehavior("bfb:captured", {
      store: "ephemeral",
      maxFacetBytes: bound,
      schema: { s: p.string({ default: "" }) },
      on: {
        init: (_e, _d, ctx) => {
          publish = (s) => ctx.write({ s });
        },
      },
    });
    runtime.register(B);
    step();

    publish?.(AT); // at the bound: publishes
    expect(world.get(peer(), B.component)).toEqual({ s: AT });
    // Over the bound OUTSIDE a hook: the throw reaches the caller
    // synchronously — refused either way, and no ladder involvement (the
    // caller got the exception; quarantine stays a hook-fault mechanism).
    expect(() => publish?.(`${AT}C`)).toThrow(/maxFacetBytes/);
    expect(world.get(peer(), B.component)).toEqual({ s: AT });
    expect(runtime.list()[0]?.quarantined).toBe(false);
    expect(faults).toEqual([]);
  });
});

describe("store-routing audit: the facet has exactly two mint paths", () => {
  it("the imperative attach/detach surface refuses ephemeral behaviors", () => {
    const B = defineBehavior("bfb:no-imperative", {
      store: "ephemeral",
      schema: { s: p.string({ default: "" }) },
    });
    const e = world.spawn({});
    expect(() => runtime.attach(e, B)).toThrow(/minted by the runtime on the local peer/);
    expect(() => runtime.detach(e, B)).toThrow(/never detached through the world/);
    expect(world.has(e, B.component)).toBe(false);
  });
});

describe("store-routing audit: the durable tx wrapper", () => {
  let ce: CanvasEngine;

  afterEach(() => {
    ce.dispose();
  });

  it("tx.attach/tx.detach refuse an ephemeral behavior's component", async () => {
    const Eph = defineBehavior("bfb:tx-target", {
      store: "ephemeral",
      schema: { s: p.string({ default: "" }) },
    });
    const caught: string[] = [];
    const Doc = defineBehavior("bfb:tx-driver", {
      store: "durable",
      schema: { n: p.number({ default: 0 }) },
      on: {
        init: (e, _d, ctx) => {
          ctx.commit("probe", (tx) => {
            try {
              tx.attach(e, Eph);
            } catch (err) {
              caught.push(String(err));
            }
            try {
              tx.detach(e, Eph);
            } catch (err) {
              caught.push(String(err));
            }
          });
        },
      },
    });
    const CARD = defineWidget({
      type: "bfb:card",
      surface: "dom",
      component: null,
      defaultSize: { w: 10, h: 10 },
      behaviors: [Doc],
    });
    ce = createCanvasEngine({ widgets: [CARD], behaviors: [Doc] });
    await ce.docs.create();
    const e = ce.ops.spawnWidget("bfb:card", { x: 0, y: 0, undoable: false });
    ce.world.sync();
    ce.step(16);
    ce.step(32);

    expect(caught).toHaveLength(2);
    expect(caught[0]).toMatch(/cannot be attached into the document/);
    expect(caught[1]).toMatch(/never through the document/);
    expect(ce.world.has(e, Eph.component)).toBe(false);
  });
});
