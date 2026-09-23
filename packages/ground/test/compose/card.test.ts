// @vitest-environment node
// The SOCKET (packs/vf-frame, 2026-09-23): the frame is the ring between a card at rest and the
// same card lifted — its inner edge the content's own rounded rect, never cut; its outer edge the
// content grown by the ring; the lift that same growth, so a held card fills the socket and the
// ring is gone while it moves. These pin the law, the reveal, the ears, the delete morph, the
// material, and the CPU mirror that hit-tests what the shader draws.
import { describe, expect, it } from "vitest";
import { LIFT as LIFT_HIDE, resolve, VF_IDLE, VF_REST } from "../../src/packs/vf-frame/choreography";
import { LIFT, LINES, SHADOW } from "../../src/theme";
import { pick, sdFrame, sdInner, sdOuter } from "../../src/packs/vf-frame/sdf";
import { newVfSprings, stepVfSprings, VF_PARTS, VF_TUNING, vfFrame } from "../../src/packs/vf-frame";
import { EARS, earOf, earReachOf, PRODUCT, PRODUCT_SOCKET, reachOf, socketStyle, STYLES, styleViolations } from "../../src/packs/vf-frame/sheet";
import { settled, spring } from "../../src/card/springs";

const T = PRODUCT.thickness;
const medium = { centre: [400, 300] as const, contentHalf: [164.5, 77.5] as const, radius: 22 };
const small = { centre: [0, 0] as const, contentHalf: [77.5, 77.5] as const, radius: 22 };
const held = { ...VF_REST, held: 1, lift: LIFT.scale };

