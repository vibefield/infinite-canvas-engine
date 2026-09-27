// The 3D notebook's pure half (NOTEBOOK.md): the desk eye, the shape (the swing, the ride, the
// gutter's curves, a sheet in the air), the mesh, the motion (the cover, a page by key and by
// hand, the peek, the flutter), the hit test, the placement and the lamp, the pen.
import { describe, expect, it } from "vitest";
import { deskAt, eyeOf, project, unproject, inverseOf, lampDir, lightFrame, matrixOf, rigidOf, toLocal, toWorld } from "@ice/desk/kit";
import { nibWidth, PEN, texelOf, INK_W, INK_H } from "../src/notebook/ink";
import { NOTEBOOK } from "../src/notebook/law";
import { buildMesh, MeshWriter, VERTEX_FLOATS } from "../src/notebook/mesh";
import { counts, dragSheet, grabSheet, leftTop, newMotion, poseOf, releaseSheet, rightTop, setOpen, spreadOf, stepMotion, turnPage } from "../src/notebook/motion";
import { pickNotebook } from "../src/notebook/pick";
import { angleAt, coverFrame, frameOf, integrate, profileOf, relaxOf, restSheet, ride, rideDir, sampleAir, sampleRest, sheetSamples, specOf, swingOf } from "../src/notebook/shape";

const law = NOTEBOOK;
const F = frameOf(specOf(law));
const settle = (m: ReturnType<typeof newMotion>, s = 4) => { for (let t = 0; t < s; t += 1 / 60) stepMotion(m, 1 / 60, law); };

describe("the desk eye", () => {
  const cam = { x: -300, y: -200, zoom: 1.5 };
  const vp = { width: 1200, height: 800 };
  const e = eyeOf(cam, vp, law.eye);
  it("maps the desk plane exactly as the ortho camera does", () => {
    for (const [x, y] of [[0, 0], [123, -45], [-400, 310]] as const) {
      const [sx, sy] = project(e, x, y, 0);
      expect(sx).toBeCloseTo((x - cam.x) * cam.zoom, 9);
      expect(sy).toBeCloseTo((y - cam.y) * cam.zoom, 9);
      const [dx, dy] = deskAt(e, sx, sy);
      expect(dx).toBeCloseTo(x, 9); expect(dy).toBeCloseTo(y, 9);
    }
  });
  it("sees a raised point further from the view's centre — it grows toward the eye", () => {
    const [a] = project(e, e.ex + 100, e.ey, 0);
    const [b] = project(e, e.ex + 100, e.ey, 60);
    expect(b - e.vw / 2).toBeGreaterThan(a - e.vw / 2);
    expect((b - e.vw / 2) / (a - e.vw / 2)).toBeCloseTo(e.h / (e.h - 60), 9);
  });
  it("unprojects along the eye's ray", () => {
    const [sx, sy] = project(e, 37, -12, 25);
    const [dx, dy] = deskAt(e, sx, sy);
    const [x, y] = unproject(e, dx, dy, 25);
    expect(x).toBeCloseTo(37, 6); expect(y).toBeCloseTo(-12, 6);
  });
  it("stands at least `min` up, and k view-diagonals up when zoomed out", () => {
    expect(eyeOf({ x: 0, y: 0, zoom: 4 }, vp, law.eye).h).toBe(law.eye.min);
    const far = eyeOf({ x: 0, y: 0, zoom: 0.25 }, vp, law.eye);
    expect(far.h).toBeCloseTo(law.eye.k * Math.hypot(1200, 800) / 0.25, 6);
  });
});

