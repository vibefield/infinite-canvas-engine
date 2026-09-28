/**
 * THE GATE'S TIMING ROWS (ICE M21, K-H) — `scripts/timing.mjs`, the harness the rigs' timed rows share. The A/A control judged by
 * its METHOD (D-KH.2) on two runs measured on this Mac at load 159–161 with two other rigs drawing (rig:gpu's desk: 24 notes, a
 * notebook, a whiteboard; `kindCost({ rounds: 21 })`, the raw rounds): D-K2.5's read failed both — its floor, which a loaded host
 * swells, over 10 % of the frame — though the control read zero; the paired read passes both, and the SAME runs with the control
 * swapped for the frame WITHOUT the whiteboard (a mismatched A/A) fail by tens of deviations. A habit of 0.3 % on a silent host is
 * not a broken method; the desk drawing beside the batches is; a failed witness is re-measured once and judged pooled (D-KH.3).
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error — a rig harness module (plain ESM, no declarations)
import { aaVerdict, minOf, twoWitnesses } from "../scripts/timing.mjs";

interface Kc {
  readonly samples: { readonly base: number[]; readonly control: number[]; readonly board?: number[] };
  readonly base: { readonly median: number };
  readonly aa: number;
  readonly noise: number;
  readonly kinds: Record<string, { ms: number; clears: boolean }>;
}
const LOADED_161: Kc = {
  samples: {
    base: [3.209, 4.601, 4.143, 2.879, 2.711, 2.731, 2.916, 4.213, 3.589, 4.043, 2.329, 3.63, 1.973, 2.225, 3.204, 2.314, 2.577, 1.953, 3.745, 3.879, 4.149],
    control: [3.107, 3.735, 4.505, 3.144, 4.36, 2.872, 3.914, 5.884, 4.236, 2.93, 2.357, 2.689, 2.729, 2.766, 2.906, 2.331, 2.032, 2.468, 3.897, 4.059, 3.559],
    board: [2.291, 2.775, 3.099, 1.658, 1.973, 1.998, 2.16, 2.647, 2.579, 2.296, 2.018, 2.827, 1.645, 1.457, 1.419, 1.78, 1.591, 1.44, 2.179, 2.888, 2.984],
  },
  base: { median: 3.204 },
  aa: -0.0971,
  noise: 0.5414,
  kinds: { paper: { ms: 1.197, clears: true }, notebook: { ms: 0.241, clears: false }, board: { ms: 0.986, clears: true } },
};
const LOADED_159: Kc = {
  samples: {
    base: [2.382, 3.543, 2.627, 2.205, 2.547, 3.756, 2.564, 2.707, 2.102, 2.484, 2.768, 2.244, 2.068, 2.637, 2.874, 3.025, 2.259, 2.277, 2.772, 3.519, 2.809],
    control: [2.315, 1.997, 2.064, 1.99, 2.549, 2.741, 2.434, 2.3017, 2.129, 2.504, 2.352, 2.768, 2.115, 3.098, 2.885, 4.582, 3.181, 2.298, 3.412, 3.198, 2.322],
    board: [1.682, 1.607, 2.3033, 1.527, 1.882, 1.429, 1.934, 1.733, 1.575, 1.684, 1.759, 1.498, 1.577, 1.538, 3.199, 2.688, 2.651, 1.575, 1.591, 2.981, 1.656],
  },
  base: { median: 2.627 },
  aa: -0.1933,
  noise: 0.4058,
  kinds: { paper: { ms: 0.972, clears: true }, notebook: { ms: 0.166, clears: false }, board: { ms: 0.699, clears: true } },
};
/** D-K2.5 as rig:gpu asserted it: |median(control) − median(base)| ≤ max(2 × floor, 2 %) and the floor ≤ 10 % of the frame. */
const dK25 = (kc: Kc): boolean => Math.abs(kc.aa) <= Math.max(2 * kc.noise, 0.02 * kc.base.median) && kc.noise <= 0.1 * kc.base.median;
/** The same run with its control swapped for the frame without the whiteboard — a control that is not the base. */
const mismatched = (kc: Kc): Kc => ({ ...kc, samples: { ...kc.samples, control: kc.samples.board as number[] } });

