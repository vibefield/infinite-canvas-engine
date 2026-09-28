// @vitest-environment node
// THE SHARED LAYER ARRAYS' ALLOCATOR (kit/arrays.ts `Layers`, `LayerArray`; K6a) and their SHRINK (K9 R2): an array grew by
// doubling and never shrank — a document switch left a 256-layer array standing, its whole capacity charged. Now a layer given
// back shrinks the array by halves while fewer than a quarter of it is in use and the layers in use fit the half, and lets it go
// entirely when none is; the version moves as on a growth, so a holder rebinds. On the fake device (no pixels).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chainBytes, LayerArray, Layers } from "../src/kit/arrays";
import { fakeDevice, installGpuFlags } from "./fake-gpu";

describe("Layers — the allocator", () => {
  it("hands layers out lowest first, doubles the capacity from `first`, stops at `max`, takes a given layer back first", () => {
    const L = new Layers(4, 8);
    expect([1, 2, 3, 4, 5].map(() => L.take()?.layer)).toEqual([0, 1, 2, 3, 4]);
    expect(L.capacity).toBe(8);
    L.give(1);
    expect(L.take()?.layer).toBe(1);
    expect([6, 7, 8].map(() => L.take()?.layer)).toEqual([5, 6, 7]);
    expect(L.take()).toBeNull();
    expect(L.used).toBe(8);
  });

  it("shrunk (K9 R2): the capacity halves while under a quarter is in use and the highest layer fits the half; none in use → 0; layers too high keep it", () => {
    const L = new Layers(4, 256);
    for (let i = 0; i < 65; i++) L.take();   // 65 in use: capacity 128
    expect(L.capacity).toBe(128);
    expect(L.shrunk()).toBe(128);
    for (let i = 20; i < 65; i++) L.give(i);   // 20 in use (0..19) of 128: under a quarter (32) → 64; at 64 the quarter is 16 → stays
    expect(L.used).toBe(20);
    expect(L.highest).toBe(19);
    expect(L.shrunk()).toBe(64);
    L.shrinkTo(64);
    expect(L.capacity).toBe(64);
    expect(L.take()?.layer).toBe(20);   // the next layer is the lowest free, still
    for (let i = 0; i < 21; i++) L.give(i);
    expect(L.shrunk()).toBe(0);
    L.shrinkTo(0);
    expect(L.capacity).toBe(0);
    expect(L.take()).toEqual({ layer: 0, capacity: 4 });   // begins again
    // layers in use HIGH in the array keep it: 3 in use of 128, but layer 100 is one of them → the half (64) cannot hold it
    const H = new Layers(4, 256);
    for (let i = 0; i < 101; i++) H.take();
    for (let i = 0; i < 101; i++) if (i !== 0 && i !== 50 && i !== 100) H.give(i);
    expect(H.used).toBe(3);
    expect(H.shrunk()).toBe(128);
    H.give(100);
    expect(H.shrunk()).toBe(64);   // 50 fits 64, not 32
  });
});

describe("LayerArray — the shrink on the device (K9 R2)", () => {
  const undo: (() => void)[] = [];
  beforeAll(() => { undo.push(installGpuFlags()); });
  afterAll(() => { for (const u of undo.splice(0)) u(); });

  it("a layer given back shrinks the array by halves once under a quarter is in use — its version moves, its bytes fall; none in use lets it go whole", () => {
    const { device } = fakeDevice();
    const made: string[] = [];
    const create = device.createTexture.bind(device);
    (device as unknown as { createTexture: unknown }).createTexture = (d: GPUTextureDescriptor) => { made.push(String((d.size as number[])[2])); return create(d); };
    const A = new LayerArray(device, { label: "t/thumbnails", format: "rgba8unorm", side: 64 });
    const chain = chainBytes(64, 64, 7);
    const layers = Array.from({ length: 33 }, () => A.take() as number);
    expect(A.capacity).toBe(64);
    expect(A.bytes).toBe(64 * chain);
    expect(A.usedBytes).toBe(33 * chain);   // what the budget resides: the layers in use, not the capacity
    const v = A.version;
    for (const l of layers.slice(8)) A.give(l);   // 8 in use (0..7) of 64: a quarter is 16 → 32, then 16 (8 · 4 = 32 < 32? no: at 32 the quarter is 8, 8 < 8 is false)
    expect(A.used).toBe(8);
    expect(A.capacity).toBe(32);
    expect(A.version).toBeGreaterThan(v);
    expect(made.at(-1)).toBe("32");   // remade at 32, the low layers copied
    expect(A.bytes).toBe(32 * chain);
    for (const l of layers.slice(2, 8)) A.give(l);   // 2 in use of 32 → 8, then 4 (2 · 4 = 8 < 8 is false: stays 8)
    expect(A.capacity).toBe(8);
    for (const l of layers.slice(0, 2)) A.give(l);
    expect(A.capacity).toBe(0);
    expect(A.texture).toBeNull();
    expect(A.bytes).toBe(0);
    expect(A.take()).toBe(0);   // and begins again at `first`
    expect(A.capacity).toBe(4);
  });
});
