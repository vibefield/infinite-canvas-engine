// The PHOTO print as a kind (design-015 D3r-a): the photo pass behind the registry's door. Its adapter
// hands the pass what the ground hands it; the pass itself — on a fake device, no pixels (those are the
// oracle's `photo-*` scenes and apps/desk's rigs) — spawns a slot's own buffers on the shared pipeline,
// samplers and pictures, draws in RANGES of the prints it was handed, as the ground's runs ask, and a slot
// lit from elsewhere (a mini mat's inside — MINIMAT.md §4) draws with its second pipeline and the host's lamp.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSlotSet, drawSlot, type DrawSlot, type KindPass, type SlotContext } from "../src/ground";
import { DESK_KINDS, PHOTO_KIND, PhotoKind, photoProgram } from "../src/kinds";
import { DEFAULT_GRID } from "../src/mat/grid";
import { DEFAULT_MAT_CONFIG, MatUniforms, matUniformValues, NO_GLYPHS, type SlotLight, STILL_MAT_FRAME } from "../src/mat/layout";
import { CuttingMat } from "../src/mat/mat-pass";
import { MAT_SHADER_FILES, matShaders } from "../src/mat/shaders";
import { newBody, resolvePhoto } from "../src/photo/photo";
import type { PhotoInstance, PhotoPass, Picture } from "../src/photo/photo-pass";
import { shaderText } from "../src/shaders";
import { MAT_GRID } from "../src/theme";
import { THEMES } from "../oracle/fixtures/vf-theme";
import { fakeDevice, installGpuFlags } from "./fake-gpu";
import { loggingKind } from "./fake-kinds";
import { must } from "./must";

const VIEW = { camX: 5, camY: 7, zoom: 1, width: 1200, height: 800, dpr: 2 };
const SIZE = { w: 2400, h: 1600 };
const ctx = (over: Partial<SlotContext> = {}): SlotContext => ({
  view: VIEW, fadeIn: DEFAULT_GRID.fadeIn, cfg: DEFAULT_MAT_CONFIG, frame: STILL_MAT_FRAME, present: undefined,
  light: THEMES.light.matLight, lit: undefined, select: THEMES.light.select, theme: THEMES.light, ...over,
});
/** Every argument the very value expected — identity, not a look-alike. */
function same(actual: readonly unknown[] | undefined, expected: readonly unknown[]): void {
  const a = must(actual, "a recorded call");
  expect(a).toHaveLength(expected.length);
  expected.forEach((x, i) => expect(a[i], `argument ${i}`).toBe(x));
}
/** A render pass that records what it is told as the objects themselves (a label is not an identity). */
function objectPass(calls: unknown[][]): GPURenderPassEncoder {
  return {
    setPipeline: (p: unknown) => calls.push(["pipeline", p]),
    setBindGroup: (i: number, g: unknown) => calls.push(["group", i, g]),
    draw: (...a: number[]) => calls.push(["draw", ...a]),
    setScissorRect: () => {},
  } as unknown as GPURenderPassEncoder;
}
const print = (x: number, picture: Picture | null): PhotoInstance => ({ geometry: resolvePhoto(newBody(x, 0, 400, 266)), border: 13, picture });

