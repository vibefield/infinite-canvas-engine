/**
 * The `app` rig's capture arithmetic, as a module of its own (C4c).
 *
 * It moved out of `composited-app.tsx` so `test/rig-capture.test.ts` can grade the
 * grader: the Phase C review found `diffCaptures` walking two images of different
 * sizes row-shifted against each other and reporting a plausible percentage, and a
 * witness that cannot fail is not a witness. Importing the rig module itself is not
 * an option — it mounts a board and reaches for a device at import.
 *
 * Nothing here touches a GPU or the DOM: bytes in, numbers out.
 */
export interface Capture {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}
export interface CaptureStats {
  readonly id: string;
  readonly type: string;
  readonly arm: string;
  readonly width: number;
  readonly height: number;
  readonly distinctColors: number;
  readonly inkPixels: number;
  readonly meanLuma: number;
  readonly inkCentroidX: number;
  readonly inkCentroidY: number;
  readonly hash: string;
}
export interface DiffResult {
  readonly totalPixels: number;
  readonly differingPixels: number;
  readonly differingBeyond1: number;
  /**
   * Pixels differing by more than 16/255 — the SHARP number. A metallic clearcoat's
   * specular comes off a mip chain the two backends build with different filters, so
   * `beyond1` counts a broad haze of last-bit disagreement; `beyond16` counts pixels
   * that are actually a different colour, which is the claim worth gating.
   */
  readonly differingBeyond16: number;
  readonly maxChannelDelta: number;
  readonly meanAbsDelta: number;
  readonly differingPct: number;
  readonly beyond1Pct: number;
  readonly beyond16Pct: number;
}

/** WebGL reads BOTTOM-UP; every capture in this rig is normalised to row 0 = top. */
export function flipRows(data: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data.length);
  const stride = width * 4;
  for (let y = 0; y < height; y++) {
    out.set(data.subarray((height - 1 - y) * stride, (height - y) * stride), y * stride);
  }
  return out;
}

export function statsOf(id: string, type: string, arm: string, cap: Capture): CaptureStats {
  const colours = new Set<number>();
  let ink = 0;
  let sx = 0;
  let sy = 0;
  let luma = 0;
  let hash = 2166136261;
  for (let y = 0; y < cap.height; y++) {
    for (let x = 0; x < cap.width; x++) {
      const i = (y * cap.width + x) * 4;
      const r = cap.data[i] as number;
      const g = cap.data[i + 1] as number;
      const b = cap.data[i + 2] as number;
      const a = cap.data[i + 3] as number;
      colours.add((r << 24) | (g << 16) | (b << 8) | a);
      if (a > 8) {
        ink += 1;
        sx += x;
        sy += y;
        luma += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      }
      hash = Math.imul(hash ^ r, 16777619) ^ g;
      hash = Math.imul(hash ^ b, 16777619) ^ a;
    }
  }
  return {
    id,
    type,
    arm,
    width: cap.width,
    height: cap.height,
    distinctColors: colours.size,
    inkPixels: ink,
    meanLuma: ink === 0 ? 0 : luma / ink,
    inkCentroidX: ink === 0 ? -1 : sx / ink / cap.width,
    inkCentroidY: ink === 0 ? -1 : sy / ink / cap.height,
    hash: (hash >>> 0).toString(16),
  };
}

export function diffCaptures(a: Capture, b: Capture): DiffResult {
  // Equal dimensions or nothing (C4c): `Math.min` of two pixel COUNTS walks two
  // images of different widths row-shifted against each other and reports a
  // plausible percentage for a comparison that never happened.
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`rig: cannot diff ${a.width}x${a.height} against ${b.width}x${b.height} — a sheared diff is not a measurement`);
  }
  const total = a.width * a.height;
  let differing = 0;
  let beyond1 = 0;
  let beyond16 = 0;
  let maxDelta = 0;
  let sum = 0;
  for (let i = 0; i < total * 4; i += 4) {
    let worst = 0;
    for (let c = 0; c < 4; c++) {
      const d = Math.abs((a.data[i + c] as number) - (b.data[i + c] as number));
      sum += d;
      if (d > worst) worst = d;
    }
    if (worst > 0) differing += 1;
    if (worst > 1) beyond1 += 1;
    if (worst > 16) beyond16 += 1;
    if (worst > maxDelta) maxDelta = worst;
  }
  return {
    totalPixels: total,
    differingPixels: differing,
    differingBeyond1: beyond1,
    differingBeyond16: beyond16,
    maxChannelDelta: maxDelta,
    meanAbsDelta: sum / (total * 4),
    differingPct: total === 0 ? 0 : (differing / total) * 100,
    beyond1Pct: total === 0 ? 0 : (beyond1 / total) * 100,
    beyond16Pct: total === 0 ? 0 : (beyond16 / total) * 100,
  };
}

