// The reference kinds' SHADER TEXT (design-016 K4b: per-package shader generation). A kind's own WGSL — shaders/<kind>/ — is
// this package's generated module (shaders.gen.ts); the kit's pieces (the slot's view block, the portal chain, the sdf, the
// light, the book kit — what `kitWgsl` names) are the desk's, asked of `@ice/desk`'s `shaderText`, so a kind composes the kit by
// name and never reads the desk's files. What a browser host composes the kinds from (`deskKinds()`, each kind's default); the
// Node oracle composes the same two roots from disk, byte for byte.
import { type ShaderText, shaderText as deskText } from "@ice/desk";
import { WGSL, type WgslFile } from "./shaders.gen";

/** The text of every file a shader-file map names, by the map's keys: a kind's file from this package, the kit's from the desk. */
export const shaderText: ShaderText = <T extends Record<string, string>>(files: T): { readonly [K in keyof T]: string } => {
  const own: Record<string, string> = {};
  const kit: Record<string, string> = {};
  for (const [key, file] of Object.entries(files)) {
    if (Object.hasOwn(WGSL, file)) own[key] = WGSL[file as WgslFile];
    else kit[key] = file;
  }
  return { ...deskText(kit), ...own } as { readonly [K in keyof T]: string };
};
