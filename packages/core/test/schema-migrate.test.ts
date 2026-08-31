/**
 * Structural schema migration 1 → 2 (petition 8): board root + StackZ → ordered ChildOf.
 *
 * Hand-crafts GENUINE schema-1 documents at the raw Loro layer (the migrate.test.ts
 * convention — `engine.schema.1` stamped explicitly, scalar StackZ cells, ChildOf edges as
 * plain `rel1:` values) and proves the open path: the structural step mints the board root,
 * rewrites the z ranking into per-parent sibling order by `(z asc, key asc)`, stamps
 * `engine.schema.2`, and re-gates writable. The joiner path (migrate: false) must do NONE of
 * that — single-writer law. The create path mints the board root from birth.
 */
import { LoroDoc, LoroMap } from "loro-crdt";
import { describe, expect, it } from "vitest";
import {
  BoardRoot,
  ChildOf,
  ENGINE_SCHEMA_VERSION,
  StackZ,
  createDocSession,
  createWorld,
  defineWidget,
  encodeEnvelope,
  openDocSession,
  p,
  PrefabId,
  type EnvelopeHeader,
} from "../src";

const BOX = "smig:box";
defineWidget({
  type: BOX,
  surface: "dom",
  component: {},
  props: { label: p.string({ default: "" }) },
});

/** A schema-1 doc: widgets with scalar z; `cont-1` is a widget with one child. */
function buildSchema1Envelope(): Uint8Array {
  const doc = new LoroDoc();
  const entities = doc.getMap("entities");
  const put = (key: string, z: number, parent?: string): void => {
    const child = entities.setContainer(key, new LoroMap());
    child.set("exists", true);
    child.set("comp:PrefabId", { id: BOX });
    child.set(`comp:${BOX}:props`, { label: key });
    child.set("comp:StackZ", { z });
    if (parent !== undefined) child.set("rel1:ChildOf", parent);
  };
  // Root level: z 5 / 1 / 1 (the tie breaks by key: "seed-b" < "seed-c") + the container at z 9.
  put("seed-a", 5);
  put("seed-b", 1);
  put("seed-c", 1);
  put("cont-1", 9);
  put("kid-2", 4, "cont-1");
  put("kid-1", 2, "cont-1");

  const meta = doc.getMap("meta");
  meta.set("engine.schema.1", true); // GENUINE v1 — not ENGINE_SCHEMA_VERSION
  meta.set(`engine.pack.${BOX}.1`, true);
  doc.commit();

  const header: EnvelopeHeader = { engineSchema: 1, prefabVersions: { [BOX]: 1 } };
  return encodeEnvelope(header, doc.export({ mode: "snapshot" }));
}

describe("schema migration 1→2 (solo open)", () => {
  it("mints the board root, orders every parent scope by (z asc, key asc), stamps schema 2, re-gates writable", () => {
    const world = createWorld();
    const result = openDocSession(world, buildSchema1Envelope());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { session } = result;
    expect(session.readOnly).toBe(false); // schema stamped + packs current → writable
    expect(session.report?.docSchema).toBe(ENGINE_SCHEMA_VERSION);

    world.sync();
    const rootRes = world.getResource(BoardRoot);
    expect(rootRes).toBeDefined();
    const root = (rootRes as { root: Parameters<typeof world.isAlive>[0] }).root;
    expect(world.isAlive(root)).toBe(true);
    expect(world.get(root, PrefabId)).toBeUndefined(); // componentless BY LAW

    // Root scope order: (z asc, key asc) → seed-b(1) seed-c(1) seed-a(5) cont-1(9).
    const store = session.store;
    const rootOrder = world.getReverse(root, ChildOf).map((e) => store.keyOf(e));
    expect(rootOrder).toEqual(["seed-b", "seed-c", "seed-a", "cont-1"]);

    // Container scope: kid-1(2) before kid-2(4).
    const cont = store.resolve("cont-1" as Parameters<typeof store.resolve>[0]);
    expect(cont).toBeDefined();
    const contOrder = world.getReverse(cont as NonNullable<typeof cont>, ChildOf).map((e) => store.keyOf(e));
    expect(contOrder).toEqual(["kid-1", "kid-2"]);

    // Legacy z cells are KEPT (old builds reading the migrated doc stay z-correct).
    const seedA = store.resolve("seed-a" as Parameters<typeof store.resolve>[0]);
    expect(seedA).toBeDefined();
    expect(store.getComponent(seedA as NonNullable<typeof seedA>, StackZ)).toBeDefined();
  });

  it("round-trips: a migrated doc re-opens 'ok' with no second migration and the same order", () => {
    const world = createWorld();
    const first = openDocSession(world, buildSchema1Envelope());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    world.sync();
    const reexported = first.session.exportEnvelope();
    first.session.close();

    const world2 = createWorld();
    const second = openDocSession(world2, reexported);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.session.report?.docSchema).toBe(ENGINE_SCHEMA_VERSION);
    expect(second.session.readOnly).toBe(false);
    world2.sync();
    const root2 = (world2.getResource(BoardRoot) as { root: Parameters<typeof world2.isAlive>[0] }).root;
    const order2 = world2.getReverse(root2, ChildOf).map((e) => second.session.store.keyOf(e));
    expect(order2).toEqual(["seed-b", "seed-c", "seed-a", "cont-1"]);
  });
});

describe("single-writer law (joiner path)", () => {
  it("migrate:false leaves a schema-1 doc read-only, unstamped, and rootless", () => {
    const world = createWorld();
    const result = openDocSession(world, buildSchema1Envelope(), { migrate: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.readOnly).toBe(true);
    expect(result.session.report?.docSchema).toBe(1); // nothing stamped
    expect(world.getResource(BoardRoot)).toBeUndefined(); // nothing minted, nothing named
  });
});

describe("create path", () => {
  it("a fresh doc carries the board root from birth", () => {
    const world = createWorld();
    const session = createDocSession(world);
    const rootRes = world.getResource(BoardRoot);
    expect(rootRes).toBeDefined();
    const root = (rootRes as { root: Parameters<typeof world.isAlive>[0] }).root;
    expect(world.isAlive(root)).toBe(true);
    expect(session.store.keyOf(root)).toBeDefined(); // durable, key-bound
    session.close();
  });
});
