// @vitest-environment node
// THE SHELL (packs/vf-frame, 2026-09-23 — James's mockup): a rim of solid chrome around a well in
// the card's own surface, the well's corners notched into bays for the two controls, the content
// inside it never cut. Selection reveals the shell out of the content's edge; the lift UN-REVEALS
// it while the card scales, so the shell's outer edge ends on the lifted card and nothing shows
// while it moves. These pin the composition, the reveal, the un-reveal, the bays, the delete
// morph, the material, and the CPU mirror that hit-tests what the shader draws.
import { describe, expect, it } from "vitest";
import { LIFT as LIFT_HIDE, resolve, VF_IDLE, VF_REST } from "../../src/packs/vf-frame/choreography";
import { LIFT, LINES, SHADOW } from "../../src/theme";
import { pick, sdFrame, sdInner, sdOuter, sdWell } from "../../src/packs/vf-frame/sdf";
import { newVfSprings, stepVfSprings, VF_PARTS, VF_TUNING, vfFrame } from "../../src/packs/vf-frame";
import { cornersOf, outerRadiusOf, PLAIN, PRODUCT, PRODUCT_SHELL, reachOf, shellStyle, STYLES, styleViolations } from "../../src/packs/vf-frame/sheet";
import { settled, spring } from "../../src/card/springs";

const P = PRODUCT;
const M = P.well + P.band;                 // 44: the shell's reach beyond the content
const { ear, bay, notch } = cornersOf(P);  // 26 · 22 · 38
const medium = { centre: [400, 300] as const, contentHalf: [164.5, 77.5] as const, radius: 22 };
const small = { centre: [0, 0] as const, contentHalf: [77.5, 77.5] as const, radius: 22 };
const held = { ...VF_REST, held: 1, lift: LIFT.scale };
const [cx, cy] = medium.centre;
const [hx, hy] = medium.contentHalf;

describe("the composition (the mockup's numbers)", () => {
  it("derives the ear, the bay and the notch from control · clearance · band", () => {
    expect(PRODUCT_SHELL).toEqual({ name: "product", band: 10, well: 34, radius: 22, control: 32, clearance: 10, bayClearance: 6 });
    expect(P.btn.radius).toBe(16);
    expect(ear).toBe(26);                       // the button's inset from the outer corner, and the outer radius
    expect(bay).toBe(22);                       // the arc cut into the well, centred on the button
    expect(notch).toBe(38);                     // ear + bay − band: 48 from the outer corner
    expect(P.fillet).toBe(16);                  // tangent: ear − band
    expect(outerRadiusOf(P)).toBe(ear);
    expect(outerRadiusOf(PLAIN)).toBe(22 + 34 + 10);
    expect(reachOf(P)).toBe(M);
  });

  it("the shipped styles satisfy their own constraints on the product's card sizes, and the bay clears the content", () => {
    for (const s of Object.values(STYLES)) {
      expect(styleViolations(s, [164.5, 77.5])).toEqual([]);
      expect(styleViolations(s, [77.5, 77.5])).toEqual([]);
    }
    expect(styleViolations(shellStyle({ ...PRODUCT_SHELL, well: 10 }), [164.5, 77.5]).some((m) => m.includes("bites the content"))).toBe(true);
    // judged at the WORST content radius, 0 (review, 2026-09-23): a well of 26 clears the style's own radius 22 by
    // 1.3 px and bites a radius-8 card by 4.5 px — a card carries any radius, so the style must clear them all
    expect(styleViolations(shellStyle({ ...PRODUCT_SHELL, well: 26 }), [164.5, 77.5]).some((m) => m.includes("bites the content"))).toBe(true);
    expect(styleViolations(P, [164.5, 77.5])).toEqual([]);   // PRODUCT clears radius 0 by 3.5 px
    expect(styleViolations(shellStyle({ band: 1, well: 34, radius: 22 }), [100, 60]).some((m) => m.includes("selection ring"))).toBe(true);
    expect(styleViolations(shellStyle({ band: 0, well: 34, radius: 22 }), [100, 60]).some((m) => m.includes("positive"))).toBe(true);
    expect(styleViolations(shellStyle({ ...PRODUCT_SHELL, control: 16 }), [100, 60]).some((m) => m.includes("pointer floor"))).toBe(true);
    expect(styleViolations(P, [3, 60]).some((m) => m.includes("merge"))).toBe(true);   // the well is 37 wide, the notch 38
    expect(styleViolations(P, [LINES.ring, LINES.ring]).length).toBeGreaterThan(0);
  });
});

