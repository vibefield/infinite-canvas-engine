// THE BOARD THUMBNAILS' LAYER CAP (K9 R1; board/board-pass.ts `takeLayer`, kit/arrays.ts `LayerArray`) on a fake device. The
// array grows to `device.limits.maxTextureArrayLayers` — 256 by WebGPU's floor, the adapter's own since K9 (engine/device.ts) —
// and past it a board's `cutThumb` had no layer: an inked board on screen with its raster and no pool slot was then SKIPPED,
// not drawn and not counted (the reviewer's probe: cap 4, 12 inked boards → 8 drawn, `dropped` 0), and with no layer for the
// empty one a new board was not drawn even bare. Now: a board whose ink cannot be drawn is drawn BARE and counted in `dropped`;
// a layer is RECLAIMED from the board that can best spare it — one whose raster the budget evicted and that was drawn neither
// this frame nor the last, else one holding its raster (its thumbnail is cut again from it) drawn as long ago. Modelled on
// board-residency.test.ts; the cap is set small on the fake device.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSlotSet, DEFAULT_GRID, DEFAULT_MAT_CONFIG, MAT_GRID, type SlotContext } from "@ice/desk";
import { BOARD_REST, quadOf, resolveBoard } from "../src/board/board";
import { BOARD_SLOTS, type BoardPass } from "../src/board/board-pass";
import { BOARD_KIND, type BoardKind } from "../src/board/kind";
import type { BoardInstance } from "../src/board/layout";
import { BOARD } from "../src/board/theme";
import { deskKinds } from "../src/kinds";
import { lampOf } from "../src/paper/paper";
import { CuttingMat } from "../../desk/src/mat/mat-pass";
import { MAT_SHADER_FILES, matShaders } from "../../desk/src/mat/shaders";
import { shaderText } from "../src/shaders";
import { THEMES } from "../oracle/fixtures/vf-theme";
import { fakeDevice, installGpuFlags } from "../../desk/test/fake-gpu";
import { must } from "../../desk/test/must";

// a tall view so a column of boards is all ON SCREEN
const VIEW = { camX: 0, camY: -4000, zoom: 1, width: 1200, height: 8000, dpr: 2 };
const ctx = (view = VIEW): SlotContext => ({ view, fadeIn: DEFAULT_GRID.fadeIn, cfg: DEFAULT_MAT_CONFIG, frame: undefined, present: undefined, light: THEMES.light.matLight, lit: undefined, select: THEMES.light.select, theme: THEMES.light });
const lamp = lampOf(MAT_GRID.plane);
const board = (id: number): BoardInstance => {
  const G = resolveBoard({ cx: 600, cy: -3600 + id * 360, w: BOARD.spec.width, h: BOARD.spec.height }, BOARD_REST, lamp);
  return { id, geometry: G, surface: [1, 1, 1], metal: [0.5, 0.5, 0.5], quad: quadOf(G) };
};
const ids = (n: number, from = 1) => Array.from({ length: n }, (_, i) => i + from);

async function root(maxLayers: number | undefined) {
  const { device } = fakeDevice();
  if (maxLayers !== undefined) (device as unknown as { limits: Record<string, number> }).limits.maxTextureArrayLayers = maxLayers;
  const mat = await CuttingMat.create(device, "bgra8unorm", matShaders(shaderText(MAT_SHADER_FILES)));
  const set = await createSlotSet(device, "bgra8unorm", mat, deskKinds());
  const kind = must(set.kinds.get(BOARD_KIND)).pass as BoardKind;
  const pass: BoardPass = kind.pass;
  /** Board `id` rastered at `density` and replayed (no strokes): its thumbnail cut. */
  const raster = (id: number, density = 4) => { pass.ensure(id, [BOARD.spec.width, BOARD.spec.height], density); pass.replay(id, []); };
  /** One frame: the boards prepared, the step taken (the frame boundary). */
  const frame = (boards: readonly BoardInstance[]) => { const n = kind.prepare({} as GPUCommandEncoder, ctx(), boards); pass.step(); return n; };
  return { kind, pass, raster, frame };
}

