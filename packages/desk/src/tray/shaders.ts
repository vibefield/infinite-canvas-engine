// Assemble the tray pass's program from the host's shader text — the browser's generated module, the Node oracle's files on
// disk; byte-identical either way. The kit brings, by name (kit/wgsl.ts), the view block's struct (`MatUniforms`), the card's
// primitives and the mat's light — `shade_mat`, `night_mat`, the colour chain; the tray's own record, module and entry follow.
// The tray is ENGINE CHROME, not a kind (design-016 K-L6 — it stays in desk): its entry binds its OWN block of that struct,
// never a slot's (tray/pass.ts says why).

import type { ComposeOptions } from "../engine/shader";
import { kitWgsl, type ShaderText } from "../kit/wgsl";
import { TrayUniforms } from "./layout";

/** The tray's own shader files (the kit's pieces come by name). */
export const TRAY_SHADER_FILES = { tray: "tray/tray.wgsl", trayPass: "tray/tray-pass.wgsl" } as const;

/** The tray pass's program: the kit's view · sdf · light, then the tray's record, module and entry. */
export type TrayShaders = ComposeOptions;

export function trayShaders(text: ShaderText): TrayShaders {
  const t = text(TRAY_SHADER_FILES);
  return kitWgsl(["view", "sdf", "light"], {
    structs: [TrayUniforms],
    modules: [{ label: "tray/tray.wgsl", text: t.tray }],
    entry: { label: "tray/tray-pass.wgsl", text: t.trayPass },
  }, text);
}