describe("the socket law", () => {
  it("idle: a plain rounded card — the content IS the card, no ring, no ears, no buttons", () => {
    const G = resolve(PRODUCT, medium, VF_IDLE);
    expect(G.half).toEqual([164.5, 77.5]);
    expect(G.ih).toEqual([164.5, 77.5]);
    expect(G.outerR).toBe(22);
    expect(G.radius).toBe(22);
    expect(G.band).toBe(0);
    expect(G.ring).toBe(0);
    expect(G.earR.every((v) => v === 0)).toBe(true);
    expect(G.closeR).toBe(0);
    expect(G.lockR).toBe(0);
    expect(G.scale).toBe(1);
  });

  it("selected at rest: the ring grows OUT of the content — outer = content + T, concentric; the content is pinned and never cut", () => {
    const G = resolve(PRODUCT, medium, VF_REST);
    expect(G.half).toEqual([164.5 + T, 77.5 + T]);
    expect(G.outerR).toBe(22 + T);
    expect(G.ih).toEqual([164.5, 77.5]);          // the content, exactly
    expect(G.radius).toBe(22);
    expect(G.band).toBe(T);
    expect(G.ring).toBe(1);
  });

  it("held: the content rises by T into the ring, the outer edge does not move, the ring is gone", () => {
    const rest = resolve(PRODUCT, medium, VF_REST);
    const up = resolve(PRODUCT, medium, held);
    expect(up.half).toEqual(rest.half);                  // the socket's outer edge IS the lifted silhouette
    expect(up.outerR).toBe(rest.outerR);
    expect(up.ih).toEqual(up.half);                      // …and the content fills it
    expect(up.radius).toBe(up.outerR);
    expect(up.band).toBe(0);
    expect(up.ring).toBe(0);
  });

  it("a grabbed card that was not selected simply rises: content and outer edge one, T bigger than its rect", () => {
    const G = resolve(PRODUCT, medium, { ...VF_IDLE, held: 1, lift: LIFT.scale });
    expect(G.half).toEqual([164.5 + T, 77.5 + T]);
    expect(G.ih).toEqual(G.half);
    expect(G.outerR).toBe(22 + T);
    expect(G.radius).toBe(22 + T);
    expect(G.band).toBe(0);
    expect(G.ring).toBe(0);
  });

  it("the lift is a RISE, not a scale: the host's lift scale changes nothing; a big card and a small one rise the same 8 px", () => {
    for (const scale of [1, 1.05, 1.3]) {
      const G = resolve(PRODUCT, medium, { ...VF_REST, held: 1, lift: scale });
      expect(G.ih).toEqual([164.5 + T, 77.5 + T]);
    }
    const s = resolve(PRODUCT, small, held);
    expect(s.ih[0] - small.contentHalf[0]).toBe(T);
    const m = resolve(PRODUCT, medium, held);
    expect(m.ih[1] - medium.contentHalf[1]).toBe(T);
  });

  it("mid-lift of a selected card: the band narrows as the content grows; the ring fades with it", () => {
    let prev = T;
    for (const h of [0.2, 0.5, 0.8]) {
      const G = resolve(PRODUCT, medium, { ...VF_REST, held: h, lift: 1 + 0.05 * h });
      expect(G.half).toEqual([164.5 + T, 77.5 + T]);    // the outer edge never moves
      expect(G.band).toBeCloseTo(T * (1 - h), 9);
      expect(G.band).toBeLessThan(prev);
      expect(G.ring).toBeCloseTo(1 - h, 9);
      prev = G.band;
    }
  });

  it("released while still selected: the content settles back and the ring re-emerges — the same frames in reverse", () => {
    const a = resolve(PRODUCT, medium, { ...VF_REST, held: 0.4, lift: 1.02 });
    const b = resolve(PRODUCT, medium, { ...VF_REST, held: 0.4, lift: 1.02 });
    expect(a).toEqual(b);                                  // pure in the motion
    expect(resolve(PRODUCT, medium, { ...VF_REST, held: 0, lift: 1 })).toEqual(resolve(PRODUCT, medium, VF_REST));
  });

  it("a deselect while held keeps the lifted silhouette: no ring can appear under a moving card", () => {
    for (const r of [1, 0.6, 0.3, 0]) {
      const G = resolve(PRODUCT, medium, { ...VF_REST, reveal: r, held: 1, lift: LIFT.scale });
      expect(G.half).toEqual([164.5 + T, 77.5 + T]);
      expect(G.band).toBe(0);
      expect(G.ring).toBe(0);
    }
  });

  it("the reveal: the ring arrives over the first half, easing out; the outer radius stays concentric throughout", () => {
    let prev = -1;
    for (const r of [0, 0.1, 0.25, 0.4, 0.5, 0.75, 1]) {
      const G = resolve(PRODUCT, medium, { ...VF_REST, reveal: r });
      expect(G.band).toBeGreaterThanOrEqual(prev);
      expect(G.outerR - G.radius).toBeCloseTo(G.band, 9);
      expect(G.ih).toEqual([164.5, 77.5]);
      prev = G.band;
    }
    expect(resolve(PRODUCT, medium, { ...VF_REST, reveal: 0.5 }).band).toBeCloseTo(T, 9);
  });

  it("collapses to a disc on delete and is gone at d = 1", () => {
    const mid = resolve(PRODUCT, medium, { ...VF_REST, del: 0.74 });
    expect(mid.half[0]).toBeCloseTo(mid.half[1], 3);          // a square box…
    expect(mid.outerR).toBeCloseTo(mid.half[0], 3);           // …with full radius: a circle
    const gone = resolve(PRODUCT, medium, { ...VF_REST, del: 1 });
    expect(gone.half[0]).toBeLessThan(1e-6);
    expect(gone.shadowAlpha).toBeLessThan(1e-6);
  });

  it("wears the §5 shadow recipe by LIFT, not by selection: resting idle or selected, lifted when held", () => {
    for (const m of [VF_IDLE, VF_REST]) {
      const G = resolve(PRODUCT, medium, m);
      expect(G.shadowSigma).toBeCloseTo(SHADOW.rest.sigma, 9);
      expect(G.shadowOffset).toBeCloseTo(SHADOW.rest.offset, 9);
      expect(G.shadowAlpha).toBeCloseTo(SHADOW.rest.alpha, 9);
      expect(G.frameAlpha).toBe(1);
    }
    const up = resolve(PRODUCT, medium, held);
    expect(up.shadowSigma).toBeCloseTo(SHADOW.lifted.sigma, 9);   // the recipe as written: no scale rides it
    expect(up.shadowOffset).toBeCloseTo(SHADOW.lifted.offset, 9);
    expect(up.shadowAlpha).toBeCloseTo(SHADOW.lifted.alpha, 9);
    expect(up.frameAlpha).toBeCloseTo(LIFT.opacity, 9);
  });

  it("the §7 selection ring arrives with the border, leaves with the delete, fades with the lift", () => {
    expect(resolve(PRODUCT, medium, VF_IDLE).ring).toBe(0);
    expect(resolve(PRODUCT, medium, VF_REST).ring).toBe(1);
    const half = resolve(PRODUCT, medium, { ...VF_REST, reveal: 0.25 });
    expect(half.ring).toBeGreaterThan(0.5);
    expect(half.ring).toBeLessThan(1);
    expect(resolve(PRODUCT, medium, { ...VF_REST, del: 0.5 }).ring).toBe(0);
    expect(resolve(PRODUCT, medium, { ...VF_REST, held: 0.5, lift: 1.025 }).ring).toBeCloseTo(0.5, 9);
  });

  it("a card's own radius is the content's; the style's is the default", () => {
    const own = resolve(PRODUCT, { centre: [0, 0], contentHalf: [50, 40], radius: 6 }, VF_REST);
    expect(own.radius).toBe(6);
    expect(own.outerR).toBe(6 + T);
    const def = resolve(PRODUCT, { centre: [0, 0], contentHalf: [50, 40] }, VF_REST);
    expect(def.radius).toBe(PRODUCT.radius);
  });
});

