// @vitest-environment node
// THE CAPTURE's GPU half (petition I23; ground.ts `captureFrame` / `Ground.capture`): the last frame's inputs drawn ONCE MORE —
// outside any frame, into a readable still at the view's dpr × the scale, the slots prepared for the `capture` target — then the
// rect's device pixels copied to a buffer, mapped and handed back tightly packed in the still's own channel order. Nothing is kept:
// the still (`capture/still`) and the readback (`capture/readback`) are made for the call and destroyed before it answers. The
// held frame goes through its own path, named for the capture, the standing desk copy reused at the view's own size. On the fake
// device (test/fake-gpu.ts — a MAP_READ buffer maps its whole size, every byte its own index) the bytes prove the row unpadding.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureFrame, checkCapture, Ground, type GroundFrameInputs, type PortalInputs, scaledInputs } from "../src/ground";
import { HOLD_SHADER_FILES, holdShaders } from "../src/hold/shaders";
import type { KindPass, KindProgram, SlotContext } from "../src/kind";
import { MAT_SHADER_FILES, matShaders } from "../src/mat/shaders";
import { shaderText } from "../src/shaders";
import { themeFrom } from "../src/theme";
import { DEFAULT_GRID } from "../src/mat/grid";
import { fakeDevice, fakeSurface, installGpuFlags } from "./fake-gpu";

const VIEW = { camX: 0, camY: 0, zoom: 1, width: 1200, height: 800, dpr: 2 };
const THEME = themeFrom("light", { canvasBg: { token: "--vf-canvas-bg", css: "#fafafa" }, select: { token: "--vf-select", css: "#4a90d9" } });

/** A kind whose pass records, per prepare, the target it was prepared for, how many records it was handed and the slot's dpr. */
const recording = (name: string, seen: string[]): KindProgram => {
  const pass = (): KindPass => ({
    spawn: pass,
    prepare: (_e: GPUCommandEncoder, s: SlotContext, records: readonly unknown[]) => { seen.push(`${s.target ?? "frame"}:${records.length}@${s.view.dpr}`); return records.length; },
    drawRange: () => {},
    dispose: () => {},
  });
  return { name, stratum: "things", create: async () => pass() };
};

interface Copy { readonly texture: string; readonly buffer: string; readonly origin: unknown; readonly bytesPerRow: number | undefined; readonly size: unknown }
interface Made { readonly label: string; readonly size?: unknown; readonly usage: number; destroyed: boolean }

/** The fake device, its command encoders' labels and texture-to-buffer copies recorded, every texture and buffer it made and whether destroyed. */
function instrumented(mapRejects = false) {
  const { device, queue } = fakeDevice();
  const encoders: string[] = [];
  const copies: Copy[] = [];
  const made: Made[] = [];
  const dev = device as unknown as {
    createCommandEncoder(d?: GPUCommandEncoderDescriptor): GPUCommandEncoder;
    createTexture(d: GPUTextureDescriptor): GPUTexture;
    createBuffer(d: GPUBufferDescriptor): GPUBuffer;
  };
  const makeEncoder = dev.createCommandEncoder.bind(dev);
  dev.createCommandEncoder = (d) => {
    encoders.push(d?.label ?? "");
    const e = makeEncoder(d) as GPUCommandEncoder & { copyTextureToBuffer: (src: GPUTexelCopyTextureInfo, dst: GPUTexelCopyBufferInfo, size: GPUExtent3DStrict) => void };
    e.copyTextureToBuffer = (src, dst, size) => { copies.push({ texture: src.texture.label, buffer: dst.buffer.label, origin: src.origin, bytesPerRow: dst.bytesPerRow, size }); };
    return e;
  };
  const makeTexture = dev.createTexture.bind(dev);
  dev.createTexture = (d) => {
    const t = makeTexture(d);
    const kept: Made = { label: d.label ?? "", size: d.size, usage: d.usage, destroyed: false };
    made.push(kept);
    (t as { destroy: () => void }).destroy = () => { kept.destroyed = true; };
    return t;
  };
  const makeBuffer = dev.createBuffer.bind(dev);
  dev.createBuffer = (d) => {
    const b = makeBuffer(d);
    const kept: Made = { label: d.label ?? "", size: d.size, usage: d.usage, destroyed: false };
    made.push(kept);
    (b as { destroy: () => void }).destroy = () => { kept.destroyed = true; };
    if (mapRejects && (d.usage & 1) !== 0) (b as unknown as { mapAsync: () => Promise<void> }).mapAsync = () => Promise.reject(new Error("the device was lost"));
    return b;
  };
  const captured = (label: string) => made.filter((m) => m.label === label);
  return { device, queue, encoders, copies, made, captured };
}

