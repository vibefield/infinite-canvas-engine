// The KIND REGISTRY (design-015 §4.2 and §5.2's render half; D2a-render): the ground names no kind.
// Its draw walks the strata in order — pads, sheets, things — and within each the slot's objects in
// paint order, one `drawRange` per RUN of one kind, each kind counting its own records; an object
// with a live inside splits its run (the run through it, the inside, this slot's scissor back, its
// marks over the inside, the rest). `prepareFrame` hands every registered kind of every slot its own
// records, the slot's context and each record's live inside by the kind's OWN index; the pool
// spawns every kind for every slot; the stats count by kind. Then `Ground` itself end to end on a
// fake device, the wall (the composition root imports no kind), and the desk's three kinds: thin
// adapters handing their passes exactly what the ground used to, the whiteboard's ranges over boards
// without a raster. The pixels are the oracle's: every scene byte-identical to D1's.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BOARD_REST, quadOf, resolveBoard } from "../src/board/board";
import type { BoardPass } from "../src/board/board-pass";
import type { BoardInstance } from "../src/board/layout";
import { createSlotSet, type DrawSlot, drawSlot, Ground, type KindExtra, type KindPass, type KindProgram, prepareFrame, type SlotContext, type SlotKind, SlotPool, type SlotSet, STRATA, type StratumName } from "../src/ground";
import { BOARD_KIND, BoardKind, CALENDAR_KIND, CalendarKind, DESK_KINDS, deskKinds, MINIMAT_KIND, MiniMatKind, NOTEBOOK_KIND, NotebookKind, PAPER_KIND, PaperKind, PHOTO_KIND, PhotoKind } from "../src/kinds";
import { DEFAULT_GRID, dressGrid } from "../src/mat/grid";
import { DEFAULT_MAT_CONFIG, STILL_MAT_FRAME } from "../src/mat/layout";
import { MatPass } from "../src/mat/mat-pass";
import { MAT_SHADER_FILES, matShaders } from "../src/mat/shaders";
import type { MiniMatPass } from "../src/minimat/pass";
import { lampOf } from "../src/paper/paper";
import type { PaperPass } from "../src/paper/paper-pass";
import { type ShaderText, shaderText } from "../src/shaders";
import { BOARD, MAT_GRID } from "../src/theme";
import { THEMES } from "../oracle/fixtures/vf-theme";
import { DESK, fakeSlot, loggingKind, scissorPass } from "./fake-kinds";
import { fakeDevice, fakeSurface, installGpuFlags, recordingPass } from "./fake-gpu";
import { must } from "./must";

const SIZE = { w: 2400, h: 1600 };
const FULL = "scissor 0,0,2400,1600";
const VIEW = { camX: 5, camY: 7, zoom: 1, width: 1200, height: 800, dpr: 2 };
/** Every argument the very value expected — identity, not a look-alike. */
function same(actual: readonly unknown[] | undefined, expected: readonly unknown[]): void {
  const a = must(actual, "a recorded call");
  expect(a).toHaveLength(expected.length);
  expected.forEach((x, i) => expect(a[i], `argument ${i}`).toBe(x));
}

