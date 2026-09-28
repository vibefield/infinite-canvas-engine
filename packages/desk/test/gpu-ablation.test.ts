// @vitest-environment node
// PER-KIND GPU COST BY ABLATION (design-016 §4.4, K2): every kind draws inside the one `ground` pass, so a kind's cost is what
// the frame loses without it — saturated, drained batches, probe-calibrated, round-robined, with an A/A control. Driven here on
// a clock whose GPU cost is a KNOWN function of what a frame draws, so the tool's arithmetic is exact: a kind's cost comes out
// as its objects × their unit cost, the A/A offset and the noise floor as zero; and the variants are the frame with a kind's
// objects left out of EVERY slot, an inside leaving with its mini mat.
import { describe, expect, it } from "vitest";
import { ablateKinds, kindsIn, withoutKind } from "../src/gpu-ablation";
import type { GroundFrameInputs, PortalInputs } from "../src/ground";

const o = (kind: string, id: string) => ({ kind, record: { id } });
const inside = (at: number, ids: string[]): PortalInputs => ({ at, grid: {} as PortalInputs["grid"], view: {} as PortalInputs["view"], objects: ids.map((i) => o("paper", i)) });
/** A frame: two notes, a mini mat (its inside: two notes), a print, a note; a departed desk with a mini mat and a note; something in hand. */
const FRAME = {
  view: {}, theme: {},
  objects: [o("paper", "a"), o("paper", "b"), o("minimat", "m"), o("photo", "p"), o("paper", "c")],
  portals: [inside(2, ["i1", "i2"])],
  outgoing: { grid: {}, view: {}, order: "under", objects: [o("minimat", "om"), o("paper", "od")], at: 0 },
  held: { e: 1 },
} as unknown as GroundFrameInputs;

describe("per-kind GPU cost by ablation (K2)", () => {
  it("withoutKind leaves a kind out of every slot, re-indexes the insides, takes an inside with its mini mat — and never draws the held object", () => {
    const names = (f: GroundFrameInputs) => ({
      root: (f.objects ?? []).map((x) => (x.record as { id: string }).id),
      portals: (f.portals ?? []).map((p) => `${p.at}:${(p.objects ?? []).map((x) => (x.record as { id: string }).id).join(",")}`),
      out: (f.outgoing?.objects ?? []).map((x) => (x.record as { id: string }).id),
      outAt: f.outgoing?.at,
      held: "held" in f,
    });
    expect(names(withoutKind(FRAME, null))).toEqual({ root: ["a", "b", "m", "p", "c"], portals: ["2:i1,i2"], out: ["om", "od"], outAt: 0, held: false });
    expect(names(withoutKind(FRAME, "paper"))).toEqual({ root: ["m", "p"], portals: ["0:"], out: ["om"], outAt: 0, held: false });   // the inside's notes too; the mat re-indexed
    expect(names(withoutKind(FRAME, "minimat"))).toEqual({ root: ["a", "b", "p", "c"], portals: [], out: ["od"], outAt: undefined, held: false });   // its inside went with it
    expect(kindsIn(FRAME)).toEqual({ paper: 6, minimat: 2, photo: 1 });
  });

  it("the arithmetic on a known cost: each kind's cost is its objects × their unit cost; the A/A offset and the noise floor are zero; drained around every batch", async () => {
    const UNIT: Record<string, number> = { paper: 0.05, minimat: 0.2, photo: 0.4 };
    const FIXED = 0.3;   // the mat, the clear: what no kind's absence takes away
    let clock = 0;
    let queued = 0;   // GPU ms submitted and not yet done
    const log: string[] = [];
    const cost = (f: GroundFrameInputs): number => FIXED + Object.entries(kindsIn(f)).reduce((s, [k, n]) => s + n * (UNIT[k] ?? 0), 0);
    const r = await ablateKinds({
      inputs: FRAME,
      render: (f) => { queued += cost(f); },
      drain: async () => { clock += queued; queued = 0; log.push("drain"); },   // the GPU's work lands when the queue is drained
      now: () => clock,
    }, { rounds: 5, targetMs: 25 });
    const base = cost(withoutKind(FRAME, null));   // 0.3 + 6·0.05 + 2·0.2 + 0.4 = 1.4
    expect(r.frames).toBe(Math.round(25 / base));
    expect(r.rounds).toBe(5);
    expect(r.base.median).toBeCloseTo(base, 9);
    expect(r.control.median).toBeCloseTo(base, 9);
    expect(r.aa).toBeCloseTo(0, 9);
    expect(r.noise).toBeCloseTo(0, 9);
    expect(Object.keys(r.kinds)).toEqual(["paper", "minimat", "photo"]);
    expect(r.kinds.paper?.ms).toBeCloseTo(6 * 0.05, 9);
    expect(r.kinds.paper?.objects).toBe(6);
    expect(r.kinds.minimat?.ms).toBeCloseTo(2 * 0.2 + 2 * 0.05, 9);   // a mini mat's cost includes its inside's notes
    expect(r.kinds.photo?.ms).toBeCloseTo(0.4, 9);
    expect(r.kinds.photo?.share).toBeCloseTo(0.4 / base, 9);
    expect(r.kinds.photo?.clears).toBe(true);
    // the probe and the batch at its guess, then rounds × variants batches: each drained before its clock starts and after it stops
    expect(log.length).toBe(2 + 2 + 2 * 5 * (2 + 3));
    // every batch kept, by variant in round order (K-H: the rigs judge the A/A on the paired rounds, never on two medians)
    expect(Object.keys(r.samples)).toEqual(["base", "control", "paper", "minimat", "photo"]);
    for (const v of Object.values(r.samples)) expect(v).toHaveLength(5);
    for (const x of r.samples.control ?? []) expect(x).toBeCloseTo(base, 9);
    for (const x of r.samples.photo ?? []) expect(x).toBeCloseTo(base - 0.4, 9);
  });

  it("a position bias is rotated out and shows as the noise floor: a kind that costs nothing reads 0 and does not clear it", async () => {
    // every round's SECOND batch runs δ slow (a thermal step); paper costs NOTHING here. The rotation puts each variant second
    // in two of six rounds: |control − base| is δ in four rounds → noise δ; the medians agree → A/A 0; base − without-paper
    // is +δ, −δ, 0 in turn → cost 0, below the floor
    const d = 0.1;
    let clock = 0;
    let queued = 0;
    let drains = 0;
    const r = await ablateKinds({
      inputs: { view: {}, theme: {}, objects: [o("paper", "a")] } as unknown as GroundFrameInputs,
      render: () => { queued += 1; },
      drain: async () => {
        drains += 1;
        const batch = (drains - 6) / 2;   // drains 1–4 are the probe's and the calibration's; batch j ends at drain 6 + 2j
        clock += queued * (Number.isInteger(batch) && batch >= 0 && batch % 3 === 1 ? 1 + d : 1);
        queued = 0;
      },
      now: () => clock,
    }, { rounds: 6, targetMs: 10 });
    expect(r.noise).toBeCloseTo(d, 9);
    expect(r.aa).toBeCloseTo(0, 9);
    expect(r.kinds.paper?.ms).toBeCloseTo(0, 9);
    expect(r.kinds.paper?.clears).toBe(false);
  });
});
