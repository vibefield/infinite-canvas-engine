// @vitest-environment node
// THE STILL (petition I30; still.ts `createStill`, `@ice/desk`'s door) on the desk's own test device — the fake (fake-gpu.ts) with a
// raster (fake-raster.ts: a clear fills, a draw under a named pipeline paints its scissor, a copy copies rows): a world staged through
// the engine's doors, the desk's builder making the frame from it, the frame drawn into a readable texture and read back. A kind of
// the TEST's own (the desk names no built-in — `desk-never-imports-objects`): its record is where its object lies on the attachment,
// its pass paints that rect, so the still shows the kind's pixels exactly where the camera and the dpr put the object, the mat's
// everywhere else. Then: everything made for the still is released before its promise settles (the memory ledger at zero — on every
// path out: a kind refused at create, a stage that throws), a malformed option throws at the call, and two stills asked together on
// one device are drawn in turn. A kind's own SHADING is Dawn's: the desk clock's still (examples/desk-clock, `pnpm still`).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defineWidget } from "@ice/core";
import { instrumentMemory } from "../src/gpu-memory";
import { createStill, STILL_PALETTE, type StillOptions } from "../src/index";
import type { KindPass } from "../src/kind";
import type { ObjectKind, ObjectRect } from "../src/kinds/world";
import { attachmentOf } from "../src/kit/layer";
import { defineObject } from "../src/object";
import { installGpuFlags } from "./fake-gpu";
import type { FakeDeviceOptions } from "./fake-gpu";
import { type Paint, type RasterGpu, rasterDevice } from "./fake-raster";

/** The mat's paint and the stub kind's — red ≠ blue in both, so a channel order that is not turned shows. */
const MAT: Paint = [30, 120, 200, 255];
const STUB: Paint = [220, 40, 90, 255];
const STUB_PIPELINE = "still-stub/paint";

/** Where the stub's object lies on the attachment, device px: what its pass paints. */
interface StubRecord { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }

