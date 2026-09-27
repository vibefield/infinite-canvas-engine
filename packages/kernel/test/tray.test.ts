/**
 * tray.ts — the pegboard tray's lattice law (design-017 §8; K5a). Pinned: the (category, order, type) order; packing left to
 * right, a line at a time, a clear row between lines; every peg on a PUNCHED hole's centre on the stagger's parity; the hang
 * point (top edge's centre, a shelf's bottom edge's); no footprint crosses another or the margins; the scroll range; a re-lay
 * at another width; the hang's validation.
 */
import { describe, expect, it } from "vitest";
import { hangError, hangFootprint, layTray, PEG_LATTICE, TRAY_SPACING, type TrayHang, type TrayItem, type TrayPlaced, trayScrollMax } from "../src";

const P = 40;
const hook2: TrayHang = { w: 120, h: 120, pegs: [[-1, -0.5], [1, -0.5]], accessory: "hook" };
const shelf: TrayHang = { w: 200, h: 140, pegs: [[-2, 0.5], [2, 0.5]], accessory: "shelf" };
const clip: TrayHang = { w: 120, h: 150, pegs: [[0, -0.5]], accessory: "clip" };
const rail: TrayHang = { w: 240, h: 160, pegs: [[-2.5, -0.5], [2.5, -0.5]], accessory: "rail" };
const book: TrayHang = { w: 150, h: 190, pegs: [[-1.5, 0.5], [1.5, 0.5]], accessory: "shelf" };
const pad: TrayHang = { w: 150, h: 180, pegs: [[0, -0.5]], accessory: "hook" };
const SIX: TrayItem[] = [
  { type: "desk.minimat", category: "surface", order: 0, hang: shelf },
  { type: "desk.note", category: "paper", order: 0, hang: hook2 },
  { type: "desk.board", category: "surface", order: 1, hang: rail },
  { type: "desk.print", category: "paper", order: 1, hang: clip },
  { type: "desk.calendar", category: "paper", order: 3, hang: pad },
  { type: "desk.notebook", category: "paper", order: 2, hang: book },
];

/** Is every peg of `p` on a punched hole's centre of a board `cols` pitches wide? */
function onHoles(p: TrayPlaced, cols: number): boolean {
  return p.pegs.every((g) => {
    const x = g.x / P;
    const y = g.y / P;
    const odd = (g.row & 1) !== 0 ? 0.5 : 0;
    return x === g.col + PEG_LATTICE.colPhase + odd && y === g.row + PEG_LATTICE.rowPhase && x >= PEG_LATTICE.border && x <= cols - PEG_LATTICE.border;
  });
}

const overlaps = (a: TrayPlaced, b: TrayPlaced): boolean => a.box.x0 < b.box.x1 && b.box.x0 < a.box.x1 && a.box.y0 < b.box.y1 && b.box.y0 < a.box.y1;

