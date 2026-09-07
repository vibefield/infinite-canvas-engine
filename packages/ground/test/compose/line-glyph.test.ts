// @vitest-environment node
// The engine's LINE glyph (design-013 §8, D-C1.4; src/field/line-glyph.ts): that
// it is a built-in — registered beside the dot with no app registration — that a
// FieldConfig naming it resolves to its own SURFACE pass rather than to the dot,
// that its ink is a theme token for every theme with the old TSL grid's number
// behind it, and that its law is the one D-C1.4 ruled.
//
// The resolution rows run the REAL `Field.create`/`prepare`/`draw` against a
// GPUDevice stub (this environment has no GPU — vitest.config.ts), so what is
// asserted is the engine's own branch, not a copy of it. The pixels are the
// oracle's three `line-*` scenes; the recorded old-vs-new A/B is the desktop
// `line-ab` rig.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Field } from "../../src/field/field";
import { DEFAULT_FIELD_CONFIG, type FieldConfig, type FieldFrame, Uniforms } from "../../src/field/layout";
import { DEFAULT_LINE_CONFIG, LINE_GLYPH, LineUniforms, lineUniformValues, withLine } from "../../src/field/line-glyph";
import type { InstancedGlyph, SurfaceGlyph } from "../../src/field/program";
import { FIELD_SHADER_FILES, fieldShaders } from "../../src/field/shaders";
import { lineWeight } from "../../src/lattice/line";
import { rungAlpha } from "../../src/lattice/lod";
import { shaderText } from "../../src/shaders";
import { ENGINE_GRID, LINE_GRID, type ThemeName } from "../../src/theme";
import { THEMES } from "../../oracle/fixtures/vf-theme";
import { must } from "./must";

const THEME_NAMES: readonly ThemeName[] = ["light", "dark"];
const SHADERS = fieldShaders(shaderText(FIELD_SHADER_FILES));

/** What a recording pass saw: the pipeline labels set, and the draws (`vertices×instances`). */
interface Recorded {
  readonly pipelines: string[];
  readonly draws: string[];
}

/**
 * A GPUDevice stand-in that gets as far as `Field.create` needs: layouts,
 * shader modules that compile clean, pipelines that remember their label,
 * buffers and textures. Nothing renders — the branch taken is what is measured.
 */
function stubDevice(): { device: GPUDevice; writes: number } {
  const state = { writes: 0 };
  const device = {
    createBindGroupLayout: (d: GPUBindGroupLayoutDescriptor) => ({ label: d.label }) as unknown as GPUBindGroupLayout,
    createPipelineLayout: () => ({}) as unknown as GPUPipelineLayout,
    createShaderModule: (d: GPUShaderModuleDescriptor) => ({
      label: d.label,
      getCompilationInfo: async () => ({ messages: [] }),
    }) as unknown as GPUShaderModule,
    createRenderPipelineAsync: async (d: GPURenderPipelineDescriptor) => ({ label: d.label }) as unknown as GPURenderPipeline,
    createBuffer: () => ({ getMappedRange: () => new ArrayBuffer(0), destroy: () => {} }) as unknown as GPUBuffer,
    createBindGroup: (d: GPUBindGroupDescriptor) => ({ label: d.label }) as unknown as GPUBindGroup,
    createTexture: (d: GPUTextureDescriptor) => {
      const size = d.size as number[];
      return { width: size[0] ?? 1, height: size[1] ?? 1, createView: () => ({}) as GPUTextureView, destroy: () => {} } as unknown as GPUTexture;
    },
    queue: { writeBuffer: () => { state.writes += 1; } },
  } as unknown as GPUDevice;
  return { device, get writes() { return state.writes; } };
}

/** An encoder whose render passes record which pipeline drew what. */
function stubEncoder(into: Recorded): GPUCommandEncoder {
  return {
    beginRenderPass: () => ({
      setPipeline: (p: GPURenderPipeline) => { into.pipelines.push(String(p.label)); },
      setBindGroup: () => {},
      draw: (v: number, n = 1) => { into.draws.push(`${v}×${n}`); },
      end: () => {},
    }) as unknown as GPURenderPassEncoder,
  } as unknown as GPUCommandEncoder;
}

const stubPass = (into: Recorded): GPURenderPassEncoder => ({
  setPipeline: (p: GPURenderPipeline) => { into.pipelines.push(String(p.label)); },
  setBindGroup: () => {},
  draw: (v: number, n = 1) => { into.draws.push(`${v}×${n}`); },
}) as unknown as GPURenderPassEncoder;

