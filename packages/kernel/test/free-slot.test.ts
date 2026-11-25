/**
 * layout.ts — freeSlot (petition I57): where ONE newcomer that comes with no pointer goes. The nearest free slot to
 * an anchor, a slot wholly inside the view before any that is not, nothing farther than the reach, and `undefined`
 * when the reach holds none (never an overlap by silence). Pinned: the anchor when it is free; the gutter kept,
 * flush; the order of equal distances (right, below, above, left); the view's preference; a view smaller than the
 * newcomer; the nothing-free answer; the answer independent of the incumbents' order; and, against the rule written
 * the slow way, that the slot answered is the nearest there is.
 */
import { describe, expect, it } from "vitest";
import { freeSlot, type FreeSlot, type FreeSlotOpts, type LayoutRect, type LayoutSize } from "../src";
import { makePrng } from "./prng";

/** Mirror of the module's crowding rule: closer than gutter on both axes. */
function crowds(a: LayoutRect, b: LayoutRect, gutter: number): boolean {
  return (
    a.x < b.x + b.w + gutter &&
    b.x < a.x + a.w + gutter &&
    a.y < b.y + b.h + gutter &&
    b.y < a.y + a.h + gutter
  );
}

const VIEW: LayoutRect = { x: 0, y: 0, w: 1000, h: 600 };
const MIDDLE = { x: 500, y: 300 };
/** A newcomer 200 × 100 centred on the view's middle lies at (400, 250). */
const PANE: LayoutSize = { w: 200, h: 100 };
const opts = (over: Partial<FreeSlotOpts> = {}): FreeSlotOpts => ({ anchor: MIDDLE, gutter: 24, reach: 2000, view: VIEW, ...over });

/**
 * THE RULE, WRITTEN THE SLOW WAY: every pair of candidate lines (the anchored position clamped into the region, each
 * incumbent's two flush sides on each axis, the region's sides), each tested against every incumbent; the nearest
 * wins, an equal distance going to the larger x, then the larger y; the view's region first, then the reach's.
 */
function slowly(incumbents: readonly LayoutRect[], size: LayoutSize, o: FreeSlotOpts): FreeSlot | undefined {
  const ax = o.anchor.x - size.w / 2;
  const ay = o.anchor.y - size.h / 2;
  const g = o.gutter;
  const blocked = (x: number, y: number): boolean =>
    incumbents.some((i) => x > i.x - g - size.w && x < i.x + i.w + g && y > i.y - g - size.h && y < i.y + i.h + g);
  const nearest = (x0: number, x1: number, y0: number, y1: number): { x: number; y: number } | undefined => {
    if (!(x0 <= x1 && y0 <= y1)) return undefined;
    const xs = [Math.min(x1, Math.max(x0, ax)), x0, x1];
    const ys = [Math.min(y1, Math.max(y0, ay)), y0, y1];
    for (const i of incumbents) {
      xs.push(i.x - g - size.w, i.x + i.w + g);
      ys.push(i.y - g - size.h, i.y + i.h + g);
    }
    let best: { x: number; y: number; d: number } | undefined;
    for (const x of xs) {
      for (const y of ys) {
        if (x < x0 || x > x1 || y < y0 || y > y1 || blocked(x, y)) continue;
        const dx = x - ax;
        const dy = y - ay;
        const d = dx * dx + dy * dy;
        if (best === undefined || d < best.d || (d === best.d && (x > best.x || (x === best.x && y > best.y)))) best = { x, y, d };
      }
    }
    return best === undefined ? undefined : { x: best.x, y: best.y };
  };
  const rx0 = ax - o.reach;
  const rx1 = ax + o.reach;
  const ry0 = ay - o.reach;
  const ry1 = ay + o.reach;
  const v = o.view;
  const seen = v === undefined ? undefined : nearest(Math.max(rx0, v.x), Math.min(rx1, v.x + v.w - size.w), Math.max(ry0, v.y), Math.min(ry1, v.y + v.h - size.h));
  if (seen !== undefined) return { ...seen, where: seen.x === ax && seen.y === ay ? "anchor" : "view" };
  const far = nearest(rx0, rx1, ry0, ry1);
  return far === undefined ? undefined : { ...far, where: far.x === ax && far.y === ay ? "anchor" : "reach" };
}

