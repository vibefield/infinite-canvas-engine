// THE PICTURES' RESIDENCY (K6a, design-016 §6 · K-L4; photo/pictures.ts) on a fake device — no pixels (the oracle's photo
// scenes hold the thumbnail's sampling to the golden byte for byte): where a picture's thumbnail lies and which of its chain's
// levels it starts at, the layer allocator, what a print on screen asks and what the step binds, fetches, cuts and lets go,
// and the ONE budget — the thumbnails kept, a detail pinned while a frame binds it and an LRU cache when it does not.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRasterBudget } from "@ice/desk";
import { chainBytes, DETAIL_SLOTS, detailNeed, Layers, type Picture, pictureLod, PictureStore, THUMB, THUMB_MIPS, thumbBase } from "../src/photo/pictures";
import { fakeDevice, installGpuFlags } from "../../desk/test/fake-gpu";
import { must } from "../../desk/test/must";

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("where a picture's pixels live", () => {
  it("thumbBase: the first level of the chain whose both sides fit THUMB² — 0 for a picture that fits whole", () => {
    expect(THUMB).toBe(512);
    expect(thumbBase(192, 128)).toBe(0);     // the oracle's picture: its whole chain in the layer
    expect(thumbBase(512, 512)).toBe(0);
    expect(thumbBase(513, 100)).toBe(1);
    expect(thumbBase(4096, 3072)).toBe(3);   // 512 × 384
    expect(thumbBase(3072, 4096)).toBe(3);
    expect(thumbBase(4096, 4096)).toBe(3);
    expect(thumbBase(1, 1)).toBe(0);
  });

  it("pictureLod: the texels a device pixel, log2, along the picture's wider axis — what photo.wgsl samples at", () => {
    // a 4096-wide picture over a 380-unit-wide inner at zoom 1 on a 2× screen: 4096 / 760 px
    expect(pictureLod(4096, 3072, [190, 142.5], 1, 2)).toBeCloseTo(Math.log2(4096 / 760), 9);
    expect(pictureLod(4096, 3072, [190, 142.5], 4, 2)).toBeCloseTo(Math.log2(4096 / 3040), 9);
  });

  it("detailNeed: nothing while the thumbnail serves (HEADROOM a level ahead); else the finest level the print samples, below the thumbnail's base", () => {
    expect(detailNeed(2.5, 0)).toBeNull();    // the whole chain is the thumbnail
    expect(detailNeed(4.2, 3)).toBeNull();    // samples level 4: the thumbnail's own
    expect(detailNeed(3.6, 3)).toBeNull();    // larger than THUMB / √2 px only from 3.5 down
    expect(detailNeed(3.4, 3)).toBe(2);       // within HEADROOM of needing more: asked before it does
    expect(detailNeed(2.4, 3)).toBe(2);
    expect(detailNeed(1.99, 3)).toBe(1);
    expect(detailNeed(-3, 3)).toBe(0);        // zoomed past level 0: the whole chain
  });

  it("the layer allocator: lowest first, the array doubling from four to the device's limit, a layer given back taken again first", () => {
    const L = new Layers(4, 16);
    const taken = Array.from({ length: 5 }, () => must(L.take()));
    expect(taken.map((t) => t.layer)).toEqual([0, 1, 2, 3, 4]);
    expect(taken.map((t) => t.capacity)).toEqual([4, 4, 4, 4, 8]);
    L.give(2); L.give(0);
    expect(L.used).toBe(3);
    expect(must(L.take())).toEqual({ layer: 0, capacity: 8 });
    expect(must(L.take())).toEqual({ layer: 2, capacity: 8 });
    for (let i = 5; i < 16; i++) expect(must(L.take()).layer).toBe(i);
    expect(L.capacity).toBe(16);
    expect(L.take()).toBeNull();   // the device holds no more
  });
});

