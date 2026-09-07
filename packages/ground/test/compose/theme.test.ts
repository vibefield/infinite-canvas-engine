// @vitest-environment node
// The ENGINE's theme gate (src/theme.ts): the CSS colour parser, the one law —
// a colour literal lives in src/theme.ts or the host's projection (oracle/fixtures/vf-theme.ts)
// and nowhere else in src/, shaders/ or lab/ — the frame shader naming no
// colour, and the field's defaults being ICE's own numbers (read back from the
// ICE repo when it is beside us; skipped honestly when not). The product's
// cross-checks against tokens.css, DESIGN.md and canvas-appearance.ts are
// test/vf-theme.test.ts.
import { must } from "./must.ts";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ENGINE_GRID, cssColor } from "../../src/theme";

const ground = resolve(import.meta.dirname, "../..");
const iceConfig = resolve(ground, "../core/src/settings/ground-config.ts");

function* files(dir: string, ext: RegExp): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "node_modules" && name !== "dist" && name !== "assets") yield* files(p, ext); }
    else if (ext.test(name)) yield p;
  }
}

describe("theme (the engine's half)", () => {
  it("parses the CSS colour syntaxes tokens.css uses", () => {
    expect(cssColor("#4a90d9")).toEqual([0x4a / 255, 0x90 / 255, 0xd9 / 255, 1]);
    expect(cssColor("rgb(28 28 30 / 70%)")).toEqual([28 / 255, 28 / 255, 30 / 255, 0.7]);
    expect(cssColor("rgba(255, 255, 255, 0.08)")).toEqual([1, 1, 1, 0.08]);
    expect(() => cssColor("neutral-800")).toThrow();
  });

  it("a colour literal has two homes — src/theme.ts (the engine's) and oracle/fixtures/vf-theme.ts (the product's, a fixture) — and none in the rest of src/, shaders/, the oracle and the groundlab app", () => {
    const offenders: string[] = [];
    const scan = (p: string) => {
      const text = readFileSync(p, "utf8");
      const lines = text.split("\n");
      lines.forEach((l: string, i: number) => {
        const code = l.replace(/\/\/.*$/, "");
        // a CSS colour is `rgb(` followed by a number; `rgb(x.css)` is the parser, the one call a host may make
        if (/#[0-9a-f]{6}\b/i.test(code) || /\b0x[0-9a-f]{2}\b/i.test(code) || /\brgba?\(\s*\d/.test(code)) offenders.push(`${p}:${i + 1}`);
      });
    };
    // the ported tree only — the old composited leg beside it is B8's to delete, not this gate's to police
    for (const d of ["engine", "lattice", "field", "card", "nav", "mat", "compose"]) for (const p of files(join(ground, "src", d), /\.ts$/)) scan(p);
    scan(join(ground, "src/shaders.ts"));
    for (const p of files(join(ground, "shaders"), /\.wgsl$/)) scan(p);
    for (const p of files(resolve(ground, "../../apps/groundlab/src"), /\.ts$/)) scan(p);
    for (const p of files(join(ground, "oracle"), /\.ts$/)) if (!p.endsWith("/fixtures/vf-theme.ts")) scan(p);
    expect(offenders).toEqual([]);
  });

  it("names no colour inside the frame shader: every rgb it paints is a uniform or the record's surface", () => {
    const wgsl = readFileSync(join(ground, "shaders/card/frame.wgsl"), "utf8").replace(/\/\/.*$/gm, "");
    // a vec3f/vec4f literal with three equal non-zero components is a grey someone typed
    // (black is the §5 shadow's colour and transparent is an accumulator's start — both are 0)
    const greys = [...wgsl.matchAll(/vec[34]f\(\s*(\d*\.\d+)\s*,\s*\1\s*,\s*\1/g)].map((m) => m[1]).filter((v) => Number(v) !== 0);
    expect(greys).toEqual([]);
    expect(wgsl).not.toMatch(/vec3f\(\s*1\.0\s*\)/);
  });

  it("the presets and the window are the ground's own laws, derived from the needle", () => {
    expect(ENGINE_GRID.dotRadius[1]).toBeCloseTo(ENGINE_GRID.needleLength * 1.05, 9);
    expect(ENGINE_GRID.needleHalfLen).toEqual([ENGINE_GRID.needleLength * 0.55, ENGINE_GRID.needleLength]);
    expect(ENGINE_GRID.needleHalfWidth[0]).toBeCloseTo(ENGINE_GRID.needleWidth * 0.85, 9);
    expect(ENGINE_GRID.needleHalfWidth[1]).toBeCloseTo(ENGINE_GRID.needleWidth * 1.15, 9);
    expect(ENGINE_GRID.fadeIn[1]).toBe(2 * ENGINE_GRID.fadeIn[0]);
  });
});

describe.skipIf(!existsSync(iceConfig))("the engine's grid defaults are ICE's own (core/settings/ground-config.ts)", () => {
  const src = readFileSync(iceConfig, "utf8");
  const block = (name: string) => { const m = new RegExp(`export const ${name}[^=]*= \\{([\\s\\S]*?)\\};`).exec(src); expect(m, name).toBeTruthy(); return must(m)[1] as string; };
  const num = (b: string, key: string) => Number(must(new RegExp(`${key}:\\s*([-\\d.]+)`).exec(b))[1]);
  const str = (b: string, key: string) => must(new RegExp(`${key}:\\s*"([^"]+)"`).exec(b))[1];

  it("DEFAULT_GRID_MAGNET_CONFIG: the glyph, the reach, the polarity, the alignment and the needle are ICE's", () => {
    const b = block("DEFAULT_GRID_MAGNET_CONFIG");
    expect(str(b, "glyph")).toBe(ENGINE_GRID.glyph);
    expect(num(b, "reach")).toBe(ENGINE_GRID.reach);
    expect(num(b, "polarity")).toBe(ENGINE_GRID.polarity);
    expect(/alwaysAlign:\s*false/.test(b)).toBe(!ENGINE_GRID.alwaysAlign);
    expect(num(b, "needleLength")).toBe(ENGINE_GRID.needleLength);
    expect(num(b, "needleWidth")).toBe(ENGINE_GRID.needleWidth);
  });

  it("DEFAULT_GRID_CONFIG: the one ink ICE ships, and its alpha", () => {
    const b = block("DEFAULT_GRID_CONFIG");
    const m = must(/dotColor:\s*\[([\d.]+),\s*([\d.]+),\s*([\d.]+)\]/.exec(b));
    expect([Number(m[1]), Number(m[2]), Number(m[3])]).toEqual([...ENGINE_GRID.ink.rgb]);
    expect(num(b, "dotAlpha")).toBe(ENGINE_GRID.dotAlpha);
  });
});