describe("the shape", () => {
  it("derives the frame: the spine is the closed book's thickness, the gutter half a spine left of the back board", () => {
    expect(F.T).toBeCloseTo(law.block.sheets * law.block.sheet, 9);
    expect(F.sw).toBeCloseTo(F.T + 2 * F.b, 9);
    expect(F.xg).toBeCloseTo(-F.W / 2 - F.sw / 2, 9);
    expect(F.Wo).toBeGreaterThan(F.Wp);
    expect(F.Hp).toBeCloseTo(F.H - 2 * law.block.square, 9);
  });
  it("swings the cover from lying on the block to lying on the desk, left of the spine, the hinge rising between", () => {
    const c0 = coverFrame(F, 0);
    const c1 = coverFrame(F, Math.PI);
    const cm = coverFrame(F, Math.PI / 2);
    expect(c0.ox).toBeCloseTo(-F.W / 2, 9); expect(c0.oz).toBeCloseTo(F.b + F.T, 9); expect(c0.ux).toBeCloseTo(1, 9);
    expect(c1.ox).toBeCloseTo(-F.W / 2 - F.sw, 9); expect(c1.oz).toBeCloseTo(F.b, 9); expect(c1.ux).toBeCloseTo(-1, 9); expect(c1.wz).toBeCloseTo(-1, 9);
    expect(cm.uz).toBeCloseTo(1, 9);   // standing
    expect(cm.oz).toBeGreaterThan(F.b);
  });
  it("bounces an overshoot back off the desk and the block", () => {
    expect(swingOf(Math.PI + 0.1)).toBeCloseTo(Math.PI - 0.1, 12);
    expect(swingOf(-0.05)).toBeCloseTo(0.05, 12);
    expect(relaxOf(0.5 * Math.PI)).toBe(0);
    expect(relaxOf(Math.PI)).toBe(1);
  });
  it("rides the left stack on the cover: at the full swing, the mirror about the gutter", () => {
    const C = coverFrame(F, Math.PI);
    for (const [x, z] of [[0, F.b + 1], [-50, F.b + 3.3], [F.W / 2, F.b + 0.1]] as const) {
      const [X, Z] = ride(F, C, x, z);
      expect(X).toBeCloseTo(2 * F.xg - x, 9); expect(Z).toBeCloseTo(z, 9);
    }
    const [nx, nz] = rideDir(C, 0.6, 0.8);
    expect(nx).toBeCloseTo(-0.6, 9); expect(nz).toBeCloseTo(0.8, 9);
  });
  it("climbs out of the gutter by exactly the rise it was given", () => {
    for (const rise of [0.5, 4, 12]) {
      const p = profileOf(rise, law.gutter);
      const out = integrate((s) => angleAt(p, s), 0, 0, [p.dc], 256);
      expect(out[1]).toBeCloseTo(rise, 2);
    }
    expect(profileOf(0, law.gutter).dc).toBe(0);
  });
  it("lies flat from the block's spine edge closed, and bound at the gutter open — its fore-edge drawn in the more it climbs (the fan)", () => {
    const closed = restSheet(F, F.b + 5, 0, law.gutter);
    expect(closed.x0).toBeCloseTo(F.xp0, 9); expect(closed.len).toBeCloseTo(F.Wp, 9); expect(closed.profile.dc).toBe(0);
    const lo = restSheet(F, F.b + 0.5, 1, law.gutter);
    const hi = restSheet(F, F.b + F.T - 0.1, 1, law.gutter);
    expect(hi.x0).toBeCloseTo(F.xg, 9);
    const ss = [0, hi.len];
    const eLo = sampleRest(lo, ss);
    const eHi = sampleRest(hi, ss);
    expect(eHi[5]).toBeCloseTo(F.b + F.T - 0.1, 2);   // it reaches its height
    expect(eHi[4]).toBeLessThan(eLo[4] as number);      // and its fore-edge is nearer the gutter
  });
  it("turns a sheet between the two stacks' curves, keeping its length", () => {
    const ss = sheetSamples(F.Wo, 40);
    const ys = [0];
    const at = (phi: number, psi: number) => sampleAir(F, { index: 10, phi, psi, twist: 0 }, 30, 20, 1, ss, ys, law).pos;
    const rest = sampleRest(restSheet(F, F.b + 30.5 * F.spec.sheet, 1, law.gutter), ss);
    const a0 = at(0, 0);
    for (let i = 0; i < ss.length; i++) { expect(a0[i * 3]).toBeCloseTo(rest[i * 4] as number, 9); expect(a0[i * 3 + 2]).toBeCloseTo(rest[i * 4 + 1] as number, 9); }
    const left = sampleRest(restSheet(F, F.b + 20.5 * F.spec.sheet, 1, law.gutter), ss);
    const a1 = at(Math.PI, Math.PI);
    for (let i = 0; i < ss.length; i += 7) { expect(a1[i * 3]).toBeCloseTo(2 * F.xg - (left[i * 4] as number), 6); expect(a1[i * 3 + 2]).toBeCloseTo(left[i * 4 + 1] as number, 6); }
    // mid-turn, bent: the polyline's length is still the page's
    const mid = at(1.2, 2.1);
    let L = 0;
    for (let i = 1; i < ss.length; i++) L += Math.hypot((mid[i * 3] as number) - (mid[(i - 1) * 3] as number), (mid[i * 3 + 2] as number) - (mid[(i - 1) * 3 + 2] as number));
    expect(L).toBeGreaterThan(F.Wo * 0.995); expect(L).toBeLessThan(F.Wo * 1.001);
  });
});

