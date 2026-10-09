// THE ENCODER A KIND IS HANDED, KEPT USABLE (M24 LT3, design-019 §8 — the kind boundary in the render half, ground.ts
// `RenderBoundary`). WebGPU LOCKS a command encoder while a pass it began is open, and refuses a pass or an encoder that ends
// with a debug group still pushed: either way the frame's command buffer is invalid and the submit drops it — every kind's
// drawing with it (Chrome's words: "Recording in [CommandEncoder] which is locked while [RenderPassEncoder] is open";
// "PushDebugGroup called 1 time(s) without a corresponding PopDebugGroup"). A kind that throws between its own pass's begin and
// end, or inside a debug group of its own, leaves exactly that. So the frame's encoder is WATCHED — own properties over its
// `beginRenderPass`, `beginComputePass` and debug groups, and over each pass's `end` and debug groups (the pass instrument's
// idiom) — and after a kind's throw the ground UNWINDS to the mark it took before asking: the pass the kind left open has its
// debug groups popped and is ended; the pass a run was drawn in (the slot's) has its debug groups popped back; the encoder's are
// popped back. What the kind recorded stays recorded (a layer of its own half drawn: its objects are not drawn this frame).
// Unwatched: an occlusion query the kind left open in its own pass (no desk kind uses one; the ground's passes carry no query set).

type Pass = GPURenderPassEncoder | GPUComputePassEncoder;

/** Where an encoder stood: its debug depth, the pass open on it and that pass's debug depth. */
export interface GuardMark {
  readonly depth: number;
  readonly open: Pass | null;
  readonly passDepth: number;
}

export interface EncoderGuard {
  /** Where the encoder stands now. */
  mark(): GuardMark;
  /** Close what was opened since `mark`: a pass begun since — its debug groups popped, then ended — and the debug groups pushed since, popped. */
  unwind(mark: GuardMark): void;
}

const guards = new WeakMap<GPUCommandEncoder, EncoderGuard>();

/** The guard over `encoder`: made on the first ask — its methods watched from then on — and the same one after. */
export function guardEncoder(encoder: GPUCommandEncoder): EncoderGuard {
  const had = guards.get(encoder);
  if (had !== undefined) return had;
  let depth = 0;
  let open: Pass | null = null;
  let passDepth = 0;
  const watch = (pass: Pass): Pass => {
    const { end, pushDebugGroup, popDebugGroup } = pass;
    pass.end = () => { if (open === pass) open = null; return end.call(pass); };
    pass.pushDebugGroup = (label) => { if (open === pass) passDepth += 1; return pushDebugGroup.call(pass, label); };
    pass.popDebugGroup = () => { if (open === pass && passDepth > 0) passDepth -= 1; return popDebugGroup.call(pass); };
    open = pass;
    passDepth = 0;
    return pass;
  };
  const { beginRenderPass, beginComputePass, pushDebugGroup, popDebugGroup } = encoder;
  encoder.beginRenderPass = (d) => watch(beginRenderPass.call(encoder, d)) as GPURenderPassEncoder;
  if (typeof beginComputePass === "function") encoder.beginComputePass = (d) => watch(beginComputePass.call(encoder, d)) as GPUComputePassEncoder;
  if (typeof pushDebugGroup === "function") encoder.pushDebugGroup = (label) => { depth += 1; return pushDebugGroup.call(encoder, label); };
  if (typeof popDebugGroup === "function") encoder.popDebugGroup = () => { if (depth > 0) depth -= 1; return popDebugGroup.call(encoder); };
  const guard: EncoderGuard = {
    mark: () => ({ depth, open, passDepth }),
    unwind(m) {
      const left = open;
      if (left !== null && left !== m.open) {
        for (let n = passDepth; n > 0; n--) left.popDebugGroup();
        left.end();
      } else if (left !== null) {
        for (let n = passDepth - m.passDepth; n > 0; n--) left.popDebugGroup();
      }
      // (the encoder's own groups only with no pass open on it — an encoder takes no command while one is)
      if (open === null) for (let n = depth - m.depth; n > 0; n--) encoder.popDebugGroup();
    },
  };
  guards.set(encoder, guard);
  return guard;
}
