// @vitest-environment node
// THE DRAWER'S FOOT (petition I21 — `deskLayer({ tray: { foot } })`): a host's line floats over the board's foot (VibeField's, 88 px),
// so the lay's visible content ends `foot` above the board's bottom edge — the header's mirror. Over the kernel's lay and the drawer's
// law: nothing laid shows in the board's bottom 88 px at any scroll (the CPU mirror of the veil, the face's clip ending at the foot's
// line, the specimens there culled), and the scroll's range grows by the foot, so the last line is still reached, whole. The flux
// publishes it to core (`TrayScreenFrame.foot`, the range less it); the pass carries it in its block (`fade.z`) and lays the veil's
// second quad IN THE SAME DRAW (the drawer's draws and instances unchanged); the tags' scissor ends at the line. Absent, all as before.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCanvasEngine } from "@ice/core";
import { layTray, type TrayHang, trayScrollMax } from "@ice/kernel";
import { Ground, type GroundFrameInputs } from "../src/ground";
import { deskLayer } from "../src/host/layer";
import type { KindPass } from "../src/kind";
import type { ObjectContext, ObjectKind } from "../src/kinds/world";
import { DEFAULT_GRID } from "../src/mat/grid";
import { MAT_SHADER_FILES, matShaders } from "../src/mat/shaders";
import { MARKS_SHADER_FILES, marksShaders } from "../src/marks/shaders";
import { shaderText } from "../src/shaders";
import { type Palette, themeFrom } from "../src/theme";
import { contentShown, DRAWER, drawerRect, drawerSize, scrollRange } from "../src/tray/drawer";
import { createTrayFlux } from "../src/tray/flux";
import { TrayUniforms } from "../src/tray/layout";
import { trayShaders } from "../src/tray/shaders";
import { faceClip, specimenFrames, type TraySpecimen } from "../src/tray/specimens";
import { fakeDevice, fakeSurface, installGpuFlags } from "./fake-gpu";
import { fakePage } from "./fake-page";

const P = DRAWER.pitch;
const FOOT = 88;
const VW = 1200;
const VH = 800;
const open = drawerRect(VW, VH, 1);
/** The foot's LINE on screen: the board's bottom edge less the inset (y 712 of an 800 px view). */
const line = open.y + open.h - FOOT;
/** Hangs enough for three lines at the open drawer's width (1120): the kinds' accessories, each its footprint. */
const HANGS: TrayHang[] = [
  { w: 120, h: 120, accessory: "hook", pegs: [[-1, -0.5], [1, -0.5]] },
  { w: 150, h: 100, accessory: "clip", pegs: [[0, -0.5]] },
  { w: 143, h: 200, accessory: "shelf", pegs: [[-1.5, 0.5], [1.5, 0.5]] },
  { w: 240, h: 160, accessory: "rail", pegs: [[-2.5, -0.5], [2.5, -0.5]] },
  { w: 360, h: 140, accessory: "hook", pegs: [[-3, -0.5], [3, -0.5]] },
  { w: 300, h: 180, accessory: "rail", pegs: [[-3.5, -0.5], [3.5, -0.5]] },
  { w: 280, h: 120, accessory: "clip", pegs: [[0, -0.5]] },
  { w: 400, h: 200, accessory: "rail", pegs: [[-4.5, -0.5], [4.5, -0.5]] },
  { w: 320, h: 160, accessory: "hook", pegs: [[-2, -0.5], [2, -0.5]] },
  { w: 200, h: 220, accessory: "shelf", pegs: [[-2, 0.5], [2, 0.5]] },
];