describe("the ears (a style with controls)", () => {
  const rb = EARS.control / 2;
  const cl = EARS.clearance;

  it("the product socket has none: every corner's ear is 0 at every reveal, and so are the buttons", () => {
    for (const r of [0, 0.5, 1]) {
      const G = resolve(PRODUCT, medium, { ...VF_REST, reveal: r });
      expect(G.earR).toEqual([0, 0, 0, 0]);
      expect(G.closeR).toBe(0);
      expect(G.lockR).toBe(0);
    }
    expect(earOf(PRODUCT)).toBe(0);
    expect(earReachOf(PRODUCT)).toBe(0);
    expect(reachOf(PRODUCT)).toBe(T);
  });

  it("an ear is the control plus its ring of chrome, OUTSIDE the content and tangent to its corner arc", () => {
    const G = resolve(EARS, medium, VF_REST);
    const ear = rb + cl;
    expect(G.earR).toEqual([ear, ear, ear, ear]);
    // TL: the corner arc's centre, the ear's centre on the diagonal past it
    const arc: readonly [number, number] = [medium.centre[0] - medium.contentHalf[0] + 22, medium.centre[1] - medium.contentHalf[1] + 22];
    const d = Math.hypot(G.earX[0] - arc[0], G.earY[0] - arc[1]);
    expect(d).toBeCloseTo(22 + rb + cl, 9);                       // the control clears the content by `clearance`
    expect(d - ear).toBeCloseTo(22, 9);                            // the lobe touches the arc: tangent, never over the content
    // the lobe's inner point lies ON the content boundary; the control's edge is `clearance` off it
    const ux = (arc[0] - G.earX[0]) / d; const uy = (arc[1] - G.earY[0]) / d;
    expect(sdInner(G, G.earX[0] + ux * ear, G.earY[0] + uy * ear)).toBeCloseTo(0, 6);
    expect(sdInner(G, G.earX[0] + ux * rb, G.earY[0] + uy * rb)).toBeCloseTo(cl, 6);
    // the four ears are the content's four corners, mirrored
    expect(G.earX[1] - medium.centre[0]).toBeCloseTo(medium.centre[0] - G.earX[0], 9);
    expect(G.earY[3] - medium.centre[1]).toBeCloseTo(medium.centre[1] - G.earY[0], 9);
    // the buttons sit at the ears' centres: the lock TL, the close TR
    expect(G.lockC).toEqual([G.earX[0], G.earY[0]]);
    expect(G.closeC).toEqual([G.earX[1], G.earY[1]]);
    expect(G.closeR).toBeCloseTo(rb, 9);
    expect(G.lockR).toBeCloseTo(rb, 9);
    expect(reachOf(EARS)).toBeGreaterThan(T);
    expect(reachOf(EARS)).toBeCloseTo(earReachOf(EARS), 9);
  });

  it("the ears bloom with the reveal, staggered, from the ring's corner; the buttons pop after them", () => {
    let prev = 0;
    for (const r of [0, 0.1, 0.2, 0.3, 0.45, 0.6, 1]) {
      const G = resolve(EARS, medium, { ...VF_REST, reveal: r });
      expect(G.earR[0]).toBeGreaterThanOrEqual(prev);
      prev = G.earR[0];
      if (G.earR[0] === 0) { expect(G.lockR).toBe(0); }
    }
    const early = resolve(EARS, medium, { ...VF_REST, reveal: 0.35 });
    expect(early.earR[0]).toBeGreaterThan(0);
    expect(early.earR[2]).toBeLessThan(early.earR[0]);   // BR runs longest
    expect(early.lockR).toBe(0);                         // the buttons come after
    expect(resolve(EARS, medium, { ...VF_REST, reveal: 1 }).earR[2]).toBeCloseTo(rb + cl, 9);
  });

  it("the lift retracts the ears and takes the buttons first — a lifted card is the socket's outer edge and nothing more", () => {
    const G = resolve(EARS, medium, held);
    expect(G.earR).toEqual([0, 0, 0, 0]);
    expect(G.closeR).toBe(0);
    expect(G.lockR).toBe(0);
    expect(G.half).toEqual([164.5 + T, 77.5 + T]);
    const mid = resolve(EARS, medium, { ...VF_REST, held: LIFT_HIDE.buttons[1], lift: 1.02 });
    expect(mid.closeR).toBe(0);
    expect(mid.earR[0]).toBeGreaterThan(0);              // the lobe is still going
    expect(mid.earR[0]).toBeLessThan(rb + cl);
  });

  it("retract early on delete, before the box gets small", () => {
    expect(resolve(EARS, medium, { ...VF_REST, del: 0.3 }).earR[0]).toBe(0);
    expect(resolve(EARS, medium, { ...VF_REST, del: 0.3 }).closeR).toBe(0);
  });
});

