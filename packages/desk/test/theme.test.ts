// The ENGINE's theme gate (src/theme.ts): the CSS colour parser, the one law —
// a colour literal lives in src/theme.ts or the host's projection (the lab's
// theme.ts in the prototype; oracle/fixtures/vf-theme.ts here, a fixture since
// design-015 D1) and nowhere else in src/, shaders/ or the hosts' code (the
// oracle, apps/desk) — the mini mat's shader naming no colour, and the grid's own law. The
// product's cross-checks against tokens.css, DESIGN.md and canvas-appearance.ts
// are test/vf-theme.test.ts. (The card frame's shader check and the dot/needle
// defaults read back from ICE retired with them, 2026-09-25 — MINIMAT.md §1.)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { cssColor, GRID, MINIMAT } from "../src/theme";
import { PORTAL_GATE } from "../src/nav/portal";

const ground = resolve(import.meta.dirname, "..");

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

  it("a colour literal has two homes — src/theme.ts (the engine's) and oracle/fixtures/vf-theme.ts (the product's, a fixture) — and none in the rest of src/, shaders/, the oracle and apps/desk", () => {
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
    // (src/shaders.gen.ts is the generated copy of shaders/, which is scanned at its source; `files` skips src/assets)
    for (const p of files(join(ground, "src"), /\.ts$/)) if (!p.endsWith("/src/theme.ts") && !p.endsWith("/src/shaders.gen.ts")) scan(p);
    for (const p of files(join(ground, "shaders"), /\.wgsl$/)) scan(p);
    // the hosts' code — the lab's in the prototype; the oracle's and apps/desk's here (packages/ground's gate scans groundlab's)
    for (const p of files(join(ground, "oracle"), /\.(ts|mjs)$/)) if (!p.endsWith("/oracle/fixtures/vf-theme.ts")) scan(p);
    for (const p of files(resolve(ground, "../../apps/desk/src"), /\.ts$/)) scan(p);
    expect(offenders).toEqual([]);
  });

  it("names no colour inside the mini mat's shader: every rgb it paints is the mat's chain, a uniform or a record's", () => {
    const wgsl = readFileSync(join(ground, "shaders/minimat/minimat.wgsl"), "utf8").replace(/\/\/.*$/gm, "");
    // a vec3f/vec4f literal with three equal non-zero components is a grey someone typed
    const greys = [...wgsl.matchAll(/vec[34]f\(\s*(\d*\.\d+)\s*,\s*\1\s*,\s*\1/g)].map((m) => m[1]).filter((v) => Number(v) !== 0);
    expect(greys).toEqual([]);
    // the vinyl goes through the mat's own chain, and the print is the uniforms' cream — never a literal
    expect(wgsl).toMatch(/mat_colour\(u,/);
  });

  it("the grid's law: an octave of fade-in, a dressing floor below the identity, and a mini mat's gate the portal's", () => {
    expect(GRID.fadeIn[1]).toBe(2 * GRID.fadeIn[0]);
    expect(GRID.dressFloor).toBeGreaterThan(0); expect(GRID.dressFloor).toBeLessThanOrEqual(1);
    expect(MINIMAT.gate[0]).toBeLessThan(MINIMAT.gate[1]);
    expect(PORTAL_GATE).toBe(MINIMAT.gate);
  });
});
