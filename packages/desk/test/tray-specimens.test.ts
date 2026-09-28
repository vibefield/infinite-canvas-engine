// THE SPECIMENS, DRAWN (design-017 §8; K5a): each specimen is its object at its natural size recorded by its OWN kind under a view block
// of its own — the drawer's camera (the face's top-left, the shown scroll) scaled about it — lit by the board's lamp, lifted by its hover
// (the kinds' `lift`/`hover`), never handed the desk's local; culled where the face cannot show it; a scroll of Δ moves it Δ on screen
// and nothing else. Its accessory is a record of the tray pass (its quad holds its pegs, its specimen and its shadow). The flux takes the
// scroll's range from the laid content and springs each hover. The ground draws the drawer UNDER the specimens (the board, then the
// accessories), each specimen in its slot, the name tags, the RIM last; a composite kind's slot is made from its program.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { worldToScreen } from "@ice/kernel";
import { Ground, type GroundFrameInputs } from "../src/ground";
import type { KindPass, KindProgram } from "../src/kind";
import type { ObjectContext, ObjectKind } from "../src/kinds/world";
import { DEFAULT_GRID } from "../src/mat/grid";
import { MAT_SHADER_FILES, matShaders } from "../src/mat/shaders";
import { TRAY_TAG_STYLE, tagMarks } from "../src/marks/layout";
import { MARKS_SHADER_FILES, marksShaders } from "../src/marks/shaders";
import { shaderText } from "../src/shaders";
import { type Palette, themeFrom } from "../src/theme";
import { DRAWER, drawerRect } from "../src/tray/drawer";
import { createTrayFlux } from "../src/tray/flux";
import { TRAY_LOOK } from "../src/tray/look";
import { trayShaders } from "../src/tray/shaders";
import { accessoryOf, specimenFrames, type TraySpecimen, type TraySpecimenEnv } from "../src/tray/specimens";
import { LAYER_IDLE_MS } from "../src/kit/layer";
import { fakeDevice, fakeSurface, installGpuFlags } from "./fake-gpu";

const PALETTE: Palette = { canvasBg: { token: "--vf-canvas-bg", css: "#fafafa" }, select: { token: "--vf-select", css: "#4a90d9" } };
const LIGHT = themeFrom("light", PALETTE);
const P = DRAWER.pitch;

/** A kind that draws nothing but logs: what its `resolve` was handed, and its pass's draws (a debug group per range). */
function fakeKind(name: string, composite = false): ObjectKind & { readonly seen: ObjectContext[]; readonly made: string[]; readonly idled: string[] } {
  const seen: ObjectContext[] = [];
  const made: string[] = [];
  const idled: string[] = [];
  const pass = (label: string): KindPass => ({
    spawn: () => pass(`${label}+`),
    prepare: (_e, _s, records) => records.length,
    drawRange: (p, first, end) => { p.pushDebugGroup(`kind ${label} ${first}-${end}`); p.popDebugGroup(); },
    idle: (ms) => { idled.push(`${label} ${ms}`); },
    dispose: () => {},
  });
  return {
    name, stratum: "things", reach: 0, ...(composite ? { composite: true } : {}),
    create: async () => { made.push(name); return pass(name); },
    resolve: (ctx: ObjectContext) => { seen.push(ctx); return ctx; },
    record: (_G: unknown, ctx: ObjectContext) => ({ at: ctx.view }),
    hit: () => null,
    seen, made, idled,
  } as ObjectKind & { readonly seen: ObjectContext[]; readonly made: string[]; readonly idled: string[] };
}

const specimen = (kind: ObjectKind, over: Partial<TraySpecimen> = {}): TraySpecimen => ({
  key: 7, type: `t:${kind.name}`, kind, natural: { w: 400, h: 200 }, rect: { x: 100, y: 80, w: 160, h: 80 }, props: { seed: 3 },
  accessory: "hook", pegs: [[-1, -0.5], [1, -0.5]], label: "Fake", ...over,
});
const env = (lift = 0): TraySpecimenEnv => ({ view: { width: 1200, height: 800, dpr: 2 }, theme: LIGHT, grid: DEFAULT_GRID, looks: new Map([["fake", { look: 1 }]]), lift: () => lift });
const open = drawerRect(1200, 800, 1, 0);

