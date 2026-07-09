/**
 * The write-path SOVEREIGNTY MATRIX — the executable form of design-001 §2 (the
 * rules) and §3 (the gesture protocol), and the M2 milestone exit gate.
 *
 * This is an INDEPENDENT, adversarial suite: it did not author the orchestrator
 * (schema/prefab · engine/instantiate · guards/*) and tries to break its
 * sovereignty guarantees. Each `it` names the design rule it pins. Fixtures and
 * the "mx:*" schema live in ./fixtures (declared once — strata's registry is
 * process-global); prefabs are (re)defined per test after `__resetPrefabsForTests()`.
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
import { __resetPrefabsForTests, definePrefab, PrefabId } from "../src/schema/prefab";
import { instantiate } from "../src/engine/instantiate";
import { createLiveWriter } from "../src/guards/live-writer";
import { guardedTransaction } from "../src/guards/guarded-tx";
import { setDevGuards } from "../src/guards/dev";
import { makeDefaultMayDiverge } from "../src/ops/claims";
// The matrix MAY import the catalog now that it is stable (the schema registry is process-global
// and unaffected by the prefab reset in beforeEach): the real recognizer tags/relations/riders pin
// makeDefaultMayDiverge against live claims rather than a stub predicate.
import { Captures, Drags, GestureActive, TransformTween } from "../src/catalog/gesture";
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
  __resetPrefabsForTests();
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
// RULE 4 (cellInDoc) — the EXACT doc-membership predicate vs the eligibility fallback
// (design-001 §2 rule 4; live-writer finding A6 / matrix finding #2)
// =====================================================================================
describe("rule 4 (cellInDoc) — exact doc membership vs the eligibility approximation", () => {
  it("rule 4: with cellInDoc wired to the doc, a committed cell w/o claim throws but an eligible-but-UNCOMMITTED optional is free", () => {
    const { world, store } = attachWorld();
    const { box } = defineStdPrefabs();
    const e = makeDurableBox(world, store, box);
    // mxRotation is ELIGIBLE (box optional) but never attached via tx → not a doc cell. Attach it as a
    // RUNTIME rider so the value write has a column to land in (rule 2: a world-added component never
    // enters the doc, so the exact predicate below still reports it absent).
    world.addComponent(e, mxRotation, { r: 0 });

    const lw = createLiveWriter(world, {
      keyOf: (x) => store.keyOf(x),
      mayDiverge: () => false,
      cellInDoc: (x, c) => store.getComponent(x, c) !== undefined, // EXACT: the real doc.getComponent
    });

    // Position was committed at spawn → it IS a doc cell → no claim → throws.
    expect(() => lw.set(e, mxPosition, { x: 1, y: 1 })).toThrow(/gesture claim/);
    // The exact predicate is LESS strict than eligibility: mxRotation is eligible yet not in the doc → free.
    expect(() => lw.set(e, mxRotation, { r: 1 })).not.toThrow();
    expect(world.get(e, mxRotation)).toEqual({ r: 1 });
  });

  it("rule 4: the SAME uncommitted optional THROWS under the FALLBACK (no cellInDoc) — pins the documented over-approximation", () => {
    const { world, store } = attachWorld();
    const { box } = defineStdPrefabs();
    const e = makeDurableBox(world, store, box);

    // No cellInDoc → the guard falls back to prefab ELIGIBILITY, which is stricter: mxRotation is
    // eligible, so it is guarded even though it is not actually in the doc (fails safe; §2 rule 4).
    const lw = createLiveWriter(world, {
      keyOf: (x) => store.keyOf(x),
      mayDiverge: () => false,
    });
    expect(() => lw.set(e, mxRotation, { r: 1 })).toThrow(/gesture claim/);
  });
});

// =====================================================================================
// RULE 4 (real claims) — makeDefaultMayDiverge over LIVE recognizers, + the fail-closed
// prefab branch (design-001 §3; live-writer findings A2 / A5)
// =====================================================================================
describe("rule 4 (real claims) — makeDefaultMayDiverge + fail-closed prefab", () => {
  it("rule 4: an Active recognizer that Captures then Drags the box grants divergence; dropping Active revokes it", () => {
    const { world, store } = attachWorld();
    const { box } = defineStdPrefabs();
    const e = makeDurableBox(world, store, box);
    const lw = createLiveWriter(world, {
      keyOf: (x) => store.keyOf(x),
      mayDiverge: makeDefaultMayDiverge(world),
    });

    // No claim → guarded.
    expect(() => lw.set(e, mxPosition, { x: 1, y: 1 })).toThrow(/gesture claim/);

    // A live recognizer Captures the box AND is Active → divergence granted.
    const rec = world.spawn();
    world.addTag(rec, GestureActive);
    world.setRelation(rec, Captures, e);
    expect(() => lw.set(e, mxPosition, { x: 2, y: 2 })).not.toThrow();
    expect(world.get(e, mxPosition)).toEqual({ x: 2, y: 2 });

    // Drop Active (the Captures edge remains) → divergence revoked.
    world.removeTag(rec, GestureActive);
    expect(() => lw.set(e, mxPosition, { x: 3, y: 3 })).toThrow(/gesture claim/);

    // The Drags edge-set is the OTHER grant path — an Active recognizer that Drags it also diverges.
    const rec2 = world.spawn();
    world.addTag(rec2, GestureActive);
    world.addRelation(rec2, Drags, e);
    expect(() => lw.set(e, mxPosition, { x: 4, y: 4 })).not.toThrow();
    world.removeTag(rec2, GestureActive);
    expect(() => lw.set(e, mxPosition, { x: 5, y: 5 })).toThrow(/gesture claim/);
  });

  it("rule 4: a live TransformTween on the box IS the claim (fly-back holds it past reap); removing it revokes divergence", () => {
    const { world, store } = attachWorld();
    const { box } = defineStdPrefabs();
    const e = makeDurableBox(world, store, box);
    const lw = createLiveWriter(world, {
      keyOf: (x) => store.keyOf(x),
      mayDiverge: makeDefaultMayDiverge(world),
    });

    expect(() => lw.set(e, mxPosition, { x: 1, y: 1 })).toThrow(/gesture claim/);
    world.addComponent(e, TransformTween, { toX: 0, toY: 0, durationMs: 100, elapsedMs: 0 });
    expect(() => lw.set(e, mxPosition, { x: 6, y: 6 })).not.toThrow();
    world.removeComponent(e, TransformTween);
    expect(() => lw.set(e, mxPosition, { x: 7, y: 7 })).toThrow(/gesture claim/);
  });

  it("rule 4 (A5): a doc-bound entity with no resolvable prefab FAILS CLOSED (no free live writes)", () => {
    const { world, store } = attachWorld();
    const { box } = defineStdPrefabs();
    const e = makeDurableBox(world, store, box);
    // Strip the runtime PrefabId: keyOf still binds e to the doc, but the guard can no longer resolve a
    // prefab, so it cannot know which cells are doc-sovereign — every write could be one → fail closed.
    world.removeComponent(e, PrefabId);
    const lw = createLiveWriter(world, {
      keyOf: (x) => store.keyOf(x),
      mayDiverge: makeDefaultMayDiverge(world),
    });
    expect(() => lw.set(e, mxPosition, { x: 1, y: 1 })).toThrow(/no resolvable prefab/);
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

  it("rule 5: a rider dies with the despawn; a SURVIVING box re-projects WITHOUT its rider", () => {
    const { world, store } = attachWorld(1);
    const { box } = defineStdPrefabs();
    // Two durable boxes: one is despawned, one survives — both carry runtime riders.
    const doomed = makeDurableBox(world, store, box);
    const survivor = makeDurableBox(world, store, box, [[mxPosition, { x: 9, y: 9 }]]);
    world.addTag(doomed, mxSelected);
    world.addComponent(survivor, mxRider, { n: 7 });
    world.addTag(survivor, mxSelected);

    store.transaction((tx) => tx.destroy(doomed));
    world.sync();
    // Local despawn: the doomed handle is dead, taking its rider with it (nothing to restore).
    expect(world.isAlive(doomed)).toBe(false);

    // Adversarial re-projection: bootstrap a FRESH world from the converged snapshot.
    const store2 = makeStore(2);
    const world2 = createWorld();
    attachDurable(world2, store2);
    store2.applyRemote(store.exportSnapshot());
    world2.sync();

    // The despawn did not resurrect — exactly one durable box re-projects (the survivor).
    expect(world2.count(defineQuery([mxPosition]))).toBe(1);
    const s2 = must(world2.firstOf(defineQuery([mxPosition])));
    // POSITIVE (same live entity): its essential cell + tag re-projected with real values.
    expect(world2.get(s2, mxPosition)).toEqual({ x: 9, y: 9 });
    expect(world2.hasTag(s2, mxWidgetTag)).toBe(true);
    // NEGATIVE (same live entity): the runtime rider did NOT — re-projection restores the doc, never riders.
    expect(world2.has(s2, mxRider)).toBe(false);
    expect(world2.hasTag(s2, mxSelected)).toBe(false);
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
