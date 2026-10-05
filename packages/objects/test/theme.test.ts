// The ENGINE's theme gate (the desk's src/theme.ts): the CSS colour parser, the one law —
// a colour literal lives in the desk's src/theme.ts or the product's projection (the lab's
// theme.ts in the prototype; oracle/fixtures/vf-theme.ts from design-015 D1, and
// since D7 the reference objects' palette — `@ice/objects` src/palette.ts since K4b — their SHIPPED default
// palette, which the fixture re-exports) and nowhere else in either package's src/, shaders/ or the
// hosts' code (the oracle, apps/desk) — the mini mat's shader naming no colour, and the grid's own law. The
// product's cross-checks against tokens.css, DESIGN.md and canvas-appearance.ts
// are test/vf-theme.test.ts. (The card frame's shader check and the dot/needle
// defaults read back from ICE retired with them, 2026-09-25 — MINIMAT.md §1.)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { cssColor, GRID, MISSING_INK, PORTAL_GATE } from "@ice/desk";
import { MINIMAT } from "../src/minimat/theme";

const ground = resolve(import.meta.dirname, "..");
const desk = resolve(ground, "../desk");   // the engine's half of the law (K4b: the kinds are a package of their own)

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
    // a string it cannot parse throws only when asked to; else it answers the missing ink, said once (petition I32)
    expect(() => cssColor("neutral-800", { strict: true })).toThrow(/unparsed colour "neutral-800"/);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(cssColor("neutral-800")).toEqual(MISSING_INK);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally { warn.mockRestore(); }
  });

  it("a colour literal has two homes — the desk's src/theme.ts (the engine's) and the objects' src/palette.ts (the product's, shipped as the reference objects' default) — and none in the rest of either package's src/ and shaders/, the oracle and apps/desk", () => {
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
    // both packages since design-016 K4b: the desk's (its theme.ts the exemption) and the reference kinds' (their palette.ts)
    for (const pkg of [desk, ground]) {
      for (const p of files(join(pkg, "src"), /\.ts$/)) if (!p.endsWith("/desk/src/theme.ts") && !p.endsWith("/objects/src/palette.ts") && !p.endsWith("/src/shaders.gen.ts")) scan(p);
      for (const p of files(join(pkg, "shaders"), /\.wgsl$/)) scan(p);
    }
    // the hosts' code — the lab's in the prototype; the oracle's and apps/desk's here (packages/ground's gate scans groundlab's)
    for (const p of files(join(ground, "oracle"), /\.(ts|mjs)$/)) scan(p);   // the fixture is a re-export since D7: no exemption
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