describe("the photo print in the registry", () => {
  it("photoProgram: the kind named `photo`, in the things stratum, its pass made on the root's mat from the host's shader text", () => {
    const program = photoProgram(shaderText);
    expect(program.name).toBe(PHOTO_KIND);
    expect(PHOTO_KIND).toBe("photo");
    expect(program.stratum).toBe("things");
    expect(DESK_KINDS.map((k) => k.name).indexOf(PHOTO_KIND)).toBe(DESK_KINDS.map((k) => k.name).indexOf("board") + 1);   // after the whiteboard (the two layers come after it — D3r-b)
  });

  it("the adapter hands its pass's prepare exactly what the ground hands it: the slot's camera, grid, clocks, the objects' presence, the light, the lamp", () => {
    const got: unknown[][] = [];
    const spy = { prepare: (...a: unknown[]) => { got.push(a); return 3; } };
    const kind: KindPass = new PhotoKind(spy as unknown as PhotoPass);
    const s = ctx({ present: { opacity: 0.5 }, light: THEMES.dark.matLight, theme: THEMES.dark, lit: { a: { x: 1, y: 2, zoom: 3 } } });
    const records: never[] = [];
    expect(kind.prepare({} as GPUCommandEncoder, s, records, { live: () => 0.5 })).toBe(3);
    same(got[0], [s.view, s.fadeIn, s.cfg, s.frame, records, s.present, s.light, s.lit, undefined]);   // …and the records' keys (D6): none handed here
  });

  it("spawn wraps the pass's own spawn; tune takes the root's law; ranges forward", () => {
    const log: unknown[][] = [];
    const pass = (name: string): unknown => ({
      name,
      spawn: (m: unknown) => { log.push(["spawn", name, m]); return pass(`${name}'`); },
      tune: (r: { name: string }) => log.push(["tune", name, r.name]),
      drawRange: (_p: unknown, a: number, b: number) => log.push(["range", name, a, b]),
    });
    const mat = { mat: true } as unknown as CuttingMat;
    const root = new PhotoKind(pass("photo") as PhotoPass);
    const inside = root.spawn(mat);
    expect(inside).toBeInstanceOf(PhotoKind);
    inside.tune(root); inside.drawRange({} as GPURenderPassEncoder, 1, 4);
    inside.tune({} as KindPass<PhotoInstance>);   // a root of another kind teaches nothing
    expect(log).toEqual([["spawn", "photo", mat], ["tune", "photo'", "photo"], ["range", "photo'", 1, 4]]);
  });
});

