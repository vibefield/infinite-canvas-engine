/**
 * Behavior schema evolution (design-009 §5.5–§5.6, BF-D14 — M13g).
 *
 * The load-bearing trace here is the ANTI-BRICK one: a document carrying
 * markers for a behavior this build does not install must open WRITABLE. That
 * is not a nicety — behaviors ship in plugins, so "the author had a plugin I
 * don't" is the ordinary state of a shared document, and the pack compare's
 * "no local counterpart ⇒ newerInDoc ⇒ read-only" rule would turn every one of
 * them into a dead file.
 *
 * Names are file-unique ("bmig:*").
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetBehaviorsForTests, defineBehavior } from "../src/behavior/define-behavior";
import {
  behaviorMarkerKey,
  classifyBehaviorVersion,
  docBehaviorVersion,
  stampBehaviorMarker,
  type BehaviorMeta,
} from "../src/behavior/migrate";
import { createBehaviorRuntime, type BehaviorRuntime, type BehaviorSession } from "../src/behavior/runtime";
import { createCanvasEngine, defineWidget, widgets } from "../src";
import type { CanvasEngine, Entity } from "../src";
import { p } from "../src/widget/props";

const BOX =
  widgets.get("bmig:box") ??
  defineWidget({ type: "bmig:box", surface: "dom", component: null, defaultSize: { w: 10, h: 10 } });

let ce: CanvasEngine;
let runtime: BehaviorRuntime;
let logs: string[];
let frame = 0;

beforeEach(async () => {
  ce = createCanvasEngine({ widgets: [BOX] });
  await ce.docs.create();
  logs = [];
  runtime = createBehaviorRuntime({
    world: ce.world,
    engine: ce.engine,
    session: () => ce.docs.current() as unknown as BehaviorSession | undefined,
    onLog: (_b, message) => logs.push(message),
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

function spawn(): Entity {
  const e = ce.ops.spawnWidget("bmig:box", { x: 0, y: 0, undoable: false });
  ce.world.sync();
  return e;
}

function meta(): BehaviorMeta {
  const store = ce.docs.current()?.store as unknown as {
    snapshot: { readMeta(k: string): string | undefined };
    metaTransaction(fn: (m: { get(k: string): unknown; set(k: string, v: string): void }) => void): void;
  };
  return {
    readMeta: (k) => store.snapshot.readMeta(k),
    metaTransaction: (fn) => store.metaTransaction(fn),
  };
}

function attach(e: Entity, component: never, data: Record<string, unknown>): void {
  ce.docs.current()?.store.transaction((tx) => tx.addComponent(e, component, data));
  ce.world.sync();
}

describe("markers", () => {
  it("stamps at FIRST ATTACH, not at doc create", () => {
    const B = defineBehavior("bmig:stamp", { store: "durable", schema: { n: p.number({ default: 0 }) } });
    runtime.register(B);
    step();
    // No cells of ours in the document yet — a marker here would be a lie about
    // what the document contains. (A plugin installs long after doc create.)
    expect(meta().readMeta(behaviorMarkerKey("bmig:stamp", 1))).toBeUndefined();

    const e = spawn();
    attach(e, B.component as never, { n: 1 });
    step();
    expect(meta().readMeta(behaviorMarkerKey("bmig:stamp", 1))).toBeDefined();
  });

  it("reads back the highest marker version present", () => {
    stampBehaviorMarker(meta(), "bmig:probe", 1);
    stampBehaviorMarker(meta(), "bmig:probe", 3);
    expect(docBehaviorVersion(meta(), "bmig:probe", 3)).toBe(3);
    expect(docBehaviorVersion(meta(), "bmig:absent", 3)).toBe(0);
  });
});

describe("the version compare", () => {
  it("classifies newer-in-doc as DORMANT and older as MIGRATE", () => {
    const B = defineBehavior("bmig:classify", {
      store: "durable",
      version: 2,
      migrate: { 1: (prev) => ({ ...prev, n: 10 }) },
      schema: { n: p.number({ default: 0 }) },
    });
    expect(classifyBehaviorVersion(B, 0)).toEqual({ kind: "ok" });
    expect(classifyBehaviorVersion(B, 2)).toEqual({ kind: "ok" });
    expect(classifyBehaviorVersion(B, 3)).toEqual({ kind: "dormant", docVersion: 3, installed: 2 });
    expect(classifyBehaviorVersion(B, 1)).toEqual({ kind: "migrate", from: 1, installed: 2 });
  });

  it("reports UNREACHABLE rather than guessing when the chain has a hole", () => {
    const B = defineBehavior("bmig:hole", { store: "durable", version: 3, schema: { n: p.number() } });
    // No migrate chain at all: v1 data cannot reach v3, and pretending it can
    // would silently corrupt it.
    expect(classifyBehaviorVersion(B, 1)).toEqual({ kind: "unreachable", from: 1, installed: 3 });
  });
});

describe("the runner", () => {
  it("migrates existing cells in ONE non-undoable pass and re-stamps", () => {
    // A document written by v1 of this behavior.
    const V1 = defineBehavior("bmig:runner", { store: "durable", schema: { n: p.number({ default: 1 }) } });
    const e = spawn();
    attach(e, V1.component as never, { n: 5 });
    stampBehaviorMarker(meta(), "bmig:runner", 1);
    __resetBehaviorsForTests();

    // This build installs v2 with a chain. Same NAME, so the same component.
    const V2 = defineBehavior("bmig:runner", {
      store: "durable",
      version: 2,
      migrate: { 1: (prev) => ({ ...prev, n: (prev.n as number) * 10 }) },
      schema: { n: p.number({ default: 1 }) },
    });
    const undoBefore = ce.docs.current()?.store.canUndo();
    runtime.register(V2);
    step();

    expect(ce.world.get(e, V2.component)).toEqual({ n: 50 });
    expect(meta().readMeta(behaviorMarkerKey("bmig:runner", 2))).toBeDefined();
    expect(ce.docs.current()?.store.canUndo()).toBe(undoBefore); // never an undo step
    expect(logs.some((l) => l.includes("migrated 1 instance"))).toBe(true);
  });

  it("runs on a MID-SESSION install, not only at open", () => {
    const V1 = defineBehavior("bmig:midsession", { store: "durable", schema: { n: p.number({ default: 1 }) } });
    const e = spawn();
    attach(e, V1.component as never, { n: 2 });
    stampBehaviorMarker(meta(), "bmig:midsession", 1);
    __resetBehaviorsForTests();

    // Frames pass with no behavior registered at all — the plugin arrives later,
    // which is the NORMAL path for a plugin host and the one "migrate at open"
    // misses entirely.
    step();
    step();

    const V2 = defineBehavior("bmig:midsession", {
      store: "durable",
      version: 2,
      migrate: { 1: (prev) => ({ ...prev, n: (prev.n as number) + 100 }) },
      schema: { n: p.number({ default: 1 }) },
    });
    runtime.register(V2);
    step();
    expect(ce.world.get(e, V2.component)).toEqual({ n: 102 });
  });

  it("REFUSES hook delivery when the doc is newer than this build", () => {
    const B = defineBehavior("bmig:newer", { store: "durable", schema: { n: p.number({ default: 0 }) } });
    const e = spawn();
    attach(e, B.component as never, { n: 1 });
    stampBehaviorMarker(meta(), "bmig:newer", 7); // written by a future build

    const seen: Entity[] = [];
    // Same declaration shape, so `defineBehavior` returns the cached handle
    // with these hooks adopted — the hot-reload path, reused here to attach
    // hooks after the cells already exist.
    runtime.register(
      defineBehavior("bmig:newer", {
        store: "durable",
        schema: { n: p.number({ default: 0 }) },
        on: { init: (x) => seen.push(x) },
      }),
    );
    step();
    void e;

    // Projection is version-BLIND: without this refusal the newer-shaped cell
    // would flow straight into these older hooks.
    expect(seen).toEqual([]);
    expect(logs.some((l) => l.includes("REFUSED"))).toBe(true);
  });
});

describe("the anti-brick guarantee", () => {
  it("a doc carrying markers for an UNINSTALLED behavior still opens writable", () => {
    stampBehaviorMarker(meta(), "some.other.plugin:layout", 9);
    const bytes = ce.docs.current()?.exportEnvelope() as Uint8Array;
    ce.docs.close();

    const reopened = ce.docs.open(bytes);
    expect(reopened.ok).toBe(true);
    if (reopened.ok) {
      // The behavior name is unknown here, and that is the ORDINARY case for a
      // shared document. It must not be classified as "written by a newer app".
      expect(reopened.session.readOnly).toBe(false);
      expect(reopened.session.report?.newerInDoc ?? []).not.toContain("some.other.plugin:layout");
    }
  });

});