describe("the CPU mirror — sdf.ts, what the router picks", () => {
  const G = resolve(PRODUCT, medium, VF_REST);
  const [cx, cy] = medium.centre;
  const [hx, hy] = medium.contentHalf;

  it("partitions the plane: content inside the inner box, frame in the ring, outside past it", () => {
    expect(pick(G, cx, cy)).toBe("content");
    expect(pick(G, cx + hx - 1, cy)).toBe("content");
    expect(pick(G, cx + hx + T / 2, cy)).toBe("frame");
    expect(pick(G, cx, cy - hy - T / 2)).toBe("frame");
    expect(pick(G, cx + hx + T + 1, cy)).toBe("outside");
    expect(sdInner(G, cx + hx, cy)).toBeCloseTo(0, 9);
    expect(sdOuter(G, cx + hx + T, cy)).toBeCloseTo(0, 9);
    expect(sdFrame(G, cx + hx + T / 2, cy)).toBeCloseTo(-T / 2, 9);
  });

  it("the ring's corners are concentric: the frame is T wide along the diagonal too", () => {
    const ax = cx + hx - 22; const ay = cy + hy - 22;   // BR arc centre
    const u = Math.SQRT1_2;
    expect(sdInner(G, ax + u * 22, ay + u * 22)).toBeCloseTo(0, 9);
    expect(sdOuter(G, ax + u * (22 + T), ay + u * (22 + T))).toBeCloseTo(0, 9);
    expect(pick(G, ax + u * (22 + T / 2), ay + u * (22 + T / 2))).toBe("frame");
  });

  it("a lifted card picks as content out to the socket's edge — no ring to hit", () => {
    const up = resolve(PRODUCT, medium, held);
    expect(pick(up, cx + hx + T / 2, cy)).toBe("content");
    expect(pick(up, cx + hx + T + 1, cy)).toBe("outside");
  });

  it("an idle card picks as content to its own edge and outside past it", () => {
    const idle = resolve(PRODUCT, medium, VF_IDLE);
    expect(pick(idle, cx + hx - 0.5, cy)).toBe("content");
    expect(pick(idle, cx + hx + 0.5, cy)).toBe("outside");
  });

  it("the ears: their buttons pick by position, the lobe picks as frame, and the lobe never covers content", () => {
    const E = resolve(EARS, medium, VF_REST);
    expect(pick(E, E.lockC[0], E.lockC[1])).toBe("lock");
    expect(pick(E, E.closeC[0], E.closeC[1])).toBe("close");
    const ear = E.earR[1];
    // a point in the lobe's chrome ring, past the button, on the diagonal outward
    expect(pick(E, E.closeC[0] + (ear - 2) * Math.SQRT1_2, E.closeC[1] - (ear - 2) * Math.SQRT1_2)).toBe("frame");
    expect(pick(E, E.closeC[0] + (ear + 3) * Math.SQRT1_2, E.closeC[1] - (ear + 3) * Math.SQRT1_2)).toBe("outside");
    // sweep the content's boundary: the outer field is never inside there (an ear that bit the content would make it so)
    for (let k = 0; k < 360; k += 3) {
      const a = (k * Math.PI) / 180;
      const px = cx + Math.cos(a) * (hx + 40); const py = cy + Math.sin(a) * (hy + 40);
      // walk inward to the content edge along the ray and check the frame lies outside it
      let lo = 0; let hi = 1;
      for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (sdInner(E, cx + (px - cx) * m, cy + (py - cy) * m) < 0) lo = m; else hi = m; }
      const bx = cx + (px - cx) * lo; const by = cy + (py - cy) * lo;
      expect(sdFrame(E, bx, by)).toBeGreaterThanOrEqual(-1e-6);   // the frame's inner boundary is the content's
    }
  });

  it("a point-sized ear must not bulge the corner: no ear, the outer field is the plain rounded rect", () => {
    const plain = resolve(PRODUCT, medium, { ...VF_REST, reveal: 0.2 });
    const eared = resolve(EARS, medium, { ...VF_REST, reveal: 0.05 });   // before the first ear window opens
    expect(eared.earR[0]).toBe(0);
    const ax = cx - hx + 22; const ay = cy - hy + 22;
    const p = [ax - Math.SQRT1_2 * (22 + plain.band), ay - Math.SQRT1_2 * (22 + plain.band)] as const;
    expect(Math.abs(sdOuter(eared, p[0], p[1]) - sdOuter({ ...eared, earR: [0, 0, 0, 0] as const }, p[0], p[1]))).toBeLessThan(1e-9);
  });
});

