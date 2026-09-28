// THE FLAT CARDS and the six kinds (K7b, design-016 §6 K7): the note, the print and the whiteboard declare card materials the one
// pipeline composes within WebGPU's default limits; each pass lets the card draw what it can draw from the card's bindings — every
// note; a print while its picture has no detail bound; a board drawn from its thumbnail (no pool raster, not the live board) — and
// keeps the rest. The board's fragment the card splices is its pass entry's, statement for statement. The pixels are the oracle's.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSlotSet, DEFAULT_GRID, DEFAULT_MAT_CONFIG, MAT_GRID, type SlotContext } from "@ice/desk";
import { BOARD_REST, quadOf, resolveBoard } from "../src/board/board";
import { BOARD_KIND, type BoardKind } from "../src/board/kind";
import type { BoardInstance } from "../src/board/layout";
import { BOARD_FRAGMENT, boardFsOf } from "../src/board/shaders";
import { BOARD } from "../src/board/theme";
import { DESK_KINDS, deskKinds } from "../src/kinds";
import { PAPER_KIND, type PaperKind } from "../src/paper/kind";
import { lampOf } from "../src/paper/paper";
import { PHOTO_KIND, type PhotoKind } from "../src/photo/kind";
import { newBody, resolvePhoto } from "../src/photo/photo";
import type { PhotoInstance, Picture } from "../src/photo/photo-pass";
import { THEMES } from "../oracle/fixtures/vf-theme";
import { cardEntry, cardShaders, planCards } from "../../desk/src/card/card";
import { compose } from "../../desk/src/engine/shader";
import { STILL_MAT_FRAME } from "../../desk/src/mat/layout";
import { CuttingMat } from "../../desk/src/mat/mat-pass";
import { MAT_SHADER_FILES, matShaders } from "../../desk/src/mat/shaders";
import { fakeDevice, installGpuFlags } from "../../desk/test/fake-gpu";
import { must } from "../../desk/test/must";
import { shaderText } from "../src/shaders";

const VIEW = { camX: -600, camY: -400, zoom: 1, width: 1200, height: 800, dpr: 2 };
const LIMITS = { maxSampledTexturesPerShaderStage: 16, maxSamplersPerShaderStage: 16, maxStorageBuffersPerShaderStage: 8, maxUniformBuffersPerShaderStage: 12, maxBindingsPerBindGroup: 1000 };
const ctx = (over: Partial<SlotContext> = {}): SlotContext => ({
  view: VIEW, fadeIn: DEFAULT_GRID.fadeIn, cfg: DEFAULT_MAT_CONFIG, frame: STILL_MAT_FRAME, present: undefined,
  light: THEMES.light.matLight, lit: undefined, select: THEMES.light.select, theme: THEMES.light, ...over,
});

describe("the six kinds' card materials (K7b)", () => {
  it("the note, the whiteboard and the print — in the registry's order — are ONE pipeline within WebGPU's default limits; the layered kinds declare none", () => {
    const plan = planCards(deskKinds(shaderText), LIMITS);
    expect(plan.kinds.map((k) => k.name)).toEqual(["paper", "board", "photo"]);
    expect(plan.left).toEqual([]);
    expect(DESK_KINDS.filter((k) => k.card === undefined).map((k) => k.name)).toEqual(["minimat", "calendar", "notebook"]);
    // every binding a name of its own across the three, the composed module's text whole (structs and modules once each)
    const entry = cardEntry(plan.kinds);
    const names = [...entry.matchAll(/@group\(0\) @binding\(\d+\) var(?:<[^>]+>)? (\w+)/g)].map((m) => m[1]);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBe(4 + 6 + 6 + 6);
    const code = compose(cardShaders(plan.kinds)).code;
    for (const s of ["struct Paper ", "struct Photo ", "struct Board ", "fn shade_paper(", "fn shade_photo(", "fn shade_board(", "fn photo_thumb(", "fn board_thumb("]) expect(code.split(s).length - 1, s).toBe(1);
  });

  it("the whiteboard's fragment the card splices IS its pass entry's `fs`, statement for statement (the card runs the very code the pass runs — shade_board through one more function is one LSB off on a pixel a scene)", () => {
    const pass = readFileSync(resolve(import.meta.dirname, "../shaders/board/board-pass.wgsl"), "utf8");
    expect(pass).toContain(`fn fs(in: BoardOut) -> @location(0) vec4f {\n${boardFsOf(BOARD_FRAGMENT)}\n}`);
  });
});

