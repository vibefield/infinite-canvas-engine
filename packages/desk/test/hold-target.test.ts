// THE HAND'S PREPARE IS MARKED (K9 R4; ground.ts `renderHeldFrame`, kind.ts `RenderTarget`): a held frame prepares the desk COPY
// once per stamp (`target: "copy"`, D7) and the HAND — the carried object alone — every frame; the hand's prepare now says so
// (`target: "hand"`), so a kind whose residency asks are per prepare can re-ask what the copy has bound. Before K9 it carried no
// target — a kind could not tell it from the desk's own frame. Fake kinds record what they are prepared for; the rest frame's
// prepare carries no target, as before.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Ground, type GroundFrameInputs } from "../src/ground";
import { HOLD_SHADER_FILES, holdShaders } from "../src/hold/shaders";
import type { KindPass, KindProgram, RenderTarget, SlotContext } from "../src/kind";
import { MAT_SHADER_FILES, matShaders } from "../src/mat/shaders";
import { shaderText } from "../src/shaders";
import { themeFrom } from "../src/theme";
import { DEFAULT_GRID } from "../src/mat/grid";
import { fakeDevice, fakeSurface, installGpuFlags } from "./fake-gpu";

const VIEW = { camX: 0, camY: 0, zoom: 1, width: 1200, height: 800, dpr: 2 };
const THEME = themeFrom("light", { canvasBg: { token: "--vf-canvas-bg", css: "#fafafa" }, select: { token: "--vf-select", css: "#4a90d9" } });

describe("the hand's prepare carries its target (K9 R4)", () => {
  const undo: (() => void)[] = [];
  beforeAll(() => { undo.push(installGpuFlags()); });
  afterAll(() => { for (const u of undo.splice(0)) u(); });

  /** A kind whose pass records, per prepare, the target it was prepared for and how many records it was handed. */
  const recording = (name: string, seen: string[]): KindProgram => {
    const pass = (): KindPass => ({
      spawn: pass,
      prepare: (_e: GPUCommandEncoder, s: SlotContext, records: readonly unknown[]) => { seen.push(`${s.target ?? "frame"}:${records.length}`); return records.length; },
      drawRange: () => {},
      dispose: () => {},
    });
    return { name, stratum: "things", create: async () => pass() };
  };

  it("a held frame: the copy once per stamp (`copy`), the hand every frame (`hand`); the rest frame carries no target", async () => {
    const seen: string[] = [];
    const { device } = fakeDevice();
    const ground = await Ground.create({ device, surface: fakeSurface(2400, 1600), mat: matShaders(shaderText(MAT_SHADER_FILES)), kinds: [recording("thing", seen)], hold: holdShaders(shaderText(HOLD_SHADER_FILES)) });
    const objects = [{ kind: "thing", record: { id: "a" } }, { kind: "thing", record: { id: "b" } }, { kind: "thing", record: { id: "c" } }];
    const held = (stamp: string): GroundFrameInputs => ({
      view: VIEW, theme: THEME, objects,
      held: { object: objects[0] as (typeof objects)[number], view: { ...VIEW, zoom: 2.5 }, grid: DEFAULT_GRID, e: 1, blur: 14, dim: 0.3, filter: { saturate: 1, brightness: 1 }, light: THEME.matLight, stamp },
    });
    ground.render(held("s1"));
    expect(seen).toEqual(["copy:3", "hand:1"]);   // the copy (every object, at the stamp), then the hand (the carried one)
    seen.length = 0;
    ground.render(held("s1"));
    ground.render(held("s1"));
    expect(seen).toEqual(["hand:1", "hand:1"]);   // the stamp stands: the copy is not prepared again — the hand alone is
    seen.length = 0;
    ground.render(held("s2"));
    expect(seen).toEqual(["copy:3", "hand:1"]);
    seen.length = 0;
    ground.render({ view: VIEW, theme: THEME, objects });
    expect(seen).toEqual(["frame:3"]);   // the rest frame, no target (D7's absent = the frame's)
    const targets: RenderTarget[] = ["frame", "copy", "hand"];
    expect(targets).toHaveLength(3);
    ground.dispose();
  });
});
