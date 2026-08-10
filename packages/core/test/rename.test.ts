/**
 * Prefab rename migration (design-008, petition I5): declaration compile,
 * gate aliasing + tombstones, the open-path fold (rename × version chain),
 * and the live zombie sweep (resurrection / late entity / id-zombie).
 *
 * Registries are process-global: each scenario resets the ice widget/prefab
 * registries and uses file-unique type names. Strata's schema registry does
 * NOT reset — `ensureComponent` reuse is exactly what makes the old-name
 * group components survive the reset boundary (the design-008 §3.1 path this
 * suite exercises for real).
 */
import { LoroDoc, LoroMap } from "loro-crdt";
import { afterEach, describe, expect, it } from "vitest";
import {
  PrefabId,
  createCanvasEngine,
  decodeEnvelope,
  defineQuery,
  defineWidget,
  p,
  renames,
  widgets,
  type CanvasEngine,
  type Entity,
} from "../src";
import { __resetWidgetsForTests } from "../src/widget/define-widget";
import { __resetPrefabsForTests } from "../src/schema/prefab";
import { gateVerdict, readDocVersionReport } from "../src/doc/version-gate";

const prefabQ = defineQuery([PrefabId]);

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

function makeEngine(): { ce: CanvasEngine; step: (n?: number) => void } {
  const ce = createCanvasEngine();
  cleanups.push(() => ce.dispose());
  let now = 0;
  const step = (n = 1): void => {
    for (let i = 0; i < n; i++) {
      now += 16;
      ce.step(now);
    }
  };
  return { ce, step };
}

function resetRegistries(): void {
  __resetWidgetsForTests();
  __resetPrefabsForTests();
}

function widgetsOf(ce: CanvasEngine, type: string): Entity[] {
  const out: Entity[] = [];
  ce.world.query(prefabQ).each((b) => {
    for (const r of b) {
      const e = b.entity(r);
      if (ce.world.read(e, PrefabId).id === type) out.push(e);
    }
  });
  return out;
}

function readMeta(ce: CanvasEngine, key: string): string | number | boolean | undefined {
  let v: string | number | boolean | undefined;
  ce.docs.current()?.store.metaTransaction((m) => {
    v = m.get(key);
  });
  return v;
}

/** setTimeout(0) — drains the sweep's queueMicrotask before resolving. */
const flushMicrotasks = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Build a pre-rename doc under the OLD def and return its envelope bytes. */
function buildOldDoc(oldType: string): Uint8Array {
  resetRegistries();
  defineWidget({
    type: oldType,
    props: { title: p.string({ default: "t" }), n: p.number({ default: 0 }) },
    surface: "dom",
    component: null,
  });
  const { ce, step } = makeEngine();
  ce.docs.create();
  const e = ce.ops.spawnWidget(oldType, { x: 10, y: 20 });
  step();
  ce.ops.setWidgetProps(e, { title: "hello", n: 5 });
  step();
  const bytes = ce.docs.current()?.exportEnvelope();
  if (bytes === undefined) throw new Error("test: exportEnvelope failed");
  ce.docs.close();
  return bytes;
}

/** Register the NEW def (v2 + a 1→2 chain) claiming `oldType`. */
function defineRenamed(newType: string, oldType: string): void {
  resetRegistries();
  defineWidget({
    type: newType,
    version: 2,
    props: { title: p.string({ default: "t" }), n: p.number({ default: 0 }) },
    surface: "dom",
    component: null,
    renamedFrom: [{ type: oldType }],
    migrate: { 1: (prev) => ({ ...prev, title: `${String(prev.title)}!` }) },
  });
}

describe("renamedFrom — declaration compile", () => {
  it("registers legacy components + a rename entry; reuse survives re-definition", () => {
    resetRegistries();
    defineWidget({
      type: "rn:decl-old",
      props: { a: p.string({ default: "" }) },
      surface: "dom",
      component: null,
    });
    resetRegistries();
    const W = defineWidget({
      type: "rn:decl-new",
      props: { a: p.string({ default: "" }) },
      surface: "dom",
      component: null,
      renamedFrom: [{ type: "rn:decl-old", atVersion: 1 }],
    });
    const entry = renames.get("rn:decl-old");
    expect(entry?.widget).toBe(W);
    expect(entry?.atVersion).toBe(1);
    // The legacy component REUSES the old def's registered handle (same name,
    // same shape) — strata's duplicate-name throw never fires.
    expect(entry?.legacyGroups.length).toBe(1);
    expect(entry?.legacyGroups[0]?.name).toBe("rn:decl-old:props");
  });

  it("throws on self-rename, still-registered old types, and double claims", () => {
    resetRegistries();
    expect(() =>
      defineWidget({ type: "rn:self", surface: "dom", component: null, renamedFrom: [{ type: "rn:self" }] }),
    ).toThrow(/lists itself/);

    resetRegistries();
    defineWidget({ type: "rn:live-old", surface: "dom", component: null });
    expect(() =>
      defineWidget({ type: "rn:live-new", surface: "dom", component: null, renamedFrom: [{ type: "rn:live-old" }] }),
    ).toThrow(/still a registered widget/);

    resetRegistries();
    defineWidget({ type: "rn:claim-a", surface: "dom", component: null, renamedFrom: [{ type: "rn:claimed" }] });
    expect(() =>
      defineWidget({ type: "rn:claim-b", surface: "dom", component: null, renamedFrom: [{ type: "rn:claimed" }] }),
    ).toThrow(/already claimed/);
  });
});