describe("a specimen, recorded by its own kind", () => {
  it("under the drawer's camera scaled about it: its natural size at the hang's scale, on its board rect, the shown scroll in it", () => {
    const k = fakeKind("fake");
    const [f] = specimenFrames([specimen(k)], { rect: open, scroll: 30 }, env());
    if (f === undefined) throw new Error("no frame");
    expect(f.view.zoom).toBe(Math.min(160 / 400, 80 / 200));
    const c = worldToScreen(0, 0, { x: f.view.camX, y: f.view.camY, zoom: f.view.zoom });
    expect(c.x).toBeCloseTo(open.x + 100 + 80, 9);
    expect(c.y).toBeCloseTo(open.y + 80 + 40 - 30, 9);
    expect(f.screen).toEqual({ x0: open.x + 100, y0: open.y + 80 - 30, x1: open.x + 260, y1: open.y + 160 - 30 });
    // the pegs from the hang point (the top edge's centre)
    expect(f.pegs).toEqual([[open.x + 180 - P, open.y + 50 - P / 2], [open.x + 180 + P, open.y + 50 - P / 2]]);
    const ctx = k.seen[0] as ObjectContext;
    expect(ctx.rect).toEqual({ cx: 0, cy: 0, w: 400, h: 200 });
    expect(ctx.props).toEqual({ seed: 3 });
    expect(ctx.look).toEqual({ look: 1 });
    expect(ctx.local).toBeUndefined();   // a specimen writes nothing into a kind's state on the desk
    expect(ctx.asset).toBeUndefined();
    expect(ctx.grid.mat.gobo.opacity).toBe(0);   // no dapple in the drawer (D-K3.6)
    // the board's lamp: the HOME lamp's direction, far off
    const L = TRAY_LOOK.lamp;
    expect(ctx.lamp.x / ctx.lamp.h).toBeCloseTo(L[0] / L[2], 12);
    expect(ctx.lamp.y / ctx.lamp.h).toBeCloseTo(L[1] / L[2], 12);
    expect(ctx.flux).toEqual({ lift: 0, hover: 0, ring: 0, fade: 1 });
  });

  it("its hover is the kinds' own lift (a share of the hold's) and hover", () => {
    const k = fakeKind("fake");
    specimenFrames([specimen(k)], { rect: open, scroll: 0 }, env(0.5));
    expect(k.seen[0]?.flux).toEqual({ lift: TRAY_LOOK.hoverLift * 0.5, hover: 0.5, ring: 0, fade: 1 });
  });

  it("a scroll of Δ moves it Δ on screen — its camera by Δ over its scale — and nothing else", () => {
    const k = fakeKind("fake");
    const [a] = specimenFrames([specimen(k)], { rect: open, scroll: 13 }, env());
    const [b] = specimenFrames([specimen(k)], { rect: open, scroll: 13 + 17 }, env());
    if (a === undefined || b === undefined) throw new Error("no frame");
    expect(b.screen.y0 - a.screen.y0).toBe(-17);
    expect(b.screen.x0).toBe(a.screen.x0);
    expect(b.view.camY - a.view.camY).toBeCloseTo(17 / a.view.zoom, 9);
    expect(b.view.camX).toBe(a.view.camX);
    expect(b.view.zoom).toBe(a.view.zoom);
    expect(b.pegs.map(([x, y]) => [x, y + 17])).toEqual(a.pegs);
  });

  it("is culled where the face cannot show it — scrolled above the drawer, or below the view", () => {
    const k = fakeKind("fake");
    expect(specimenFrames([specimen(k)], { rect: open, scroll: 400 }, env())).toEqual([]);
    expect(specimenFrames([specimen(k, { rect: { x: 100, y: 900, w: 160, h: 80 } })], { rect: open, scroll: 0 }, env())).toEqual([]);
    expect(specimenFrames([specimen(k)], { rect: open, scroll: 150 }, env()).length).toBe(1);   // its tag and shadow still show
  });

  it("its accessory's record: the quad holds its pegs and the accessory's own parts and shadow, not the specimen's body; the kind by index; up to four pegs", () => {
    const k = fakeKind("fake");
    const [f] = specimenFrames([specimen(k)], { rect: open, scroll: 0 }, env());
    if (f === undefined) throw new Error("no frame");
    const a = accessoryOf(f);
    const [x0, y0, x1, y1] = a.box as [number, number, number, number];
    for (const [x, y] of f.pegs) expect(x > x0 && x < x1 && y > y0 && y < y1).toBe(true);
    // the accessory's own parts, never the specimen's body: a hook's quad (its shadow in it) ends a little below the pegs, far above the specimen's foot
    expect(y1).toBeLessThan(f.screen.y0 + 1.2 * P);
    const shelf = accessoryOf({ ...f, accessory: "shelf", pegs: [[f.screen.x0 + 10, f.screen.y1 + 20]] });
    expect((shelf.box[1] as number) > f.screen.y0 + (f.screen.y1 - f.screen.y0) / 2 && (shelf.box[3] as number) > f.screen.y1).toBe(true);
    expect(a.kind).toEqual([0, 2, TRAY_LOOK.accessoryHeight.hook * P, 0]);
    expect(a.rect).toEqual([f.screen.x0, f.screen.y0, f.screen.x1, f.screen.y1]);
    expect(a.pegs0).toEqual([...(f.pegs[0] ?? []), ...(f.pegs[1] ?? [])]);
    expect(accessoryOf({ ...f, accessory: "rail" }).kind[0]).toBe(3);
  });

  it("its name tag is a strip of embossed label tape (K5b, D-K5b.7), centred under it — K5a's pill one word away", () => {
    const atlas = { scale: 2, cellW: 16, cellH: 28, advance: 12, baseline: 21, cap: 15, width: 768, height: 28, count: 48 };
    expect(TRAY_TAG_STYLE).toBe("tape");
    const t = tagMarks("Note", 300, 500, atlas, 2);
    expect(t.length).toBe(3 + 4 + 4);   // its shadow, the tape, its sheen; four capitals' shade and four raised capitals
    const [shadow, tape, sheen] = t;
    expect(tape?.centre[0]).toBe(300);
    expect(Math.abs((tape?.centre[1] ?? 0) - 500)).toBeLessThanOrEqual(1);
    const lum = (c: readonly number[] | undefined) => (c === undefined ? 0 : 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0));
    expect(lum(tape?.colour)).toBeLessThan(0.15);                       // dark tape…
    expect(lum(t[t.length - 1]?.colour)).toBeGreaterThan(0.85);         // …pale capitals
    expect((shadow?.centre[1] ?? 0) > (tape?.centre[1] ?? 0) && (sheen?.centre[1] ?? 0) < (tape?.centre[1] ?? 0)).toBe(true);
    expect((t[3]?.centre[1] ?? 0) > (t[7]?.centre[1] ?? 0)).toBe(true);  // each capital's shade just under it: raised
    // by night the plastic's white steps back and the sheen goes
    const dark = tagMarks("Note", 300, 500, atlas, 2, 1);
    expect(dark[dark.length - 1]?.colour[3]).toBeCloseTo(0.55, 9);
    expect(dark.length).toBe(2 + 4 + 4);
    // the pill (K5a), one word away
    expect(tagMarks("Note", 300, 500, atlas, 2, 0, "pill").length).toBe(1 + 4);
  });
});

