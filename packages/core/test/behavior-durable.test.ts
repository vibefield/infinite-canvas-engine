/**
 * The durable store class + the `derived` differ (design-009 §3, §4.4 — M13c).
 *
 * The criterion that matters most here is ONE-FRAME QUIESCENCE. A derived
 * behavior writes the values it derives; those writes journal; the journal
 * wakes the behavior; it recomputes and writes the same values again. Rev 2 of
 * the design claimed "zero recomputes" and was false by exactly one echo — so
 * these traces count recomputes AND transactions, not just final values.
 *
 * Behavior/widget names are file-unique ("bdur:*").
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetBehaviorsForTests, defineBehavior } from "../src/behavior/define-behavior";
import { createBehaviorRuntime, type BehaviorRuntime, type BehaviorSession } from "../src/behavior/runtime";
import { Position, createCanvasEngine, defineTag, defineWidget, widgets, type CanvasEngine, type Entity } from "../src";

const Pinned = defineTag("bdurPinned");
import { p } from "../src/widget/props";

const BOX =
  widgets.get("bdur:box") ??
  defineWidget({ type: "bdur:box", surface: "dom", component: null, defaultSize: { w: 10, h: 10 } });

let ce: CanvasEngine;
let runtime: BehaviorRuntime;
let commits: { undoable: boolean; meta: unknown }[];
let frame = 0;

beforeEach(async () => {
  ce = createCanvasEngine({ widgets: [BOX] });
  await ce.docs.create();
  commits = [];
  runtime = createBehaviorRuntime({
    world: ce.world,
    engine: ce.engine,
    session: () => {
      const s = ce.docs.current();
      if (s === undefined) return undefined;
      // A counting shim over the real session: "opened NO transaction" is the
      // load-bearing claim of the differ, and only the store can witness it.
      return {
        readOnly: s.readOnly,
        liveWriter: s.liveWriter,
        store: {
          transaction: (fn: never, opts?: { undoable?: boolean; meta?: unknown }) => {
            commits.push({ undoable: opts?.undoable !== false, meta: opts?.meta });
            return s.store.transaction(fn as never, opts as never);
          },
          keyOf: (e: Entity) => s.store.keyOf(e),
          resolve: (k: never) => s.store.resolve(k),
          getComponent: <S,>(e: Entity, c: never) => s.store.getComponent(e, c) as S | undefined,
        },
      } as unknown as BehaviorSession;
    },
    onLog: () => {},
  });
  frame = 0;
});

afterEach(() => {
  runtime.dispose();
  ce.dispose();
  __resetBehaviorsForTests();
});

function step(): void {
  frame += 16;
  ce.step(frame);
}

function spawn(x: number, y: number): Entity {
  const e = ce.ops.spawnWidget("bdur:box", { x, y, undoable: false });
  ce.world.sync();
  return e;
}

function docPos(e: Entity): { x: number; y: number } | undefined {
  const v = ce.docs.current()?.store.getComponent(e, Position);
  return v === undefined ? undefined : { x: v.x, y: v.y };
}

/**
 * A derived layout: stack every instance at x = index * 100.
 *
 * `init` only MARKS — it is per-instance, and a whole-graph recompute there
 * would cost one commit per node. `changed` is the once-per-behavior-per-frame
 * hook, which is where whole-graph work belongs. That division is the design's,
 * and writing the fixture the naive way (reflow from init) is what proved it:
 * two instances produced two commits plus the frame's own `changed`.
 */
function makeLayout(name: string) {
  const state = { recomputes: 0, order: [] as Entity[] };
  let dirty = false;
  const B = defineBehavior(name, {
    store: "durable",
    derived: true,
    schema: { gap: p.number({ default: 100 }) },
    reads: [Position],
    writes: [Position],
    on: {
      init: () => {
        dirty = true;
      },
      changed: (ctx) => {
        dirty = false;
        state.recomputes++;
        const members = state.order.length > 0 ? state.order : [...ctx.entities()];
        ctx.commit("layout.reflow", (tx) => {
          members.forEach((e, i) => tx.move(e, { x: i * 100, y: 0 }));
        });
      },
    },
  });
  return { B, state, wasDirty: () => dirty };
}