describe("the tray's lattice law", () => {
  it("lays in (category, order, type) order, left to right, a line at a time", () => {
    const { placed } = layTray(SIX, 1120, P);
    expect(placed.map((p) => p.type)).toEqual(["desk.note", "desk.print", "desk.notebook", "desk.calendar", "desk.minimat", "desk.board"]);
    // within a line, each starts right of the last's footprint by the gap; a new line starts at the margin
    for (let i = 1; i < placed.length; i++) {
      const a = placed[i - 1] as TrayPlaced;
      const b = placed[i] as TrayPlaced;
      if (b.line === a.line) expect(b.box.x0).toBeGreaterThanOrEqual(a.box.x1 + TRAY_SPACING.gap * P - 1e-9);
      else expect(b.box.x0).toBeGreaterThanOrEqual(TRAY_SPACING.margin * P - 1e-9);
    }
    expect(new Set(placed.map((p) => p.line)).size).toBeGreaterThan(1);
    // a type ties last: same category and order, sorted by type
    const tie = layTray([{ type: "b", hang: clip }, { type: "a", hang: clip }], 1120, P).placed.map((p) => p.type);
    expect(tie).toEqual(["a", "b"]);
  });

  it("puts every peg on a punched hole's centre, the row's parity from the stagger", () => {
    for (const width of [1120, 800, 480, 360]) {
      const { placed } = layTray(SIX, width, P);
      for (const p of placed) expect(onHoles(p, width / P), `${p.type} at ${width}`).toBe(true);
    }
    // both parities occur: a half-pitch offset between a hook's two pegs lands them on an odd row after an even one
    const odd: TrayHang = { w: 80, h: 80, pegs: [[0, -0.5], [0.5, 0.5]], accessory: "hook" };
    const { placed } = layTray([{ type: "z", hang: odd }], 480, P);
    const [a, b] = (placed[0] as TrayPlaced).pegs;
    expect((a?.row ?? 0) + 1).toBe(b?.row);
    expect(onHoles(placed[0] as TrayPlaced, 12)).toBe(true);
    // the solid border binds whatever the spacing: with no margin, a peg at its footprint's edge still lands on a punched hole
    const edge: TrayHang = { w: 40, h: 40, pegs: [[-3, -0.5]], accessory: "hook" };
    const tight = layTray([{ type: "e", hang: edge }, { type: "f", hang: edge }], 240, P, { ...TRAY_SPACING, margin: 0 });
    for (const q of tight.placed) expect(onHoles(q, 6)).toBe(true);
  });

  it("hangs a specimen from its hang point: the top edge's centre, a shelf's bottom edge's", () => {
    const { placed } = layTray(SIX, 1120, P);
    for (const p of placed) {
      const item = SIX.find((i) => i.type === p.type) as TrayItem;
      const hx = p.x + p.w / 2;
      const hy = item.hang.accessory === "shelf" ? p.y + p.h : p.y;
      item.hang.pegs.forEach(([dx, dy], i) => {
        expect(p.pegs[i]?.x).toBeCloseTo(hx + dx * P, 9);
        expect(p.pegs[i]?.y).toBeCloseTo(hy + dy * P, 9);
      });
    }
  });

  it("keeps footprints apart and inside the margins, a clear row between lines", () => {
    const { placed, bottom } = layTray(SIX, 1120, P);
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) expect(overlaps(placed[i] as TrayPlaced, placed[j] as TrayPlaced)).toBe(false);
    for (const p of placed) {
      expect(p.box.x0).toBeGreaterThanOrEqual(TRAY_SPACING.margin * P - 1e-9);
      expect(p.box.x1).toBeLessThanOrEqual(1120 - TRAY_SPACING.margin * P + 1e-9);
      expect(p.box.y0).toBeGreaterThanOrEqual(TRAY_SPACING.top * P - 1e-9);
      // the footprint holds the specimen
      expect(p.box.x0 <= p.x && p.box.y0 <= p.y && p.box.x1 >= p.x + p.w && p.box.y1 >= p.y + p.h).toBe(true);
    }
    const lines = Math.max(...placed.map((p) => p.line));
    for (let l = 1; l <= lines; l++) {
      const above = Math.max(...placed.filter((p) => p.line === l - 1).map((p) => p.box.y1));
      const below = Math.min(...placed.filter((p) => p.line === l).map((p) => p.box.y0));
      expect(below - above).toBeGreaterThanOrEqual(TRAY_SPACING.clear * P - 1e-9);
    }
    expect(bottom).toBe(Math.max(...placed.map((p) => p.box.y1)));
  });

  it("gives the scroll's range: the last line's foot plus a pitch, less the face", () => {
    const { bottom } = layTray(SIX, 1120, P);
    expect(trayScrollMax(bottom, 347, P)).toBe(bottom + P - 347);
    expect(trayScrollMax(bottom, bottom + P + 10, P)).toBe(0);
    expect(trayScrollMax(0, 347, P)).toBe(0);
    expect(layTray([], 1120, P)).toEqual({ placed: [], bottom: 0 });
  });

  it("re-lays at another width: the same items, more lines, every peg on a hole", () => {
    const wide = layTray(SIX, 1120, P);
    const narrow = layTray(SIX, 480, P);
    expect(narrow.placed.map((p) => p.type)).toEqual(wide.placed.map((p) => p.type));
    expect(Math.max(...narrow.placed.map((p) => p.line))).toBeGreaterThan(Math.max(...wide.placed.map((p) => p.line)));
    expect(narrow.bottom).toBeGreaterThan(wide.bottom);
    for (const p of narrow.placed) expect(onHoles(p, 12)).toBe(true);
    // deterministic: the same input lays the same board
    expect(layTray([...SIX].reverse(), 1120, P)).toEqual(wide);
  });

  it("validates a hang: its size, its accessory, its pegs on the lattice", () => {
    for (const h of [hook2, shelf, clip, rail, book, pad]) expect(hangError(h)).toBeNull();
    expect(hangError({ ...clip, w: 0 })).toMatch(/size/);
    expect(hangError({ ...clip, h: Number.NaN })).toMatch(/size/);
    expect(hangError({ ...clip, accessory: "nail" as never })).toMatch(/accessory/);
    expect(hangError({ ...clip, pegs: [] })).toMatch(/no peg/);
    expect(hangError({ ...clip, pegs: [[0, 0], [1, 0.5]] })).toMatch(/whole number of rows/);
    expect(hangError({ ...clip, pegs: [[0, 0], [0.5, 0]] })).toMatch(/stagger/);
    expect(hangError({ ...clip, pegs: [[0, 0], [1, 1]] })).toMatch(/stagger/);
    expect(hangError({ ...clip, pegs: [[0, 0], [1.5, 1]] })).toBeNull();
    expect(hangError({ ...clip, pegs: [[0, 0], ["1", 0] as never] })).toMatch(/not \[dx, dy\]/);
    // the footprint holds the specimen and every plug
    const fp = hangFootprint(shelf, P);
    expect(fp.y0).toBeCloseTo(-140 / P, 9);
    expect(fp.x0).toBeLessThan(-100 / P);
  });
});