describe("the shell law", () => {
  it("idle: a plain rounded card — the content IS the card, no shell, no bays, no buttons", () => {
    const G = resolve(P, medium, VF_IDLE);
    expect(G.half).toEqual([hx, hy]);
    expect(G.ih).toEqual([hx, hy]);
    expect(G.wellHalf).toEqual([hx, hy]);
    expect(G.outerR).toBe(22);
    expect(G.radius).toBe(22);
    expect(G.shell).toBe(0);
    expect(G.ring).toBe(0);
    expect(G.nw.every((v) => v === 0)).toBe(true);
    expect(G.closeR).toBe(0);
    expect(G.lockR).toBe(0);
    expect(G.scale).toBe(1);
  });

  it("selected at rest: the well and the rim stand around the content; the content is pinned and never cut", () => {
    const G = resolve(P, medium, VF_REST);
    expect(G.shell).toBe(1);
    expect(G.half).toEqual([hx + M, hy + M]);
    expect(G.outerR).toBe(ear);
    expect(G.wellHalf).toEqual([hx + P.well, hy + P.well]);
    expect(G.wellR).toBe(22 + P.well);
    expect(G.ih).toEqual([hx, hy]);          // the content, exactly
    expect(G.radius).toBe(22);
    expect(G.nw).toEqual([notch, notch, notch, notch]);
    expect(G.nh).toEqual([notch, notch, notch, notch]);
    expect(G.rho).toEqual([bay, bay, bay, bay]);
    expect(G.rf).toEqual([16, 16, 16, 16]);
    expect(G.ring).toBe(1);
    // the buttons sit `ear` in from the plate's outer corners: the lock TL, the close TR
    expect(G.lockC).toEqual([cx - G.half[0] + ear, cy - G.half[1] + ear]);
    expect(G.closeC).toEqual([cx + G.half[0] - ear, cy - G.half[1] + ear]);
    expect(G.closeR).toBeCloseTo(16, 9);
    expect(G.lockR).toBeCloseTo(16, 9);
  });

  it("held: the card scales by the host's lift and the shell is UN-REVEALED — its outer edge IS the lifted card", () => {
    const G = resolve(P, medium, held);
    expect(G.shell).toBe(0);
    expect(G.ih).toEqual([hx * LIFT.scale, hy * LIFT.scale]);
    expect(G.radius).toBeCloseTo(22 * LIFT.scale, 9);
    expect(G.half).toEqual(G.ih);              // nothing of the shell shows
    expect(G.outerR).toBeCloseTo(G.radius, 9);
    expect(G.wellHalf).toEqual(G.ih);
    expect(G.nw.every((v) => v === 0)).toBe(true);
    expect(G.closeR).toBe(0);
    expect(G.lockR).toBe(0);
    expect(G.ring).toBe(0);
    expect(G.scale).toBe(LIFT.scale);
  });

  it("the un-reveal leaves in order: buttons first, then the bays, then the well and the rim shrink into the card", () => {
    let prevShell = 1; let prevNotch = notch;
    for (const h of [0.1, 0.2, 0.35, 0.5, 0.6, 0.8, 1]) {
      const G = resolve(P, medium, { ...VF_REST, held: h, lift: 1 + (LIFT.scale - 1) * h });
      expect(G.shell).toBeLessThanOrEqual(prevShell);
      expect(G.nw[0]).toBeLessThanOrEqual(prevNotch);
      expect(G.half[0] - G.ih[0]).toBeCloseTo(M * G.shell, 9);          // the rim and the well ride the shell's presence
      expect(G.wellHalf[0] - G.ih[0]).toBeCloseTo(P.well * G.shell, 9);
      if (h >= LIFT_HIDE.buttons[1]) expect(G.closeR).toBe(0);
      if (h >= LIFT_HIDE.bays[1]) expect(G.nw[0]).toBe(0);
      prevShell = G.shell; prevNotch = G.nw[0];
    }
    const early = resolve(P, medium, { ...VF_REST, held: 0.2, lift: 1.01 });
    expect(early.closeR).toBeLessThan(16);
    expect(early.nw[0]).toBeGreaterThan(0);
    expect(early.shell).toBeGreaterThan(0.4);
  });

  it("the buttons leave before the rim shrinks under them: the close button's disc never enters the content at any point of the lift (review, 2026-09-23)", () => {
    // buttons that lingered (an ease-in over [0, 0.35]) rode the ease-out rim over the content for two frames per grab
    let worst = Number.NEGATIVE_INFINITY;
    for (let h = 0; h <= 1; h += 0.01) {
      const G = resolve(P, medium, { ...VF_REST, held: h, lift: 1 + (LIFT.scale - 1) * h });
      if (G.closeR <= 0) continue;
      // sdInner: positive outside the content — the button's centre must sit at least its radius outside it
      worst = Math.max(worst, G.closeR - sdInner(G, G.closeC[0], G.closeC[1]));
    }
    expect(worst).toBeLessThan(-16);   // 16.3 px of clearance at the nearest, measured on a 0.01 grid of h
    expect(resolve(P, medium, { ...VF_REST, held: 0.12, lift: 1.006 }).closeR).toBe(0);   // gone at the window's end
    expect(resolve(P, medium, { ...VF_REST, held: 0.3, lift: 1.015 }).closeR).toBe(0);    // where it used to sit inside the content
  });

  it("a grabbed card that was not selected simply scales: no shell appears", () => {
    const G = resolve(P, medium, { ...VF_IDLE, held: 0.5, lift: 1.025 });
    expect(G.shell).toBe(0);
    expect(G.half).toEqual(G.ih);
    expect(G.ih).toEqual([hx * 1.025, hy * 1.025]);
  });

  it("released while still selected: the shell re-blooms — pure in the motion, the same frames in reverse", () => {
    const a = resolve(P, medium, { ...VF_REST, held: 0.4, lift: 1.02 });
    const b = resolve(P, medium, { ...VF_REST, held: 0.4, lift: 1.02 });
    expect(a).toEqual(b);
    expect(resolve(P, medium, { ...VF_REST, held: 0, lift: 1 })).toEqual(resolve(P, medium, VF_REST));
  });

  it("the reveal: the well and the rim grow OUT of the content's edge over the first half; the bays bloom after, staggered, BR last", () => {
    let prev = -1;
    for (const r of [0, 0.1, 0.25, 0.4, 0.5, 0.75, 1]) {
      const G = resolve(P, medium, { ...VF_REST, reveal: r });
      expect(G.shell).toBeGreaterThanOrEqual(prev);
      expect(G.half[0] - G.ih[0]).toBeCloseTo(M * G.shell, 9);
      expect(G.ih).toEqual([hx, hy]);
      prev = G.shell;
    }
    expect(resolve(P, medium, { ...VF_REST, reveal: 0.5 }).shell).toBeCloseTo(1, 9);
    const mid = resolve(P, medium, { ...VF_REST, reveal: 0.35 });
    expect(mid.nw[0]).toBeGreaterThan(0);
    expect(mid.nw[2]).toBeLessThan(mid.nw[0]);
    expect(mid.lockR).toBe(0);                                          // the buttons come after the bays
    expect(resolve(P, medium, { ...VF_REST, reveal: 0.05 }).nw[0]).toBe(0);
  });

  it("collapses to a disc on delete and is gone at d = 1", () => {
    const mid = resolve(P, medium, { ...VF_REST, del: 0.74 });
    expect(mid.half[0]).toBeCloseTo(mid.half[1], 3);
    expect(mid.outerR).toBeCloseTo(mid.half[0], 3);
    expect(resolve(P, medium, { ...VF_REST, del: 0.3 }).nw[0]).toBe(0);    // the bays close before the box gets small
    // the dot wears the CHROME (review, 2026-09-23): the well has closed to nothing under it, the plate is all rim
    expect(mid.wellHalf[0]).toBeLessThan(mid.half[0] * 0.05);
    expect(sdWell(mid, mid.centre[0] + mid.half[0] / 2, mid.centre[1])).toBeGreaterThan(0);   // halfway out from the dot's centre: outside the well — rim, not surface
    const gone = resolve(P, medium, { ...VF_REST, del: 1 });
    expect(gone.half[0]).toBeLessThan(1e-6);
    expect(gone.shadowAlpha).toBeLessThan(1e-6);
  });

  it("wears the §5 shadow recipe by LIFT, not by selection: resting idle or selected, lifted when held (riding the scaled card)", () => {
    for (const m of [VF_IDLE, VF_REST]) {
      const G = resolve(P, medium, m);
      expect(G.shadowSigma).toBeCloseTo(SHADOW.rest.sigma, 9);
      expect(G.shadowOffset).toBeCloseTo(SHADOW.rest.offset, 9);
      expect(G.shadowAlpha).toBeCloseTo(SHADOW.rest.alpha, 9);
      expect(G.frameAlpha).toBe(1);
    }
    const up = resolve(P, medium, held);
    expect(up.shadowSigma).toBeCloseTo(SHADOW.lifted.sigma * LIFT.scale, 9);
    expect(up.shadowOffset).toBeCloseTo(SHADOW.lifted.offset * LIFT.scale, 9);
    expect(up.shadowAlpha).toBeCloseTo(SHADOW.lifted.alpha, 9);
    expect(up.frameAlpha).toBeCloseTo(LIFT.opacity, 9);
  });

  it("the §7 selection ring arrives with the rim, leaves with the delete, fades with the lift", () => {
    expect(resolve(P, medium, VF_IDLE).ring).toBe(0);
    expect(resolve(P, medium, VF_REST).ring).toBe(1);
    const half = resolve(P, medium, { ...VF_REST, reveal: 0.25 });
    expect(half.ring).toBeGreaterThan(0.5);
    expect(half.ring).toBeLessThan(1);
    expect(resolve(P, medium, { ...VF_REST, del: 0.5 }).ring).toBe(0);
    expect(resolve(P, medium, { ...VF_REST, held: 0.5, lift: 1.025 }).ring).toBeCloseTo(0.5, 9);
  });

  it("a card's own radius is the content's; the plain style has no bays and a concentric plate", () => {
    const own = resolve(P, { centre: [0, 0], contentHalf: [50, 40], radius: 6 }, VF_REST);
    expect(own.radius).toBe(6);
    expect(own.wellR).toBe(6 + P.well);
    expect(own.outerR).toBe(ear);
    const plain = resolve(PLAIN, medium, VF_REST);
    expect(plain.nw).toEqual([0, 0, 0, 0]);
    expect(plain.closeR).toBe(0);
    expect(plain.outerR).toBe(22 + M);
    expect(plain.half).toEqual([hx + M, hy + M]);
  });
});

