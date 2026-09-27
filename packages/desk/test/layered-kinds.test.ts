// The NOTEBOOK and the DESK CALENDAR as kinds (design-015 D3r-b): the two LAYERED kinds (kinds/layer.ts). Each pass
// renders every one of its objects into a target of its own in `prepare` — recorded into the frame's encoder — and its
// one run lays that target over the frame (`KindProgram.composite`: the ground draws it as ONE range after every other
// run of its stratum). ROOT ONLY (D-D18): a spawned slot's pass draws nothing. On a fake device — no pixels (those are the
// oracle's `book-*` / `pad-*` scenes and apps/desk's rigs).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { padFrame } from "../src/calendar/pad";
import { CALENDAR } from "../src/calendar/law";
import type { CalendarDraw, CalendarPass } from "../src/calendar/pass";
import { tileGrid } from "../src/calendar/tiles";
import { beginPass } from "../src/engine/target";
import { createSlotSet, drawFrame, drawSlot, Ground, type GroundFrameInputs, type KindPass, prepareFrame, type SlotContext, SlotPool } from "../src/ground";
import { CALENDAR_KIND, CalendarKind, calendarKind, calendarProgram, deskKinds, NOTEBOOK_KIND, NotebookKind, notebookKind, notebookProgram, paperKind } from "../src/kinds";
import { attachmentOf, clip } from "../src/kinds/layer";
import { DEFAULT_GRID } from "../src/mat/grid";
import { DEFAULT_MAT_CONFIG, HERO_MATRIX, STILL_MAT_FRAME } from "../src/mat/layout";
import { CuttingMat } from "../src/mat/mat-pass";
import { MAT_SHADER_FILES, matShaders } from "../src/mat/shaders";
import type { MatPass as MatPassType } from "../src/kit/view";
import { eyeOf } from "../src/notebook/eye";
import { NOTEBOOK } from "../src/notebook/law";
import type { NotebookDraw, NotebookPass } from "../src/notebook/pass";
import { scissorOf } from "../src/nav/portal";
import { MAX_PAPERS } from "../src/paper/layout";
import { DEFAULT_PAPER_LAW, lampOf, resolvePaper } from "../src/paper/paper";
import { shaderText } from "../src/shaders";
import { MAT_COLORS, MAT_GRID } from "../src/theme";
import { calendarDraw, notebookDraw } from "../oracle/frame.mjs";
import { CALENDAR_LOOK, notebookRuleInk, pen, surface, THEMES } from "../oracle/fixtures/vf-theme";
import { fakeDevice, fakeSurface, installGpuFlags, recordingPass } from "./fake-gpu";
import { fakeSlot } from "./fake-kinds";
import { must } from "./must";

const VIEW = { camX: 5, camY: 7, zoom: 1.3, width: 1200, height: 800, dpr: 2 };
const ctx = (over: Partial<SlotContext> = {}): SlotContext => ({
  view: VIEW, fadeIn: DEFAULT_GRID.fadeIn, cfg: DEFAULT_MAT_CONFIG, frame: STILL_MAT_FRAME, present: undefined,
  light: THEMES.light.matLight, lit: undefined, select: THEMES.light.select, theme: THEMES.light, ...over,
});
const FULL: readonly [number, number, number, number] = [0, 0, 2400, 1600];
/** A frame encoder that records only what a pass asks of it (the layered kinds hand it to their pass's `layer`). */
const ENCODER = { label: "the frame's encoder" } as unknown as GPUCommandEncoder;

/** A pass the adapters drive, recording every call: `prepare` answers `n`, `layer` answers `laid` and leaves `box` as the screen box. */
function spyPass(calls: unknown[][], n: number, box: readonly [number, number, number, number] | null, laid = box !== null) {
  return {
    prepare: (...a: unknown[]) => { calls.push(["prepare", ...a]); return n; },
    layer: (...a: unknown[]) => { calls.push(["layer", ...a]); return laid; },
    composite: (_p: unknown, scissor: unknown) => calls.push(["composite", scissor]),
    get screenBox() { return box; },
    dispose: () => calls.push(["dispose"]),
  };
}

