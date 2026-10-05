// The kit's SHARED WGSL, by name (design-016 §5, K4a). WebGPU has no #include, so a kind's program is COMPOSED
// (engine/shader.ts: structs, then pure modules, then the entry that declares its bindings); what every kind composes
// before its own text — the slot's view block, the portal chain's cover, the card's primitives, the mat's light — is
// named here once, and a kind asks for it:
//
//   paperShaders = (text) => kitWgsl(["view", "portal", "sdf", "light"], { structs: [...own], modules: [...own], entry }, text)
//
// instead of listing the mat's files in its own map. The text comes from the host's `ShaderText` (the generated module
// in a browser, the .wgsl files on disk in the Node oracle), so both hosts compose byte-identical programs; the kit's
// pieces always precede the kind's own, in the one order below, each once however many of its names are asked.

import type { ComposeOptions, ShaderPart } from "../engine/shader";
import type { StructDef } from "../engine/struct";
import { MatUniforms } from "../mat/layout";
import { NbBook, NbUniforms } from "./book";
import { type ShaderText, shaderText } from "../shaders";

export { type ShaderText, shaderText } from "../shaders";

/**
 * The kit's pieces of WGSL, in compose order (petition I31: every function, struct and const in them carries a `///` block saying
 * what it takes — units and ranges — and what it gives; `shaderText(KIT_WGSL_FILES)` hands their text, comments and all):
 * - `view` — the slot's view block, `MatUniforms` (its JSDoc lists the fields), bound as `u` at `@group(0) @binding(0)`;
 * - `portal` — `portal_cover` and its parts: a fragment's cover through the slot's chain of faces, CSS px (portal.wgsl);
 * - `sdf` — exact signed distances: `sdf_box`, `sdf_round_box`, `sdf_circle`, `sdf_segment`, `sdf_rounded_x`, the fillets
 *   `op_union_round` and `op_isect_round` (primitives.wgsl);
 * - `light` — the mat's light as an object reads it: `mat_zoom`, `mat_dpr`, the noise (`hash12`, `value_noise` — [0, 1)), the
 *   gobo (`sample_gobo`, `lit_gobo`, `desk_of`, `lit_desk`), the day's chain (`shade_mat` — sRGB in, sRGB out) and the night's
 *   (`night_mat` — LINEAR in, sRGB out), `mat_colour`, the lattice's lines (mat/mat.wgsl — its header states the conventions);
 * - `ruler` — the rulers' print: `ruler_ink`, `ruler_band` and their glyph arithmetic (mat/ruler.wgsl);
 * - `book` — the 3D kit: the desk eye (`nb_clip`), the PCSS shadow (`nb_shadow`), the colour chain (`nb_colour`), the cloth, the
 *   paper, the cover's designs (kit/book.wgsl), over its records `NbUniforms` and `NbBook`.
 *
 * THE CONVENTIONS they share: world units (one is one CSS px at zoom 1), x right and y DOWN; CSS px = (world − `u.cam.xy`) ·
 * zoom, origin the attachment's top-left; device px = CSS px · dpr, a fragment's `@builtin(position).xy`; zoom = `mat_zoom(u)`
 * (CSS px per world unit), dpr = `mat_dpr(u)` (the attachment's device px per CSS px — below 1 for a thumbnail); the lamp's
 * desk in metres, y up (`desk_of`); colours 0..1, sRGB-encoded unless a parameter says LINEAR.
 */
export type KitWgslPiece = "view" | "portal" | "sdf" | "light" | "ruler" | "book";

/** A name of the kit's WGSL: a piece, or another name for one (`lamp`, `gobo`, `night` and `noise` are `light`). */
export type KitWgslName = KitWgslPiece | "lamp" | "gobo" | "night" | "noise";

/** A piece of the kit's WGSL: generated structs, a pure module (a .wgsl file by the host's text), or both. */
interface KitPiece {
  readonly structs?: readonly StructDef<string>[];
  readonly file?: string;
}