describe("the CPU mirror — sdf.ts, what the router picks", () => {
  const G = resolve(P, medium, VF_REST);
  /** A point from the plate's outer TL corner, in card units. */
  const pt = (dx: number, dy: number): [number, number] => [cx - G.half[0] + dx, cy - G.half[1] + dy];

  it("partitions the plane: content inside the content's rect, frame in the well and the rim, outside past the plate", () => {
    expect(pick(G, cx, cy)).toBe("content");
    expect(pick(G, cx + hx - 1, cy)).toBe("content");
    expect(pick(G, cx + hx + P.well / 2, cy)).toBe("frame");            // the well
    expect(pick(G, cx + hx + P.well + P.band / 2, cy)).toBe("frame");   // the rim
    expect(pick(G, cx + hx + M + 1, cy)).toBe("outside");
    expect(sdInner(G, cx + hx, cy)).toBeCloseTo(0, 9);
    expect(sdWell(G, cx + hx + P.well, cy)).toBeCloseTo(0, 9);
    expect(sdOuter(G, cx + hx + M, cy)).toBeCloseTo(0, 9);
    expect(sdFrame(G, cx + hx + P.well / 2, cy)).toBeLessThan(0);
    // the well and the rim are the two materials of one frame: the well's field is negative in the well, positive in the rim
    expect(sdWell(G, cx + hx + P.well / 2, cy)).toBeLessThan(0);
    expect(sdWell(G, cx + hx + P.well + P.band / 2, cy)).toBeGreaterThan(0);
  });

  it("the bays: a notch around each button, cut from the well and never from the content", () => {
    // the lock's centre is `ear` in from the corner; the bay's arc `bay` around it
    expect(G.lockC).toEqual(pt(ear, ear));
    expect(pick(G, ...G.lockC)).toBe("lock");
    expect(pick(G, ...G.closeC)).toBe("close");
    // beside the button, still inside the bay: the well is cut here — plate, not well
    const beside = pt(ear + 19, ear);
    expect(pick(G, ...beside)).toBe("frame");
    expect(sdWell(G, ...beside)).toBeGreaterThan(0);
    // past the notch along the top edge: the well
    const inWell = pt(notch + P.band + 8, P.band + 8);
    expect(sdWell(G, ...inWell)).toBeLessThan(0);
    expect(pick(G, ...inWell)).toBe("frame");
    // the content's corner clears the bay: on the ray from the button to the content's arc centre, the bay's edge is outside the content
    const arc = pt(M + 22, M + 22);
    const d = Math.hypot(arc[0] - G.lockC[0], arc[1] - G.lockC[1]);
    const u: readonly [number, number] = [(arc[0] - G.lockC[0]) / d, (arc[1] - G.lockC[1]) / d];
    const onBay: [number, number] = [G.lockC[0] + u[0] * bay, G.lockC[1] + u[1] * bay];
    expect(sdInner(G, ...onBay)).toBeGreaterThan(10);
    // sweep the content's boundary: the frame never crosses it (a bay that bit the content would)
    for (let k = 0; k < 360; k += 3) {
      const a = (k * Math.PI) / 180;
      const px = cx + Math.cos(a) * (hx + 60); const py = cy + Math.sin(a) * (hy + 60);
      let lo = 0; let hi = 1;
      for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (sdInner(G, cx + (px - cx) * m, cy + (py - cy) * m) < 0) lo = m; else hi = m; }
      const bx = cx + (px - cx) * lo; const by = cy + (py - cy) * lo;
      expect(sdFrame(G, bx, by)).toBeGreaterThanOrEqual(-1e-6);
      expect(sdWell(G, bx, by)).toBeLessThan(-8);                       // and the well surrounds it by more than a few px
    }
  });

  it("a lifted card picks as content to its scaled edge and outside past it — no shell to hit", () => {
    const up = resolve(P, medium, held);
    expect(pick(up, cx + hx * LIFT.scale - 0.5, cy)).toBe("content");
    expect(pick(up, cx + hx * LIFT.scale + 0.5, cy)).toBe("outside");
  });

  it("an idle card picks as content to its own edge and outside past it", () => {
    const idle = resolve(P, medium, VF_IDLE);
    expect(pick(idle, cx + hx - 0.5, cy)).toBe("content");
    expect(pick(idle, cx + hx + 0.5, cy)).toBe("outside");
  });

  it("the plate's corner is the ear's arc: T wide on the axes, concentric with the button", () => {
    const corner = pt(ear, ear);
    expect(sdOuter(G, corner[0] - ear * Math.SQRT1_2, corner[1] - ear * Math.SQRT1_2)).toBeCloseTo(0, 9);
  });
});

