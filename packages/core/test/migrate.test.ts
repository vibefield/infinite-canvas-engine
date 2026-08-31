/**
 * M9 version-skew exit (design-005 §6.4) — the read-repair migrator end to end.
 *
 * The hard part of testing a migration is producing an OLD document: a widget
 * type can be registered only once per process, so we cannot re-`defineWidget`
 * "mig:card" at v1 to author a v1 doc. Instead we HAND-CRAFT the v1 doc at the
 * raw Loro layer (strata-ecs loro-snapshot.ts:156-160 layout: root "entities"
 * map → per-entity child map with keys `"exists"`, `"comp:<Name>"`, `"tag:..."`).
 * Writing a plain field object under `"comp:mig:card:props"` lets us store a
 * GENUINE v1 cell — the v1 field set, missing v2's added fields — under the same
 * component NAME the local v2 schema registers. That is exactly what proves the
 * load-bearing field-tolerance claim: strata projects that v1 cell through the
 * v2 schema, dropping nothing it recognises and DEFAULT-FILLING the fields v2
 * added, so the migrate transform reads a complete v2-shaped `prev`.
 */
import { LoroDoc, LoroMap } from "loro-crdt";
import { describe, expect, it } from "vitest";
import {
  ENGINE_SCHEMA_VERSION,
  DefaultCanvasType,
  ROOT_CANVAS_META_KEY,
  canvasIdentityOf,
  canvasPackId,
  createWorld,
  defineQuery,
  defineWidget,
  encodeEnvelope,
  encodeCanvasIdentity,
  gateVerdict,
  openDocSession,
  p,
  PrefabId,
  readDocVersionReport,
  type EnvelopeHeader,
  type WidgetType,
} from "../src";

/** The first (ungrouped "props") group of a test widget — throws instead of `!`. */
function firstGroup(widget: WidgetType) {
  const g = widget.groups[0];
  if (g === undefined) throw new Error(`ice test: widget "${widget.type}" has no groups`);
  return g;
}

// --- the v2 widgets (registered once for the whole file) --------------------

const CARD = "mig:card";
type CardProps = { title: string; weight: number; status: string };

// v2 of mig:card. `status` is ADDED relative to v1 — the field-tolerance target:
// a v1 cell that never carried `status` must project with its default "draft",
// and the transform must be able to read that default from `prev`. The transform
// flips a correctly-defaulted "draft" to "published" (and to "ERR" otherwise), so
// asserting the final "published" proves the missing field defaulted AND was read.
const card = defineWidget({
  type: CARD,
  version: 2,
  surface: "dom",
  component: {},
  props: {
    title: p.string({ default: "" }),
    weight: p.number({ default: 1 }),
    status: p.enum(["draft", "published"], { default: "draft" }),
  },
  migrate: {
    1: (prev) => ({
      title: prev.title,
      weight: (prev.weight as number) / 1000, // v1 stored milli-units; v2 stores units
      status: prev.status === "draft" ? "published" : "ERR",
    }),
  },
});
const cardProps = firstGroup(card).component; // one ungrouped "props" group

const NOCHAIN = "mig:nochain";
const nochain = defineWidget({
  type: NOCHAIN,
  version: 2,
  surface: "dom",
  component: {},
  props: { title: p.string({ default: "" }) },
  // no migrate chain
});

// --- raw v1-doc construction (the sanctioned hand-craft) --------------------

const cardGroupName = cardProps.name; // "mig:card:props"

/** Build an envelope wrapping a hand-crafted v1 document for one widget type. */
function buildV1Envelope(opts: {
  type: string;
  groupName: string;
  groupValue: Record<string, unknown>;
  packVersion: number;
  entityKey?: string;
}): Uint8Array {
  const doc = new LoroDoc();
  const entities = doc.getMap("entities");
  const child = entities.setContainer(opts.entityKey ?? "seed-0", new LoroMap());
  child.set("exists", true);
  child.set("comp:PrefabId", { id: opts.type });
  child.set(`comp:${opts.groupName}`, opts.groupValue);

  const meta = doc.getMap("meta");
  meta.set(`engine.schema.${ENGINE_SCHEMA_VERSION}`, true);
  meta.set(`engine.pack.${opts.type}.${opts.packVersion}`, true);
  const rootCanvas = canvasIdentityOf(DefaultCanvasType);
  meta.set(ROOT_CANVAS_META_KEY, encodeCanvasIdentity(rootCanvas));
  meta.set(
    `engine.pack.${canvasPackId(rootCanvas.id)}.${rootCanvas.semanticVersion}`,
    true,
  );
  doc.commit();

  const header: EnvelopeHeader = {
    engineSchema: ENGINE_SCHEMA_VERSION,
    prefabVersions: {
      [opts.type]: opts.packVersion,
      [canvasPackId(rootCanvas.id)]: rootCanvas.semanticVersion,
    },
    rootCanvas,
  };
  return encodeEnvelope(header, doc.export({ mode: "snapshot" }));
}

