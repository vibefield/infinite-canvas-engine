/**
 * Pure auto-layout math (2026-07-17, James: cards dropped into a folder "just
 * pile up on each other" — and, later, an explicit desktop-style Clean Up).
 *
 * Two primitives, two products, one law each:
 *  - `insertSlot` — place ONE newcomer near a drop hint without moving
 *    anything: newcomers get a free slot, incumbents never move. Consumed by
 *    the drop-consume path (l3-behave). Candidates are edge-aligned to the
 *    incumbents (flush right/below/left/above with a gutter), so successive
 *    drops grow aligned rows and columns instead of a global imposed grid.
 *  - `packLayout` — order-preserving shelf packing for the explicit
 *    "Clean Up" command: items flow in reading order (current y, then x)
 *    into left-to-right rows from the cluster's own top-left, so the result
 *    reads as "my mess, straightened", not a shuffle. Idempotent: a packed
 *    layout re-packs to itself (post-pack reading order IS the pack order).
 *
 * Plain structs in, plain structs out (Law 13): no ECS, no DOM, no camera.
 * All coordinates live in ONE frame — callers convert (container-local for
 * folder drops, world for canvas clean-up) before and after.
 */

export interface LayoutRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface LayoutSize {
  readonly w: number;
  readonly h: number;
}

export interface LayoutPoint {
  readonly x: number;
  readonly y: number;
}

/** True when the rects are closer than `gutter` on BOTH axes (≥gutter on either axis = fine). */
function crowds(a: LayoutRect, b: LayoutRect, gutter: number): boolean {
  return (
    a.x < b.x + b.w + gutter &&
    b.x < a.x + a.w + gutter &&
    a.y < b.y + b.h + gutter &&
    b.y < a.y + a.h + gutter
  );
}

function isFree(x: number, y: number, size: LayoutSize, incumbents: readonly LayoutRect[], gutter: number): boolean {
  const r = { x, y, w: size.w, h: size.h };
  for (const i of incumbents) {
    if (crowds(r, i, gutter)) return false;
  }
  return true;
}

/**
 * Nearest free slot to `hint` for a `size` newcomer among `incumbents`.
 *
 * The hint wins verbatim when it is already free (a deliberate drop into
 * empty space is user intent — don't second-guess it). Otherwise candidates
 * flush against each incumbent's edges (top- and far-aligned variants) are
 * ranked by squared distance to the hint; ties resolve to the first-seen
 * candidate (stable in incumbent order — deterministic across runs). The
 * fallback — a spot gutter-right of EVERYTHING — cannot crowd anyone, so a
 * slot always exists.
 */
export function insertSlot(
  incumbents: readonly LayoutRect[],
  size: LayoutSize,
  hint: LayoutPoint,
  gutter: number,
): { x: number; y: number } {
  if (incumbents.length === 0 || isFree(hint.x, hint.y, size, incumbents, gutter)) {
    return { x: hint.x, y: hint.y };
  }
  let best: { x: number; y: number } | undefined;
  let bestD = Number.POSITIVE_INFINITY;
  for (const i of incumbents) {
    const candidates = [
      { x: i.x + i.w + gutter, y: i.y }, // right, top-aligned
      { x: i.x, y: i.y + i.h + gutter }, // below, left-aligned
      { x: i.x - size.w - gutter, y: i.y }, // left, top-aligned
      { x: i.x, y: i.y - size.h - gutter }, // above, left-aligned
      { x: i.x + i.w + gutter, y: i.y + i.h - size.h }, // right, bottom-aligned
      { x: i.x + i.w - size.w, y: i.y + i.h + gutter }, // below, right-aligned
    ];
    for (const c of candidates) {
      if (!isFree(c.x, c.y, size, incumbents, gutter)) continue;
      const d = (c.x - hint.x) ** 2 + (c.y - hint.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
  }
  if (best !== undefined) return best;
  let maxRight = Number.NEGATIVE_INFINITY;
  for (const i of incumbents) maxRight = Math.max(maxRight, i.x + i.w);
  return { x: maxRight + gutter, y: hint.y };
}

export interface PackOpts {
  readonly gutter: number;
  /** Row origin; defaults to the items' current bbox top-left (the cluster stays put). */
  readonly origin?: LayoutPoint;
  /**
   * Row wrap width; defaults to a near-square derivation (√(total area × 1.6),
   * never narrower than the widest item).
   */
  readonly maxWidth?: number;
}

/**
 * Order-preserving shelf packing: items in reading order of their CURRENT
 * positions (strict y, then x, then input index) flow into left-to-right
 * rows; a row wraps when the next item would cross `maxWidth`; row height is
 * the tallest member. Returns placements parallel to the input array.
 *
 * Rows are ragged by design (v1 tidy) — the near-modular widget sizes make
 * ragged shelves read as a grid anyway. A future refinement can band-quantize
 * the reading order so near-tied y values don't interleave visual rows.
 */
export function packLayout(items: readonly LayoutRect[], opts: PackOpts): Array<{ x: number; y: number }> {
  if (items.length === 0) return [];
  const gutter = opts.gutter;

  let ox: number;
  let oy: number;
  if (opts.origin !== undefined) {
    ox = opts.origin.x;
    oy = opts.origin.y;
  } else {
    ox = Number.POSITIVE_INFINITY;
    oy = Number.POSITIVE_INFINITY;
    for (const it of items) {
      ox = Math.min(ox, it.x);
      oy = Math.min(oy, it.y);
    }
  }

  let maxWidth = opts.maxWidth;
  if (maxWidth === undefined) {
    let area = 0;
    let widest = 0;
    for (const it of items) {
      area += (it.w + gutter) * (it.h + gutter);
      widest = Math.max(widest, it.w);
    }
    maxWidth = Math.max(widest, Math.sqrt(area * 1.6));
  }

  const order = items
    .map((_, i) => i)
    .sort((a, b) => {
      const ia = items[a] as LayoutRect;
      const ib = items[b] as LayoutRect;
      return ia.y - ib.y || ia.x - ib.x || a - b;
    });

  const out = new Array<{ x: number; y: number }>(items.length);
  let cursorX = ox;
  let rowY = oy;
  let rowH = 0;
  for (const idx of order) {
    const it = items[idx] as LayoutRect;
    if (cursorX > ox && cursorX + it.w > ox + maxWidth) {
      rowY += rowH + gutter;
      cursorX = ox;
      rowH = 0;
    }
    out[idx] = { x: cursorX, y: rowY };
    cursorX += it.w + gutter;
    rowH = Math.max(rowH, it.h);
  }
  return out;
}