describe("the mesh", () => {
  it("builds a closed book inside its footprint and thickness, with valid indices and no NaN", () => {
    const m = buildMesh(new MeshWriter(), F, { theta: 0, right: F.spec.sheets, left: 0, rightTop: 0, leftTop: -1, airs: [] }, law);
    expect(m.vcount).toBeGreaterThan(100);
    for (let i = 0; i < m.icount; i++) expect(m.indices[i] as number).toBeLessThan(m.vcount);
    for (let i = 0; i < m.vcount * VERTEX_FLOATS; i++) expect(Number.isFinite(m.vertices[i] as number)).toBe(true);
    expect(m.min[0]).toBeGreaterThanOrEqual(-F.W / 2 - law.spine.bulge * 2 - 0.01);
    expect(m.max[0]).toBeLessThanOrEqual(F.W / 2 + 0.01);
    expect(m.max[2]).toBeLessThanOrEqual(2 * F.b + F.T + 0.01);
    expect(m.min[2]).toBeGreaterThanOrEqual(-0.01);
  });
  it("opens across the spread, a sheet in the air adding its grid", () => {
    const pose = { theta: Math.PI, right: 40, left: 24, rightTop: 24, leftTop: 23, airs: [] };
    const open = buildMesh(new MeshWriter(), F, pose, law);
    expect(open.min[0]).toBeLessThan(-F.W / 2 - F.sw - F.W + 1);
    expect(open.max[2]).toBeLessThan(F.b + 40 * F.spec.sheet + 1);
    const turning = buildMesh(new MeshWriter(), F, { ...pose, right: 39, airs: [{ index: 24, phi: 1.2, psi: 1.8, twist: 0.2 }] }, law);
    expect(turning.vcount).toBeGreaterThan(open.vcount);
    expect(turning.max[2]).toBeGreaterThan(80);   // a sheet standing up
  });
});

describe("the motion", () => {
  it("opens on its spring, lands, and plays the flutter back onto the right stack", () => {
    const m = newMotion(64);
    setOpen(m, true);
    let peak = 0;
    for (let t = 0; t < 3; t += 1 / 60) { stepMotion(m, 1 / 60, law); peak = Math.max(peak, m.theta); }
    expect(m.theta).toBe(Math.PI);
    expect(peak).toBeGreaterThan(Math.PI);   // a breath of overshoot, bounced off the desk
    expect(m.fluttered).toBe(true);
    expect(m.sheets.every((s) => !s.air && s.side === 0)).toBe(true);
  });
  it("turns forward and back by key, never past either end", () => {
    const m = newMotion(4, 0, true);
    expect(turnPage(m, -1, law)).toBe(false);
    expect(turnPage(m, 1, law)).toBe(true);
    settle(m);
    expect(counts(m)).toEqual({ right: 3, left: 1 });
    expect(spreadOf(m)).toEqual({ left: 2, right: 3 });
    for (let i = 0; i < 3; i++) turnPage(m, 1, law);
    settle(m);
    expect(turnPage(m, 1, law)).toBe(false);
    expect(leftTop(m)).toBe(3); expect(rightTop(m)).toBe(-1);
    expect(turnPage(m, -1, law)).toBe(true);
    settle(m);
    expect(counts(m)).toEqual({ right: 1, left: 3 });
  });
  it("turns no page in a closed book, and closing lands the sheets in the air", () => {
    const m = newMotion(8);
    expect(turnPage(m, 1, law)).toBe(false);
    const o = newMotion(8, 0, true);
    turnPage(o, 1, law); stepMotion(o, 0.05, law);
    setOpen(o, false);
    expect(o.sheets.some((s) => s.air)).toBe(false);
  });
  it("turns a page by hand: dragged past the middle it goes over, let go early it falls back", () => {
    const over = newMotion(8, 2, true);
    const i = grabSheet(over, 0) as number;
    expect(i).toBe(2);
    for (let k = 0; k < 30; k++) { dragSheet(over, i, F.xg - 60, F.xg, F.Wo * 0.9, F.Wo, 0.5, law); stepMotion(over, 1 / 60, law); }
    releaseSheet(over, i); settle(over);
    expect(counts(over).left).toBe(3);
    const back = newMotion(8, 2, true);
    const j = grabSheet(back, 0) as number;
    for (let k = 0; k < 20; k++) { dragSheet(back, j, F.W / 2 - 40, F.xg, F.Wo * 0.9, F.Wo, 0, law); stepMotion(back, 1 / 60, law); }
    releaseSheet(back, j); settle(back);
    expect(counts(back).left).toBe(2);
  });
  it("peeks the right top sheet's corner as an air in the pose", () => {
    const m = newMotion(8, 3, true);
    m.peek = 1;
    const p = poseOf(m, law);
    expect(p.airs).toHaveLength(1);
    expect(p.airs[0]?.index).toBe(3);
    expect(p.right).toBe(4);
    expect(p.rightTop).toBe(4);
  });
});

