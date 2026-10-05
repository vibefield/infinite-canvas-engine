// @vitest-environment node
// AN UNPARSED COLOUR (petition I32; VibeField DK-10 — a template's free-string `color` prop handed to `rgb` inside `record` threw, and
// the throw STRUCK the kind: three strikes and every one of its objects wore the missing face, for one bad string). `cssColor` and
// `rgb` answer a string they cannot parse with the MISSING INK — the missing face's ink by day, opaque — and say it ONCE a page on
// the console; `{ strict: true }` keeps the throw, and the engine parses its own colours and a host's palette so. A valid colour
// parses as it always did, strict or not (every golden is unchanged). The desk half — a kind's record fed one is never struck — is
// kind-faults.test.ts's.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cssColor, MISSING, MISSING_INK, type Palette, rgb, themeFrom } from "../src/theme";

/** What the parser said on the console about `text`. */
const saidOf = (spy: { mock: { calls: unknown[][] } }, text: string): string[] => spy.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("unparsed colour") && m.includes(text));

describe("an unparsed colour (petition I32)", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("a valid colour parses as it always did — the three syntaxes, strict or not", () => {
    for (const css of ["#4a90d9", "  #4A90D9 ", "rgb(28 28 30 / 70%)", "rgb(28 28 30)", "rgba(255, 255, 255, 0.08)", "rgb(14 26 10 / .34)"]) {
      expect(cssColor(css, { strict: true }), css).toEqual(cssColor(css));
    }
    expect(cssColor("#4a90d9")).toEqual([0x4a / 255, 0x90 / 255, 0xd9 / 255, 1]);
    expect(cssColor("rgb(28 28 30 / 70%)")).toEqual([28 / 255, 28 / 255, 30 / 255, 0.7]);
    expect(rgb("rgba(255, 255, 255, 0.08)")).toEqual([1, 1, 1]);
  });

  it("the MISSING INK is the missing face's ink by day, opaque", () => {
    expect(MISSING_INK).toEqual(cssColor(MISSING.ink.light, { strict: true }));
    expect(MISSING_INK[3]).toBe(1);
  });

  it("`rgb` and `cssColor` on a string they cannot parse answer the missing ink — never a throw — and say it ONCE a page", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(rgb("not a colour")).toEqual(MISSING_INK.slice(0, 3));
    expect(saidOf(warn, '"not a colour"')).toHaveLength(1);
    expect(saidOf(warn, '"not a colour"')[0]).toMatch(/drawn in the missing ink.*strict: true.*petition I32/);
    // the same string again — by either door, any number of times — is said no more
    for (let i = 0; i < 5; i++) expect(cssColor("not a colour")).toEqual(MISSING_INK);
    expect(saidOf(warn, '"not a colour"')).toHaveLength(1);
    // another string is its own note; a name, `#rgb` and `hsl()` are other syntaxes, unparsed alike
    expect(cssColor("red")).toEqual(MISSING_INK);
    expect(cssColor("#f00")).toEqual(MISSING_INK);
    expect(rgb("hsl(0 100% 50%)")).toEqual(MISSING_INK.slice(0, 3));
    expect(saidOf(warn, '"red"')).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(4);
  });

  it("no string at all — an absent prop, a number — is unparsed too: the missing ink, said once a kind of value, never a throw", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const v of [undefined, null, 42, {}]) expect(rgb(v as unknown as string)).toEqual(MISSING_INK.slice(0, 3));
    expect(rgb(undefined as unknown as string)).toEqual(MISSING_INK.slice(0, 3));
    expect(warn.mock.calls.map((c) => String(c[0]).match(/\((\w+) — not a string\)/)?.[1])).toEqual(["undefined", "null", "number", "object"]);
  });

  it("each answer is a COPY: a caller that writes into it never reaches the constant", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const c = cssColor("a colour to scribble on") as unknown as number[];
    c[0] = 1;
    expect(MISSING_INK[0]).not.toBe(1);
    expect(cssColor("a colour to scribble on")[0]).toBe(MISSING_INK[0]);
  });

  it("`{ strict: true }` keeps the throw — and says nothing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => rgb("strictly not a colour", { strict: true })).toThrow('theme: unparsed colour "strictly not a colour"');
    expect(() => cssColor("#12345", { strict: true })).toThrow(/unparsed colour/);
    expect(warn).not.toHaveBeenCalled();
  });

  it("a host's palette is parsed strictly: a malformed colour throws at `themeFrom`, as before", () => {
    const ok: Palette = { canvasBg: { token: "--bg", css: "#fafafa" }, select: { token: "--sel", css: "#3080ff" } };
    expect(themeFrom("light", ok).select).toEqual(rgb("#3080ff"));
    expect(() => themeFrom("light", { ...ok, select: { token: "--sel", css: "var(--vf-select)" } })).toThrow('theme: unparsed colour "var(--vf-select)"');
  });
});