describe("the A/A control judged by its method (D-KH.2)", () => {
  it("a loaded host's A/A reads zero against its own spread — where D-K2.5's floor bound failed it", () => {
    for (const kc of [LOADED_161, LOADED_159]) {
      expect(dK25(kc)).toBe(false);   // the floor 0.54 / 0.41 ms: over 10 % of a 3.2 / 2.6 ms frame
      const v = aaVerdict(kc);
      expect(v.ok, v.text).toBe(true);
      expect(v.z).toBeLessThan(1.5);
      expect(v.R).toBe(21);
    }
  });

  it("a MISMATCHED control fails however loaded the run — a systematic offset every round shares", () => {
    for (const kc of [LOADED_161, LOADED_159]) {
      const v = aaVerdict(mismatched(kc));
      expect(v.ok, v.text).toBe(false);
      expect(v.z).toBeGreaterThan(6);   // the paired offset −0.99 / −0.70 ms against its spread
      expect(v.text).toContain("the offset is real");
    }
  });

  it("a habit of 0.3 % on a silent host is not a broken method (the 2 % allowance); 3 % is", () => {
    const quiet = (offset: number): Kc => {
      const base = Array.from({ length: 21 }, (_, r) => 2 + 0.0004 * ((r * 7) % 5));
      return { samples: { base, control: base.map((x, r) => x + offset + 0.0002 * ((r * 3) % 4)) }, base: { median: 2 }, aa: offset, noise: offset, kinds: { paper: { ms: 0.7, clears: true } } };
    };
    const habit = aaVerdict(quiet(0.006));
    expect(habit.z).toBeGreaterThan(3);
    expect(habit.ok, habit.text).toBe(true);
    const broken = aaVerdict(quiet(0.06));
    expect(broken.ok, broken.text).toBe(false);
  });

  it("the desk drawing frames of its own beside the batches fails it, and so does a run where nothing clears", () => {
    expect(aaVerdict(LOADED_161, { redraws: 3 }).ok).toBe(false);
    expect(aaVerdict(LOADED_161, { redraws: 3 }).text).toContain("the desk drew 3 frames of its own");
    const none = { ...LOADED_161, kinds: { paper: { ms: 0.4, clears: false } } };
    expect(aaVerdict(none).ok).toBe(false);
    expect(aaVerdict(none).text).toContain("no kind clears");
  });

  it("a second witness pools the rounds: a clean run dilutes a burst, a mismatch only grows", () => {
    const burst = { ...LOADED_159, samples: { ...LOADED_159.samples, control: LOADED_159.samples.control.map((x, r) => (r < 16 ? x + 0.8 : x)) } };
    expect(aaVerdict(burst).ok).toBe(false);
    expect(aaVerdict(LOADED_161, { pool: burst }).ok).toBe(true);
    const m = aaVerdict(mismatched(LOADED_161), { pool: mismatched(LOADED_159) });
    expect(m.R).toBe(42);
    expect(m.ok).toBe(false);
    expect(m.z).toBeGreaterThan(aaVerdict(mismatched(LOADED_161)).z);
  });
});

describe("two witnesses (D-KH.3)", () => {
  it("measures once when the first passes; on a failure measures again, hands the judge the first, and names it", async () => {
    const seen: (number | undefined)[] = [];
    const judge = (r: number, earlier?: number) => { seen.push(earlier); return { ok: r > 1, text: `r${r}` }; };
    const once = await twoWitnesses(async () => 2, judge);
    expect(once.ok).toBe(true);
    expect(once.second).toBeUndefined();
    let n = 0;
    const again = await twoWitnesses(async () => ++n, judge);
    expect(again.ok).toBe(true);
    expect(seen.at(-1)).toBe(1);
    expect(again.text).toContain("the first failed: r1");
    const never = await twoWitnesses(async () => 0, judge);
    expect(never.ok).toBe(false);
  });

  it("minOf is the minimum", () => {
    expect(minOf([0.334, 0.301, 0.21, 0.29])).toBe(0.21);
  });
});
