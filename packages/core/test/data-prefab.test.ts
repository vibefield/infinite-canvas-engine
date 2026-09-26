// @vitest-environment node
// AN OBJECT'S DATA PREFABS (design-015 §5.1; D3t-a): durable children `ChildOf` an object that are never widgets — the
// board's strokes — declared by the object (`defineWidget({ data })`), so the engine's catalog tracks them as it tracks the
// widget's own prefab: their pack is stamped on a new document (and gated at open), a guarded transaction resolves them,
// and one whose version moved migrates by its OWN chain (`definePrefab({ migrate })` — the widget's `{ from: (prev) => next }`
// shape over its essential components), the M9 runner writing ONE non-undoable transaction and stamping the new marker.
import { describe, expect, it } from "vitest";
import {
  ChildOf,
  createCanvasEngine,
  dataPrefabFor,
  defineComponent,
  definePrefab,
  defineWidget,
  durablePrefabFor,
  field,
  gateVerdict,
  guardedTransaction,
  init,
  runMigrations,
  widgets,
  type Entity,
} from "../src";

// v2 of a data child: `b` added (default "") — a v1 cell projects with it default-filled; the chain stamps it explicitly
const Cell = defineComponent("dp:cell", { a: field("f64", { default: 0 }), b: field("string", { default: "" }) });
const CellPrefab = definePrefab("dp:cell", {
  store: "durable",
  version: 2,
  components: [init(Cell, { a: 0, b: "" })],
  relations: [ChildOf],
  migrate: { 1: (v) => ({ ...v, b: `was ${String(v.a)}` }) },
});
// one widget type per FILE (global registry; no test reset)
const HOST = widgets.get("dp:host") ?? defineWidget({ type: "dp:host", object: { name: "host" }, defaultSize: { w: 100, h: 100 }, data: [CellPrefab] });

function rig() {
  const ce = createCanvasEngine({ widgets: [HOST] });
  ce.docs.create();
  const host = ce.ops.spawnWidget("dp:host", { x: 0, y: 0, undoable: false });
  ce.world.sync();
  const session = ce.docs.current();
  if (session === undefined) throw new Error("no session");
  const add = (a: number): Entity => {
    let e: Entity | undefined;
    guardedTransaction(session.store, ce.world, (tx) => { e = tx.spawnPrefab(CellPrefab, [init(Cell, { a, b: "" })]); tx.setRelation(e, ChildOf, host); });
    ce.world.sync();
    return e as Entity;
  };
  return { ce, world: ce.world, session, host, add };
}

describe("an object's data prefabs join the catalog (D3t-a)", () => {
  it("the catalog tracks them with the widget: stamped on a new document, resolved for the guards, found as data", () => {
    const r = rig();
    expect(HOST.data.map((d) => d.id)).toEqual(["dp:cell"]);
    const report = r.session.versionReport();
    expect(report.localPacks["dp:cell"]).toBe(2);
    expect(report.docPacks["dp:cell"]).toBe(2);   // stamped at creation, as the widget's own
    expect(gateVerdict(report)).toBe("ok");
    expect(durablePrefabFor(r.world, "dp:cell")).toBe(CellPrefab);
    expect(dataPrefabFor(r.world, "dp:cell")).toBe(CellPrefab);
    expect(dataPrefabFor(r.world, "dp:host")).toBeUndefined();   // a widget's own prefab is no data prefab
  });

  it("a data prefab older in the document migrates by its own chain: one non-undoable transaction, the new marker stamped", () => {
    const r = rig();
    const c1 = r.add(3);
    const c2 = r.add(5);
    const report = r.session.versionReport();
    // the document as a v1 build left it: its data prefab's marker at 1
    const older = { ...report, docPacks: { ...report.docPacks, "dp:cell": 1 }, olderInDoc: ["dp:cell"] };
    expect(gateVerdict(older)).toBe("migrate");
    const out = runMigrations({ store: r.session.store, world: r.world }, older);
    r.world.sync();
    expect(out).toEqual({ migrated: ["dp:cell"], skipped: [] });
    expect(r.world.get(c1, Cell)).toEqual({ a: 3, b: "was 3" });
    expect(r.world.get(c2, Cell)).toEqual({ a: 5, b: "was 5" });
    expect(r.ce.docs.undo()).toBe(true);   // the adds' steps are still there: the migration pushed none
    r.world.sync();
    expect(r.world.get(c1, Cell)).toEqual({ a: 3, b: "was 3" });
  });

  it("definePrefab refuses a chain with a gap, a stray step, or on a store that is not the document's", () => {
    expect(() => definePrefab("dp:gap", { store: "durable", version: 3, components: [], migrate: { 1: (v) => v } })).toThrow(/gap at fromVersion 2/);
    expect(() => definePrefab("dp:stray", { store: "durable", version: 2, components: [], migrate: { 1: (v) => v, 2: (v) => v } })).toThrow(/outside 1\.\.1/);
    expect(() => definePrefab("dp:rt", { store: "runtime", version: 2, components: [], migrate: { 1: (v) => v } })).toThrow(/only a durable prefab migrates/);
    expect(() => defineWidget({ type: "dp:bad", object: {}, data: [definePrefab("dp:rt2", { store: "runtime", components: [] })] })).toThrow(/live in the document/);
  });
});
