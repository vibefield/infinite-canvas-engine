// The swap chain — the one place the engine touches a canvas (design-015 §3 `desk-dom-free`:
// `desk/src/host/*` is where the DOM may be named; nothing else under src/ may). Moved here
// from engine/device.ts at D2a-world: `acquire()` stayed host-agnostic (a `GPU` is handed in —
// `navigator.gpu` in a browser, Dawn's in Node), and the Node oracle never needed a surface at
// all, it draws into a readable Target. A host makes one of these and hands it to
// `Ground.create` (ground.ts); `test/dom-free.test.ts` keeps the rest of src/ DOM-free.

import type { Surface } from "../engine/device";

export type { Surface } from "../engine/device";

export function surface(device: GPUDevice, canvas: HTMLCanvasElement, opts: { alphaMode?: GPUCanvasAlphaMode } = {}): Surface {
  const context = canvas.getContext("webgpu");
  if (!context) throw new Error("canvas.getContext('webgpu') returned null");
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: opts.alphaMode ?? "opaque" });
  let last = { w: 0, h: 0 };
  return {
    context, format,
    fit(maxDpr = 2) {
      const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
      const cssWidth = Math.max(1, canvas.clientWidth);
      const cssHeight = Math.max(1, canvas.clientHeight);
      const width = Math.max(1, Math.round(cssWidth * dpr));
      const height = Math.max(1, Math.round(cssHeight * dpr));
      const changed = width !== last.w || height !== last.h;
      if (changed) { canvas.width = width; canvas.height = height; last = { w: width, h: height }; }
      return { changed, width, height, cssWidth, cssHeight, dpr };
    },
    view() { return context.getCurrentTexture().createView(); },
    size() { return { w: Math.max(1, canvas.width), h: Math.max(1, canvas.height) }; },
  };
}