describe("the draw: the strata, then runs of one kind (design-015 §4.2)", () => {
  it("a stratum's objects draw in RUNS of one kind, each kind counting its own records: a board between two notes is three runs", () => {
    const log: string[] = [];
    const things: readonly (readonly [string, StratumName])[] = [["paper", "things"], ["board", "things"]];
    expect(drawSlot(scissorPass(log), SIZE, 2, fakeSlot(log, "desk", { kinds: things, objects: ["paper", "board", "paper"] }))).toBe(true);
    expect(log).toEqual([FULL, "desk mat", "desk paper 0..1", "desk board 0..1", "desk paper 1..2"]);
    // a run is as long as its kind lasts; a desk of one kind is one draw
    log.length = 0;
    drawSlot(scissorPass(log), SIZE, 2, fakeSlot(log, "desk", { kinds: things, objects: ["paper", "paper", "board", "board", "board", "paper"] }));
    expect(log).toEqual([FULL, "desk mat", "desk paper 0..2", "desk board 0..3", "desk paper 2..3"]);
    log.length = 0;
    drawSlot(scissorPass(log), SIZE, 2, fakeSlot(log, "desk", { kinds: things, objects: ["paper", "paper", "paper", "paper"] }));
    expect(log).toEqual([FULL, "desk mat", "desk paper 0..4"]);
  });

  it("a sheet with a live inside splits its run: the run through it, the inside over its face, this slot's scissor back, its marks over the inside, then the rest", () => {
    const log: string[] = [];
    const face = { cx: 300, cy: 200, hx: 100, hy: 60, r: 0 };
    const inside = fakeSlot(log, "inside", { kinds: DESK, objects: ["paper"], present: { opacity: 1, portal: face } });
    const desk = fakeSlot(log, "desk", { kinds: DESK, objects: ["minimat", "minimat", "minimat", "minimat", "paper"], children: [{ at: 1, slot: inside }] });
    drawSlot(scissorPass(log), SIZE, 2, desk);
    expect(log).toEqual([
      FULL, "desk mat", "desk minimat 0..2",
      "scissor 399,279,402,242", "inside mat", "inside paper 0..1",
      FULL, "desk minimat over 1", "desk minimat 2..4", "desk paper 0..1",
    ]);
  });

  it("`at` names an OBJECT; the marks over its inside go by its kind's own index — whatever order the list gives the strata", () => {
    const log: string[] = [];
    const face = { cx: 300, cy: 200, hx: 100, hy: 60, r: 0 };
    const inside = fakeSlot(log, "inside", { kinds: DESK, objects: [], present: { opacity: 1, portal: face } });
    // object 2 is the SECOND mini mat (mini mat 1); the note listed first still draws after every sheet
    drawSlot(scissorPass(log), SIZE, 2, fakeSlot(log, "desk", { kinds: DESK, objects: ["paper", "minimat", "minimat", "minimat"], children: [{ at: 2, slot: inside }] }));
    expect(log).toEqual([FULL, "desk mat", "desk minimat 0..2", "scissor 399,279,402,242", "inside mat", FULL, "desk minimat over 1", "desk minimat 2..3", "desk paper 0..1"]);
  });

  it("an empty slot draws its mat (and the layers laid on it) and asks no kind to draw", () => {
    const log: string[] = [];
    drawSlot(scissorPass(log), SIZE, 2, fakeSlot(log, "desk", { kinds: DESK, objects: [] }));
    expect(log).toEqual([FULL, "desk mat"]);
    log.length = 0;
    drawSlot(scissorPass(log), SIZE, 2, fakeSlot(log, "desk", { kinds: DESK, underlays: 2 }));   // no `objects` at all
    expect(log).toEqual([FULL, "desk mat", "desk underlay 0", "desk underlay 1", FULL]);
    log.length = 0;
    drawSlot(scissorPass(log), SIZE, 2, fakeSlot(log, "desk", { kinds: [] }));   // no kind registered
    expect(log).toEqual([FULL, "desk mat"]);
  });

  it("the strata draw in order — a pads kind registered LAST still draws before the sheets, the sheets before the things — whatever the list's order", () => {
    const log: string[] = [];
    const kinds: readonly (readonly [string, StratumName, boolean?])[] = [["minimat", "sheets", true], ["paper", "things"], ["pad", "pads"]];
    drawSlot(scissorPass(log), SIZE, 2, fakeSlot(log, "desk", { kinds, objects: ["paper", "minimat", "pad", "paper"] }));
    // the two notes are one run: nothing of their stratum lies between them
    expect(log).toEqual([FULL, "desk mat", "desk pad 0..1", "desk minimat 0..1", "desk paper 0..2"]);
    expect(STRATA).toEqual(["pads", "sheets", "things"]);
  });

  it("an inside whose `at` names no object draws over them all, with no marks; two insides on one object draw in the order they came, the marks after each", () => {
    const log: string[] = [];
    const face = { cx: 300, cy: 200, hx: 100, hy: 60, r: 0 };
    const lost = fakeSlot(log, "lost", { kinds: DESK, objects: ["paper"], present: { opacity: 1, portal: face } });
    drawSlot(scissorPass(log), SIZE, 2, fakeSlot(log, "desk", { kinds: DESK, objects: ["minimat", "paper"], children: [{ at: 7, slot: lost }] }));
    expect(log).toEqual([FULL, "desk mat", "desk minimat 0..1", "desk paper 0..1", "scissor 399,279,402,242", "lost mat", "lost paper 0..1", FULL]);
    log.length = 0;
    const a = fakeSlot(log, "a", { kinds: DESK, present: { opacity: 1, portal: face } });
    const b = fakeSlot(log, "b", { kinds: DESK, present: { opacity: 1, portal: face } });
    drawSlot(scissorPass(log), SIZE, 2, fakeSlot(log, "desk", { kinds: DESK, objects: ["minimat"], children: [{ at: 0, slot: a }, { at: 0, slot: b }] }));
    expect(log).toEqual([FULL, "desk mat", "desk minimat 0..1", "scissor 399,279,402,242", "a mat", FULL, "desk minimat over 0", "scissor 399,279,402,242", "b mat", FULL, "desk minimat over 0"]);
  });
});

