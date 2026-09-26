// design-015 §2.2 — "the DOM lives in screen space": no DOM element carries a camera transform; the ONE
// focused editor (host/editor.ts, D2c) is placed by one plain transform — translate · rotate · translate,
// its box and font sized by the zoom — never a `scale(`, never a `matrix`. The grep the law asks for,
// over every CSS transform the desk's host writes (a Canvas2D `ctx.scale` is a raster's, not a style's).
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const host = resolve(import.meta.dirname, "../src/host");
/** Every line of the host that names a CSS transform — the one that builds it and the one that sets it. */
const transforms = (): string[] => readdirSync(host).filter((f) => f.endsWith(".ts")).flatMap((f) =>
  readFileSync(join(host, f), "utf8").split("\n").map((l, i) => `${f}:${i + 1}: ${l.trim()}`).filter((l) => /\btransform\b/.test(l) && !/transformOrigin|transform-origin/.test(l)));

describe("the DOM in screen space (design-015 §2.2)", () => {
  it("the desk's host writes CSS transforms only as translate · rotate — no scale(, no matrix", () => {
    const lines = transforms();
    expect(lines.length).toBeGreaterThan(0);   // live: the editor's own placement is among them
    expect(lines.filter((l) => /scale\(|matrix/.test(l))).toEqual([]);
    expect(lines.some((l) => /translate\(.*rotate\(.*translate\(/.test(l))).toBe(true);
  });
});
