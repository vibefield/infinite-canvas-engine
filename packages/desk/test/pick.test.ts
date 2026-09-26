// The desk's PICK SOURCE (design-015 §4.5, core's `FramePickSource` — B3b's seam; D2a-world) over
// the builder's mirrors: `undefined` for an object with no geometry (before the first build,
// culled — B9's first blocker: never `outside` for what the source cannot see), the kind's answer
// on the same geometry it drew — a note's `content`, a mini mat's `content` (face) or `frame`
// (border) — and `outside` for a miss; `pad` the widest reach; `live` while a spring moves.
import { createCanvasEngine, type Entity, Viewport } from "@ice/core";
import { describe, expect, it } from "vitest";
import { createDeskBuilder } from "../src/compose/builder";
import { createPickSource } from "../src/compose/pick";
import { minimatKind, paperKind } from "../src/kinds";
import { DEFAULT_GRID } from "../src/mat/grid";
import { MiniMat, Note } from "../src/objects";
import { PALETTE, PENS, SURFACES, THEMES, VINYLS } from "../oracle/fixtures/vf-theme";
import { must } from "./must";

const VP = { width: 1200, height: 800, dpr: 2 };
const CAM = { x: 0, y: 0, zoom: 1 };
const palette = { ...PALETTE.light, papers: { yellow: SURFACES.note }, pens: PENS, vinyls: VINYLS };
const LOOKS = new Map<string, unknown>([["paper", must(paperKind().theme)(palette, "light")], ["minimat", must(minimatKind().theme)(palette, "light")]]);

describe("the pick source (core's FramePickSource over the kinds' mirrors)", () => {
  it("answers undefined before the first build, the part names after, outside on a miss; pad is the widest reach; live follows the springs", () => {
    const ce = createCanvasEngine({ widgets: [Note, MiniMat] });
    ce.docs.create();
    ce.world.setResource(Viewport, { w: VP.width, h: VP.height, dpr: VP.dpr });
    const a = ce.ops.spawnWidget("desk.note", { x: 200, y: 150, props: { seed: 7 }, undoable: false });
    const m = ce.ops.spawnWidget("desk.minimat", { x: 480, y: 160, w: 640, h: 480, undoable: false });
    let now = 0;
    for (let i = 0; i < 3; i++) { now += 16; ce.step(now); }
    const builder = createDeskBuilder(ce.world, { objects: [Note, MiniMat] });
    const src = createPickSource(builder);
    // no geometry yet: the box tier's answer stands (never `outside`)
    expect(src.hit(a, 300, 250)).toBeUndefined();
    expect(src.hit(m, 800, 400)).toBeUndefined();
    expect(src.pad()).toBe(Math.max(paperKind().reach, minimatKind().reach));
    expect(src.live?.()).toBe(false);
    builder.changed();
    builder.build(CAM, VP, 1 / 60, THEMES.light, DEFAULT_GRID, LOOKS);
    // the note: content on the sheet, outside past it (the sheet is tilted by its seed; the centre and the far miss are safe)
    expect(src.hit(a, 300, 250)).toBe("content");
    expect(src.hit(a, 300 + 150, 250)).toBe("outside");
    // the mini mat: its face is content, its printed border frame, past the sheet outside
    expect(src.hit(m, 800, 400)).toBe("content");
    expect(src.hit(m, 800 - 320 + 10, 400)).toBe("frame");
    expect(src.hit(m, 800 - 400, 400)).toBe("outside");
    // an entity the builder never met is no geometry either
    expect(src.hit(99999 as Entity, 0, 0)).toBeUndefined();
    // a selection sets a spring going: the source is live until it settles, so the router re-picks under a still pointer
    ce.ops.setSelection([a]);
    builder.changed();
    builder.build(CAM, VP, 1 / 60, THEMES.light, DEFAULT_GRID, LOOKS);
    expect(src.live?.()).toBe(true);
    // culled: no geometry again
    builder.build({ x: 9000, y: 9000, zoom: 1 }, VP, 1 / 60, THEMES.light, DEFAULT_GRID, LOOKS);
    expect(src.hit(a, 300, 250)).toBeUndefined();
  });
});
