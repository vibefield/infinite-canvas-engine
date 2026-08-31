/**
 * The HiC adapter under happy-dom (no origin trial, no GPU) and against a FAKE
 * host that has the trial surface — the two shapes the boot probe has to grade
 * honestly, plus the receiver-binding law the module exists to hold.
 */
import { describe, expect, it, vi } from "vitest";
import {
  changedElements,
  copyElementToTexture,
  describeHicProbe,
  drawElementImage,
  getElementTransform,
  markAsSourceCanvas,
  onPaint,
  probeHic,
  requestPaint,
} from "../src/hic-adapter";

/**
 * A document whose canvases carry the trial surface. Built on the REAL
 * happy-dom document so layout/DOM semantics stay honest; only the trial
 * methods and `navigator.gpu`/`GPUQueue` are grafted on.
 */
function fakeHicDocument(opts: { laysOutChildren?: boolean } = {}): Document {
  const canvasProto = {
    requestPaint: () => {},
    getElementTransform: () => new DOMMatrix(),
  };
  const view = {
    HTMLCanvasElement: { prototype: canvasProto },
    GPUQueue: function GPUQueue() {} as unknown as { prototype: unknown },
    navigator: { gpu: {} },
  };
  (view.GPUQueue as unknown as { prototype: Record<string, unknown> }).prototype = {
    copyElementImageToTexture: () => {},
  };

  const realDoc = document;
  const fake = {
    get body() {
      return realDoc.body;
    },
    defaultView: view,
    createElement(tag: string) {
      if (tag !== "canvas") return realDoc.createElement(tag);
      {
        const el = realDoc.createElement("canvas");
        Object.assign(el, canvasProto);
        const origGetContext = el.getContext.bind(el);
        (el as unknown as { getContext: (id: string) => unknown }).getContext = (id: string) => {
          if (id === "2d") return { drawElementImage: () => new DOMMatrix() };
          return origGetContext(id as "2d");
        };
        if (opts.laysOutChildren === true) {
          // Stand in for the trial's layout behaviour: children of a
          // `layoutsubtree` canvas measure real boxes instead of 0×0.
          const append = el.appendChild.bind(el);
          (el as unknown as { appendChild: (n: Node) => Node }).appendChild = (node: Node) => {
            const out = append(node);
            if (node instanceof HTMLElement) {
              node.getBoundingClientRect = () =>
                ({ width: 64, height: 32, x: 0, y: 0, top: 0, left: 0, right: 64, bottom: 32 }) as DOMRect;
            }
            return out;
          };
        }
        return el;
      }
    },
  };
  return fake as unknown as Document;
}

describe("hic probe", () => {
  it("refuses honestly under a host with no origin trial (happy-dom)", () => {
    const probe = probeHic(document);
    expect(probe.supported).toBe(false);
    // Every REQUIRED capability is absent here, and each is named.
    expect(probe.missing).toEqual([
      "webgpu",
      "requestPaint",
      "drawElementImage",
      "copyElementImageToTexture",
    ]);
    expect(probe.capabilities.drawElementImage).toBe(false);
    expect(describeHicProbe(probe)).toContain("drawElementImage");
  });

  it("does not throw when the document has no body to probe layout against", () => {
    const doc = { body: null, defaultView: undefined, createElement: () => document.createElement("canvas") };
    expect(() => probeHic(doc as unknown as Document)).not.toThrow();
    expect(probeHic(doc as unknown as Document).capabilities.layoutSubtree).toBe(false);
  });

  it("passes on a host carrying the trial surface", () => {
    const probe = probeHic(fakeHicDocument());
    expect(probe.supported).toBe(true);
    expect(probe.missing).toEqual([]);
    expect(describeHicProbe(probe)).toBe("HTML-in-Canvas available");
  });

  it("reports layoutSubtree from LAYOUT, not from an attribute sniff", () => {
    // Same trial methods either way; only the layout behaviour differs — an
    // attribute check would report true for both, since every browser accepts
    // an unknown attribute.
    expect(probeHic(fakeHicDocument({ laysOutChildren: false })).capabilities.layoutSubtree).toBe(false);
    expect(probeHic(fakeHicDocument({ laysOutChildren: true })).capabilities.layoutSubtree).toBe(true);
  });

  it("does not require layoutSubtree or getElementTransform to declare support", () => {
    // Both are reported-but-not-required (design-012 §8 gotcha 6): a false
    // reading must not refuse a host whose three trial METHODS are live.
    const probe = probeHic(fakeHicDocument({ laysOutChildren: false }));
    expect(probe.capabilities.layoutSubtree).toBe(false);
    expect(probe.supported).toBe(true);
  });

  it("leaves no probe element behind in the document", () => {
    const before = document.querySelectorAll("canvas").length;
    probeHic(document);
    expect(document.querySelectorAll("canvas")).toHaveLength(before);
  });
});

