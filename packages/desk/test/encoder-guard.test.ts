// @vitest-environment node
// M24 LT3 (design-019 §8): THE ENCODER A KIND IS HANDED, KEPT USABLE (encoder-guard.ts). A kind that throws mid-pass leaves the frame's
// encoder LOCKED (a pass open) or a debug group pushed — WebGPU refuses the whole frame's command buffer for either — so the ground marks
// the encoder before it asks a kind and, after a throw, unwinds to the mark: what the kind opened is closed, what was open before kept.
import { describe, expect, it } from "vitest";
import { guardEncoder } from "../src/encoder-guard";
import { fakeDevice } from "./fake-gpu";

/** An encoder of stubs logging what it is told — passes of both sorts, debug groups on it and on them — with WebGPU's two refusals. */
function loggingEncoder(log: string[]): GPUCommandEncoder {
  let open: string | null = null;
  let depth = 0;
  const pass = (label: string) => {
    let groups = 0;
    open = label;
    return {
      pushDebugGroup: (l: string) => { groups += 1; log.push(`${label} push ${l}`); },
      popDebugGroup: () => { groups -= 1; log.push(`${label} pop`); },
      end: () => { if (groups !== 0) log.push(`invalid: ${label} ended with ${groups} group(s)`); log.push(`${label} end`); open = null; },
    };
  };
  return {
    beginRenderPass: (d: GPURenderPassDescriptor) => { if (open !== null) log.push(`invalid: locked by ${open}`); return pass(d.label ?? "render"); },
    beginComputePass: (d?: GPUComputePassDescriptor) => { if (open !== null) log.push(`invalid: locked by ${open}`); return pass(d?.label ?? "compute"); },
    pushDebugGroup: (l: string) => { depth += 1; log.push(`encoder push ${l}`); },
    popDebugGroup: () => { depth -= 1; log.push("encoder pop"); },
    finish: () => { if (open !== null || depth !== 0) log.push(`invalid: finished with ${open ?? "no pass"} open, ${depth} group(s)`); return {}; },
  } as unknown as GPUCommandEncoder;
}

const desc = (label: string): GPURenderPassDescriptor => ({ label, colorAttachments: [] });

describe("the encoder guard (M24 LT3 — the kind boundary in the render half)", () => {
  it("one guard an encoder: asked again, the same — its methods watched once", () => {
    const enc = loggingEncoder([]);
    const g = guardEncoder(enc);
    const begin = enc.beginRenderPass;
    expect(guardEncoder(enc)).toBe(g);
    expect(enc.beginRenderPass).toBe(begin);
  });

  it("nothing opened since the mark, or a pass begun and ended since: the unwind does nothing", () => {
    const log: string[] = [];
    const enc = loggingEncoder(log);
    const g = guardEncoder(enc);
    const m = g.mark();
    g.unwind(m);
    const p = enc.beginRenderPass(desc("kind/layer"));
    p.pushDebugGroup("a");
    p.popDebugGroup();
    p.end();
    log.length = 0;
    g.unwind(m);
    expect(log).toEqual([]);
  });

  it("a COMPUTE pass the kind left open with two debug groups: both popped, then the pass ended — the encoder takes the frame's pass again, its finish valid", () => {
    const log: string[] = [];
    const enc = loggingEncoder(log);
    const g = guardEncoder(enc);
    const m = g.mark();
    const p = enc.beginComputePass({ label: "kind/sim" });
    p.pushDebugGroup("x");
    p.pushDebugGroup("y");
    g.unwind(m);
    expect(log.slice(-3)).toEqual(["kind/sim pop", "kind/sim pop", "kind/sim end"]);
    enc.beginRenderPass(desc("ground")).end();
    enc.finish();
    expect(log.filter((l) => l.startsWith("invalid"))).toEqual([]);
  });

  it("the ENCODER's debug groups: those pushed before the mark kept, those since popped — after the kind's pass is ended", () => {
    const log: string[] = [];
    const enc = loggingEncoder(log);
    const g = guardEncoder(enc);
    enc.pushDebugGroup("frame");
    const m = g.mark();
    enc.pushDebugGroup("kind");
    enc.pushDebugGroup("kind/uploads");
    enc.beginRenderPass(desc("kind/layer"));
    log.length = 0;
    g.unwind(m);
    expect(log).toEqual(["kind/layer end", "encoder pop", "encoder pop"]);
    enc.popDebugGroup();   // the frame's own, still there
    enc.finish();
    expect(log.filter((l) => l.startsWith("invalid"))).toEqual([]);
  });

  it("a RUN's debug groups in the slot's pass (open before the mark): popped back to the mark, the pass left open for the next run", () => {
    const log: string[] = [];
    const enc = loggingEncoder(log);
    const g = guardEncoder(enc);
    const pass = enc.beginRenderPass(desc("ground"));
    pass.pushDebugGroup("tray");   // the desk's own, around the specimens
    const m = g.mark();
    pass.pushDebugGroup("kind/run");
    pass.pushDebugGroup("kind/run/inner");
    log.length = 0;
    g.unwind(m);
    expect(log).toEqual(["ground pop", "ground pop"]);
    pass.popDebugGroup();
    pass.end();
    enc.finish();
    expect(log.filter((l) => l.startsWith("invalid"))).toEqual([]);
  });

  it("on the fake device the desk's units draw with: unguarded, a pass left open locks the encoder (the refusal the guard prevents)", () => {
    const log: string[] = [];
    const enc = fakeDevice(log).device.createCommandEncoder();
    enc.beginRenderPass(desc("kind/layer"));
    enc.beginRenderPass(desc("ground")).end();
    enc.finish();
    expect(log.filter((l) => l.startsWith("invalid"))).toEqual([
      'invalid: Recording in [CommandEncoder] which is locked while [RenderPassEncoder "kind/layer"] is open',
      'invalid: Command buffer recording ended before [RenderPassEncoder "kind/layer"] was ended',
    ]);
  });
});
