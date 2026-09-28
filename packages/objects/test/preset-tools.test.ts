// @vitest-environment node
// K9 S8: core's `select` answers `v`, but the desk canvas allows `desk.select` and pan alone — so on the desk `v` threw ("ops.setTool —
// tool "select" is not legal in the current CanvasType"), `c` too, and `h` left it in pan with no letter back. The desk's select tool
// carries the letter itself; the react keymap binds a letter only to a tool legal in the current canvas (react's facade.test.ts).
import { tools } from "@ice/core";
import { describe, expect, it } from "vitest";
import { DESK_TOOLS, DeskCanvas, deskSelect } from "../src";

describe("the desk's tools (preset.ts)", () => {
  it("`desk.select` answers `v` — core's select's letter, on the tool the desk canvas actually allows; core's select stays compiled and never legal there", () => {
    expect(deskSelect.shortcut).toBe("v");
    expect(tools.get("select")?.shortcut).toBe("v");
    expect(DESK_TOOLS.map((t) => t.id)).toEqual(["select", "desk.select", "pan"]);
    expect(DeskCanvas.presentation?.tools?.allowed.map((t) => t.id)).toEqual(["desk.select", "pan"]);
    expect(DeskCanvas.presentation?.tools?.default.id).toBe("desk.select");
  });
});
