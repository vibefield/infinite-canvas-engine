/**
 * Snap guide computation (Figma-style), ported verbatim from v1
 * `ecs/spatial/snap.ts` (audited CLEAN-PORT):
 *   Phase 1 — edge/center alignment (7 X + 7 Y candidate pairs per reference,
 *             per-axis nearest-wins, ties within 0.01 accumulate guides)
 *   Phase 2 — equal spacing (between-two-neighbors midpoint; extend-a-pattern),
 *             same-perpendicular-band filter
 *   Merge   — alignment takes priority per axis; equal spacing fills the other;
 *             indicators recomputed post-snap at threshold × 0.5.
 * Pure function over plain bounds. Candidate GATHERING (spatial index, tags,
 * Active scoping) is the caller's job — design-003 §5.2/§6.
 */

export interface SnapGuide {
  axis: "x" | "y";
  /** World-space coordinate of the alignment line */
  position: number;
  type: "edge" | "center";
}

export interface EqualSpacingIndicator {
  axis: "x" | "y";
  /** The equal gap value (world units) */
  gap: number;
  /** Pairs of (from, to) marking each equal gap segment */
  segments: { from: number; to: number }[];
  /** Position on the perpendicular axis (for rendering) */
  perpPosition: number;
}

export interface SnapResult {
  /** Snap-corrected delta (world units). Apply to entity position. */
  snapDx: number;
  snapDy: number;
  guides: SnapGuide[];
  spacings: EqualSpacingIndicator[];
}

export interface EntityBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function computeSnapGuides(
  dragged: EntityBounds,
  references: EntityBounds[],
  threshold: number,
): SnapResult {
  const guides: SnapGuide[] = [];
  const spacings: EqualSpacingIndicator[] = [];
  let snapDx = 0;
  let snapDy = 0;

  const dLeft = dragged.x;
  const dRight = dragged.x + dragged.width;
  const dCenterX = dragged.x + dragged.width / 2;
  const dTop = dragged.y;
  const dBottom = dragged.y + dragged.height;
  const dCenterY = dragged.y + dragged.height / 2;

  let bestSnapX = Number.POSITIVE_INFINITY;
  let bestSnapY = Number.POSITIVE_INFINITY;
  let bestDx = 0;
  let bestDy = 0;
  const xGuides: SnapGuide[] = [];
  const yGuides: SnapGuide[] = [];

  // --- Phase 1: edge/center alignment ---
  for (const ref of references) {
    const rLeft = ref.x;
    const rRight = ref.x + ref.width;
    const rCenterX = ref.x + ref.width / 2;
    const rTop = ref.y;
    const rBottom = ref.y + ref.height;
    const rCenterY = ref.y + ref.height / 2;

    const xPairs: [number, number, "edge" | "center"][] = [
      [dLeft, rLeft, "edge"],
      [dLeft, rRight, "edge"],
      [dRight, rLeft, "edge"],
      [dRight, rRight, "edge"],
      [dCenterX, rCenterX, "center"],
      [dLeft, rCenterX, "edge"],
      [dRight, rCenterX, "edge"],
    ];
    for (const [dVal, rVal, type] of xPairs) {
      const dist = Math.abs(dVal - rVal);
      if (dist <= threshold) {
        const dx = rVal - dVal;
        if (dist < bestSnapX) {
          bestSnapX = dist;
          bestDx = dx;
          xGuides.length = 0;
        }
        if (dist <= bestSnapX + 0.01) {
          xGuides.push({ axis: "x", position: rVal, type });
        }
      }
    }

    const yPairs: [number, number, "edge" | "center"][] = [
      [dTop, rTop, "edge"],
      [dTop, rBottom, "edge"],
      [dBottom, rTop, "edge"],
      [dBottom, rBottom, "edge"],
      [dCenterY, rCenterY, "center"],
      [dTop, rCenterY, "edge"],
      [dBottom, rCenterY, "edge"],
    ];
    for (const [dVal, rVal, type] of yPairs) {
      const dist = Math.abs(dVal - rVal);
      if (dist <= threshold) {
        const dy = rVal - dVal;
        if (dist < bestSnapY) {
          bestSnapY = dist;
          bestDy = dy;
          yGuides.length = 0;
        }
        if (dist <= bestSnapY + 0.01) {
          yGuides.push({ axis: "y", position: rVal, type });
        }
      }
    }
  }

  // --- Phase 2: equal spacing ---
  const eqResult = computeEqualSpacing(dragged, references, threshold);

  // Merge: alignment snap takes priority; equal spacing fills the other axis.
  if (bestSnapX <= threshold) {
    snapDx = bestDx;
  } else if (eqResult.snapDx !== undefined) {
    snapDx = eqResult.snapDx;
  }
  if (bestSnapY <= threshold) {
    snapDy = bestDy;
  } else if (eqResult.snapDy !== undefined) {
    snapDy = eqResult.snapDy;
  }

  if (bestSnapX <= threshold) {
    const seen = new Set<number>();
    for (const g of xGuides) {
      if (!seen.has(g.position)) {
        seen.add(g.position);
        guides.push(g);
      }
    }
  }
  if (bestSnapY <= threshold) {
    const seen = new Set<number>();
    for (const g of yGuides) {
      if (!seen.has(g.position)) {
        seen.add(g.position);
        guides.push(g);
      }
    }
  }

  // Indicators recomputed against the SNAPPED bounds at half threshold.
  const snappedBounds: EntityBounds = {
    x: dragged.x + snapDx,
    y: dragged.y + snapDy,
    width: dragged.width,
    height: dragged.height,
  };
  const eqFinal = computeEqualSpacing(snappedBounds, references, threshold * 0.5);
  spacings.push(...eqFinal.indicators);

  return { snapDx, snapDy, guides, spacings };
}