describe("the differ (BF-D5)", () => {
  it("opens NO transaction when every write equals the projection", () => {
    const { B, state } = makeLayout("bdur:nooptx");
    runtime.register(B);
    const a = spawn(0, 0);
    const b = spawn(500, 0);
    state.order = [a, b];
    ce.docs.current()?.store.transaction((tx) => {
      tx.addComponent(a, B.component, { gap: 100 });
      tx.addComponent(b, B.component, { gap: 100 });
    });
    ce.world.sync();

    step(); // init → first reflow: b really moves
    expect(commits).toHaveLength(1);
    expect(docPos(b)).toEqual({ x: 100, y: 0 });

    // Let the WORLD settle first. Spawned widgets are equipped with their
    // capability tags at projection, and that archetype migration journals them
    // a frame later — a legitimate wake that has nothing to do with the echo
    // this trace is about. Measuring before it lands would make the trace pass
    // or fail on system registration order.
    step();
    step();
    const after = state.recomputes;
    const committed = commits.length;

    step();
    step();
    step();
    // ONE-FRAME QUIESCENCE: the echo of the behavior's OWN commit does not wake
    // it — no recompute, and no transaction.
    expect(state.recomputes).toBe(after);
    expect(commits).toHaveLength(committed);
  });

  it("still wakes on a TAG flip landing on an entity it just wrote", () => {
    const seen: number[] = [];
    const B = defineBehavior("bdur:echotag", {
      store: "durable",
      derived: true,
      schema: { n: p.number({ default: 0 }) },
      reads: [Position, Pinned],
      writes: [Position],
      on: {
        changed: (ctx) => {
          seen.push(ctx.entities().length);
          const members = [...ctx.entities()];
          if (members.length === 0) return;
          ctx.commit("echo.tag", (tx) => {
            for (const e of members) tx.move(e, { x: 7, y: 7 });
          });
        },
      },
    });
    runtime.register(B);
    const a = spawn(0, 0);
    ce.docs.current()?.store.transaction((tx) => tx.addComponent(a, B.component, { n: 0 }));
    ce.world.sync();
    step();
    step();
    step();
    const quiet = seen.length;

    // The echo memo subtracts entities this behavior just wrote. It has to
    // snapshot EVERY subscription, not just the components: a tag in the reads
    // set flipping on such an entity looks exactly like our own echo, and
    // swallowing it is the same permanent-miss bug the memo exists to avoid.
    ce.world.addTag(a, Pinned);
    step();
    expect(seen.length).toBe(quiet + 1);
  });

  it("does not re-run for its own commit's echo", () => {
    const { B, state } = makeLayout("bmig:twodrain");
    runtime.register(B);
    // Already laid out, so the first delivery commits nothing and the world
    // (equip tags included) goes quiet before the measurement starts.
    const a = spawn(0, 0);
    const b = spawn(100, 0);
    state.order = [a, b];
    ce.docs.current()?.store.transaction((tx) => {
      tx.addComponent(a, B.component, { gap: 100 });
      tx.addComponent(b, B.component, { gap: 100 });
    });
    ce.world.sync();
    step();
    step();
    step();
    commits.length = 0;
    const quiet = state.recomputes;

    // A genuine external change: one recompute, one commit putting b back.
    ce.docs.current()?.store.transaction((tx) => tx.edit(b).set(Position, { x: 500, y: 0 }));
    ce.world.sync();
    step();
    expect(state.recomputes).toBe(quiet + 1);
    expect(commits).toHaveLength(1);

    // The §14 criterion: post-commit, ZERO further recomputes and ZERO further
    // transactions. (A durable write journals twice — write-through now, batch
    // re-projection at the following `world.sync()` — but both copies land in
    // the same drain window, so what this pins is the memo's existence, not its
    // lifetime.)
    for (let i = 0; i < 4; i++) step();
    expect(state.recomputes).toBe(quiet + 1);
    expect(commits).toHaveLength(1);
  });

  it("recomputes on a real change and commits only what moved", () => {
    const { B, state } = makeLayout("bdur:realchange");
    runtime.register(B);
    const a = spawn(0, 0);
    const b = spawn(0, 0);
    state.order = [a, b];
    ce.docs.current()?.store.transaction((tx) => {
      tx.addComponent(a, B.component, { gap: 100 });
      tx.addComponent(b, B.component, { gap: 100 });
    });
    ce.world.sync();
    step();
    commits.length = 0;
    const before = state.recomputes;

    // Someone else moves a member — a genuine input change.
    ce.docs.current()?.store.transaction((tx) => {
      tx.edit(b).set(Position, { x: 999, y: 999 });
    });
    ce.world.sync();
    step();

    expect(state.recomputes).toBeGreaterThan(before);
    expect(commits).toHaveLength(1);
    expect(docPos(b)).toEqual({ x: 100, y: 0 });
  });

  it("forces derived OUTPUT non-undoable — ⌘Z must not un-derive", () => {
    const { B, state } = makeLayout("bdur:nonundoable");
    runtime.register(B);
    const a = spawn(0, 0);
    const b = spawn(500, 0);
    state.order = [a, b];
    ce.docs.current()?.store.transaction((tx) => {
      tx.addComponent(a, B.component, { gap: 100 });
      tx.addComponent(b, B.component, { gap: 100 });
    });
    ce.world.sync();
    step();

    expect(commits).toHaveLength(1);
    expect(commits[0]?.undoable).toBe(false);
    expect(commits[0]?.meta).toEqual({ behavior: "bdur:nonundoable", label: "layout.reflow" });
  });

  it("keeps an OWN-DATA config edit undoable — that edit is authorial, not derived", () => {
    let doEdit: (() => void) | undefined;
    const B = defineBehavior("bdur:configedit", {
      store: "durable",
      derived: true,
      schema: { gap: p.number({ default: 24 }) },
      writes: [Position],
      on: {
        init: (e, _d, ctx) => {
          doEdit = () => ctx.commit("layout.setGap", (tx) => tx.write(e, { gap: 48 }));
        },
      },
    });
    runtime.register(B);
    const a = spawn(0, 0);
    ce.docs.current()?.store.transaction((tx) => tx.addComponent(a, B.component, { gap: 24 }));
    ce.world.sync();
    step();
    commits.length = 0;

    doEdit?.();
    expect(commits).toHaveLength(1);
    expect(commits[0]?.undoable).toBe(true);
  });

  it("drops structural no-ops and refuses spawn under derived", () => {
    let detachAbsent: (() => void) | undefined;
    let trySpawn: (() => void) | undefined;
    const Other = defineBehavior("bdur:other", { store: "durable", schema: { n: p.number() } });
    const B = defineBehavior("bdur:structural", {
      store: "durable",
      derived: true,
      schema: { n: p.number() },
      on: {
        init: (e, _d, ctx) => {
          detachAbsent = () => ctx.commit("x.detach", (tx) => tx.detach(e, Other));
          trySpawn = () => ctx.commit("x.spawn", (tx) => tx.spawnPrefab(BOX.prefab));
        },
      },
    });
    runtime.register(B);
    const a = spawn(0, 0);
    ce.docs.current()?.store.transaction((tx) => tx.addComponent(a, B.component, { n: 0 }));
    ce.world.sync();
    step();
    commits.length = 0;

    detachAbsent?.();
    expect(commits).toHaveLength(0); // detach-when-absent is dropped entirely

    expect(() => trySpawn?.()).toThrow(/may not spawn/);
    expect(commits).toHaveLength(0);
  });

  it("attach-when-attached preserves existing data instead of resetting it", () => {
    let reattach: (() => void) | undefined;
    const Tagged = defineBehavior("bdur:tagged", { store: "durable", schema: { n: p.number({ default: 1 }) } });
    const B = defineBehavior("bdur:reattach", {
      store: "durable",
      schema: { n: p.number() },
      on: {
        init: (e, _d, ctx) => {
          reattach = () => ctx.commit("x.attach", (tx) => tx.attach(e, Tagged));
        },
      },
    });
    runtime.register(B);
    const a = spawn(0, 0);
    ce.docs.current()?.store.transaction((tx) => {
      tx.addComponent(a, B.component, { n: 0 });
      tx.addComponent(a, Tagged.component, { n: 42 });
    });
    ce.world.sync();
    step();

    reattach?.();
    ce.world.sync();
    expect(ce.world.get(a, Tagged.component)).toEqual({ n: 42 });
  });
});