describe("version gate — rename aliasing + tombstones (design-008 §4)", () => {
  it("classifies old markers: unregistered bricks readOnly, registered → migrate, tombstoned → ignored", () => {
    resetRegistries();
    defineWidget({
      type: "rn:gate-new",
      version: 2,
      props: { a: p.string({ default: "" }) },
      surface: "dom",
      component: null,
      renamedFrom: [{ type: "rn:gate-old" }],
      migrate: { 1: (prev) => prev },
    });

    const doc = new LoroDoc();
    const meta = doc.getMap("meta");
    meta.set("engine.schema.2", true);
    meta.set("engine.pack.rn:gate-unknown.1", true); // no rename registered
    doc.commit();
    let report = readDocVersionReport(doc);
    expect(report.newerInDoc).toContain("rn:gate-unknown");
    expect(gateVerdict(report)).toBe("readOnly"); // the pre-design-008 brick, preserved for true unknowns

    const doc2 = new LoroDoc();
    const meta2 = doc2.getMap("meta");
    meta2.set("engine.schema.2", true);
    meta2.set("engine.pack.rn:gate-old.1", true);
    doc2.commit();
    report = readDocVersionReport(doc2);
    expect(report.newerInDoc).toEqual([]); // un-bricked
    expect(report.renamedInDoc).toEqual({ "rn:gate-old": 1 });
    expect(report.docPacks["rn:gate-new"]).toBe(1); // version evidence aliased onto the new id
    expect(gateVerdict(report)).toBe("migrate");

    meta2.set("engine.renamed.rn:gate-old", "rn:gate-new"); // tombstone: dead history
    meta2.set("engine.pack.rn:gate-new.2", true);
    doc2.commit();
    report = readDocVersionReport(doc2);
    expect(report.renamedInDoc).toEqual({});
    expect(report.docPacks["rn:gate-old"]).toBeUndefined();
    expect(gateVerdict(report)).toBe("ok");
  });
});

describe("open-path fold (design-008 §5) — rename × version chain", () => {
  it("folds entities, stamps tombstone + carried pack marker, runs the chain on new names, heals the envelope", () => {
    const bytes = buildOldDoc("rn:open-old");
    defineRenamed("rn:open-new", "rn:open-old");

    const { ce, step } = makeEngine();
    const res = ce.docs.open(bytes);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.session.readOnly).toBe(false); // fully caught up → writable
    step();

    // The entity folded: new id, chain-folded value on the NEW group component.
    const folded = widgetsOf(ce, "rn:open-new");
    expect(folded.length).toBe(1);
    expect(widgetsOf(ce, "rn:open-old").length).toBe(0);
    const group = widgets.get("rn:open-new")?.groups[0]?.component;
    expect(group).toBeDefined();
    const value = ce.world.get(folded[0] as Entity, group as never) as { title: string; n: number };
    expect(value).toMatchObject({ title: "hello!", n: 5 }); // "!"= the 1→2 chain ran post-rename
    // No legacy cell survives.
    const legacy = renames.get("rn:open-old")?.legacyGroups[0];
    expect(ce.world.get(folded[0] as Entity, legacy as never)).toBeUndefined();

    // Markers: tombstone + carried v1 marker (+ the chain's v2 stamp).
    expect(readMeta(ce, "engine.renamed.rn:open-old")).toBe("rn:open-new");
    expect(readMeta(ce, "engine.pack.rn:open-new.1")).toBe(true);
    expect(readMeta(ce, "engine.pack.rn:open-new.2")).toBe(true);

    // The next save's envelope carries ONLY the new id (self-heal, §7).
    const saved = res.session.exportEnvelope();
    const { header } = decodeEnvelope(saved);
    expect(Object.keys(header.prefabVersions)).toEqual(["rn:open-new"]);
    expect(header.prefabVersions["rn:open-new"]).toBe(2);
  });
});