describe("freeSlot — the anchor, the gutter and the order", () => {
  it("an empty board → the newcomer centred on the anchor", () => {
    expect(freeSlot([], PANE, opts())).toEqual({ x: 400, y: 250, where: "anchor" });
  });

  it("a free anchor wins, whatever lies elsewhere", () => {
    const incumbents = [{ x: 0, y: 0, w: 100, h: 100 }, { x: 800, y: 450, w: 150, h: 100 }];
    expect(freeSlot(incumbents, PANE, opts())).toEqual({ x: 400, y: 250, where: "anchor" });
  });

  it("one object under the anchor → the nearest free side, flush at the gutter", () => {
    // the same 200 × 100 where the newcomer wants to be: below and above are 124 away, right and left 224
    const under = { x: 400, y: 250, w: 200, h: 100 };
    const slot = freeSlot([under], PANE, opts());
    expect(slot).toEqual({ x: 400, y: 374, where: "view" }); // below: an equal distance goes down, never up
    expect((slot as FreeSlot).y - (under.y + under.h)).toBe(24);
  });

  it("equal distances go right, then below, then above, then left", () => {
    const size = { w: 100, h: 100 };
    const under = { x: 450, y: 250, w: 100, h: 100 }; // a square under a square: all four sides are 124 away
    const right = { x: 600, y: 250, w: 100, h: 100 };
    const below = { x: 450, y: 400, w: 100, h: 100 };
    const above = { x: 450, y: 100, w: 100, h: 100 };
    expect(freeSlot([under], size, opts())).toMatchObject({ x: 574, y: 250 });
    expect(freeSlot([under, right], size, opts())).toMatchObject({ x: 450, y: 374 });
    expect(freeSlot([under, right, below], size, opts())).toMatchObject({ x: 450, y: 126 });
    expect(freeSlot([under, right, below, above], size, opts())).toMatchObject({ x: 326, y: 250 });
  });

  it("closer than the gutter is occupied, with no overlap at all", () => {
    // 10 clear of the anchored newcomer's right edge: inside the 24 gutter
    const near = { x: 610, y: 250, w: 100, h: 100 };
    const slot = freeSlot([near], PANE, opts()) as FreeSlot;
    expect(slot).toEqual({ x: 386, y: 250, where: "view" }); // 14 to the left: exactly the gutter from it
    expect(crowds({ ...slot, ...PANE }, near, 24)).toBe(false);
  });

  it("exactly the gutter away is clear", () => {
    const beside = { x: 624, y: 250, w: 100, h: 100 };
    expect(freeSlot([beside], PANE, opts())).toEqual({ x: 400, y: 250, where: "anchor" });
  });

  it("a flush slot stands at sizes no float holds exactly", () => {
    const size = { w: 33.3, h: 20.1 };
    const under = { x: 483.35 - 0.1, y: 289.95 + 0.2, w: 33.3, h: 20.1 };
    const slot = freeSlot([under], size, opts({ gutter: 0.7 })) as FreeSlot;
    expect(slot).toBeDefined();
    // clear of it by the gutter on one axis, to the last few bits
    const dx = Math.max(under.x - (slot.x + size.w), slot.x - (under.x + under.w));
    const dy = Math.max(under.y - (slot.y + size.h), slot.y - (under.y + under.h));
    expect(Math.max(dx, dy)).toBeGreaterThan(0.7 - 1e-9);
    expect(Math.max(dx, dy)).toBeLessThan(0.7 + 1e-9);
  });

  it("the pile: the same anchor asked eight times fans out, never crowds, and stays in view", () => {
    const placed: LayoutRect[] = [];
    for (let n = 0; n < 8; n++) {
      const slot = freeSlot(placed, PANE, opts()) as FreeSlot;
      expect(slot.where).toBe(n === 0 ? "anchor" : "view");
      placed.push({ x: slot.x, y: slot.y, ...PANE });
    }
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) expect(crowds(placed[i] as LayoutRect, placed[j] as LayoutRect, 24)).toBe(false);
    }
    for (const r of placed) {
      expect(r.x >= VIEW.x && r.x + r.w <= VIEW.x + VIEW.w && r.y >= VIEW.y && r.y + r.h <= VIEW.y + VIEW.h).toBe(true);
    }
  });
});

