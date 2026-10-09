// @vitest-environment node
// M24 LT1 ON DAWN (design-019 §3.1, §9; `pnpm dawn` — never CI's `test`, which runs no Dawn; the landing gate runs it after the
// oracle). Two witnesses on a real device, Dawn in Node (the `webgpu` package):
//  1. THE WRITER: bytes presented read back from level 0 byte for byte; the mips made into a frame's encoder as deep as asked —
//     the levels past the reach keep the last mips made, a new revision re-made only as deep as asked — and filtered in linear
//     light (a red|blue face's last level is the sRGB of half and half, 188, never 128); a texture on the device presented by a
//     device copy; a resize a new texture of the source's size; the caller's label in the memory ledger with the face's bytes.
//  2. THE STILL (§9): `createStill({ services: [service(LIVE, stillLive(device, …))] })` draws a live kind (test/sheet.ts — opened by
//     its durable key, taken at its open) from committed bytes — its pixels by colour count and contrast, never a hash: each band of
//     the fixture where it belongs, at 1:1 and minified through its mips; the bare mat everywhere past the face; a face with no
//     still its film; the ledger at zero after each still.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { create, globals } from "webgpu";
import { acquire } from "../src/engine/device";
import { instrumentMemory, type MemoryLedger } from "../src/gpu-memory";
import { createLiveTexture, LIVE, type LiveStill, stillLive } from "../src/kit/live";
import { mipCount } from "../src/kit/mips";
import { service } from "../src/kit/services";
import { createStill, type Still } from "../src/still";
import { SHEET_FILM, SHEET_TYPE, Sheet } from "./sheet";

let device: GPUDevice;
let ledger: MemoryLedger;
/** The textures the device made, by label — the writer keeps its own, and a test reads a level of it back. */
const made = new Map<string, GPUTexture>();

beforeAll(async () => {
  Object.assign(globalThis, globals);   // GPUBufferUsage & friends, which a browser has for free
  device = (await acquire({ gpu: create([]), label: "desk dawn" })).device;
  ledger = instrumentMemory(device);   // before anything is made on it
  const make = device.createTexture.bind(device);
  device.createTexture = (d: GPUTextureDescriptor) => { const t = make(d); made.set(d.label ?? "", t); return t; };
});
afterAll(() => { device?.destroy(); });

/** Level `level` of `texture` read back: tightly packed RGBA rows. */
async function readLevel(texture: GPUTexture, level: number): Promise<Uint8Array> {
  const w = Math.max(1, texture.width >> level);
  const h = Math.max(1, texture.height >> level);
  const row = Math.ceil((w * 4) / 256) * 256;
  const buffer = device.createBuffer({ size: row * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer({ texture, mipLevel: level }, { buffer, bytesPerRow: row }, [w, h]);
  device.queue.submit([encoder.finish()]);
  await buffer.mapAsync(GPUMapMode.READ);
  const padded = new Uint8Array(buffer.getMappedRange());
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) out.set(padded.subarray(y * row, y * row + w * 4), y * w * 4);
  buffer.unmap();
  buffer.destroy();
  return out;
}

/** RGBA8 rows of `w` × `h`, each texel `at(x, y)`. */
function pattern(w: number, h: number, at: (x: number, y: number) => readonly [number, number, number]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = at(x, y); out.set([c[0], c[1], c[2], 255], (y * w + x) * 4); }
  return out;
}
const RED = [255, 0, 0] as const;
const BLUE = [0, 0, 255] as const;
const GREEN = [0, 255, 0] as const;
/** Every texel of a level: its colour (rgb) as a string, the distinct ones in order of first sight. */
const colours = (rgba: Uint8Array): string[] => [...new Set(Array.from({ length: rgba.length / 4 }, (_, i) => `${rgba[i * 4]},${rgba[i * 4 + 1]},${rgba[i * 4 + 2]}`))];
/** A frame's encoder, submitted after `record` has recorded into it. */
function frame(record: (encoder: GPUCommandEncoder) => void): void {
  const encoder = device.createCommandEncoder({ label: "frame" });
  record(encoder);
  device.queue.submit([encoder.finish()]);
}