const FRAME: FieldFrame = {
  view: { camX: 13.7, camY: -21.3, zoom: 1, width: 1200, height: 800, dpr: 2 },
  pointer: { x: 640, y: 400, on: false },
};

/** One prepare + draw of a field whose glyph is `glyph`; the stats and what the pass saw. */
async function drawWith(glyph: string): Promise<{ stats: ReturnType<Field["draw"]>; seen: Recorded; field: Field }> {
  const { device } = stubDevice();
  const field = await Field.create(device, "rgba8unorm", SHADERS);
  const seen: Recorded = { pipelines: [], draws: [] };
  field.config = { ...DEFAULT_FIELD_CONFIG, glyph };
  field.prepare(stubEncoder(seen), FRAME, [], THEMES.dark);
  const stats = field.draw(stubPass(seen));
  return { stats, seen, field };
}

beforeAll(() => {
  // the WebGPU enum globals a browser and Dawn both provide for free
  vi.stubGlobal("GPUShaderStage", { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 });
  vi.stubGlobal("GPUBufferUsage", { UNIFORM: 64, STORAGE: 128, COPY_DST: 8, COPY_SRC: 4, MAP_READ: 1 });
  vi.stubGlobal("GPUTextureUsage", { RENDER_ATTACHMENT: 16, TEXTURE_BINDING: 4, COPY_SRC: 1, COPY_DST: 2 });
});

describe("the `line` glyph is one of the engine's own", () => {
  it("ships in the engine's shader set beside the dot — an app registers nothing", () => {
    expect(SHADERS.glyphs.map((g) => g.glyph)).toEqual(["dot", LINE_GLYPH]);
    const dot = must(SHADERS.glyphs.find((g) => g.glyph === "dot"), "the dot glyph") as InstancedGlyph;
    const line = must(SHADERS.glyphs.find((g) => g.glyph === LINE_GLYPH), "the line glyph") as SurfaceGlyph;
    expect(dot.kind).toBe("instanced");
    // a SURFACE program: it owns its pass, so the bake never runs while it draws
    expect(line.kind).toBe("surface");
    // and it reads no theme SECTION — its ink is the theme's head (`lineInk`), not a pack's section
    expect(line.theme).toBeUndefined();
  });

  it("is registered from the shader file the generator names, so both hosts compose the same text", () => {
    expect(FIELD_SHADER_FILES.lineGrid).toBe("field/line-grid.wgsl");
    expect(shaderText(FIELD_SHADER_FILES).lineGrid).toContain("fn line_weight(");
  });
});

describe("a FieldConfig naming it resolves to the line pass, not to the dot", () => {
  it("puts the line in the field's SURFACE slots and the dot in the glyph pass", async () => {
    const { field } = await drawWith("dot");
    expect([...field.surfaces.keys()]).toEqual([LINE_GLYPH]);
    expect(field.glyphs.has("dot")).toBe(true);
    expect(field.glyphs.has(LINE_GLYPH)).toBe(false);
  });

  it("draws the line's own pipeline — one fullscreen triangle — and bakes nothing", async () => {
    const { stats, seen } = await drawWith(LINE_GLYPH);
    expect(stats.surface).toBe(LINE_GLYPH);
    expect(stats.aux).toBe(false);          // the line grid has no auxiliary pass (the mat's wind is the mat's)
    expect(stats.baked).toBe(false);        // a surface program reads no atlas: PASS 1 never runs
    expect(stats.instances).toBe(0);
    expect(seen.pipelines).toEqual(["field/line"]);
    expect(seen.draws).toEqual(["3×1"]);
  });

  it("leaves the dot exactly as it was — the instanced rungs, and the bake", async () => {
    const { stats, seen } = await drawWith("dot");
    expect(stats.surface).toBeNull();
    expect(stats.baked).toBe(true);
    expect(seen.pipelines).toContain("field/dot/rung1");
    expect(seen.pipelines).not.toContain("field/line");
    expect(stats.instances).toBeGreaterThan(0);
  });

  it("still draws an UNREGISTERED name as the dot — the ground never refuses a frame", async () => {
    const { stats, seen } = await drawWith("no-such-glyph");
    expect(stats.surface).toBeNull();
    expect(seen.pipelines.some((p) => p.startsWith("field/dot/"))).toBe(true);
  });
});