describe("freeSlot — the view", () => {
  it("a crowded view → the nearest slot outside it", () => {
    const wall = { x: 0, y: 0, w: 1000, h: 600 }; // the whole view is one object
    expect(freeSlot([wall], PANE, opts())).toEqual({ x: 400, y: 624, where: "reach" }); // under it, flush; above is as far and loses
  });

  it("a slot wholly inside the view is taken before a nearer one that is not", () => {
    // free where it is asked, but 50 of it would lie past the view's right edge: it moves inside
    expect(freeSlot([], PANE, opts({ anchor: { x: 950, y: 300 } }))).toEqual({ x: 800, y: 250, where: "view" });
    // …and with that corner of the view taken, the nearest slot still inside the view, not the free one outside it
    const corner = { x: 700, y: 200, w: 300, h: 200 };
    const slot = freeSlot([corner], PANE, opts({ anchor: { x: 950, y: 300 } })) as FreeSlot;
    expect(slot.where).toBe("view");
    expect(slot.x + PANE.w <= 1000 && slot.y + PANE.h <= 600 && slot.x >= 0 && slot.y >= 0).toBe(true);
    expect(crowds({ ...slot, ...PANE }, corner, 24)).toBe(false);
  });

  it("no view → the nearest free slot within the reach", () => {
    const under = { x: 400, y: 250, w: 200, h: 100 };
    expect(freeSlot([], PANE, { anchor: MIDDLE, gutter: 24, reach: 2000 })).toEqual({ x: 400, y: 250, where: "anchor" });
    expect(freeSlot([under], PANE, { anchor: MIDDLE, gutter: 24, reach: 2000 })).toEqual({ x: 400, y: 374, where: "reach" });
  });

  it("a view smaller than the newcomer (zoomed in) holds no whole slot: the anchor, then the nearest within the reach", () => {
    const zoomed = { x: 450, y: 275, w: 100, h: 50 };
    expect(freeSlot([], PANE, opts({ view: zoomed }))).toEqual({ x: 400, y: 250, where: "anchor" });
    const under = { x: 400, y: 250, w: 200, h: 100 };
    expect(freeSlot([under], PANE, opts({ view: zoomed }))).toEqual({ x: 400, y: 374, where: "reach" });
  });
});

describe("freeSlot — the reach", () => {
  it("nothing free within the reach → undefined, never an overlap", () => {
    const slab = { x: -5000, y: -5000, w: 10000, h: 10000 };
    expect(freeSlot([slab], PANE, opts({ reach: 1000 }))).toBeUndefined();
    // the same board asked with a reach that gets past it answers (the nearest side: right of it, 4,624 away; under it is 4,774)
    expect(freeSlot([slab], PANE, opts({ reach: 6000 }))).toEqual({ x: 5024, y: 250, where: "reach" });
  });

  it("the reach is on each axis from the anchored position, and its edge is inside it", () => {
    const wall = { x: 0, y: 0, w: 1000, h: 600 };
    expect(freeSlot([wall], PANE, opts({ reach: 374 }))).toEqual({ x: 400, y: 624, where: "reach" });
    expect(freeSlot([wall], PANE, opts({ reach: 373 }))).toBeUndefined();
  });

  it("an incumbent past the reach is not in the way", () => {
    const under = { x: 400, y: 250, w: 200, h: 100 };
    const far = { x: 90000, y: 90000, w: 500, h: 500 };
    expect(freeSlot([under, far], PANE, opts())).toEqual(freeSlot([under], PANE, opts()));
  });
});