/** A slot set whose mat and kinds record what they are prepared with (spawned slots are `s1`, `s2`, … in acquire order). */
function recordingSet(kinds: readonly (readonly [string, StratumName])[]) {
  type Prepared = { readonly slot: string; readonly kind: string; readonly ctx: SlotContext; readonly records: readonly unknown[]; readonly live: readonly number[] };
  const prepared: Prepared[] = [];
  const tuned: { readonly slot: string; readonly kind: string; readonly by: KindPass }[] = [];
  const mats: { readonly slot: string; readonly fadeIn: unknown; readonly lit: unknown }[] = [];
  let spawned = 0;
  const mat = (slot: string): unknown => ({
    slot,
    prepare: (_e: unknown, _v: unknown, fadeIn: unknown, _c: unknown, _f: unknown, _p: unknown, _l: unknown, lit: unknown) => { mats.push({ slot, fadeIn, lit }); return false; },
    spawn: () => { spawned += 1; return mat(`s${spawned}`); },
  });
  const pass = (slot: string, kind: string): KindPass => ({
    spawn: (m) => pass((m as unknown as { slot: string }).slot, kind),
    tune: (by) => { tuned.push({ slot, kind, by }); },
    prepare: (_e, ctx, records, extra?: KindExtra) => { prepared.push({ slot, kind, ctx, records, live: records.map((_, i) => extra?.live(i) ?? -2) }); return records.length; },
    drawRange: () => {},
    dispose: () => {},
  });
  const root = { mat: mat("root"), kinds: new Map<string, SlotKind>(kinds.map(([name, stratum]): [string, SlotKind] => [name, { name, stratum, pass: pass("root", name) }])) } as unknown as SlotSet;
  return { root, pool: new SlotPool(root), prepared, tuned, mats };
}
const object = (kind: string, id: string) => ({ kind, record: { id } });
const ids = (records: readonly unknown[]) => records.map((r) => (r as { id: string }).id);

