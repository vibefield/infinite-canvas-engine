// PER-KIND GPU COST BY ABLATION (design-016 §4.4, K2). Every kind draws inside the ONE `ground` pass (ground.ts `drawFrame`),
// so timestamps cannot split them: what a kind costs is measured as what the frame loses without it. The method is
// `holdCost`'s (apps/desk api.ts) and rig:cost's, made per kind:
//
//   SATURATED   a batch of the same frame drawn back to back into the canvas's texture, ~25 ms of GPU (a 4-frame probe sizes
//               it — guessed wrong once, a 370 ms command stream throttled the GPU and poisoned every later round);
//   DRAINED     `onSubmittedWorkDone` covers ALL prior work, so the queue is drained BEFORE the clock starts and again to
//               stop it — and one frame of the variant is drawn and drained first (a kind's records re-uploaded when it
//               comes back are the warm-up's, not the batch's);
//   VARIANTS    the frame as it is (base), the frame with kind k's objects left out (for each kind in it), and an A/A
//               CONTROL — the base again, a variant of its own — round-robined within each round (the order rotates, so
//               clock drift and position are shared);
//   READ        per kind, the MEDIAN over rounds of the paired difference base − without-k (pairs share a round's drift);
//               the A/A offset (median control − median base) and the NOISE FLOOR (the median |control − base| of a round)
//               beside it: a kind's cost below the floor is not a measurement.
//
// For rigs and a person at the console — never per frame, and at rest (a desk drawing its own frames meanwhile shares the
// GPU with the batches). The held object is left out of every variant: this is the rest frame's cost.

import type { GroundFrameInputs, SlotInputs, SlotObject } from "./ground";

export interface KindCostOptions {
  /** Rounds (7). */
  readonly rounds?: number;
  /** The batch's target GPU time, ms (25). */
  readonly targetMs?: number;
  /** The probe's frames (4). */
  readonly probeFrames?: number;
  /** The batch's bounds (3 … 300 frames). */
  readonly minFrames?: number;
  readonly maxFrames?: number;
  /** The kinds to leave out (default: every kind with an object in the frame). */
  readonly kinds?: readonly string[];
}

export interface Sampled { readonly median: number; readonly min: number }

export interface KindCost {
  /** ms per frame the frame loses without the kind: the median of the paired base − without-k over rounds. */
  readonly ms: number;
  /** …as a share of the base frame. */
  readonly share: number;
  /** The frame without the kind, ms per frame. */
  readonly without: Sampled;
  /** The kind's objects in the frame (every slot's). */
  readonly objects: number;
  /** The cost clears the noise floor. */
  readonly clears: boolean;
}

export interface KindCostReport {
  /** Frames a batch, rounds, and every round's batches in the order drawn. */
  readonly frames: number;
  readonly rounds: number;
  /** The frame as it is, ms per frame. */
  readonly base: Sampled;
  /** The A/A control: the same frame as a variant of its own. */
  readonly control: Sampled;
  /** median(control) − median(base): the A/A offset. */
  readonly aa: number;
  /** The noise floor: the median over rounds of |control − base| within a round. */
  readonly noise: number;
  readonly kinds: Readonly<Record<string, KindCost>>;
}

export interface Ablation {
  /** The frame to measure (the last one drawn). */
  readonly inputs: GroundFrameInputs;
  /** Draw one frame of these inputs, synchronously (`Ground.render`). */
  render(inputs: GroundFrameInputs): void;
  /** Resolve once the GPU finished everything submitted (`queue.onSubmittedWorkDone`). */
  drain(): Promise<unknown>;
  now(): number;
}

const median = (v: readonly number[]): number => {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length === 0 ? 0 : s.length % 2 === 1 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};
const sampled = (v: readonly number[]): Sampled => ({ median: median(v), min: Math.min(...v) });

/** Every kind with an object in the frame, and how many — the root's, the insides', the departed desk's. */
export function kindsIn(inputs: GroundFrameInputs): Record<string, number> {
  const out: Record<string, number> = {};
  const walk = (s: SlotInputs): void => {
    for (const o of s.objects ?? []) out[o.kind] = (out[o.kind] ?? 0) + 1;
    for (const p of s.portals ?? []) walk(p);
  };
  walk(inputs);
  if (inputs.outgoing !== undefined) walk(inputs.outgoing);
  return out;
}

