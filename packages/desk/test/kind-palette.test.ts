// @vitest-environment node
// THE MAT'S CAST AS A PALETTE ROLE (petition I46 — VibeField's browser pane kept a named COPY of `MAT.cast`; its comment pad drew its
// shadow black): a kind's `theme(palette, name)` is handed the host's palette with the desk's own role beside its roles — `cast`, the
// colour an object's shadow casts on the mat (`KindPalette`) — so a plugin kind's shadow falls in the mat's own colour in every theme
// with no copy of the number. `looksOf` is the one caller (the layer's reflector, a still, the tray): what it hands is `kindPalette`.
import { describe, expect, it } from "vitest";
import { looksOf } from "../src/compose/reflector";
import type { ObjectKind } from "../src/kinds/world";
import { type KindPalette, kindPalette, MAT, MAT_COLORS, type Palette, rgb, type RGB, type ThemeName, themeFrom } from "../src/theme";

const HOST = { canvasBg: { token: "--bg", css: "#fafafa" }, select: { token: "--sel", css: "#3080ff" }, panes: { glass: "the host's own role, for one of its kinds" } };
/** A plugin kind's theme: its shadow's colour read off the role, beside what it reads of the host's. */
interface ProbeLook { readonly cast: RGB; readonly castToken: string; readonly select: RGB; readonly name: ThemeName; readonly glass: unknown }
const seen: KindPalette[] = [];
const probe = {
  name: "probe",
  theme(palette: KindPalette, name: ThemeName): ProbeLook {
    seen.push(palette);
    return { cast: rgb(palette.cast.css), castToken: palette.cast.token, select: rgb(palette.select.css), name, glass: (palette as KindPalette & typeof HOST).panes?.glass };
  },
} as unknown as ObjectKind;

describe("the mat's cast colour as a palette role (petition I46)", () => {
  it("kindPalette: every role the host passed — its own extra ones too — with the mat's `cast`; a `cast` of the host's is replaced (the mat's is the desk's word)", () => {
    const handed = kindPalette(HOST);
    expect(handed).toEqual({ ...HOST, cast: MAT.cast });
    expect(handed.panes).toBe(HOST.panes);
    expect(HOST).not.toHaveProperty("cast");   // the host's palette is not written
    const overridden = kindPalette({ ...HOST, cast: { token: "a host's own idea", css: "#ff00ff" } } as Palette);
    expect(overridden.cast).toBe(MAT.cast);
  });

  it("a kind's theme reads the cast and it equals the MAT's OWN — in both themes — beside the host's roles and its own", () => {
    for (const name of ["light", "dark"] as const) {
      seen.length = 0;
      const look = looksOf([probe], HOST, themeFrom(name, HOST)).get("probe") as ProbeLook;
      expect(look.cast).toEqual(MAT_COLORS.cast);
      expect(look.cast).toEqual([14 / 255, 26 / 255, 10 / 255]);   // #0e1a0a, the tree-shadow design's `--cast-rgb`
      expect(look.castToken).toBe(MAT.cast.token);
      expect(look.select).toEqual(rgb(HOST.select.css));
      expect(look.name).toBe(name);
      expect(look.glass).toBe(HOST.panes.glass);
      expect(seen).toHaveLength(1);
    }
  });
});