describe("freeSlot — the same scene answers the same place", () => {
  /** A board of `n` objects around the view: whole numbers (equal distances are exact), or, `fine`, numbers no float holds exactly. */
  const scene = (seed: number, n: number, fine = false): LayoutRect[] => {
    const rand = makePrng(seed);
    const k = fine ? 0.37 : 1;
    const out: LayoutRect[] = [];
    for (let i = 0; i < n; i++) {
      out.push({ x: (Math.floor(rand() * 1400) - 200) * k + (fine ? 123.4 : 0), y: (Math.floor(rand() * 1000) - 200) * k + (fine ? 77.7 : 0), w: (40 + Math.floor(rand() * 260)) * k, h: (40 + Math.floor(rand() * 200)) * k });
    }
    return out;
  };

  it("asked twice, and with the incumbents in any order", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const incumbents = scene(seed, 14);
      const first = freeSlot(incumbents, PANE, opts());
      expect(freeSlot(incumbents, PANE, opts())).toEqual(first);
      expect(freeSlot([...incumbents].reverse(), PANE, opts())).toEqual(first);
      expect(freeSlot([...incumbents.slice(5), ...incumbents.slice(0, 5)], PANE, opts())).toEqual(first);
    }
  });

  it("the slot answered crowds nothing, lies where it says, and is the nearest there is (the rule written the slow way)", () => {
    let moved = 0;
    let beyond = 0;
    let none = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const rand = makePrng(seed * 7919);
      const fine = seed > 300; // the last hundred at fractions: the walls' sides and the slots are the same floats
      const incumbents = scene(seed, 4 + Math.floor(rand() * 22), fine);
      const size = fine ? { w: 33.3 + rand() * 150, h: 20.1 + rand() * 110 } : { w: 60 + Math.floor(rand() * 400), h: 40 + Math.floor(rand() * 300) };
      const o = opts({
        anchor: { x: 200 + Math.floor(rand() * 600), y: 100 + Math.floor(rand() * 400) },
        gutter: fine ? rand() * 15 : Math.floor(rand() * 40),
        reach: seed % 5 === 0 ? 120 + Math.floor(rand() * 200) : 3000,
      });
      const slot = freeSlot(incumbents, size, o);
      expect(slot).toEqual(slowly(incumbents, size, o));
      if (slot === undefined) {
        none += 1;
        continue;
      }
      // (the mirror's own sums round differently from the walls' at fractions: a hair of slack there)
      for (const i of incumbents) expect(crowds({ x: slot.x, y: slot.y, ...size }, i, fine ? o.gutter - 1e-9 : o.gutter)).toBe(false);
      const ax = o.anchor.x - size.w / 2;
      const ay = o.anchor.y - size.h / 2;
      expect(Math.abs(slot.x - ax) <= o.reach && Math.abs(slot.y - ay) <= o.reach).toBe(true);
      const inView = slot.x >= VIEW.x && slot.y >= VIEW.y && slot.x + size.w <= VIEW.x + VIEW.w && slot.y + size.h <= VIEW.y + VIEW.h;
      if (slot.where === "view") expect(inView).toBe(true);
      if (slot.where === "anchor") expect(slot.x === ax && slot.y === ay).toBe(true);
      if (slot.where !== "anchor") moved += 1;
      if (slot.where === "reach") beyond += 1;
    }
    // the scenes reach every answer: a moved slot, one past the view, and none
    expect(moved).toBeGreaterThan(50);
    expect(beyond).toBeGreaterThan(5);
    expect(none).toBeGreaterThan(0);
  });
});
