/**
 * THE PEGBOARD TRAY'S LATTICE LAW (design-017 §8; K5a) — where the kinds hang on the board: pure, one frame (the BOARD's —
 * x from the drawer's left edge, y down from the board's top at scroll 0), plain structs in and out.
 *
 * The lattice (§6.1) in pitches: holes at x = c + ¼ + ½·(r odd), rows at y = r + ¾; a hole is punched only where its centre
 * lies ≥ ¾ from both sides (the solid border, D-K3.1). The desk's shader and its CPU mirror (desk/tray/lattice.ts) read the
 * same three numbers from here.
 *
 * A kind's HANG (its `defineObject({ tray: { hang } })`): its size on the board (CSS px), its accessory — a hook, a shelf, a
 * clip or a rail, SKÅDIS-style — and its PEGS, the holes the accessory plugs into, in pitches from the specimen's HANG POINT:
 * the centre of its top edge (a hook, a clip, a rail hang it from above) or of its bottom edge (a shelf holds it up). Every
 * peg lands on a hole centre, so the pegs' offsets must be what the stagger allows: between two pegs a whole number of rows,
 * and across them a whole number of pitches on the same parity or a half on the other (`hangError`).
 *
 * The LAW (`layTray`): the items in (category, order, type) order, packed left to right across the board's columns, a line
 * at a time; each placed at the first holes at or after the line's top and the cursor — its row's PARITY is where the stagger
 * puts a hole under its first peg; a pitch between neighbours, a clear row between lines. `bottom` is the last line's foot;
 * the scroll's range is that plus a pitch, less the face the drawer shows (`trayScrollMax`).
 */

/** The lattice's phase and border, pitches (design-017 §6.1). */
export const PEG_LATTICE = {
  /** A hole's centre: x = c + colPhase + ½·(r odd) from the board's left edge… */
  colPhase: 0.25,
  /** …at y = r + rowPhase below its top at scroll 0. */
  rowPhase: 0.75,
  /** A hole is punched only where its centre lies this far from both sides (the solid border). */
  border: 0.75,
} as const;

/** What holds a specimen to the board (design-016 §7.7 — SKÅDIS's accessories). */
export type TrayAccessory = "hook" | "shelf" | "clip" | "rail";
export const TRAY_ACCESSORIES: readonly TrayAccessory[] = ["hook", "shelf", "clip", "rail"];

/** How a kind hangs on the tray: its size (CSS px), its pegs (pitches from its hang point), its accessory. */
export interface TrayHang {
  readonly w: number;
  readonly h: number;
  /** The holes the accessory plugs into, `[dx, dy]` pitches from the hang point — the top edge's centre, or the bottom edge's on a shelf. */
  readonly pegs: readonly (readonly [number, number])[];
  readonly accessory: TrayAccessory;
}

/**
 * The accessories' own geometry, pitches — the law's footprints and the desk's drawing read the same numbers. A HOOK drops
 * from its hole to its tip; a SHELF's plank lies under the specimen (its overhang past each side) on a bracket from each
 * hole; a CLIP's body grips the specimen's top edge from its hole; a RAIL's bar runs through its holes past the outer two.
 */
export const TRAY_ACCESSORY = {
  /** Round a peg: the plug in its hole and the reach of what sits on it (a hole is 0.26 × 0.66). */
  plug: { hx: 0.17, hy: 0.4 },
  hook: { hx: 0.12, drop: 0.62 },
  shelf: { thick: 0.24, overhang: 0.3, bracket: 0.1 },
  clip: { hx: 0.3, below: 0.55 },
  rail: { hy: 0.13, overhang: 0.4 },
} as const;

/** One item the law lays: a kind's type, its hang, and its place in the order. */
export interface TrayItem {
  readonly type: string;
  readonly hang: TrayHang;
  /** Sorted first (strings; absent = ""). */
  readonly category?: string;
  /** Then this (absent = 0), then the type. */
  readonly order?: number;
}

/** A box, pitches or px by context: left, top, right, bottom. */
export interface TrayBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** A peg as laid: its hole (row, column) and the hole's centre, board px. */
export interface TrayPeg {
  readonly row: number;
  readonly col: number;
  readonly x: number;
  readonly y: number;
}

/** An item as laid, board px: the specimen's rect (top-left, size), its pegs on their holes, its footprint (the specimen and its accessory), its line. */
export interface TrayPlaced {
  readonly type: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly pegs: readonly TrayPeg[];
  readonly box: TrayBox;
  readonly line: number;
}

export interface TrayLayout {
  readonly placed: readonly TrayPlaced[];
  /** The last line's foot, board px (0: nothing laid). */
  readonly bottom: number;
}