/**
 * The kit's WGSL in its compose order:
 * - `view` — the slot's VIEW BLOCK (`MatUniforms`: the camera, the box, the clocks, the lamp's gobo, the night, the
 *   portal chain), bound at `@group(0) @binding(0)` as `u` in every kind's entry;
 * - `portal` — `portal_cover`: a fragment's cover through the slot's chain of faces (portal.wgsl);
 * - `sdf` — the card's primitives: rounded boxes, their shadows and rims (primitives.wgsl);
 * - `light` — the mat's light as an object reads it: the desk point under a lamp, the gobo's dapple (`sample_gobo`,
 *   `lit_gobo`), the night's appearance, the value noise and the colour chain (mat/mat.wgsl; its functions call each
 *   other, so `lamp`, `gobo`, `night` and `noise` are the same piece by other names);
 * - `ruler` — the rulers' glyph lattice (mat/ruler.wgsl: a face that prints the mat's numerals);
 * - `book` — the 3D kit (kit/book.wgsl and its records `NbUniforms`, `NbBook` — kit/book.ts): the desk eye's projection,
 *   the PCSS shadow on an object's own shadow map, the materials of paper and cloth (after `light`, whose chain it grades by).
 */
const PIECES = {
  view: { structs: [MatUniforms] },
  portal: { file: "portal.wgsl" },
  sdf: { file: "primitives.wgsl" },
  light: { file: "mat/mat.wgsl" },
  ruler: { file: "mat/ruler.wgsl" },
  book: { structs: [NbUniforms, NbBook], file: "kit/book.wgsl" },
} as const satisfies Record<KitWgslPiece, KitPiece>;

/** The names a piece also answers to. */
const ALIASES: Readonly<Record<Exclude<KitWgslName, KitWgslPiece>, KitWgslPiece>> = { lamp: "light", gobo: "light", night: "light", noise: "light" };

/**
 * The .wgsl file behind each of the kit's module pieces — what a host's `ShaderText` is asked for. `shaderText(KIT_WGSL_FILES)`
 * is the pieces' text, their `///` blocks with it: what a consumer's docs generator quotes (petition I31).
 */
export const KIT_WGSL_FILES: Readonly<Partial<Record<KitWgslPiece, string>>> = Object.fromEntries(
  Object.entries(PIECES).flatMap(([name, p]) => ("file" in p ? [[name, p.file]] : [])),
);

/**
 * A kind's program with the kit's named pieces before its own: the kit's structs, then its modules (each labelled by its
 * file, as a kind's own map labelled it), in the kit's order; then the kind's `own` structs, modules and entry. `text` is
 * the host's (default: the generated module). An unknown name throws — a misspelt piece never composes silently.
 */
export function kitWgsl(names: readonly KitWgslName[], own: ComposeOptions, text: ShaderText = shaderText): ComposeOptions {
  const want = new Set<string>();
  for (const n of names) {
    const piece = (ALIASES as Record<string, string>)[n] ?? n;
    if (!(piece in PIECES)) throw new Error(`kitWgsl: no piece "${n}" (the kit's: ${[...Object.keys(PIECES), ...Object.keys(ALIASES)].join(", ")})`);
    want.add(piece);
  }
  const files: Record<string, string> = {};
  for (const [name, p] of Object.entries(PIECES) as [string, KitPiece][]) if (want.has(name) && p.file) files[name] = p.file;
  const read = text(files);
  const structs: StructDef<string>[] = [];
  const modules: ShaderPart[] = [];
  for (const [name, p] of Object.entries(PIECES) as [string, KitPiece][]) {
    if (!want.has(name)) continue;
    if (p.structs) structs.push(...p.structs);
    if (p.file) modules.push({ label: p.file, text: read[name] as string });
  }
  return { structs: [...structs, ...(own.structs ?? [])], modules: [...modules, ...(own.modules ?? [])], entry: own.entry };
}
