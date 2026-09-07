// @vitest-environment node
// The cutting mat's pure parts: the projector maths against numbers three.js
// produced for the same inputs (research/tree-shadow/prototype, three 0.178),
// the line law's shape and continuity, the mouse follower, the GPU layout with
// its mat4x4f, and the defaults being the theme's.
import { must } from "./must.ts";
import { describe, expect, it } from "vitest";
import { defineStruct } from "../../src/engine/struct.ts";
import { lineWeight } from "../../src/lattice/line";
import { DEFAULT_MAT_CONFIG, HERO_MATRIX, MatUniforms, STILL_MAT_FRAME, matUniformValues } from "../../src/mat/layout";
import { HERO_PROJECTOR, blurRatio, perspective, project, projectorMatrix, quatFromEuler, tilted } from "../../src/mat/projector";
import { secondOrder, stepSecondOrder } from "../../src/mat/tilt";
import { MAT, MAT_COLORS, MAT_GRID, rgb } from "../../src/theme";

// three: new PerspectiveCamera(60, 1, 0.01, 20) with the hero's position and quaternion;
// projectionMatrix · matrixWorldInverse, .elements (column-major)
const THREE_VP = [-0.52773275, -0.870741773, -0.809781668, -0.808972291, 0.000006668, 1.471127807, -0.528348495, -0.527820411, -1.649696862, 0.278553269, 0.259044461, 0.258785546, -0.170619753, -0.983789734, 0.948123641, 0.967165996];
const THREE_P = [1.732050808, 0, 0, 0, 0, 1.732050808, 0, 0, 0, 0, -1.0010005, -1, 0, 0, -0.020010005, 0];
const DESK_Y = 0.7471;
// desk (x, z) → ndc, and clip w, through the same matrix in three
const THREE_POINTS: Array<[number, number, [number, number, number], number]> = [
  [-0.0105761, -0.0485146, [-0.1494272, 0.1951102, 0.9658232], 0.5688323],
  [0.1, 0.05, [-0.6058408, 0.0834731, 0.9613668], 0.5048734],
  [-0.2, -0.1, [0.140955, 0.3690778, 0.9727676], 0.7087473],
  [0.3, -0.3, [0.6573141, -0.9088911, 0.9217542], 0.252504],
];
const THREE_TILT_Q = [0.00049975, -0.001000125, 0.0002495, 0.999999344];
const THREE_TILTED = [-0.525676696, -0.87019426, -0.811705242, -0.808972291, 0.000327802, 1.47165524, -0.526877505, -0.527820411, -1.650350722, 0.277472502, 0.256021873, 0.258785546, -0.172023743, -0.98482221, 0.946797141, 0.967165996];
const THREE_TILTED_POINT: [number, number, number] = [-0.6078039, 0.08221, 0.9602358];

const close = (a: ArrayLike<number>, b: ArrayLike<number>, eps: number) => { expect(a.length).toBe(b.length); for (let i = 0; i < a.length; i++) expect(Math.abs((a[i] as number) - (b[i] as number)), `element ${i}: ${a[i]} vs ${b[i]}`).toBeLessThan(eps); };

describe("projector", () => {
  it("builds three's perspective matrix (WebGL clip range)", () => close(perspective(60, 1, 0.01, 20), THREE_P, 1e-6));

  it("projection · view for the hero projector is three's, and desk points land where three puts them", () => {
    const m = projectorMatrix(HERO_PROJECTOR);
    close(m, THREE_VP, 1e-6);
    close(HERO_MATRIX, THREE_VP, 1e-6);
    for (const [x, z, ndc, w] of THREE_POINTS) {
      const p = project(m, [x, DESK_Y, z]);
      close(p.ndc, ndc, 2e-5);
      expect(Math.abs(p.w - w)).toBeLessThan(2e-5);
    }
  });

  it("the tilt is three's euler → quaternion, applied in clip space", () => {
    close(quatFromEuler(0.001, -0.002, 0.0005), THREE_TILT_Q, 1e-8);
    const t = tilted(projectorMatrix(HERO_PROJECTOR), 0.001, -0.002, 0.0005);
    close(t, THREE_TILTED, 1e-6);
    close(project(t, [0.1, DESK_Y, 0.05]).ndc, THREE_TILTED_POINT, 2e-5);
  });

  it("the blur ramp linearises z back to the clip w — the projector's depth in metres", () => {
    const { near, far } = HERO_PROJECTOR;
    const { sharp, soft } = MAT_GRID.gobo;
    for (const [, , ndc, w] of THREE_POINTS) {
      const lin = (2 * near * far) / (far + near - ndc[2] * (far - near));
      expect(Math.abs(lin - w)).toBeLessThan(2e-4);
      expect(blurRatio(ndc[2], sharp, soft, near, far)).toBeCloseTo(Math.min(Math.max((w - sharp) / (soft - sharp), 0), 1), 3);
    }
    // the visible desk spans the ramp: the mat's centre is mid-ramp, the far corner past it, the near corner before it
    expect(blurRatio(must(THREE_POINTS[0])[2][2], sharp, soft, near, far)).toBeGreaterThan(0.3);
    expect(blurRatio(must(THREE_POINTS[2])[2][2], sharp, soft, near, far)).toBeGreaterThan(0.7);
    expect(blurRatio(must(THREE_POINTS[3])[2][2], sharp, soft, near, far)).toBe(0);
  });
});