const durableQ = defineQuery([PrefabId]);

function onlyEntityOf(world: ReturnType<typeof createWorld>, type: string) {
  const e = world.firstOf(durableQ);
  if (e === undefined) throw new Error(`no ${type} entity projected`);
  if (world.read(e, PrefabId).id !== type) throw new Error(`unexpected prefab: ${world.read(e, PrefabId).id}`);
  return e;
}

// --- 1. the full migration path (field tolerance + transform + marker) ------

describe("openDocSession: migrate verdict runs the read-repair migrator", () => {
  it("upgrades a v1 doc in place, proves field tolerance, and re-gates to writable", () => {
    // v1 cell is genuinely missing v2's `status` field (field-tolerance target).
    const bytes = buildV1Envelope({
      type: CARD,
      groupName: cardGroupName,
      groupValue: { title: "hello", weight: 5000 },
      packVersion: 1,
    });

    const world = createWorld();
    const result = openDocSession(world, bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Re-gate flipped it writable: the migrator stamped engine.pack.mig:card.2.
    expect(result.session.readOnly).toBe(false);
    const report = result.session.report;
    expect(report).toBeDefined();
    if (!report) return;
    expect(report.docPacks[CARD]).toBe(2);
    expect(gateVerdict(report)).toBe("ok");

    world.sync();
    const e = onlyEntityOf(world, CARD);
    const props = world.read(e, cardProps) as CardProps;
    expect(props.title).toBe("hello"); // preserved by the transform
    expect(props.weight).toBe(5); // 5000 / 1000 — the transform ran
    expect(props.status).toBe("published"); // proves `status` defaulted to "draft" at projection AND was read
  });

  // --- 4. no chain → read-only preserved (grouped here; same shape as case 1) ---
  it("leaves a type with NO migrate chain read-only", () => {
    const bytes = buildV1Envelope({
      type: NOCHAIN,
      groupName: firstGroup(nochain).component.name,
      groupValue: { title: "old" },
      packVersion: 1,
    });

    const world = createWorld();
    const result = openDocSession(world, bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.session.readOnly).toBe(true); // migrator skipped it; re-gate still "migrate"
    const report = result.session.report;
    expect(report).toBeDefined();
    if (!report) return;
    expect(gateVerdict(report)).toBe("migrate");
    expect(report.docPacks[NOCHAIN]).toBe(1); // no v2 marker stamped
  });
});

// --- 2. undo neutrality -----------------------------------------------------

describe("migration is undo-neutral", () => {
  it("adds no undo step; a later user edit undoes to the MIGRATED value, not the v1 value", () => {
    const bytes = buildV1Envelope({
      type: CARD,
      groupName: cardGroupName,
      groupValue: { title: "hello", weight: 5000 },
      packVersion: 1,
    });

    const world = createWorld();
    const result = openDocSession(world, bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { store } = result.session;

    // The migration never entered the undo stack.
    expect(store.canUndo()).toBe(false);

    world.sync();
    const e = onlyEntityOf(world, CARD);

    // One ordinary (undoable) user edit.
    store.transaction((tx) => {
      tx.edit(e).set(cardProps, { title: "edited", weight: 5, status: "published" });
    });
    expect(store.canUndo()).toBe(true);
    world.sync();
    expect((world.read(e, cardProps) as CardProps).title).toBe("edited");

    // Undo reverts THAT edit — back to the migrated value, not the v1 value.
    expect(store.undo()).toBe(true);
    world.sync();
    const props = world.read(e, cardProps) as CardProps;
    expect(props.title).toBe("hello");
    expect(props.weight).toBe(5); // the MIGRATED weight (not v1's 5000)
    expect(props.status).toBe("published"); // the MIGRATED status survives — undo did not cross the migration
    expect(store.canUndo()).toBe(false); // stack empty: migration was never on it
  });
});

// --- 3. convergence under concurrent migrators ------------------------------

describe("concurrent migrators converge", () => {
  it("two peers migrate the same v1 doc; cross-pumped snapshots agree, one marker each", () => {
    const bytes = buildV1Envelope({
      type: CARD,
      groupName: cardGroupName,
      groupValue: { title: "hello", weight: 5000 },
      packVersion: 1,
    });

    const worldA = createWorld();
    const a = openDocSession(worldA, bytes);
    const worldB = createWorld();
    const b = openDocSession(worldB, bytes);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    // Each migrated independently off the v1 projection.
    expect(a.session.readOnly).toBe(false);
    expect(b.session.readOnly).toBe(false);

    // Cross-pump the migrated snapshots both ways.
    a.session.applyRemote(b.session.exportSnapshot());
    b.session.applyRemote(a.session.exportSnapshot());
    worldA.sync();
    worldB.sync();

    const pa = worldA.read(onlyEntityOf(worldA, CARD), cardProps) as CardProps;
    const pb = worldB.read(onlyEntityOf(worldB, CARD), cardProps) as CardProps;
    expect(pa).toEqual(pb); // idempotent absolute writes merged identically
    expect(pa).toEqual({ title: "hello", weight: 5, status: "published" });

    // The pack-2 marker is present on both merged docs (write-once ADD → once each).
    const reportA = readDocVersionReport(importDoc(a.session.exportSnapshot()));
    const reportB = readDocVersionReport(importDoc(b.session.exportSnapshot()));
    expect(reportA.docPacks[CARD]).toBe(2);
    expect(reportB.docPacks[CARD]).toBe(2);
  });
});

function importDoc(snapshot: Uint8Array): LoroDoc {
  const doc = new LoroDoc();
  doc.import(snapshot);
  return doc;
}

// --- 4. atomicity: a faulting transform aborts with the doc UNTOUCHED -------

const BOOM = "mig:boom";
const boom = defineWidget({
  type: BOOM,
  version: 2,
  surface: "dom",
  component: {},
  props: { label: p.string({ default: "" }) },
  migrate: {
    1: () => {
      throw new Error("transform boom");
    },
  },
});
const boomGroupName = firstGroup(boom).component.name;

/** A v1 doc holding BOTH a card and a boom entity (two types, two pack markers). */
function buildTwoTypeV1Envelope(): Uint8Array {
  const doc = new LoroDoc();
  const entities = doc.getMap("entities");
  const c = entities.setContainer("card-0", new LoroMap());
  c.set("exists", true);
  c.set("comp:PrefabId", { id: CARD });
  c.set(`comp:${cardGroupName}`, { title: "keep", weight: 2000 });
  const b = entities.setContainer("boom-0", new LoroMap());
  b.set("exists", true);
  b.set("comp:PrefabId", { id: BOOM });
  b.set(`comp:${boomGroupName}`, { label: "x" });
  const meta = doc.getMap("meta");
  meta.set(`engine.schema.${ENGINE_SCHEMA_VERSION}`, true);
  meta.set(`engine.pack.${CARD}.1`, true);
  meta.set(`engine.pack.${BOOM}.1`, true);
  const rootCanvas = canvasIdentityOf(DefaultCanvasType);
  meta.set(ROOT_CANVAS_META_KEY, encodeCanvasIdentity(rootCanvas));
  meta.set(
    `engine.pack.${canvasPackId(rootCanvas.id)}.${rootCanvas.semanticVersion}`,
    true,
  );
  doc.commit();
  const header: EnvelopeHeader = {
    engineSchema: ENGINE_SCHEMA_VERSION,
    prefabVersions: {
      [CARD]: 1,
      [BOOM]: 1,
      [canvasPackId(rootCanvas.id)]: rootCanvas.semanticVersion,
    },
    rootCanvas,
  };
  return encodeEnvelope(header, doc.export({ mode: "snapshot" }));
}

describe("a faulting transform aborts with the doc UNTOUCHED (2026-07-13 review)", () => {
  it("plans ALL types before writing: CARD stays v1 when BOOM's transform throws; the report tells the truth", () => {
    const world = createWorld();
    const result = openDocSession(world, buildTwoTypeV1Envelope());
    if (!result.ok) throw new Error(`open failed: ${result.reason}`);
    const session = result.session;

    // The fault fell back read-only…
    expect(session.readOnly).toBe(true);

    // …with NOTHING half-migrated: the card kept its v1 value (the transform
    // would have divided weight by 1000 — the old per-type commit order let
    // CARD land permanently while BOOM aborted the open).
    world.sync();
    let cardEntity: ReturnType<typeof world.firstOf> | undefined;
    let entityCount = 0;
    world.query(durableQ).each((batch) => {
      for (const row of batch) {
        entityCount++;
        const e = batch.entity(row);
        if (world.read(e, PrefabId).id === CARD) cardEntity = e;
      }
    });
    expect(entityCount).toBe(2);
    if (cardEntity === undefined) throw new Error("card entity not projected");
    const props = world.get(cardEntity, cardProps) as CardProps;
    expect(props.weight).toBe(2000); // NOT 2 — no partial migration

    // …and session.report matches the doc AS IS: both types still older, still gated.
    const report = session.report;
    if (report === undefined) throw new Error("session.report missing");
    expect([...report.olderInDoc].sort()).toEqual([BOOM, CARD].sort());
    expect(gateVerdict(report)).toBe("migrate");
  });
});