/** The stub's pass: one pipeline, one buffer of its own (so the ledger sees the pass let it go); each record's rect painted, the slot's scissor given back. */
function stubPass(device: GPUDevice): KindPass<StubRecord> {
  const pipeline = device.createRenderPipeline({ label: STUB_PIPELINE } as GPURenderPipelineDescriptor);
  const buffer = device.createBuffer({ label: "still-stub/records", size: 256, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  let records: readonly StubRecord[] = [];
  let attach = { w: 0, h: 0 };
  return {
    spawn: () => stubPass(device),
    prepare: (_e, slot, rs) => { records = rs; attach = attachmentOf(slot.view); return rs.length; },
    drawRange(pass, first, end) {
      pass.setPipeline(pipeline);
      for (let i = first; i < end; i++) {
        const r = records[i] as StubRecord;
        const x0 = Math.max(0, Math.round(r.x0));
        const y0 = Math.max(0, Math.round(r.y0));
        const x1 = Math.min(attach.w, Math.round(r.x1));
        const y1 = Math.min(attach.h, Math.round(r.y1));
        if (x1 <= x0 || y1 <= y0) continue;
        pass.setScissorRect(x0, y0, x1 - x0, y1 - y0);
        pass.draw(6);
      }
      pass.setScissorRect(0, 0, attach.w, attach.h);
    },
    dispose: () => buffer.destroy(),
  };
}

/** A kind of the test's own: its geometry the object's rect, its record that rect on the attachment under the slot's camera and dpr. */
function stubKind(name: string, create?: (device: GPUDevice) => Promise<KindPass<StubRecord>>): ObjectKind<ObjectRect, StubRecord> {
  return {
    name, stratum: "things", reach: 0,
    create: create ?? (async (device) => stubPass(device)),
    resolve: (ctx) => ctx.rect,
    record: (G, ctx) => {
      const { camX, camY, zoom, dpr } = ctx.view;
      const k = zoom * dpr;
      return { x0: (G.cx - G.w / 2 - camX) * k, y0: (G.cy - G.h / 2 - camY) * k, x1: (G.cx + G.w / 2 - camX) * k, y1: (G.cy + G.h / 2 - camY) * k };
    },
    hit: () => "content",
  };
}

/** Widget types are process-global: each still declares its own. */
let types = 0;
const stubObject = (create?: (device: GPUDevice) => Promise<KindPass<StubRecord>>) => {
  const n = ++types;
  return defineObject({ type: `test.still-stub-${n}`, version: 1, props: {}, kind: stubKind(`still-stub-${n}`, create) });
};

/** The raster device, its paints named and its ledger armed before anything is made. */
function device(opts: FakeDeviceOptions = {}): RasterGpu & { readonly ledger: ReturnType<typeof instrumentMemory> } {
  const gpu = rasterDevice(opts);
  gpu.paints.set("mat/mat", MAT);
  gpu.paints.set(STUB_PIPELINE, STUB);
  return { ...gpu, ledger: instrumentMemory(gpu.device) };
}

/** Each pixel of a still: the stub's paint inside `[x0, x1) × [y0, y1)` (device px), the mat's elsewhere — the misses, counted. */
function misses(still: { readonly width: number; readonly height: number; readonly rgba: Uint8Array }, x0: number, y0: number, x1: number, y1: number): number {
  let n = 0;
  for (let y = 0; y < still.height; y++) {
    for (let x = 0; x < still.width; x++) {
      const want = x >= x0 && x < x1 && y >= y0 && y < y1 ? STUB : MAT;
      const at = (y * still.width + x) * 4;
      for (let c = 0; c < 4; c++) if (still.rgba[at + c] !== want[c]) { n += 1; break; }
    }
  }
  return n;
}

describe("createStill — one still of a desk on the caller's device (petition I30)", () => {
  const undo: (() => void)[] = [];
  beforeAll(() => { undo.push(installGpuFlags()); });
  afterAll(() => { for (const u of undo.splice(0)) u(); });

  it("a world staged through the engine's doors: the asked size at the dpr, the kind's pixels where its object lies (the origin at the centre), the mat elsewhere — RGBA from a BGRA texture", async () => {
    const gpu = device();
    const Stub = stubObject();
    const still = await createStill({
      device: gpu.device, format: "bgra8unorm", size: { width: 40, height: 30 }, dpr: 2, objects: [Stub],
      stage: ({ engine }) => { engine.ops.spawnWidget(Stub.type, { x: -6, y: -4, w: 12, h: 8, undoable: false }); },
    });
    expect([still.width, still.height]).toEqual([80, 60]);
    expect(still.rgba.byteLength).toBe(80 * 60 * 4);
    // the default camera puts the world's origin at the still's centre: the object's CSS rect [14, 26] × [11, 19], × dpr 2
    expect(misses(still, 28, 22, 52, 38)).toBe(0);
    expect([...still.rgba.subarray((30 * 80 + 40) * 4, (30 * 80 + 40) * 4 + 4)]).toEqual([...STUB]);
  });

  it("the camera a caller gives: the object where it puts it, scaled by its zoom (an rgba8unorm still)", async () => {
    const gpu = device();
    const Stub = stubObject();
    const still = await createStill({
      device: gpu.device, format: "rgba8unorm", size: { width: 32, height: 24 }, dpr: 1, objects: [Stub], camera: { x: 0, y: 0, zoom: 2 },
      stage: ({ engine }) => { engine.ops.spawnWidget(Stub.type, { x: 2, y: 3, w: 4, h: 5, undoable: false }); },
    });
    expect([still.width, still.height]).toEqual([32, 24]);
    expect(misses(still, 4, 6, 12, 16)).toBe(0);
  });

  it("everything made for it is released before the promise settles — the memory ledger at zero, before `dispose` and after it (twice)", async () => {
    const gpu = device();
    const Stub = stubObject();
    const still = await createStill({
      device: gpu.device, format: "bgra8unorm", size: { width: 40, height: 30 }, dpr: 2, objects: [Stub],
      stage: ({ engine }) => { engine.ops.spawnWidget(Stub.type, { x: -6, y: -4, w: 12, h: 8, undoable: false }); },
    });
    const made = gpu.ledger.read();
    expect(made.made).toBeGreaterThan(0);   // the mat, the stub's pass, the still and its readback were made on the CALLER's device…
    expect(made).toMatchObject({ total: 0, textures: 0, buffers: 0, destroyed: made.made });   // …and every one let go
    still.dispose();
    still.dispose();
    expect(gpu.ledger.read()).toMatchObject({ total: 0, textures: 0, buffers: 0 });
    expect(misses(still, 28, 22, 52, 38)).toBe(0);   // the bytes are the caller's
  });

  it("a kind refused at create (petition I24) is no still of it: the promise rejects naming the kind and why, everything released", async () => {
    const gpu = device();
    const Broken = stubObject(async () => { throw new Error("WGSL refused: no such pipeline"); });
    const kind = Broken.object as ObjectKind;
    await expect(createStill({ device: gpu.device, format: "rgba8unorm", size: { width: 16, height: 16 }, dpr: 1, objects: [Broken], stage: () => {} }))
      .rejects.toThrow(`createStill: the kind "${kind.name}" was refused at create — WGSL refused: no such pipeline`);
    expect(gpu.ledger.read().made).toBeGreaterThan(0);
    expect(gpu.ledger.read()).toMatchObject({ total: 0, textures: 0, buffers: 0 });
  });

  it("a stage that throws rejects with its error, everything released", async () => {
    const gpu = device();
    const Stub = stubObject();
    await expect(createStill({ device: gpu.device, format: "rgba8unorm", size: { width: 16, height: 16 }, dpr: 1, objects: [Stub], stage: () => { throw new Error("the stage fell over"); } }))
      .rejects.toThrow("the stage fell over");
    expect(gpu.ledger.read()).toMatchObject({ total: 0, textures: 0, buffers: 0 });
  });

  it("a malformed option throws AT THE CALL, before anything is made: the size, the dpr, the format, the camera, the theme, a type with no desk kind, the stage", () => {
    const gpu = device();
    const Stub = stubObject();
    const ok: StillOptions = { device: gpu.device, format: "rgba8unorm", size: { width: 16, height: 16 }, dpr: 1, objects: [Stub], stage: () => {} };
    expect(() => createStill({ ...ok, size: { width: 0, height: 16 } })).toThrow("createStill: size.width must be a positive finite number (got 0)");
    expect(() => createStill({ ...ok, dpr: Number.NaN })).toThrow("createStill: dpr must be a positive finite number");
    expect(() => createStill({ ...ok, format: "rgba16float" as never })).toThrow('createStill: format must be "rgba8unorm" or "bgra8unorm"');
    expect(() => createStill({ ...ok, camera: { x: 0, y: Number.POSITIVE_INFINITY, zoom: 1 } })).toThrow("createStill: camera.y must be a finite number");
    expect(() => createStill({ ...ok, camera: { x: 0, y: 0, zoom: 0 } })).toThrow("createStill: camera.zoom must be a positive finite number");
    expect(() => createStill({ ...ok, theme: "dusk" as never })).toThrow('createStill: theme must be "light" or "dark"');
    const Plain = defineWidget({ type: `test.still-plain-${++types}`, version: 1, props: {} });
    expect(() => createStill({ ...ok, objects: [Stub, Plain] })).toThrow(`createStill: "${Plain.type}" is not a desk object`);
    expect(() => createStill({ ...ok, stage: undefined as never })).toThrow("createStill: `stage` must be a function");
    expect(gpu.ledger.read().made).toBe(0);
  });

  it("two stills asked together on ONE device are drawn in turn — a kind's GPU error is its own still's, never the other's", async () => {
    // a kind whose create raises a validation error AFTER its first await: it lands in whatever scope is innermost then — its own
    // still's creation window when the stills take turns; drawn at once, the other still's window (pushed later), which would then
    // find an error no kind of its own raises and refuse itself, while the broken kind's still drew on
    const gpu = device({ refuse: (code) => (code.includes("still-broken") ? "unknown token `still-broken`" : undefined) });
    const Broken = stubObject(async (d) => { await Promise.resolve(); d.createShaderModule({ code: "still-broken" }); return stubPass(d); });
    const Stub = stubObject();
    const stage = (type: string) => ({ engine }: { readonly engine: { readonly ops: { spawnWidget(t: string, o: object): unknown } } }) => { engine.ops.spawnWidget(type, { x: -6, y: -4, w: 12, h: 8, undoable: false }); };
    const base = { device: gpu.device, format: "rgba8unorm", size: { width: 40, height: 30 }, dpr: 2 } as const;
    const [broken, fine] = await Promise.allSettled([createStill({ ...base, objects: [Broken], stage: stage(Broken.type) }), createStill({ ...base, objects: [Stub], stage: stage(Stub.type) })]);
    expect(broken.status).toBe("rejected");
    expect(String((broken as PromiseRejectedResult).reason)).toContain(`the kind "${(Broken.object as ObjectKind).name}" was refused at create — a GPU error while its pass was made: Error while parsing WGSL: unknown token`);
    expect(fine.status).toBe("fulfilled");
    expect(misses((fine as PromiseFulfilledResult<Awaited<ReturnType<typeof createStill>>>).value, 28, 22, 52, 38)).toBe(0);
    expect(gpu.uncaptured).toEqual([]);
    expect(gpu.ledger.read()).toMatchObject({ total: 0, textures: 0, buffers: 0 });
  });

  it("the defaults are the desk's own: the palette its tokens, the theme the Sun — a kind's look made from them", async () => {
    expect(STILL_PALETTE.canvasBg.css).toBe("#86a078");
    const gpu = device();
    const seen: unknown[] = [];
    const kind = stubKind(`still-stub-look-${++types}`);
    const Looked = defineObject({ type: `test.still-looked-${types}`, version: 1, props: {}, kind: { ...kind, theme: (palette, name) => { seen.push([palette, name]); return name; } } });
    await createStill({ device: gpu.device, format: "rgba8unorm", size: { width: 16, height: 16 }, dpr: 1, objects: [Looked], stage: () => {} });
    expect(seen).toEqual([[STILL_PALETTE, "light"]]);
    seen.length = 0;
    const palette = { ...STILL_PALETTE, canvasBg: { token: "test", css: "#000000" } };
    await createStill({ device: gpu.device, format: "rgba8unorm", size: { width: 16, height: 16 }, dpr: 1, objects: [Looked], theme: "dark", palette, stage: () => {} });
    expect(seen).toEqual([[palette, "dark"]]);
  });
});