describe("the flux follows the laid content and the hover", () => {
  const opened = { open: true, scroll: 0, stretch: 0 };
  it("takes the scroll's range from the content's foot", () => {
    const f = createTrayFlux();
    f.read({ ...opened, bottom: 606, laid: 1 });
    f.step(0, 1200, 800);
    expect(f.frame()?.max).toBe(606 + P - (352 - DRAWER.rim));
    expect(f.frame()?.scroll).toBe(0);
  });

  it("springs the hovered specimen up and lets it settle down; live only while one moves", () => {
    const f = createTrayFlux();
    f.read({ ...opened, hover: "t:a" });
    let t = 0;
    const tick = (): void => { t += 16; f.step(t, 1200, 800); };
    f.step(t, 1200, 800);
    for (let i = 0; i < 20 && f.lift("t:a") < 0.5; i++) tick();
    expect(f.lift("t:a")).toBeGreaterThan(0.5);
    expect(f.live()).toBe(true);
    for (let i = 0; i < 400 && f.live(); i++) tick();
    expect(f.lift("t:a")).toBe(1);
    expect(f.live()).toBe(false);   // settled: the desk sleeps with it lifted
    f.read({ ...opened, hover: "" });
    tick();
    expect(f.live()).toBe(true);
    for (let i = 0; i < 400 && f.live(); i++) tick();
    expect(f.lift("t:a")).toBe(0);
    expect(f.state().hovers).toEqual({});
  });
});