describe("ctx.commit refusals", () => {
  it("masks tx.setResource — the resource-write fence is mechanical, not doctrinal", () => {
    let bad: (() => void) | undefined;
    const B = defineBehavior("bdur:resfence", {
      store: "durable",
      schema: { n: p.number() },
      on: {
        init: (_e, _d, ctx) => {
          bad = () => ctx.commit("x", (tx) => (tx as unknown as { setResource: () => void }).setResource());
        },
      },
    });
    runtime.register(B);
    const a = spawn(0, 0);
    ce.docs.current()?.store.transaction((tx) => tx.addComponent(a, B.component, { n: 0 }));
    ce.world.sync();
    step();
    expect(() => bad?.()).toThrow(/singleton/);
  });

  it("refuses when the document is gone", () => {
    let commit: (() => void) | undefined;
    const B = defineBehavior("bdur:nodoc", {
      store: "durable",
      schema: { n: p.number() },
      on: {
        init: (e, _d, ctx) => {
          commit = () => ctx.commit("x", (tx) => tx.write(e, { n: 1 }));
        },
      },
    });
    runtime.register(B);
    const a = spawn(0, 0);
    ce.docs.current()?.store.transaction((tx) => tx.addComponent(a, B.component, { n: 0 }));
    ce.world.sync();
    step();

    ce.docs.close();
    expect(() => commit?.()).toThrow(/no document attached/);
  });
});

describe("BF-D6 eligibility", () => {
  it("lets a durable behavior cell ride ANY entity's transaction — no prefab declares it", () => {
    const B = defineBehavior("bdur:eligible", { store: "durable", schema: { n: p.number({ default: 3 }) } });
    const a = spawn(0, 0);
    // The widget prefab has never heard of this component. Behavior cells are
    // universally durable-eligible (BF-D6), and the guard branch is what makes
    // that true in a shipped build, where dev guards are still on by default.
    expect(() =>
      ce.docs.current()?.store.transaction((tx) => tx.addComponent(a, B.component, { n: 3 })),
    ).not.toThrow();
    ce.world.sync();
    expect(ce.world.get(a, B.component)).toEqual({ n: 3 });
  });
});
