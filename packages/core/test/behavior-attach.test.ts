/**
 * Attachment surfaces (design-009 §6, BF-D10 — M13e).
 *
 * Attachment splits by STORE CLASS, exactly as everything else does, and the
 * split is the interesting part:
 *
 *   - DURABLE pre-attachments ride the spawn transaction. They are document
 *     truth, so they sync and undo with the widget.
 *   - RUNTIME pre-attachments are stamped at PROJECTION, beside the capability
 *     tags. That is the only path that also equips a widget arriving from a
 *     peer or restored from a file — neither of which ran a spawn.
 *   - EPHEMERAL is refused outright: an ephemeral instance IS the local
 *     presence peer, so it cannot ride a widget at all.
 *
 * The imperative facade surface exists because hooks-only attach was
 * chicken-and-egg (review blocker B3): the first instance could never be
 * created. It deliberately refuses DURABLE attach — that is a document op.
 *
 * Names are file-unique ("batt:*").
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetBehaviorsForTests, defineBehavior } from "../src/behavior/define-behavior";
import { PrefabId, createCanvasEngine, defineQuery, defineWidget, widgets } from "../src";
import type { CanvasEngine, Entity } from "../src";
import { p } from "../src/widget/props";

const Sticky = defineBehavior("batt:sticky", {
  store: "durable",
  schema: { note: p.string({ default: "hi" }) },
});
const Hover = defineBehavior("batt:hover", {
  store: "runtime",
  schema: { lift: p.number({ default: 0 }) },
});
const Loose = defineBehavior("batt:loose", {
  store: "runtime",
  schema: { n: p.number({ default: 0 }) },
});

/** Every card, however it got here. Module scope: defineQuery identity is the cache key. */
const cardQ = defineQuery([PrefabId, Sticky.component]);

const CARD =
  widgets.get("batt:card") ??
  defineWidget({
    type: "batt:card",
    surface: "dom",
    component: null,
    defaultSize: { w: 10, h: 10 },
    behaviors: [Sticky.with({ note: "pinned" }), Hover],
  });

let ce: CanvasEngine;
let frame = 0;

beforeEach(async () => {
  ce = createCanvasEngine({ widgets: [CARD], behaviors: [Sticky, Hover, Loose] });
  await ce.docs.create();
  frame = 0;
});

afterEach(() => {
  ce.dispose();
});

function step(): void {
  frame += 16;
  ce.step(frame);
}

function spawn(): Entity {
  const e = ce.ops.spawnWidget("batt:card", { x: 0, y: 0, undoable: false });
  ce.world.sync();
  return e;
}

describe("widget pre-attachment", () => {
  it("puts a DURABLE behavior in the document, with its declared data", () => {
    const e = spawn();
    expect(ce.world.get(e, Sticky.component)).toEqual({ note: "pinned" });
    // Document truth, not a session rider: it is in the doc, so it syncs.
    expect(ce.docs.current()?.store.getComponent(e, Sticky.component)).toEqual({ note: "pinned" });
  });

  it("stamps a RUNTIME behavior at projection, and keeps it OUT of the document", () => {
    const e = spawn();
    step(); // the equip pass runs in `derive`
    expect(ce.world.get(e, Hover.component)).toEqual({ lift: 0 });
    expect(ce.docs.current()?.store.getComponent(e, Hover.component)).toBeUndefined();
  });

  it("equips a widget that arrived WITHOUT running a spawn — the peer/restore path", () => {
    spawn();
    const bytes = ce.docs.current()?.exportEnvelope() as Uint8Array;
    ce.docs.close();
    expect(ce.docs.open(bytes).ok).toBe(true);
    ce.world.sync();
    step();

    // Nothing here ran `spawnWidget`. The durable half arrives by projection;
    // the runtime half is the equip pass's job — which is exactly why runtime
    // riders are stamped there and not at spawn.
    let found: Entity | undefined;
    ce.world.query(cardQ).each((b) => {
      for (const r of b) found ??= b.entity(r);
    });
    expect(found).toBeDefined();
    expect(ce.world.get(found as Entity, Sticky.component)).toEqual({ note: "pinned" });
    expect(ce.world.get(found as Entity, Hover.component)).toEqual({ lift: 0 });
  });

  it("refuses an EPHEMERAL behavior at definition time", () => {
    const Facet = defineBehavior("batt:facet", { store: "ephemeral", schema: { t: p.string() } });
    expect(() =>
      defineWidget({
        type: "batt:bad",
        surface: "dom",
        component: null,
        behaviors: [Facet],
      }),
    ).toThrow(/local presence peer/);
  });
});

describe("engine.behaviors", () => {
  it("attaches, reads and detaches a runtime behavior", () => {
    const e = spawn();
    expect(ce.behaviors.has(e, Loose)).toBe(false);

    ce.behaviors.attach(e, Loose, { n: 5 });
    expect(ce.behaviors.has(e, Loose)).toBe(true);
    expect(ce.behaviors.read(e, Loose)).toEqual({ n: 5 });

    // Attach-when-attached is an idempotent no-op that PRESERVES data.
    ce.behaviors.attach(e, Loose);
    expect(ce.behaviors.read(e, Loose)).toEqual({ n: 5 });

    ce.behaviors.detach(e, Loose);
    expect(ce.behaviors.has(e, Loose)).toBe(false);
    expect(ce.behaviors.read(e, Loose)).toBeUndefined();
  });

  it("REFUSES durable attach — that is a document op", () => {
    const e = spawn();
    expect(() => ce.behaviors.attach(e, Sticky)).toThrow(/use tx\.attach|document op/i);
    expect(() => ce.behaviors.detach(e, Sticky)).toThrow(/document op/i);
  });

  it("lists every registered behavior for devtools and the doctor", () => {
    const e = spawn();
    ce.behaviors.attach(e, Loose);
    step();
    const rows = ce.behaviors.list();
    expect(rows.map((r) => r.name).sort()).toEqual(["batt:hover", "batt:loose", "batt:sticky"]);
    const loose = rows.find((r) => r.name === "batt:loose");
    expect(loose?.store).toBe("runtime");
    expect(loose?.instances).toBe(1);
    expect(loose?.suspended).toBe(false);
    // Every behavior is also a guest row, sharing ONE breaker with the rest.
    expect(ce.engine.guests.list().some((g) => g.id === "behavior:batt:loose")).toBe(true);
  });

  it("runs only what THIS engine registered", () => {
    // A behavior that was defined but never registered with this engine costs
    // nothing and does nothing — "a plugin declared it" and "this engine runs
    // it" are deliberately separable.
    const solo = createCanvasEngine({ widgets: [CARD] });
    expect(solo.behaviors.list()).toEqual([]);
    solo.dispose();
  });
});
