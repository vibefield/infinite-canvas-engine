/**
 * M10 React facade (design-005 §5): EngineProvider/useCommit, useUndoStatus,
 * useTool, the default keymap, usePresencePeers, and the <InfiniteCanvas> mount.
 *
 * Driven headless (happy-dom) against a REAL `createCanvasEngine` + doc session
 * — the reactive observers fire at `engine.step()` notify, so each assertion
 * steps the engine inside `act()`. A tiny `renderHook` mounts a probe under
 * `<EngineProvider>` and mirrors the hook's return into `result.current`.
 */
import {
  Position,
  PrefabId,
  PresenceInfo,
  PresencePeer,
  Size,
  createCanvasEngine,
  defineQuery,
  defineWidget,
  p,
  type CanvasEngine,
  type Entity,
} from "@ice/core";
import { act, createElement, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EngineProvider,
  InfiniteCanvas,
  attachKeymap,
  useCommit,
  usePresencePeers,
  useTool,
  useUndoStatus,
} from "../src";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// A distinct widget type (avoid a duplicate-name clash with widget-react.test).
defineWidget({
  type: "rt:box",
  props: { text: p.string({ default: "hi" }) },
  surface: "dom",
  component: () => null,
  defaultSize: { w: 100, h: 60 },
});

// PrefabId marks durable widgets; excludes the ephemeral selection-chrome
// entities the interaction stack spawns (which carry Position+Size but no prefab).
const widgetQ = defineQuery([Position, Size, PrefabId]);
const countWidgets = (engine: CanvasEngine): number => {
  let n = 0;
  engine.world.query(widgetQ).each((b) => {
    n += b.count;
  });
  return n;
};

// --- teardown registry -------------------------------------------------------
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) {
    try {
      c();
    } catch {
      /* best-effort */
    }
  }
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** A fresh engine + attached document, with a helper to step frames in act(). */
function makeEngine(): { engine: CanvasEngine; step: (n?: number) => void } {
  const engine = createCanvasEngine();
  engine.docs.create();
  cleanups.push(() => engine.dispose());
  let now = 0;
  const step = (n = 1): void => {
    act(() => {
      for (let i = 0; i < n; i++) {
        now += 16;
        engine.step(now);
      }
    });
  };
  return { engine, step };
}

/** Mount a probe calling `useHook` under EngineProvider; mirror its return. */
function renderHook<T>(useHook: () => T, engine: CanvasEngine): {
  result: { current: T };
  forceRender: () => void;
} {
  const result = { current: undefined as unknown as T };
  let bump: (() => void) | undefined;
  function Harness(): ReactElement | null {
    const [, setN] = useState(0);
    bump = () => setN((v) => v + 1);
    result.current = useHook();
    return null;
  }
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root: Root = createRoot(el);
  cleanups.push(() => act(() => root.unmount()));
  act(() => {
    root.render(createElement(EngineProvider, { engine }, createElement(Harness)));
  });
  return { result, forceRender: () => act(() => bump?.()) };
}

/** Spawn a box widget, step it live, and return the (now-alive) entity. */
function spawnBox(engine: CanvasEngine, step: (n?: number) => void, x = 50, y = 50): Entity {
  const e = engine.ops.spawnWidget("rt:box", { x, y });
  step(2);
  return e;
}

describe("EngineProvider + useCommit", () => {
  it("commits a Position through the current doc session", () => {
    const { engine, step } = makeEngine();
    const e = spawnBox(engine, step);
    const { result } = renderHook(() => useCommit(), engine);
    act(() => {
      result.current((tx) => tx.edit(e).set(Position, { x: 123, y: 45 }));
    });
    step();
    expect(engine.world.get(e, Position)).toEqual({ x: 123, y: 45 });
  });

  it("throws helpfully when no document is attached", () => {
    const engine = createCanvasEngine(); // doc-LESS
    cleanups.push(() => engine.dispose());
    const { result } = renderHook(() => useCommit(), engine);
    expect(() => result.current(() => {})).toThrow(/no active document/i);
  });
});

describe("useUndoStatus", () => {
  it("flips after a commit and after undo", () => {
    const { engine, step } = makeEngine();
    const { result } = renderHook(() => useUndoStatus(), engine);
    expect(result.current).toEqual({ canUndo: false, canRedo: false });

    // A durable spawn is one undo step.
    act(() => {
      engine.ops.spawnWidget("rt:box", { x: 0, y: 0 });
    });
    step();
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);

    act(() => {
      engine.docs.undo();
    });
    step();
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
  });
});

