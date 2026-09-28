// A GPU in miniature for the profiler's tests (K2): encoders that record, a queue that RUNS what it is handed — timestamps on a
// clock, resolves and copies with WebGPU's rules (a resolve's destination offset a multiple of 256; no copy into a mapped
// buffer) — and buffers that map a task later. Enough to read timestamps back without a GPU.

/**
 * A GPU in miniature, enough to read timestamps back: an encoder records what it is told; `submit` RUNS each command buffer —
 * a timed pass stamps its begin and end on a clock (a pass overlaps the next by `overlap` ns, as a tiler's do), a resolve
 * copies stamps into a buffer, a copy copies bytes — and a mapped buffer hands its bytes back a task later.
 */
export function simGpu({ timestamps = true, pass = 400_000n, overlap = 150_000n } = {}) {
  let clock = 5_000_000_000n;
  const submits: { label: string; cmds: string[] }[] = [];
  const maps: string[] = [];
  class Buf {
    readonly bytes: Uint8Array;
    mapped = false;
    destroyed = false;
    constructor(readonly label: string, readonly size: number) { this.bytes = new Uint8Array(size); }
    mapAsync(): Promise<void> { maps.push(`${this.label} after ${submits.length} submits`); return new Promise((r) => setTimeout(() => { this.mapped = true; r(); }, 0)); }
    getMappedRange(o = 0, s = this.size): ArrayBuffer { return this.bytes.slice(o, o + s).buffer; }
    unmap(): void { this.mapped = false; }
    destroy(): void { this.destroyed = true; }
  }
  class QuerySet { readonly stamps: BigUint64Array; destroyed = false; constructor(n: number) { this.stamps = new BigUint64Array(n); } destroy(): void { this.destroyed = true; } }
  type Cmd = { t: "pass"; label: string; tw?: GPURenderPassTimestampWrites } | { t: "resolve"; qs: QuerySet; first: number; count: number; dst: Buf; off: number } | { t: "copy"; src: Buf; so: number; dst: Buf; doff: number; size: number };
  class Pass {
    constructor(readonly calls: string[]) {}
    setPipeline(p: { label: string }): void { this.calls.push(`pipeline ${p.label}`); }
    setBindGroup(): void { this.calls.push("group"); }
    draw(v: number, n = 1): void { this.calls.push(`draw ${v}×${n}`); }
    drawIndexed(i: number, n = 1): void { this.calls.push(`drawIndexed ${i}×${n}`); }
    end(): void {}
  }
  class Encoder {
    readonly cmds: Cmd[] = [];
    readonly calls: string[] = [];
    constructor(readonly label: string) {}
    beginRenderPass(d: GPURenderPassDescriptor): Pass { this.cmds.push({ t: "pass", label: d.label ?? "", ...(d.timestampWrites !== undefined ? { tw: d.timestampWrites } : {}) }); return new Pass(this.calls); }
    resolveQuerySet(qs: QuerySet, first: number, count: number, dst: Buf, off: number): void { this.cmds.push({ t: "resolve", qs, first, count, dst, off }); }
    copyBufferToBuffer(src: Buf, so: number, dst: Buf, doff: number, size: number): void { this.cmds.push({ t: "copy", src, so, dst, doff, size }); }
    finish(): { label: string; cmds: Cmd[] } { return { label: this.label, cmds: this.cmds }; }
  }
  class Queue {
    submit(list: Iterable<{ label: string; cmds: Cmd[] }>): undefined {
      for (const cb of list) {
        submits.push({ label: cb.label, cmds: cb.cmds.map((c) => (c.t === "pass" ? `pass ${c.label}${c.tw ? " timed" : ""}` : c.t)) });
        for (const c of cb.cmds) {
          if (c.t === "pass" && c.tw) {
            const qs = c.tw.querySet as unknown as QuerySet;
            qs.stamps[c.tw.beginningOfPassWriteIndex as number] = clock;
            qs.stamps[c.tw.endOfPassWriteIndex as number] = clock + pass;
            clock += pass - overlap;
          } else if (c.t === "resolve") {
            if (c.off % 256 !== 0) throw new Error("resolveQuerySet: destinationOffset must be a multiple of 256");
            new BigUint64Array(c.dst.bytes.buffer, c.off, c.count).set(c.qs.stamps.subarray(c.first, c.first + c.count));
          } else if (c.t === "copy") {
            if (c.dst.mapped) throw new Error("copy into a mapped buffer");
            c.dst.bytes.set(c.src.bytes.subarray(c.so, c.so + c.size), c.doff);
          }
        }
      }
      return undefined;
    }
    writeBuffer(): undefined { return undefined; }
  }
  const made: string[] = [];
  const device = {
    features: new Set(timestamps ? ["timestamp-query"] : []),
    queue: new Queue(),
    createQuerySet: (d: GPUQuerySetDescriptor) => { made.push(`queryset ${d.label} ×${d.count}`); return new QuerySet(d.count); },
    createBuffer: (d: GPUBufferDescriptor) => { made.push(`buffer ${d.label}`); return new Buf(d.label ?? "", d.size); },
    createCommandEncoder: (d?: GPUCommandEncoderDescriptor) => new Encoder(d?.label ?? ""),
  };
  return { device: device as unknown as GPUDevice, raw: device, submits, maps, made };
}

/** One frame as the ground records it: its own encoders (label → passes), each submitted, the frame's own encoder last. */
export function frame(device: GPUDevice, encoders: readonly [string, readonly string[]][]): void {
  for (const [label, passes] of encoders) {
    const enc = device.createCommandEncoder({ label });
    for (const p of passes) {
      const pass = enc.beginRenderPass({ ...(p !== "" ? { label: p } : {}), colorAttachments: [] });
      pass.setPipeline({ label: `${p.split("/")[0]}/pipe` } as GPURenderPipeline);
      pass.draw(6, 3);
      pass.end();
    }
    device.queue.submit([enc.finish()]);
  }
}
/**
 * Let the simulated GPU's readbacks land (K-H): twenty turns of the event loop, never a wall-clock sleep. A readback is a chain of
 * timer hops (`mapAsync` resolves on a 0 ms timer, the profiler's ring takes it on); a 5 ms sleep raced it, and at load 259 ci went red
 * with one frame's flush uncounted (gpu-profiler: n 5, not 6) — a turn is a turn however slow the host.
 */
export const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};
