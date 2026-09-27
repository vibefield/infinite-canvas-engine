// K4a (design-016 K-L3): ONE VIEW PER SLOT. The slot's camera/light/frame block is the mat's own uniform buffer, written
// once a frame by the mat; every kind drawn in the slot binds that buffer and none makes or writes a copy (36 KB and ~68
// writes a frame on the stress pan until K4a — a copy per kind per slot). And one wind target per plate serves every
// slot: the wind reads only the clock, the plate's strength and the plate, so slots at one key draw it once.
import { describe, expect, it } from "vitest";
import { deskKinds } from "../src/kinds";
import { MatUniforms, DEFAULT_MAT_CONFIG, type MatConfig, type MatFrame } from "@ice/desk";
import { STILL_MAT_FRAME } from "../../desk/src/mat/layout";
import { CuttingMat } from "../../desk/src/mat/mat-pass";
import { MAT_SHADER_FILES, matShaders } from "../../desk/src/mat/shaders";
import { shaderText } from "../src/shaders";
import { fakeDevice, installGpuFlags } from "../../desk/test/fake-gpu";

installGpuFlags();

/** A fake device that records the buffers made, the bind groups made, the render passes begun, and the queue's writes. */
function recording() {
  const { device } = fakeDevice();
  const buffers: GPUBufferDescriptor[] = [];
  const groups: GPUBindGroupDescriptor[] = [];
  const passes: string[] = [];
  const writes: string[] = [];
  const d = device as unknown as Record<string, (...a: never[]) => unknown>;
  const makeBuffer = d.createBuffer as (x: GPUBufferDescriptor) => GPUBuffer;
  const makeGroup = d.createBindGroup as (x: GPUBindGroupDescriptor) => GPUBindGroup;
  const makeEncoder = d.createCommandEncoder as () => GPUCommandEncoder;
  d.createBuffer = ((x: GPUBufferDescriptor) => { buffers.push(x); return makeBuffer(x); }) as never;
  d.createBindGroup = ((x: GPUBindGroupDescriptor) => { groups.push(x); return makeGroup(x); }) as never;
  d.createCommandEncoder = (() => {
    const e = makeEncoder();
    const begin = e.beginRenderPass.bind(e);
    (e as { beginRenderPass: unknown }).beginRenderPass = (x: GPURenderPassDescriptor) => { passes.push(x.label ?? ""); return begin(x); };
    return e;
  }) as never;
  (device.queue as { writeBuffer: unknown }).writeBuffer = (b: { label: string }) => { writes.push(b.label); };
  return { device, buffers, groups, passes, writes };
}

const VIEW = { camX: 0, camY: 0, zoom: 1, width: 1200, height: 800, dpr: 2 } as const;
const FADE = [10, 20] as const;
const at = (goboTime: number): MatFrame => ({ ...STILL_MAT_FRAME, goboTime });
const lit = (cfg: MatConfig = DEFAULT_MAT_CONFIG): MatConfig => ({ ...cfg, gobo: { ...cfg.gobo, opacity: 0.5 } });

describe("one view block per slot (K4a, K-L3)", () => {
  it("no kind makes a block of its own: the only view-sized buffers are the slots' mats', and every group binding one binds a mat's `view`", async () => {
    const { device, buffers, groups } = recording();
    const root = await CuttingMat.create(device, "bgra8unorm", matShaders(shaderText(MAT_SHADER_FILES)));
    const inner = root.spawn();
    for (const program of deskKinds()) {
      const pass = await program.create(device, "bgra8unorm", root);
      pass.spawn(inner);
    }
    const sized = buffers.filter((b) => b.size === MatUniforms.size);
    expect(sized.map((b) => b.label)).toEqual(["mat/uniforms", "mat/uniforms"]);   // the root's and the inside's
    const views = new Set<unknown>([root.view, inner.view]);
    const bound = groups.flatMap((g) => [...g.entries]).map((e) => (e.resource as { buffer?: GPUBuffer }).buffer).filter((b) => b !== undefined && (b as { size?: number }).size === MatUniforms.size);
    expect(bound.length).toBeGreaterThanOrEqual(2 + 4 * 2);   // the mat's own groups, and the four flat kinds in both slots
    for (const b of bound) expect(views.has(b)).toBe(true);
  });

  it("the mat writes the block once a slot a frame; the objects' presence rides in it beside the slot's own", async () => {
    const { device, writes } = recording();
    const mat = await CuttingMat.create(device, "bgra8unorm", matShaders(shaderText(MAT_SHADER_FILES)));
    writes.length = 0;
    mat.prepare(device.createCommandEncoder(), VIEW, FADE, DEFAULT_MAT_CONFIG, STILL_MAT_FRAME, { opacity: 0.8, objects: 0.5 });
    expect(writes).toEqual(["mat/uniforms"]);
  });
});

describe("one wind target per plate serves every slot (K4a)", () => {
  it("slots at one key draw the wind once and sample one silhouette; a new frame's key draws it again, once", async () => {
    const { device, passes } = recording();
    const root = await CuttingMat.create(device, "bgra8unorm", matShaders(shaderText(MAT_SHADER_FILES)));
    const slots = [root, root.spawn(), root.spawn(), root.spawn()];
    const frame = (t: number, cfg: MatConfig = lit()) => {
      root.newFrame();
      const e = device.createCommandEncoder();
      return slots.map((s) => s.prepare(e, VIEW, FADE, cfg, at(t)));
    };
    passes.length = 0;
    expect(frame(1)).toEqual([true, false, false, false]);
    expect(passes.filter((p) => p === "mat/wind")).toHaveLength(1);
    for (const s of slots) expect(s.silhouette).toBe(root.silhouette);
    expect(frame(1)).toEqual([false, false, false, false]);   // the clock stood: nothing drawn
    expect(frame(2)).toEqual([true, false, false, false]);
    expect(passes.filter((p) => p === "mat/wind")).toHaveLength(2);
    // a gobo at opacity 0 never consults its silhouette: no slot draws one
    expect(frame(3, DEFAULT_MAT_CONFIG.gobo.opacity > 0 ? { ...DEFAULT_MAT_CONFIG, gobo: { ...DEFAULT_MAT_CONFIG.gobo, opacity: 0 } } : DEFAULT_MAT_CONFIG)).toEqual([false, false, false, false]);
  });

  it("a slot clocked apart in the same frame draws into its own target — no slot ever samples another's clock — and rebinds its kinds when it moves back", async () => {
    const { device } = recording();
    const root = await CuttingMat.create(device, "bgra8unorm", matShaders(shaderText(MAT_SHADER_FILES)));
    const apart = root.spawn();
    root.newFrame();
    const e = device.createCommandEncoder();
    expect(root.prepare(e, VIEW, FADE, lit(), at(1))).toBe(true);
    const before = apart.assetVersion;
    expect(apart.prepare(e, VIEW, FADE, lit(), at(9))).toBe(true);   // another key on the same plate, this frame: its own target
    expect(apart.silhouette).not.toBe(root.silhouette);
    expect(apart.assetVersion).not.toBe(before);                   // a kind bound to the slot's silhouette rebinds
    // the next frame both stand at one key again: the shared target serves both
    root.newFrame();
    const e2 = device.createCommandEncoder();
    root.prepare(e2, VIEW, FADE, lit(), at(2));
    expect(apart.prepare(e2, VIEW, FADE, lit(), at(2))).toBe(false);
    expect(apart.silhouette).toBe(root.silhouette);
  });
});