/** A slot without `kind`'s objects: the rest keep their paint order, the insides their object (re-indexed); an inside whose object left goes with it. */
function slotWithout<S extends SlotInputs>(s: S, kind: string): { slot: S; index: Map<number, number> } {
  const index = new Map<number, number>();
  const objects: SlotObject[] = [];
  (s.objects ?? []).forEach((o, i) => { if (o.kind !== kind) { index.set(i, objects.length); objects.push(o); } });
  const portals = (s.portals ?? []).flatMap((p) => {
    const at = index.get(p.at);
    return at === undefined ? [] : [{ ...slotWithout(p, kind).slot, at }];
  });
  return { slot: { ...s, ...(s.objects !== undefined ? { objects } : {}), ...(s.portals !== undefined ? { portals } : {}) }, index };
}

/** The frame with `kind`'s objects left out of every slot (its insides with them); `null` kind: the frame as it is. The held object is always left out (the rest frame). */
export function withoutKind(inputs: GroundFrameInputs, kind: string | null): GroundFrameInputs {
  const { held: _held, ...rest } = inputs;
  if (kind === null) return rest;
  const root = slotWithout(rest, kind).slot;
  const o = rest.outgoing;
  if (o === undefined) return root;
  const out = slotWithout(o, kind);
  const at = o.at === undefined ? undefined : out.index.get(o.at);
  const { at: _at, ...moved } = out.slot;
  return { ...root, outgoing: at === undefined ? moved : { ...moved, at } };
}

/** Measure what each kind costs the frame (the header's method). */
export async function ablateKinds(a: Ablation, opts: KindCostOptions = {}): Promise<KindCostReport> {
  const rounds = opts.rounds ?? 7;
  const present = kindsIn(a.inputs);
  const kinds = (opts.kinds ?? Object.keys(present)).filter((k) => (present[k] ?? 0) > 0);
  const base = withoutKind(a.inputs, null);
  const variants: { name: string; inputs: GroundFrameInputs }[] = [
    { name: "base", inputs: base },
    { name: "control", inputs: base },
    ...kinds.map((k) => ({ name: k, inputs: withoutKind(a.inputs, k) })),
  ];
  const batch = async (inputs: GroundFrameInputs, n: number): Promise<number> => {
    a.render(inputs);   // the warm-up: the variant's first frame (records coming back are uploaded here)
    await a.drain();
    const t0 = a.now();
    for (let i = 0; i < n; i++) a.render(inputs);
    await a.drain();
    return (a.now() - t0) / n;
  };
  const probe = await batch(base, opts.probeFrames ?? 4);
  const frames = Math.max(opts.minFrames ?? 3, Math.min(opts.maxFrames ?? 300, Math.round((opts.targetMs ?? 25) / Math.max(probe, 0.05))));
  const ms = new Map<string, number[]>(variants.map((v) => [v.name, []]));
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < variants.length; i++) {
      const v = variants[(i + r) % variants.length] as { name: string; inputs: GroundFrameInputs };
      (ms.get(v.name) as number[]).push(await batch(v.inputs, frames));
    }
  }
  const b = ms.get("base") as number[];
  const c = ms.get("control") as number[];
  const noise = median(b.map((x, r) => Math.abs((c[r] as number) - x)));
  const baseS = sampled(b);
  const out: Record<string, KindCost> = {};
  for (const k of kinds) {
    const w = ms.get(k) as number[];
    const cost = median(b.map((x, r) => x - (w[r] as number)));
    out[k] = { ms: cost, share: baseS.median > 0 ? cost / baseS.median : 0, without: sampled(w), objects: present[k] ?? 0, clears: cost > noise };
  }
  a.render(a.inputs);   // the frame as it was
  return { frames, rounds, base: baseS, control: sampled(c), aa: median(c) - baseS.median, noise, kinds: out };
}