describe("the capture's GPU half (I23)", () => {
  const undo: (() => void)[] = [];
  beforeAll(() => { undo.push(installGpuFlags()); });
  afterAll(() => { for (const u of undo.splice(0)) u(); });

  const objects = [{ kind: "thing", record: { id: "a" } }, { kind: "thing", record: { id: "b" } }, { kind: "thing", record: { id: "c" } }];
  const rest: GroundFrameInputs = { view: VIEW, theme: THEME, objects };
  const held = (stamp: string): GroundFrameInputs => ({
    view: VIEW, theme: THEME, objects,
    held: { object: objects[0] as (typeof objects)[number], view: { ...VIEW, zoom: 2.5 }, grid: DEFAULT_GRID, e: 1, blur: 14, dim: 0.3, filter: { saturate: 1, brightness: 1 }, light: THEME.matLight, stamp },
  });

  it("the whole view at the scale: the slots prepared for `capture` at the scaled dpr, the still and the readback made for the call and destroyed, the bytes tight", async () => {
    const seen: string[] = [];
    const t = instrumented();
    const ground = await Ground.create({ device: t.device, surface: fakeSurface(2400, 1600), mat: matShaders(shaderText(MAT_SHADER_FILES)), kinds: [recording("thing", seen)], hold: holdShaders(shaderText(HOLD_SHADER_FILES)) });
    ground.render(rest);
    expect(seen).toEqual(["frame:3@2"]);
    seen.length = 0;
    const submits = t.queue.submits;
    const c = await ground.capture(rest, { scale: 0.5 });
    expect(seen).toEqual(["capture:3@1"]);   // the same records, once more, for the capture at a quarter of the pixels (dpr 2 → 1)
    expect(c).toMatchObject({ width: 1200, height: 800, format: "bgra8unorm" });
    expect(c?.bytes.byteLength).toBe(1200 * 800 * 4);
    expect(t.queue.submits - submits).toBe(1);   // one submit: the frame's encoder with the copy at its end
    expect(t.encoders.slice(-1)).toEqual(["capture"]);
    // the still: readable (COPY_SRC), the view × dpr × scale; the readback: MAP_READ, 256-aligned rows (4800 → 4864); both gone
    const still = t.captured("capture/still");
    const readback = t.captured("capture/readback");
    expect(still).toHaveLength(1);
    expect(still[0]).toMatchObject({ size: [1200, 800], destroyed: true });
    expect((still[0] as Made).usage & GPUTextureUsage.COPY_SRC).toBe(GPUTextureUsage.COPY_SRC);
    expect(readback).toHaveLength(1);
    expect(readback[0]).toMatchObject({ size: 4864 * 800, destroyed: true });
    expect((readback[0] as Made).usage & GPUBufferUsage.MAP_READ).toBe(GPUBufferUsage.MAP_READ);
    expect(t.copies).toEqual([{ texture: "capture/still", buffer: "capture/readback", origin: [0, 0], bytesPerRow: 4864, size: [1200, 800] }]);
    // the rows unpadded: pixel (x, y)'s bytes are the padded row's at x·4 — the fake's byte is its own index
    const px = (x: number, y: number, ch: number): number => (c as { bytes: Uint8Array }).bytes[(y * 1200 + x) * 4 + ch] as number;
    for (const [x, y] of [[0, 0], [1199, 0], [0, 799], [317, 211]] as const) for (let ch = 0; ch < 4; ch++) expect(px(x, y, ch)).toBe((y * 4864 + x * 4 + ch) & 255);
    // the frame after it is the frame, as before
    ground.render(rest);
    expect(seen.slice(-1)).toEqual(["frame:3@2"]);
    ground.dispose();
  });

  /** A live inside at the view's centre: a nested slot with a view of its own (the pool's), prepared by the same recording kind. */
  const portal: PortalInputs = { at: 1, grid: DEFAULT_GRID, view: { camX: -300, camY: -200, zoom: 0.5, width: 1200, height: 800, dpr: 2 }, present: { opacity: 1, portal: { cx: 600, cy: 400, hx: 250, hy: 180, r: 8 } }, objects: [{ kind: "thing", record: { id: "inside" } }] };

  it("every view in the tree is scaled — the root's, a live inside's (the nested slot prepares against its OWN view), the departed desk's, the hand's, the marks', the tray's", async () => {
    const seen: string[] = [];
    const t = instrumented();
    const ground = await Ground.create({ device: t.device, surface: fakeSurface(2400, 1600), mat: matShaders(shaderText(MAT_SHADER_FILES)), kinds: [recording("thing", seen)] });
    const withInside: GroundFrameInputs = { ...rest, portals: [portal] };
    ground.render(withInside);
    expect(seen).toEqual(["frame:1@2", "frame:3@2"]);   // the inside's slot prepares first (its records), then the root's
    seen.length = 0;
    await ground.capture(withInside, { scale: 0.25 });
    expect(seen).toEqual(["capture:1@0.5", "capture:3@0.5"]);   // the inside at the capture's dpr too — not the frame's 2
    ground.dispose();
    // the pure walk: every dpr × the scale, nothing else touched; at 1 the inputs themselves
    const tray = { p: 1, scroll: 0, specimens: [{ view: { camX: 0, camY: 0, zoom: 1, width: 1200, height: 800, dpr: 2 } }], carried: [{ view: { camX: 0, camY: 0, zoom: 1, width: 1200, height: 800, dpr: 2 } }] } as unknown as NonNullable<GroundFrameInputs["tray"]>;
    const marks = { view: { width: 1200, height: 800, dpr: 2 }, records: [] } as unknown as NonNullable<GroundFrameInputs["marks"]>;
    const nested: PortalInputs = { ...portal, portals: [{ ...portal, at: 0 }] };
    const full: GroundFrameInputs = { ...rest, portals: [nested], outgoing: { view: VIEW, grid: DEFAULT_GRID, order: "under", objects, portals: [portal] }, held: (held("s") as Required<GroundFrameInputs>).held, marks, tray };
    expect(scaledInputs(full, 1)).toBe(full);
    const s = scaledInputs(full, 0.25);
    const dprs = (f: GroundFrameInputs): number[] => [
      f.view.dpr, f.portals?.[0]?.view.dpr ?? -1, f.portals?.[0]?.portals?.[0]?.view.dpr ?? -1, f.outgoing?.view.dpr ?? -1, f.outgoing?.portals?.[0]?.view.dpr ?? -1,
      f.held?.view.dpr ?? -1, f.marks?.view.dpr ?? -1, f.tray?.specimens?.[0]?.view.dpr ?? -1, f.tray?.carried?.[0]?.view.dpr ?? -1,
    ];
    expect(dprs(full)).toEqual([2, 2, 2, 2, 2, 2, 2, 2, 2]);
    expect(dprs(s)).toEqual([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    expect(s.objects).toBe(full.objects);   // the records untouched
    expect(s.outgoing?.order).toBe("under");
    expect(s.portals?.[0]?.at).toBe(1);
    expect(s.held?.stamp).toBe("s");
    expect(s.tray?.p).toBe(1);
  });

  it("a rect: the whole frame drawn, the rect's device pixels alone copied and returned; one wholly off the view is undefined", async () => {
    const seen: string[] = [];
    const t = instrumented();
    const ground = await Ground.create({ device: t.device, surface: fakeSurface(2400, 1600), mat: matShaders(shaderText(MAT_SHADER_FILES)), kinds: [recording("thing", seen)] });
    ground.render(rest);
    const c = await ground.capture(rest, { rect: { x: 100, y: 50, width: 200, height: 100 } });
    expect(c).toMatchObject({ width: 400, height: 200 });
    expect(t.captured("capture/still")[0]).toMatchObject({ size: [2400, 1600] });   // the frame, whole, at the view's dpr
    expect(t.copies).toEqual([{ texture: "capture/still", buffer: "capture/readback", origin: [200, 100], bytesPerRow: 1792, size: [400, 200] }]);
    const px = (x: number, y: number, ch: number): number => (c as { bytes: Uint8Array }).bytes[(y * 400 + x) * 4 + ch] as number;
    for (const [x, y] of [[0, 0], [399, 199], [123, 45]] as const) for (let ch = 0; ch < 4; ch++) expect(px(x, y, ch)).toBe((y * 1792 + x * 4 + ch) & 255);
    // the rect clipped to the view: a rect running off the right edge is cut there
    const edge = await ground.capture(rest, { rect: { x: 1100, y: 700, width: 300, height: 300 } });
    expect(edge).toMatchObject({ width: 200, height: 200 });
    // …and one wholly off it is nothing — honestly, with nothing made
    const n = t.made.length;
    expect(await ground.capture(rest, { rect: { x: 1300, y: 0, width: 10, height: 10 } })).toBeUndefined();
    expect(t.made.length).toBe(n);
    ground.dispose();
  });

  it("a malformed option throws at the call (checkCapture) — never an honest undefined", async () => {
    expect(() => checkCapture({ scale: 0 })).toThrow("capture: scale must be a positive finite number");
    expect(() => checkCapture({ scale: Number.NaN })).toThrow("scale");
    expect(() => checkCapture({ rect: { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 1 } })).toThrow("rect.width");
    expect(() => checkCapture({ rect: { x: 1, y: 2, width: 3, height: 4 }, scale: 0.25 })).not.toThrow();
    const seen: string[] = [];
    const t = instrumented();
    const ground = await Ground.create({ device: t.device, surface: fakeSurface(2400, 1600), mat: matShaders(shaderText(MAT_SHADER_FILES)), kinds: [recording("thing", seen)] });
    const n = t.made.length;   // what Ground.create made
    await expect(ground.capture(rest, { scale: -1 })).rejects.toThrow("capture: scale");
    expect(t.made).toHaveLength(n);   // refused before anything was made for it
    ground.dispose();
  });

  it("the device lost mid-copy — the map rejects: undefined, never a throw, the still and the readback destroyed all the same", async () => {
    const seen: string[] = [];
    const t = instrumented(true);
    const ground = await Ground.create({ device: t.device, surface: fakeSurface(2400, 1600), mat: matShaders(shaderText(MAT_SHADER_FILES)), kinds: [recording("thing", seen)] });
    ground.render(rest);
    expect(await ground.capture(rest)).toBeUndefined();
    expect(t.captured("capture/still")[0]?.destroyed).toBe(true);
    expect(t.captured("capture/readback")[0]?.destroyed).toBe(true);
    ground.dispose();
  });

  it("a held frame: its own path named for the capture — the standing desk copy reused at the view's size (no copy made), the hand alone redrawn; at another scale the copy is remade", async () => {
    const seen: string[] = [];
    const t = instrumented();
    const ground = await Ground.create({ device: t.device, surface: fakeSurface(2400, 1600), mat: matShaders(shaderText(MAT_SHADER_FILES)), kinds: [recording("thing", seen)], hold: holdShaders(shaderText(HOLD_SHADER_FILES)) });
    ground.render(held("s1"));
    expect(seen).toEqual(["copy:3@1", "hand:1@2"]);
    expect(ground.heldCopies()).toBe(1);
    seen.length = 0;
    const c = await ground.capture(held("s1"));
    expect(c).toMatchObject({ width: 2400, height: 1600 });
    expect(seen).toEqual(["hand:1@2"]);   // the copy stands (the same stamp, the same size): the hand alone, and the composite into the still
    expect(ground.heldCopies()).toBe(1);
    expect(t.encoders.slice(-2)).toEqual(["capture", "capture/read"]);   // never `hold`: a capture closes no profiler frame
    seen.length = 0;
    const q = await ground.capture(held("s1"), { scale: 0.5 });
    expect(q).toMatchObject({ width: 1200, height: 800 });
    expect(seen).toEqual(["copy:3@0.5", "hand:1@1"]);   // the hold's targets refit to the still's size: the copy made again, for the capture
    expect(ground.heldCopies()).toBe(2);
    expect(t.encoders.slice(-3)).toEqual(["capture/copy", "capture", "capture/read"]);
    ground.dispose();
  });

  it("captureFrame on bare passes (the oracle's shape): the ground IS its passes", async () => {
    const seen: string[] = [];
    const t = instrumented();
    const ground = await Ground.create({ device: t.device, surface: fakeSurface(2400, 1600), mat: matShaders(shaderText(MAT_SHADER_FILES)), kinds: [recording("thing", seen)] });
    const c = await captureFrame(t.device, { root: ground.root, pool: ground.pool, grid: ground.grid, marks: null, hold: null, tray: null, traySlots: null }, "rgba8unorm", rest, { stamp: null, stats: null, copies: 0 }, { scale: 0.25 });
    expect(c).toMatchObject({ width: 600, height: 400, format: "rgba8unorm" });
    expect(seen).toEqual(["capture:3@0.5"]);
    ground.dispose();
  });
});