describe("the store on a fake device", () => {
  const undo: (() => void)[] = [];
  beforeAll(() => { undo.push(installGpuFlags()); });
  afterAll(() => { for (const u of undo.splice(0)) u(); });

  /** A store, the textures it made (destroyed or not), the fetches its pictures made. */
  function store(cap = 1 << 30) {
    const { device } = fakeDevice();
    const textures: { readonly label: string; readonly size: GPUExtent3D; destroyed: boolean }[] = [];
    const make = device.createTexture.bind(device);
    (device as { createTexture: GPUDevice["createTexture"] }).createTexture = (d) => {
      const t = make(d);
      const kept = { label: d.label ?? "", size: d.size, destroyed: false };
      textures.push(kept);
      (t as { destroy: () => void }).destroy = () => { kept.destroyed = true; };
      return t;
    };
    const s = new PictureStore(device);
    const budget = createRasterBudget(cap);
    s.attach(budget);
    let woke = 0;
    s.onReady = () => { woke += 1; };
    let fetches = 0;
    const picture = (w: number, h: number): Picture => {
      const raw = { kind: "rgba", bytes: new Uint8Array(4), width: w, height: h } as const;
      return must(s.make(raw, async () => { fetches += 1; return raw; }));
    };
    return { s, budget, textures, picture, woke: () => woke, fetches: () => fetches };
  }

  it("a picture's thumbnail is its chain's tail in a layer of ONE array (charged, always kept); its chain let go once laid", () => {
    const { s, budget, textures, picture } = store();
    const a = picture(4096, 3072);
    const b = picture(192, 128);
    expect([a.layer, a.base, b.layer, b.base]).toEqual([0, 3, 1, 0]);
    expect(textures.filter((t) => t.label === "photo/thumbnails")).toHaveLength(1);   // one array for both
    expect(textures.filter((t) => t.label.startsWith("photo/picture ")).every((t) => t.destroyed)).toBe(true);
    expect(budget.stats().byOwner.photo).toEqual({ bytes: 4 * chainBytes(THUMB, THUMB, THUMB_MIPS), entries: 1 });
    expect(s.keeps("thumbnails")).toBe(true);
    expect(budget.trim(() => false) >= 0 && s.keeps("thumbnails")).toBe(true);
    // a fifth picture doubles the array: a new one, the old copied and let go
    for (let i = 0; i < 3; i++) picture(64, 64);
    const arrays = textures.filter((t) => t.label === "photo/thumbnails");
    expect(arrays).toHaveLength(2);
    expect(arrays.map((t) => t.destroyed)).toEqual([true, false]);
    expect(s.stats()).toMatchObject({ pictures: 5, layers: 5, capacity: 8 });
  });

  it("a print large on screen asks; the step fetches its detail from the level it samples, binds it in a slot when it lands (the tier turns over), and the budget keeps it while bound", async () => {
    const { s, picture, woke, fetches } = store();
    const p = picture(4096, 3072);
    const tier0 = p.tier;
    s.ask(p, 2.4);
    expect(s.step()).toBe(false);   // nothing to bind yet: the fetch is on its way
    expect(fetches()).toBe(1);
    await settle();
    expect(woke()).toBe(1);         // landed: the desk is woken
    expect(must(p.detail).base).toBe(2);
    expect(p.slot).toBe(-1);
    s.ask(p, 2.4);
    expect(s.step()).toBe(true);    // bound this frame
    expect(p.slot).toBe(0);
    expect(p.tier).toBeGreaterThan(tier0);
    expect(s.keeps(`detail ${p.id}`)).toBe(true);
    // a frame with nothing drawn costs the step nothing and moves nothing
    expect(s.step()).toBe(false);
    expect(p.slot).toBe(0);
    // the print shrinks on screen: its slot is freed; its detail stays a cache, no longer kept
    s.ask(p, 5);
    expect(s.step()).toBe(true);
    expect(p.slot).toBe(-1);
    expect(p.detail).not.toBeNull();
    expect(s.keeps(`detail ${p.id}`)).toBe(false);
  });

  it("THE ONE BUDGET: a bound detail is never evicted, whatever else the budget holds; an unbound one is, and a print that is large again fetches it again", async () => {
    const two = 4 * chainBytes(THUMB, THUMB, THUMB_MIPS) + 2 * chainBytes(1024, 768, 11);
    const { s, budget, picture, fetches } = store(two);
    const a = picture(4096, 3072);
    const b = picture(4096, 3072);
    for (const p of [a, b]) s.ask(p, 2.2);
    s.step();
    await settle();
    for (const p of [a, b]) s.ask(p, 2.2);
    s.step();
    expect([a.slot, b.slot].sort()).toEqual([0, 1]);
    // another owner's raster pushes the ledger over the cap, and it too is on screen: nothing the pictures bind goes
    budget.charge("board", "1", 1 << 30, () => {});
    const keep = (owner: string, key: string) => owner === "board" || (owner === "photo" && s.keeps(key));
    budget.trim(keep);
    expect([a.detail, b.detail].every((d) => d !== null)).toBe(true);
    // both leave the screen: the budget takes them
    for (const p of [a, b]) s.ask(p, 9);
    s.step();
    budget.trim(keep);
    expect(a.detail).toBeNull();
    expect(b.detail).toBeNull();
    expect(s.stats().evicted).toBe(2);
    budget.release("board", "1");
    // large again: fetched again
    const f = fetches();
    s.ask(a, 2.2);
    s.step();
    expect(fetches()).toBe(f + 1);
  });

  it("the pictures never pin more than the cap: a detail the budget has no room for is made from a coarser level — or not at all (the thumbnail serves)", async () => {
    const thumbs = 4 * chainBytes(THUMB, THUMB, THUMB_MIPS);
    const roomy = store(thumbs + chainBytes(1024, 768, 11));   // room for a detail from level 2, not 1 or 0
    const p = roomy.picture(4096, 3072);
    roomy.s.ask(p, 0.3);   // samples level 0
    roomy.s.step();
    await settle();
    expect(must(p.detail).base).toBe(2);
    const tight = store(thumbs + 1000);                      // room for no detail
    const q = tight.picture(4096, 3072);
    tight.s.ask(q, 0.3);
    tight.s.step();
    await settle();
    expect(q.detail).toBeNull();
    expect(tight.fetches()).toBe(0);
  });

  it("the budget's LRU among unbound details: the one used longer ago goes first, the other stays", async () => {
    // a cap with room for the thumbnails and ONE detail from level 2 of a 4096 × 3072 picture (1024 × 768 down)
    const one = chainBytes(1024, 768, 11);
    const { s, budget, picture } = store(4 * chainBytes(THUMB, THUMB, THUMB_MIPS) + one);
    const a = picture(4096, 3072);
    const b = picture(4096, 3072);
    const both = () => { s.ask(a, 2.2); s.ask(b, 2.1); };   // b the larger: fetched, landed and CHARGED first
    both();
    s.step();
    await settle();
    both();
    s.step();
    expect([a, b].map((p) => must(p.detail).bytes)).toEqual([one, one]);
    s.ask(b, 2.2);   // b stays large a frame longer: used more recently
    s.step();
    s.ask(b, 9);
    s.step();        // neither bound now
    const keep = (owner: string, key: string) => owner === "photo" && s.keeps(key);
    expect(budget.trim(keep)).toBe(one);
    expect(a.detail).toBeNull();
    expect(b.detail).not.toBeNull();
    expect(budget.stats().used).toBeLessThanOrEqual(budget.cap);
  });

  it("the pool: DETAIL_SLOTS details a frame, the largest on screen first; the rest keep their thumbnails", async () => {
    const { s, picture } = store();
    const pics = Array.from({ length: DETAIL_SLOTS + 3 }, () => picture(4096, 3072));
    const lods = pics.map((_, i) => 0.5 + 0.2 * i);   // pics[0] the largest on screen
    const askAll = () => pics.forEach((p, i) => s.ask(p, lods[i] as number));
    for (let round = 0; round < 8; round++) { askAll(); s.step(); await settle(); }
    askAll();
    s.step();
    const bound = pics.filter((p) => p.slot >= 0);
    expect(bound).toHaveLength(DETAIL_SLOTS);
    expect(pics.slice(0, DETAIL_SLOTS).every((p) => p.slot >= 0)).toBe(true);
    expect(pics.slice(DETAIL_SLOTS).every((p) => p.slot === -1)).toBe(true);
    expect(new Set(bound.map((p) => p.slot)).size).toBe(DETAIL_SLOTS);
  });

  it("zoomed out, a detail finer than its print samples is CUT to what it samples — a device copy, no fetch; zoomed in, a coarser one binds while the finer is fetched", async () => {
    const { s, picture, fetches, textures } = store();
    const p = picture(4096, 3072);
    s.ask(p, 0.3);
    s.step();
    await settle();
    s.ask(p, 0.3);
    s.step();
    expect(must(p.detail).base).toBe(0);
    const f = fetches();
    s.ask(p, 2.5);   // needs level 2 now: the whole chain is more than it samples
    expect(s.step()).toBe(true);
    expect(must(p.detail).base).toBe(2);
    expect(fetches()).toBe(f);           // no fetch: cut from the detail it had
    expect(s.stats().cut).toBe(1);
    expect(textures.filter((t) => t.label.startsWith("photo/picture ")).every((t) => t.destroyed)).toBe(true);   // the whole chain (the detail from 0) let go
    expect(textures.filter((t) => t.label.startsWith("photo/detail") && !t.destroyed)).toHaveLength(1);        // the cut stands alone
    // zoomed in past it (sampling at 1.6: level 1): a finer detail is fetched…
    s.ask(p, 1.6);
    s.step();
    expect(fetches()).toBe(f + 1);
    expect(must(p.detail).base).toBe(2);   // …and the coarser one binds meanwhile
    expect(p.slot).toBeGreaterThanOrEqual(0);
    await settle();
    expect(must(p.detail).base).toBe(1);
  });

  it("a dropped picture gives its layer back (the next picture takes it), destroys its detail and frees its slot", async () => {
    const { s, budget, picture } = store();
    const p = picture(4096, 3072);
    s.ask(p, 2.2);
    s.step();
    await settle();
    s.ask(p, 2.2);
    s.step();
    const layer = p.layer;
    s.drop(p);
    expect(p.slot).toBe(-1);
    expect(p.detail).toBeNull();
    expect(budget.stats().byOwner.photo?.entries).toBe(1);   // the thumbnails alone
    expect(picture(100, 100).layer).toBe(layer);
    expect(s.stats().slotted).toBe(0);
  });
});
