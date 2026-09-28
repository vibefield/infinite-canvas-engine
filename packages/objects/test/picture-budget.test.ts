// THE PICTURES' BUDGET ACCOUNTING (K9 R2; photo/pictures.ts, engine/budget.ts). Before K9 `chargeThumbs` charged the thumbnail
// array at its CAPACITY (doubling 4 → 256 layers × 1.333 MB) as a cache kept by `keeps` — so past ~128 pictures the array alone
// exceeded the 256 MB cap: `afford()` could never return a level (no detail was ever fetched again, every print stayed at its
// 512-px thumbnail however large) and `trim` evicted every other owner's off-screen cache each tick. Now the thumbnails RESIDE
// (outside the LRU, charged at what the layers in use weigh) and the details' room is what they leave of the cap, floored. On
// the fake device (no pixels; the arithmetic is the store's own) — the reviewer's probe, its expectations turned to the fix.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRasterBudget } from "@ice/desk";
import { DEFAULT_RASTER_BUDGET } from "../../desk/src/host/layer";
import { chainBytes, PictureStore, THUMB, THUMB_MIPS } from "../src/photo/pictures";
import { fakeDevice, installGpuFlags } from "../../desk/test/fake-gpu";

const MB = 1024 * 1024;
const picture = (): { kind: "rgba"; bytes: Uint8Array<ArrayBuffer>; width: number; height: number } => ({ kind: "rgba", bytes: new Uint8Array(4), width: 1024, height: 1024 });
const LAYER = chainBytes(THUMB, THUMB, THUMB_MIPS);

describe("the thumbnails reside; the details have their room (K9 R2)", () => {
  const undo: (() => void)[] = [];
  beforeAll(() => { undo.push(installGpuFlags()); });
  afterAll(() => { for (const u of undo.splice(0)) u(); });

  it("the arithmetic the defect stood on: 256 layers at capacity outweigh the whole budget", () => {
    expect(256 * LAYER).toBeGreaterThan(DEFAULT_RASTER_BUDGET);
    expect(LAYER).toBe(1398100);
  });

  it("129 pictures: the thumbnails are charged at what is in use (not 256 layers' capacity) and reside — a whiteboard's off-screen raster is NOT evicted, and a print large on screen still gets its detail", async () => {
    const { device } = fakeDevice();
    const store = new PictureStore(device);
    const budget = createRasterBudget(DEFAULT_RASTER_BUDGET);
    store.attach(budget);
    const pics = [];
    for (let i = 0; i < 129; i++) { const p = store.make(picture(), async () => picture()); expect(p).not.toBeNull(); pics.push(p as NonNullable<typeof p>); }
    const s = budget.stats();
    expect(store.stats().capacity).toBe(256);
    expect(s.byOwner.photo?.bytes).toBe(129 * LAYER);   // 172 MB in use — not the 341 MB the capacity weighs
    expect(s.resident).toBe(129 * LAYER);
    expect(s.room).toBe(DEFAULT_RASTER_BUDGET - 129 * LAYER);   // 84 MB for the caches
    // another owner's cache (a whiteboard's raster, 16 MB, off screen) stands at the next trim — the LRU is not permanently empty
    let evicted = false;
    budget.charge("board", "7", 16 * MB, () => { evicted = true; });
    budget.trim((owner, key) => (owner === "photo" ? store.keeps(key) : false));
    expect(evicted).toBe(false);
    // a print LARGE on screen (lod 0 of a 1024² picture, thumbnail base 1): its detail IS fetched — afford() has the caches' room
    store.ask(pics[0] as NonNullable<(typeof pics)[number]>, 0);
    store.step();
    expect(store.stats().building).toBe(1);
  });

  it("past the cap in thumbnails alone (200 pictures = 267 MB): the details keep the floor — a quarter of the cap — and `used` says the truth", async () => {
    const { device } = fakeDevice();
    const store = new PictureStore(device);
    const budget = createRasterBudget(DEFAULT_RASTER_BUDGET);
    store.attach(budget);
    const pics = [];
    for (let i = 0; i < 200; i++) pics.push(store.make(picture(), async () => picture()) as NonNullable<ReturnType<PictureStore["make"]>>);
    expect(budget.stats().used).toBeGreaterThan(budget.cap);
    expect(budget.room()).toBe(Math.floor(DEFAULT_RASTER_BUDGET / 4));
    store.ask(pics[0] as NonNullable<(typeof pics)[number]>, 0);
    store.step();
    expect(store.stats().building).toBe(1);
  });

  it("dropped pictures give their layers back: the charge falls with them, and the array shrinks — to nothing when the document empties", async () => {
    const { device } = fakeDevice();
    const store = new PictureStore(device);
    const budget = createRasterBudget(DEFAULT_RASTER_BUDGET);
    store.attach(budget);
    const pics = Array.from({ length: 65 }, () => store.make(picture(), async () => picture()) as NonNullable<ReturnType<PictureStore["make"]>>);
    expect(store.stats().capacity).toBe(128);
    expect(budget.stats().resident).toBe(65 * LAYER);
    for (const p of pics.slice(10)) store.drop(p);
    expect(budget.stats().resident).toBe(10 * LAYER);
    expect(store.stats().capacity).toBe(32);   // 10 of 128 → 64 → 32 (a quarter of 32 is 8: 10 is not under it)
    for (const p of pics.slice(0, 10)) store.drop(p);
    expect(budget.stats().resident).toBe(0);
    expect(store.stats()).toMatchObject({ pictures: 0, layers: 0, capacity: 0 });
  });
});