describe("useTool", () => {
  it("reflects ops.setTool at notify", () => {
    const { engine, step } = makeEngine();
    const { result } = renderHook(() => useTool(), engine);
    expect(result.current[0]).toBe("select");

    act(() => {
      engine.ops.setTool("hand");
    });
    step();
    expect(result.current[0]).toBe("hand");

    // The returned setter routes through ops too.
    act(() => {
      result.current[1]("select");
    });
    step();
    expect(result.current[0]).toBe("select");
  });
});

describe("default keymap", () => {
  it("Delete removes the selection through ops", () => {
    const { engine, step } = makeEngine();
    const e = spawnBox(engine, step);
    engine.ops.setSelection([e]);
    cleanups.push(attachKeymap(engine, window));

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    step();
    expect(engine.world.isAlive(e)).toBe(false);
  });

  it("mod+d duplicates the selection and preventDefaults", () => {
    const { engine, step } = makeEngine();
    const e = spawnBox(engine, step);
    engine.ops.setSelection([e]);
    cleanups.push(attachKeymap(engine, window));
    expect(countWidgets(engine)).toBe(1);

    const evt = new KeyboardEvent("keydown", { key: "d", metaKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(evt);
    step(2);
    expect(evt.defaultPrevented).toBe(true);
    expect(countWidgets(engine)).toBe(2);
  });

  it("an arrow press is one nudge = one undo step", () => {
    const { engine, step } = makeEngine();
    const e = spawnBox(engine, step, 50, 50);
    engine.ops.setSelection([e]);
    cleanups.push(attachKeymap(engine, window));

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    step();
    expect(engine.world.get(e, Position)?.x).toBe(51);

    // Exactly one undo reverts the whole press.
    act(() => {
      engine.docs.undo();
    });
    step();
    expect(engine.world.get(e, Position)?.x).toBe(50);
  });

  it("Escape cancels active gestures through ops", () => {
    const { engine } = makeEngine();
    const spy = vi.spyOn(engine.ops, "cancelActiveGestures");
    cleanups.push(attachKeymap(engine, window));

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire while typing into an editable field", () => {
    const { engine, step } = makeEngine();
    const e = spawnBox(engine, step);
    engine.ops.setSelection([e]);
    cleanups.push(attachKeymap(engine, window));

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    step();
    expect(engine.world.isAlive(e)).toBe(true); // survived — the shortcut was skipped
  });
});

describe("usePresencePeers", () => {
  it("returns remote (Not(Local)) peers with stable identity across unrelated renders", () => {
    const { engine, step } = makeEngine();
    const { result, forceRender } = renderHook(() => usePresencePeers(), engine);
    expect(result.current).toEqual([]);

    // A raw world.spawn is NOT Local (Local is applied only by eph.spawn).
    engine.world.spawn({ components: [[PresenceInfo, { name: "Otter", color: "#e5484d" }]], tags: [PresencePeer] });
    step();
    expect(result.current).toHaveLength(1);
    expect(result.current[0]?.info?.name).toBe("Otter");

    const before = result.current;
    forceRender();
    expect(result.current).toBe(before); // membership-keyed cache → stable identity
  });
});

describe("<InfiniteCanvas>", () => {
  it("mounts host planes and detaches on unmount (no rAF leak)", () => {
    const raf = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(() => 1 as unknown as number);
    const caf = vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});

    const { engine } = makeEngine();
    const mountEl = document.createElement("div");
    document.body.appendChild(mountEl);
    const root = createRoot(mountEl);

    act(() => {
      root.render(createElement(InfiniteCanvas, { engine }));
    });

    const canvas = mountEl.querySelector("[data-ice-canvas]");
    expect(canvas).toBeTruthy();
    expect(canvas?.children.length).toBeGreaterThan(0); // host content plane + reflector layers
    expect(raf).toHaveBeenCalled(); // the rAF loop started

    act(() => {
      root.unmount();
    });
    expect(caf).toHaveBeenCalled(); // the loop was cancelled
    expect(mountEl.querySelector("[data-ice-canvas]")).toBeNull(); // host torn down
  });
});
