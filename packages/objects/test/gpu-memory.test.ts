// @vitest-environment node
// THE MEMORY LEDGER and the byte rule (design-016 §4.2, K2): live GPU bytes by label through `createTexture` / `createBuffer`
// and each resource's `destroy`; a texture's bytes by the formula gpu-memory.ts states (Σ mips ⌈w/bw⌉·⌈h/bh⌉·blockBytes·layers,
// × samples). Until K2 nothing counted GPU memory but the raster budget's own caches (board/notebook/calendar rasters).
import { createCanvasEngine } from "@ice/core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PALETTE, THEMES } from "../oracle/fixtures/vf-theme";
import { formatBlock, instrumentMemory, regionBytes, textureBytes, deskLayer } from "@ice/desk";
import { fakeDevice, installGpuFlags } from "../../desk/test/fake-gpu";

describe("the byte rule", () => {
  it("a texture's logical bytes: every mip, every layer, every sample, by the format's block", () => {
    expect(textureBytes({ size: [2048, 2048, 4], format: "r8unorm" })).toBe(2048 * 2048 * 4);   // the note-ink atlas: 16 MiB
    const mips = [4096, 2048, 1024, 512, 256, 128, 64, 32, 16, 8, 4, 2, 1];
    expect(textureBytes({ size: { width: 4096, height: 4096 }, format: "rgba8unorm", mipLevelCount: 13 })).toBe(mips.reduce((s, m) => s + m * m * 4, 0));
    expect(textureBytes({ size: [1200, 800], format: "rgba8unorm", sampleCount: 4 })).toBe(1200 * 800 * 4 * 4);   // a 4× MSAA layer
    expect(textureBytes({ size: [1024, 1024, 8], format: "depth32float" })).toBe(1024 * 1024 * 4 * 8);   // eight shadow maps
    expect(textureBytes({ size: [10, 6], format: "bc1-rgba-unorm", mipLevelCount: 2 })).toBe(3 * 2 * 8 + 2 * 1 * 8);   // 4×4 blocks, rounded up
    expect(textureBytes({ size: [16, 16, 16], format: "rgba16float", dimension: "3d", mipLevelCount: 2 })).toBe(16 * 16 * 16 * 8 + 8 * 8 * 8 * 8);   // a 3d mip halves its depth
    expect(textureBytes({ size: [64], format: "r32float", dimension: "1d", mipLevelCount: 2 })).toBe(64 * 4 + 32 * 4);   // 1d: one row a mip
    expect(formatBlock("bgra8unorm-srgb").bytes).toBe(4);
    expect(formatBlock("astc-10x8-unorm")).toEqual({ w: 10, h: 8, bytes: 16 });
    expect(formatBlock("depth24plus-stencil8").bytes).toBe(4);
    expect(formatBlock("wat").guessed).toBe(true);
    expect(regionBytes("rgba8unorm", [640, 480])).toBe(640 * 480 * 4);
  });
});

/** A device whose resources are plain objects with a `destroy` — made by prototype methods, as the browser's are. */
class FakeDevice {
  readonly ended: string[] = [];
  createTexture(d: GPUTextureDescriptor): GPUTexture { const ended = this.ended; const label = d.label ?? ""; return { label, destroy: () => { ended.push(label); } } as unknown as GPUTexture; }
  createBuffer(d: GPUBufferDescriptor): GPUBuffer { const ended = this.ended; const label = d.label ?? ""; return { label, size: d.size, destroy: () => { ended.push(label); } } as unknown as GPUBuffer; }
}

