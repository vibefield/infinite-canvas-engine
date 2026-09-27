// @vitest-environment node
// THE SUBMIT INSTRUMENT, ARMED ON DEMAND (design-016 §4.2, K2 — D-K2.1). Until K2 the layer installed it at boot on every
// desk (layer.ts:488, though its header said "dev-only by intent"), and its `detach()` left a bound copy of each native
// behind as an own property. Now: unarmed, the queue carries NO wrapper (its methods are the prototype's); the layer
// installs it the first time `submits()` is asked; `detach()` puts back exactly what was there; submits are shared
// through ONE tap per queue, so listeners leave in any order; and `copyExternalImageToTexture` (a print's picture, the
// calendar's tiles) is counted as an upload — its texels in the destination's format.
import { createCanvasEngine } from "@ice/core";
import { describe, expect, it, vi } from "vitest";
import { deskLayer, instrumentSubmits, tapSubmits } from "@ice/desk";
import { deskPalette, deskTheme } from "../src/palette";
import { fakePage } from "../../desk/test/fake-page";

/** A queue shaped like the browser's: its methods live on the PROTOTYPE, so an own property is a wrapper. */
class FakeQueue {
  readonly submitted: unknown[][] = [];
  readonly calls: string[] = [];
  submit(list: Iterable<unknown>): undefined { this.submitted.push([...list]); return undefined; }
  writeBuffer(): undefined { this.calls.push("writeBuffer"); return undefined; }
  writeTexture(): undefined { this.calls.push("writeTexture"); return undefined; }
  copyExternalImageToTexture(_s: unknown, d: { texture: { label: string } }, size: unknown): undefined { this.calls.push(`external ${d.texture.label} ${JSON.stringify(size)}`); return undefined; }
}
const METHODS = ["submit", "writeBuffer", "writeTexture", "copyExternalImageToTexture"] as const;
const wrapped = (q: object): string[] => METHODS.filter((m) => Object.hasOwn(q, m));
const cb = (n: number) => Array.from({ length: n }, () => ({}) as GPUCommandBuffer);

describe("the submit instrument, armed on demand (K2)", () => {
  it("unarmed the queue carries no wrapper; armed it counts; detached, the prototype's methods show through again", () => {
    const q = new FakeQueue();
    const device = { queue: q } as unknown as GPUDevice;
    expect(wrapped(q)).toEqual([]);
    const s = instrumentSubmits(device);
    expect(instrumentSubmits(device)).toBe(s);   // one per queue
    expect(wrapped(q)).toEqual([...METHODS]);
    const gq = q as unknown as GPUQueue;
    gq.submit(cb(2));
    gq.submit(new Set(cb(1)));   // an iterable is materialised once and handed on
    gq.writeBuffer({ label: "paper/notes" } as GPUBuffer, 0, new Float32Array(4));
    expect([s.total(), s.buffers()]).toEqual([2, 3]);
    expect(q.submitted.map((l) => l.length)).toEqual([2, 1]);
    expect(s.uploadsByLabel()).toEqual({ paper: { writes: 1, bytes: 16 } });
    s.detach();
    expect(wrapped(q)).toEqual([]);
    expect(q.submit).toBe(FakeQueue.prototype.submit);
    // a stub whose methods are OWN properties gets those same functions back
    const own = { submit: () => undefined, writeBuffer: () => undefined, writeTexture: () => undefined };
    const was = { ...own };
    instrumentSubmits({ queue: own } as unknown as GPUDevice).detach();
    expect(own).toEqual(was);
  });

  it("copyExternalImageToTexture is an upload: its texels in the destination's format, under the texture's label", () => {
    const q = new FakeQueue();
    const s = instrumentSubmits({ queue: q } as unknown as GPUDevice);
    const gq = q as unknown as GPUQueue;
    const picture = { label: "photo/picture 3", format: "rgba8unorm" } as GPUTexture;
    const tiles = { label: "calendar/tiles", format: "r8unorm" } as GPUTexture;
    gq.copyExternalImageToTexture({ source: {} as ImageBitmap }, { texture: picture }, [640, 480]);
    gq.copyExternalImageToTexture({ source: {} as ImageBitmap }, { texture: tiles }, { width: 260, height: 260 });
    expect(q.calls).toEqual(['external photo/picture 3 [640,480]', 'external calendar/tiles {"width":260,"height":260}']);   // the native, with the same arguments
    expect(s.externals()).toEqual({ writes: 2, bytes: 640 * 480 * 4 + 260 * 260 });
    expect(s.uploads()).toEqual({ writes: 2, bytes: 640 * 480 * 4 + 260 * 260 });
    expect(s.uploadsByLabel()).toEqual({ photo: { writes: 1, bytes: 640 * 480 * 4 }, calendar: { writes: 1, bytes: 260 * 260 } });
    s.detach();
  });

  it("the submit tap is ONE wrapper shared by every listener: either may leave first, and the last out restores the native", () => {
    for (const first of ["instrument", "hook"] as const) {
      const q = new FakeQueue();
      const gq = q as unknown as GPUQueue;
      const s = instrumentSubmits({ queue: q } as unknown as GPUDevice);
      const seen: number[] = [];
      const off = tapSubmits(gq, { before: (l) => seen.push(-l.length), after: (l) => seen.push(l.length) });
      gq.submit(cb(3));
      expect([s.total(), seen]).toEqual([1, [-3, 3]]);
      if (first === "instrument") s.detach(); else off();
      expect(wrapped(q)).toContain("submit");   // the other still listens
      gq.submit(cb(1));
      if (first === "instrument") { expect(s.total()).toBe(1); off(); } else { expect(s.total()).toBe(2); s.detach(); }
      expect(wrapped(q)).toEqual([]);
      expect(q.submitted.map((l) => l.length)).toEqual([3, 1]);
    }
  });

  it("the layer installs it the first time submits() is asked — never at boot — and takes it off the engine's device at dispose", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const q = new FakeQueue();
    const device = { label: "", features: new Set<string>(), lost: new Promise<never>(() => {}), queue: q, addEventListener: () => {}, destroy: () => {} };
    const adapter = { features: new Set<string>(), info: { vendor: "fake", architecture: "", description: "" } };
    const ce = createCanvasEngine({});
    const page = fakePage();
    const { stack } = ce;
    const handle = deskLayer({ theme: deskTheme("light"), palette: deskPalette("light") })({
      host: { container: page.container } as never, world: ce.world,
      framePick: stack.framePick, navGeometry: stack.navGeometry, heldPose: stack.heldPose,
      transitions: ce.transitions, catalog: ce.catalog, readMarquee: () => stack.marqueeBuffer, spatial: stack.index,
      gpu: { adapter: adapter as unknown as GPUAdapter, device: device as unknown as GPUDevice },
    });
    for (let i = 0; i < 20; i++) await Promise.resolve();   // the boot's microtasks: the device, the swap chain's refusal
    expect(handle.device()).toBe(device);
    expect(wrapped(q)).toEqual([]);   // booted, never asked: no wrapper
    const s = handle.submits();
    expect(s).toBeDefined();
    expect(handle.submits()).toBe(s);
    expect(wrapped(q)).toEqual([...METHODS]);
    (q as unknown as GPUQueue).submit(cb(1));
    expect(s?.total()).toBe(1);
    handle.dispose();
    expect(wrapped(q)).toEqual([]);   // the app's device outlives the layer, without the layer's wrappers
    ce.dispose();
    vi.restoreAllMocks();
  });
});
