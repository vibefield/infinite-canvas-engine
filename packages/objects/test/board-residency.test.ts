// THE BOARDS' RESIDENCY (K6a, design-016 §6 · K-L4; board/board-pass.ts) on a fake device — no pixels (the oracle's board
// scenes hold the pool's sampling to the golden byte for byte): the zoom rung a raster is made at, the far-LOD thumbnail cut from
// its chain, the pool a frame binds (on-screen boards only, added within a frame, freed between), the live slot, an eviction
// that keeps the thumbnail, and the step's raise of a board grown on screen.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSlotSet, DEFAULT_GRID, DEFAULT_MAT_CONFIG, MAT_GRID, type SlotContext } from "@ice/desk";
import { BOARD_REST, quadOf, resolveBoard } from "../src/board/board";
import { BOARD_SLOTS, boardRung, type BoardPass } from "../src/board/board-pass";
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

const VIEW = { camX: 0, camY: -2000, zoom: 1, width: 1200, height: 4000, dpr: 2 };
const ctx = (view = VIEW): SlotContext => ({ view, fadeIn: DEFAULT_GRID.fadeIn, cfg: DEFAULT_MAT_CONFIG, frame: undefined, present: undefined, light: THEMES.light.matLight, lit: undefined, select: THEMES.light.select, theme: THEMES.light });
const lamp = lampOf(MAT_GRID.plane);
/** Board `id` in a column at x 600 (on screen), or at x 9000 (in the cull's margin: off screen). */
const board = (id: number, off = false): BoardInstance => {
  const G = resolveBoard({ cx: off ? 9000 : 600, cy: -1800 + id * 360, w: BOARD.spec.width, h: BOARD.spec.height }, BOARD_REST, lamp);
  return { id, geometry: G, surface: [1, 1, 1], metal: [0.5, 0.5, 0.5], quad: quadOf(G) };
};

describe("the zoom rung", () => {
  it("boardRung: two texels a device px as the law's 4 gave at zoom 1 on a 2× screen, a power of two from 1 to the law's 4", () => {
    expect(BOARD.ink.density).toBe(4);
    expect(boardRung(2)).toBe(4);      // zoom 1 at dpr 2: the law's density, as before (the golden's)
    expect(boardRung(1)).toBe(2);      // zoom 0.5: a quarter of the texels
    expect(boardRung(0.75)).toBe(2);
    expect(boardRung(0.5)).toBe(1);    // zoom 0.25: the thumbnail's own density
    expect(boardRung(0.1)).toBe(1);
    expect(boardRung(8)).toBe(4);      // never past the law's
    expect(boardRung(8, 8)).toBe(8);
  });
});

