// The PRODUCT's projection (oracle/fixtures/vf-theme.ts — the prototype's
// lab/theme.ts, a fixture since design-015 D1) is a projection of VibeField's art
// direction, and this test is its gate: every value must equal the real token
// by name, the clear colour must equal canvas-appearance.ts, and the two themes
// must keep the ground legible. The cross-checks run when the vibe-field repo is
// beside ICE, and skip honestly when it is not — at the fold this file follows
// the fixture to the product side. (The card chrome's checks — the frame, the
// fills, the §7 heat, the §5 shadow — and the magnet grid's numbers retired with
// the cards and the dot and needle grids, 2026-09-25. The lab's token sheet check
// — lab/index.html against tokens.css — stayed with the lab, which did not move.)
import { must } from "../../desk/test/must";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MAT_COLORS, type RGB, type RGBA, cssColor } from "@ice/desk";
import { PALETTE, SURFACES, surface, THEMES, vinyl, VINYL_NAMES } from "../oracle/fixtures/vf-theme";

const ground = resolve(import.meta.dirname, "..");
const repo = resolve(ground, "../../../vibe-field");   // beside ICE when it is (packages/ground's convention); the cross-checks skip honestly otherwise
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
/** tokens.css carries some colours as channel triplets (`255, 255, 255`) for `rgba(var(--ic-…), α)`. */
const triplet = (v: string) => (/^\d+\s*,\s*\d+\s*,\s*\d+$/.test(v) ? `rgb(${v})` : v);

describe("VibeField's projection", () => {
  const lum = (c: RGB | RGBA) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  it("keeps the ground legible in both themes: one select, the Sun by day and the Moon by night", () => {
    const { dark, light } = THEMES;
    expect(dark.select).toEqual(light.select);                   // §2.5: one meaning, one value
    expect(lum(dark.canvasBg)).toBeLessThan(lum(light.canvasBg));
    expect(light.matLight.night).toBe(0); expect(dark.matLight.night).toBe(1);   // the mat: the Sun by day, the Moon by night (MAT.md)
    expect(lum(surface("note"))).toBeGreaterThan(0.6);           // a note is light paper on either desk
  });

  it("the mini mats' vinyls: the desk's own sage, and two that are neither it nor each other, never pure black", () => {
    expect(vinyl("sage", MAT_COLORS.ground)).toBe(MAT_COLORS.ground);
    const others = VINYL_NAMES.filter((n) => n !== "sage").map((n) => vinyl(n, MAT_COLORS.ground));
    expect(others.length).toBe(2);
    for (const c of others) { expect(c).not.toEqual(MAT_COLORS.ground); expect(Math.max(...c)).toBeGreaterThan(0.2); }
    expect(others[0]).not.toEqual(others[1]);
  });
});

describe.skipIf(!beside)("theme vs the design kit (vibe-field beside us)", () => {
  // vitest collects a skipped describe's body too: read only when beside, or the skip throws instead
  const read = (p: string) => (beside ? readFileSync(p, "utf8") : "");
  const css = read(tokensCss);
  const light = cssBlock(css, /^:root$/);
  const dark = cssBlock(css, /^\.dark$/);
  const doc = read(designMd);
  const appearance = read(appearanceTs);

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
    for (const [name, ref] of Object.entries(SURFACES)) {
      const value = light.get(ref.token);
      expect(value, `surface ${name}: ${ref.token}`).toBeDefined();
      same(must(value), ref.css);
    }
  });

  it("the clear colour is canvas-appearance.ts's, in both themes", () => {
    const str = (key: string) => must(new RegExp(`${key}:\\s*"([^"]+)"`).exec(appearance))[1] as string;
    same(str("bgLight"), PALETTE.light.canvasBg.css);
    same(str("bgDark"), PALETTE.dark.canvasBg.css);
  });
});
