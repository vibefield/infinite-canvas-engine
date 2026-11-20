// SOFT LIGHT and the night's two numbers on a real device (petition I56): what the unit file (soft-light.test.ts) cannot
// see — the pixels. Under the cone's text a config that asks for soft light draws the cone, byte for byte; under the soft
// light's text the cone draws no chain, lit stays the albedo, the shade is never black, a viewport lamp keeps its place,
// mirror flips the plant, a kind's light is the mat's, and the night's GPU colour is its CPU mirror's.
// Run with pnpm --filter @ice/desk dawn test/soft-light.dawn.test.ts.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { create, globals } from "webgpu";
import { acquire } from "../src/engine/device";
import { beginPass, readback, Target } from "../src/engine/target";
import { resetLightText } from "../src/light-text";
import { DEFAULT_MAT_CONFIG, type MatConfig, type SlotLight, STILL_MAT_FRAME } from "../src/mat/layout";
import { CuttingMat } from "../src/mat/mat-pass";
import { linear, type MatLight, matNightAlbedo, nightAppearance, type NightSpec } from "../src/mat/night";
import { MAT_SHADER_FILES, matShaders } from "../src/mat/shaders";
import { SOFT_LIGHT } from "../src/mat/soft";
import { lightText, setLightText, shaderText } from "../src/shaders";
import { EIGENGRAU, MAT_COLORS, MAT_LIGHT, nightLight } from "../src/theme";

const BASE = { camX: 0, camY: 0, zoom: 1, width: 256, height: 192, dpr: 1 };
const MOVED = [
  { camX: 1537, camY: -941, zoom: 1 },
  { camX: -321, camY: 456, zoom: 0.25 },
  { camX: 79, camY: -56, zoom: 4 },
];
/** The mat with nothing on it but its ground and the light: no lattice, no grain, a viewport lamp, a still silhouette. */
const flat: MatConfig = {
  ...DEFAULT_MAT_CONFIG,
  grain: 0,
  line: { ...DEFAULT_MAT_CONFIG.line, alphaThin: 0, alphaThick: 0 },
  gobo: { ...DEFAULT_MAT_CONFIG.gobo, space: "viewport", strength: 0 },
};
const soft = (cfg: MatConfig, more: Partial<MatConfig["gobo"]> = {}): MatConfig => ({ ...cfg, gobo: { ...cfg.gobo, model: "soft", ...more } });
const handover: SlotLight = { a: { x: -700, y: 300, zoom: 0.5 }, b: { x: 400, y: -900, zoom: 3 }, t: 0.4 };
/** The gentler night as a host states it (the unit file's numbers). */
const GENTLE: NightSpec = {
  kelvin: 4100, lux: 0.74, fill: 0.5, rodHue: { nm: 485, purity: 0.2 }, eigengrau: EIGENGRAU, litLuminance: 0, snow: 0, surround: 0.8,
  contrast: 0.855, fromDay: 1, exposure: 0.42, adaptation: 0.85,
};

// A plate that is open but for one disc in its middle: a plant with one leaf. Its wind channels are set, so the silhouette
// moves when a config gives the wind a strength (`flat` gives it none).
const plate = new Uint8Array(512 * 512 * 4);
for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) plate.set([Math.hypot(x - 256, y - 256) < 120 ? 0 : 255, 96, 128, 64], (y * 512 + x) * 4);

