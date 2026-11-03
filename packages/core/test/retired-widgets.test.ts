import { describe, expect, it } from "vitest";
import { Active, compileEngineCatalog, createCanvasEngine, defineWidget, gateVerdict, guardedTransaction, Position, Selectable, Visible } from "../src";

const kept = defineWidget({ type: "retirement.kept", defaultSize: { w: 100, h: 100 } });
const retired = defineWidget({ type: "retirement.retired", defaultSize: { w: 200, h: 200 } });

describe("retired widget schemas", () => {
  it("rejects a widget declared both active and retired", () => {
    expect(() => compileEngineCatalog({ widgets: [kept], retiredWidgets: [kept] })).toThrow("both active and retired");
  });

  it("preserves old and live peer rows without activating, picking, or placing the retired widget", () => {
    const writer = createCanvasEngine({ widgets: [kept, retired] });
    const session = writer.docs.create();
    const old = writer.ops.spawnWidget(retired.type, { x: 10000, y: 10000, undoable: false });
    const other = writer.ops.spawnWidget(kept.type, { x: 0, y: 0, undoable: false });
    writer.step(16);
    const key = session.store.keyOf(old);
    const otherKey = session.store.keyOf(other);
    if (key === undefined || otherKey === undefined) throw new Error("missing keys");
    const reader = createCanvasEngine({ widgets: [kept], retiredWidgets: [retired] });
    const opened = reader.docs.open(session.exportEnvelope(1));
    if (!opened.ok) throw new Error(opened.reason);
    reader.step(16);
    const e = opened.session.store.resolve(key);
    const active = opened.session.store.resolve(otherKey);
    if (e === undefined || active === undefined) throw new Error("missing preserved rows");
    expect(gateVerdict(opened.session.versionReport())).toBe("ok");
    expect(reader.catalog.widget(retired.type)).toBeUndefined();
    expect(reader.catalog.initialPacks()[retired.type]).toBeUndefined();
    expect(reader.world.hasTag(e, Active)).toBe(false);
    expect(reader.world.hasTag(e, Visible)).toBe(false);
    expect(reader.world.hasTag(e, Selectable)).toBe(false);
    expect(reader.world.hasTag(active, Active)).toBe(true);
    expect(() => reader.ops.spawnWidget(retired.type, { x: 0, y: 0 })).toThrow();

    const updates: Uint8Array[] = [];
    const off = session.store.subscribeOutbound((bytes) => updates.push(bytes.slice()));
    guardedTransaction(session.store, writer.world, (tx) => tx.edit(old).set(Position, { x: 12345, y: 6789 }));
    for (const bytes of updates) opened.session.applyRemote(bytes);
    reader.step(32);
    expect(reader.world.get(e, Position)).toEqual({ x: 12345, y: 6789 });
    expect(reader.world.hasTag(e, Active)).toBe(false);
    expect(gateVerdict(opened.session.versionReport())).toBe("ok");

    // A host which still supports the widget can recover it from the exported document.
    const restored = createCanvasEngine({ widgets: [kept, retired] });
    const reopened = restored.docs.open(opened.session.exportEnvelope(2));
    if (!reopened.ok) throw new Error(reopened.reason);
    restored.step(16);
    const back = reopened.session.store.resolve(key);
    if (back === undefined) throw new Error("lost retired row");
    expect(restored.world.get(back, Position)).toEqual({ x: 12345, y: 6789 });
    expect(restored.world.hasTag(back, Active)).toBe(true);
    off();
    restored.dispose(); reader.dispose(); writer.dispose();
  });
});
