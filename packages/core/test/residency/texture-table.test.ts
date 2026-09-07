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

/** A REALISED own texture — the only kind the drain list carries (the forget rule). */
function realisedOwn(table: ReturnType<typeof createTextureTable>, w: number, h: number): TextureHandle {
  const handle = table.own(w, h);
  table.realize(handle, fakeTexture(`own ${w}x${h}`));
  return handle;
}

describe("refcounting and the drain", () => {
  it("lands a REALISED handle in drain() exactly once when its count reaches zero", () => {
    const table = createTextureTable();
    const own = realisedOwn(table, 128, 128);
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

  it("does not drain a realised handle re-retained before the drain", () => {
    const table = createTextureTable();
    const own = realisedOwn(table, 128, 128);
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
    const a = realisedOwn(table, 1, 1);
    const b = realisedOwn(table, 2, 2);
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

/**
 * THE FORGET RULE. `drain()` is the DESTROY list, so what enters it is what has
 * a `GPUTexture` behind it. Everything else has to leave the table the moment
 * it dies, because in Phase A nothing drains at all: `ownFor` re-mints on every
 * size change, so a resize drag on a gl island minted one dead entry per frame
 * that no reflector would ever collect.
 */
describe("the forget rule — an unrealised handle is not a destroy-list entry", () => {
  it("forgets an unrealised handle the moment its count reaches zero", () => {
    const table = createTextureTable();
    const own = table.own(128, 128);
    table.retain(own);
    expect(table.release(own)).toBe(0);

    expect(table.describe(own), "gone, not queued").toBeUndefined();
    expect(table.refs(own)).toBe(0);
    expect(table.drain(), "nothing for a reflector to destroy").toEqual([]);
  });

  it("a realised one in the same run still drains — the control", () => {
    // Without this the case above passes for a table that simply drains nothing.
    const table = createTextureTable();
    const bare = table.own(8, 8);
    const realised = realisedOwn(table, 8, 8);
    for (const h of [bare, realised]) table.retain(h);
    table.release(bare);
    table.release(realised);
    expect(table.drain()).toEqual([realised]);
    expect(table.describe(bare)).toBeUndefined();
  });

  it("does not grow across a re-mint churn: 40 dead own textures leave 0 entries", () => {
    // The table exposes no size, so count what it still ANSWERS for — the same
    // question a leak would make loud. Handles count from 1, so the probe range
    // covers every handle this loop could have minted.
    const table = createTextureTable();
    let previous = 0;
    for (let i = 0; i < 40; i++) {
      const next = table.own(64 + i, 64);
      table.retain(next);
      if (previous !== 0) table.release(previous);
      previous = next;
    }
    const live = Array.from({ length: 128 }, (_, i) => i + 1).filter(
      (h) => table.describe(h) !== undefined,
    );
    expect(live, "only the handle still referenced").toEqual([previous]);
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
    table.realize(first, fakeTexture("stable")); // a producer's texture is realised by definition
    const second = table.register(ent(3), { width: 1280, height: 720, srgb: true });

    expect(second).not.toBe(first);
    expect(table.stableOf(ent(3))).toBe(second);
    expect(table.refs(first)).toBe(0);
    expect(table.drain()).toEqual([first]);
    expect(table.describe(first)).toBeUndefined();
    expect(table.describe(second)).toMatchObject({ width: 1280, srgb: true });
  });

  it("forgets a replaced registration that was never realised", () => {
    const table = createTextureTable();
    const first = table.register(ent(3), { width: 640, height: 480, srgb: false });
    table.register(ent(3), { width: 1280, height: 720, srgb: true });
    expect(table.describe(first)).toBeUndefined();
    expect(table.drain()).toEqual([]);
  });

  it("holds the old handle while a card still references it", () => {
    const table = createTextureTable();
    const first = table.register(ent(3), { width: 640, height: 480, srgb: false });
    table.realize(first, fakeTexture("stable"));
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
    table.realize(handle, fakeTexture("stable"));
    expect(table.unregister(ent(3))).toBe(true);
    expect(table.unregister(ent(3))).toBe(false);
    expect(table.stableOf(ent(3))).toBe(NONE);
    expect(table.drain()).toEqual([handle]);
  });

  /**
   * The table is keyed by entity and has no view of the world, so a caller that
   * must reconcile registrations against LIFE — Residency's `world.reset()`
   * sweep, whose dead entities never reach the removal journal — needs the
   * owners to iterate.
   */
  it("names every entity holding a registration, and forgets one on unregister", () => {
    const table = createTextureTable();
    expect(table.stableOwners()).toEqual([]);
    table.register(ent(3), { width: 8, height: 8, srgb: false });
    table.register(ent(9), { width: 8, height: 8, srgb: false });
    expect(new Set(table.stableOwners())).toEqual(new Set([ent(3), ent(9)]));

    table.register(ent(3), { width: 16, height: 16, srgb: false }); // replace, not add
    expect(new Set(table.stableOwners())).toEqual(new Set([ent(3), ent(9)]));
    table.unregister(ent(3));
    expect(table.stableOwners()).toEqual([ent(9)]);
  });
});

/**
 * A registration is not a world change — nothing journals it — so a
 * change-gated consumer needs a number to compare. Residency's guard compares
 * this one; without it a producer's `register` reached the world only when some
 * unrelated write happened to wake the walk.
 */
describe("the revision counter", () => {
  it("counts registers and unregisters, and nothing else", () => {
    const table = createTextureTable();
    const at0 = table.revision();

    const handle = table.register(ent(3), { width: 8, height: 8, srgb: false });
    expect(table.revision()).not.toBe(at0);
    const afterRegister = table.revision();

    // Everything that is NOT a registration leaves it alone.
    table.pages();
    table.own(16, 16);
    table.retain(handle);
    table.release(handle);
    table.setPageLayers(3);
    table.drain();
    expect(table.revision()).toBe(afterRegister);

    table.register(ent(3), { width: 16, height: 16, srgb: false }); // a replace counts
    const afterReplace = table.revision();
    expect(afterReplace).not.toBe(afterRegister);

    expect(table.unregister(ent(9))).toBe(false); // dropped nothing…
    expect(table.revision(), "an unregister that dropped nothing is not a change").toBe(afterReplace);
    table.unregister(ent(3));
    expect(table.revision()).not.toBe(afterReplace);
  });

  it("counts up past a dispose, so a stale number never reads as unchanged", () => {
    const table = createTextureTable();
    table.register(ent(3), { width: 8, height: 8, srgb: false });
    const before = table.revision();
    table.dispose();
    expect(table.revision()).not.toBe(before);
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
