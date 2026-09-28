// The desk layer's STATUS is honest about the GPU (D7, render #8): an uncaptured GPU error — an out-of-memory on a layer's
// texture leaves an invalid attachment, every submit after it dropped — takes the layer out of `ready`, and nothing puts it back
// on its own. The layer is mounted straight from its factory on a fake device, a fake canvas and a fake adapter (no DOM: the
// container, the document and the canvas are the few members the mount reads).

import { createCanvasEngine } from "@ice/core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { deskLayer } from "@ice/desk";
import { PALETTE, THEMES } from "../oracle/fixtures/vf-theme";
import { fakeDevice, installGpuFlags } from "../../desk/test/fake-gpu";

function fakeHost() {
  const listeners: ((ev: { readonly error: unknown }) => void)[] = [];
  const { device } = fakeDevice();
  let lose: (info: { readonly reason: string; readonly message: string }) => void = () => {};
  Object.assign(device, {
    addEventListener: (type: string, fn: (ev: { readonly error: unknown }) => void) => { if (type === "uncapturederror") listeners.push(fn); },
    lost: new Promise((r) => { lose = r; }),
    destroy: () => {},
  });
  const adapter = { features: new Set<string>(), requestDevice: async () => device };
  const gpu = { requestAdapter: async () => adapter, getPreferredCanvasFormat: () => "bgra8unorm" } as unknown as GPU;
  const context = { configure: () => {}, unconfigure: () => {}, getCurrentTexture: () => ({ createView: () => ({ label: "swap" }), width: 1, height: 1 }) };
  const canvas = { style: {}, width: 1, height: 1, clientWidth: 1, clientHeight: 1, getContext: () => context, remove: () => {} };
  // the desk's ONE editor is made at every mount since K8a (a textarea and its stylesheet, listeners on the container and the document)
  const node = () => ({ style: {}, setAttribute: () => {}, addEventListener: () => {}, removeEventListener: () => {}, remove: () => {} });
  const container = { ownerDocument: { createElement: (tag: string) => (tag === "canvas" ? canvas : node()), defaultView: undefined, addEventListener: () => {}, removeEventListener: () => {} }, prepend: () => {}, appendChild: () => {}, addEventListener: () => {}, removeEventListener: () => {} } as unknown as HTMLElement;
  /** An error the device reports and nobody captured — as the browser dispatches it. */
  const uncaptured = (name: string, message: string): void => { for (const fn of listeners) fn({ error: { message, constructor: { name } } }); };
  /** The device lost — its `lost` promise settles, as the browser settles it. */
  const lost = (reason: string, message: string): void => lose({ reason, message });
  return { gpu, container, uncaptured, lost };
}

describe("the desk layer's status on an uncaptured GPU error (D7)", () => {
  const undo: (() => void)[] = [];
  beforeAll(() => { undo.push(installGpuFlags()); });
  afterAll(() => { for (const u of undo.splice(0)) u(); });

  it("ready, then an out-of-memory nobody captured: the layer leaves `ready` — degraded, the error named — and stays so; it still draws what it can", async () => {
    const { gpu, container, uncaptured } = fakeHost();
    vi.stubGlobal("navigator", { gpu });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const ce = createCanvasEngine({});
      ce.docs.create();
      const handle = deskLayer({ gpu, objects: [], theme: THEMES.light, palette: PALETTE.light })({ host: { container }, world: ce.world });
      for (let i = 0; i < 50 && handle.status().state === "pending"; i++) await new Promise((r) => setTimeout(r, 5));
      expect(handle.status()).toEqual({ state: "ready" });
      expect(handle.available()).toBe(true);
      uncaptured("GPUOutOfMemoryError", "Not enough memory left to allocate the texture");
      expect(handle.status().state).toBe("degraded");
      expect(handle.status().message).toContain("GPUOutOfMemoryError: Not enough memory left to allocate the texture");
      expect(handle.available()).toBe(true);   // it still draws what it can
      uncaptured("GPUValidationError", "a later one");
      expect(handle.status().state).toBe("degraded");   // never back to ready on its own
      expect(errors).toHaveBeenCalled();
      handle.dispose();
    } finally {
      errors.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("the device lost after the boot: `onStatus` tells each listener — ready, then failed with the loss named — and an unsubscribed one hears no more (K9)", async () => {
    const { gpu, container, lost } = fakeHost();
    vi.stubGlobal("navigator", { gpu });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const ce = createCanvasEngine({});
      ce.docs.create();
      const handle = deskLayer({ gpu, objects: [], theme: THEMES.light, palette: PALETTE.light })({ host: { container }, world: ce.world });
      const heard: string[] = [];
      const left: string[] = [];
      handle.onStatus((s) => heard.push(s.message === undefined ? s.state : `${s.state}: ${s.message}`));
      const leave = handle.onStatus((s) => left.push(s.state));
      for (let i = 0; i < 50 && handle.status().state === "pending"; i++) await new Promise((r) => setTimeout(r, 5));
      expect(heard).toEqual(["ready"]);
      leave();
      lost("destroyed", "Device was destroyed.");
      await new Promise((r) => setTimeout(r, 0));
      expect(heard).toEqual(["ready", "failed: the device was lost: destroyed: Device was destroyed."]);
      expect(handle.status().state).toBe("failed");
      expect(handle.available()).toBe(false);   // the layer ended
      expect(left).toEqual(["ready"]);
      handle.dispose();
    } finally {
      errors.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
