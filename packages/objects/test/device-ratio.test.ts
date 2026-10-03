// THE DEVICE RATIO the six kinds compile (petition I29): every module a reference kind's pipelines are made from — each kind's own
// passes, the layered kinds' composites and the ONE flat card the note, the print and the whiteboard compose (the board's fragment
// spliced in it statement for statement, `BOARD_FRAGMENT`) — converts its device px by the attachment's own ratio, `mat_dpr`'s or
// its own `let dpr`, guarded against an unset block alone (the desk's test/ratio.ts reads and evaluates each). Floored at 1, a 0.25
// capture of a dpr-2 view drew the calendar and the notebook alone. The composed text is what a browser compiles (the generated
// modules, the kit's from the desk); the pixels are the oracle's (`captureCheck`) and rig:capture's.
import { describe, expect, it } from "vitest";
import { cardShaders, planCards } from "../../desk/src/card/card";
import { compose } from "../../desk/src/engine/shader";
import { matDprOf, ratioAt, ratioReads } from "../../desk/test/ratio";
import { boardShaders } from "../src/board/shaders";
import { calendarShaders } from "../src/calendar/shaders";
import { deskKinds } from "../src/kinds";
import { miniMatShaders } from "../src/minimat/shaders";
import { notebookShaders } from "../src/notebook/shaders";
import { paperShaders } from "../src/paper/shaders";
import { photoShaders } from "../src/photo/shaders";
import { shaderText } from "../src/shaders";

const RATIOS = [0.125, 0.25, 0.5, 0.75, 1, 1.5, 2, 3];
const LIMITS = { maxSampledTexturesPerShaderStage: 16, maxSamplersPerShaderStage: 16, maxStorageBuffersPerShaderStage: 8, maxUniformBuffersPerShaderStage: 12, maxBindingsPerBindGroup: 1000 };

/** Every module the six kinds' pipelines compile, by what it draws. */
function modules(): Record<string, string> {
  const calendar = calendarShaders(shaderText);
  const notebook = notebookShaders(shaderText);
  return {
    "the note's pass": compose(paperShaders(shaderText)).code,
    "the print's pass": compose(photoShaders(shaderText)).code,
    "the whiteboard's pass": compose(boardShaders(shaderText).board).code,
    "the mini mat's pass": compose(miniMatShaders(shaderText)).code,
    "the calendar's program": compose(calendar.program).code,
    "the calendar's composite": compose(calendar.composite).code,
    "the notebook's program": compose(notebook.program).code,
    "the notebook's composite": compose(notebook.composite).code,
    "the flat card": compose(cardShaders(planCards(deskKinds(shaderText), LIMITS).kinds)).code,
  };
}

describe("the device ratio the six kinds compile (petition I29)", () => {
  it("every ratio in every module — `mat_dpr` where the kit's light brings it, each `let dpr` a fragment binds, the board's spliced into the card — is the attachment's at every ratio, below 1 too", () => {
    const read: string[] = [];
    for (const [name, code] of Object.entries(modules())) {
      const def = matDprOf(code);
      for (const rd of ratioReads(code)) {
        read.push(`${name} ${rd.where}`);
        for (const r of RATIOS) expect(ratioAt(rd.expr, r, def), `${name} (${rd.where}): ${rd.expr}, at ${r}`).toBe(r);
      }
    }
    // the flat kinds shade by their own (the card by each material's, the board's spliced), the layered kinds lay by the composite's
    expect(read).toEqual(expect.arrayContaining([
      "the note's pass paper_frag", "the print's pass photo_frag", "the whiteboard's pass fs", "the mini mat's pass fs", "the mini mat's pass fs_chips",
      "the flat card paper_frag", "the flat card photo_frag", "the flat card fs", "the calendar's composite fs", "the notebook's composite fs",
    ]));
  });
});
