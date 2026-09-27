// THE PEGBOARD TRAY (design-017, K3): the lattice's arithmetic — the cell of a point, the stagger, the whole-row CARRY (the CPU
// mirror of tray.wgsl, which rounds half up as it does) — the drawer's geometry, its curve and the band; and the pass on a fake
// device: drawn last in the ground's pass, the carry in the bytes it uploads, a drawer at rest uploading nothing.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createCanvasEngine, openTray, closeTray, Tray, trayEntity, Viewport } from "@ice/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAmbient } from "../src/compose/ambient";
import { createDeskBuilder } from "../src/compose/builder";
import { createDeskReflector } from "../src/compose/reflector";
import { Ground, type GroundFrameInputs } from "../src/ground";
import { createTrayFlux } from "../src/tray/flux";
import { MAT_SHADER_FILES, matShaders } from "../src/mat/shaders";
import { MatUniforms } from "../src/mat/layout";
import { compose } from "../src/engine/shader";
import { KIT_WGSL_FILES } from "../src/kit/wgsl";
import { shaderText } from "../src/shaders";
import { band, DRAWER, drawerRect, drawerSize, scrollRange, slideEase } from "../src/tray/drawer";
import { carry, cellOf, holeCentre, holeSdf, PEG, type PegPoint, pointAt, punched, rotCell } from "../src/tray/lattice";
import { HASH_SIZE, hashTexels, keep } from "../src/tray/pass";
import { TrayAccessoryStruct, TrayUniforms } from "../src/tray/layout";
import { TRAY_SHADER_FILES, trayShaders } from "../src/tray/shaders";
import { type Palette, themeFrom } from "../src/theme";
import { fakeDevice, fakeSurface, installGpuFlags } from "./fake-gpu";

/**
 * The ground's two roles by theme for the tray's units — VibeField's values in the desk's own shape (`Palette`, `themeFrom`). The
 * tray is engine chrome and its units name no reference kind: since design-016 K4b the objects' shipped palette (and the oracle's
 * fixture that re-exports it) is `@ice/objects`', which the desk never imports.
 */
const PALETTE: Record<"light" | "dark", Palette> = {
  light: { canvasBg: { token: "--vf-canvas-bg", css: "#fafafa" }, select: { token: "--vf-select", css: "#4a90d9" } },
  dark: { canvasBg: { token: "--vf-canvas-bg", css: "#171717" }, select: { token: "--vf-select", css: "#4a90d9" } },
};
const THEMES = { light: themeFrom("light", PALETTE.light), dark: themeFrom("dark", PALETTE.dark) };

const P = DRAWER.pitch;
/** A board point from a global Y (pitches) — exact for every Y these tests use (a row + ¾, or a small fraction). */
const at = (x: number, Y: number): PegPoint => { const R = Math.floor(Y); return { x, R, fy: Y - R }; };

