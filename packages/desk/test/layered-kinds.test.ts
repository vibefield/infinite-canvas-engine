// The NOTEBOOK and the DESK CALENDAR as kinds (design-015 D3r-b): the two LAYERED kinds (kinds/layer.ts). Each pass
// renders every one of its objects into a target of its own in `prepare` — recorded into the frame's encoder — and its
// one run lays that target over the frame (`KindProgram.composite`: the ground draws it as ONE range after every other
// run of its stratum). ROOT ONLY (D-D18): a spawned slot's pass draws nothing. On a fake device — no pixels (those are the
// oracle's `book-*` / `pad-*` scenes and apps/desk's rigs).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { padFrame } from "../src/calendar/pad";
import { CALENDAR } from "../src/calendar/law";
import type { CalendarDraw, CalendarPass } from "../src/calendar/pass";
import { tileGrid } from "../src/calendar/tiles";
import { createSlotSet, drawSlot, type KindPass, type SlotContext, SlotPool } from "../src/ground";
import { CALENDAR_KIND, CalendarKind, calendarProgram, deskKinds, NOTEBOOK_KIND, NotebookKind, notebookProgram } from "../src/kinds";
import { attachmentOf, clip } from "../src/kinds/layer";
import { DEFAULT_GRID } from "../src/mat/grid";
import { DEFAULT_MAT_CONFIG, STILL_MAT_FRAME } from "../src/mat/layout";
import { MatPass } from "../src/mat/mat-pass";
import { MAT_SHADER_FILES, matShaders } from "../src/mat/shaders";
import type { MatPass as MatPassType } from "../src/mat/mat-pass";
import { eyeOf } from "../src/notebook/eye";
import { NOTEBOOK } from "../src/notebook/law";
import type { NotebookDraw, NotebookPass } from "../src/notebook/pass";
import { scissorOf } from "../src/nav/portal";
import { shaderText } from "../src/shaders";
import { MAT_COLORS } from "../src/theme";
import { CALENDAR_LOOK, notebookRuleInk, THEMES } from "../oracle/fixtures/vf-theme";
import { fakeDevice, installGpuFlags, recordingPass } from "./fake-gpu";
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
    const mat = await MatPass.create(device, "bgra8unorm", matShaders(shaderText(MAT_SHADER_FILES)));
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
    const real = await MatPass.create(device, "bgra8unorm", matShaders(shaderText(MAT_SHADER_FILES)));
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
