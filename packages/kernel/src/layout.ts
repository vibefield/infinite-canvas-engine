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
 *  - `packLayout` — bottom-left candidate packing for the explicit
 *    "Clean Up" command (v2 2026-07-17, James: shelves were "not really
 *    efficient" and selection packs "overlay on top of unselected widgets"):
 *    items flow in reading order (current y, then x, then index) and each
 *    takes the lowest-then-leftmost free spot, so small cards fill the air
 *    beside tall ones instead of opening a new shelf. `obstacles` rects are
 *    honored as immovable — a scoped pack flows AROUND bystanders. Still
 *    "my mess, straightened": deterministic, anchored at the cluster's own
 *    top-left, idempotent on packed input (pinned by test).
 *  - `layerGraph` — the Unreal-Blueprint-style arrange for WIRED widgets:
 *    Sugiyama-lite layered layout (longest-path ranks along edge direction,
 *    barycenter ordering, columns left→right, vertically centered). Callers
 *    lay out each connected component with this and pack the resulting
 *    blocks with `packLayout`.
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
  /** Pack origin; defaults to the items' current bbox top-left (the cluster stays put). */
  readonly origin?: LayoutPoint;
  /**
   * Band wrap width; defaults to a near-square derivation (√(total area × 1.6),
   * never narrower than the widest item). Soft: an item that fits nowhere
   * inside the band still places (lowest spot, band ignored) rather than
   * failing.
   */
  readonly maxWidth?: number;
  /**
   * Immovable rects the pack must flow AROUND (e.g. unselected widgets when
   * arranging a selection). Never returned, never moved, never crowded.
   */
  readonly obstacles?: readonly LayoutRect[];
}

/**
 * Bottom-left candidate packing: items in reading order of their CURRENT
 * positions (strict y, then x, then input index) each take the
 * lowest-then-leftmost free spot from the candidate set (the origin, plus
 * gutter-flush right-of and below-of every placed/obstacle rect, plus the
 * band-left row start under each). Dense with mixed sizes — small cards fill
 * the air beside tall ones — and obstacle-aware. Returns placements parallel
 * to the input array.
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

  // Feasibility set: obstacles first (they also seed candidates), then
  // every placed item as it lands.
  const placed: LayoutRect[] = [...(opts.obstacles ?? [])];
  const out = new Array<{ x: number; y: number }>(items.length);
  for (const idx of order) {
    const it = items[idx] as LayoutRect;
    const cands: LayoutPoint[] = [{ x: ox, y: oy }];
    for (const r of placed) {
      cands.push({ x: r.x + r.w + gutter, y: r.y }); // right, top-aligned
      cands.push({ x: r.x, y: r.y + r.h + gutter }); // below, left-aligned
      cands.push({ x: ox, y: r.y + r.h + gutter }); // band-left row start
    }
    let best: LayoutPoint | undefined;
    // Pass 1 honors the band; pass 2 drops it (an oversize item or a wall of
    // obstacles must still place — the below-everything candidate is always
    // free, so pass 2 cannot come up empty).
    for (const inBand of [true, false]) {
      for (const c of cands) {
        if (c.x < ox || c.y < oy) continue;
        if (inBand && c.x + it.w > ox + maxWidth) continue;
        if (!isFree(c.x, c.y, it, placed, gutter)) continue;
        if (best === undefined || c.y < best.y || (c.y === best.y && c.x < best.x)) best = c;
      }
      if (best !== undefined) break;
    }
    if (best === undefined) {
      // Defensive only (see pass-2 note above).
      let maxBottom = oy;
      for (const r of placed) maxBottom = Math.max(maxBottom, r.y + r.h);
      best = { x: ox, y: maxBottom + gutter };
    }
    out[idx] = { x: best.x, y: best.y };
    placed.push({ x: best.x, y: best.y, w: it.w, h: it.h });
  }
  return out;
}

export interface LayerGraphOpts {
  /** Horizontal gap between columns (leave room for wires to breathe). */
  readonly gapX: number;
  /** Vertical gap between nodes inside a column. */
  readonly gapY: number;
}

/**
 * Layered graph layout (Sugiyama-lite) — the Unreal-Blueprint-style arrange
 * for wired widgets. Rank = longest path from the sources along edge
 * direction (a DFS drops back edges, so cycles are safe); columns flow
 * left→right; nodes stack top→down within a column ordered by the barycenter
 * of their neighbors (3 alternating sweeps); every column is vertically
 * centered on the tallest one. Placements are relative to (0,0) — callers
 * anchor the block. Deterministic: all orderings tie-break on node index.
 */
