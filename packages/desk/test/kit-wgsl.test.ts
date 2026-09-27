// K4a (design-016 §5): the kit's shared WGSL BY NAME. A kind composes the kit's pieces before its own — the slot's view
// block, the portal chain, the card's primitives, the mat's light, the rulers' glyphs — by asking for them, never by
// listing the mat's files in its own map; the pieces come in the kit's one order, each once, and a misspelt name throws.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { compose } from "../src/engine/shader";
import { defineStruct } from "../src/engine/struct";
import { KIT_WGSL_FILES, type KitWgslName, kitWgsl, type ShaderText } from "../src/kit/wgsl";
import { MatUniforms } from "../src/mat/layout";
import { BOARD_SHADER_FILES, boardShaders } from "../src/board/shaders";
import { MINIMAT_SHADER_FILES, miniMatShaders } from "../src/minimat/shaders";
import { PAPER_SHADER_FILES, paperShaders } from "../src/paper/shaders";
import { PHOTO_SHADER_FILES, photoShaders } from "../src/photo/shaders";
import { CALENDAR_SHADER_FILES, calendarShaders } from "../src/calendar/shaders";
import { LAYER_COMPOSITE_FILE } from "../src/kit/layer";
import { NOTEBOOK_SHADER_FILES, notebookShaders } from "../src/notebook/shaders";

const here = resolve(import.meta.dirname, "..", "shaders");
/** The Node oracle's host text: the .wgsl files on disk, by a map's keys. */
const disk: ShaderText = (files) => Object.fromEntries(Object.entries(files).map(([k, f]) => [k, readFileSync(join(here, f), "utf8")])) as never;
const Own = defineStruct("Own", [["x", "vec4f"]] as const);
const own = { structs: [Own], modules: [{ label: "own.wgsl", text: "fn own_fn() {}" }], entry: { label: "own-pass.wgsl", text: "@fragment fn fs() {}" } };
const labels = (names: readonly KitWgslName[]) => (kitWgsl(names, own, disk).modules ?? []).map((m) => m.label);

describe("the kit's WGSL by name (K4a)", () => {
  it("brings the named pieces before the kind's own: the view block's struct first, then the modules labelled by their files", () => {
    const c = kitWgsl(["view", "portal", "sdf", "light"], own, disk);
    expect(c.structs).toEqual([MatUniforms, Own]);
    expect((c.modules ?? []).map((m) => m.label)).toEqual(["portal.wgsl", "primitives.wgsl", "mat/mat.wgsl", "own.wgsl"]);
    expect(c.entry).toBe(own.entry);
    // …the text is the host's, whole
    expect(c.modules?.[2]?.text).toBe(readFileSync(join(here, "mat/mat.wgsl"), "utf8"));
    expect(() => compose(c)).not.toThrow();   // every piece is pure: no binding hides in a module
  });

  it("composes in the kit's one order whatever the order asked, each piece once whatever its names", () => {
    expect(labels(["light", "sdf", "portal"])).toEqual(["portal.wgsl", "primitives.wgsl", "mat/mat.wgsl", "own.wgsl"]);
    expect(labels(["gobo", "night", "lamp", "noise", "light"])).toEqual(["mat/mat.wgsl", "own.wgsl"]);
    expect(labels(["ruler", "light"])).toEqual(["mat/mat.wgsl", "mat/ruler.wgsl", "own.wgsl"]);
    expect(kitWgsl([], own, disk).structs).toEqual([Own]);
  });

  it("refuses a name it does not have", () => {
    expect(() => kitWgsl(["lights" as KitWgslName], own, disk)).toThrow(/no piece "lights"/);
  });

  it("names a file the generated module and the disk both hold for every module piece", () => {
    for (const f of Object.values(KIT_WGSL_FILES)) expect(readFileSync(join(here, f as string), "utf8").length).toBeGreaterThan(0);
  });

  it("the flat kinds ask the kit and list only their own files: their programs open with the view block and the kit's modules", () => {
    const kit = ["portal.wgsl", "primitives.wgsl", "mat/mat.wgsl"];
    for (const c of [paperShaders(disk), photoShaders(disk), miniMatShaders(disk), boardShaders(disk).board]) {
      expect(c.structs?.[0]).toBe(MatUniforms);
      expect((c.modules ?? []).slice(0, 3).map((m) => m.label)).toEqual(kit);
      expect(() => compose(c)).not.toThrow();
    }
    expect((boardShaders(disk).stamp.modules ?? []).map((m) => m.label)).toEqual(["primitives.wgsl", "board/felt.wgsl"]);
  });

  it("a kind's programs compose only its own WGSL (shaders/<kind>/) and the kit's — no kind reads another's shader file (K-L1)", () => {
    const kit = new Set<string>([...Object.values(KIT_WGSL_FILES), LAYER_COMPOSITE_FILE].filter((f): f is string => f !== undefined));
    const programs: Record<string, readonly { readonly modules?: readonly { readonly label: string }[]; readonly entry: { readonly label: string } }[]> = {
      paper: [paperShaders(disk)],
      photo: [photoShaders(disk)],
      minimat: [miniMatShaders(disk)],
      board: Object.values(boardShaders(disk)),
      notebook: Object.values(notebookShaders(disk)),
      calendar: Object.values(calendarShaders(disk)),
    };
    const strays: string[] = [];
    for (const [k, list] of Object.entries(programs)) {
      for (const c of list) for (const part of [...(c.modules ?? []), c.entry]) if (!kit.has(part.label) && !part.label.startsWith(`${k}/`)) strays.push(`${k}: ${part.label}`);
    }
    // …and the files each kind's own map reads are its own folder's (a part is labelled by hand: the map is what is read)
    const maps: Record<string, Readonly<Record<string, string>>> = { paper: PAPER_SHADER_FILES, photo: PHOTO_SHADER_FILES, minimat: MINIMAT_SHADER_FILES, board: BOARD_SHADER_FILES, notebook: NOTEBOOK_SHADER_FILES, calendar: CALENDAR_SHADER_FILES };
    for (const [k, map] of Object.entries(maps)) for (const f of Object.values(map)) if (!f.startsWith(`${k}/`)) strays.push(`${k} reads ${f}`);
    expect(strays).toEqual([]);
  });
});