describe("styles", () => {
  it("the shipped styles satisfy their own constraints on the product's card sizes", () => {
    for (const s of Object.values(STYLES)) {
      expect(styleViolations(s, [164.5, 77.5])).toEqual([]);
      expect(styleViolations(s, [77.5, 77.5])).toEqual([]);
    }
  });

  it("the product socket is the three numbers: the lift's rise, the card radius, no controls", () => {
    expect(PRODUCT_SOCKET).toEqual({ name: "product", thickness: 8, radius: 22 });
    expect(PRODUCT.control).toBe(0);
    expect(PRODUCT.btn.radius).toBe(0);
    expect(EARS.control).toBe(26);
    expect(EARS.btn.radius).toBe(13);
    expect(EARS.clearance).toBe(8);
    expect(EARS.fillet).toBe(8);
    expect(earOf(EARS)).toBe(21);
  });

  it("catches a ring thinner than the selection line, a control under the pointer floor, and ears that merge on a narrow card", () => {
    expect(styleViolations(socketStyle({ thickness: 1, radius: 22 }), [100, 60]).some((m) => m.includes("selection ring"))).toBe(true);
    expect(styleViolations(socketStyle({ thickness: 0, radius: 22 }), [100, 60]).some((m) => m.includes("positive"))).toBe(true);
    expect(styleViolations(socketStyle({ thickness: 8, radius: 22, control: 16 }), [100, 60]).some((m) => m.includes("pointer floor"))).toBe(true);
    expect(styleViolations(EARS, [10, 60]).some((m) => m.includes("merge"))).toBe(true);
    expect(styleViolations(EARS, [LINES.ring, LINES.ring]).length).toBeGreaterThan(0);
  });

  it("the pack's reach is the ring, or an ear past it; its source is the socket's outer silhouette", () => {
    const pack = vfFrame();
    expect(pack.reach?.(22)).toBe(T);
    expect(pack.source(100, 60, 1.05, 22)).toEqual({ hx: 50 + T, hy: 30 + T, r: 22 + T });
    const ears = vfFrame({ style: EARS });
    expect(ears.reach?.(22)).toBeCloseTo(earReachOf(EARS, 22), 9);
    expect(ears.reach?.(22)).toBeGreaterThan(T);
    expect(ears.source(100, 60, 1, 22)).toEqual({ hx: 50 + T, hy: 30 + T, r: 22 + T });   // a dragged set casts the socket, never its ears
    expect(pack.inner).toBeUndefined();                                                      // the content is never cut: no clip march
  });
});

describe("the pack's springs", () => {
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
    const pack = vfFrame({ style: EARS });
    const out = { live: false };
    const ctx = { card: medium, material: { shadow: SHADOW, lift: LIFT }, dt: 1 / 60, part: { hover: VF_PARTS.close, press: null }, key: "k", out };
    for (let i = 0; i < 60; i++) pack.resolve({ ...ctx, motion: { ...VF_REST, held: 1, lift: LIFT.scale } });
    expect(pack.springsOf("k").hoverC).toBe(0);
    for (let i = 0; i < 60; i++) pack.resolve({ ...ctx, motion: VF_REST });
    expect(pack.springsOf("k").hoverC).toBeGreaterThan(0.5);
  });
});
