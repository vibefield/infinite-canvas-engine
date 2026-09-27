// THE DOM-TOUCH LAW's one regex (design-015 §3 `desk-dom-free`; design-016 K4b): what a value-level DOM touch looks like and the
// code a grep reads — shared by the desk's own grep (dom-free.test.ts) and the reference kinds' (`@ice/objects`
// test/dom-free.test.ts), so the two packages are held to ONE law, not two copies of it.

/**
 * A value-level DOM touch: a global's member (optional chaining too — `navigator?.gpu`), a constructor, a call, an
 * `instanceof` against a DOM class (it throws where the class is undefined) — never a bare type name. D7 widened it:
 * `?.`, `instanceof HTMLCanvasElement|ImageBitmap|…` and `new ImageData|DOMMatrix|Path2D` passed until then.
 */
export const DOM_TOUCH = /\b(navigator|window|document|localStorage|sessionStorage)\s*(\?\.|[.[])|\b(matchMedia|requestAnimationFrame|cancelAnimationFrame|createImageBitmap|getComputedStyle)\s*\(|\bnew\s+(ResizeObserver|OffscreenCanvas|Image|ImageData|ImageBitmap|DOMMatrix|DOMPoint|DOMRect|Path2D|FontFace|MutationObserver|IntersectionObserver)\b|\binstanceof\s+(HTMLCanvasElement|HTMLImageElement|HTMLVideoElement|HTMLElement|Element|Node|ImageBitmap|ImageData|OffscreenCanvas|Window|Document|Event|MouseEvent|PointerEvent|KeyboardEvent)\b|\.getContext\s*\(|\bdevicePixelRatio\b/;

/** The code without its comments (block and line) and without its string literals' insides. */
export function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/`(?:\\.|[^`\\])*`/g, "``").replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/'(?:\\.|[^'\\])*'/g, "''");
}