describe("prepareFrame, kind by kind", () => {
  const KINDS: readonly (readonly [string, StratumName])[] = [["paper", "things"], ["minimat", "sheets"], ["board", "things"]];
  const face = { cx: 600, cy: 400, hx: 200, hy: 150, r: 0 };

  it("hands every registered kind of every slot its own records in paint order, one context for the slot, and each record's live inside by the kind's OWN index", () => {
    const { root, pool, prepared, mats } = recordingSet(KINDS);
    const grid = { fadeIn: [8, 24] as const, mat: DEFAULT_MAT_CONFIG };
    // object 3 is the second mini mat (mini mat 1): its inside comes in at 0.4
    const inside = { view: VIEW, grid: DEFAULT_GRID, present: { opacity: 1, objects: 0.4, portal: face }, at: 3, objects: [object("paper", "q0")] };
    const p = prepareFrame({} as GPUCommandEncoder, root, pool, {
      view: VIEW, lodZoom: 2, grid, mat: STILL_MAT_FRAME, theme: THEMES.dark,
      objects: [object("paper", "p0"), object("minimat", "m0"), object("paper", "p1"), object("minimat", "m1")], portals: [inside],
    });
    // the inside first (its slot is prepared on the way), then the root; every kind in registration order, a kind with no records too
    expect(prepared.map((c) => `${c.slot} ${c.kind} [${ids(c.records)}] live [${c.live}]`)).toEqual([
      "s1 paper [q0] live [-1]", "s1 minimat [] live []", "s1 board [] live []",
      "root paper [p0,p1] live [-1,-1]", "root minimat [m0,m1] live [-1,0.4]", "root board [] live []",
    ]);
    // one context per slot: the view, the grid's OWN fade-in (the mat's lattice is dressed for lodZoom, the objects never are), its
    // mat config, the clocks, the objects' presence, the Sun or the Moon, the lamp (the root's own at rest), the ring, the theme
    const at = (slot: string) => prepared.filter((c) => c.slot === slot).map((c) => c.ctx);
    const [rootCtx] = at("root");
    const ctx = must(rootCtx);
    expect(at("root").every((c) => c === ctx)).toBe(true);
    same([ctx.view, ctx.fadeIn, ctx.cfg, ctx.frame, ctx.present, ctx.light, ctx.lit, ctx.select, ctx.theme], [VIEW, grid.fadeIn, grid.mat, STILL_MAT_FRAME, undefined, THEMES.dark.matLight, undefined, THEMES.dark.select, THEMES.dark]);
    const dressed = dressGrid(grid, VIEW.zoom, 2).fadeIn;   // the mat's lattice, dressed for lodZoom 2; the kinds are handed the grid's own
    expect(dressed).not.toEqual(grid.fadeIn);
    expect(must(mats.find((m) => m.slot === "root")).fadeIn).toEqual(dressed);
    // the inside: its objects at their presence (its opacity times its objects'), lit by the root's lamp
    const inner = must(at("s1")[0]);
    expect(inner.present).toEqual({ opacity: 0.4, objects: 0.4, portal: face, within: [] });
    expect(inner.lit).toEqual({ a: { x: 5, y: 7, zoom: 1 } });
    // the counts are the ROOT's, every registered kind by name — the inside's note is not the desk's
    expect(p.kinds).toEqual({ paper: 2, minimat: 2, board: 0 });
    expect(p.portals).toBe(1);
  });

  it("a spawned slot's pass takes the root's laws before it prepares, from the root's pass of its kind; the root's never tunes itself", () => {
    const { root, pool, tuned } = recordingSet(KINDS);
    prepareFrame({} as GPUCommandEncoder, root, pool, { view: VIEW, theme: THEMES.light, objects: [object("minimat", "m0")], portals: [{ view: VIEW, grid: DEFAULT_GRID, present: { opacity: 1, portal: face }, at: 0 }] });
    expect(tuned.map((t) => `${t.slot} ${t.kind}`)).toEqual(["s1 paper", "s1 minimat", "s1 board"]);
    for (const t of tuned) expect(t.by).toBe(must(root.kinds.get(t.kind)).pass);
  });

  it("on an ENTER, the departed desk's sheet at `at` is told the arriving desk's presence — by its kind's own index — and its own inside there is never prepared", () => {
    const { root, pool, prepared } = recordingSet(KINDS);
    const departed = { view: VIEW, grid: DEFAULT_GRID, order: "under" as const, at: 2, present: { opacity: 0.8 }, objects: [object("paper", "d0"), object("minimat", "dm0"), object("minimat", "dm1")], portals: [{ view: VIEW, grid: DEFAULT_GRID, present: { opacity: 1, portal: face }, at: 2 }] };
    const p = prepareFrame({} as GPUCommandEncoder, root, pool, { view: VIEW, theme: THEMES.light, present: { opacity: 1, objects: 0.6, portal: face }, objects: [], outgoing: departed });
    expect(p.portals).toBe(0);
    expect(must(prepared.find((c) => c.slot === "s1" && c.kind === "minimat")).live).toEqual([-1, 0.6]);
  });

  it("an object of a kind the ground has not registered is an error, named", () => {
    const { root, pool } = recordingSet(KINDS);
    expect(() => prepareFrame({} as GPUCommandEncoder, root, pool, { view: VIEW, theme: THEMES.light, objects: [object("photo", "x")] })).toThrow(/no kind "photo" is registered \(paper, minimat, board\)/);
  });
});