describe("the memory ledger (K2)", () => {
  it("sums by label to exactly what was made, drops by exactly what was destroyed, and leaves the device as it found it", () => {
    const dev = new FakeDevice();
    const device = dev as unknown as GPUDevice;
    const ledger = instrumentMemory(device);
    expect(instrumentMemory(device)).toBe(ledger);
    expect(Object.hasOwn(dev, "createTexture") && Object.hasOwn(dev, "createBuffer")).toBe(true);
    const ink = device.createTexture({ label: "paper/ink pages", size: [2048, 2048, 4], format: "r8unorm", usage: 0 });
    const board = device.createTexture({ label: "board/ink 1", size: [1024, 512], format: "rgba8unorm", mipLevelCount: 2, usage: 0 });
    device.createTexture({ label: "board/ink 2", size: [1024, 512], format: "rgba8unorm", mipLevelCount: 2, usage: 0 });
    const notes = device.createBuffer({ label: "paper/notes", size: 64 * 1024, usage: 0 });
    device.createBuffer({ size: 256, usage: 0 });   // unlabelled
    const boardBytes = 1024 * 512 * 4 + 512 * 256 * 4;
    let m = ledger.read();
    expect(m.byLabel).toEqual({
      paper: { bytes: 2048 * 2048 * 4 + 64 * 1024, textures: 1, buffers: 1 },
      board: { bytes: 2 * boardBytes, textures: 2, buffers: 0 },
      "?": { bytes: 256, textures: 0, buffers: 1 },
    });
    expect(m.textures).toBe(2048 * 2048 * 4 + 2 * boardBytes);
    expect(m.buffers).toBe(64 * 1024 + 256);
    expect(m.total).toBe(Object.values(m.byLabel).reduce((s, r) => s + r.bytes, 0));   // the rows sum to the total
    expect(m.made).toBe(5);
    expect(ledger.top(2)).toEqual([{ label: "paper/ink pages", bytes: 2048 * 2048 * 4, count: 1 }, { label: "board/ink 1", bytes: boardBytes, count: 1 }]);
    board.destroy();
    board.destroy();   // twice: counted once, the resource's own destroy still called
    notes.destroy();
    m = ledger.read();
    expect(m.byLabel.board).toEqual({ bytes: boardBytes, textures: 1, buffers: 0 });
    expect(m.byLabel.paper).toEqual({ bytes: 2048 * 2048 * 4, textures: 1, buffers: 0 });
    expect(m.total).toBe(2048 * 2048 * 4 + boardBytes + 256);
    expect([m.destroyed, dev.ended]).toEqual([2, ["board/ink 1", "board/ink 1", "paper/notes"]]);
    ink.destroy();
    expect(ledger.read().byLabel.paper).toBeUndefined();   // a kind with nothing live leaves the table
    ledger.detach();
    expect(Object.hasOwn(dev, "createTexture") || Object.hasOwn(dev, "createBuffer")).toBe(false);
  });
});

describe("the layer keeps a ledger only when the host asks (D-K2.2)", () => {
  const undo: (() => void)[] = [];
  beforeAll(() => { undo.push(installGpuFlags()); });
  afterAll(() => { for (const u of undo.splice(0)) u(); });

  async function mount(gpuLedger: boolean | undefined) {
    const { device } = fakeDevice();
    const own = { createTexture: device.createTexture, createBuffer: device.createBuffer };
    Object.assign(device, { addEventListener: () => {}, lost: new Promise(() => {}), destroy: () => {} });
    const adapter = { features: new Set<string>(), requestDevice: async () => device };
    const gpu = { requestAdapter: async () => adapter, getPreferredCanvasFormat: () => "bgra8unorm" } as unknown as GPU;
    const context = { configure: () => {}, unconfigure: () => {}, getCurrentTexture: () => ({ createView: () => ({ label: "swap" }), width: 1, height: 1 }) };
    const canvas = { style: {}, width: 1, height: 1, clientWidth: 1, clientHeight: 1, getContext: () => context, remove: () => {} };
    const container = { ownerDocument: { createElement: () => canvas, defaultView: undefined }, prepend: () => {} } as unknown as HTMLElement;
    vi.stubGlobal("navigator", { gpu });
    const ce = createCanvasEngine({});
    ce.docs.create();
    const handle = deskLayer({ gpu, objects: [], theme: THEMES.light, palette: PALETTE.light, ...(gpuLedger !== undefined ? { gpuLedger } : {}) })({ host: { container }, world: ce.world });
    for (let i = 0; i < 50 && handle.status().state === "pending"; i++) await new Promise((r) => setTimeout(r, 5));
    return { ce, handle, device, own };
  }

  it("gpuLedger: the ground's own resources are in it from the boot (the mat's, the marks', the hand's); dispose takes it off", async () => {
    try {
      const { ce, handle, device, own } = await mount(true);
      expect(handle.status()).toEqual({ state: "ready" });
      const m = handle.gpuMemory()?.read();
      expect(m?.made ?? 0).toBeGreaterThan(0);
      expect(Object.keys(m?.byLabel ?? {})).toEqual(expect.arrayContaining(["mat"]));   // made by Ground.create, after the install
      expect(m?.total).toBe(Object.values(m?.byLabel ?? {}).reduce((s, r) => s + r.bytes, 0));
      handle.dispose();
      expect(device.createTexture).toBe(own.createTexture);
      expect(device.createBuffer).toBe(own.createBuffer);
      ce.dispose();
    } finally { vi.unstubAllGlobals(); }
  });

  it("unasked: no ledger, and the device's createTexture / createBuffer are its own", async () => {
    try {
      const { ce, handle, device, own } = await mount(undefined);
      expect(handle.status()).toEqual({ state: "ready" });
      expect(handle.gpuMemory()).toBeUndefined();
      expect(device.createTexture).toBe(own.createTexture);
      expect(device.createBuffer).toBe(own.createBuffer);
      handle.dispose();
      ce.dispose();
    } finally { vi.unstubAllGlobals(); }
  });
});