describe("zombie sweep (design-008 §6) — stale deliveries converge live", () => {
  it("drops resurrected old cells (new-wins), folds late old-shape entities, rewrites id-zombies", async () => {
    const bytes = buildOldDoc("rn:swp-old");
    defineRenamed("rn:swp-new", "rn:swp-old");

    const { ce, step } = makeEngine();
    const res = ce.docs.open(bytes);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    step();
    const before = widgetsOf(ce, "rn:swp-new");
    expect(before.length).toBe(1);

    // Craft "stale" traffic: a doc holding the session's history plus writes
    // an old build could author — old-name cells, an old-id PrefabId, and a
    // whole late old-shape entity (mirroring the live entity's cell shapes).
    const stale = new LoroDoc();
    stale.import(res.session.exportSnapshot());
    const entities = stale.getMap("entities");
    let liveKey: string | undefined;
    for (const key of entities.keys()) {
      const child = entities.get(key);
      if (child instanceof LoroMap && child.get("comp:PrefabId") !== undefined) liveKey = key;
    }
    expect(liveKey).toBeDefined();
    const live = entities.get(liveKey as string) as LoroMap;
    // (a) resurrection beside the post-rename cell + (b) the id-zombie:
    live.set("comp:rn:swp-old:props", { title: "stale", n: 99 });
    live.set("comp:PrefabId", { id: "rn:swp-old" });
    // (c) a late old-shape entity (offline pre-rename spawn arriving now):
    const lateKey = "zzz:late-1";
    const late = entities.setContainer(lateKey, new LoroMap());
    late.set("exists", true);
    late.set("comp:PrefabId", { id: "rn:swp-old" });
    late.set("comp:Position", { x: 300, y: 300 });
    late.set("comp:Size", { w: 100, h: 80 });
    late.set("comp:rn:swp-old:props", { title: "late", n: 1 });
    stale.commit();

    res.session.applyRemote(stale.export({ mode: "snapshot" }));
    step(); // projection lands → observers fire at notify → sweep scheduled
    await flushMicrotasks(); // the between-frames fold runs
    step(); // fold projects

    // (a) new-wins: the resurrected old cell is gone; the post-rename value holds.
    const group = widgets.get("rn:swp-new")?.groups[0]?.component;
    const legacy = renames.get("rn:swp-old")?.legacyGroups[0];
    const originals = widgetsOf(ce, "rn:swp-new").filter((e) => {
      const v = ce.world.get(e, group as never) as { title: string } | undefined;
      return v?.title === "hello!";
    });
    expect(originals.length).toBe(1);
    expect(ce.world.get(originals[0] as Entity, legacy as never)).toBeUndefined();

    // (b) + (c): no old-id entity remains; the late entity folded and
    // chain-folded ("late" → "late!" via the 1→2 step, design-008 §6.3).
    expect(widgetsOf(ce, "rn:swp-old").length).toBe(0);
    const all = widgetsOf(ce, "rn:swp-new");
    expect(all.length).toBe(2);
    const lateFolded = all.filter((e) => {
      const v = ce.world.get(e, group as never) as { title: string; n: number } | undefined;
      return v?.title === "late!" && v.n === 1;
    });
    expect(lateFolded.length).toBe(1);
    expect(ce.world.get(lateFolded[0] as Entity, legacy as never)).toBeUndefined();
  });

  it("zero-prop renames keep the wide PrefabId watcher (late id-only entity folds)", async () => {
    // No props → no legacy components to observe: this is the ONE shape that
    // still needs the PrefabId watcher after the 2026-08-09 narrowing (a late
    // old-shape entity here carries nothing but PrefabId + geometry).
    resetRegistries();
    defineWidget({ type: "rn:zp-old", surface: "dom", component: null });
    const a = makeEngine();
    a.ce.docs.create();
    a.ce.ops.spawnWidget("rn:zp-old", { x: 0, y: 0 });
    a.step();
    const bytes = a.ce.docs.current()?.exportEnvelope() as Uint8Array;
    a.ce.docs.close();

    resetRegistries();
    defineWidget({ type: "rn:zp-new", surface: "dom", component: null, renamedFrom: [{ type: "rn:zp-old" }] });
    const { ce, step } = makeEngine();
    const res = ce.docs.open(bytes);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    step();
    expect(widgetsOf(ce, "rn:zp-new").length).toBe(1);

    const stale = new LoroDoc();
    stale.import(res.session.exportSnapshot());
    const entities = stale.getMap("entities");
    const late = entities.setContainer("zzz:zp-late", new LoroMap());
    late.set("exists", true);
    late.set("comp:PrefabId", { id: "rn:zp-old" });
    late.set("comp:Position", { x: 10, y: 10 });
    late.set("comp:Size", { w: 50, h: 50 });
    stale.commit();
    res.session.applyRemote(stale.export({ mode: "snapshot" }));
    step();
    await flushMicrotasks();
    step();

    expect(widgetsOf(ce, "rn:zp-old").length).toBe(0);
    expect(widgetsOf(ce, "rn:zp-new").length).toBe(2);
  });
});