describe("the photo pass on a fake device (no pixels: the oracle has those)", () => {
  const undo: (() => void)[] = [];
  beforeAll(() => { undo.push(installGpuFlags()); });
  afterAll(() => { for (const u of undo.splice(0)) u(); });

  /** The root's photo pass on a fake device that keeps every bind group, pipeline and buffer write it made and every texture (with whether it was destroyed). */
  async function root() {
    const { device } = fakeDevice();
    const groups: GPUBindGroupDescriptor[] = [];
    const pipelines: GPURenderPipelineDescriptor[] = [];
    const writes: { readonly buffer: string; readonly bytes: Uint8Array }[] = [];
    const textures: { readonly texture: unknown; destroyed: boolean }[] = [];
    const makeGroup = device.createBindGroup.bind(device);
    const makeTexture = device.createTexture.bind(device);
    const makePipeline = device.createRenderPipelineAsync.bind(device);
    const d = device as { createBindGroup: GPUDevice["createBindGroup"]; createTexture: GPUDevice["createTexture"]; createRenderPipelineAsync: GPUDevice["createRenderPipelineAsync"] };
    d.createBindGroup = (desc) => { groups.push(desc); return makeGroup(desc); };
    d.createRenderPipelineAsync = (desc) => { pipelines.push(desc); return makePipeline(desc); };
    (device.queue as { writeBuffer: unknown }).writeBuffer = (buffer: { label: string }, _offset: number, data: ArrayBufferView) => {
      writes.push({ buffer: buffer.label, bytes: new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice() });
    };
    d.createTexture = (desc) => {
      const texture = makeTexture(desc);
      const kept = { texture, destroyed: false };
      textures.push(kept);
      (texture as { destroy: () => void }).destroy = () => { kept.destroyed = true; };
      return texture;
    };
    const mat = await CuttingMat.create(device, "bgra8unorm", matShaders(shaderText(MAT_SHADER_FILES)));
    const set = await createSlotSet(device, "bgra8unorm", mat, [photoProgram(shaderText)]);
    const kind = must(set.kinds.get(PHOTO_KIND)).pass as PhotoKind;
    return { device, mat, kind, groups, pipelines, writes, textures };
  }

  it("a spawned slot shares the pipeline and the pictures, and binds its own buffers and ITS mat's silhouette", async () => {
    const { mat, kind, groups } = await root();
    const inner = mat.spawn();
    const spawned = kind.spawn(inner);
    const picture = kind.pass.picture(new Uint8Array([10, 20, 30, 255]), 1, 1);
    // each slot's group 0: its own uniform, knob and record buffers; the silhouette of the mat it was made on
    const slotGroups = groups.filter((g) => g.label === "photo/prints");
    expect(slotGroups).toHaveLength(2);
    const [rootGroup, innerGroup] = slotGroups.map((g) => [...g.entries].map((e) => e.resource));
    expect(rootGroup?.[3]).toBe(mat.silhouette);
    expect(innerGroup?.[3]).toBe(inner.silhouette);
    for (const i of [0, 1, 2]) expect(innerGroup?.[i]).not.toBe(rootGroup?.[i]);
    // the root's picture draws in the spawned slot, on the root's pipeline
    const a: unknown[][] = [];
    const b: unknown[][] = [];
    kind.prepare({} as GPUCommandEncoder, ctx(), [print(0, picture)]);
    spawned.prepare({} as GPUCommandEncoder, ctx(), [print(0, picture)]);
    kind.drawRange(objectPass(a), 0, 1);
    spawned.drawRange(objectPass(b), 0, 1);
    expect(b[0]?.[1]).toBe(a[0]?.[1]);        // the one pipeline
    expect(b[1]?.[2]).not.toBe(a[1]?.[2]);    // each slot's own group 0
    expect(b[2]?.[2]).toBe(picture.group);   // the picture, made once, bound in both
    expect(a[2]?.[2]).toBe(picture.group);
    // a spawned slot takes the root's law when tuned (the ground does it every frame)
    const law = structuredClone(kind.pass.law);
    kind.pass.law = law;
    spawned.tune(kind);
    expect(spawned.pass.law).toBe(law);
  });

  it("the slot's light picks the pipeline — a pipeline CONSTANT, never a uniform flag: its own lamp draws with the plain one (no constants), a host's lamp or a handover mid-way with LIT_ELSEWHERE", async () => {
    const { kind, pipelines } = await root();
    const plain = must(pipelines.find((p) => p.label === "photo/prints"));
    const litDesc = must(pipelines.find((p) => p.label === "photo/prints, lit from elsewhere"));
    for (const stage of [plain.vertex, plain.fragment]) expect(stage?.constants).toEqual({});
    for (const stage of [litDesc.vertex, litDesc.fragment]) expect(stage?.constants).toEqual({ LIT_ELSEWHERE: 1 });
    expect(litDesc.fragment?.module).toBeDefined();
    expect(litDesc.fragment?.module).toBe(plain.fragment?.module);   // one module, two specialisations
    const own = { x: VIEW.camX, y: VIEW.camY, zoom: VIEW.zoom };
    const host = { x: 40, y: -12, zoom: 0.5 };
    const drawnWith = (lit: SlotLight | undefined) => {
      kind.prepare({} as GPUCommandEncoder, ctx({ lit }), [print(0, null)]);
      const c: unknown[][] = [];
      kind.drawRange(objectPass(c), 0, 1);
      return (c[0]?.[1] as { label: string }).label;
    };
    expect(drawnWith(undefined)).toBe("photo/prints");                                  // the root at rest
    expect(drawnWith({ a: own })).toBe("photo/prints");                                 // a light that IS its own camera
    expect(drawnWith({ a: host, b: own, t: 1 })).toBe("photo/prints");                 // a handover landed on its own
    expect(drawnWith({ a: host })).toBe("photo/prints, lit from elsewhere");            // a mini mat's inside: the host's lamp
    expect(drawnWith({ a: own, b: host, t: 0.5 })).toBe("photo/prints, lit from elsewhere");   // a handover mid-way
    expect(drawnWith(undefined)).toBe("photo/prints");                                  // and back: the choice is per frame
  });

  it("the lamp reaches the mat block the prints are shaded by: the host's camera as the slot's light, its own camera without one", async () => {
    const { kind, writes } = await root();
    const host: SlotLight = { a: { x: 40, y: -12, zoom: 0.5 } };
    const s = ctx({ lit: host, present: { opacity: 0.75 } });
    const block = (lit: SlotLight | undefined) => {
      const u = MatUniforms.alloc(1);
      const strength = MAT_GRID.gobo.plates[s.cfg.gobo.plate === "b" ? "b" : "c"].strength;
      u.set(matUniformValues(s.view, s.fadeIn, s.cfg, s.frame ?? STILL_MAT_FRAME, strength, s.present, s.light, NO_GLYPHS, lit));
      return new Uint8Array(u.view().buffer, u.view().byteOffset, u.view().byteLength).slice();
    };
    writes.length = 0;
    kind.prepare({} as GPUCommandEncoder, s, [print(0, null)]);
    const written = must(writes.find((w) => w.buffer === "photo/mat uniforms")).bytes;
    expect(written).toEqual(block(host));
    expect(written).not.toEqual(block(undefined));   // the lamp is not the slot's own
    writes.length = 0;
    kind.prepare({} as GPUCommandEncoder, ctx({ present: { opacity: 0.75 } }), [print(0, null)]);
    expect(must(writes.find((w) => w.buffer === "photo/mat uniforms")).bytes).toEqual(block(undefined));
  });

  it("drawRange counts in the prints it was handed: [first, end) each with its picture (the blank texel where it has none); an empty range records nothing; draw() is the whole list", async () => {
    const { kind } = await root();
    const p1 = kind.pass.picture(new Uint8Array([1, 2, 3, 255]), 1, 1);
    const p3 = kind.pass.picture(new Uint8Array([4, 5, 6, 255]), 1, 1);
    expect(kind.prepare({} as GPUCommandEncoder, ctx(), [print(0, p1), print(500, null), print(1000, p3)])).toBe(3);
    const drawn = (first: number, end: number) => { const c: unknown[][] = []; kind.drawRange(objectPass(c), first, end); return c; };
    const whole = drawn(0, 3);
    expect(whole.map((c) => c[0])).toEqual(["pipeline", "group", "group", "draw", "group", "draw", "group", "draw"]);
    const blank = whole[4]?.[2];
    expect(whole[2]?.[2]).toBe(p1.group); expect(blank).not.toBe(p1.group); expect(blank).not.toBe(p3.group); expect(whole[6]?.[2]).toBe(p3.group);
    expect(whole.filter((c) => c[0] === "draw")).toEqual([["draw", 6, 1, 0, 0], ["draw", 6, 1, 0, 1], ["draw", 6, 1, 0, 2]]);
    const all: unknown[][] = [];
    kind.pass.draw(objectPass(all));
    expect(all).toEqual(whole);
    expect(drawn(1, 1)).toEqual([]);     // an empty range: not even the pipeline
    expect(drawn(3, 9)).toEqual([]);     // past the list
    const tail = drawn(1, 9);
    expect(tail.filter((c) => c[0] === "draw")).toEqual([["draw", 6, 1, 0, 1], ["draw", 6, 1, 0, 2]]);
    expect(tail[2]?.[2]).toBe(blank); expect(tail[4]?.[2]).toBe(p3.group);
    expect(drawn(0, 1).filter((c) => c[0] === "draw")).toEqual([["draw", 6, 1, 0, 0]]);
  });

  it("through the walker: a note laid between two prints cuts them into two runs, the second drawing the second print alone", async () => {
    const { kind } = await root();
    kind.prepare({} as GPUCommandEncoder, ctx(), [print(0, null), print(500, null)]);
    const log: string[] = [];
    const calls: unknown[][] = [];
    const rp = { ...objectPass(calls), draw: (...a: number[]) => { calls.push(["draw", ...a]); log.push(`photo draw ${a[3]}`); } } as unknown as GPURenderPassEncoder;
    const slot: DrawSlot = {
      mat: { draw: () => log.push("mat") } as unknown as CuttingMat,
      kinds: new Map([[PHOTO_KIND, { name: PHOTO_KIND, stratum: "things", pass: kind }], ["paper", loggingKind(log, "desk", "paper", "things")]]),
      objects: [{ kind: PHOTO_KIND }, { kind: "paper" }, { kind: PHOTO_KIND }],
      stats: { k0: 0, fade: 0, wind: false },
    };
    drawSlot(rp, SIZE, 2, slot);
    expect(log).toEqual(["mat", "photo draw 0", "desk paper 0..1", "photo draw 1"]);
  });

  it("the blank texel is the pass's and goes with the last slot standing; a host's pictures are the host's to drop", async () => {
    const { mat, kind, textures } = await root();
    const pictures = () => textures.filter((t) => (t.texture as { label: string }).label.startsWith("photo/picture"));
    const [blank] = pictures();   // made with the root's pass
    expect(pictures()).toHaveLength(1);
    const picture = kind.pass.picture(new Uint8Array([1, 2, 3, 255]), 1, 1);
    const spawned = kind.spawn(mat.spawn());
    expect(pictures()).toHaveLength(2);   // a spawned slot makes no blank of its own
    const kept = must(pictures().find((t) => t.texture === picture.texture));
    kind.pass.dropPicture(picture);
    expect(kept.destroyed).toBe(true);
    spawned.dispose();
    expect(must(blank).destroyed).toBe(false);   // the root still stands
    kind.dispose();
    expect(must(blank).destroyed).toBe(true);    // the last slot standing takes it
  });
});