describe("the drawer's foot over the kernel's lay (petition I21)", () => {
  const laid = layTray(HANGS.map((hang, i) => ({ type: `t:${i}`, hang })), drawerSize(VW, VH).w, P);
  const lines = Math.max(...laid.placed.map((p) => p.line)) + 1;

  it("nothing laid shows in the board's bottom 88 px at any scroll — the veil's law, the face's clip and the cull all end at the foot's line", () => {
    expect(lines).toBeGreaterThanOrEqual(3);
    const range = scrollRange(VW, VH, laid.bottom, FOOT);
    const clip = faceClip(open, VH, FOOT);
    expect(clip.cy + clip.hy).toBe(line);   // the face's portal clip ends at the line: nothing of the content is even drawn below it
    let rows = 0;
    const shown: string[] = [];
    for (let S = 0; S <= range; S += 0.7) {
      for (const p of laid.placed) {
        const y0 = open.y + p.box.y0 - S;
        const y1 = open.y + p.box.y1 - S;
        // every device row of the footprint inside the foot: nothing of it shows (2 device px a CSS px)
        for (let y = Math.max(y0, line); y < Math.min(y1, open.y + open.h); y += 0.5) { rows++; if (contentShown(open, y, FOOT) !== 0) shown.push(`${p.type} at scroll ${S}, y ${y}`); }
      }
    }
    expect(shown).toEqual([]);
    expect(rows).toBeGreaterThan(1000);   // the lay crossed the foot at many scrolls — the check ran on real rows
    // the ramp above the line: whole a fade above it, gone at it, the header's smoothstep mirrored
    expect(contentShown(open, line - DRAWER.fade, FOOT)).toBe(1);
    expect(contentShown(open, line - DRAWER.fade / 2, FOOT)).toBeCloseTo(0.5, 12);
    expect(contentShown(open, line, FOOT)).toBe(0);
    expect(contentShown(open, VH - 1, FOOT)).toBe(0);
  });

  it("the last line is still reached: the range grows by the foot, and at its end the last line lies whole a pitch above the line", () => {
    const own = scrollRange(VW, VH, laid.bottom);
    const range = scrollRange(VW, VH, laid.bottom, FOOT);
    expect(range).toBe(own + FOOT);
    expect(range).toBe(trayScrollMax(laid.bottom, open.h - FOOT, P));
    const last = Math.max(...laid.placed.map((p) => p.box.y1));
    expect(open.y + last - range).toBe(line - P);
    for (const p of laid.placed.filter((q) => q.line === lines - 1)) {
      for (let y = open.y + p.box.y0 - range; y <= open.y + p.box.y1 - range; y += 0.5) if (y > open.y + DRAWER.arris + DRAWER.header + DRAWER.fade) expect(contentShown(open, y, FOOT), `${p.type} at ${y}`).toBe(1);
    }
    // at the footless range the last line's foot would lie under the line — out of reach
    expect(contentShown(open, open.y + last - own, FOOT)).toBe(0);
  });

  it("absent, the law is the header's alone — the content whole to the board's bottom edge — and the face's foot past the view", () => {
    for (const y of [open.y + 100, line, VH - 1]) expect(contentShown(open, y)).toBe(contentShown(open, y, 0));
    expect(contentShown(open, VH - 1)).toBe(1);
    expect(faceClip(open, VH)).toEqual(faceClip(open, VH, 0));
    const c = faceClip(open, VH);
    expect(c.cy + c.hy).toBe(VH + DRAWER.radius);
  });
});