/** The law's spacing, pitches: the side margin, the gap between neighbours, the first line's top, the clear row between lines. */
export interface TraySpacing {
  readonly margin: number;
  readonly gap: number;
  readonly top: number;
  readonly clear: number;
}
export const TRAY_SPACING: TraySpacing = { margin: 0.5, gap: 1, top: 0.5, clear: 1 };

const EPS = 1e-9;
const whole = (v: number): boolean => Math.abs(v - Math.round(v)) < 1e-9;

/** Why a hang cannot be laid (a message), or null: its size, its pegs on the lattice, its accessory. */
export function hangError(h: TrayHang): string | null {
  if (typeof h !== "object" || h === null) return "a hang is { w, h, pegs, accessory }";
  if (!(Number.isFinite(h.w) && h.w > 0 && Number.isFinite(h.h) && h.h > 0)) return `its size ${h.w} × ${h.h} is not a positive CSS px size`;
  if (!TRAY_ACCESSORIES.includes(h.accessory)) return `its accessory "${String(h.accessory)}" is not one of ${TRAY_ACCESSORIES.join(", ")}`;
  if (!Array.isArray(h.pegs) || h.pegs.length === 0) return "it names no peg — an accessory plugs into at least one hole";
  const [x0, y0] = h.pegs[0] as readonly [number, number];
  for (const p of h.pegs) {
    if (!Array.isArray(p) || p.length !== 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return `a peg ${JSON.stringify(p)} is not [dx, dy] in pitches`;
    const dy = (p[1] as number) - (y0 as number);
    const dx = (p[0] as number) - (x0 as number);
    if (!whole(dy)) return `the peg [${p.join(", ")}] is ${dy} rows from the first — pegs lie a whole number of rows apart`;
    if (!whole(dx - dy / 2)) return `the peg [${p.join(", ")}] is ${dx} pitches across from the first over ${dy} rows — the stagger puts holes a whole pitch apart on one parity, a half on the other`;
  }
  return null;
}

/** The (category, order, type) order. */
export function trayOrder(a: TrayItem, b: TrayItem): number {
  const ca = a.category ?? "";
  const cb = b.category ?? "";
  if (ca !== cb) return ca < cb ? -1 : 1;
  const oa = a.order ?? 0;
  const ob = b.order ?? 0;
  if (oa !== ob) return oa - ob;
  return a.type < b.type ? -1 : a.type > b.type ? 1 : 0;
}

/** A hang's footprint, pitches from its hang point: the specimen, its pegs' plugs and its accessory. */
export function hangFootprint(h: TrayHang, pitch: number): TrayBox {
  const A = TRAY_ACCESSORY;
  const hw = h.w / pitch / 2;
  const hh = h.h / pitch;
  const shelf = h.accessory === "shelf";
  let x0 = -hw;
  let x1 = hw;
  let y0 = shelf ? -hh : 0;
  let y1 = shelf ? 0 : hh;
  const add = (a: number, b: number, c: number, d: number): void => { x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, c); y1 = Math.max(y1, d); };
  const xs = h.pegs.map((p) => p[0]);
  for (const [dx, dy] of h.pegs) {
    add(dx - A.plug.hx, dy - A.plug.hy, dx + A.plug.hx, dy + A.plug.hy);
    if (h.accessory === "hook") add(dx - A.hook.hx, dy, dx + A.hook.hx, dy + A.hook.drop);
    if (h.accessory === "clip") add(dx - A.clip.hx, dy, dx + A.clip.hx, Math.max(dy, 0) + A.clip.below);
    if (shelf) add(dx - A.shelf.bracket, Math.min(0, dy), dx + A.shelf.bracket, Math.max(0, dy));
  }
  if (shelf) add(-hw - A.shelf.overhang, 0, hw + A.shelf.overhang, A.shelf.thick);
  if (h.accessory === "rail") {
    const ys = h.pegs.map((p) => p[1]);
    add(Math.min(...xs) - A.rail.overhang, Math.min(...ys) - A.rail.hy, Math.max(...xs) + A.rail.overhang, Math.max(...ys) + A.rail.hy);
  }
  return { x0, y0, x1, y1 };
}

/** The hole (row, col) whose centre is at board pitches (x, y) — the pegs' lattice, exact for a peg the law laid. */
function holeAt(x: number, y: number): { readonly row: number; readonly col: number } {
  const row = Math.round(y - PEG_LATTICE.rowPhase);
  const col = Math.round(x - PEG_LATTICE.colPhase - ((row & 1) !== 0 ? 0.5 : 0));
  return { row, col };
}