export function layerGraph(
  nodes: readonly LayoutSize[],
  edges: readonly (readonly [number, number])[],
  opts: LayerGraphOpts,
): Array<{ x: number; y: number }> {
  const n = nodes.length;
  if (n === 0) return [];

  // Drop self-edges; find back edges via iterative DFS (in index order).
  const outAdj: number[][] = Array.from({ length: n }, () => []);
  for (const [u, v] of edges) {
    if (u !== v && u >= 0 && u < n && v >= 0 && v < n) outAdj[u]?.push(v);
  }
  const kept: Array<[number, number]> = [];
  const state = new Array<0 | 1 | 2>(n).fill(0); // 0 unseen, 1 on stack, 2 done
  for (let root = 0; root < n; root++) {
    if (state[root] !== 0) continue;
    const stack: Array<{ u: number; i: number }> = [{ u: root, i: 0 }];
    state[root] = 1;
    while (stack.length > 0) {
      const top = stack[stack.length - 1] as { u: number; i: number };
      const adj = outAdj[top.u] as number[];
      if (top.i < adj.length) {
        const v = adj[top.i] as number;
        top.i += 1;
        if (state[v] === 1) continue; // back edge — dropped
        kept.push([top.u, v]);
        if (state[v] === 0) {
          state[v] = 1;
          stack.push({ u: v, i: 0 });
        }
      } else {
        state[top.u] = 2;
        stack.pop();
      }
    }
  }

  // Longest-path ranks over the kept DAG (topological relaxation).
  const keptOut: number[][] = Array.from({ length: n }, () => []);
  const indeg = new Array<number>(n).fill(0);
  for (const [u, v] of kept) {
    keptOut[u]?.push(v);
    indeg[v] = (indeg[v] as number) + 1;
  }
  const rank = new Array<number>(n).fill(0);
  const queue: number[] = [];
  for (let i = 0; i < n; i++) if (indeg[i] === 0) queue.push(i);
  for (let qi = 0; qi < queue.length; qi++) {
    const u = queue[qi] as number;
    for (const v of keptOut[u] as number[]) {
      rank[v] = Math.max(rank[v] as number, (rank[u] as number) + 1);
      indeg[v] = (indeg[v] as number) - 1;
      if (indeg[v] === 0) queue.push(v);
    }
  }

  const maxRank = Math.max(...rank);
  const layers: number[][] = Array.from({ length: maxRank + 1 }, () => []);
  for (let i = 0; i < n; i++) layers[rank[i] as number]?.push(i);

  // Barycenter ordering: neighbors (both directions) pull a node toward
  // their average slot in the adjacent fixed layer.
  const neighbors: number[][] = Array.from({ length: n }, () => []);
  for (const [u, v] of kept) {
    neighbors[u]?.push(v);
    neighbors[v]?.push(u);
  }
  const slot = new Array<number>(n).fill(0);
  const reSlot = (): void => {
    for (const layer of layers) {
      layer.forEach((node, s) => {
        slot[node] = s;
      });
    }
  };
  reSlot();
  for (let sweep = 0; sweep < 3; sweep++) {
    const forward = sweep % 2 === 0;
    for (let li = forward ? 1 : maxRank - 1; forward ? li <= maxRank : li >= 0; li += forward ? 1 : -1) {
      const layer = layers[li] as number[];
      const bary = (node: number): number => {
        const ns = (neighbors[node] as number[]).filter((m) => Math.abs((rank[m] as number) - li) === 1);
        if (ns.length === 0) return slot[node] as number;
        return ns.reduce((sum, m) => sum + (slot[m] as number), 0) / ns.length;
      };
      layer.sort((a, b) => bary(a) - bary(b) || a - b);
      reSlot();
    }
  }

  // Coordinates: column x from per-layer max width; stacks centered on the
  // tallest column.
  const colX = new Array<number>(maxRank + 1).fill(0);
  let x = 0;
  for (let li = 0; li <= maxRank; li++) {
    colX[li] = x;
    let widest = 0;
    for (const node of layers[li] as number[]) widest = Math.max(widest, (nodes[node] as LayoutSize).w);
    x += widest + opts.gapX;
  }
  const colH = (layers as number[][]).map((layer) =>
    layer.reduce((sum, node, i) => sum + (nodes[node] as LayoutSize).h + (i > 0 ? opts.gapY : 0), 0),
  );
  const tallest = Math.max(...colH);

  const out = new Array<{ x: number; y: number }>(n);
  for (let li = 0; li <= maxRank; li++) {
    let y = (tallest - (colH[li] as number)) / 2;
    for (const node of layers[li] as number[]) {
      out[node] = { x: colX[li] as number, y };
      y += (nodes[node] as LayoutSize).h + opts.gapY;
    }
  }
  return out;
}