describe("the notebook and the desk calendar: two layered kinds in the registry", () => {
  let undo: () => void = () => {};
  beforeAll(() => { undo = installGpuFlags(); });
  afterAll(() => undo());

  it("notebookProgram / calendarProgram: `notebook` in things, `calendar` in pads, each a COMPOSITE; their passes made on the root's mat from the host's text", async () => {
    const nb = notebookProgram(shaderText);
    const cal = calendarProgram(shaderText);
    expect([nb.name, nb.stratum, nb.composite, NOTEBOOK_KIND]).toEqual(["notebook", "things", true, "notebook"]);
    expect([cal.name, cal.stratum, cal.composite, CALENDAR_KIND]).toEqual(["calendar", "pads", true, "calendar"]);
    const { device } = fakeDevice();
    const mat = await CuttingMat.create(device, "bgra8unorm", matShaders(shaderText(MAT_SHADER_FILES)));
    const book = await nb.create(device, "bgra8unorm", mat);
    const pad = await cal.create(device, "bgra8unorm", mat);
    expect(book).toBeInstanceOf(NotebookKind); expect(pad).toBeInstanceOf(CalendarKind);
    expect((book as NotebookKind).pass?.name).toBe("notebook/books");
    expect((pad as CalendarKind).pass?.name).toBe("calendar/pads");
  });

  it("ROOT ONLY: a spawned slot's pass holds no pass, prepares nothing, records nothing and draws nothing — through the pool too, the composite flag carried", async () => {
    const calls: unknown[][] = [];
    const mat = {} as MatPassType;
    for (const root of [new NotebookKind(spyPass(calls, 3, [0, 0, 10, 10]) as unknown as NotebookPass), new CalendarKind(spyPass(calls, 3, [0, 0, 10, 10]) as unknown as CalendarPass)] as const) {
      const spawned = root.spawn(mat);
      expect(spawned).toBeInstanceOf(root.constructor);
      expect(spawned.pass).toBeNull();
      expect(spawned.prepare(ENCODER, ctx(), [{} as never, {} as never])).toBe(0);
      const log: string[] = [];
      spawned.drawRange(recordingPass(log), 0, 2);
      spawned.dispose();
      expect(log).toEqual([]);
    }
    expect(calls).toEqual([]);   // the root's pass was never asked a thing on the spawned slots' behalf
    // the ground's own pool: every slot beyond the root spawns them inert, and keeps their flag
    const { device } = fakeDevice();
    const real = await CuttingMat.create(device, "bgra8unorm", matShaders(shaderText(MAT_SHADER_FILES)));
    const set = await createSlotSet(device, "bgra8unorm", real, deskKinds());
    const pool = new SlotPool(set);
    const slot = pool.acquire();
    for (const name of [NOTEBOOK_KIND, CALENDAR_KIND]) {
      const rootKind = must(set.kinds.get(name));
      const spawnedKind = must(slot.kinds.get(name));
      expect(rootKind.composite).toBe(true); expect(spawnedKind.composite).toBe(true);
      expect((rootKind.pass as NotebookKind | CalendarKind).pass).not.toBeNull();
      expect((spawnedKind.pass as NotebookKind | CalendarKind).pass).toBeNull();
    }
    pool.dispose();
  });

  it("the notebook's adapter hands its pass exactly what the lab's `drawBooks` did: the slot's camera, grid, clocks and light, the desk eye over the slot's view, the law, the cast, the ring's colour, the ruling's ink", () => {
    const calls: unknown[][] = [];
    const kind = new NotebookKind(spyPass(calls, 2, null) as unknown as NotebookPass);
    kind.ruleInk = notebookRuleInk();
    const s = ctx({ light: THEMES.dark.matLight, select: THEMES.dark.select, theme: THEMES.dark });
    const records = [{} as NotebookDraw, {} as NotebookDraw];
    expect(kind.prepare(ENCODER, s, records)).toBe(2);
    const [name, view, fadeIn, cfg, frame, light, eye, law, colours, handed] = must(calls[0]);
    expect(name).toBe("prepare");
    for (const [a, b] of [[view, s.view], [fadeIn, s.fadeIn], [cfg, s.cfg], [frame, s.frame], [light, s.light], [law, NOTEBOOK], [handed, records]] as const) expect(a).toBe(b);
    expect(eye).toEqual(eyeOf({ x: VIEW.camX, y: VIEW.camY, zoom: VIEW.zoom }, { width: VIEW.width, height: VIEW.height }, NOTEBOOK.eye));
    expect(colours).toEqual({ cast: MAT_COLORS.cast, select: s.select, ruleInk: kind.ruleInk });
    expect((colours as { cast: unknown }).cast).toBe(MAT_COLORS.cast);
    // the product's colour is the host's to give: a book without it is a host's mistake, named; no book asks nothing
    const bare = new NotebookKind(spyPass([], 1, null) as unknown as NotebookPass);
    expect(() => bare.prepare(ENCODER, s, records)).toThrow(/ruling's ink is the host's/);
    expect(bare.prepare(ENCODER, s, [])).toBe(1);
  });

  it("the calendar's adapter hands its pass exactly what the lab's `renderLayer` did: … the desk eye, the law, the tile grid of the law's sheet, the cast, the ring's colour, the print's presences", () => {
    const calls: unknown[][] = [];
    const kind = new CalendarKind(spyPass(calls, 1, null) as unknown as CalendarPass);
    kind.alpha = CALENDAR_LOOK.alpha;
    const s = ctx();
    const records = [{} as CalendarDraw];
    expect(kind.prepare(ENCODER, s, records)).toBe(1);
    const [name, view, fadeIn, cfg, frame, light, eye, law, grid, colours, handed] = must(calls[0]);
    expect(name).toBe("prepare");
    for (const [a, b] of [[view, s.view], [fadeIn, s.fadeIn], [cfg, s.cfg], [frame, s.frame], [light, s.light], [law, CALENDAR], [handed, records]] as const) expect(a).toBe(b);
    expect(eye).toEqual(eyeOf({ x: VIEW.camX, y: VIEW.camY, zoom: VIEW.zoom }, { width: VIEW.width, height: VIEW.height }, CALENDAR.eye));
    const F = padFrame(CALENDAR);
    expect(grid).toEqual(tileGrid(F.W, F.H));
    expect(grid).toBe(kind.grid);   // the grid the host's `writeTable` names — made once per law
    expect(colours).toEqual({ cast: MAT_COLORS.cast, select: s.select, alpha: CALENDAR_LOOK.alpha });
    const bare = new CalendarKind(spyPass([], 1, null) as unknown as CalendarPass);
    expect(() => bare.prepare(ENCODER, s, records)).toThrow(/presences are the host's look/);
    expect(bare.prepare(ENCODER, s, [])).toBe(1);
  });

  it("the layer is recorded into the FRAME's encoder once its pass prepared something, at the attachment the view names; the run lays it ONCE over the whole range, inside the slot's scissor, and gives the scissor back", () => {
    for (const make of [(p: unknown) => { const k = new NotebookKind(p as NotebookPass); k.ruleInk = notebookRuleInk(); return k; }, (p: unknown) => { const k = new CalendarKind(p as CalendarPass); k.alpha = CALENDAR_LOOK.alpha; return k; }]) {
      const calls: unknown[][] = [];
      const kind: KindPass = make(spyPass(calls, 2, [100, 200, 300, 400]));
      expect(kind.prepare(ENCODER, ctx(), [{}, {}])).toBe(2);
      expect(calls.map((c) => c[0])).toEqual(["prepare", "layer"]);
      const [, encoder, size, dpr] = must(calls[1]);
      expect(encoder).toBe(ENCODER);
      expect(size).toEqual({ w: 2400, h: 1600 });
      expect(dpr).toBe(2);
      calls.length = 0;
      const log: string[] = [];
      const rp = recordingPass(log);
      kind.drawRange(rp, 0, 1); kind.drawRange(rp, 1, 2);   // a part of the range: one layer holds them all — nothing
      expect(calls).toEqual([]);
      kind.drawRange(rp, 0, 2);
      expect(calls).toEqual([["composite", [100, 200, 300, 400]]]);
      expect(log).toEqual([`scissor ${FULL.join(",")}`]);   // the slot's scissor given back
      // a slot seen through a face (its chain): laid only where the face shows, and the face's scissor given back
      calls.length = 0; log.length = 0;
      const portal = { cx: 250, cy: 300, hx: 100, hy: 60, r: 8 };
      const present = { opacity: 1, portal };
      expect(kind.prepare(ENCODER, ctx({ present }), [{}, {}])).toBe(2);
      calls.length = 0;
      kind.drawRange(rp, 0, 2);
      const within = scissorOf(present, 2, { w: 2400, h: 1600 });
      expect(calls).toEqual([["composite", clip([100, 200, 300, 400], within)]]);
      expect(log).toEqual([`scissor ${within.join(",")}`]);
      // nothing prepared: no layer recorded, nothing laid
      calls.length = 0; log.length = 0;
      const idle: KindPass = make(spyPass(calls, 0, null));
      expect(idle.prepare(ENCODER, ctx(), [])).toBe(0);
      idle.drawRange(rp, 0, 0);
      expect(calls.map((c) => c[0])).toEqual(["prepare"]);
      expect(log).toEqual([]);
    }
    // the attachment every host sizes its canvas to (surface.fit, the reflector's resize, the oracle's target): max(1, round(css · dpr))
    expect(attachmentOf({ ...VIEW, width: 1001, height: 667, dpr: 1.5 })).toEqual({ w: Math.round(1001 * 1.5), h: Math.round(667 * 1.5) });
    expect(attachmentOf({ ...VIEW, width: 0, height: 0, dpr: 2 })).toEqual({ w: 1, h: 1 });
  });

  it("the COMPOSITE run: a composite kind draws ONE range over all its records after every other run of its stratum, whatever the order — the others' runs close over it", () => {
    const log: string[] = [];
    const kinds = [["minimat", "sheets"], ["paper", "things"], ["board", "things"], ["calendar", "pads", false, true], ["notebook", "things", false, true]] as const;
    // a notebook between two notes, another over a board, a pad listed last: the notes are ONE run, the books one range after the board
    const objects = ["minimat", "notebook", "paper", "notebook", "paper", "board", "notebook", "calendar"];
    expect(drawSlot(recordingPass(log), { w: 2400, h: 1600 }, 2, fakeSlot(log, "desk", { kinds, objects }))).toBe(true);
    expect(log).toEqual([`scissor ${FULL.join(",")}`, "desk mat", "desk calendar 0..1", "desk minimat 0..1", "desk paper 0..2", "desk board 0..1", "desk notebook 0..3"]);
    // the same desk in another order draws the same: a composite kind is its stratum's last run, never an interleave
    log.length = 0;
    drawSlot(recordingPass(log), { w: 2400, h: 1600 }, 2, fakeSlot(log, "desk", { kinds, objects: ["calendar", "notebook", "notebook", "notebook", "paper", "paper", "board", "minimat"] }));
    expect(log).toEqual([`scissor ${FULL.join(",")}`, "desk mat", "desk calendar 0..1", "desk minimat 0..1", "desk paper 0..2", "desk board 0..1", "desk notebook 0..3"]);
    // a composite kind with nothing on the desk is asked nothing
    log.length = 0;
    drawSlot(recordingPass(log), { w: 2400, h: 1600 }, 2, fakeSlot(log, "desk", { kinds, objects: ["paper", "minimat"] }));
    expect(log).toEqual([`scissor ${FULL.join(",")}`, "desk mat", "desk minimat 0..1", "desk paper 0..1"]);
  });
});

describe("the prepare order: both layers in the frame's own command buffer, after the mat's wind, before the frame's pass", () => {
  let undo: () => void = () => {};
  beforeAll(() => { undo = installGpuFlags(); });
  afterAll(() => undo());

  it("through the ground's own prepareFrame + drawFrame: the wind, the pad's layer, the books' shadow maps and layer, then the frame — the pad laid right after the mat, the books after the note that lies before them", async () => {
    const log: string[] = [];
    const { device, queue } = fakeDevice(log);
    const mat = await CuttingMat.create(device, "bgra8unorm", matShaders(shaderText(MAT_SHADER_FILES)));
    const root = await createSlotSet(device, "bgra8unorm", mat, deskKinds());
    const nbKind = must(root.kinds.get(NOTEBOOK_KIND)).pass as NotebookKind;
    const calKind = must(root.kinds.get(CALENDAR_KIND)).pass as CalendarKind;
    nbKind.ruleInk = notebookRuleInk();
    calKind.alpha = CALENDAR_LOOK.alpha;
    const pool = new SlotPool(root);
    // records as the oracle's desk makes them (frame.mjs — the lab's own builders): a closed book, a note beside it, the pad under both
    const note = { geometry: resolvePaper({ cx: -150, cy: 30, w: 200, h: 200, angle: 0 }, { held: 0, ring: 0, fade: 1 }, DEFAULT_PAPER_LAW, lampOf(MAT_GRID.plane)), paper: surface("note"), ink: pen("felt") };
    const inputs: GroundFrameInputs = {
      view: { camX: -600 / 1.6 - 40, camY: -400 / 1.6, zoom: 1.6, width: 1200, height: 800, dpr: 2 },
      mat: { time: 3.7, goboTime: 57.14, goboMatrix: HERO_MATRIX, noise: [0.37, 0.61] },
      theme: THEMES.light,
      // the book listed FIRST: its composite is still the things' last run
      objects: [{ kind: NOTEBOOK_KIND, record: notebookDraw({ x: 0, y: 0, angle: 0.04, cover: "orbit", seed: 7 }) }, { kind: "paper", record: note }, { kind: CALENDAR_KIND, record: calendarDraw({ x: 0, y: 0, month: "2026-09", weekStart: 1 }, 0) }],
    };
    log.length = 0;
    const submits = queue.submits;
    const encoder = device.createCommandEncoder();
    const prepared = prepareFrame(encoder, root, pool, inputs);
    expect(prepared.kinds).toMatchObject({ notebook: 1, calendar: 1, paper: 1 });
    const pass = beginPass(encoder, { label: "swap" } as unknown as GPUTextureView, [0, 0, 0, 1], "ground");
    drawFrame(pass, { w: 2400, h: 1600 }, 2, prepared.incoming, prepared.outgoing);
    pass.end();
    expect(queue.submits).toBe(submits);   // no command buffer of their own: everything waits for the frame's
    const passes = log.filter((l) => l.startsWith("pass "));
    expect(passes).toEqual(["pass mat/wind", "pass calendar/layer", "pass notebook/shadow 0", "pass notebook/layer", "pass ground"]);
    const frame = log.slice(log.indexOf("pass ground"));
    const at = (line: string) => { const i = frame.indexOf(line); expect(i, line).toBeGreaterThan(0); return i; };
    // inside the frame's pass: the mat, the pad's layer laid (its box, the slot's scissor back), the note, the books' layer laid last
    expect(at("pipeline mat/mat")).toBeLessThan(at("pipeline calendar/composite"));
    expect(at("pipeline calendar/composite")).toBeLessThan(at("pipeline paper/notes"));
    expect(at("pipeline paper/notes")).toBeLessThan(at("pipeline notebook/composite"));
    const calBox = must(calKind.pass).screenBox;
    const nbBox = must(nbKind.pass).screenBox;
    expect(frame.slice(at("pipeline calendar/composite") - 1, at("pipeline calendar/composite") + 4)).toEqual([`scissor ${must(calBox).join(",")}`, "pipeline calendar/composite", "group 0 calendar/composite", "draw 3", "scissor 0,0,2400,1600"]);
    expect(frame.slice(at("pipeline notebook/composite") - 1, at("pipeline notebook/composite") + 4)).toEqual([`scissor ${must(nbBox).join(",")}`, "pipeline notebook/composite", "group 0 notebook/composite", "draw 3", "scissor 0,0,2400,1600"]);
    pool.dispose();
  });

  it("a CAP is never silent (D7): 33 books and 5 pads on screen — the passes draw 32 and 4, and the frame SAYS what they turned away, by kind", async () => {
    const { device } = fakeDevice([]);
    const mat = await CuttingMat.create(device, "bgra8unorm", matShaders(shaderText(MAT_SHADER_FILES)));
    const root = await createSlotSet(device, "bgra8unorm", mat, deskKinds());
    (must(root.kinds.get(NOTEBOOK_KIND)).pass as NotebookKind).ruleInk = notebookRuleInk();
    (must(root.kinds.get(CALENDAR_KIND)).pass as CalendarKind).alpha = CALENDAR_LOOK.alpha;
    const pool = new SlotPool(root);
    const view = { camX: -400, camY: -400, zoom: 0.25, width: 1200, height: 800, dpr: 2 };
    const books = Array.from({ length: 33 }, (_, i) => ({ kind: NOTEBOOK_KIND, record: notebookDraw({ x: (i % 11) * 400, y: Math.floor(i / 11) * 400, angle: 0, cover: "orbit", seed: 100 + i }) }));
    const pads = Array.from({ length: 5 }, (_, i) => ({ kind: CALENDAR_KIND, record: calendarDraw({ x: i * 800, y: 1800, month: "2026-09", weekStart: 1 }, i) }));
    const at = (objects: NonNullable<GroundFrameInputs["objects"]>) => prepareFrame(device.createCommandEncoder(), root, pool, { view, theme: THEMES.light, objects });
    const over = at([...books, ...pads]);
    expect(over.kinds).toMatchObject({ notebook: 32, calendar: 4 });
    expect(over.dropped).toEqual({ notebook: 1, calendar: 1 });
    // under the caps: nothing turned away, and the frame says nothing
    const under = at([...books.slice(0, 32), ...pads.slice(0, 4)]);
    expect(under.kinds).toMatchObject({ notebook: 32, calendar: 4 });
    expect(under.dropped).toBeUndefined();
    // a record store's cap too (the notes' 65,536): the one past it is said
    const note = { kind: "paper", record: { geometry: resolvePaper({ cx: 0, cy: 0, w: 200, h: 200, angle: 0 }, { held: 0, ring: 0, fade: 1 }, DEFAULT_PAPER_LAW, lampOf(MAT_GRID.plane)), paper: surface("note"), ink: pen("felt") } };
    const notes = at(Array.from({ length: MAX_PAPERS * 64 + 1 }, () => note));
    expect(notes.kinds.paper).toBe(MAX_PAPERS * 64);
    expect(notes.dropped).toEqual({ paper: 1 });
  });

  it("…and the HOST says it: a drop is an error on the console when it begins and again if it grows — the frame's stats carry it (D7)", async () => {
    const { device } = fakeDevice([]);
    const ground = await Ground.create({ device, surface: fakeSurface(2400, 1600), mat: matShaders(shaderText(MAT_SHADER_FILES)), kinds: [paperKind(), notebookKind(), calendarKind()] });
    (must(ground.pass(CALENDAR_KIND)) as CalendarKind).alpha = CALENDAR_LOOK.alpha;
    const view = { camX: -400, camY: -400, zoom: 0.25, width: 1200, height: 800, dpr: 2 };
    const pads = Array.from({ length: 6 }, (_, i) => ({ kind: CALENDAR_KIND, record: calendarDraw({ x: i * 800, y: 0, month: "2026-09", weekStart: 1 }, i) }));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(ground.render({ view, theme: THEMES.light, objects: pads.slice(0, 5) }).dropped).toEqual({ calendar: 1 });
      expect(errors).toHaveBeenCalledTimes(1);
      expect(String(errors.mock.calls[0]?.[0])).toContain("1 calendar object not drawn");
      ground.render({ view, theme: THEMES.light, objects: pads.slice(0, 5) });   // the same drop: said once
      expect(errors).toHaveBeenCalledTimes(1);
      expect(ground.render({ view, theme: THEMES.light, objects: pads }).dropped).toEqual({ calendar: 2 });   // it grew
      expect(errors).toHaveBeenCalledTimes(2);
      expect(ground.render({ view, theme: THEMES.light, objects: pads.slice(0, 4) }).dropped).toBeUndefined();   // gone: nothing said
      expect(errors).toHaveBeenCalledTimes(2);
    } finally {
      errors.mockRestore();
    }
  });

  it("the oracle's book lives across frames as the lab's does: the same spec is the same book — its id, its mesh — and another spec another book (the cost rig's steady state re-uploads nothing)", () => {
    const spec = { x: 10, y: 20, cover: "ink", seed: 7 };
    const a = notebookDraw(spec) as NotebookDraw;
    expect(notebookDraw(spec)).toBe(a);
    const b = notebookDraw({ ...spec }) as NotebookDraw;
    expect(b).not.toBe(a);
    expect(b.id).not.toBe(a.id);
    expect(b.mesh.vcount).toBe(a.mesh.vcount);
  });

  it("the passes' own paths record what they always did: the books' `render` — the layer, then the composite in a pass of its own over the canvas; the pad's `renderLayer` — the layer in a submit of its own", async () => {
    const log: string[] = [];
    const { device, queue } = fakeDevice(log);
    const mat = await CuttingMat.create(device, "bgra8unorm", matShaders(shaderText(MAT_SHADER_FILES)));
    const root = await createSlotSet(device, "bgra8unorm", mat, deskKinds());
    const nbKind = must(root.kinds.get(NOTEBOOK_KIND)).pass as NotebookKind;
    const calKind = must(root.kinds.get(CALENDAR_KIND)).pass as CalendarKind;
    nbKind.ruleInk = notebookRuleInk();
    calKind.alpha = CALENDAR_LOOK.alpha;
    const s = ctx({ view: { camX: -600 / 2.2, camY: -400 / 2.2, zoom: 2.2, width: 1200, height: 800, dpr: 2 } });
    const book = notebookDraw({ x: 0, y: 0, angle: 0, cover: "orbit", seed: 7 }) as NotebookDraw;
    const nb = must(nbKind.pass);
    expect(nb.prepare(s.view, s.fadeIn, s.cfg, s.frame, s.light, eyeOf({ x: s.view.camX, y: s.view.camY, zoom: s.view.zoom }, s.view, NOTEBOOK.eye), NOTEBOOK, { cast: MAT_COLORS.cast, select: s.select, ruleInk: notebookRuleInk() }, [book])).toBe(1);
    log.length = 0;
    const submits = queue.submits;
    nb.render({ label: "swap" } as unknown as GPUTextureView, { w: 2400, h: 1600 }, 2);
    expect(queue.submits).toBe(submits + 1);
    const box = must(nb.screenBox);
    expect(log.filter((l) => l.startsWith("pass "))).toEqual(["pass notebook/shadow 0", "pass notebook/layer", "pass notebook/composite"]);
    expect(log.slice(log.indexOf("pass notebook/composite"))).toEqual(["pass notebook/composite", `scissor ${box.join(",")}`, "pipeline notebook/composite", "group 0 notebook/composite", "draw 3", "end"]);
    // the shadow map, then the layer: its scissor the books' box, the books then the mat under them
    const layer = log.slice(log.indexOf("pass notebook/layer"), log.indexOf("pass notebook/composite"));
    expect(layer.slice(0, 4)).toEqual(["pass notebook/layer", `scissor ${box.join(",")}`, "group 0 notebook/main", "pipeline notebook/book"]);
    expect(layer.slice(-3)).toEqual(["pipeline notebook/mat", "draw 6,1,0,0", "end"]);
    // the pad: prepared as the lab's renderLayer prepares it, then its layer in its own submit
    const cal = must(calKind.pass);
    const cs = ctx({ view: { camX: -600 / 0.42, camY: -400 / 0.42, zoom: 0.42, width: 1200, height: 800, dpr: 2 } });
    expect(calKind.prepare({ beginRenderPass: () => { throw new Error("not this encoder"); } } as unknown as GPUCommandEncoder, cs, [])).toBe(0);
    expect(cal.prepare(cs.view, cs.fadeIn, cs.cfg, cs.frame, cs.light, eyeOf({ x: cs.view.camX, y: cs.view.camY, zoom: cs.view.zoom }, cs.view, CALENDAR.eye), CALENDAR, calKind.grid, { cast: MAT_COLORS.cast, select: cs.select, alpha: CALENDAR_LOOK.alpha }, [calendarDraw({ x: 0, y: 0, month: "2026-09", weekStart: 1 }, 0) as CalendarDraw])).toBe(1);
    log.length = 0;
    cal.renderLayer({ w: 2400, h: 1600 }, 2);
    expect(queue.submits).toBe(submits + 2);
    expect(log.filter((l) => l.startsWith("pass "))).toEqual(["pass calendar/layer"]);
    expect(log.slice(0, 3)).toEqual(["pass calendar/layer", `scissor ${must(cal.screenBox).join(",")}`, "group 0 calendar/main"]);
    const drawn: string[] = [];
    must(cal.underlay()).draw(recordingPass(drawn));
    const composed: string[] = [];
    cal.composite(recordingPass(composed));
    expect(composed).toEqual(drawn);   // the kind's composite is the underlay's draw, command for command
  });
});