/** Where a hang's specimen's top edge lies below its hang point, pitches (0, or a shelf's specimen's height above it). */
const bodyTop = (h: TrayHang, pitch: number): number => (h.accessory === "shelf" ? -h.h / pitch : 0);

/**
 * One item placed at the first holes whose footprint lies on or below `top`, whose specimen's top edge lies on or below `body`,
 * right of `left` (pitches): its hang point, pegs and footprint.
 */
function fit(item: TrayItem, top: number, body: number, left: number, pitch: number): { readonly hx: number; readonly hy: number; readonly box: TrayBox; readonly pegs: readonly (readonly [number, number])[] } {
  const L = PEG_LATTICE;
  const h = item.hang;
  const fp = hangFootprint(h, pitch);
  const [dx0, dy0] = h.pegs[0] as readonly [number, number];
  // the first peg's row: the first whose hang point puts the footprint at or below the line's top and the specimen at or below its body line
  const r0 = Math.ceil(Math.max(top - fp.y0, body - bodyTop(h, pitch)) + dy0 - L.rowPhase - EPS);
  const hy = r0 + L.rowPhase - dy0;
  // its column: the first hole on that row's parity (the stagger) with the footprint right of the cursor and every peg punched
  const odd = (r0 & 1) !== 0 ? 0.5 : 0;
  const minDx = Math.min(...h.pegs.map((p) => p[0]));
  const want = Math.max(left - fp.x0 + dx0, L.border - minDx + dx0);
  const c0 = Math.ceil(want - L.colPhase - odd - EPS);
  const hx = c0 + L.colPhase + odd - dx0;
  return { hx, hy, box: { x0: hx + fp.x0, y0: hy + fp.y0, x1: hx + fp.x1, y1: hy + fp.y1 }, pegs: h.pegs.map(([dx, dy]) => [hx + dx, hy + dy] as const) };
}

/**
 * Lay the items on a board `width` px wide at `pitch` px (design-017 §8): in (category, order, type) order, left to right, a
 * line at a time — an item that would cross the right margin (or put a peg in the right border) starts the next line, a clear
 * row below the last one's foot. A line's specimens hang with their top edges together (as near as their holes allow): each
 * below the line's top by the most any item's accessory reaches above its specimen. Every peg on a punched hole's centre.
 */
export function layTray(items: readonly TrayItem[], width: number, pitch: number, spacing: TraySpacing = TRAY_SPACING): TrayLayout {
  const S = spacing;
  const cols = width / pitch;
  const sorted = [...items].sort(trayOrder);
  // the tallest reach above a specimen (a hook's hole over a note): every line's specimens start that far below its top
  const lead = Math.max(0, ...sorted.map((i) => bodyTop(i.hang, pitch) - hangFootprint(i.hang, pitch).y0));
  const placed: TrayPlaced[] = [];
  let top = S.top;
  let left = S.margin;
  let foot = top;
  let line = 0;
  let inLine = 0;
  const fits = (f: ReturnType<typeof fit>): boolean => f.box.x1 <= cols - S.margin + EPS && f.pegs.every(([x]) => x <= cols - PEG_LATTICE.border + EPS);
  for (const item of sorted) {
    let f = fit(item, top, top + lead, left, pitch);
    if (inLine > 0 && !fits(f)) {
      top = foot + S.clear;
      left = S.margin;
      line += 1;
      inLine = 0;
      f = fit(item, top, top + lead, left, pitch);
    }
    const h = item.hang;
    const x = f.hx * pitch - h.w / 2;
    const y = h.accessory === "shelf" ? f.hy * pitch - h.h : f.hy * pitch;
    placed.push({
      type: item.type, x, y, w: h.w, h: h.h, line,
      pegs: f.pegs.map(([px, py]) => { const { row, col } = holeAt(px, py); return { row, col, x: px * pitch, y: py * pitch }; }),
      box: { x0: f.box.x0 * pitch, y0: f.box.y0 * pitch, x1: f.box.x1 * pitch, y1: f.box.y1 * pitch },
    });
    left = f.box.x1 + S.gap;
    foot = inLine === 0 ? f.box.y1 : Math.max(foot, f.box.y1);
    inLine += 1;
  }
  return { placed, bottom: placed.length === 0 ? 0 : foot * pitch };
}

/** The board's scroll range (design-017 §8): the last line's foot plus a pitch, less the face the drawer shows — never below 0. */
export function trayScrollMax(bottom: number, face: number, pitch: number): number {
  return bottom <= 0 ? 0 : Math.max(0, bottom + pitch - face);
}
