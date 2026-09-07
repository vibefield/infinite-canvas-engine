// @vitest-environment node
import { describe, expect, it } from "vitest";
import { IDLE, REST, resolve } from "../../src/card/choreography";
import { LIFT, SHADOW } from "../../src/theme";
import { pick, sdFrame, sdInner, sdOuter } from "../../src/card/sdf";
import { composeStyle, PRODUCT, PRODUCT_CORNER, REFERENCE, REFERENCE_CARD, STYLES, styleViolations } from "../../src/card/sheet";
import { settled, spring } from "../../src/card/springs";

const refCard = {
  centre: REFERENCE_CARD.centre,
  contentHalf: [REFERENCE_CARD.outerHalf[0] - REFERENCE.thickness, REFERENCE_CARD.outerHalf[1] - REFERENCE.thickness] as const,
};

describe("resolve", () => {
  it("reproduces the reference geometry at full reveal", () => {
    const G = resolve(REFERENCE, refCard, REST);
    expect(G.half[0]).toBeCloseTo(971.42, 6);
    expect(G.half[1]).toBeCloseTo(469.76, 6);
    expect(G.outerR).toBeCloseTo(67.31, 6);
    expect(G.ih[0]).toBeCloseTo(971.42 - 23.06, 6);
    expect(G.nw[2]).toBeCloseTo(515.77, 6);
    expect(G.closeR).toBeCloseTo(35.2, 6);
    expect(G.closeC[0]).toBeCloseTo(1000.147 + 971.42 - 62.57, 6);
  });

  it("is a plain rounded card at idle: no border, no notches, no buttons, content pinned", () => {
    const G = resolve(REFERENCE, refCard, IDLE);
    expect(G.half[0] - G.ih[0]).toBeLessThan(1e-6);       // thickness 0
    expect(G.nw.every((v) => v === 0)).toBe(true);
    // easeOutBack(0) is 1 − (c1+1) + c1: zero up to floating point. The shader
    // guards the buttons with `> 0.05`, so a 1e-15 radius is idle.
    expect(G.closeR).toBeCloseTo(0, 9);
    expect(G.lockR).toBeCloseTo(0, 9);
    // grow = 1 pins the CONTENT rect: an idle card IS its rect, exactly
    expect(G.ih[0]).toBeCloseTo(refCard.contentHalf[0], 9);
    expect(G.half[0]).toBeCloseTo(refCard.contentHalf[0], 9);
    expect(G.outerR).toBeCloseTo(REFERENCE.baseR[0], 9);
  });

  it("keeps every corner self-consistent across the reveal (rfH + rho ≤ nh, rfV + rho ≤ nw)", () => {
    for (const style of [REFERENCE, PRODUCT]) {
      const card = style === PRODUCT ? { centre: [0, 0] as const, contentHalf: [120, 70] as const } : refCard;
      for (const r of [0, 0.1, 0.3, 0.5, 0.6, 0.8, 0.95, 1]) {
        const G = resolve(style, card, { ...REST, reveal: r });
        for (const i of [0, 1, 2, 3] as const) {
          if (G.nw[i] <= 0) continue;
          expect(G.rfH[i] + G.rho[i]).toBeLessThanOrEqual(G.nh[i] + 1e-9);
          expect(G.rfV[i] + G.rho[i]).toBeLessThanOrEqual(G.nw[i] + 1e-9);
        }
      }
    }
  });

  it("lift scales every length about the centre and nothing else", () => {
    const a = resolve(REFERENCE, refCard, REST);
    const b = resolve(REFERENCE, refCard, { ...REST, lift: 1.05 });
    expect(b.half[0]).toBeCloseTo(a.half[0] * 1.05, 6);
    expect(b.outerR).toBeCloseTo(a.outerR * 1.05, 6);
    expect(b.nw[2]).toBeCloseTo(a.nw[2] * 1.05, 6);
    expect(b.closeR).toBeCloseTo(a.closeR * 1.05, 6);
    expect(b.centre).toEqual(a.centre);
  });

  it("collapses to a disc on delete and is gone at d = 1", () => {
    const mid = resolve(REFERENCE, refCard, { ...REST, del: 0.74 });
    expect(mid.half[0]).toBeCloseTo(mid.half[1], 3);          // a square box…
    expect(mid.outerR).toBeCloseTo(mid.half[0], 3);           // …with full radius: a circle
    const gone = resolve(REFERENCE, refCard, { ...REST, del: 1 });
    expect(gone.half[0]).toBeLessThan(1e-6);
    expect(gone.shadowAlpha).toBeLessThan(1e-6);
  });

  it("wears the §5 shadow recipe by LIFT, not by selection: resting idle or selected, lifted when held", () => {
    for (const m of [IDLE, REST]) {
      const G = resolve(REFERENCE, refCard, m);
      expect(G.shadowSigma).toBeCloseTo(SHADOW.rest.sigma, 9);
      expect(G.shadowOffset).toBeCloseTo(SHADOW.rest.offset, 9);
      expect(G.shadowAlpha).toBeCloseTo(SHADOW.rest.alpha, 9);
      expect(G.frameAlpha).toBe(1);
    }
    const held = resolve(REFERENCE, refCard, { ...REST, held: 1, lift: LIFT.scale });
    expect(held.shadowSigma).toBeCloseTo(SHADOW.lifted.sigma * LIFT.scale, 9);   // the shadow rides the scaled card
    expect(held.shadowOffset).toBeCloseTo(SHADOW.lifted.offset * LIFT.scale, 9);
    expect(held.shadowAlpha).toBeCloseTo(SHADOW.lifted.alpha, 9);
    expect(held.frameAlpha).toBeCloseTo(LIFT.opacity, 9);
  });

  it("the §7 selection ring arrives with the border and leaves with the delete", () => {
    expect(resolve(REFERENCE, refCard, IDLE).ring).toBe(0);
    expect(resolve(REFERENCE, refCard, REST).ring).toBe(1);
    const half = resolve(REFERENCE, refCard, { ...REST, reveal: 0.25 });
    expect(half.ring).toBeGreaterThan(0.5);
    expect(half.ring).toBeLessThan(1);
    expect(resolve(REFERENCE, refCard, { ...REST, del: 0.5 }).ring).toBe(0);
  });
});

