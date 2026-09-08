/**
 * The `app` rig's grader, graded (C4c).
 *
 * The Phase C review's finding: `diffCaptures` sized its walk with
 * `Math.min(a.width * a.height, b.width * b.height)` — two images of different widths
 * are then compared row-shifted against each other, and the result is a plausible
 * percentage for a comparison that never happened. The rig gates the C0 exit on that
 * number.
 *
 * Beside it, the property the cross-backend control rests on: the per-capture hash
 * separates two different images, so a control that had collapsed onto the composited
 * arm cannot read as a perfect match.
 */
import { describe, expect, it } from "vitest";
import { type Capture, diffCaptures, flipRows, statsOf } from "../src/rigs/capture";

/** A solid RGBA image. */
function solid(width: number, height: number, rgba: [number, number, number, number]): Capture {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgba[0];
    data[i + 1] = rgba[1];
    data[i + 2] = rgba[2];
    data[i + 3] = rgba[3];
  }
  return { width, height, data };
}

describe("diffCaptures", () => {
  it("REFUSES two captures of different dimensions instead of shearing them", () => {
    const a = solid(4, 4, [10, 20, 30, 255]);
    const b = solid(8, 2, [10, 20, 30, 255]); // the same 16 pixels, a different picture
    expect(() => diffCaptures(a, b)).toThrow(/cannot diff 4x4 against 8x2/);
    expect(() => diffCaptures(solid(4, 4, [0, 0, 0, 0]), solid(4, 5, [0, 0, 0, 0]))).toThrow(/sheared/);
  });

  it("counts every pixel of an equal-sized pair, by band", () => {
    const a = solid(2, 2, [100, 100, 100, 255]);
    const b = solid(2, 2, [101, 100, 100, 255]); // one channel, one step
    const d = diffCaptures(a, b);
    expect(d.totalPixels).toBe(4);
    expect(d.differingPixels).toBe(4);
    expect(d.differingBeyond1).toBe(0); // a 1/255 haze is not a different colour
    expect(d.maxChannelDelta).toBe(1);

    const far = diffCaptures(a, solid(2, 2, [200, 100, 100, 255]));
    expect(far.differingBeyond16).toBe(4);
    expect(far.maxChannelDelta).toBe(100);
    expect(diffCaptures(a, solid(2, 2, [100, 100, 100, 255])).differingPixels).toBe(0);
  });
});

describe("statsOf", () => {
  it("hashes two different images differently — the cross-backend control's basis", () => {
    const one = statsOf("A1", "card", "composited", solid(3, 3, [10, 20, 30, 255]));
    const same = statsOf("A2", "card", "composited", solid(3, 3, [10, 20, 30, 255]));
    const other = statsOf("B1", "card", "webgl control", solid(3, 3, [10, 20, 31, 255]));
    expect(one.hash).toBe(same.hash);
    expect(one.hash).not.toBe(other.hash);
  });

  it("reports the ink it can see, and nothing where alpha is zero", () => {
    const s = statsOf("A", "card", "arm", solid(2, 2, [255, 255, 255, 255]));
    expect(s.inkPixels).toBe(4);
    expect(Math.round(s.meanLuma)).toBe(255);
    expect(statsOf("A", "card", "arm", solid(2, 2, [255, 255, 255, 0])).inkPixels).toBe(0);
  });
});

describe("flipRows", () => {
  it("turns a bottom-up read into row 0 = top", () => {
    const data = new Uint8ClampedArray([1, 1, 1, 255, 2, 2, 2, 255]); // one column, two rows
    const out = flipRows(data, 1, 2);
    expect([...out.slice(0, 4)]).toEqual([2, 2, 2, 255]);
    expect([...out.slice(4)]).toEqual([1, 1, 1, 255]);
  });
});