interface EqualSpacingResult {
  snapDx: number | undefined;
  snapDy: number | undefined;
  indicators: EqualSpacingIndicator[];
}

function computeEqualSpacing(
  dragged: EntityBounds,
  references: EntityBounds[],
  threshold: number,
): EqualSpacingResult {
  const indicators: EqualSpacingIndicator[] = [];
  let snapDx: number | undefined;
  let snapDy: number | undefined;

  const xResult = checkAxisSpacing(dragged, references, threshold, "x");
  if (xResult) {
    snapDx = xResult.snap;
    indicators.push(...xResult.indicators);
  }
  const yResult = checkAxisSpacing(dragged, references, threshold, "y");
  if (yResult) {
    snapDy = yResult.snap;
    indicators.push(...yResult.indicators);
  }
  return { snapDx, snapDy, indicators };
}

function checkAxisSpacing(
  dragged: EntityBounds,
  references: EntityBounds[],
  threshold: number,
  axis: "x" | "y",
): { snap: number; indicators: EqualSpacingIndicator[] } | null {
  const isX = axis === "x";
  const pos = (b: EntityBounds) => (isX ? b.x : b.y);
  const size = (b: EntityBounds) => (isX ? b.width : b.height);
  const perpPos = (b: EntityBounds) => (isX ? b.y : b.x);
  const perpSize = (b: EntityBounds) => (isX ? b.height : b.width);
  const end = (b: EntityBounds) => pos(b) + size(b);

  // Same-perpendicular-band filter.
  const neighbors = references.filter(
    (ref) =>
      perpPos(ref) < perpPos(dragged) + perpSize(dragged) &&
      perpPos(ref) + perpSize(ref) > perpPos(dragged),
  );
  if (neighbors.length < 1) return null;

  const sorted = [...neighbors].sort((a, b) => pos(a) - pos(b));

  // Existing gaps between consecutive references.
  const refGaps: { from: EntityBounds; to: EntityBounds; gap: number }[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (a === undefined || b === undefined) continue;
    const gap = pos(b) - end(a);
    if (gap > 0.1) refGaps.push({ from: a, to: b, gap });
  }

  let bestSnap: number | null = null;
  let bestIndicators: EqualSpacingIndicator[] = [];
  let bestDiff = Number.POSITIVE_INFINITY;

  // Case 1: between two neighbors — equalize left/right gaps.
  let leftN: EntityBounds | null = null;
  let rightN: EntityBounds | null = null;
  for (const ref of sorted) {
    if (end(ref) <= pos(dragged) + threshold) {
      if (!leftN || end(ref) > end(leftN)) leftN = ref;
    }
    if (pos(ref) >= end(dragged) - threshold) {
      if (!rightN || pos(ref) < pos(rightN)) rightN = ref;
    }
  }
  if (leftN && rightN) {
    const lGap = pos(dragged) - end(leftN);
    const rGap = pos(rightN) - end(dragged);
    const diff = Math.abs(lGap - rGap);
    if (diff <= threshold && diff < bestDiff) {
      const idealPos = (end(leftN) + pos(rightN) - size(dragged)) / 2;
      const snap = idealPos - pos(dragged);
      const equalGap = (pos(rightN) - end(leftN) - size(dragged)) / 2;
      if (equalGap > 0.1) {
        const perpY = computePerpCenter(dragged, [leftN, rightN], isX);
        bestSnap = snap;
        bestDiff = diff;
        bestIndicators = [
          {
            axis,
            gap: equalGap,
            segments: [
              { from: end(leftN), to: idealPos },
              { from: idealPos + size(dragged), to: pos(rightN) },
            ],
            perpPosition: perpY,
          },
        ];
      }
    }
  }

  // Case 2: extend an existing gap pattern (append right / prepend left).
  for (const refGap of refGaps) {
    const patternGap = refGap.gap;

    if (rightN === null || pos(refGap.to) >= end(dragged) - threshold * 2) {
      const chainEnd = refGap.to;
      const dragGap = pos(dragged) - end(chainEnd);
      const diff = Math.abs(dragGap - patternGap);
      if (diff <= threshold && diff < bestDiff) {
        const idealPos = end(chainEnd) + patternGap;
        const snap = idealPos - pos(dragged);
        const perpY = computePerpCenter(dragged, [refGap.from, refGap.to], isX);
        bestSnap = snap;
        bestDiff = diff;
        bestIndicators = [
          {
            axis,
            gap: patternGap,
            segments: [
              { from: end(refGap.from), to: pos(refGap.to) },
              { from: end(chainEnd), to: idealPos },
            ],
            perpPosition: perpY,
          },
        ];
      }
    }

    if (leftN === null || end(refGap.from) <= pos(dragged) + threshold * 2) {
      const chainStart = refGap.from;
      const dragGap = pos(chainStart) - end(dragged);
      const diff = Math.abs(dragGap - patternGap);
      if (diff <= threshold && diff < bestDiff) {
        const idealPos = pos(chainStart) - patternGap - size(dragged);
        const snap = idealPos - pos(dragged);
        const perpY = computePerpCenter(dragged, [refGap.from, refGap.to], isX);
        bestSnap = snap;
        bestDiff = diff;
        bestIndicators = [
          {
            axis,
            gap: patternGap,
            segments: [
              { from: idealPos + size(dragged), to: pos(chainStart) },
              { from: end(refGap.from), to: pos(refGap.to) },
            ],
            perpPosition: perpY,
          },
        ];
      }
    }
  }

  if (bestSnap !== null) return { snap: bestSnap, indicators: bestIndicators };
  return null;
}

function computePerpCenter(dragged: EntityBounds, refs: EntityBounds[], isX: boolean): number {
  const perpPos = (b: EntityBounds) => (isX ? b.y : b.x);
  const perpSize = (b: EntityBounds) => (isX ? b.height : b.width);
  const allBounds = [dragged, ...refs];
  const maxStart = Math.max(...allBounds.map(perpPos));
  const minEnd = Math.min(...allBounds.map((b) => perpPos(b) + perpSize(b)));
  if (minEnd < maxStart) {
    return perpPos(dragged) + perpSize(dragged) / 2;
  }
  return maxStart + (minEnd - maxStart) / 2;
}
