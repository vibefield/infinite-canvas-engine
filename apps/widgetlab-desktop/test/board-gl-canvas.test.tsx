/**
 * The board Canvas's two GPU-object lifecycles, at the component seam (C4c).
 *
 * R3F's `<Canvas>` is STUBBED here — a real one needs a browser and a device, which
 * is what the `app` rig is for. What this file grades is what the rig cannot reach:
 * the component's own decisions around the Canvas — when the renderer lease is
 * rebuilt, and whether the PMREM render target is freed when the environment goes
 * away. Both were leaks the Phase C review found by reading, with no witness.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Texture } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

/** The Canvas renders nothing (its children — `GLViews` — need a real GL root). */
const FAKE_GL = { id: "fake renderer" };
vi.mock("@react-three/fiber", () => ({
  Canvas: () => null,
  useThree: (select: (s: { gl: unknown }) => unknown) => select({ gl: FAKE_GL }),
}));

import type { Engine, EngineGpu, WidgetMountStore } from "@ice/core";
import type { GLBridge } from "@ice/r3f";
import {
  BoardGLCanvas,
  type BoardGlInstruments,
  createEnvSlot,
  EnvLoader,
  type EnvGenerator,
  type EnvTarget,
} from "../src/BoardGLCanvas";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

/** A PMREM target that is nothing but a disposal spy, and the generator that hands it out. */
function fakeGenerator(): { make: EnvGenerator; targets: Array<EnvTarget & { dispose: ReturnType<typeof vi.fn> }> } {
  const targets: Array<EnvTarget & { dispose: ReturnType<typeof vi.fn> }> = [];
  const make: EnvGenerator = () => {
    const target = { texture: { id: targets.length } as unknown as Texture, dispose: vi.fn() };
    targets.push(target);
    return { backend: "webgpu", target };
  };
  return { make, targets };
}

describe("the board Canvas's renderer lease", () => {
  const props = (gpu: EngineGpu, onInstruments: (i: BoardGlInstruments | null) => void) => {
    const plane = document.createElement("div");
    document.body.appendChild(plane);
    return {
      engine: {} as Engine,
      bridge: {} as GLBridge,
      store: {} as WidgetMountStore,
      plane,
      gpu,
      onInstruments,
    };
  };

  it("is rebuilt when the device changes, and kept across an unrelated re-render", async () => {
    // D-C0.2's "stable factory" read `gpu.device` once and never again: a second device
    // kept drawing through a lease — and a renderer — built on the first.
    const d1 = { label: "one" } as unknown as GPUDevice;
    const d2 = { label: "two" } as unknown as GPUDevice;
    let live: BoardGlInstruments | null = null;
    const seen: Array<BoardGlInstruments | null> = [];
    const onInstruments = (i: BoardGlInstruments | null) => {
      live = i;
      seen.push(i);
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(createElement(BoardGLCanvas, props({ device: d1 } as EngineGpu, onInstruments)));
    });
    expect(live).not.toBeNull();
    expect((live as unknown as BoardGlInstruments).device()).toBe(d1);

    // A re-render on the SAME device keeps the lease (a new one would build a second
    // renderer for every App render).
    await act(async () => {
      root?.render(createElement(BoardGLCanvas, props({ device: d1 } as EngineGpu, onInstruments)));
    });
    expect((live as unknown as BoardGlInstruments).device()).toBe(d1);

    await act(async () => {
      root?.render(createElement(BoardGLCanvas, props({ device: d2 } as EngineGpu, onInstruments)));
    });
    expect((live as unknown as BoardGlInstruments).device()).toBe(d2);
    expect(seen.filter((i) => i !== null).length).toBeGreaterThan(0);
  });
});

describe("the board Canvas's PMREM environment", () => {
  it("disposes the render target when the Canvas goes away", async () => {
    // three 0.185.1: `fromScene` returns a target the CALLER owns and the generator's
    // own `dispose()` frees its internals only. The cleanup used to be `onTex(null)` —
    // a dropped reference on the app-owned device, which is the process's lifetime.
    const { make, targets } = fakeGenerator();
    const slot = createEnvSlot(make);
    const onTex = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(createElement(EnvLoader, { slot, onTex }));
    });
    expect(targets).toHaveLength(1);
    expect(slot.census()).toEqual({ created: 1, disposed: 0 });
    expect(slot.backend()).toBe("webgpu");
    expect(onTex).toHaveBeenCalledWith(targets[0]?.texture);

    await act(() => {
      root?.unmount();
    });
    root = null;
    expect(targets[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(slot.census()).toEqual({ created: 1, disposed: 1 });
  });

  it("frees the previous target when the renderer changes, and never the live one", () => {
    const { make, targets } = fakeGenerator();
    const slot = createEnvSlot(make);
    const first = slot.acquire({});
    const second = slot.acquire({}); // a new renderer: the old target is not ours to keep

    expect(targets[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(targets[1]?.dispose).not.toHaveBeenCalled();
    expect(slot.census()).toEqual({ created: 2, disposed: 1 });

    // The superseded texture's cleanup arrives AFTER the new acquire (React's order)
    // and must not free the live target.
    slot.release(first);
    expect(targets[1]?.dispose).not.toHaveBeenCalled();
    expect(slot.census()).toEqual({ created: 2, disposed: 1 });

    slot.release(second);
    expect(targets[1]?.dispose).toHaveBeenCalledTimes(1);
    expect(slot.census()).toEqual({ created: 2, disposed: 2 });
  });
});