describe("styles", () => {
  it("the shipped styles satisfy their own constraints", () => {
    expect(styleViolations(REFERENCE, refCard.contentHalf)).toEqual([]);
    expect(styleViolations(PRODUCT, [120, 70])).toEqual([]);
    expect(styleViolations(STYLES.plain, refCard.contentHalf)).toEqual([]);
  });

  it("the product style's buttons keep a hit-target floor the reference scaled down would not", () => {
    expect(PRODUCT.btn.radius).toBeGreaterThanOrEqual(12);   // the smallest control this system has is 24 px
    // and the pocket houses the button: inset + radius inside the notch
    expect(PRODUCT.btn.insetY + PRODUCT.btn.radius).toBeLessThan(PRODUCT.nh[0] + PRODUCT.thickness);
  });

  it("catches a button crossing the outer corner arc — the old product numbers under a 22 px card", () => {
    const { outerR: _ear, ...rest } = PRODUCT;
    const old = { ...rest, baseR: [22, 22, 22, 22] as const, thickness: 3.5, btn: { insetX: 15, insetY: 15, radius: 10, glyphW: 7, glyphR: 0.9 } };
    const v = styleViolations(old, [120, 70]);
    expect(v.some((m) => m.includes("outer corner arc"))).toBe(true);   // 0.65 px left for a 1.5 px ring
    expect(styleViolations({ ...old, outerR: 15 }, [120, 70])).toEqual([]);   // concentric with the button: clear
  });
});

