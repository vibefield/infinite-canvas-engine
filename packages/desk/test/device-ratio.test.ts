// @vitest-environment node
// THE DEVICE RATIO (petition I29): a fragment's CSS px is its device px over the ATTACHMENT's own ratio — the frame's dpr, a capture's
// dpr × scale (a thumbnail at 0.25 of a dpr-2 view: 0.5), the held desk copy's dpr / 2 (0.5 on a dpr-1 screen) — so every ratio the
// desk's WGSL binds is the view block's own, guarded against an unset block alone. Floored at 1 (`mat_dpr` until I29), a still below
// ratio 1 shaded each fragment at the wrong point of the desk: the note, the mini mat, the whiteboard and the print drew nothing, and
// the mat was drawn magnified from the view's corner. Each binding the desk's generated text holds, evaluated at ratios 1/8 … 3
// (./ratio.ts). The pixels are the oracle's (`captureCheck`: every kind counted in a 0.25 still against the 1× still downsampled) and
// rig:capture's; the six kinds' own modules are objects/test/device-ratio.test.ts's.
import { describe, expect, it } from "vitest";
import { WGSL } from "../src/shaders.gen";
import { must } from "./must";
import { matDprOf, ratioAt, ratioReads } from "./ratio";

const RATIOS = [0.125, 0.25, 0.5, 0.75, 1, 1.5, 2, 3];
const MAT_DPR = must(matDprOf(WGSL["mat/mat.wgsl"]), "mat.wgsl's `mat_dpr`");

describe("the device ratio the desk's WGSL converts by (petition I29)", () => {
  it("`mat_dpr` — the mat's, the rulers', every flat kind's — is the attachment's ratio at every ratio, below 1 too; an unset block divides by no zero", () => {
    for (const r of RATIOS) expect(ratioAt(MAT_DPR, r), `mat_dpr at ${r}`).toBe(r);
    expect(ratioAt(MAT_DPR, 0)).toBeGreaterThan(0);
  });

  it("every ratio a desk pass binds — the mat's and the rulers' (through `mat_dpr`), the missing face's two, the marks', the tray's, the layers' composite — is the attachment's", () => {
    const reads = Object.entries(WGSL).flatMap(([file, code]) => ratioReads(code).filter((rd) => rd.where !== "mat_dpr").map((rd) => ({ file, ...rd })));
    expect(reads.map((rd) => `${rd.file} ${rd.where}`)).toEqual(expect.arrayContaining([
      "mat/mat-pass.wgsl fs", "mat/ruler.wgsl ruler_band", "mat/ruler.wgsl ruler_ink", "missing/missing-pass.wgsl vs", "missing/missing-pass.wgsl fs",
      "marks/marks-pass.wgsl fs", "tray/tray.wgsl tray_drawer", "kit/composite.wgsl fs",
    ]));
    for (const rd of reads) for (const r of RATIOS) expect(ratioAt(rd.expr, r, MAT_DPR), `${rd.file} (${rd.where}): let dpr = ${rd.expr}, at ${r}`).toBe(r);
  });

  it("the portal clip's edge ramp is one device px at every ratio — the chain's cover is the attachment's, as every fragment under it", () => {
    const px = must(/fn portal_cover_one\([^)]*\)[^{]*\{\s*let px = ([^;]+);/.exec(WGSL["portal.wgsl"])?.[1], "portal_cover_one's `px`");
    for (const r of RATIOS) expect(ratioAt(px, r), `CSS px a device px at ${r}`).toBeCloseTo(1 / r, 12);
  });
});
