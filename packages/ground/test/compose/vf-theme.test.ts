// @vitest-environment node
// The PRODUCT's projection (lab/theme.ts) is a projection of VibeField's art
// direction, and this test is its gate: every value must equal the real token
// by name, the product's grid numbers must equal canvas-appearance.ts, and the
// two themes must keep the ground legible. The cross-checks run when the
// vibe-field repo is beside us (it is, in draft/), and skip honestly when it is
// not — at the fold this file follows lab/theme.ts to the product side.
import { must } from "./must.ts";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { HEAT, type RGB, type RGBA, SHADOW, cssColor } from "../../src/theme";
import { CARD_SURFACES, PALETTE, PRODUCT_GRID, THEMES } from "../../oracle/fixtures/vf-theme.ts";

const ground = resolve(import.meta.dirname, "../..");
const repo = resolve(ground, "../../../vibe-field");   // beside ICE when it is; the cross-checks skip honestly otherwise
const tokensCss = resolve(repo, "packages/design-kit/src/tokens.css");
const designMd = resolve(repo, "DESIGN.md");
const appearanceTs = resolve(repo, "packages/field-app/src/field/canvas-appearance.ts");
const beside = existsSync(tokensCss) && existsSync(designMd) && existsSync(appearanceTs);

/** `--vf-x: value;` pairs inside the block whose selector matches. */
function cssBlock(text: string, selector: RegExp): Map<string, string> {
  const out = new Map<string, string>();
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(stripped); m; m = re.exec(stripped)) {
    const sel = must(m[1]).trim().split("\n").pop()?.trim() ?? "";
    if (!selector.test(sel)) continue;
    for (const decl of must(m[2]).split(";")) {
      const i = decl.indexOf(":");
      if (i < 0) continue;
      const name = decl.slice(0, i).trim();
      if (name.startsWith("--")) out.set(name, decl.slice(i + 1).trim());
    }
  }
  return out;
}
const same = (a: string, b: string) => expect(cssColor(a)).toEqual(cssColor(b));
/** tokens.css carries the §7 glow/rim colours as channel triplets (`255, 255, 255`) for `rgba(var(--ic-…), α)`. */
const triplet = (v: string) => (/^\d+\s*,\s*\d+\s*,\s*\d+$/.test(v) ? `rgb(${v})` : v);

describe("VibeField's projection", () => {
  it("keeps the ground legible in both themes: the frame is the lightest chrome on dark, the card is dark on both", () => {
    const lum = (c: RGB | RGBA) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const { dark, light } = THEMES;
    expect(lum(dark.frame)).toBeGreaterThan(lum(dark.card));
    expect(lum(dark.frame)).toBeGreaterThan(lum(dark.canvasBg));
    expect(lum(light.frame)).toBeGreaterThan(lum(light.canvasBg));
    expect(lum(light.card)).toBeLessThan(0.15);
    expect(lum(dark.card)).toBeLessThan(0.15);
    expect(dark.card).toEqual(light.card);                       // §2.2: the default card surface, both themes
    expect(dark.select).toEqual(light.select);                   // §2.5: one meaning, one value
    expect(dark.hairline[3]).toBeGreaterThan(light.hairline[3]); // §2.3: white/10 on dark, black/5 on light
    expect(light.matLight.night).toBe(0); expect(dark.matLight.night).toBe(1);   // the mat: the Sun by day, the Moon by night (MAT.md)
    for (const t of [dark, light]) {
      expect(lum(t.glow)).toBeGreaterThan(lum(t.card));           // §7: a glow is lighter than the card it lights
      expect(lum(t.rim)).toBeGreaterThan(lum(t.card));
      expect(t.inkStrong[3]).toBe(1);
      expect(t.ink[3]).toBeCloseTo(0.7, 9);                     // §2.4 the ramp
      expect(t.inkMuted[3]).toBeCloseTo(0.45, 9);
      expect(t.fillHover[3]).toBeGreaterThan(t.fill[3]);         // §7 fills step up on hover
      expect(t.fieldInkAlpha).toBe(PRODUCT_GRID.dotAlpha);
    }
  });

});

