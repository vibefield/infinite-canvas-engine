// `needle` — the magnet needle as an INSTANCED grid program pack (design-014):
// the glyph that aligns to the field the engine bakes, over the engine's
// lattice and uniform block. Registered by an app; the engine's own glyphs
// are the dot and the line grid. (Its size presets — `halfLen`, `halfWidth`, `needleHalfLen`,
// `needleHalfWidth` — still ride the engine's `FieldConfig`, design-010's
// names; a follow-up moves them behind `ext`.)

import type { InstancedGlyph } from "../../field/program";
import { WGSL } from "../../shaders.gen";

export const NEEDLE_GLYPH = "needle";

export const needleGlyph: InstancedGlyph = {
  kind: "instanced",
  glyph: NEEDLE_GLYPH,
  entry: { label: "packs/needle/glyph-needle.wgsl", text: WGSL["packs/needle/glyph-needle.wgsl"] },
  fine: { label: "packs/needle/fine-needle.wgsl", text: WGSL["packs/needle/fine-needle.wgsl"] },
};