describe("the lattice (tray/lattice.ts — tray.wgsl's arithmetic on the CPU)", () => {
  it("a hole's centre lies in its own cell at offset 0 — every parity, above the top, and 10⁶ and 2³⁰ rows down", () => {
    for (const row of [-3, -2, -1, 0, 1, 2, 3, 1e6, 1e6 + 1, 2 ** 30, 2 ** 30 + 1]) {
      for (const col of [0, 1, 2, 26]) {
        const c = holeCentre(row, col);
        const cell = cellOf(at(c.x, c.y));
        expect([cell.row, cell.col]).toEqual([row, col]);
        expect(Math.abs(cell.qx) + Math.abs(cell.qy)).toBeLessThan(1e-9);
      }
    }
  });

  it("odd rows are shifted half a pitch and the stagger's period is two rows — for negative rows too (−1 is odd)", () => {
    for (const r of [-5, -4, -1, 0, 1, 6, 1e6, 1e6 + 1]) {
      expect(holeCentre(r + 1, 3).x - holeCentre(r, 3).x).toBeCloseTo((r & 1) === 0 ? 0.5 : -0.5, 12);
      expect(holeCentre(r + 2, 3).x).toBe(holeCentre(r, 3).x);
      expect(holeCentre(r + 1, 3).y - holeCentre(r, 3).y).toBe(1);
    }
    expect(holeCentre(0, 0)).toEqual({ x: PEG.colPhase, y: PEG.rowPhase });
    expect(holeCentre(1, 0).x).toBe(PEG.colPhase + 0.5);
  });

  it("the hole is a vertical stadium 0.26 × 0.66 of a pitch — the research's", () => {
    expect(holeSdf(0, 0)).toBeCloseTo(-0.13, 12);
    expect(holeSdf(0.13, 0)).toBeCloseTo(0, 12);
    expect(holeSdf(0, 0.33)).toBeCloseTo(0, 12);
    expect(holeSdf(0, -0.43)).toBeCloseTo(0.1, 12);
    expect(holeSdf(0.2, 0.1)).toBeCloseTo(0.07, 12);
  });

  it("a point belongs to the nearer hole, ties going down and right (half up) — and the WGSL never calls `round` (it ties to even)", () => {
    // rows at Y = r + ¾: Y = R + ¼ is equidistant from r = R − 1 and r = R
    expect(cellOf(at(5, 7.25)).row).toBe(7);
    expect(cellOf(at(5, 7.2499)).row).toBe(6);
    expect(cellOf(at(5, -0.75)).row).toBe(-1);
    // midway between two holes of a row the right one takes it — for an even column as for an odd one (ties-to-even would split them)
    for (const c of [1, 2, 3, 4]) expect(cellOf(at(holeCentre(0, c).x + 0.5, holeCentre(0, c).y)).col).toBe(c + 1);
    const wgsl = readFileSync(resolve(import.meta.dirname, "../shaders/tray/tray.wgsl"), "utf8");
    expect(wgsl).not.toMatch(/\bround\s*\(/);
  });
});

describe("the carry (design-017 §6.2)", () => {
  it("splits any scroll into whole rows and the fraction of one — below the top as above it", () => {
    expect(carry(0, P)).toEqual({ rowBase: 0, frac: 0 });
    expect(carry(40, P)).toEqual({ rowBase: 1, frac: 0 });
    const a = carry(17, P);
    expect([a.rowBase, a.frac]).toEqual([0, 17 / 40]);
    const band = carry(-17, P);   // the band past the top
    expect(band.rowBase).toBe(-1);
    expect(band.frac).toBeCloseTo(23 / 40, 12);
    const deep = carry(1e6 * P + 17, P);
    expect(deep.rowBase).toBe(1e6);
    expect(deep.frac).toBeCloseTo(17 / 40, 9);
    expect(() => carry(2 ** 31 * P, P)).toThrow(/i32/);
  });

  it("a scroll of Δ moves the pattern by exactly Δ: under a pixel, the board point that was Δ px lower — at any depth", () => {
    for (const S of [0, 13.3, -21, 1e6 * P + 5.5]) {
      for (const d of [1, 17, 40, 80, 123.25, 900]) {
        for (const y of [0, 3.5, 120, 351]) {
          const moved = pointAt(9.3, y, P, carry(S + d, P));
          const there = pointAt(9.3, y + d, P, carry(S, P));
          expect(moved.R).toBe(there.R);
          expect(moved.fy).toBeCloseTo(there.fy, 9);
          const [c0, c1] = [cellOf(moved), cellOf(there)];
          expect([c0.row, c0.col]).toEqual([c1.row, c1.col]);
        }
      }
    }
  });

  it("10⁶ rows down the cells on screen are the top's, row for row, at the same fraction (an even carry keeps the stagger)", () => {
    for (const s0 of [0, 11, 27.5]) {
      for (let y = 0; y < 352; y += 7) {
        for (const x of [0.4, 3.9, 13.2]) {
          const top = cellOf(pointAt(x, y, P, carry(s0, P)));
          const deep = cellOf(pointAt(x, y, P, carry(s0 + 1e6 * P, P)));
          expect(deep.row - top.row).toBe(1e6);
          expect(deep.col).toBe(top.col);
          expect(deep.qx).toBeCloseTo(top.qx, 9);
          expect(deep.qy).toBeCloseTo(top.qy, 9);
        }
      }
    }
  });
});

describe("the face's turned lattices (tray/lattice.ts `rotCell` — tray.wgsl `peg_rot`)", () => {
  // the face's three octaves: the tone's two (2,1)/5 and (1,−2)/2, the grain's (3,1)·6
  const OCTAVES = [[2, 1, 1, 5], [1, -2, 1, 2], [3, 1, 6, 1]] as const;

  it("moves a point's cell by an EXACT integer vector when the board moves by whole multiples of den rows — the same fraction, 10⁶ and 2²⁸ rows down", () => {
    for (const [a, b, num, den] of OCTAVES) {
      for (const m of [1, 200_000, 2 ** 28 / den]) {
        const rows = den * Math.round(m);
        for (const x of [0.3, 7.77, 27.9]) {
          for (const [R, fy] of [[0, 0.1], [3, 0.55], [-2, 0.9], [11, 0]] as const) {
            const near = rotCell({ x, R, fy }, a, b, num, den);
            const far = rotCell({ x, R: R + rows, fy }, a, b, num, den);
            expect(far.u - near.u).toBe(-b * num * (rows / den));
            expect(far.v - near.v).toBe(a * num * (rows / den));
            expect(far.fu).toBe(near.fu);
            expect(far.fv).toBe(near.fv);
          }
        }
      }
    }
  });

  it("is continuous across a row boundary (the carry changes, the lattice point does not)", () => {
    for (const [a, b, num, den] of OCTAVES) {
      const before = rotCell({ x: 5.25, R: 1_000_006, fy: 1 - 2 ** -20 }, a, b, num, den);
      const after = rotCell({ x: 5.25, R: 1_000_007, fy: 0 }, a, b, num, den);
      expect(Math.abs(after.u + after.fu - (before.u + before.fu))).toBeLessThan(1e-4 * num * 3);
      expect(Math.abs(after.v + after.fv - (before.v + before.fv))).toBeLessThan(1e-4 * num * 3);
    }
  });
});

describe("the drawer (tray/drawer.ts)", () => {
  it("is whole pitches wide (≤ 1120, ≤ the view − 32), ≈ 44 % of the view high clamped to 220…640", () => {
    expect(drawerSize(1200, 800)).toEqual({ w: 1120, h: 352 });
    expect(drawerSize(1440, 900)).toEqual({ w: 1120, h: 396 });
    expect(drawerSize(800, 600)).toEqual({ w: 760, h: 264 });
    expect(drawerSize(400, 400)).toEqual({ w: 360, h: 220 });
    expect(drawerSize(3000, 2000)).toEqual({ w: 1120, h: 640 });
    for (const vw of [320, 777, 1200, 1500, 2560]) {
      const { w } = drawerSize(vw, 800);
      expect(w).toBeLessThanOrEqual(Math.min(1120, vw - 32));
      expect(w % P).toBe(0);
    }
  });

  it("punches no hole within the solid border of a side, and both parities up to it — no hole is ever sawn (D-K3.1)", () => {
    for (const vw of [400, 800, 1200, 1500]) {
      const W = drawerSize(vw, 800).w / P;
      for (const row of [0, 1]) {
        const xs: number[] = [];
        // every hole that would reach the board at all, and whether it is punched
        for (let col = -2; col < W + 2; col++) {
          const c = holeCentre(row, col);
          if (c.x + PEG.holeR <= 0 || c.x - PEG.holeR >= W) continue;
          if (punched(cellOf(at(c.x, c.y)), W)) xs.push(c.x);
        }
        expect(Math.min(...xs)).toBeGreaterThanOrEqual(PEG.border);
        expect(W - Math.max(...xs)).toBeGreaterThanOrEqual(PEG.border);
        expect(Math.min(...xs)).toBeLessThan(PEG.border + 1);        // …and none left out that could stand
        expect(W - Math.max(...xs)).toBeLessThan(PEG.border + 1);
      }
    }
  });

  it("closed shows its lip (more when hovered), open the whole drawer — centred, its bottom flush with the view", () => {
    expect(drawerRect(1200, 800, 0, 0)).toEqual({ x: 40, y: 800 - DRAWER.lip, w: 1120, h: 352 });
    expect(drawerRect(1200, 800, 0, 1).y).toBe(800 - DRAWER.lipHover);
    expect(drawerRect(1200, 800, 1, 0).y).toBe(448);
    expect(drawerRect(1200, 800, 1, 1).y).toBe(448);
    expect(drawerRect(1200, 800, 0.5, 0).y).toBeCloseTo(800 - (12 + (352 - 12) * 0.5), 12);
  });

  it("slides on widgetlab rev 1's curve, cubic-bezier(0.32,0.72,0,1) over 340 ms", () => {
    expect(DRAWER.slideMs).toBe(340);
    expect(slideEase(0)).toBe(0);
    expect(slideEase(17 / 340)).toBeCloseTo(0.1219, 3);
    expect(slideEase(170 / 340)).toBeCloseTo(0.9548, 3);
    expect(slideEase(1)).toBe(1);
    let prev = 0;
    for (let t = 0; t <= 1; t += 1 / 64) { const v = slideEase(t); expect(v).toBeGreaterThanOrEqual(prev); prev = v; }
  });

  it("scrolls its laid content past the face it shows: the last line's foot plus a pitch, less the face (K5a — K3's stub retired)", () => {
    expect(scrollRange(1200, 800, 530)).toBe(530 + 40 - (352 - 5));
    expect(scrollRange(1200, 4000, 530)).toBe(0);   // the tallest drawer's face shows it all
    expect(scrollRange(1200, 800, 0)).toBe(0);      // nothing laid: nothing to scroll
  });
});

describe("the band (design-017 §3)", () => {
  it("shows ever less per px pulled, never past its asymptote; odd; the slope c at rest", () => {
    expect(band(0)).toBe(0);
    expect(band(-50)).toBeCloseTo(-band(50), 12);
    expect(band(100)).toBeCloseTo(72 * (1 - 1 / (1 + (100 * 0.55) / 72)), 12);
    expect(band(1e9)).toBeLessThan(72);
    expect(band(1e-3) / 1e-3).toBeCloseTo(0.55, 4);
    expect(band(200) - band(100)).toBeLessThan(band(100) - band(0));
  });
});

describe("the tray's program (tray/shaders.ts — the mat's light through the kit, design-016 §5)", () => {
  it("asks the kit by name for the view block's struct, the primitives and the mat's light; its own map lists only its own files", () => {
    expect(Object.values(TRAY_SHADER_FILES).filter((f) => !f.startsWith("tray/"))).toEqual([]);
    const c = trayShaders(shaderText);
    expect((c.structs ?? []).map((s) => s.name)).toEqual(["MatUniforms", "TrayUniforms", "TrayAccessory"]);
    expect((c.modules ?? []).map((m) => m.label)).toEqual([KIT_WGSL_FILES.sdf, KIT_WGSL_FILES.light, "tray/tray.wgsl"]);
    expect(c.entry.label).toBe("tray/tray-pass.wgsl");
  });

  it("composes, byte for byte, the program composed from the mat's files by hand (K3's, and K5a's accessory record)", () => {
    const raw = shaderText({ primitives: "primitives.wgsl", mat: "mat/mat.wgsl", tray: "tray/tray.wgsl", trayPass: "tray/tray-pass.wgsl" });
    const part = (label: string, text: string) => ({ label, text });
    const byHand = compose({
      structs: [MatUniforms, TrayUniforms, TrayAccessoryStruct],
      modules: [part("primitives.wgsl", raw.primitives), part("mat/mat.wgsl", raw.mat), part("tray/tray.wgsl", raw.tray)],
      entry: part("tray/tray-pass.wgsl", raw.trayPass),
    });
    const kit = compose(trayShaders(shaderText));
    expect(kit.code).toBe(byHand.code);
    expect(kit.label).toBe(byHand.label);
  });
});

describe("the tray pass on a fake device", () => {
  const undo: (() => void)[] = [];
  beforeAll(() => { undo.push(installGpuFlags()); });
  afterAll(() => { for (const u of undo.splice(0)) u(); });

  async function mount() {
    const log: string[] = [];
    const { device } = fakeDevice(log);
    const writes: { label: string; bytes: Uint8Array }[] = [];
    (device.queue as { writeBuffer: unknown }).writeBuffer = (buf: { label: string }, _off: number, data: Uint8Array) => { writes.push({ label: buf.label, bytes: new Uint8Array(data) }); };
    const ground = await Ground.create({ device, surface: fakeSurface(2400, 1600), mat: matShaders(shaderText(MAT_SHADER_FILES)), kinds: [], tray: trayShaders(shaderText) });
    const view = { camX: 0, camY: 0, zoom: 1, width: 1200, height: 800, dpr: 2 };
    const frame = (tray?: GroundFrameInputs["tray"], theme = THEMES.light): GroundFrameInputs => ({ view, theme, ...(tray !== undefined ? { tray } : {}) });
    const trayWrites = (): Uint8Array[] => writes.filter((w) => w.label === "tray/pegboard/uniforms").map((w) => w.bytes);
    return { ground, log, writes, frame, trayWrites };
  }

  it("draws last in the ground's pass, in its debug groups — the drawer under its specimens (one quad, the dim folded in), then the rim's three strips over them (K5a); nothing without a tray", async () => {
    const { ground, log, frame } = await mount();
    ground.render(frame());
    expect(log.some((l) => l.includes("tray/pegboard"))).toBe(false);
    log.length = 0;
    ground.render(frame({ p: 1, lift: 0, scroll: 0 }));
    const end = log.lastIndexOf("end");
    expect(log.slice(end - 11, end)).toEqual(["debug tray/pegboard", "pipeline tray/pegboard", "group 0 tray/pegboard", "draw 6,1,0,0", "debug end", "scissor 0,0,2400,1600", "debug tray/pegboard/rim", "pipeline tray/pegboard/rim", "group 0 tray/pegboard", "draw 18,1,0,1", "debug end"]);
    log.length = 0;
    ground.render(frame({ p: 0, lift: 0, scroll: 0 }));
    expect(log).toContain("draw 6,1,0,0");
    expect(ground.tray?.laid?.dim).toBe(0);
    ground.render(frame({ p: 0.5, lift: 0, scroll: 0 }, THEMES.dark));
    expect(ground.tray?.laid?.dim).toBeCloseTo(0.4 * THEMES.dark.matLight.night * 0.5 + 0.1 * (1 - THEMES.dark.matLight.night) * 0.5, 9);
  });

  it("uploads the carry — the scroll's whole rows as an i32, the fraction as an f32 — and uploads nothing while the drawer rests", async () => {
    const { ground, frame, trayWrites } = await mount();
    ground.render(frame({ p: 1, lift: 0, scroll: 1e6 * P + 17 }));
    const bytes = trayWrites().at(-1);
    if (bytes === undefined) throw new Error("no tray upload");
    const dv = new DataView(bytes.buffer);
    expect(dv.getInt32(TrayUniforms.slots.rowBase.byte, true)).toBe(1e6);
    expect(dv.getFloat32(TrayUniforms.slots.frac.byte, true)).toBe(Math.fround(17 / 40));
    const n = trayWrites().length;
    ground.render(frame({ p: 1, lift: 0, scroll: 1e6 * P + 17 }));
    ground.render(frame({ p: 1, lift: 0, scroll: 1e6 * P + 17 }));
    expect(trayWrites().length).toBe(n);
    ground.render(frame({ p: 1, lift: 0, scroll: 1e6 * P + 18 }));
    expect(trayWrites().length).toBe(n + 1);
  });
});

describe("the flux (tray/flux.ts — the motion lives in the renderer)", () => {
  const closed = { open: false, scroll: 0, stretch: 0, lip: false };
  const opened = { ...closed, open: true };

  it("slides on the drawer's curve by the frame clock, from where it is on a reversal; at rest it is not live", () => {
    const f = createTrayFlux();
    expect(f.read(closed)).toBe(true);
    expect(f.step(0, 1200, 800)?.p).toBe(0);
    expect(f.live()).toBe(false);
    expect(f.read(closed)).toBe(false);   // the same facts: no frame due
    expect(f.read(opened)).toBe(true);
    expect(f.step(1000, 1200, 800)?.p).toBe(0);   // the tween begins on this frame's clock
    expect(f.live()).toBe(true);
    expect(f.step(1017, 1200, 800)?.p).toBeCloseTo(slideEase(17 / 340), 12);
    expect(f.step(1170, 1200, 800)?.p).toBeCloseTo(slideEase(0.5), 12);
    expect(f.step(1340, 1200, 800)?.p).toBe(1);
    expect(f.live()).toBe(false);
    // closed again, then opened and reversed mid-slide: the close starts from where the drawer IS
    f.read(closed);
    f.step(2000, 1200, 800);
    expect(f.step(2340, 1200, 800)?.p).toBe(0);
    f.read(opened);
    expect(f.step(2400, 1200, 800)?.p).toBe(0);
    const p0 = f.step(2434, 1200, 800)?.p ?? -1;
    expect(p0).toBeCloseTo(slideEase(34 / 340), 12);
    f.read(closed);
    expect(f.step(2434, 1200, 800)?.p).toBeCloseTo(p0, 12);
    expect(f.step(2604, 1200, 800)?.p).toBeCloseTo(p0 * (1 - slideEase(0.5)), 12);
    expect(f.step(2774, 1200, 800)?.p).toBe(0);
    expect(f.live()).toBe(false);
  });

  it("lifts the lip on its spring toward the hover fact — only while closed — and settles", () => {
    const f = createTrayFlux();
    f.read({ ...closed, lip: true });
    let t = 0;
    f.step(t, 1200, 800);
    for (let i = 0; i < 6; i++) { t += 16; f.step(t, 1200, 800); }
    expect(f.state().lift).toBeGreaterThan(0.3);
    expect(f.live()).toBe(true);
    for (let i = 0; i < 120; i++) { t += 16; f.step(t, 1200, 800); }
    expect(f.state().lift).toBe(1);
    expect(f.live()).toBe(false);
    expect(f.frame()?.y).toBe(800 - DRAWER.lipHover);
  });

  it("shows the band's pull exactly while the fact holds one, and carries it home on its spring when it lets go", () => {
    const f = createTrayFlux();
    f.read({ ...opened, scroll: 693, stretch: 100 });
    let t = 0;
    const a = f.step(t, 1200, 800);
    expect(a?.scroll).toBe(693 + band(100));
    f.read({ ...opened, scroll: 693, stretch: 0 });
    t += 16;
    const b = f.step(t, 1200, 800);
    expect(b?.scroll).toBeGreaterThan(693);
    expect(b?.scroll).toBeLessThan(693 + band(100));
    expect(f.live()).toBe(true);
    for (let i = 0; i < 200 && f.live(); i++) { t += 16; f.step(t, 1200, 800); }
    expect(f.live()).toBe(false);
    expect(f.step(t + 16, 1200, 800)?.scroll).toBe(693);
  });

  it("publishes the drawer as drawn — its rect mid-slide, the layout's scroll range — and holds a still when pinned; hidden draws nothing", () => {
    const f = createTrayFlux();
    f.read(opened);
    f.step(0, 1200, 800);
    f.step(170, 1200, 800);
    const fr = f.frame();
    expect(fr?.p).toBeCloseTo(slideEase(0.5), 12);
    expect(fr?.y).toBeCloseTo(drawerRect(1200, 800, slideEase(0.5)).y, 9);
    expect(fr?.max).toBe(scrollRange(1200, 800, 0));
    // the laid content's foot moves the range (K5a): a fact the flux reads
    f.read({ ...opened, bottom: 900, laid: 1 });
    f.step(190, 1200, 800);
    expect(f.frame()?.max).toBe(900 + 40 - (352 - 5));
    expect(f.frame()?.pitch).toBe(40);
    f.pin({ p: 0.5, band: 12 });
    expect(f.step(180, 1200, 800)).toEqual({ p: 0.5, lift: 0, scroll: 12 });
    expect(f.live()).toBe(false);   // a still never keeps the desk awake
    f.pin({ hidden: true });
    expect(f.step(190, 1200, 800)).toBeUndefined();
    expect(f.frame()).toBeUndefined();
    f.pin(null);
    expect(f.read(undefined)).toBe(true);
    expect(f.step(200, 1200, 800)).toBeUndefined();
  });
});

describe("the reflector draws the tray (design-017 §3 — idle-zero open and closed)", () => {
  const undo: (() => void)[] = [];
  beforeAll(() => { undo.push(installGpuFlags()); });
  afterAll(() => { for (const u of undo.splice(0)) u(); });

  it("one frame per frame of motion while the drawer slides, none at rest — open, and closed; the frame's tray follows the curve", async () => {
    const ce = createCanvasEngine();
    ce.docs.create();
    ce.world.setResource(Viewport, { w: 1200, h: 800, dpr: 2 });
    const { device, queue } = fakeDevice();
    const palette = PALETTE.light;   // the reflector draws no kind here (`kinds: []`): the ground's two roles are the whole palette
    const builder = createDeskBuilder(ce.world, { objects: [] });
    const ambient = createAmbient({ mode: "still", random: () => 0.5 });
    let ground: Ground | null = null;
    const desk = createDeskReflector({ world: ce.world, builder, kinds: [], ambient, ground: () => ground, attach: { resize: () => {} }, theme: THEMES.light, palette });
    ce.engine.registerReflector(desk.reflector);
    ground = await Ground.create({ device, surface: fakeSurface(2400, 1600), mat: matShaders(shaderText(MAT_SHADER_FILES)), kinds: [], tray: trayShaders(shaderText) });
    desk.ready();
    let now = 1000;
    const step = (n = 1): number => { const before = queue.submits; for (let i = 0; i < n; i++) { now += 16; ce.step(now); } return queue.submits - before; };
    expect(step()).toBe(1);   // the first paint: the lip
    expect(desk.lastInputs()?.tray).toEqual({ p: 0, lift: 0, scroll: 0 });
    expect(step(240)).toBe(0);   // closed, at rest
    openTray(ce.world);
    const ps: number[] = [];
    let frames = 0;
    for (let i = 0; i < 40; i++) { frames += step(); ps.push(desk.lastInputs()?.tray?.p ?? -1); }
    const moving = Math.ceil(DRAWER.slideMs / 16) + 1;
    expect(frames).toBeGreaterThanOrEqual(moving - 1);
    expect(frames).toBeLessThanOrEqual(moving + 1);
    expect(ps[0]).toBe(0);
    expect(ps[1]).toBeCloseTo(slideEase(16 / 340), 12);
    expect(ps.at(-1)).toBe(1);
    expect(step(240)).toBe(0);   // open, at rest
    expect(desk.wakes().tray).toBeGreaterThan(0);
    closeTray(ce.world);
    expect(step(40)).toBeGreaterThan(0);
    expect(step(240)).toBe(0);   // closed again, at rest
    const e = trayEntity(ce.world);
    expect(e !== undefined && ce.world.get(e, Tray)?.open).toBe(false);
  });
});

describe("the pre-gathered noise and the fades (tray/pass.ts — the cost's work, design-017 §6.7)", () => {
  it("gives every texel its four lattice corners — its right, lower and diagonal neighbours' own values, across the wrap", () => {
    const N = HASH_SIZE;
    const t = hashTexels();
    expect(t.length).toBe(N * N * 4);
    const px = (i: number, j: number, c: number): number => t[((j % N) * N + (i % N)) * 4 + c] as number;
    let bad = 0;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        if (px(i, j, 1) !== px(i + 1, j, 0)) bad++;       // (i+1, j) is the right neighbour's own
        if (px(i, j, 2) !== px(i, j + 1, 0)) bad++;       // (i, j+1) the lower one's
        if (px(i, j, 3) !== px(i + 1, j + 1, 0)) bad++;   // (i+1, j+1) the diagonal's
      }
    }
    expect(bad).toBe(0);
  });

  it("fades a band by its own footprint as tray.wgsl did per pixel: kept while a cycle spans ≥ 4 device px, gone at 2", () => {
    const fp = 1 / (40 * 2);   // 40 CSS px a pitch at dpr 2
    expect(keep(fp, 5)).toBe(1);
    expect(keep(fp, 20)).toBe(1);   // 4 device px a cycle
    expect(keep(fp, 30)).toBeCloseTo(0.5, 12);
    expect(keep(fp, 40)).toBe(0);   // 2
    expect(keep(fp, 85)).toBe(0);
    expect(keep(1 / 40, 10)).toBe(1);
    expect(keep(1 / 40, 15)).toBeCloseTo(0.5, 12);
  });
});