describe("receiver binding (the Illegal-invocation law)", () => {
  it("calls copyElementImageToTexture THROUGH the queue", () => {
    let receiver: unknown = null;
    const queue = {
      copyElementImageToTexture(this: unknown, ...args: unknown[]) {
        receiver = this;
        return args;
      },
    };
    const el = document.createElement("div");
    const texture = { label: "atlas" } as unknown as GPUTexture;
    const ok = copyElementToTexture(queue as unknown as GPUQueue, el, texture);
    expect(ok).toBe(true);
    // A hoisted `const f = queue.copyElementImageToTexture; f(...)` would land
    // here with `this === undefined` — which is exactly the native
    // "Illegal invocation" this module exists to prevent.
    expect(receiver).toBe(queue);
  });

  /**
   * THE SHAPE, pinned to measurement rather than to memory.
   *
   * This assertion previously encoded the WebGPU `copyExternalImageToTexture`
   * shape — `({source}, {texture, origin}, {width,height,depthOrArrayLayers})`
   * — and passed, because it was written from the same wrong reading as the
   * implementation it checked. Chromium rejects that arity-3 form outright
   * ("Failed to read the 'destination' property from
   * 'GPUCopyElementImageDestination': Required member is undefined"), so the
   * green test was pinning a call that could never work. Nothing had exercised
   * it: S1 shipped no WGSL and no dom source existed.
   *
   * The shape below is what `scripts/hic-copy-gate.mjs` recovered against the
   * real Chromium 150, agreeing with the Chromium 152 evidence in hic-bench
   * FINDINGS §4. `origin` sits INSIDE `destination`: at the outer level WebIDL
   * accepts and then ignores it, which would silently write every atlas slot
   * at (0,0).
   */
  it("passes the destination origin through for atlas-slot sub-rect copies", () => {
    const calls: unknown[][] = [];
    const queue = {
      copyElementImageToTexture(...args: unknown[]) {
        calls.push(args);
      },
    };
    const texture = {} as unknown as GPUTexture;
    copyElementToTexture(queue as unknown as GPUQueue, document.createElement("div"), texture, {
      x: 256,
      y: 512,
    });
    expect(calls[0]).toHaveLength(2); // arity 2 — there is no third size argument
    expect(calls[0]?.[1]).toEqual({ destination: { texture, origin: { x: 256, y: 512, z: 0 } } });
  });

  it("calls requestPaint and getElementTransform through their canvas", () => {
    const canvas = document.createElement("canvas");
    let paintReceiver: unknown = null;
    let transformReceiver: unknown = null;
    Object.assign(canvas, {
      requestPaint(this: unknown) {
        paintReceiver = this;
      },
      getElementTransform(this: unknown) {
        transformReceiver = this;
        return new DOMMatrix();
      },
    });
    expect(requestPaint(canvas)).toBe(true);
    expect(paintReceiver).toBe(canvas);
    expect(getElementTransform(canvas, document.createElement("div"))).toBeInstanceOf(DOMMatrix);
    expect(transformReceiver).toBe(canvas);
  });

  it("degrades instead of throwing when the host lacks the trial methods", () => {
    const canvas = document.createElement("canvas");
    expect(requestPaint(canvas)).toBe(false);
    expect(getElementTransform(canvas, document.createElement("div"))).toBeUndefined();
    expect(
      copyElementToTexture({} as GPUQueue, canvas, {} as GPUTexture),
    ).toBe(false);
    expect(drawElementImage({} as CanvasRenderingContext2D, canvas, 0, 0)).toBeUndefined();
  });
});

describe("paint events", () => {
  it("subscribes with addEventListener so a second consumer is never clobbered", () => {
    const canvas = document.createElement("canvas");
    const a = vi.fn();
    const b = vi.fn();
    const offA = onPaint(canvas, a);
    onPaint(canvas, b);
    canvas.dispatchEvent(new Event("paint"));
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    canvas.dispatchEvent(new Event("paint"));
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it("reads changedElements tolerantly (absent ⇒ empty, never a throw)", () => {
    expect(changedElements(new Event("paint"))).toEqual([]);
    const el = document.createElement("div");
    const event = Object.assign(new Event("paint"), { changedElements: [el] });
    expect(changedElements(event)).toEqual([el]);
    const hostile = Object.assign(new Event("paint"), { changedElements: 7 });
    expect(changedElements(hostile)).toEqual([]);
  });

  it("marks the L1 source canvas with the attribute spelled in exactly one place", () => {
    const canvas = document.createElement("canvas");
    markAsSourceCanvas(canvas);
    expect(canvas.hasAttribute("layoutsubtree")).toBe(true);
  });
});