describe.skipIf(!beside)("theme vs the design kit (vibe-field beside us)", () => {
  const css = readFileSync(tokensCss, "utf8");
  const light = cssBlock(css, /^:root$/);
  const dark = cssBlock(css, /^\.dark$/);
  const doc = readFileSync(designMd, "utf8");
  const appearance = readFileSync(appearanceTs, "utf8");

  it("every --vf-* and --ic-* token the theme names carries tokens.css's value for that theme", () => {
    for (const [themeName, sheet] of [["light", light], ["dark", dark]] as const) {
      for (const [role, ref] of Object.entries(PALETTE[themeName])) {
        if (!ref.token.startsWith("--vf-") && !ref.token.startsWith("--ic-")) continue;
        // dark inherits every token it does not restate
        const value = sheet.get(ref.token) ?? light.get(ref.token);
        if (value === undefined) {
          // not a design-kit token: DESIGN.md must state it — §2.1's table row, with the theme's column
          const row = doc.split("\n").find((l: string) => l.includes(`\`${ref.token}\``) && !l.includes("CSS fallback") && !l.includes("classic"));
          expect(row, `${themeName}.${role}: ${ref.token} is in neither tokens.css nor DESIGN.md`).toBeDefined();
          expect(must(row).toLowerCase(), `${themeName}.${role}: ${ref.token} ${ref.css} vs DESIGN.md`).toContain(ref.css.toLowerCase());
          continue;
        }
        expect(cssColor(triplet(value)), `${themeName}.${role}: ${ref.token} ${ref.css} vs tokens.css ${value}`).toEqual(cssColor(ref.css));
      }
    }
    for (const [name, ref] of Object.entries(CARD_SURFACES)) {
      const value = light.get(ref.token);
      expect(value, `surface ${name}: ${ref.token}`).toBeDefined();
      same(must(value), ref.css);
    }
  });

  it("the dark frame is DESIGN.md §2.2's solid chrome (neutral-800), which tokens.css does not carry", () => {
    // The doc's row; Tailwind's neutral-800.
    expect(doc).toMatch(/solid chrome \| light `white` · dark `neutral-800`/);
    same(PALETTE.dark.frame.css, "#262626");
    // and the drift this test exists to remember: tokens.css's --vf-chrome-solid on dark is the chrome MATERIAL colour
    expect(cssColor(must(dark.get("--vf-chrome-solid")))).toEqual(cssColor(must(light.get("--vf-card"))));
  });

  it("the §7 fills are the doc's `black/5 → black/10` (dark `white/10 → white/20`)", () => {
    expect(doc).toMatch(/fills step `black\/5 → black\/10` \(dark `white\/10 → white\/20`\)/);
    same(PALETTE.light.fill.css, "rgba(0, 0, 0, 0.05)"); same(PALETTE.light.fillHover.css, "rgba(0, 0, 0, 0.10)");
    same(PALETTE.dark.fill.css, "rgba(255, 255, 255, 0.10)"); same(PALETTE.dark.fillHover.css, "rgba(255, 255, 255, 0.20)");
  });

  it("the §7 heat keeps tokens.css's --ic-* colours, tier alphas and rim width; its height is the §5 lift recipe's own number", () => {
    const px = (name: string) => Number(must(/^([\d.]+)px$/.exec(must(light.get(name))))[1]);
    const num = (name: string) => Number(light.get(name));
    expect(HEAT.alpha).toEqual([num("--ic-glow-alpha-c"), num("--ic-glow-alpha-t")]);
    expect(HEAT.rim.width).toBe(px("--ic-rim-width"));
    expect(HEAT.rim.alpha).toEqual([num("--ic-rim-alpha-c"), num("--ic-rim-alpha-t")]);
    // the lifted card floats as far as its lifted shadow says: `0 30px 60px` — the light's height is that 30
    expect(HEAT.height).toBe(SHADOW.lifted.offset);
    expect(doc).toMatch(/Card, lifted \| `0 30px 60px/);
    // the dark neutrals tokens.css restates under .dark, and the doc's four colours
    same(triplet(must(dark.get("--ic-glow-color"))), PALETTE.dark.glow.css); same(triplet(must(dark.get("--ic-rim-color"))), PALETTE.dark.rim.css);
    expect(doc).toMatch(/glow color\s*\nlight `#FFFFFF`, dark `#6E6E6E` · rim color light `#E0E0E0`, dark `#5C5C5C`/);
  });

  it("the §5 card shadow recipe is transcribed exactly (blur = 2σ)", () => {
    expect(doc).toMatch(/Card, resting \| `0 20px 40px rgba\(0,0,0,0\.15\), 0 0 0 1px rgba\(0,0,0,0\.05\)`/);
    expect(doc).toMatch(/Card, lifted \| `0 30px 60px rgba\(0,0,0,0\.22\), 0 0 0 1px rgba\(0,0,0,0\.06\)`/);
  });

  it("the product's grid numbers are canvas-appearance.ts's, and its inks are the theme's", () => {
    const num = (key: string) => Number(must(new RegExp(`${key}:\\s*([\\d.]+)`).exec(appearance))[1]);
    const str = (key: string) => must(new RegExp(`${key}:\\s*"([^"]+)"`).exec(appearance))[1] as string;
    expect(str("glyph")).toBe(PRODUCT_GRID.glyph);
    expect(num("reach")).toBe(PRODUCT_GRID.reach);
    expect(num("polarity")).toBe(PRODUCT_GRID.polarity);
    expect(num("widgetStrength")).toBe(PRODUCT_GRID.widgetStrength);
    expect(num("needleLength")).toBe(PRODUCT_GRID.needleLength);
    expect(num("needleWidth")).toBe(PRODUCT_GRID.needleWidth);
    expect(num("dotAlpha")).toBe(PRODUCT_GRID.dotAlpha);
    expect(/alwaysAlign:\s*false/.test(appearance)).toBe(!PRODUCT_GRID.alwaysAlign);
    same(str("dotLight"), PALETTE.light.fieldInk.css);
    same(str("magnetDotDark"), PALETTE.dark.fieldInk.css);
    same(str("bgLight"), PALETTE.light.canvasBg.css);
    same(str("bgDark"), PALETTE.dark.canvasBg.css);
    // the glyph size presets are the envelopes ICE's magnet draws from the same numbers
    const dotRest = Number(must(/dotRadius:\s*\[\s*([\d.]+)/.exec(appearance))[1]);
    expect(PRODUCT_GRID.dotRadius[0]).toBe(dotRest);
    expect(PRODUCT_GRID.dotRadius[1]).toBeCloseTo(PRODUCT_GRID.needleLength * 1.05, 9);
    expect(PRODUCT_GRID.needleHalfLen).toEqual([PRODUCT_GRID.needleLength * 0.55, PRODUCT_GRID.needleLength]);
    expect(PRODUCT_GRID.needleHalfWidth[0]).toBeCloseTo(PRODUCT_GRID.needleWidth * 0.85, 9);
    expect(PRODUCT_GRID.needleHalfWidth[1]).toBeCloseTo(PRODUCT_GRID.needleWidth * 1.15, 9);
  });

  it("the lab's token sheet is a verbatim copy of tokens.css for every token it declares", () => {
    const html = readFileSync(resolve(ground, "../../apps/groundlab/index.html"), "utf8");
    const labLight = cssBlock(html, /^:root$/);
    const labDark = cssBlock(html, /^:root\.dark, :root\[data-theme="dark"\]$/);
    expect(labLight.size).toBeGreaterThan(5);
    expect(labDark.size).toBeGreaterThan(3);
    const equal = (a: string, b: string, what: string) => {
      let ca: unknown = null;
      let cb: unknown = null;
      try { ca = cssColor(a); cb = cssColor(b); } catch { /* not colours: compare the text */ }
      if (ca && cb) expect(ca, what).toEqual(cb); else expect(a, what).toBe(b);
    };
    for (const [name, value] of labLight) {
      expect(light.get(name), `lab :root ${name}`).toBeDefined();
      equal(value, must(light.get(name)), `lab :root ${name}`);
    }
    for (const [name, value] of labDark) {
      expect(dark.get(name), `lab .dark ${name}`).toBeDefined();
      equal(value, must(dark.get(name)), `lab .dark ${name}`);
    }
  });
});