describe("the board thumbnails' layer cap (K9 R1)", () => {
  const undo: (() => void)[] = [];
  beforeAll(() => { undo.push(installGpuFlags()); });
  afterAll(() => { for (const u of undo.splice(0)) u(); });

  it("CONTROL (the device's floor, 256): twelve inked boards on screen — eight from the pool, four from their thumbnails — all drawn, none dropped", async () => {
    const { kind, pass, raster } = await root(undefined);
    for (const id of ids(12)) raster(id);
    expect(ids(12).every((id) => pass.thumbed(id))).toBe(true);
    expect(kind.prepare({} as GPUCommandEncoder, ctx(), ids(12).map(board))).toBe(12);
    expect(pass.dropped).toBe(0);
  });

  it("at the cap (4 layers) with the pool full: the inked boards whose ink has nowhere to be drawn from are SAID — counted in `dropped`, never silently skipped", async () => {
    const { kind, pass, raster } = await root(4);
    for (const id of ids(12)) raster(id);
    expect(ids(4).every((id) => pass.thumbed(id))).toBe(true);   // layers 0..3; every later board holds its raster, so nothing is spared for it
    expect(ids(8, 5).some((id) => pass.thumbed(id))).toBe(false);
    expect(ids(12).every((id) => pass.densityOf(id) === 4)).toBe(true);
    const drawn = kind.prepare({} as GPUCommandEncoder, ctx(), ids(12).map(board));
    expect(drawn).toBe(BOARD_SLOTS);   // the pool's eight
    expect(pass.dropped).toBe(12 - BOARD_SLOTS);   // …and the four with ink the desk cannot show this frame, counted (the defect: 0)
  });

  it("at the cap with no layer left even for the empty one: a board with no ink yet is not drawn — and counted", async () => {
    const { kind, pass, raster } = await root(4);
    for (const id of ids(4)) raster(id);
    expect(kind.prepare({} as GPUCommandEncoder, ctx(), [board(13)])).toBe(0);
    expect(pass.dropped).toBe(1);
    expect(pass.thumbed(13)).toBe(false);
  });

  it("RECLAIM: a board whose raster the budget evicted and that was not drawn lately gives its layer to a board that needs one; the empty layer takes the next; a board still holding its raster is spared last", async () => {
    const { pass, raster, frame } = await root(4);
    for (const id of ids(4)) raster(id);
    expect(frame([board(3), board(4)])).toBe(2);   // 3 and 4 drawn this frame (from the pool); 1 and 2 not
    pass.evict(1); pass.evict(2);                   // the budget took their rasters — their thumbnails were their only ink
    expect(pass.thumbed(1) && pass.thumbed(2)).toBe(true);
    raster(5);                                      // a fifth board's first replay: no layer of the array's own
    expect(pass.thumbed(5)).toBe(true);             // …board 1's, reclaimed (evicted, least recently drawn)
    expect(pass.thumbed(1)).toBe(false);
    expect(pass.thumbed(2) && pass.thumbed(3) && pass.thumbed(4)).toBe(true);
    // board 1 comes back with no raster and no thumbnail: drawn BARE from the empty layer — which reclaims board 2's — until the
    // kind's replay (K6b's honest state, not a dropped draw)
    expect(frame([board(1)])).toBe(1);
    expect(pass.dropped).toBe(0);
    expect(pass.thumbed(2)).toBe(false);
    // no evicted board left to spare: a board HOLDING its raster, not drawn in this frame or the last, gives its layer (5 — never
    // drawn; 3 and 4 were drawn two frames ago, so they too may go, but the least recently drawn goes first)
    raster(6);
    expect(pass.thumbed(6)).toBe(true);
    expect(pass.thumbed(5)).toBe(false);
    // …and board 5 on screen draws its ink from a pool slot all the same (its thumbnail is cut again at its next replay)
    expect(frame([board(5)])).toBe(1);
    expect(pass.dropped).toBe(0);
    expect(pass.bound(5)).toBe(true);
  });

  it("a board drawn this frame or the last is never the victim — the array full and every thumbnail lately drawn leaves a new board without one", async () => {
    const { pass, raster, frame } = await root(4);
    for (const id of ids(4)) raster(id);
    frame(ids(4).map(board));                        // all four drawn
    for (const id of ids(4)) pass.evict(id);         // all four evicted — but drawn last frame
    raster(5);
    expect(pass.thumbed(5)).toBe(false);
    expect(ids(4).every((id) => pass.thumbed(id))).toBe(true);
  });
});
