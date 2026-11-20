// The desk's shader text from the generated module (shaders.gen.ts): what a
// browser host composes its sets from — `matShaders(shaderText(MAT_SHADER_FILES))`,
// and the same for every pass's `*_SHADER_FILES` map. The Node oracle composes the
// same sets from the .wgsl files on disk (oracle/render.mjs), so the two hosts
// compile byte-identical programs; `gen:check` keeps the module fresh.
// (packages/ground/src/shaders.ts's helper, the B1 convention.)
import { type LightText, lightTextState } from "./light-text";
import { WGSL, type WgslFile } from "./shaders.gen";

/**
 * A host's shader text: a shader-file map (`MAT_SHADER_FILES`, …) → the text of every file it names, by the map's
 * keys — `shaderText` below (the generated module) in a browser, the .wgsl files read from disk in the Node oracle.
 * A kind's program is made for one (kinds/: `paperProgram(text)`, `deskKinds(text)`).
 */
export type ShaderText = <T extends Record<string, string>>(files: T) => { readonly [K in keyof T]: string };

/**
 * THE LIGHT'S TEXT (petition I56). The mat's light is one file, mat/mat.wgsl — the mat pass's module and the kit's `light`
 * piece, composed into every kind's program. It has two texts:
 *  - `"cone"`, the default: mat.wgsl as it is, token for token — the projector, the reference's grade, the night as it was;
 *  - `"soft"`: the SOFT LIGHT'S text (`softLightWgsl`) — the same file with mat/soft.wgsl laid after it, which adds soft
 *    light (`MatConfig.gobo.model: "soft"`, mat/soft.ts) and the night's two numbers (`MatLight.contrast`, `fromDay`).
 *    Under it the cone is still a config away (`model: "cone"`), drawn by the same functions.
 * It is a second TEXT and not a branch because the device's compiler reorders the chains' float arithmetic by what stands
 * around it: a host that asks for nothing compiles what it always compiled, so its pixels do not move by a digit.
 */
export type { LightText } from "./light-text";

const MAT_FILE = "mat/mat.wgsl";
const SOFT_FILE = "mat/soft.wgsl";
/** The four definitions of mat.wgsl the soft light's text takes over — every caller's names. */
export const SOFT_LIGHT_NAMES = ["project_gobo", "shade_mat", "night_mat", "mat_colour"] as const;

/**
 * The soft light's text from the two files': `mat` with each of the four definitions renamed `cone_…` (only the line that
 * DEFINES it — its callers' lines stand, so they call the definition `soft` brings), then `soft`. Pure: the browser composes
 * it from the generated module, a Node host from the files on disk, byte-identical either way. Throws unless `mat` defines
 * each of the four exactly once.
 */
export function softLightWgsl(mat: string, soft: string): string {
  let out = mat;
  for (const name of SOFT_LIGHT_NAMES) {
    const def = `\nfn ${name}(`;
    const found = out.split(def).length - 1;
    if (found !== 1) throw new Error(`softLightWgsl: mat.wgsl defines ${name} ${found} times, not once`);
    out = out.replace(def, `\nfn cone_${name}(`);
  }
  return `${out}\n${soft}`;
}

let softLight: string | undefined;

/**
 * Choose the light's text for every program composed from the generated module in this page: the mat's, the tray's, every
 * kind's — a plugin's too, through `kitWgsl`. Call it ONCE, before the first desk mounts.
 *  - ONE TEXT PER PAGE, never mixed: kinds of two texts on one desk would shade differently side by side. So once any
 *    program has composed the light, a call that would CHANGE the text throws; asking again for the text in force is a
 *    no-op. `lightText()` says which is in force.
 *  - PER REALM: the choice is module state. A worker, an iframe or a second renderer that composes WGSL has its own, and
 *    calls this itself.
 *  - A host with its own `ShaderText` (the Node oracle's disk reader) is not reached by it: it composes the soft light's
 *    text itself, with `softLightWgsl`.
 */
export function setLightText(next: LightText): void {
  if (next === lightTextState.text) return;
  if (lightTextState.composed) throw new Error(`setLightText("${next}"): this page's light was already composed from the "${lightTextState.text}" text. A page has one light text: choose it before the first desk mounts`);
  lightTextState.text = next;
}
/** The light's text in force in this page: what the generated module hands out for the light's file. */
export function lightText(): LightText { return lightTextState.text; }

/** The text of every file a shader-file map names, by the map's keys. */
export function shaderText<T extends Record<string, string>>(files: T): { readonly [K in keyof T]: string } {
  const out: Record<string, string> = {};
  for (const [key, file] of Object.entries(files)) {
    // the light's file is handed in the page's text, and from this moment that text stands (`setLightText`)
    if (file === MAT_FILE) lightTextState.composed = true;
    const isSoft = file === MAT_FILE && lightTextState.text === "soft";
    if (isSoft) softLight ??= softLightWgsl(WGSL[MAT_FILE], WGSL[SOFT_FILE]);
    const text = isSoft ? softLight : WGSL[file as WgslFile];
    if (text === undefined) throw new Error(`shaders: no generated text for "${file}" — run gen:shaders`);
    out[key] = text;
  }
  return out as { readonly [K in keyof T]: string };
}