describe("the hit test", () => {
  const g = rigidOf({ cx: 0, cy: 0, angle: 0, lift: 0, tiltX: 0, tiltY: 0, zc: F.b + F.T / 2 });
  const e = eyeOf({ x: -600, y: -400, zoom: 1 }, { width: 1200, height: 800 }, law.eye);
  it("finds the closed case under its middle, and nothing beside it", () => {
    const pose = { theta: 0, right: 64, left: 0, rightTop: 0, leftTop: -1, airs: [] };
    const mesh = buildMesh(new MeshWriter(), F, pose, law);
    expect(pickNotebook(F, pose, law, g, e, 0, 0, mesh)?.part).toBe("case");
    expect(pickNotebook(F, pose, law, g, e, 400, 0, mesh)).toBeNull();
  });
  it("finds a page open, and where on it: the arc length from the gutter", () => {
    const pose = { theta: Math.PI, right: 40, left: 24, rightTop: 24, leftTop: 23, airs: [] };
    const mesh = buildMesh(new MeshWriter(), F, pose, law);
    const r = pickNotebook(F, pose, law, g, e, 40, 10, mesh);
    expect(r?.part).toBe("page");
    // its arc length runs a little past the straight distance from the gutter: the climb out of the valley is longer than its run
    if (r?.part === "page") { expect(r.side).toBe(0); expect(r.s).toBeGreaterThan(40 - F.xg); expect(r.s).toBeLessThan(40 - F.xg + 8); expect(r.y).toBeCloseTo(10, 0); }
    const l = pickNotebook(F, pose, law, g, e, 2 * F.xg - 60, -30, mesh);
    expect(l?.part === "page" && l.side).toBe(1);
  });
});

describe("the placement and the lamp", () => {
  it("places and unplaces a book: the rigid transform and its inverse", () => {
    const g = rigidOf({ cx: 120, cy: -40, angle: 0.3, lift: 12, tiltX: 0.05, tiltY: -0.08, zc: 9 });
    const p = toWorld(g, 10, 20, 5);
    const q = toLocal(g, p[0], p[1], p[2]);
    expect(q[0]).toBeCloseTo(10, 9); expect(q[1]).toBeCloseTo(20, 9); expect(q[2]).toBeCloseTo(5, 9);
    const inv = inverseOf(g);
    const r = toWorld(inv, p[0], p[1], p[2]);
    expect(r[0]).toBeCloseTo(10, 9);
    const m = matrixOf(g);
    expect((m[0] as number) * 10 + (m[4] as number) * 20 + (m[8] as number) * 5 + (m[12] as number)).toBeCloseTo(p[0], 5);
  });
  it("points at the lamp with the shadow's slope capped", () => {
    const far = lampDir({ x: 2000, y: 0, h: 500 }, -5000, 0, 2.2);
    expect(Math.hypot(far[0], far[1]) / far[2]).toBeCloseTo(2.2, 9);
    const near = lampDir({ x: 100, y: 0, h: 1000 }, 0, 0, 2.2);
    expect(near[0] / near[2]).toBeCloseTo(0.1, 9);
  });
  it("frames a book's box inside the shadow map's clip space", () => {
    const L = lampDir({ x: 1930, y: -826, h: 994 }, 0, 0, 2.2);
    const lo = [-90, -126, 0] as const;
    const hi = [90, 126, 18] as const;
    const f = lightFrame(L, lo, hi, 1024);
    for (let c = 0; c < 8; c++) {
      const P = [c & 1 ? hi[0] : lo[0], c & 2 ? hi[1] : lo[1], c & 4 ? hi[2] : lo[2]];
      const m = f.matrix;
      const x = (m[0] as number) * (P[0] as number) + (m[4] as number) * (P[1] as number) + (m[8] as number) * (P[2] as number) + (m[12] as number);
      const z = (m[2] as number) * (P[0] as number) + (m[6] as number) * (P[1] as number) + (m[10] as number) * (P[2] as number) + (m[14] as number);
      expect(Math.abs(x)).toBeLessThan(1); expect(z).toBeGreaterThan(0); expect(z).toBeLessThan(1);
    }
  });
});

describe("the pen", () => {
  it("thins as it hurries and stays within its nib's bounds", () => {
    const slow = nibWidth(PEN, 0, null);
    const fast = nibWidth(PEN, 5000, null);
    expect(fast).toBeLessThan(slow);
    expect(fast).toBeCloseTo(PEN.width * PEN.thin, 9);
    expect(nibWidth(PEN, 0, 1)).toBeCloseTo(PEN.width * PEN.thick, 9);
  });
  it("maps a page point into its raster", () => {
    expect(texelOf({ s: F.Wo, y: F.Hp }, F.Wo, F.Hp)).toEqual([INK_W, INK_H]);
    expect(texelOf({ s: 0, y: 0 }, F.Wo, F.Hp)).toEqual([0, 0]);
  });
});