describe("its ink is a theme token, for every theme", () => {
  it("every theme the engine ships has one, and `themeFrom` puts it on the head", () => {
    for (const name of THEME_NAMES) {
      const token = must(LINE_GRID.ink[name], `the ${name} line ink`);
      expect(token.token).toContain("dotColor");                    // the number's provenance, in the token's name
      expect(token.rgb).toHaveLength(3);
      expect(THEMES[name].lineInk).toEqual(token.rgb);              // the fixture builds its themes with themeFrom
    }
  });

  it("is projected from the OLD TSL line grid's colour — `GridConfig.dotColor`, one colour under both themes", () => {
    // programs/line-grid-renderer.ts sets `uColor` from `config.dotColor`, and that config carries no theme
    expect(LINE_GRID.ink.light.rgb).toEqual(ENGINE_GRID.ink.rgb);
    expect(LINE_GRID.ink.dark.rgb).toEqual(ENGINE_GRID.ink.rgb);
  });

  it("rides the frame beside the config's law, and the alpha stays the engine's own", () => {
    const cfg: FieldConfig = { ...DEFAULT_FIELD_CONFIG, glyph: LINE_GLYPH };
    const v = lineUniformValues(cfg, THEMES.light);
    expect(v.ink.slice(0, 3)).toEqual([...THEMES.light.lineInk]);
    expect(v.law).toEqual([LINE_GRID.law.thin, LINE_GRID.law.thick, LINE_GRID.law.alphaThin, LINE_GRID.law.alphaThick]);
    // the shader reads the ALPHA from the engine's own `Uniforms.color.w` (the dot's term), never from here
    expect(v.ink[3]).toBe(0);
    expect(Uniforms.slots.color).toBeDefined();
    expect(Object.keys(LineUniforms.slots)).toEqual(["ink", "law"]);
  });

  it("takes a host's own law through `ext.line`, the seam every grid program's config rides", () => {
    const own = { law: { thin: 0.5, thick: 1.5, alphaThin: 0.1, alphaThick: 0.3 } };
    const cfg = withLine({ ...DEFAULT_FIELD_CONFIG, glyph: LINE_GLYPH }, own);
    expect(lineUniformValues(cfg, THEMES.dark).law).toEqual([0.5, 1.5, 0.1, 0.3]);
    // and the engine's own is the flat one
    expect(lineUniformValues({ ...DEFAULT_FIELD_CONFIG }, THEMES.dark).law).toEqual([0.5, 0.5, 0.42, 0.42]);
    expect(DEFAULT_LINE_CONFIG.law).toEqual(LINE_GRID.law);
  });
});

describe("the law D-C1.4 ruled: one device px at every zoom, at the old grid's weight", () => {
  const law = LINE_GRID.law;
  const fadeIn = DEFAULT_FIELD_CONFIG.fadeIn;

  it("is one device px WIDE at every cell size — the decade thickening is deliberately not taken", () => {
    for (const cellPx of [1, 10, 20, 63, 200, 2000, 1e5]) {
      expect(lineWeight(cellPx, fadeIn, law).halfWidth, `cell ${cellPx}`).toBeCloseTo(0.5, 12);
    }
  });

  it("weights every rung the same, and that weight is the old grid's 0.42", () => {
    expect(law.alphaThin).toBe(0.42);
    expect(law.alphaThick).toBe(0.42);
    for (const cellPx of [20, 200, 2000]) {
      expect(lineWeight(cellPx, fadeIn, law).alpha, `cell ${cellPx}`).toBeCloseTo(0.42, 12);
    }
  });

  it("fades a rung in by its OWN cell over the engine's window — the same smoothstep every glyph fades by", () => {
    for (const cellPx of [0, 5, 10, 12.6, 15, 20, 40]) {
      expect(lineWeight(cellPx, fadeIn, law).alpha, `cell ${cellPx}`).toBeCloseTo(0.42 * rungAlpha(cellPx, fadeIn), 12);
    }
    // the oracle's three scenes, as numbers: the fine rung is off at zoom 0.5 (a 10 px cell,
    // the window's floor), off at zoom 1 (2 px), and a third of the way in at 6.31 (12.6 px)
    expect(lineWeight(10, fadeIn, law).alpha).toBe(0);
    expect(lineWeight(2, fadeIn, law).alpha).toBe(0);
    expect(lineWeight(12.6, fadeIn, law).alpha).toBeGreaterThan(0.05);
    expect(lineWeight(12.6, fadeIn, law).alpha).toBeLessThan(0.42);
  });
});