describe("the product corner composition", () => {
  const medium = { centre: [0, 0] as const, contentHalf: [164.5, 77.5] as const, radius: 22 };
  const small = { centre: [0, 0] as const, contentHalf: [77.5, 77.5] as const, radius: 22 };
  const rb = PRODUCT_CORNER.control / 2;
  const cl = PRODUCT_CORNER.clearance;

  it("derives every corner number from control · clearance · thickness", () => {
    const ear = PRODUCT.outerR ?? Number.NaN;
    expect(PRODUCT.btn.radius).toBe(rb);
    expect(ear).toBe(rb + cl);                                 // the ear
    expect(PRODUCT.btn.insetX).toBe(ear);                      // the button IS the arc's centre
    expect(PRODUCT.rho[0]).toBe(rb + cl);                      // the bay: a uniform ring
    expect(PRODUCT.rfH[0]).toBe(ear - PRODUCT.thickness);      // tangent fillet
    expect(PRODUCT.nw).toEqual(PRODUCT.nh);                    // no shelf: four equal ears
    expect(PRODUCT.baseR[0]).toBe(22);                         // --vf-radius-card
    expect(styleViolations(PRODUCT, small.contentHalf)).toEqual([]);
    expect(styleViolations(composeStyle({ ...PRODUCT_CORNER, shelf: 60 }), medium.contentHalf)).toEqual([]);
  });

  it("is concentric: outer arc, bay arc and button share a centre; the ring is `clearance` wide all round", () => {
    const G = resolve(PRODUCT, medium, REST);
    expect(G.outerR).toBeCloseTo(rb + cl, 9);
    expect(G.closeC[0]).toBeCloseTo(G.centre[0] + G.half[0] - G.outerR, 9);
    expect(G.closeC[1]).toBeCloseTo(G.centre[1] - G.half[1] + G.outerR, 9);
    expect(G.lockC[0]).toBeCloseTo(G.centre[0] - G.half[0] + G.outerR, 9);
    expect(G.closeR).toBeCloseTo(rb, 9);
    // from the button's centre: `ear` to the outer edge, `bay` to the content
    expect(-sdOuter(G, G.closeC[0], G.closeC[1])).toBeCloseTo(rb + cl, 9);
    expect(sdInner(G, G.closeC[0], G.closeC[1])).toBeCloseTo(rb + cl, 9);
    // walk the button's rim: never nearer than `clearance` to either boundary…
    let minOut = 1e9;
    let minIn = 1e9;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 90) {
      const x = G.closeC[0] + rb * Math.cos(a);
      const y = G.closeC[1] + rb * Math.sin(a);
      minOut = Math.min(minOut, -sdOuter(G, x, y));
      minIn = Math.min(minIn, sdInner(G, x, y));
    }
    expect(minOut).toBeCloseTo(cl, 6);
    expect(minIn).toBeCloseTo(cl, 6);
    // …and exactly `clearance` across the corner diagonal, where the old style clipped
    const d = rb * Math.SQRT1_2;
    expect(-sdOuter(G, G.closeC[0] + d, G.closeC[1] - d)).toBeCloseTo(cl, 6);
    expect(sdInner(G, G.closeC[0] - d, G.closeC[1] + d)).toBeCloseTo(cl, 6);
    // the pop's overshoot and the hover swell stay inside the ring
    expect(rb * 1.1 * 1.07).toBeLessThan(rb + cl);
  });

  it("the revealed outer radius is the ear's, the idle one the card's; the reveal turns one into the other", () => {
    expect(resolve(PRODUCT, medium, IDLE).outerR).toBeCloseTo(22, 9);
    expect(resolve(PRODUCT, medium, REST).outerR).toBeCloseTo(rb + cl, 9);
    let prev = 22;
    for (let r = 0; r <= 1; r += 0.05) {
      const o = resolve(PRODUCT, medium, { ...REST, reveal: r }).outerR;
      expect(o).toBeLessThanOrEqual(prev + 1e-9); prev = o;   // monotone, no bounce
    }
    // plain corners stay concentric with the content: radius + thickness
    expect(resolve(STYLES.plain, refCard, REST).outerR).toBeCloseTo(REFERENCE.baseR[0] + REFERENCE.thickness, 9);
  });

  it("the bay blooms out of the card's own rounded corner: the content boundary never jumps", () => {
    // Sample the inner field on a lattice over the TL corner for a dense reveal
    // sweep. The boundary moves continuously (≤ ~1 px per step at this Δr);
    // the old model snapped a 22 px arc to a square corner at the notch's onset —
    // a 6.4 px jump on the diagonal.
    const pts: [number, number][] = [];
    for (let i = 0; i <= 12; i++) for (let j = 0; j <= 12; j++) pts.push([-medium.contentHalf[0] + i * 4, -medium.contentHalf[1] + j * 4]);
    let worst = 0;
    let prev: number[] | null = null;
    for (let r = 0; r <= 1.0001; r += 0.004) {
      const G = resolve(PRODUCT, medium, { ...REST, reveal: r });
      const vals = pts.map(([x, y]) => sdInner(G, x, y));
      if (prev) for (let k = 0; k < vals.length; k++) worst = Math.max(worst, Math.abs((vals[k] as number) - (prev[k] as number)));
      prev = vals;
    }
    expect(worst).toBeLessThan(1.5);
    // and fully revealed the intersection is the notched card exactly: the corner arc is inside the bay
    const G = resolve(PRODUCT, medium, REST);
    const cx = -medium.contentHalf[0] + 22 * (1 - Math.SQRT1_2);
    const cy = -medium.contentHalf[1] + 22 * (1 - Math.SQRT1_2);   // a point ON the idle arc
    expect(sdInner(G, cx, cy)).toBeGreaterThan(5);   // deep in the bay
  });
});

