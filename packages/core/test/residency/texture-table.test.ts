import type { Entity } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import { createTextureTable, type TextureHandle } from "../../src/residency/texture-table";

const ent = (n: number): Entity => n as Entity;
/** `NO_TEXTURE` — "no destination". Not exported (A1a's catalog is its home). */
const NONE: TextureHandle = 0;
/** Realisation is Phase B's; A2 only round-trips the seam. */
const fakeTexture = (label: string): GPUTexture => ({ label }) as unknown as GPUTexture;

describe("handles", () => {
  it("count from 1, so 0 is never one", () => {
    const table = createTextureTable();
    expect(table.own(64, 64)).toBe(1);
    expect(table.own(64, 64)).toBe(2);
    expect(table.pages()).toBe(3);
    expect(table.describe(NONE)).toBeUndefined();
    expect(table.refs(NONE)).toBe(0);
  });

  it("describe reports each kind's shape", () => {
    const table = createTextureTable({ pageSize: 4096 });
    expect(table.describe(table.pages())).toEqual({
      kind: "pages",
      size: 4096,
      layers: 0,
      srgb: false,
    });
    expect(table.describe(table.own(300, 180, true))).toEqual({
      kind: "own",
      width: 300,
      height: 180,
      srgb: true,
    });
    expect(table.describe(table.own(300, 180))).toMatchObject({ srgb: false });
    expect(table.describe(table.register(ent(7), { width: 1920, height: 1080, srgb: true }))).toEqual({
      kind: "stable",
      width: 1920,
      height: 1080,
      srgb: true,
    });
    expect(table.describe(999)).toBeUndefined();
  });
});

describe("the pages singleton", () => {
  it("is minted once and follows the allocator's layer count", () => {
    const table = createTextureTable();
    const first = table.pages();
    expect(table.pages()).toBe(first);
    expect(table.describe(first)).toMatchObject({ size: 2048, layers: 0 });

    table.setPageLayers(3);
    expect(table.describe(first)).toMatchObject({ kind: "pages", layers: 3 });
    expect(table.pages()).toBe(first);
  });

  it("never drains, because the atlas outlives every card in it", () => {
    const table = createTextureTable();
    const pages = table.pages();
    expect(table.refs(pages)).toBe(1); // the table's own reference

    table.retain(pages);
    table.release(pages);
    expect(table.refs(pages)).toBe(1);
    expect(table.drain()).toEqual([]);
    expect(table.describe(pages)).toBeDefined();
  });

  it("setPageLayers means nothing before the atlas exists", () => {
    const table = createTextureTable();
    table.setPageLayers(4);
    expect(table.describe(1)).toBeUndefined();
    expect(table.pages()).toBe(1);
    expect(table.describe(1)).toMatchObject({ layers: 0 });
  });
});

describe("refcounting and the drain", () => {
  it("lands a handle in drain() exactly once when its count reaches zero", () => {
    const table = createTextureTable();
    const own = table.own(128, 128);
    expect(table.refs(own)).toBe(0);

    expect(table.retain(own)).toBe(1);
    expect(table.retain(own)).toBe(2);
    expect(table.release(own)).toBe(1);
    expect(table.drain()).toEqual([]); // still referenced

    expect(table.release(own)).toBe(0);
    expect(table.drain()).toEqual([own]);
    expect(table.drain()).toEqual([]); // exactly once
    expect(table.describe(own)).toBeUndefined(); // and forgotten with it
  });

  it("never drains a handle that was minted and never retained", () => {
    const table = createTextureTable();
    const own = table.own(128, 128);
    expect(table.drain()).toEqual([]);
    expect(table.describe(own)).toBeDefined();
  });

  it("does not drain a handle re-retained before the drain", () => {
    const table = createTextureTable();
    const own = table.own(128, 128);
    table.retain(own);
    table.release(own);
    expect(table.retain(own)).toBe(1); // taken back inside the frame
    expect(table.drain()).toEqual([]);
    expect(table.describe(own)).toBeDefined();

    // …and it still drains the next time it reaches zero.
    table.release(own);
    expect(table.drain()).toEqual([own]);
  });

  it("drains in the order the handles died", () => {
    const table = createTextureTable();
    const a = table.own(1, 1);
    const b = table.own(2, 2);
    for (const h of [a, b]) table.retain(h);
    table.release(b);
    table.release(a);
    expect(table.drain()).toEqual([b, a]);
  });

  it("treats NO_TEXTURE and an unknown handle as nothing to count", () => {
    const table = createTextureTable();
    expect(table.retain(NONE)).toBe(0);
    expect(table.release(NONE)).toBe(0);
    expect(table.retain(999)).toBe(0);
    expect(table.release(999)).toBe(0);
    expect(table.drain()).toEqual([]);
  });

  it("never counts below zero", () => {
    const table = createTextureTable();
    const own = table.own(64, 64);
    expect(table.release(own)).toBe(0);
    expect(table.refs(own)).toBe(0);
    expect(table.drain()).toEqual([]);
  });
});