describe("the registry: the root slot, the pool", () => {
  it("createSlotSet makes every kind on the root's mat, in registration order, keeping its stratum; a nameless, twice-named or stratum-less kind is refused before anything is made", async () => {
    const made: unknown[][] = [];
    const program = (name: string, stratum: StratumName): KindProgram => ({ name, stratum, create: async (d, f, m) => { made.push([name, d, f, m]); return { name } as unknown as KindPass; } });
    const device = { device: true } as unknown as GPUDevice;
    const mat = { mat: true } as unknown as MatPass;
    const set = await createSlotSet(device, "bgra8unorm", mat, [program("paper", "things"), program("minimat", "sheets"), program("pad", "pads")]);
    expect(set.mat).toBe(mat);
    expect([...set.kinds.entries()].map(([key, k]) => `${key}=${k.name}/${k.stratum}/${(k.pass as unknown as { name: string }).name}`)).toEqual(["paper=paper/things/paper", "minimat=minimat/sheets/minimat", "pad=pad/pads/pad"]);
    expect(made.map(([name]) => name)).toEqual(["paper", "minimat", "pad"]);
    for (const [, d, f, m] of made) { expect(d).toBe(device); expect(f).toBe("bgra8unorm"); expect(m).toBe(mat); }
    await expect(createSlotSet(device, "bgra8unorm", mat, [program("paper", "things"), program("paper", "sheets")])).rejects.toThrow(/two kinds are named "paper"/);
    await expect(createSlotSet(device, "bgra8unorm", mat, [program("", "things")])).rejects.toThrow(/needs a name/);
    await expect(createSlotSet(device, "bgra8unorm", mat, [program("hand", "held" as StratumName)])).rejects.toThrow(/lies in no stratum/);
    expect(made).toHaveLength(3);
  });

  it("the pool spawns EVERY registered kind for each slot — on that slot's own mat, in registration order, its stratum kept — and disposes them all", () => {
    const events: string[] = [];
    let mats = 0;
    const kind = (name: string, stratum: StratumName): SlotKind => ({
      name, stratum,
      pass: { spawn: (m: { n: number }) => { events.push(`spawn ${name} on mat ${m.n}`); return { dispose: () => events.push(`dispose ${name} of mat ${m.n}`) }; } } as unknown as KindPass,
    });
    const root = {
      mat: { spawn: () => { mats += 1; const n = mats; return { n, dispose: () => events.push(`dispose mat ${n}`) }; } },
      kinds: new Map([["pad", kind("pad", "pads")], ["minimat", kind("minimat", "sheets")], ["paper", kind("paper", "things")]]),
    } as unknown as SlotSet;
    const pool = new SlotPool(root);
    pool.reset();
    const a = pool.acquire();
    const b = pool.acquire();
    expect([...a.kinds.keys()]).toEqual(["pad", "minimat", "paper"]);
    expect([...b.kinds.values()].map((k) => `${k.name}/${k.stratum}`)).toEqual(["pad/pads", "minimat/sheets", "paper/things"]);
    expect(events).toEqual(["spawn pad on mat 1", "spawn minimat on mat 1", "spawn paper on mat 1", "spawn pad on mat 2", "spawn minimat on mat 2", "spawn paper on mat 2"]);
    pool.reset(); expect(pool.acquire()).toBe(a); expect(events).toHaveLength(6);   // reused: nothing spawned
    events.length = 0;
    pool.dispose();
    expect(events).toEqual(["dispose mat 1", "dispose pad of mat 1", "dispose minimat of mat 1", "dispose paper of mat 1", "dispose mat 2", "dispose pad of mat 2", "dispose minimat of mat 2", "dispose paper of mat 2"]);
    expect(pool.size).toBe(0);
  });

  it("the composition root names no kind: ground.ts imports the engine, the mat, the portal and the kind CONTRACT — no object's pass", () => {
    const src = readFileSync(new URL("../src/ground.ts", import.meta.url), "utf8");
    // every specifier: `from "…"`, a bare `import "…"`, a dynamic `import("…")`
    const from = [...src.matchAll(/\b(?:from|import)\s*\(?\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(from).toContain("./kind");
    expect(from).toContain("./mat/mat-pass");
    for (const f of from) expect(f).not.toMatch(/(^|\/)(paper|minimat|board|book|notebook|calendar|photo|kinds)(\/|$)/);
  });
});

describe("Ground and the desk's passes on a fake device (no pixels: the oracle has those)", () => {
  const undo: (() => void)[] = [];
  beforeAll(() => { undo.push(installGpuFlags()); });
  afterAll(() => { for (const u of undo.splice(0)) u(); });

  it("Ground: made from a registry (the mat first, every kind on it), one frame drawn stratum by stratum in runs, each kind's records counted, every pass disposed", async () => {
    const log: string[] = [];
    const events: string[] = [];
    const { device, queue } = fakeDevice(log);
    const madeOn: unknown[] = [];
    const kindPass = (name: string, slot: string): KindPass => ({
      spawn: () => kindPass(name, "spawned"),
      prepare: (_e, _s, records) => records.length,
      drawRange: (_p, first, end) => log.push(`${name} ${first}..${end}`),
      dispose: () => events.push(`dispose ${slot} ${name}`),
    });
    const program = (name: string, stratum: StratumName): KindProgram => ({ name, stratum, create: async (_d, format, mat) => { madeOn.push(mat); events.push(`make ${name} (${format})`); return kindPass(name, "root"); } });
    // the swap chain is the host's (D2a-world): the composition root takes one made, never a canvas
    const ground = await Ground.create({ device, surface: fakeSurface(2400, 1600), mat: matShaders(shaderText(MAT_SHADER_FILES)), kinds: [program("paper", "things"), program("minimat", "sheets"), program("pad", "pads")] });
    expect(events).toEqual(["make paper (bgra8unorm)", "make minimat (bgra8unorm)", "make pad (bgra8unorm)"]);
    for (const m of madeOn) expect(m).toBe(ground.mat);
    expect(ground.pass("minimat")).toBe(must(ground.root.kinds.get("minimat")).pass);
    expect(ground.pass("photo")).toBeUndefined();
    const stats = ground.render({ view: VIEW, theme: THEMES.light, objects: [object("paper", "p0"), object("minimat", "m0"), object("paper", "p1"), object("pad", "c0")] });
    expect(stats.kinds).toEqual({ paper: 2, minimat: 1, pad: 1 });
    expect(stats.portals).toBe(0); expect(stats.outgoing).toBeNull();
    expect(queue.submits).toBe(1);
    // the frame's one pass: the mat, then the pads, the sheets, the things, and the attachment's scissor last
    expect(log.slice(log.indexOf("pass ground"))).toEqual(["pass ground", FULL, "pipeline mat/mat", "group 0 mat/mat", "draw 3", "pad 0..1", "minimat 0..1", "paper 0..2", FULL, "end"]);
    events.length = 0;
    ground.dispose();
    expect(events).toEqual(["dispose root pad", "dispose root minimat", "dispose root paper"]);
  });

  it("DESK_KINDS: the note, the mini mat, the whiteboard, the photo print, the desk calendar, the notebook — the prototype's prepare order — in their strata; a host's text is read only when the passes are made", async () => {
    expect(DESK_KINDS.map((k) => `${k.name}/${k.stratum}${k.composite ? " composite" : ""}`)).toEqual(["paper/things", "minimat/sheets", "board/things", "photo/things", "calendar/pads composite", "notebook/things composite"]);
    expect([PAPER_KIND, MINIMAT_KIND, BOARD_KIND, PHOTO_KIND, CALENDAR_KIND, NOTEBOOK_KIND]).toEqual(["paper", "minimat", "board", "photo", "calendar", "notebook"]);
    const asked: string[] = [];
    const text: ShaderText = (files) => { asked.push(...Object.values(files)); return shaderText(files); };
    const kinds = deskKinds(text);
    expect(asked).toEqual([]);
    const { device } = fakeDevice();
    const mat = await MatPass.create(device, "bgra8unorm", matShaders(shaderText(MAT_SHADER_FILES)));
    const set = await createSlotSet(device, "bgra8unorm", mat, kinds);
    expect(must(set.kinds.get(PAPER_KIND)).pass).toBeInstanceOf(PaperKind);
    expect(must(set.kinds.get(MINIMAT_KIND)).pass).toBeInstanceOf(MiniMatKind);
    expect(must(set.kinds.get(BOARD_KIND)).pass).toBeInstanceOf(BoardKind);
    expect(must(set.kinds.get(PHOTO_KIND)).pass).toBeInstanceOf(PhotoKind);
    expect(must(set.kinds.get(CALENDAR_KIND)).pass).toBeInstanceOf(CalendarKind);
    expect(must(set.kinds.get(NOTEBOOK_KIND)).pass).toBeInstanceOf(NotebookKind);
    expect(asked).toContain("paper/paper-pass.wgsl"); expect(asked).toContain("minimat/minimat-pass.wgsl"); expect(asked).toContain("board/board-pass.wgsl"); expect(asked).toContain("photo/photo-pass.wgsl");
    expect(asked).toContain("calendar/calendar-pass.wgsl"); expect(asked).toContain("notebook/notebook-pass.wgsl");
  });

  it("the whiteboard's drawRange counts in the list it was handed: a board with no raster draws nothing and shifts nothing; its whole range is draw()'s commands", async () => {
    const { device } = fakeDevice();
    const mat = await MatPass.create(device, "bgra8unorm", matShaders(shaderText(MAT_SHADER_FILES)));
    const set = await createSlotSet(device, "bgra8unorm", mat, deskKinds());
    const kind = must(set.kinds.get(BOARD_KIND)).pass as BoardKind;
    const pass: BoardPass = kind.pass;
    expect(pass.ensure(1, [120, 80])).toBe(true); expect(pass.ensure(3, [120, 80])).toBe(true);
    const lamp = lampOf(MAT_GRID.plane);
    const board = (id: number): BoardInstance => {
      const G = resolveBoard({ cx: id * 600, cy: 0, w: BOARD.spec.width, h: BOARD.spec.height }, BOARD_REST, lamp);
      return { id, geometry: G, surface: [1, 1, 1], metal: [0.5, 0.5, 0.5], quad: quadOf(G) };
    };
    const ctx: SlotContext = { view: VIEW, fadeIn: DEFAULT_GRID.fadeIn, cfg: DEFAULT_MAT_CONFIG, frame: undefined, present: undefined, light: THEMES.light.matLight, lit: undefined, select: THEMES.light.select, theme: THEMES.light };
    expect(kind.prepare({} as GPUCommandEncoder, ctx, [board(1), board(2), board(3)])).toBe(2);   // board 2 has no raster
    const log: string[] = [];
    const rp = recordingPass(log);
    kind.drawRange(rp, 0, 3);
    const whole = ["pipeline board/desk", "group 0 board/slot", "group 1 board/raster 1", "draw 6,1,0,0", "group 1 board/raster 3", "draw 6,1,0,1"];
    expect(log).toEqual(whole);
    log.length = 0; pass.draw(rp); expect(log).toEqual(whole);
    log.length = 0; kind.drawRange(rp, 1, 2); expect(log).toEqual([]);   // the board with no raster: nothing, not even the pipeline
    log.length = 0; kind.drawRange(rp, 1, 3); expect(log).toEqual(["pipeline board/desk", "group 0 board/slot", "group 1 board/raster 3", "draw 6,1,0,1"]);
    log.length = 0; kind.drawRange(rp, 0, 1); expect(log).toEqual(["pipeline board/desk", "group 0 board/slot", "group 1 board/raster 1", "draw 6,1,0,0"]);
    // through the walker: a note laid on the first board splits the boards into two runs — the second draws board 3 alone
    log.length = 0;
    const slot: DrawSlot = {
      mat: { draw: () => log.push("mat") } as unknown as MatPass,
      kinds: new Map([[BOARD_KIND, { name: BOARD_KIND, stratum: "things", pass: kind }], ["paper", loggingKind(log, "desk", "paper", "things")]]),
      objects: [{ kind: BOARD_KIND }, { kind: "paper" }, { kind: BOARD_KIND }, { kind: BOARD_KIND }],
      stats: { k0: 0, fade: 0, wind: false },
    };
    drawSlot(rp, SIZE, 2, slot);
    expect(log).toEqual([FULL, "mat", "pipeline board/desk", "group 0 board/slot", "group 1 board/raster 1", "draw 6,1,0,0", "desk paper 0..1", "pipeline board/desk", "group 0 board/slot", "group 1 board/raster 3", "draw 6,1,0,1"]);
  });
});

describe("the desk's kinds: thin adapters over the moved passes", () => {
  const ctx: SlotContext = {
    view: VIEW, fadeIn: [8, 24], cfg: DEFAULT_MAT_CONFIG, frame: STILL_MAT_FRAME, present: { opacity: 0.5 },
    light: THEMES.dark.matLight, lit: { a: { x: 1, y: 2, zoom: 3 } }, select: THEMES.dark.select, theme: THEMES.dark,
  };

  it("each hands its pass's prepare exactly what the ground handed it before the registry — the note: … the ring, the lamp; the mini mat: … the lamp, the live insides; the whiteboard: … the light, the theme", () => {
    const got: unknown[][] = [];
    const spy = { prepare: (...a: unknown[]) => { got.push(a); return 7; } };
    const records: never[] = [];
    const extra: KindExtra = { live: (i) => i / 2 };
    const enc = {} as GPUCommandEncoder;
    // through the door the ground uses: the KindPass interface
    const paper: KindPass = new PaperKind(spy as unknown as PaperPass);
    const minimat: KindPass = new MiniMatKind(spy as unknown as MiniMatPass);
    const board: KindPass = new BoardKind(spy as unknown as BoardPass);
    // …and, D6, the records' KEYS after them (undefined when the ground hands none — every record is then packed afresh)
    expect(paper.prepare(enc, ctx, records, extra)).toBe(7);
    same(got[0], [ctx.view, ctx.fadeIn, ctx.cfg, ctx.frame, records, ctx.present, ctx.light, ctx.select, ctx.lit, undefined]);
    expect(minimat.prepare(enc, ctx, records, extra)).toBe(7);
    same(got[1], [ctx.view, ctx.fadeIn, ctx.cfg, ctx.frame, records, ctx.present, ctx.light, ctx.select, ctx.lit, extra.live, undefined]);
    minimat.prepare(enc, ctx, records);   // no word from the ground: the instances say
    same(got[2], [ctx.view, ctx.fadeIn, ctx.cfg, ctx.frame, records, ctx.present, ctx.light, ctx.select, ctx.lit, undefined, undefined]);
    expect(board.prepare(enc, ctx, records, extra)).toBe(7);
    same(got[3], [ctx.view, ctx.fadeIn, ctx.cfg, ctx.frame, records, ctx.present, ctx.light, ctx.theme, undefined]);
    const keys = [11, 12];
    paper.prepare(enc, ctx, records, { ...extra, keys });
    same(got[4], [ctx.view, ctx.fadeIn, ctx.cfg, ctx.frame, records, ctx.present, ctx.light, ctx.select, ctx.lit, keys]);
  });

  it("spawn wraps the pass's own spawn; tune takes the root's law (the whiteboard's is its copy); ranges and the mini mat's chips forward", () => {
    const log: unknown[][] = [];
    const pass = (name: string): unknown => ({
      name,
      spawn: (m: unknown) => { log.push(["spawn", name, m]); return pass(`${name}'`); },
      tune: (r: { name: string }) => log.push(["tune", name, r.name]),
      copy: (r: { name: string }) => log.push(["copy", name, r.name]),
      drawRange: (_p: unknown, a: number, b: number) => log.push(["range", name, a, b]),
      drawChips: (_p: unknown, i: number) => log.push(["chips", name, i]),
    });
    const mat = { mat: true } as unknown as MatPass;
    const rp = {} as GPURenderPassEncoder;
    const paper = new PaperKind(pass("paper") as PaperPass);
    const note = paper.spawn(mat);
    expect(note).toBeInstanceOf(PaperKind);
    note.tune(paper); note.drawRange(rp, 2, 5);
    const minimat = new MiniMatKind(pass("minimat") as MiniMatPass);
    const inner = minimat.spawn(mat);
    inner.tune(minimat); inner.drawRange(rp, 0, 1); inner.drawOver(rp, 3);
    const board = new BoardKind(pass("board") as BoardPass);
    const b2 = board.spawn(mat);
    b2.tune(board); b2.drawRange(rp, 1, 4);
    note.tune(minimat as unknown as KindPass<never>);   // a root of another kind teaches nothing
    expect(log).toEqual([
      ["spawn", "paper", mat], ["tune", "paper'", "paper"], ["range", "paper'", 2, 5],
      ["spawn", "minimat", mat], ["tune", "minimat'", "minimat"], ["range", "minimat'", 0, 1], ["chips", "minimat'", 3],
      ["spawn", "board", mat], ["copy", "board'", "board"], ["range", "board'", 1, 4],
    ]);
  });
});