describe("the drawer's foot, published and drawn (petition I21)", () => {
  const undo: (() => void)[] = [];
  beforeAll(() => { undo.push(installGpuFlags()); });
  afterAll(() => { for (const u of undo.splice(0)) u(); });

  it("the flux tells core the foot and a range less it; absent, the frame names none", () => {
    const facts = { open: true, scroll: 0, stretch: 0, bottom: 646 };
    const footed = createTrayFlux({ foot: FOOT });
    footed.read(facts);
    const inputs = footed.step(0, VW, VH);
    for (let t = 16; t < 2000 && footed.live(); t += 16) footed.step(t, VW, VH);
    expect(inputs?.foot).toBe(FOOT);
    expect(footed.frame()).toMatchObject({ foot: FOOT, face: open.h, max: 646 + P - (open.h - FOOT) });
    const plain = createTrayFlux();
    plain.read(facts);
    expect(plain.step(0, VW, VH)).not.toHaveProperty("foot");
    for (let t = 16; t < 2000 && plain.live(); t += 16) plain.step(t, VW, VH);
    expect(plain.frame()).not.toHaveProperty("foot");
    expect(plain.frame()?.max).toBe(646 + P - open.h);
  });

  it("the pass carries it in its block and lays the veil's foot in the SAME draw — the drawer's draws and instances unchanged; the tags' scissor ends at the line", async () => {
    const draw = async (foot: number | undefined): Promise<{ readonly log: string[]; readonly fade: number[] }> => {
      const log: string[] = [];
      const { device } = fakeDevice(log);
      const pass = (): KindPass => ({ spawn: () => pass(), prepare: (_e, _s, records) => records.length, drawRange: () => {}, dispose: () => {} });
      const kind = { name: "fake", stratum: "things", reach: 0, create: async () => pass(), resolve: (c: ObjectContext) => c, record: () => ({}), hit: () => null } as unknown as ObjectKind;
      const ground = await Ground.create({ device, surface: fakeSurface(VW * 2, VH * 2), mat: matShaders(shaderText(MAT_SHADER_FILES)), kinds: [kind], tray: trayShaders(shaderText), marks: marksShaders(shaderText(MARKS_SHADER_FILES)) });
      const PALETTE: Palette = { canvasBg: { token: "--bg", css: "#fafafa" }, select: { token: "--sel", css: "#4a90d9" } };
      const theme = themeFrom("light", PALETTE);
      const specimen = (key: number, x: number): TraySpecimen => ({ key, type: `t:${key}`, kind, natural: { w: 400, h: 200 }, rect: { x, y: 80, w: 160, h: 80 }, props: {}, accessory: "hook", pegs: [[-1, -0.5], [1, -0.5]], label: `Tag ${key}` });
      const drawn = { rect: open, scroll: 0, ...(foot !== undefined ? { foot } : {}) };
      const frames = specimenFrames([specimen(7, 100), specimen(8, 400)], drawn, { view: { width: VW, height: VH, dpr: 2 }, theme, grid: DEFAULT_GRID, looks: new Map(), lift: () => 0 });
      const writes: { label: string; bytes: Uint8Array }[] = [];
      (device.queue as { writeBuffer: unknown }).writeBuffer = (buf: { label: string }, _off: number, data: Uint8Array) => { writes.push({ label: buf.label, bytes: new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)) }); };
      const inputs: GroundFrameInputs = { view: { camX: 0, camY: 0, zoom: 1, width: VW, height: VH, dpr: 2 }, theme, tray: { p: 1, scroll: 0, specimens: frames, ...(foot !== undefined ? { foot } : {}) } };
      ground.render(inputs);
      const w = writes.filter((x) => x.label === "tray/pegboard/uniforms").at(-1);
      return { log, fade: w === undefined ? [] : [...new Float32Array(w.bytes.buffer, TrayUniforms.slots.fade.byte, 4)] };
    };
    const footed = await draw(FOOT);
    const plain = await draw(undefined);
    expect(footed.fade).toEqual([DRAWER.fade, DRAWER.header, FOOT, 0]);
    expect(plain.fade).toEqual([DRAWER.fade, DRAWER.header, 0, 0]);
    /** The drawer's draws in order (the board, its accessories, the veil) and the tags' scissor (the one after the slots'). */
    const drawer = (log: string[]): string[] => {
      const at = log.indexOf("debug tray/pegboard");
      const veil = log.indexOf("debug tray/pegboard/veil");
      return [...log.slice(at, at + 7), ...log.slice(veil, veil + 5)].filter((l) => l.startsWith("draw "));
    };
    expect(drawer(plain.log)).toEqual(["draw 6,1,0,0", "draw 6,2,0,1", "draw 6,1,0,0"]);
    expect(drawer(footed.log)).toEqual(["draw 6,1,0,0", "draw 6,2,0,1", "draw 12,1,0,0"]);
    // the tags' scissor: the face from under the header to the line (device px, the portal law's pad of one — under the veil's whole),
    // against the view's foot without one
    const tags = (log: string[]): string | undefined => { const veil = log.indexOf("debug tray/pegboard/veil"); return log.slice(0, veil).filter((l) => l.startsWith("scissor ")).at(-2); };
    const [, ty, , th] = (tags(footed.log) ?? "").slice(8).split(",").map(Number);
    expect((ty ?? 0) + (th ?? 0)).toBe(line * 2 + 1);
    const [, py, , ph] = (tags(plain.log) ?? "").slice(8).split(",").map(Number);
    expect((py ?? 0) + (ph ?? 0)).toBe(VH * 2);
  });

  it("the layer refuses a malformed foot at the mount, by its name, before it touches the page", () => {
    const palette: Palette = { canvasBg: { token: "--bg", css: "#101010" }, select: { token: "--sel", css: "#3080ff" } };
    for (const foot of [-1, Number.NaN]) {
      const ce = createCanvasEngine({});
      const page = fakePage();
      expect(() => deskLayer({ theme: themeFrom("light", palette), palette, tray: { foot } })({ host: { container: page.container } as never, world: ce.world })).toThrow("tray.foot");
      expect(page.children).toEqual([]);
      ce.dispose();
    }
  });
});
