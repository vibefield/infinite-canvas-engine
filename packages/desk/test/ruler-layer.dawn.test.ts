// Real pixels through the ground's draw order: an object covering the whole
// viewport must pass under the rulers, while the untouched mat stays identical.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { create, globals } from "webgpu";
import { acquire } from "../src/engine/device";
import { beginPass, readback, Target } from "../src/engine/target";
import { drawSlot, type DrawSlot, type KindPass } from "../src/ground";
import { DEFAULT_MAT_CONFIG, STILL_MAT_FRAME } from "../src/mat/layout";
import { CuttingMat } from "../src/mat/mat-pass";
import { MAT_SHADER_FILES, matShaders } from "../src/mat/shaders";
import { type Presentation, scissorOf } from "../src/nav/portal";
import { shaderText } from "../src/shaders";

let device: GPUDevice;
let mat: CuttingMat;
let object: CuttingMat;
const BASE = { camX: 0, camY: 0, zoom: 1, width: 160, height: 120, dpr: 1 };
const cfg = { ...DEFAULT_MAT_CONFIG, gobo: { ...DEFAULT_MAT_CONFIG.gobo, opacity: 0 } };
const probe = `
@group(0) @binding(0) var<uniform> u: MatUniforms;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  return vec4f(p[i], 0, 1);
}
@fragment fn fs(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  return vec4f(0, 0, 1, u.view.w * portal_cover(frag.xy / mat_dpr(u), u.portals, u.clips, mat_dpr(u)));
}`;

beforeAll(async () => {
  Object.assign(globalThis, globals);
  device = (await acquire({ gpu: create([]), label: "foreground ruler regression" })).device;
  const shaders = matShaders(shaderText(MAT_SHADER_FILES));
  mat = await CuttingMat.create(device, "rgba8unorm", shaders);
  object = await CuttingMat.create(device, "rgba8unorm", { ...shaders, entry: { label: "covering object", text: probe } });
  // Give the label path visible coverage too; its appearance is compared against
  // the very same shader drawing the original unpartitioned mat.
  mat.setGlyphs(new Uint8Array(12 * 8 * 12).fill(255), { width: 96, height: 12, cellW: 8, cellH: 12, advance: 6, baseline: 10, cap: 8, scale: 1, count: 12 });
});
afterAll(() => { object?.dispose(); mat?.dispose(); device?.destroy(); });

type Mode = "original" | "empty" | "object" | "composite" | "child" | "bare";
async function render(mode: Mode, view = BASE, margin = 0, present?: Presentation, on = true): Promise<Uint8Array> {
  const size = { w: Math.round(view.width * view.dpr), h: Math.round(view.height * view.dpr) };
  const target = new Target(device, { format: "rgba8unorm", readable: true }, size.w, size.h);
  device.pushErrorScope("validation");
  try {
    const encoder = device.createCommandEncoder();
    const config = { ...cfg, ruler: { ...cfg.ruler, on, margin } };
    mat.newFrame();
    mat.prepare(encoder, view, [10, 20], config, STILL_MAT_FRAME, present);
    object.prepare(encoder, view, [10, 20], config, STILL_MAT_FRAME, present);
    const pass = beginPass(encoder, target.view, [0, 0, 0, 0]);
    const kind = { drawRange: (p: GPURenderPassEncoder) => object.draw(p) } as unknown as KindPass;
    const slot: DrawSlot = {
      mat, present, stats: { k0: 0, fade: 0, wind: false },
      kinds: new Map([["probe", { name: "probe", stratum: "things", pass: kind, composite: mode === "composite" }]]),
      objects: mode === "empty" || mode === "child" ? [] : [{ kind: "probe" }],
      bare: mode === "bare",
    };
    if (mode === "original") {
      pass.setScissorRect(...scissorOf(present, view.dpr, size));
      mat.draw(pass);
    } else {
      drawSlot(pass, size, view.dpr, mode === "child" ? { ...slot, children: [{ at: 0, slot: { ...slot, bare: true, objects: [{ kind: "probe" }] } }] } : slot);
    }
    pass.end();
    device.queue.submit([encoder.finish()]);
    return await readback(device, target.texture, 4);
  } finally {
    target.dispose();
    expect(await device.popErrorScope()).toBeNull();
  }
}

function pixel(bytes: Uint8Array, view: typeof BASE, x: number, y: number): Uint8Array {
  const i = (Math.floor(y * view.dpr) * Math.round(view.width * view.dpr) + Math.floor(x * view.dpr)) * 4;
  return bytes.slice(i, i + 4);
}

function difference(a: Uint8Array, b: Uint8Array): number {
  expect(a.length).toBe(b.length);
  let max = 0;
  for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs((a[i] as number) - (b[i] as number)));
  return max;
}

describe("foreground edge rulers on Dawn", () => {
  it.each([0.5, 1, 1.25, 2])("stays above objects through pan and zoom at DPR %s", async (dpr) => {
    for (const margin of [0, 13]) for (const camera of [{ camX: 0, camY: 0, zoom: 1 }, { camX: 1537, camY: -941, zoom: 0.35 }, { camX: -321, camY: 456, zoom: 4 }]) {
      const view = { ...BASE, ...camera, dpr };
      const plain = await render("original", view, margin);
      const covered = await render("object", view, margin);
      for (const [x, y] of [[80, margin + 13], [margin + 13, 80], [view.width - margin - 0.5 / dpr, 80], [80, view.height - margin - 0.5 / dpr]]) {
        expect(pixel(covered, view, x as number, y as number)).toEqual(pixel(plain, view, x as number, y as number));
      }
      expect(pixel(covered, view, 80, 70)).toEqual(new Uint8Array([0, 0, 255, 255]));
      if (margin > 0) expect(pixel(covered, view, 2, 2)).toEqual(new Uint8Array([0, 0, 255, 255]));
    }
  });

  it("preserves every empty-mat pixel through fades, portal clipping and fractional sizes", async () => {
    for (const dpr of [0.5, 1.25, 2]) for (const margin of [0, 26]) for (const opacity of [0.35, 1]) {
      const view = { ...BASE, width: 159.7, height: 119.3, dpr };
      const present = { opacity, portal: { cx: 60, cy: 50, hx: 55, hy: 45, r: 12 }, within: [{ cx: 80, cy: 40, hx: 75, hy: 35, r: 6 }] };
      expect(difference(await render("original", view, margin, present), await render("empty", view, margin, present))).toBe(0);
    }
    const tiny = { ...BASE, width: 7, height: 11, dpr: 1.25 };
    expect(difference(await render("original", tiny), await render("empty", tiny))).toBe(0);
  });

  it("covers composite objects and nested slots, but skips bare slots and disabled rulers", async () => {
    const plain = await render("original");
    for (const mode of ["composite", "child"] as const) {
      const covered = await render(mode);
      expect(pixel(covered, BASE, 80, 13)).toEqual(pixel(plain, BASE, 80, 13));
      expect(pixel(covered, BASE, 13, 80)).toEqual(pixel(plain, BASE, 13, 80));
      expect(pixel(covered, BASE, 80, 70)).toEqual(new Uint8Array([0, 0, 255, 255]));
    }
    for (const [mode, on] of [["object", false], ["bare", true]] as const) {
      const covered = await render(mode, BASE, 0, undefined, on);
      expect(pixel(covered, BASE, 80, 13)).toEqual(new Uint8Array([0, 0, 255, 255]));
      expect(pixel(covered, BASE, 13, 80)).toEqual(new Uint8Array([0, 0, 255, 255]));
    }
  });
});