describe("line law", () => {
  const law = MAT_GRID.line;
  it("fades in over the window, then thickens and darkens over the next decade, and saturates", () => {
    for (const fadeIn of [[10, 20], [20, 40]] as const) {
      expect(lineWeight(fadeIn[0] - 0.01, fadeIn, law).alpha).toBe(0);
      const top = lineWeight(fadeIn[1], fadeIn, law);
      expect(top.alpha).toBeCloseTo(law.alphaThin, 9); expect(top.halfWidth).toBeCloseTo(law.thin, 9);
      const decade = lineWeight(fadeIn[1] * 10, fadeIn, law);
      expect(decade.alpha).toBeCloseTo(law.alphaThick, 9); expect(decade.halfWidth).toBeCloseTo(law.thick, 9);
      expect(lineWeight(fadeIn[1] * 1000, fadeIn, law)).toEqual(decade);
      let prev = -1;
      for (let c = 1; c < 5000; c *= 1.05) { const w = lineWeight(c, fadeIn, law); expect(w.alpha).toBeGreaterThanOrEqual(prev - 1e-12); prev = w.alpha; }
    }
  });

  it("is continuous across a decade wrap: the same cell draws the same line whichever rung owns it", () => {
    // at zoom 10^k the fine rung's cell equals the mid rung's cell at zoom 10^(k−1): one function of the cell, so identical by construction
    for (const cell of [10, 14, 20, 35, 60, 200]) expect(lineWeight(cell, [10, 20], law)).toEqual(lineWeight(cell, [10, 20], law));
    // and the coarse rung's saturated weight is what the rung above it would carry too
    expect(lineWeight(200, [10, 20], law)).toEqual(lineWeight(2000, [10, 20], law));
  });
});

describe("second-order follower", () => {
  it("settles on a constant target and ignores a zero step", () => {
    const s = secondOrder();
    s.target = [1, -0.5];
    stepSecondOrder(s, 0);
    expect(s.value).toEqual([0, 0]);
    for (let i = 0; i < 600; i++) stepSecondOrder(s, 1 / 60);
    expect(Math.abs(s.value[0] - 1)).toBeLessThan(1e-3);
    expect(Math.abs(s.value[1] + 0.5)).toBeLessThan(1e-3);
    expect(Math.abs(s.velocity[0])).toBeLessThan(1e-3);
  });

  it("leads the target (r = 2) and overshoots once (ζ = 0.3) — the reference's feel", () => {
    const s = secondOrder();
    let peak = 0;
    for (let i = 0; i < 300; i++) { s.target = [1, 0]; stepSecondOrder(s, 1 / 60); peak = Math.max(peak, s.value[0]); }
    expect(peak).toBeGreaterThan(1.05);
    expect(peak).toBeLessThan(2);
  });
});

describe("layout", () => {
  it("mat4x4f is a 16-aligned, 64-byte, sixteen-float field", () => {
    const s = defineStruct("T", [["a", "f32"], ["m", "mat4x4f"], ["b", "vec2f"]] as const);
    expect(s.slots.m.byte).toBe(16);
    expect(s.slots.m.n).toBe(16);
    expect(s.slots.b.byte).toBe(80);
    expect(s.size).toBe(96);
    expect(s.wgsl).toContain("m : mat4x4f,");
    const buf = s.alloc(1);
    buf.set({ m: HERO_MATRIX });
    close(new Float32Array(buf.bytes, 16, 16), HERO_MATRIX, 1e-12);
    expect(() => buf.set({ m: [1, 2, 3] })).toThrow(/wants 16/);
  });

  it("fills MatUniforms by name: the projector matrix, the lattice's phase, the theme's numbers", () => {
    const view = { camX: 1234.5, camY: -77.25, zoom: 1, width: 1200, height: 800, dpr: 2 };
    const u = matUniformValues(view, [10, 20], DEFAULT_MAT_CONFIG, STILL_MAT_FRAME, MAT_GRID.gobo.plates.c.strength);
    expect(u.cam).toEqual([1234.5, -77.25, 1, 2]);
    expect(u.phase.slice(0, 2)).toEqual([34.5, 122.75]);         // wrapped to the 200 coarse period
    expect(u.rungs.slice(0, 3)).toEqual([2, 20, 200]);
    expect(u.goboMatrix).toBe(HERO_MATRIX);
    expect(u.goboParams).toEqual([MAT_GRID.gobo.sharp, MAT_GRID.gobo.soft, 0.01, 20]);
    expect(u.wind[1]).toBe(MAT_GRID.gobo.plates.c.strength);
    expect(u.noise[2]).toBeCloseTo(1 / 128, 12);
    expect(u.night).toEqual([0, 0, 0, 0]);                       // no light handed in: the day, inert
    const buf = MatUniforms.alloc(1);
    expect(() => buf.set(u)).not.toThrow();
    expect(MatUniforms.slots.goboMatrix.byte % 16).toBe(0);
  });

  it("the defaults are the theme's: the reference's sage and cream, its line law, its gobo numbers", () => {
    expect(DEFAULT_MAT_CONFIG.ground).toEqual(MAT_COLORS.ground);
    expect(DEFAULT_MAT_CONFIG.ink).toEqual(MAT_COLORS.line);
    expect(rgb(MAT.ground.css).map((v) => Math.round(v * 255))).toEqual([134, 160, 120]);
    expect(rgb(MAT.line.css).map((v) => Math.round(v * 255))).toEqual([232, 220, 190]);
    expect(DEFAULT_MAT_CONFIG.line).toEqual(MAT_GRID.line);
    expect(DEFAULT_MAT_CONFIG.gobo.opacity).toBe(1);
    expect(DEFAULT_MAT_CONFIG.gobo.plate).toBe("c");
    expect(DEFAULT_MAT_CONFIG.plane.metresPerUnit).toBeCloseTo(0.2227 / 900, 12);
  });
});