describe("the live texture on Dawn (design-019 §3.1)", () => {
  it("bytes presented read back from level 0 byte for byte; a source of another size makes a texture of its size — the epoch moves", async () => {
    const live = createLiveTexture(device, { label: "dawn/live bytes", width: 8, height: 8 });
    const bytes = pattern(8, 8, (x, y) => [x * 30, y * 30, (x * y) % 256]);
    live.presentBytes(bytes, 8, 8);
    expect(Array.from(await readLevel(made.get("dawn/live bytes") as GPUTexture, 0))).toEqual(Array.from(bytes));
    const wide = pattern(12, 4, (x) => [x * 20, 7, 9]);
    live.presentBytes(wide, 12, 4);
    const t = made.get("dawn/live bytes") as GPUTexture;
    expect([t.width, t.height, t.mipLevelCount, live.face.epoch, live.face.revision]).toEqual([12, 4, mipCount(12, 4), 1, 2]);
    expect(Array.from(await readLevel(t, 0))).toEqual(Array.from(wide));
    live.destroy();
  });

  it("the mips into a frame's encoder AS DEEP AS ASKED, once per revision — past the reach the last mips made stand; filtered in linear light", async () => {
    const live = createLiveTexture(device, { label: "dawn/live mips", width: 8, height: 8 });   // levels 0 … 3
    const texture = (): GPUTexture => made.get("dawn/live mips") as GPUTexture;
    live.presentBytes(pattern(8, 8, (x) => (x < 4 ? RED : BLUE)), 8, 8);
    frame((e) => live.face.prepare(e, 2));
    // level 1 (4×4) and level 2 (2×2): red | blue, each half exact
    expect(colours(await readLevel(texture(), 1))).toEqual(["255,0,0", "0,0,255"]);
    expect(colours(await readLevel(texture(), 2))).toEqual(["255,0,0", "0,0,255"]);
    expect(colours(await readLevel(texture(), 3)), "level 3 was never asked").toEqual(["0,0,0"]);
    frame((e) => live.face.prepare(e, 3));
    // the last level: half red, half blue — averaged in LINEAR light, so each channel is the sRGB of 0.5 (≈ 188), never 128
    const [r, g, b] = await readLevel(texture(), 3);
    expect(Math.abs((r as number) - 188)).toBeLessThanOrEqual(1);
    expect(g).toBe(0);
    expect(Math.abs((b as number) - 188)).toBeLessThanOrEqual(1);
    // a new revision: nothing is made until asked; then only as deep as asked — the levels past the reach keep the last revision's
    live.presentBytes(pattern(8, 8, () => GREEN), 8, 8);
    expect(colours(await readLevel(texture(), 1)), "not asked: level 1 holds the last mips").toEqual(["255,0,0", "0,0,255"]);
    frame((e) => live.face.prepare(e, 1));
    expect(colours(await readLevel(texture(), 1))).toEqual(["0,255,0"]);
    expect(colours(await readLevel(texture(), 2)), "past the reach: the last revision's").toEqual(["255,0,0", "0,0,255"]);
    frame((e) => { live.face.prepare(e, 1); live.face.prepare(e, 2); });
    expect(colours(await readLevel(texture(), 2))).toEqual(["0,255,0"]);
    live.destroy();
  });

  it("a texture on the device is presented by a device copy (from its rect); the caller's label is in the memory ledger with the face's bytes, gone once destroyed", async () => {
    const before = ledger.read().byLabel.dawn?.bytes ?? 0;
    const live = createLiveTexture(device, { label: "dawn/live copy", width: 4, height: 4 });
    expect(ledger.read().byLabel.dawn?.bytes).toBe(before + live.face.bytes);
    expect(live.face.bytes).toBe(4 * 4 * 4 + 2 * 2 * 4 + 1 * 1 * 4);
    const producer = device.createTexture({ label: "producer/frame", size: [8, 8], format: "rgba8unorm", usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST });
    const src = pattern(8, 8, (x, y) => [x * 10, y * 10, 200]);
    device.queue.writeTexture({ texture: producer }, src, { bytesPerRow: 32 }, [8, 8]);
    live.presentTexture(producer, { x: 2, y: 3, width: 4, height: 4 });
    expect(live.face.revision).toBe(1);
    expect(Array.from(await readLevel(made.get("dawn/live copy") as GPUTexture, 0))).toEqual(Array.from(pattern(4, 4, (x, y) => [(x + 2) * 10, (y + 3) * 10, 200])));
    producer.destroy();
    live.destroy();
    expect(ledger.read().byLabel.dawn?.bytes ?? 0).toBe(before);
  });
});

// ---------------------------------------------------------------- the still

/** The committed still (owned, made here): four vertical bands, each its own colour, 64 × 40 texels. */
const BANDS = [[214, 52, 44], [48, 168, 72], [44, 84, 214], [232, 200, 52]] as const;
const FIXTURE: LiveStill = { width: 64, height: 40, bytes: pattern(64, 40, (x) => BANDS[Math.floor(x / 16)] as readonly [number, number, number]) };
const VIEW = { width: 200, height: 100 } as const;

/** A still of one sheet `w` × `h` centred on the origin (or none — the bare mat), its face lent `frames` (none: no source at all). */
function sheetStill(opts: { readonly w?: number; readonly h?: number; readonly frames?: "record" | "spec" | "none" }): Promise<Still> {
  const record: Record<string, LiveStill> = {};
  const frames = opts.frames === "spec" ? (_key: string, spec: Readonly<Record<string, unknown>>) => (spec.sheet === true ? FIXTURE : undefined) : record;
  return createStill({
    device, format: "rgba8unorm", size: VIEW, dpr: 1, objects: [Sheet],
    services: [service(LIVE, stillLive(device, frames))],
    stage: ({ engine }) => {
      if (opts.w === undefined || opts.h === undefined) return;
      const e = engine.ops.spawnWidget(SHEET_TYPE, { x: -opts.w / 2, y: -opts.h / 2, w: opts.w, h: opts.h, undoable: false });
      // a still's keys are its own document's: the stage reads the one its spawn was given and commits the face's bytes under it
      const key = engine.docs.current()?.store.keyOf(e);
      if (key !== undefined && opts.frames === "record") record[key] = FIXTURE;
    },
  });
}

