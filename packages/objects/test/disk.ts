// The Node oracle's host text for a unit (design-016 K4b): the .wgsl files ON DISK, by a map's keys — a kind's from this
// package's shaders/, the kit's from the desk's, the two roots the oracle composes from — so a unit composes byte-identical
// programs without the generated modules.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ShaderText } from "@ice/desk";

/** The shader roots, the kinds' first: `@ice/objects`' shaders/ and `@ice/desk`'s (the kit, the mat, the portal chain). */
export const SHADER_ROOTS = [resolve(import.meta.dirname, "../shaders"), resolve(import.meta.dirname, "../../desk/shaders")] as const;

/** One .wgsl file by its key (`paper/paper.wgsl`, `mat/mat.wgsl`), from whichever root holds it. */
export function wgslOnDisk(file: string): string {
  for (const root of SHADER_ROOTS) {
    const p = join(root, file);
    if (existsSync(p)) return readFileSync(p, "utf8");
  }
  throw new Error(`no shader file ${file} under ${SHADER_ROOTS.join(" or ")}`);
}

/** The host text over both roots. */
export const diskText: ShaderText = (files) => Object.fromEntries(Object.entries(files).map(([k, f]) => [k, wgslOnDisk(f)])) as never;