describe("registered stable textures (Q5)", () => {
  it("answers stableOf, and 0 for an entity that registered nothing", () => {
    const table = createTextureTable();
    expect(table.stableOf(ent(3))).toBe(NONE);
    const handle = table.register(ent(3), { width: 640, height: 480, srgb: false });
    expect(table.stableOf(ent(3))).toBe(handle);
    expect(table.refs(handle)).toBe(1); // the registration IS a reference
  });

  it("registering twice replaces the first and drains it", () => {
    const table = createTextureTable();
    const first = table.register(ent(3), { width: 640, height: 480, srgb: false });
    const second = table.register(ent(3), { width: 1280, height: 720, srgb: true });

    expect(second).not.toBe(first);
    expect(table.stableOf(ent(3))).toBe(second);
    expect(table.refs(first)).toBe(0);
    expect(table.drain()).toEqual([first]);
    expect(table.describe(first)).toBeUndefined();
    expect(table.describe(second)).toMatchObject({ width: 1280, srgb: true });
  });

  it("holds the old handle while a card still references it", () => {
    const table = createTextureTable();
    const first = table.register(ent(3), { width: 640, height: 480, srgb: false });
    table.retain(first); // a TextureRef names it
    table.register(ent(3), { width: 1280, height: 720, srgb: true });
    expect(table.refs(first)).toBe(1);
    expect(table.drain()).toEqual([]);

    table.release(first); // the next Residency walk rewrites the ref
    expect(table.drain()).toEqual([first]);
  });

  it("unregister drops the entity and releases its reference", () => {
    const table = createTextureTable();
    const handle = table.register(ent(3), { width: 640, height: 480, srgb: false });
    expect(table.unregister(ent(3))).toBe(true);
    expect(table.unregister(ent(3))).toBe(false);
    expect(table.stableOf(ent(3))).toBe(NONE);
    expect(table.drain()).toEqual([handle]);
  });
});

describe("realisation — Phase B's seam", () => {
  it("round-trips a texture against its handle", () => {
    const table = createTextureTable();
    const own = table.own(64, 64);
    const texture = fakeTexture("own");
    expect(table.realized(own)).toBeUndefined();
    expect(table.realize(own, texture)).toBe(true);
    expect(table.realized(own)).toBe(texture);
    expect(table.realize(999, texture)).toBe(false);
  });

  it("forgets the realisation when the handle drains", () => {
    const table = createTextureTable();
    const own = table.own(64, 64);
    table.realize(own, fakeTexture("own"));
    table.retain(own);
    table.release(own);
    expect(table.drain()).toEqual([own]);
    expect(table.realized(own)).toBeUndefined();
  });
});

describe("dispose", () => {
  it("empties the table without ever reusing a handle", () => {
    const table = createTextureTable();
    const pages = table.pages();
    const own = table.own(64, 64);
    const stable = table.register(ent(3), { width: 8, height: 8, srgb: false });
    table.realize(own, fakeTexture("own"));
    table.retain(own);

    table.dispose();

    expect(table.describe(pages)).toBeUndefined();
    expect(table.describe(own)).toBeUndefined();
    expect(table.describe(stable)).toBeUndefined();
    expect(table.refs(own)).toBe(0);
    expect(table.realized(own)).toBeUndefined();
    expect(table.stableOf(ent(3))).toBe(NONE);
    expect(table.drain()).toEqual([]);
    expect(table.pages()).toBeGreaterThan(stable);
  });
});
