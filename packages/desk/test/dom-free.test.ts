// design-015 §3's wall, `desk-dom-free` (D2a-world): `desk/src/*` may touch the DOM only under
// `src/host/` — the canvas, the window, `navigator`, the media queries, image decode, Canvas2D —
// so the Node oracle imports everything else whole and a kind, a builder or a reflector never
// needs a browser to be tested. Dependency-cruiser sees imports, not globals, so this is the grep
// it cannot be: every value-level DOM touch under src/ outside host/, by name, with the comments
// stripped; a type annotation (`HTMLCanvasElement` in a signature) names nothing at run time
// and is allowed. The host files must match — the same regex, live — or the gate is a no-op.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = resolve(import.meta.dirname, "../src");

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (name.endsWith(".ts")) yield p;
  }
}

/**
 * A value-level DOM touch: a global's member (optional chaining too — `navigator?.gpu`), a constructor, a call, an
 * `instanceof` against a DOM class (it throws where the class is undefined) — never a bare type name. D7 widened it:
 * `?.`, `instanceof HTMLCanvasElement|ImageBitmap|…` and `new ImageData|DOMMatrix|Path2D` passed until then.
 */
const DOM_TOUCH = /\b(navigator|window|document|localStorage|sessionStorage)\s*(\?\.|[.[])|\b(matchMedia|requestAnimationFrame|cancelAnimationFrame|createImageBitmap|getComputedStyle)\s*\(|\bnew\s+(ResizeObserver|OffscreenCanvas|Image|ImageData|ImageBitmap|DOMMatrix|DOMPoint|DOMRect|Path2D|FontFace|MutationObserver|IntersectionObserver)\b|\binstanceof\s+(HTMLCanvasElement|HTMLImageElement|HTMLVideoElement|HTMLElement|Element|Node|ImageBitmap|ImageData|OffscreenCanvas|Window|Document|Event|MouseEvent|PointerEvent|KeyboardEvent)\b|\.getContext\s*\(|\bdevicePixelRatio\b/;

/** The code without its comments (block and line) and without its string literals' insides. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/`(?:\\.|[^`\\])*`/g, "``").replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/'(?:\\.|[^'\\])*'/g, "''");
}

describe("desk-dom-free (design-015 §3)", () => {
  it("nothing under src/ outside src/host/ touches the DOM at run time", () => {
    const offenders: string[] = [];
    for (const p of files(src)) {
      const rel = relative(src, p);
      if (rel.startsWith("host/") || rel === "shaders.gen.ts") continue;
      code(readFileSync(p, "utf8")).split("\n").forEach((line, i) => { if (DOM_TOUCH.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`); });
    }
    expect(offenders).toEqual([]);
  });

  it("the regex sees every shape of a touch — optional chaining, instanceof, the 2D/matrix constructors — and passes a bare type", () => {
    for (const touch of ["const g = navigator?.gpu;", "if (window?.devicePixelRatio) {}", "if (src instanceof HTMLCanvasElement) {}", "x instanceof ImageBitmap", "new ImageData(1, 1)", "new DOMMatrix()", "new Path2D()", "document.title", "requestAnimationFrame(f)"]) {
      expect(DOM_TOUCH.test(code(touch)), touch).toBe(true);
    }
    for (const type of ["let c: HTMLCanvasElement | null = null;", "type B = ImageBitmap;", "function f(e: PointerEvent): void {}", "const s = \"navigator?.gpu\";"]) {
      expect(DOM_TOUCH.test(code(type)), type).toBe(false);
    }
  });

  it("the host half DOES touch it — the swap chain names the canvas, the window and navigator.gpu — so the regex is live", () => {
    const touches = code(readFileSync(join(src, "host/surface.ts"), "utf8")).split("\n").filter((l) => DOM_TOUCH.test(l));
    expect(touches.length).toBeGreaterThanOrEqual(3);
    expect(touches.some((l) => /navigator\s*\./.test(l))).toBe(true);
    expect(touches.some((l) => /getContext\s*\(/.test(l))).toBe(true);
    expect(touches.some((l) => /devicePixelRatio/.test(l))).toBe(true);
  });

  it("the composition root takes a made Surface, never a canvas: no DOM type in ground.ts's options", () => {
    const ground = readFileSync(join(src, "ground.ts"), "utf8");
    expect(ground).not.toMatch(/HTMLCanvasElement/);
    expect(ground).toMatch(/readonly surface: Surface/);
  });
});