describe("the ground draws the specimens between the board and the rim", () => {
  const undo: (() => void)[] = [];
  beforeAll(() => { undo.push(installGpuFlags()); });
  afterAll(() => { for (const u of undo.splice(0)) u(); });

  it("the drawer under them (the board, then each accessory), each in its own slot, their tags, the rim last; a composite kind's slot made from its program", async () => {
    const log: string[] = [];
    const { device } = fakeDevice(log);
    const plain = fakeKind("fake");
    const layered = fakeKind("layered", true);
    const programs: KindProgram[] = [plain, layered];
    const ground = await Ground.create({ device, surface: fakeSurface(2400, 1600), mat: matShaders(shaderText(MAT_SHADER_FILES)), kinds: programs, tray: trayShaders(shaderText), marks: marksShaders(shaderText(MARKS_SHADER_FILES)) });
    expect(layered.made).toEqual(["layered"]);   // the root's
    const view = { camX: 0, camY: 0, zoom: 1, width: 1200, height: 800, dpr: 2 };
    const frames = specimenFrames([specimen(plain), specimen(layered, { key: 8, type: "t:layered", rect: { x: 400, y: 80, w: 160, h: 80 } })], { rect: open, scroll: 0 }, env());
    const inputs: GroundFrameInputs = { view, theme: LIGHT, tray: { p: 1, lift: 0, scroll: 0, specimens: frames } };
    ground.render(inputs);
    // the plain kind's slot is spawned at once; the layered one's waits for its program
    let at = log.indexOf("debug tray/pegboard");
    expect(log.slice(at, at + 7)).toEqual(["debug tray/pegboard", "pipeline tray/pegboard", "group 0 tray/pegboard", "draw 6,1,0,0", "pipeline tray/pegboard/accessories", "draw 6,2,0,2", "debug end"]);
    expect(log.filter((l) => l.startsWith("debug kind "))).toEqual(["debug kind fake+ 0-1"]);
    let ready = false;
    await new Promise<void>((r) => ground.warmTray([["t:layered", "layered"]], () => { ready = true; r(); }));
    expect(ready).toBe(true);
    expect(layered.made).toEqual(["layered", "layered"]);   // its own pass for the tray's slot, once
    ground.warmTray([["t:layered", "layered"]], () => { throw new Error("made twice"); });
    log.length = 0;
    ground.render(inputs);
    at = log.indexOf("debug tray/pegboard");
    const kinds = log.map((l, i) => [l, i] as const).filter(([l]) => l.startsWith("debug kind ")).map(([l, i]) => [l, i] as const);
    expect(kinds.map(([l]) => l)).toEqual(["debug kind fake+ 0-1", "debug kind layered 0-1"]);
    const rim = log.indexOf("debug tray/pegboard/rim");
    const tags = log.indexOf("pipeline marks", at);   // the name tags: the marks' pipeline, under the face's scissor
    expect(kinds.every(([, i]) => i > at + 6 && i < rim)).toBe(true);
    expect(tags).toBeGreaterThan(kinds[1]?.[1] ?? 0);
    expect(tags).toBeLessThan(rim);
    expect(log.slice(rim, rim + 5)).toEqual(["debug tray/pegboard/rim", "pipeline tray/pegboard/rim", "group 0 tray/pegboard", "draw 18,1,0,1", "debug end"]);
    expect(ground.traySlots?.size).toBe(2);
    // every tick the tray's own slots are asked to let go of what they make again (D-K6a.3) — the root's passes never by the tray
    ground.idleTray();
    expect([...plain.idled, ...layered.idled]).toEqual([`fake+ ${LAYER_IDLE_MS}`, `layered ${LAYER_IDLE_MS}`]);
    ground.dispose();
  });
});
