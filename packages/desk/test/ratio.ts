// THE DEVICE RATIO a WGSL module converts by (petition I29), read from its text and evaluated as the arithmetic it is: `mat_dpr`'s
// `return` and each `let dpr = …;` a function binds, its ratio terms bound to one number — a view block's `cam.w` (the slot's) or
// `view.z` (the marks', the tray's), a parameter named `dpr`, a call of `mat_dpr` (by the module's own definition) — and `max`,
// `min`, `clamp`, `select` as WGSL's. A term it does not know THROWS, naming the expression: a respelt read is a unit to extend,
// never a silent pass. (A unit's helper: the desk's units and the six kinds' — objects/test/device-ratio.test.ts — read with it.)

/** A device-ratio binding: the function it lies in and its expression. */
export interface RatioRead { readonly where: string; readonly expr: string }

/** `mat_dpr`'s expression in `code` (the kit's mat.wgsl, or a module composed with it), or undefined when it defines none. */
export function matDprOf(code: string): string | undefined {
  return /\bfn\s+mat_dpr\s*\([^)]*\)\s*->\s*f32\s*\{\s*return\s+([^;]+);\s*\}/.exec(code)?.[1]?.trim();
}

/** The name of the function `at` lies in. */
function fnAt(code: string, at: number): string {
  let name = "(module scope)";
  for (const m of code.slice(0, at).matchAll(/\bfn\s+(\w+)\s*\(/g)) name = m[1] as string;
  return name;
}

/** Every device-ratio binding in `code`, in order: `mat_dpr`'s `return`, then each `let dpr = …;`. */
export function ratioReads(code: string): RatioRead[] {
  const out: RatioRead[] = [];
  const def = matDprOf(code);
  if (def !== undefined) out.push({ where: "mat_dpr", expr: def });
  for (const m of code.matchAll(/\blet\s+dpr\s*=\s*([^;]+);/g)) out.push({ where: fnAt(code, m.index), expr: (m[1] as string).trim() });
  return out;
}

const WGSL_FNS = {
  max: Math.max,
  min: Math.min,
  clamp: (x: number, lo: number, hi: number): number => Math.min(Math.max(x, lo), hi),
  select: (f: number, t: number, c: boolean): number => (c ? t : f),
};

/** `expr` at device ratio `r` — a call of `mat_dpr` by `matDpr`, its definition (none handed: such a call throws). */
export function ratioAt(expr: string, r: number, matDpr?: string): number {
  let js = matDpr === undefined ? expr : expr.replace(/\bmat_dpr\s*\(\s*\w+\s*\)/g, `(${matDpr})`);
  js = js.replace(/\b\w+\.(?:cam\.w|view\.z)\b/g, "r").replace(/\bdpr\b/g, "r").replace(/(\d)[fh]\b/g, "$1");
  if (/[^\s\d.e+\-*/(),<>=!&|?:]/.test(js.replace(/\b(?:r|max|min|clamp|select|true|false)\b/g, ""))) {
    throw new Error(`ratio: \`${expr}\` names a term that is not the ratio's (as read: ${js})`);
  }
  const f = new Function("r", ...Object.keys(WGSL_FNS), `"use strict"; return (${js});`) as (r: number, ...fns: unknown[]) => unknown;
  const v = f(r, ...Object.values(WGSL_FNS));
  if (typeof v !== "number" || Number.isNaN(v)) throw new Error(`ratio: \`${expr}\` is no number of the ratio (as read: ${js})`);
  return v;
}