describe("the pool and the thumbnails on a fake device", () => {
  const undo: (() => void)[] = [];
  beforeAll(() => { undo.push(installGpuFlags()); });
  afterAll(() => { for (const u of undo.splice(0)) u(); });

  async function root() {
    const { device } = fakeDevice();
    const mat = await CuttingMat.create(device, "bgra8unorm", matShaders(shaderText(MAT_SHADER_FILES)));
    const set = await createSlotSet(device, "bgra8unorm", mat, deskKinds());
    const kind = must(set.kinds.get(BOARD_KIND)).pass as BoardKind;
    const pass: BoardPass = kind.pass;
    /** Board `id` rastered at `density` and replayed (no strokes): its thumbnail cut. */
    const raster = (id: number, density = 4) => { pass.ensure(id, [BOARD.spec.width, BOARD.spec.height], density); pass.replay(id, []); };
    return { kind, pass, raster };
  }

  it("a board on screen with a raster takes a pool slot — BOARD_SLOTS of them, the rest drawn from their thumbnails; one in the cull's margin takes none", async () => {
    const { kind, pass, raster } = await root();
    const ids = Array.from({ length: BOARD_SLOTS + 1 }, (_, i) => i + 1);
    for (const id of [...ids, 50]) raster(id);
    expect(kind.prepare({} as GPUCommandEncoder, ctx(), [board(50, true), ...ids.map((id) => board(id))])).toBe(BOARD_SLOTS + 2);   // every one drawn (the margin's first: it would take a slot if it could)
    expect(ids.slice(0, BOARD_SLOTS).every((id) => pass.bound(id))).toBe(true);
    expect(pass.bound(BOARD_SLOTS + 1)).toBe(false);   // the pool is full: its thumbnail
    expect(pass.bound(50)).toBe(false);                // off screen: its thumbnail, no slot
  });

  it("the step frees the slots of boards no frame asked for since (their rasters stay, a cache) and nothing when nothing was drawn", async () => {
    const { kind, pass, raster } = await root();
    raster(1); raster(2);
    kind.prepare({} as GPUCommandEncoder, ctx(), [board(1), board(2)]);
    expect(pass.step()).toEqual([]);
    expect([pass.bound(1), pass.bound(2)]).toEqual([true, true]);
    expect(pass.step()).toEqual([]);                    // nothing drawn since: nothing freed
    expect([pass.bound(1), pass.bound(2)]).toEqual([true, true]);
    kind.prepare({} as GPUCommandEncoder, ctx(), [board(1)]);   // board 2 left the screen
    pass.step();
    expect([pass.bound(1), pass.bound(2)]).toEqual([true, false]);
    expect(pass.densityOf(2)).toBe(4);                  // its raster stands, unbound
  });

  it("a board grown on screen past its raster's density is RAISED by the step to its rung — the largest first, BOARD_RASTERS_A_STEP a step", async () => {
    const { kind, pass, raster } = await root();
    raster(1, 1); raster(2, 1); raster(3, 2);
    const far = { ...VIEW, zoom: 0.25, width: 1200, height: 4000, camY: -2000 };
    kind.prepare({} as GPUCommandEncoder, ctx(far), [board(1), board(2), board(3)]);   // zd 0.5: rung 1 — nothing owed but board 3's, finer already
    expect(pass.step()).toEqual([]);
    kind.prepare({} as GPUCommandEncoder, ctx(), [board(1), board(2), board(3)]);      // zd 2: rung 4 for all three
    expect(pass.step()).toEqual([{ id: 1, density: 4 }, { id: 2, density: 4 }]);     // two a step; board 3 waits
  });

  it("an EVICTED board keeps its thumbnail: still drawn, from its layer, unbound; its slot freed", async () => {
    const { kind, pass, raster } = await root();
    raster(1);
    kind.prepare({} as GPUCommandEncoder, ctx(), [board(1)]);
    expect(pass.bound(1)).toBe(true);
    pass.evict(1);
    expect(pass.bound(1)).toBe(false);
    expect(pass.densityOf(1)).toBeNull();
    expect(kind.prepare({} as GPUCommandEncoder, ctx(), [board(1)])).toBe(1);   // drawn: its thumbnail
    // released (it left the desk): nothing to draw it from
    pass.release(1);
    expect(kind.prepare({} as GPUCommandEncoder, ctx(), [board(1)])).toBe(0);
  });

  it("the LIVE slot: the board laid on or drying binds its stroke and wet; the step lets it go once dry", async () => {
    const { kind, pass, raster } = await root();
    raster(1); raster(2);
    pass.commit(2, { mode: "ink", color: [0, 0, 0], tip: "bullet", width: 1 } as never);   // a stroke lands wet on board 2
    kind.prepare({} as GPUCommandEncoder, ctx(), [board(1), board(2)]);
    expect(pass.bound(2)).toBe(true);
    expect(pass.wetting).toBe(true);
    pass.step();    // the frame boundary (the kind's tick)
    pass.dry(60);   // long past WET_HOLD
    kind.prepare({} as GPUCommandEncoder, ctx(), [board(1)]);   // board 2 off screen now, dry
    pass.step();
    expect(pass.bound(2)).toBe(false);
  });
});
