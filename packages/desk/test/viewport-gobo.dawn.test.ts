// A real GPU regression: camera motion must leave the viewport gobo's pixels fixed.
// Run with pnpm --filter @ice/desk dawn test/viewport-gobo.dawn.test.ts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { create, globals } from "webgpu";
import { acquire } from "../src/engine/device";
import { beginPass, readback, Target } from "../src/engine/target";
import { DEFAULT_MAT_CONFIG, type MatConfig, type SlotLight, STILL_MAT_FRAME } from "../src/mat/layout";
import { CuttingMat } from "../src/mat/mat-pass";
import { MAT_SHADER_FILES, matShaders } from "../src/mat/shaders";
import { shaderText } from "../src/shaders";

let device: GPUDevice;
let mat: CuttingMat;
let objects: CuttingMat;

const BASE = { camX: 0, camY: 0, zoom: 1, width: 256, height: 192, dpr: 1 };
const MOVED = [
  { camX: 1537, camY: -941, zoom: 1 },
  { camX: -321, camY: 456, zoom: 0.25 },
  { camX: 79, camY: -56, zoom: 4 },
];
const cfg: MatConfig = {
  ...DEFAULT_MAT_CONFIG,
  grain: 0,
  line: { ...DEFAULT_MAT_CONFIG.line, alphaThin: 0, alphaThick: 0 },
  gobo: { ...DEFAULT_MAT_CONFIG.gobo, space: "viewport", blurTexels: 0 },
};
const handover: SlotLight = {
  a: { x: -700, y: 300, zoom: 0.5 },
  b: { x: 400, y: -900, zoom: 3 },
  t: 0.4,
};

// Exercise the shared lighting entry points used by object kinds, including a portal's inherited
// light. A flat receiver at the same screen pixel must pass through the same viewport light.
const objectProbe = `
@group(0) @binding(0) var<uniform> u: MatUniforms;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  return vec4f(p[i], 0, 1);
}
@fragment fn fs(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  let screen = frag.xy / mat_dpr(u);
  let world = u.cam.xy + screen / mat_zoom(u);
  let own = desk_of(u, world);
  let direct = sample_gobo(u, tex, samp, own, 0.5);
  let inherited = lit_gobo(u, tex, samp, world, 0.0, own, 0.5);
  let viewport = project_gobo(u, tex, samp, desk_of(u, screen), 0.5);
  return vec4f(direct, inherited, viewport, 1);
}`;

beforeAll(async () => {
  Object.assign(globalThis, globals);
  device = (await acquire({ gpu: create([]), label: "viewport gobo regression" })).device;
  const shaders = matShaders(shaderText(MAT_SHADER_FILES));
  mat = await CuttingMat.create(device, "rgba8unorm", shaders);
  objects = await CuttingMat.create(device, "rgba8unorm", { ...shaders, entry: { label: "object gobo probe", text: objectProbe } });
  // A visible, animated plate with several shadow edges in the test viewport.
  const plate = new Uint8Array(512 * 512 * 4);
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
    plate.set([((x >> 4) + (y >> 4)) % 2 ? 210 : 35, 96, 128, 64], (y * 512 + x) * 4);
  }
  mat.setPlate("c", plate);
  objects.setPlate("c", plate);
});

afterAll(() => { objects?.dispose(); mat?.dispose(); device?.destroy(); });

async function render(view = BASE, config = cfg, lit?: SlotLight, pass = mat, time = 0): Promise<Uint8Array> {
  const target = new Target(device, { format: "rgba8unorm", readable: true }, view.width * view.dpr, view.height * view.dpr);
  try {
    const encoder = device.createCommandEncoder();
    pass.newFrame();
    pass.prepare(encoder, view, [10, 20], config, { ...STILL_MAT_FRAME, goboTime: time }, undefined, undefined, lit);
    const draw = beginPass(encoder, target.view, [0, 0, 0, 0]);
    pass.draw(draw);
    draw.end();
    device.queue.submit([encoder.finish()]);
    return await readback(device, target.texture, 4);
  } finally {
    target.dispose();
  }
}

function difference(a: Uint8Array, b: Uint8Array): number {
  expect(a.length).toBe(b.length);
  let delta = 0;
  for (let i = 0; i < a.length; i++) delta = Math.max(delta, Math.abs((a[i] as number) - (b[i] as number)));
  return delta;
}

describe("viewport gobo on Dawn", () => {
  it.each([0.5, 1, 2])("keeps its size and position through pan, zoom and portal light handover at DPR %s", async (dpr) => {
    const base = await render({ ...BASE, dpr });
    const motions = [...MOVED, { camX: 1e12, camY: -1e12, zoom: 1e-8 }, { camX: -1e6, camY: 1e6, zoom: 1e8 }];
    for (const camera of motions) {
      expect(difference(base, await render({ ...BASE, ...camera, dpr }, cfg, handover))).toBe(0);
    }
  });

  it("preserves the original appearance at 100%, while world mode still follows the mat and wind still animates", async () => {
    const base = await render();
    const world: MatConfig = { ...cfg, gobo: { ...cfg.gobo, space: "world" } };
    expect(difference(base, await render(BASE, world))).toBe(0);
    expect(difference(base, await render({ ...BASE, ...MOVED[0] }, world))).toBeGreaterThan(5);
    expect(difference(base, await render(BASE, cfg, undefined, mat, 1))).toBeGreaterThan(2);
    // The grid still follows the camera: only the gobo was detached.
    const grid: MatConfig = { ...cfg, line: DEFAULT_MAT_CONFIG.line };
    expect(difference(await render(BASE, grid), await render({ ...BASE, ...MOVED[2] }, grid))).toBeGreaterThan(2);
  });

  it("shades objects and nested slots with the same fixed projection as the mat", async () => {
    for (const camera of [{ camX: 0, camY: 0, zoom: 1 }, ...MOVED]) {
      const pixels = await render({ ...BASE, ...camera }, cfg, handover, objects);
      let mismatch = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const matShade = pixels[i + 2] as number;
        mismatch = Math.max(mismatch, Math.abs((pixels[i] as number) - matShade), Math.abs((pixels[i + 1] as number) - matShade));
      }
      expect(mismatch).toBeLessThanOrEqual(1);
    }
  });
});
