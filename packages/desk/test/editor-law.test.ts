// design-015 §2.2 — "the DOM lives in screen space": no DOM element carries a camera transform; the ONE
// focused editor (host/editor.ts, D2c) is placed by one plain transform — translate · rotate · translate,
// its box and font sized by the zoom — never a `scale(`, never a `matrix`. The grep the law asks for,
// over every CSS transform the desk's host writes (a Canvas2D `ctx.scale` is a raster's, not a style's).
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const packages = resolve(import.meta.dirname, "../..");
/**
 * The hosts that write CSS: the desk's (src/host) and, since design-016 K4b, each reference kind's DOM half (`@ice/objects`
 * src/<kind>/host — the ONE focused editor is the note's, there), read by path: the law spans every package that touches the DOM.
 */
const hosts = [resolve(packages, "desk/src/host"), ...readdirSync(resolve(packages, "objects/src")).map((k) => resolve(packages, "objects/src", k, "host")).filter((d) => existsSync(d))];
/** Every .ts/.tsx under a directory. */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : []; });
}
/** The code without its comments — a comment may name a transform it does not write. */
const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
/** Every line of the host that names a CSS transform — the one that builds it and the one that sets it. */
const transforms = (): string[] => hosts.flatMap((host) => readdirSync(host).filter((f) => f.endsWith(".ts")).map((f) => join(host, f))).flatMap((p) =>
  readFileSync(p, "utf8").split("\n").map((l, i) => `${relative(packages, p)}:${i + 1}: ${l.trim()}`).filter((l) => /\btransform\b/.test(l) && !/transformOrigin|transform-origin/.test(l)));

/**
 * D7 (the surface review's #14): the grep above read desk/src/host only, and only lines naming "transform" — a camera
 * transform written as `style.scale`, `style.zoom` or `setProperty("zoom", …)`, or from dom's or react's own DOM, passed.
 * Every package that touches the DOM is read now: no code writes `zoom`/`scale` as a style, and no INTERPOLATED
 * `scale(`/`matrix(` is built (a static stylesheet's `:active{transform:scale(.95)}` cannot carry the camera; a
 * `scale(${…})` can).
 */
const CAMERA_WRITE = /\.style\.(zoom|scale)\s*=|setProperty\(\s*["'`](zoom|scale)["'`]|(scale|matrix|matrix3d)\(\s*\$\{/;
const domPackages = [...hosts, ...["dom/src", "react/src"].map((d) => resolve(packages, d))];
const cameraWrites = (): string[] => domPackages.flatMap((d) => files(d)).flatMap((p) =>
  code(readFileSync(p, "utf8")).split("\n").flatMap((l, i) => (CAMERA_WRITE.test(l) ? [`${relative(packages, p)}:${i + 1}: ${l.trim()}`] : [])));

describe("the DOM in screen space (design-015 §2.2)", () => {
  it("the desk's host writes CSS transforms only as translate · rotate — no scale(, no matrix", () => {
    const lines = transforms();
    expect(lines.length).toBeGreaterThan(0);   // live: the editor's own placement is among them
    expect(lines.filter((l) => /scale\(|matrix/.test(l))).toEqual([]);
    expect(lines.some((l) => /translate\(.*rotate\(.*translate\(/.test(l))).toBe(true);
  });

  it("no package that touches the DOM writes a camera transform — no style zoom/scale, no interpolated scale(/matrix( (D7)", () => {
    expect(cameraWrites()).toEqual([]);
    // live: each shape is seen, and a static stylesheet's press effect is not
    for (const w of ["el.style.scale = String(cam.zoom);", "el.style.zoom = `${z}`;", 'st.setProperty("zoom", z);', "el.style.transform = `scale(${z})`;", "`matrix(${a}, 0, 0, ${a}, 0, 0)`"]) expect(CAMERA_WRITE.test(w), w).toBe(true);
    expect(CAMERA_WRITE.test("[data-ice-selection-menu] .ice-sm-btn:active{transform:scale(.95)}")).toBe(false);
  });
});
