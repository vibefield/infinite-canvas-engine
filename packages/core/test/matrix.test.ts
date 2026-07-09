/**
 * The write-path SOVEREIGNTY MATRIX — the executable form of design-001 §2 (the
 * rules) and §3 (the gesture protocol), and the M2 milestone exit gate.
 *
 * This is an INDEPENDENT, adversarial suite: it did not author the orchestrator
 * (schema/prefab · engine/instantiate · guards/*) and tries to break its
 * sovereignty guarantees. Each `it` names the design rule it pins. Fixtures and
 * the "mx:*" schema live in ./fixtures (declared once — strata's registry is
 * process-global); prefabs are (re)defined per test after `prefabs.__reset()`.
 *
 * Real strata throughout: createWorld + createDurableStore(LoroDoc) + attachDurable.
 * Durable timing (verified against strata source): a value write to a PRE-EXISTING
 * cell agrees across runtime+doc+baseline synchronously at tx seal; all STRUCTURE
 * (spawn / addComponent / tag / relation / despawn) reaches the runtime via
 * projection at the next `world.sync()`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorld, defineQuery } from "@vibecook/strata-ecs";
import type { Entity, SystemCtx } from "@vibecook/strata-ecs";
import { attachDurable } from "@vibecook/strata-ecs/durable";
import { definePrefab, PrefabId, prefabs } from "../src/schema/prefab";
import { instantiate } from "../src/engine/instantiate";
import { createLiveWriter } from "../src/guards/live-writer";
import { guardedTransaction } from "../src/guards/guarded-tx";
import { setDevGuards } from "../src/guards/dev";
import {
  attachWorld,
  defineStdPrefabs,
  makeDurableBox,
  makeEphStub,
  makeStore,
  must,
  mxChildOf,
  mxDurableRes,
  mxFollows,
  mxHasEid,
  mxPosition,
  mxPresenceInfo,
  mxPresenceTag,
  mxReq,
  mxRider,
  mxRotation,
  mxRuntimeRes,
  mxSelected,
  mxWidgetTag,
} from "./fixtures";

beforeEach(() => {
  prefabs.__reset();
});

afterEach(() => {
  // Guards are process-global; a test that flips them must not leak the change.
  setDevGuards(true);
});

// =====================================================================================
// RULE 1 — definePrefab validation (design-001 §2 rules 3/6, design-005 §1 set)
// =====================================================================================
describe("rule 1 — definePrefab validation", () => {
  it("rule 1: a duplicate prefab id throws", () => {
    definePrefab("mx:dupe", { store: "runtime", components: [[mxPosition, { x: 0, y: 0 }]] });
    expect(() =>
      definePrefab("mx:dupe", { store: "runtime", components: [[mxPosition, { x: 0, y: 0 }]] }),
    ).toThrow(/already defined/);
  });

  it('rule 1: owner "derive" on a non-runtime prefab throws', () => {
    expect(() =>
      definePrefab("mx:bad-owner", {
        store: "durable",
        components: [[mxPosition, { x: 0, y: 0 }]],
        owner: "derive",
      }),
    ).toThrow(/owner "derive" is only valid on runtime/);
  });

  it("rule 1: an ephemeral prefab with relations throws (presence store: components + tags only)", () => {
    expect(() =>
      definePrefab("mx:eph-bad", {
        store: "ephemeral",
        components: [[mxPresenceInfo, { name: "a", color: "b" }]],
        relations: [mxFollows],
      }),
    ).toThrow(/no relations/);
  });

  it("rule 1: an eid field in a durable prefab's eligible set throws (checked on OPTIONAL too)", () => {
    expect(() =>
      definePrefab("mx:eid-bad", {
        store: "durable",
        components: [[mxPosition, { x: 0, y: 0 }]],
        optional: [mxHasEid],
      }),
    ).toThrow(/eid is banned in durable cells/);
  });

  it("rule 1 (scoping): the eid ban does NOT fire for a RUNTIME prefab (eid legal off the doc)", () => {
    expect(() =>
      definePrefab("mx:eid-runtime-ok", {
        store: "runtime",
        components: [[mxPosition, { x: 0, y: 0 }]],
        optional: [mxHasEid],
      }),
    ).not.toThrow();
  });

  it("rule 1: a missing required field in the essential init throws (names the field)", () => {
    expect(() =>
      definePrefab("mx:req-bad", { store: "durable", components: [[mxReq, {}]] }),
    ).toThrow(/missing required field "v"/);
  });

  it("rule 1: a VALID durable prefab defines fine and exposes its eligible set", () => {
    const box = definePrefab("mx:valid", {
      store: "durable",
      components: [[mxPosition, { x: 0, y: 0 }]],
      optional: [mxRotation],
      relations: [mxChildOf],
    });
    expect(box.id).toBe("mx:valid");
    expect(box.eligible.has(mxPosition)).toBe(true);
    expect(box.eligible.has(mxRotation)).toBe(true);
    expect(box.eligible.has(PrefabId)).toBe(true); // stamp is always eligible
    expect(box.eligible.has(mxRider)).toBe(false);
    expect(box.eligibleRelations.has(mxChildOf)).toBe(true);
    expect(box.eligibleRelations.has(mxFollows)).toBe(false);
  });
});

// =====================================================================================
// RULE 2 — spawn routing: the prefab class IS the spawn path (design-001 §2)
// =====================================================================================
describe("rule 2 — spawn routing (class = path)", () => {
  it('rule 2: a durable prefab spawned into "world" THROWS loudly (no silent downgrade)', () => {
    const { world } = attachWorld();
    const { box } = defineStdPrefabs();
    expect(() => instantiate(box, { into: "world", world })).toThrow(/durable prefab cannot spawn into "world"/);
  });

  it('rule 2: a durable prefab spawned into "tx" places essential + tags + PrefabId after sync', () => {
    const { world, store } = attachWorld();
    const { box } = defineStdPrefabs();

    const e = store.transaction((tx) => instantiate(box, { into: "tx", tx }));
    // Structure is not visible until projection.
    expect(world.get(e, mxPosition)).toBeUndefined();
    world.sync();

    expect(world.get(e, PrefabId)?.id).toBe("mx:box");
    expect(world.get(e, mxPosition)).toEqual({ x: 0, y: 0 });
    expect(world.hasTag(e, mxWidgetTag)).toBe(true);
    expect(store.keyOf(e)).toBeDefined(); // durable → doc-bound
  });

  it('rule 2: a runtime prefab spawned into "world" works and stamps PrefabId', () => {
    const { world, store } = attachWorld();
    const { cursor } = defineStdPrefabs();

    const c = instantiate(cursor, { into: "world", world });
    expect(world.get(c, PrefabId)?.id).toBe("mx:cursor");
    expect(world.get(c, mxPosition)).toEqual({ x: 0, y: 0 });
    expect(store.keyOf(c)).toBeUndefined(); // runtime → NOT doc-bound
  });

  it('rule 2: a runtime prefab spawned into "tx" THROWS', () => {
    const { world, store } = attachWorld();
    const { cursor } = defineStdPrefabs();
    // The route check throws inside the transaction body → runTransaction rolls back and rethrows.
    expect(() => store.transaction((tx) => instantiate(cursor, { into: "tx", tx }))).toThrow(
      /runtime prefab cannot spawn into "tx"/,
    );
    // world untouched.
    expect(world.firstOf(defineQuery([mxPosition]))).toBeUndefined();
  });

  it('rule 2: an ephemeral prefab spawns ONLY into "eph" (stubbed) — world/tx throw', () => {
    const { world, store } = attachWorld();
    const { presence } = defineStdPrefabs();
    const { eph, calls } = makeEphStub();

    instantiate(presence, { into: "eph", eph });
    expect(calls.spawn).toBe(1);
    const stamp = calls.lastComponents.find(([c]) => c === PrefabId);
    expect(stamp?.[1]).toEqual({ id: "mx:presence" }); // stamped even for ephemeral
    expect(calls.tags).toContain(mxPresenceTag); // essential tag routed through eph.addTag

    expect(() => instantiate(presence, { into: "world", world })).toThrow(
      /ephemeral prefab cannot spawn into "world"/,
    );
    expect(() => store.transaction((tx) => instantiate(presence, { into: "tx", tx }))).toThrow(
      /ephemeral prefab cannot spawn into "tx"/,
    );
  });
});

// =====================================================================================
// RULE 3 — eligibility is validated (design-001 §2 rules 3/6/7) via guardedTransaction
// =====================================================================================
describe("rule 3 — eligibility (guardedTransaction)", () => {
  it("rule 3: tx.addComponent of a NON-eligible component throws (names component + prefab)", () => {
    const { world, store } = attachWorld();
    const { box } = defineStdPrefabs();
    expect(() =>
      guardedTransaction(store, world, (tx) => {
        const e = tx.spawnPrefab(box);
        tx.addComponent(e, mxRider, { n: 0 });
      }),
    ).toThrow(/mx:Rider[\s\S]*mx:box/);
  });

  it("rule 3: an eligible OPTIONAL component attaches fine and survives sync", () => {
    const { world, store } = attachWorld();
    const { box } = defineStdPrefabs();

    let target: Entity | undefined;
    guardedTransaction(store, world, (tx) => {
      const e = tx.spawnPrefab(box);
      tx.addComponent(e, mxRotation, { r: 0 });
      target = e;
    });
    world.sync();
    expect(world.get(must(target), mxRotation)).toEqual({ r: 0 });
  });

  it("rule 3: setRelation with a NON-eligible relation throws", () => {
    const { world, store } = attachWorld();
    const { box } = defineStdPrefabs();
    expect(() =>
      guardedTransaction(store, world, (tx) => {
        const a = tx.spawnPrefab(box);
        const b = tx.spawnPrefab(box);
        tx.setRelation(a, mxFollows, b);
      }),
    ).toThrow(/mx:Follows[\s\S]*mx:box/);
  });

  it("rule 3: an eligible relation between two durable entities works and survives sync", () => {
    const { world, store } = attachWorld();
    const { box } = defineStdPrefabs();

    let a: Entity | undefined;
    let b: Entity | undefined;
    guardedTransaction(store, world, (tx) => {
      const x = tx.spawnPrefab(box);
      const y = tx.spawnPrefab(box);
      tx.setRelation(x, mxChildOf, y);
      a = x;
      b = y;
    });
    world.sync();
    expect(world.getRelation(must(a), mxChildOf)).toBe(must(b));
  });

  it("rule 3: tx.setResource on a RUNTIME-declared resource throws; a DURABLE-declared one works", () => {
    const { world, store } = attachWorld();
    defineStdPrefabs();

    expect(() =>
      guardedTransaction(store, world, (tx) => {
        tx.setResource(mxRuntimeRes, { zoom: 2 });
      }),
    ).toThrow(/declared runtime/);

    guardedTransaction(store, world, (tx) => {
      tx.setResource(mxDurableRes, { color: "blue" });
    });
    expect(world.getResource(mxDurableRes)).toEqual({ color: "blue" });
  });
});

// =====================================================================================
// RULE 4 — the per-cell live guard (design-001 §2 rule 4 + §3)
// =====================================================================================
describe("rule 4 — per-cell live guard (createLiveWriter)", () => {
  function setup() {
    const { world, store } = attachWorld();
    const { box, cursor } = defineStdPrefabs();
    const e = makeDurableBox(world, store, box);
    const state = { may: false };
    const lw = createLiveWriter(world, {
      keyOf: (x) => store.keyOf(x),
      mayDiverge: () => state.may,
    });
    return { world, store, box, cursor, e, lw, state };
  }

  it("rule 4(a): a live write to a doc cell with mayDiverge=false THROWS", () => {
    const { e, lw, state } = setup();
    state.may = false;
    expect(() => lw.set(e, mxPosition, { x: 1, y: 1 })).toThrow(/gesture claim/);
  });

  it("rule 4(b): with mayDiverge=true the write lands in the runtime but NOT the doc until a tx commits it", () => {
    const { world, store, e, lw, state } = setup();
    state.may = true;

    lw.set(e, mxPosition, { x: 5, y: 5 });
    expect(world.get(e, mxPosition)).toEqual({ x: 5, y: 5 }); // runtime diverged
    expect(store.getComponent(e, mxPosition)).toEqual({ x: 0, y: 0 }); // doc still at baseline

    // The commit is the agreement point (§3 step 3a): the pre-existing cell converges synchronously.
    store.transaction((tx) => tx.edit(e).set(mxPosition, world.read(e, mxPosition)));
    expect(store.getComponent(e, mxPosition)).toEqual({ x: 5, y: 5 });
  });

  it("rule 4(c): writes to a RUNTIME entity's same component are ALWAYS free (drafts fall out)", () => {
    const { world, cursor, lw, state } = setup();
    const c = instantiate(cursor, { into: "world", world });
    state.may = false; // no claim — but the cell isn't in the doc, so the write is free
    expect(() => lw.set(c, mxPosition, { x: 9, y: 9 })).not.toThrow();
    expect(world.get(c, mxPosition)).toEqual({ x: 9, y: 9 });
  });

  it("rule 4(d): with setDevGuards(false) the guard is silent", () => {
    const { world, e, lw, state } = setup();
    setDevGuards(false);
    state.may = false;
    expect(() => lw.set(e, mxPosition, { x: 7, y: 7 })).not.toThrow();
    expect(world.get(e, mxPosition)).toEqual({ x: 7, y: 7 });
  });
});

// =====================================================================================
// RULE 5 — runtime riders (design-001 §2 rule 2): world.* on a durable entity never durable
// =====================================================================================
describe("rule 5 — runtime riders never enter the document", () => {
  it("rule 5: a world-added tag + component on a durable entity are absent from the doc and a re-projection", () => {
    const { world, store } = attachWorld(1);
    const { box } = defineStdPrefabs();
    const e = makeDurableBox(world, store, box);

    world.addTag(e, mxSelected);
    world.addComponent(e, mxRider, { n: 1 });

    // Direct: the doc's converged read never sees the rider component.
    expect(store.getComponent(e, mxRider)).toBeUndefined();

    // Adversarial: bootstrap a SECOND world from the exported snapshot; riders must not re-project,
    // while the durable essential set (cell + tag) must.
    const store2 = makeStore(2);
    const world2 = createWorld();
    attachDurable(world2, store2);
    store2.applyRemote(store.exportSnapshot());
    world2.sync();

    const e2 = must(world2.firstOf(defineQuery([mxPosition])));
    expect(world2.has(e2, mxRider)).toBe(false);
    expect(world2.hasTag(e2, mxSelected)).toBe(false);
    // control: durable data DID survive.
    expect(world2.get(e2, mxPosition)).toEqual({ x: 0, y: 0 });
    expect(world2.hasTag(e2, mxWidgetTag)).toBe(true);
  });

  it("rule 5: a rider dies with the durable entity's despawn (re-projection cannot restore it)", () => {
    const { world, store } = attachWorld();
    const { box } = defineStdPrefabs();
    const e = makeDurableBox(world, store, box);
    world.addTag(e, mxSelected);

    store.transaction((tx) => tx.destroy(e));
    world.sync();
    expect(world.isAlive(e)).toBe(false);
  });
});

// =====================================================================================
// RULE 6 — the draft / two-phase-promote seam (design-001 §3): `{ draft: true }` opt-in
// =====================================================================================
describe("rule 6 — draft/promote seam (design-001 §3)", () => {
  it("rule 6: WITHOUT the draft opt-in, durable→world/ctx still throws (no silent downgrade, §6.3)", () => {
    const { world } = attachWorld();
    const { box } = defineStdPrefabs();
    expect(() => instantiate(box, { into: "world", world })).toThrow(/cannot spawn into "world"/);
    expect(() => instantiate(box, { into: "world", world })).toThrow(/draft: true/); // error teaches the paved road
    const fakeCtx = {} as unknown as SystemCtx; // never dereferenced — the route check throws first
    expect(() => instantiate(box, { into: "ctx", ctx: fakeCtx })).toThrow(/cannot spawn into "ctx"/);
  });

  it("rule 6: `{ draft: true }` spawns the SAME durable prefab into the runtime store as a draft", () => {
    const { world, store } = attachWorld();
    const { box } = defineStdPrefabs();
    const draft = instantiate(box, { into: "world", world }, { draft: true });
    // Identity stamped, but NOT doc-bound: its cells are plain session data…
    expect(world.get(draft, PrefabId)?.id).toBe("mx:box");
    expect(store.keyOf(draft)).toBeUndefined();
    // …so live writes are free (rule 4(c)'s mechanism — the guard keys on keyOf).
    const lw = createLiveWriter(world, { keyOf: (x) => store.keyOf(x), mayDiverge: () => false });
    expect(() => lw.set(draft, mxPosition, { x: 7, y: 8 })).not.toThrow();
    expect(world.read(draft, mxPosition)).toEqual({ x: 7, y: 8 });
  });
});

// =====================================================================================
// RULE 7 — setDevGuards toggles AND restores enforcement
// =====================================================================================
describe("rule 7 — setDevGuards restores", () => {
  it("rule 7: throw with guards on → silent with guards off → throw again once re-enabled", () => {
    const { world, store } = attachWorld();
    const { box } = defineStdPrefabs();
    const e = makeDurableBox(world, store, box);
    const lw = createLiveWriter(world, { keyOf: (x) => store.keyOf(x), mayDiverge: () => false });

    setDevGuards(true);
    expect(() => lw.set(e, mxPosition, { x: 1, y: 1 })).toThrow(/gesture claim/);

    setDevGuards(false);
    expect(() => lw.set(e, mxPosition, { x: 2, y: 2 })).not.toThrow();

    setDevGuards(true);
    expect(() => lw.set(e, mxPosition, { x: 3, y: 3 })).toThrow(/gesture claim/);
  });
});