describe("what each pass lets the card draw (K7b) — on a fake device", () => {
  const undo: (() => void)[] = [];
  beforeAll(() => { undo.push(installGpuFlags()); });
  afterAll(() => { for (const u of undo.splice(0)) u(); });
  const set = async () => {
    const { device } = fakeDevice();
    const mat = await CuttingMat.create(device, "bgra8unorm", matShaders(shaderText(MAT_SHADER_FILES)));
    return createSlotSet(device, "bgra8unorm", mat, deskKinds());
  };

  it("the slot set carries the card; every note of the last prepare is the card's — its slot in the store", async () => {
    const s = await set();
    expect(s.card).toBeDefined();
    const kind = must(s.kinds.get(PAPER_KIND)).pass as PaperKind;
    const G = { centre: [0, 0], half: [100, 100], cos: 1, sin: 0, slope: [0, 0], lift: 0, curl: 0, cornerCurl: 0, glue: 0, radius: 4, ring: 0, alpha: 1, lamp: [0, 0, 1], shadow: { sigma: 1, alpha: 0.2, sigmaPerUnit: 0 }, relief: 1 };
    const note = { geometry: G, paper: [1, 1, 0.8], ink: [0, 0, 0] } as unknown as Parameters<PaperKind["prepare"]>[2][number];
    expect(kind.prepare({} as GPUCommandEncoder, ctx(), [note, note], { live: () => -1, keys: [11, 12] })).toBe(2);
    expect([kind.cardSlot(0), kind.cardSlot(1), kind.cardSlot(2)]).toEqual([0, 1, -1]);
  });

  it("a print is the card's while its picture has no detail bound (the card binds no pool); one with its detail bound is the pass's own", async () => {
    const s = await set();
    const kind = must(s.kinds.get(PHOTO_KIND)).pass as PhotoKind;
    const pic = must(kind.pass.picture(new Uint8Array([1, 2, 3, 255]), 1, 1));
    const detailed = { ...pic, slot: 2 } as Picture;
    const print = (x: number, picture: Picture | null): PhotoInstance => ({ geometry: resolvePhoto(newBody(x, 0, 400, 266)), border: 13, picture });
    expect(kind.prepare({} as GPUCommandEncoder, ctx(), [print(0, pic), print(500, detailed), print(1000, null)])).toBe(3);
    expect(kind.cardSlot(0)).toBeGreaterThanOrEqual(0);
    expect(kind.cardSlot(1)).toBe(-1);
    expect(kind.cardSlot(2)).toBeGreaterThanOrEqual(0);
    expect(kind.cardSlot(3)).toBe(-1);   // past the list
  });

  it("a board is the card's while it is drawn from its thumbnails' array — a board with no ink yet (its melamine from the empty layer), or one whose raster has no layer and no pool slot, drawn bare (K9 R1) — and the pass's own once the pool binds its raster", async () => {
    const s = await set();
    const kind = must(s.kinds.get(BOARD_KIND)).pass as BoardKind;
    const lamp = lampOf(MAT_GRID.plane);
    const board = (id: number, cx: number): BoardInstance => {
      const G = resolveBoard({ cx, cy: 0, w: BOARD.spec.width, h: BOARD.spec.height }, BOARD_REST, lamp);
      return { id, geometry: G, surface: [1, 1, 1], metal: [0.5, 0.5, 0.5], quad: quadOf(G) };
    };
    expect(kind.pass.ensure(1, [120, 80])).toBe(true);
    expect(kind.pass.ensure(2, [120, 80])).toBe(true);
    // board 1: a raster, on screen — the pool binds it; board 2: a raster never replayed, off screen (no thumbnail, no slot — drawn
    // BARE from the empty layer, K9 R1); board 3: no ink at all — drawn bare from the thumbnails' empty layer
    expect(kind.prepare({} as GPUCommandEncoder, ctx(), [board(1, 0), board(2, 9000), board(3, 600)])).toBe(3);
    expect(kind.cardSlot(0)).toBe(-1);
    expect(kind.cardSlot(1)).toBeGreaterThanOrEqual(0);
    expect(kind.cardSlot(2)).toBeGreaterThanOrEqual(0);
  });
});
