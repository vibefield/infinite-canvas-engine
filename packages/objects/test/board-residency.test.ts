// THE BOARDS' RESIDENCY (K6a, design-016 §6 · K-L4; board/board-pass.ts) on a fake device — no pixels (the oracle's board
// scenes hold the pool's sampling to the golden byte for byte): the zoom rung a raster is made at, the far-LOD thumbnail cut from
// its chain, the pool a frame binds (on-screen boards only, added within a frame, freed between), the live slot, an eviction
// that keeps the thumbnail, and the step's raise of a board grown on screen. K6b: a raster to MAKE (none held, or a density raised)
// is asked of the desk's frame raster queue — a board with no ink drawn BARE meanwhile — and made and replayed in its turn.
import type { Entity } from "@ice/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRasterQueue, createSlotSet, DEFAULT_GRID, DEFAULT_MAT_CONFIG, MAT_GRID, type SlotContext } from "@ice/desk";
import { BOARD_REST, quadOf, resolveBoard } from "../src/board/board";
import { BOARD_SLOTS, boardRung, type BoardPass } from "../src/board/board-pass";
import { BOARD_KIND, type BoardKind, boardKind, type BoardObjectLook, createBoardInk } from "../src/board/kind";
import type { BoardInstance } from "../src/board/layout";
import { BOARD } from "../src/board/theme";
import { deskKinds } from "../src/kinds";
import { lampOf } from "../src/paper/paper";
import { CuttingMat } from "../../desk/src/mat/mat-pass";
import { MAT_SHADER_FILES, matShaders } from "../../desk/src/mat/shaders";
import { shaderText } from "../src/shaders";
import { BOARD_LOOK, MARKERS, PALETTE, THEMES } from "../oracle/fixtures/vf-theme";
import { fakeDevice, installGpuFlags } from "../../desk/test/fake-gpu";
import { must } from "../../desk/test/must";

const VIEW = { camX: 0, camY: -2000, zoom: 1, width: 1200, height: 4000, dpr: 2 };
const E = (n: number) => n as Entity;
const palette = { ...PALETTE.light, board: BOARD_LOOK, markers: MARKERS };
const look = must(boardKind().theme)(palette, "light") as BoardObjectLook;
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
    // released (it left the desk): no ink to draw it from — drawn BARE (K6b: a board with no ink is on the desk, its melamine from the
    // thumbnails' empty layer; before K6b it was not drawn at all — the builder never hands a released board to the pass)
    pass.release(1);
    expect(kind.prepare({} as GPUCommandEncoder, ctx(), [board(1)])).toBe(1);
  });

  /** A board's ink (the kind's local) over the root pass and a frame raster queue (K6b) with no budget to speak of. */
  async function queued() {
    const r = await root();
    const q = createRasterQueue({ budgetMs: 1e9 });
    const remade: Entity[] = [];
    const ink = createBoardInk({ pass: () => r.kind, rasters: q, remake: (e) => { remade.push(e); } });
    return { ...r, q, remade, ink };
  }

  it("K6b: a board come on screen with NO raster ASKS the frame queue — drawn BARE meanwhile; the queue's turn makes it at its rung, replays it, cuts its thumbnail and remakes its record", async () => {
    const { kind, pass, q, remade, ink } = await queued();
    const G = board(1).geometry;
    const id = ink.raster(E(7), G, look, false, 2, 0);   // its record: zd 2 — rung 4
    expect([pass.densityOf(id), ink.replays(), q.size]).toEqual([null, 0, 1]);
    expect(pass.thumbnailBytes).toBe(0);
    expect(kind.prepare({} as GPUCommandEncoder, ctx(), [board(id)])).toBe(1);   // drawn, bare: its melamine from the empty layer
    expect(pass.thumbnailBytes).toBeGreaterThan(0);                              // (the layer taken for it)
    expect(q.drain()).toBe(1);
    expect([pass.densityOf(id), pass.thumbed(id), ink.replays()]).toEqual([4, true, 1]);
    expect(remade).toEqual([E(7)]);
    ink.raster(E(7), G, look, false, 2, 0);                                      // its record again: nothing to make, nothing asked
    expect([q.size, ink.replays()]).toEqual([0, 1]);
    // without a queue (a bare host, the oracle's) the record makes and replays it at once, as before
    const bare = createBoardInk({ pass: () => kind });
    const id2 = bare.raster(E(8), G, look, false, 2, 0);
    expect([pass.densityOf(id2), bare.replays()]).toEqual([4, 1]);
  });

  it("K6b: the queue's order — a board with NO ink before one whose thumbnail stands (evicted), the nearest the view's centre first within each; a raise waits there too, its old raster standing; forget withdraws", async () => {
    const { kind, pass, q, remade, ink } = await queued();
    const G = board(1).geometry;
    const a = ink.raster(E(1), G, look, false, 0.5, 0);   // rung 1
    const b = ink.raster(E(2), G, look, false, 2, 300);   // rung 4 …
    q.drain();
    pass.evict(b);                                        // … and evicted: its thumbnail stands
    expect([pass.densityOf(a), pass.densityOf(b), pass.thumbed(b)]).toEqual([1, null, true]);
    // a density RAISE: on screen at zd 2 it asks 4 — the step raises it, its record asks, the old raster stands until the turn
    kind.prepare({} as GPUCommandEncoder, ctx(), [board(a)]);
    expect(ink.tick?.(16)).toBe(true);
    ink.raster(E(1), G, look, false, 2, 10);
    expect([pass.densityOf(a), q.size]).toEqual([1, 1]);
    // the evicted board at 300 px from the centre, and two never made (nothing to show) at 500 and 100
    remade.length = 0;
    ink.raster(E(2), G, look, false, 2, 300);
    ink.raster(E(3), G, look, false, 2, 500);
    ink.raster(E(4), G, look, false, 2, 100);
    ink.raster(E(5), G, look, false, 2, 50);
    ink.forget?.(E(5));                                  // it left the desk: its ask with it
    expect(q.size).toBe(4);
    q.drain();
    expect(remade).toEqual([E(4), E(3), E(1), E(2)]);   // nothing shown first (100, 500 px), then the stand-ins (10, 300 px)
    expect([pass.densityOf(a), pass.densityOf(b)]).toEqual([4, 4]);
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
