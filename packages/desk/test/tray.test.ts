// THE PEGBOARD TRAY (design-017, K3): the lattice's arithmetic — the cell of a point, the stagger, the whole-row CARRY (the CPU
// mirror of tray.wgsl, which rounds half up as it does) — the drawer's geometry, its curve and the band; and the pass on a fake
// device: drawn last in the ground's pass, the carry in the bytes it uploads, a drawer at rest uploading nothing.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Ground, type GroundFrameInputs } from "../src/ground";
import { MAT_SHADER_FILES, matShaders } from "../src/mat/shaders";
import { shaderText } from "../src/shaders";
import { band, DRAWER, drawerRect, drawerSize, scrollRange, slideEase } from "../src/tray/drawer";
import { carry, cellOf, holeCentre, holeSdf, PEG, type PegPoint, pointAt, punched } from "../src/tray/lattice";
import { TrayUniforms } from "../src/tray/pass";
import { TRAY_SHADER_FILES, trayShaders } from "../src/tray/shaders";
import { THEMES } from "../oracle/fixtures/vf-theme";
import { fakeDevice, fakeSurface, installGpuFlags } from "./fake-gpu";

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

  it("scrolls its stub content past the face it shows (K3: 26 rows)", () => {
    expect(scrollRange(1200, 800)).toBe(26 * 40 - (352 - 5));
    expect(scrollRange(1200, 4000)).toBe(26 * 40 - (640 - 5));   // the tallest drawer's face still shows less than the stub
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

describe("the tray pass on a fake device", () => {
  const undo: (() => void)[] = [];
  beforeAll(() => { undo.push(installGpuFlags()); });
  afterAll(() => { for (const u of undo.splice(0)) u(); });

  async function mount() {
    const log: string[] = [];
    const { device } = fakeDevice(log);
    const writes: { label: string; bytes: Uint8Array }[] = [];
    (device.queue as { writeBuffer: unknown }).writeBuffer = (buf: { label: string }, _off: number, data: Uint8Array) => { writes.push({ label: buf.label, bytes: new Uint8Array(data) }); };
    const ground = await Ground.create({ device, surface: fakeSurface(2400, 1600), mat: matShaders(shaderText(MAT_SHADER_FILES)), kinds: [], tray: trayShaders(shaderText(TRAY_SHADER_FILES)) });
    const view = { camX: 0, camY: 0, zoom: 1, width: 1200, height: 800, dpr: 2 };
    const frame = (tray?: GroundFrameInputs["tray"], theme = THEMES.light): GroundFrameInputs => ({ view, theme, ...(tray !== undefined ? { tray } : {}) });
    const trayWrites = (): Uint8Array[] => writes.filter((w) => w.label === "tray/pegboard/uniforms").map((w) => w.bytes);
    return { ground, log, writes, frame, trayWrites };
  }

  it("draws last in the ground's pass, in its debug group: the dim and the drawer open, the drawer alone closed; nothing without a tray", async () => {
    const { ground, log, frame } = await mount();
    ground.render(frame());
    expect(log.some((l) => l.includes("tray/pegboard"))).toBe(false);
    log.length = 0;
    ground.render(frame({ p: 1, lift: 0, scroll: 0 }));
    const end = log.lastIndexOf("end");
    expect(log.slice(end - 5, end)).toEqual(["debug tray/pegboard", "pipeline tray/pegboard", "group 0 tray/pegboard", "draw 6,2,0,0", "debug end"]);
    log.length = 0;
    ground.render(frame({ p: 0, lift: 0, scroll: 0 }));
    expect(log).toContain("draw 6,1,0,1");
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