describe("the pack", () => {
  it("its reach is the well and the rim; its source is the lifted content; it never cuts the content (no clip march)", () => {
    const pack = vfFrame();
    expect(pack.reach?.(22)).toBe(M);
    expect(pack.source(100, 60, 1.05, 22)).toEqual({ hx: 50 * 1.05, hy: 30 * 1.05, r: 22 * 1.05 });
    expect(pack.inner).toBeUndefined();
    expect(vfFrame({ style: PLAIN }).reach?.(22)).toBe(M);
  });

  it("a settled spring snaps to its target — a card at rest resolves exactly as a still of it", () => {
    const s = newVfSprings();
    for (let i = 0; i < 400; i++) stepVfSprings(s, 1 / 120, { hover: VF_PARTS.close, press: null }, true, VF_TUNING);
    expect(s.hoverC).toBe(1);
    expect(s.hoverCV).toBe(0);
    for (let i = 0; i < 400; i++) stepVfSprings(s, 1 / 120, { hover: null, press: null }, true, VF_TUNING);
    expect(s.hoverC).toBe(0);
    let [x, v] = [0, 0];
    for (let i = 0; i < 400; i++) [x, v] = spring(x, v, 1, 5.5, 0.75, 1 / 120);
    expect(settled(x, v, 1)).toBe(true);
  });

  it("the buttons are dead while the card is lifted: a hover mid-drag does not swell them", () => {
    const pack = vfFrame();
    const out = { live: false };
    const ctx = { card: small, material: { shadow: SHADOW, lift: LIFT }, dt: 1 / 60, part: { hover: VF_PARTS.close, press: null }, key: "k", out };
    for (let i = 0; i < 60; i++) pack.resolve({ ...ctx, motion: held });
    expect(pack.springsOf("k").hoverC).toBe(0);
    for (let i = 0; i < 60; i++) pack.resolve({ ...ctx, motion: VF_REST });
    expect(pack.springsOf("k").hoverC).toBeGreaterThan(0.5);
  });
});
