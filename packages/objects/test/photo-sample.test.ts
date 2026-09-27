// @vitest-environment node
// THE PRINT'S SAMPLE (K5b, D-K5b.4 — photo/sample.ts): the picture the print on the pegboard shows, made from arithmetic alone so every
// host makes the same bytes — its size, opaque, the same twice, a dusk (sky over water, warm at the horizon); and the print's tray
// entry names it (its face) while one taken is blank (no `take`: it asks for a picture).
import { describe, expect, it } from "vitest";
import { Photo } from "../src";
import { SAMPLE_PICTURE, SAMPLE_SIZE, samplePicture } from "../src/photo/sample";

const px = (b: Uint8Array, w: number, x: number, y: number): readonly [number, number, number, number] => {
  const i = (y * w + x) * 4;
  return [b[i] ?? 0, b[i + 1] ?? 0, b[i + 2] ?? 0, b[i + 3] ?? 0];
};

describe("the print's sample picture", () => {
  it("is its size, opaque, and the same bytes every time", () => {
    const a = samplePicture();
    expect(a.length).toBe(SAMPLE_SIZE.w * SAMPLE_SIZE.h * 4);
    for (let i = 3; i < a.length; i += 4) expect(a[i]).toBe(255);
    expect(samplePicture()).toEqual(a);
    expect(samplePicture(24, 16).length).toBe(24 * 16 * 4);
  });

  it("is a dusk over water: a blue sky overhead, warm at the horizon, darker water below", () => {
    const b = samplePicture();
    const W = SAMPLE_SIZE.w;
    const top = px(b, W, 20, 2);
    const horizon = px(b, W, 20, Math.floor(SAMPLE_SIZE.h * 0.5));
    const water = px(b, W, 20, SAMPLE_SIZE.h - 4);
    expect(top[2]).toBeGreaterThan(top[0]);           // blue overhead
    expect(horizon[0]).toBeGreaterThan(horizon[2]);   // warm low down
    expect(water[0] + water[1] + water[2]).toBeLessThan(horizon[0] + horizon[1] + horizon[2]);
  });

  it("is the print specimen's face, drawn with the kind's pictures; one taken is blank", () => {
    expect(Photo.tray?.props).toEqual({ blob: SAMPLE_PICTURE, width: SAMPLE_SIZE.w, height: SAMPLE_SIZE.h });
    expect(Photo.tray?.local).toBe(true);
    expect(Photo.tray?.take).toBeUndefined();
  });
});
