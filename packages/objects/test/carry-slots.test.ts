// A CARRIED PRINT (OR BOARD) UN-SLOTS NOTHING (K9 R4; photo/pictures.ts `keepSlotted`, board/board-pass.ts `prepare(…, hand)`,
// desk kind.ts `RenderTarget "hand"`). During a carry the desk copy behind the hand is prepared ONCE per stamp (ground.ts
// `renderHeldFrame`) and the hand's frame — the carried object alone — every frame; the kinds' steps saw the hand's asks alone
// and freed every other detail slot and pool slot: the rest frame at the put-down drew them from their thumbnails, the tick
// re-slotted them, the next frame was sharp again — a one-frame softness pop at every put-down; and while un-slotted `keeps`
// was false, so over the cap `trim` could evict a detail on screen behind the hand. Now the hand's prepare re-asks what is
// slotted. On the fake device (no pixels).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRasterBudget, createSlotSet, DEFAULT_GRID, DEFAULT_MAT_CONFIG, MAT_GRID, type SlotContext } from "@ice/desk";
import { BOARD_REST, quadOf, resolveBoard } from "../src/board/board";
import type { BoardPass } from "../src/board/board-pass";
import { BOARD_KIND, type BoardKind } from "../src/board/kind";
import type { BoardInstance } from "../src/board/layout";
import { BOARD } from "../src/board/theme";
import { deskKinds } from "../src/kinds";
import { lampOf } from "../src/paper/paper";
import { PictureStore } from "../src/photo/pictures";
import { CuttingMat } from "../../desk/src/mat/mat-pass";
import { MAT_SHADER_FILES, matShaders } from "../../desk/src/mat/shaders";
import { shaderText } from "../src/shaders";
import { THEMES } from "../oracle/fixtures/vf-theme";
import { fakeDevice, installGpuFlags } from "../../desk/test/fake-gpu";
import { must } from "../../desk/test/must";

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("the pictures' slots under the hand (K9 R4)", () => {
  const undo: (() => void)[] = [];
  beforeAll(() => { undo.push(installGpuFlags()); });
  afterAll(() => { for (const u of undo.splice(0)) u(); });

  async function two() {
    const { device } = fakeDevice();
    const s = new PictureStore(device);
    s.attach(createRasterBudget(1 << 30));
    const raw = { kind: "rgba", bytes: new Uint8Array(4), width: 4096, height: 3072 } as const;
    const a = must(s.make(raw, async () => raw));
    const b = must(s.make(raw, async () => raw));
    // both large on screen: fetched, landed, slotted
    s.ask(a, 0.3); s.ask(b, 0.3); s.step(); await settle();
    s.ask(a, 0.3); s.ask(b, 0.3); s.step();
    expect([a.slot, b.slot].every((x) => x >= 0)).toBe(true);
    return { s, a, b };
  }

  it("CONTROL — a desk frame asking for A alone frees B's slot (B left the screen)", async () => {
    const { s, a, b } = await two();
    s.ask(a, 0.3);
    s.step();
    expect(a.slot).toBeGreaterThanOrEqual(0);
    expect(b.slot).toBe(-1);
    expect(s.keeps(`detail ${b.id}`)).toBe(false);
  });

  it("the HAND's frame asking for A alone keeps B slotted — `keepSlotted` re-asks every bound picture at the lod it was granted; B's tier does not turn", async () => {
    const { s, a, b } = await two();
    const tier = b.tier;
    for (let frame = 0; frame < 3; frame++) {
      s.ask(a, 0.3);   // the carried print
      s.keepSlotted();
      expect(s.step()).toBe(false);   // nothing moved
    }
    expect(a.slot).toBeGreaterThanOrEqual(0);
    expect(b.slot).toBeGreaterThanOrEqual(0);
    expect(b.tier).toBe(tier);
    expect(s.keeps(`detail ${b.id}`)).toBe(true);   // and the budget keeps it — a detail behind the hand is never the LRU's
  });

  it("keepSlotted asks at the lod GRANTED, so the step neither raises nor cuts what the hand did not touch", async () => {
    const { s, a, b } = await two();
    expect(s.stats().details).toBe(2);
    s.ask(a, 0.3);
    s.keepSlotted();
    s.step();
    expect(s.stats()).toMatchObject({ details: 2, cut: 0, building: 0 });
    expect(b.detail?.base).toBe(0);
  });
});

describe("the boards' pool under the hand (K9 R4)", () => {
  const undo: (() => void)[] = [];
  beforeAll(() => { undo.push(installGpuFlags()); });
  afterAll(() => { for (const u of undo.splice(0)) u(); });
  const VIEW = { camX: 0, camY: -2000, zoom: 1, width: 1200, height: 4000, dpr: 2 };
  const ctx = (hand: boolean): SlotContext => ({ view: VIEW, fadeIn: DEFAULT_GRID.fadeIn, cfg: DEFAULT_MAT_CONFIG, frame: undefined, present: undefined, light: THEMES.light.matLight, lit: undefined, select: THEMES.light.select, theme: THEMES.light, ...(hand ? { target: "hand" as const } : {}) });
  const lamp = lampOf(MAT_GRID.plane);
  const board = (id: number): BoardInstance => {
    const G = resolveBoard({ cx: 600, cy: -1800 + id * 360, w: BOARD.spec.width, h: BOARD.spec.height }, BOARD_REST, lamp);
    return { id, geometry: G, surface: [1, 1, 1], metal: [0.5, 0.5, 0.5], quad: quadOf(G) };
  };

  async function two() {
    const { device } = fakeDevice();
    const mat = await CuttingMat.create(device, "bgra8unorm", matShaders(shaderText(MAT_SHADER_FILES)));
    const set = await createSlotSet(device, "bgra8unorm", mat, deskKinds());
    const kind = must(set.kinds.get(BOARD_KIND)).pass as BoardKind;
    const pass: BoardPass = kind.pass;
    for (const id of [1, 2]) { pass.ensure(id, [BOARD.spec.width, BOARD.spec.height], 4); pass.replay(id, []); }
    expect(kind.prepare({} as GPUCommandEncoder, ctx(false), [board(1), board(2)])).toBe(2);   // the desk (the copy): both bound
    pass.step();
    expect(pass.bound(1) && pass.bound(2)).toBe(true);
    return { kind, pass };
  }

  it("CONTROL — a desk frame with board 1 alone frees board 2's pool slot", async () => {
    const { kind, pass } = await two();
    kind.prepare({} as GPUCommandEncoder, ctx(false), [board(1)]);
    expect(pass.step()).toEqual([]);
    expect(pass.bound(2)).toBe(false);
  });

  it("the HAND's frame (`target: \"hand\"`) with board 1 alone keeps board 2 bound — re-asked at its raster's own density, so nothing is raised", async () => {
    const { kind, pass } = await two();
    for (let frame = 0; frame < 3; frame++) {
      kind.prepare({} as GPUCommandEncoder, ctx(true), [board(1)]);
      expect(pass.step()).toEqual([]);   // no raise
    }
    expect(pass.bound(1) && pass.bound(2)).toBe(true);
  });
});