/** Pixel (x, y)'s rgb. */
const px = (s: Still, x: number, y: number): [number, number, number] => { const i = (y * s.width + x) * 4; return [s.rgba[i] as number, s.rgba[i + 1] as number, s.rgba[i + 2] as number]; };
const near = (a: readonly number[], b: readonly number[], tol: number): boolean => a.every((v, i) => Math.abs(v - (b[i] as number)) <= tol);

/** In the face's rect (device px, inclusive-exclusive): how many pixels are each band's colour (±tol), and how many differ from the bare mat. */
function census(s: Still, bare: Still, rect: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }, tol: number) {
  const bands = BANDS.map(() => 0);
  let n = 0;
  let off = 0;
  for (let y = rect.y0; y < rect.y1; y++) {
    for (let x = rect.x0; x < rect.x1; x++) {
      n += 1;
      const c = px(s, x, y);
      const k = BANDS.findIndex((b) => near(c, b, tol));
      if (k >= 0) bands[k] = (bands[k] as number) + 1;
      if (!near(c, px(bare, x, y), 8)) off += 1;
    }
  }
  return { n, bands, off };
}

/** Pixels OUTSIDE `rect` (device px) that differ from the bare mat by more than 8. */
function movedOutside(s: Still, bare: Still, rect: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }): number {
  let moved = 0;
  for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) if ((x < rect.x0 || x >= rect.x1 || y < rect.y0 || y >= rect.y1) && !near(px(s, x, y), px(bare, x, y), 8)) moved += 1;
  return moved;
}

describe("a live kind's still from committed bytes (design-019 §9 — createStill + stillLive)", () => {
  let bare: Still;
  beforeAll(async () => { bare = await sheetStill({}); });
  // the face at the still's centre: 200 × 100 at dpr 1, the origin at (100, 50)
  const faceRect = (w: number, h: number) => ({ x0: 100 - w / 2, y0: 50 - h / 2, x1: 100 + w / 2, y1: 50 + h / 2 });

  it("at 1:1 — every pixel of the face is its band's colour, the bands in order left to right; nothing past the face moved; the ledger at zero", async () => {
    const s = await sheetStill({ w: 64, h: 40, frames: "record" });
    const r = faceRect(64, 40);
    const c = census(s, bare, r, 2);
    expect(c.bands).toEqual([640, 640, 640, 640]);
    expect(c.off).toBe(c.n);
    for (const [k, band] of BANDS.entries()) expect(near(px(s, r.x0 + 16 * k + 8, 50), band, 2), `band ${k} at its place`).toBe(true);
    expect(movedOutside(s, bare, r)).toBe(0);
    expect(ledger.read()).toMatchObject({ total: 0, textures: 0, buffers: 0 });
    s.dispose();
    console.log(`1:1 — ${c.n} px of the face, by band ${c.bands.join(" / ")}, ${c.off} off the bare mat · ${movedOutside(s, bare, r)} px past it moved · ledger ${ledger.read().total} B live`);
  });

  it("MINIFIED through its mips (half size: level 1 made into the still's encoder) — each band's interior its colour; by the host's spec too", async () => {
    for (const frames of ["record", "spec"] as const) {
      const s = await sheetStill({ w: 32, h: 20, frames });
      const r = faceRect(32, 20);
      const c = census(s, bare, r, 3);
      // each band is 8 px wide at this size: its 6 interior columns are its colour, the seams between two blend
      for (const n of c.bands) expect(n).toBeGreaterThanOrEqual(6 * 20);
      expect(c.off).toBe(c.n);
      expect(movedOutside(s, bare, r)).toBe(0);
      expect(ledger.read()).toMatchObject({ total: 0, textures: 0, buffers: 0 });
      s.dispose();
      console.log(`half size (${frames}) — by band ${c.bands.join(" / ")} of ${c.n} px, ${c.off} off the bare mat`);
    }
  });

  it("a face with no still is its FILM (the source says starting); and the same still twice is the same bytes", async () => {
    const s = await sheetStill({ w: 64, h: 40, frames: "none" });
    const r = faceRect(64, 40);
    let film = 0;
    for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) if (near(px(s, x, y), SHEET_FILM, 2)) film += 1;
    expect(film).toBe(64 * 40);
    const a = await sheetStill({ w: 64, h: 40, frames: "record" });
    const b = await sheetStill({ w: 64, h: 40, frames: "record" });
    expect(Buffer.from(a.rgba).equals(Buffer.from(b.rgba))).toBe(true);
    expect(ledger.read()).toMatchObject({ total: 0, textures: 0, buffers: 0 });
    for (const x of [s, a, b]) x.dispose();
  });
});