// The kinds' entry points over the mat's block (viewport-gobo.dawn.test.ts's probe): a kind's own light, a nested slot's
// inherited light, and the mat's own projection, side by side.
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
  let inherited = lit_gobo(u, tex, samp, world, 12.0, own, 0.5);
  let viewport = project_gobo(u, tex, samp, desk_of(u, screen), 0.5);
  return vec4f(direct, inherited, viewport, 1);
}`;

let device: GPUDevice;

async function render(pass: CuttingMat, config: MatConfig, opts: { view?: typeof BASE; light?: MatLight; lit?: SlotLight; time?: number } = {}): Promise<Uint8Array> {
  const view = opts.view ?? BASE;
  const target = new Target(device, { format: "rgba8unorm", readable: true }, view.width * view.dpr, view.height * view.dpr);
  try {
    const encoder = device.createCommandEncoder();
    pass.newFrame();
    pass.prepare(encoder, view, [10, 20], config, { ...STILL_MAT_FRAME, goboTime: opts.time ?? 0 }, undefined, opts.light, opts.lit);
    const draw = beginPass(encoder, target.view, [0, 0, 0, 0]);
    pass.draw(draw);
    draw.end();
    device.queue.submit([encoder.finish()]);
    return await readback(device, target.texture, 4);
  } finally {
    target.dispose();
  }
}

/** The greatest difference of any channel, and the mean over every channel. */
function difference(a: Uint8Array, b: Uint8Array): { most: number; mean: number } {
  expect(a.length).toBe(b.length);
  let most = 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) { const d = Math.abs((a[i] as number) - (b[i] as number)); sum += d; if (d > most) most = d; }
  return { most, mean: sum / a.length };
}
const rgbAt = (pixels: Uint8Array, x: number, y: number, width = BASE.width) => [0, 1, 2].map((c) => pixels[(y * width + x) * 4 + c] as number);

beforeAll(async () => {
  Object.assign(globalThis, globals);
  device = (await acquire({ gpu: create([]), label: "soft light" })).device;
});
afterAll(() => { device?.destroy(); resetLightText(); });

describe("the cone's text on Dawn: a page that asked for nothing", () => {
  let mat: CuttingMat;
  beforeAll(async () => {
    resetLightText();
    mat = await CuttingMat.create(device, "rgba8unorm", matShaders(shaderText(MAT_SHADER_FILES)));
    mat.setPlate("c", plate);
  });
  afterAll(() => { mat?.dispose(); vi.restoreAllMocks(); });

  it("soft light asked of it draws the cone, byte for byte, from one level of the silhouette, and says so once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(lightText()).toBe("cone");
    const cone = await render(mat, flat);
    const asked = await render(mat, soft(flat));
    expect(difference(cone, asked).most).toBe(0);
    await render(mat, soft(flat), { time: 1 });
    expect(mat.chainPasses).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("soft light on Dawn", () => {
  let mat: CuttingMat;
  let objects: CuttingMat;
  beforeAll(async () => {
    resetLightText();          // the tests' door: this file made a mat from the cone's text above
    setLightText("soft");
    const shaders = matShaders(shaderText(MAT_SHADER_FILES));
    mat = await CuttingMat.create(device, "rgba8unorm", shaders);
    objects = await CuttingMat.create(device, "rgba8unorm", { ...shaders, entry: { label: "object gobo probe", text: objectProbe } });
    mat.setPlate("c", plate);
    objects.setPlate("c", plate);
  });
  afterAll(() => { objects?.dispose(); mat?.dispose(); });

  it("the cone draws no chain; soft light draws it once for a silhouette, and again only when the wind moved it", async () => {
    const windy = { ...flat, gobo: { ...flat.gobo, strength: 1 } };
    await render(mat, windy);
    expect(mat.chainPasses).toBe(0);
    await render(mat, soft(windy));
    await render(mat, soft(windy));
    expect(mat.chainPasses).toBe(1);
    await render(mat, soft(windy), { time: 1 });
    expect(mat.chainPasses).toBe(2);
    await render(mat, windy, { time: 2 });
    expect(mat.chainPasses).toBe(2);
  });

  it("lit stays the albedo, and the shade is never black: no pixel is brighter than the open mat, none falls under 0.6 of it", async () => {
    const open = await render(mat, soft(flat, { opacity: 0 }));
    /** A frame against the open mat: pixels byte-equal to it, pixels visibly shaded, channels brighter than it, channels under 0.6 of it. */
    const against = (frame: Uint8Array) => {
      let same = 0;
      let shaded = 0;
      let brighter = 0;
      let tooDark = 0;
      for (let i = 0; i < frame.length; i += 4) {
        let equal = true;
        for (let c = 0; c < 3; c++) {
          const was = open[i + c] as number;
          const now = frame[i + c] as number;
          if (now > was) brighter++;
          if (now < Math.floor(was * 0.6)) tooDark++;
          if (now !== was) equal = false;
        }
        if (equal) same++;
        if ((open[i + 1] as number) - (frame[i + 1] as number) > 20) shaded++;
      }
      return { same, shaded, brighter, tooDark };
    };
    const lit = await render(mat, soft(flat));
    const seen = against(lit);
    const pixels = lit.length / 4;
    expect(seen.brighter).toBe(0);
    expect(seen.tooDark).toBe(0);
    expect(seen.same / pixels).toBeGreaterThan(0.3);     // the open plate: lit, the very bytes of the mat with no gobo
    expect(seen.shaded / pixels).toBeGreaterThan(0.02);  // the leaf: a shadow one can see
    // the two counts CAN fail: a shade above 1 brightens the leaf, and one near 0 takes it under 0.6 of the mat
    expect(against(await render(mat, soft(flat, { softLight: { ...SOFT_LIGHT, shade: [1.6, 1.6, 1.6] } }))).brighter).toBeGreaterThan(0);
    expect(against(await render(mat, soft(flat, { softLight: { ...SOFT_LIGHT, shade: [0.02, 0.02, 0.02] } }))).tooDark).toBeGreaterThan(0);
    // and the shade is cooler than the ground it falls on: blue keeps more than red
    let i = 0;
    while ((open[i + 1] as number) - (lit[i + 1] as number) <= 20) i += 4;
    expect((lit[i + 2] as number) / (open[i + 2] as number)).toBeGreaterThan((lit[i] as number) / (open[i] as number));
  });

  it.each([0.5, 1, 2])("a viewport lamp keeps its size and place through pan, zoom and a portal's handover at DPR %s", async (dpr) => {
    const base = await render(mat, soft(flat), { view: { ...BASE, dpr } });
    for (const camera of [...MOVED, { camX: 1e12, camY: -1e12, zoom: 1e-8 }, { camX: -1e6, camY: 1e6, zoom: 1e8 }]) {
      expect(difference(base, await render(mat, soft(flat), { view: { ...BASE, ...camera, dpr }, lit: handover })).most).toBe(0);
    }
  });

  it("mirror flips the plant left to right", async () => {
    const still = { ...SOFT_LIGHT, sway: 0 };
    const plain = await render(mat, soft(flat, { softLight: still }));
    const mirrored = await render(mat, soft(flat, { softLight: { ...still, mirror: true } }));
    const flipped = new Uint8Array(plain.length);
    for (let y = 0; y < BASE.height; y++) for (let x = 0; x < BASE.width; x++) flipped.set(plain.subarray((y * BASE.width + x) * 4, (y * BASE.width + x) * 4 + 4), (y * BASE.width + (BASE.width - 1 - x)) * 4);
    // the taps' spiral is turned by the blue noise, which is not mirrored: the same shade, another grain
    expect(difference(mirrored, flipped).mean).toBeLessThan(1);
    expect(difference(mirrored, plain).mean).toBeGreaterThan(2);
  });

  it("a kind's own light and a nested slot's inherited light are the mat's, at every camera", async () => {
    for (const camera of [{ camX: 0, camY: 0, zoom: 1 }, ...MOVED]) {
      const pixels = await render(objects, soft(flat), { view: { ...BASE, ...camera }, lit: handover });
      let apart = 0;
      let shaded = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const own = pixels[i + 2] as number;
        apart = Math.max(apart, Math.abs((pixels[i] as number) - own), Math.abs((pixels[i + 1] as number) - own));
        if (own < 250) shaded++;
      }
      expect(apart).toBeLessThanOrEqual(1);
      expect(shaded).toBeGreaterThan(100);
    }
  });

  it("the night's colour on the GPU is its CPU mirror's: today's, and the gentler one with its contrast and its step from the day", async () => {
    const ground = linear(MAT_COLORS.ground);
    const open = soft(flat, { opacity: 0 });
    const today = MAT_LIGHT.dark;
    const gentle = nightLight(GENTLE, MAT_COLORS.ground);
    const cases: [string, MatLight, readonly [number, number, number]][] = [
      ["today's", { ...today, snow: 0 }, nightAppearance(today, ground, 1)],
      ["the gentler", gentle, nightAppearance(gentle, matNightAlbedo(gentle, ground), 1)],
    ];
    for (const [name, light, want] of cases) {
      const got = rgbAt(await render(mat, open, { light }), 128, 96);
      for (let c = 0; c < 3; c++) expect(Math.abs((got[c] as number) - Math.round((want[c] as number) * 255)), `${name} night, channel ${c}: ${got} against ${want.map((v) => Math.round(v * 255))}`).toBeLessThanOrEqual(1);
    }
    // and they are two nights: the gentler ground is lighter
    expect(nightAppearance(gentle, matNightAlbedo(gentle, ground), 1)[1]).toBeGreaterThan(nightAppearance(today, ground, 1)[1]);
  });
});