describe("sdf mirror", () => {
  const G = resolve(REFERENCE, refCard, REST);

  // The metric property itself: |d(p) − d(q)| ≤ |p − q| for any two points.
  // (Not hypot-of-secants — across a crease those legitimately exceed 1 even
  // for a true SDF, because two axis secants straddling a kink are not a gradient.)
  it("is 1-Lipschitz on the exact path: |Δd| never exceeds |Δp|", () => {
    let worst = 0;
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let i = 0; i < 6000; i++) {
      const x = 1000 + (rnd() - 0.5) * 2400;
      const y = 532 + (rnd() - 0.5) * 1300;
      const a = rnd() * Math.PI * 2;
      const len = 0.5 + rnd() * 60;
      const qx = x + Math.cos(a) * len;
      const qy = y + Math.sin(a) * len;
      worst = Math.max(worst, Math.abs(sdFrame(G, x, y) - sdFrame(G, qx, qy)) / len);
    }
    expect(worst).toBeLessThanOrEqual(1.0005);
  });

  it("frame and inner coverages cannot crack: inside the border dFrame == -dInner", () => {
    const x = G.centre[0];
    const y = G.centre[1] - G.half[1] + REFERENCE.thickness * 0.5;   // mid-border, top edge
    expect(sdFrame(G, x, y)).toBeCloseTo(-sdInner(G, x, y), 9);
  });

  it("routes a click by position: lock, close, content, frame, outside", () => {
    expect(pick(G, G.lockC[0], G.lockC[1])).toBe("lock");
    expect(pick(G, G.closeC[0], G.closeC[1])).toBe("close");
    expect(pick(G, G.centre[0], G.centre[1])).toBe("content");
    expect(pick(G, G.centre[0], G.centre[1] - G.half[1] + 5)).toBe("frame");
    expect(pick(G, G.centre[0], G.centre[1] - G.half[1] - 5)).toBe("outside");
    // the BR shelf is frame, not content
    expect(pick(G, G.centre[0] + G.half[0] - 200, G.centre[1] + G.half[1] - 50)).toBe("frame");
  });

  it("fast and exact paths share a silhouette", () => {
    for (const [x, y] of [[300, 100], [1700, 900], [1000, 60], [1955, 532], [1500, 880]] as const) {
      expect(Math.sign(sdInner(G, x, y, true))).toBe(Math.sign(sdInner(G, x, y, false)));
    }
    expect(sdOuter(G, G.centre[0], G.centre[1])).toBeLessThan(0);
  });
});

describe("spring", () => {
  it("is critically damped: reaches the target with no overshoot and settles", () => {
    let x = 0;
    let v = 0;
    let peak = 0;
    for (let t = 0; t < 1.5; t += 1 / 120) { [x, v] = spring(x, v, 1, 2.4, 1, 1 / 120); peak = Math.max(peak, x); }
    expect(peak).toBeLessThanOrEqual(1 + 1e-6);
    expect(settled(x, v, 1)).toBe(true);
  });

  it("reverses from mid-flight without a snap", () => {
    let x = 0;
    let v = 0;
    for (let i = 0; i < 20; i++) [x, v] = spring(x, v, 1, 2.4, 1, 1 / 120);
    const before = x;
    [x, v] = spring(x, v, 0, 2.4, 1, 1 / 120);
    expect(Math.abs(x - before)).toBeLessThan(0.05);
  });

  it("underdamped overshoots and settles — the lock's nod", () => {
    let x = 0;
    let v = 0;
    let peak = 0;
    for (let t = 0; t < 1.2; t += 1 / 120) { [x, v] = spring(x, v, 1, 3.6, 0.72, 1 / 120); peak = Math.max(peak, x); }
    expect(peak).toBeGreaterThan(1.01);
    expect(settled(x, v, 1, 5e-3)).toBe(true);
  });
});
