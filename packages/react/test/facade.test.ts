/**
 * M10 React facade (design-005 §5): EngineProvider/useCommit, useUndoStatus,
 * useTool, the default keymap, usePresencePeers, and the <Desk> mount (design-015 D5b —
 * `<InfiniteCanvas>` became `<Desk>` by deletion; the desk arrives as an opaque layer factory).
 *
 * Driven headless (happy-dom) against a REAL `createCanvasEngine` + doc session
 * — the reactive observers fire at `engine.step()` notify, so each assertion
 * steps the engine inside `act()`. A tiny `renderHook` mounts a probe under
 * `<EngineProvider>` and mirrors the hook's return into `result.current`.
 */
import {
  Locked,
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
  openTray,
  trayOpen,
} from "@ice/core";
import type { LayerFactory } from "@ice/dom";
import { StrictMode, act, createElement, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Desk,
  EngineProvider,
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
  defaultSize: { w: 100, h: 60 },
});

/**
 * A structural fake of the desk's layer factory (`deskLayer(…)` in production): react must treat
 * it as a black box. It prepends one canvas to the container, exactly as the desk does, and
 * counts its births and deaths so a StrictMode double-mount can be told from a leak.
 */
function fakeLayer(): { factory: LayerFactory; created: () => number; disposed: () => number } {
  let created = 0;
  let disposed = 0;
  const factory: LayerFactory = (ctx) => {
    created++;
    const canvas = ctx.host.container.ownerDocument.createElement("canvas");
    ctx.host.container.prepend(canvas);
    return {
      reflector: { name: "fake-desk", always: true, flush() {}, available: () => true },
      dispose() {
        disposed++;
        canvas.remove();
      },
    };
  };
  return { factory, created: () => created, disposed: () => disposed };
}

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
      engine.ops.setTool("pan");
    });
    step();
    expect(result.current[0]).toBe("pan");

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

  it("the tape (design-015 D4a): an arrow passes a taped widget over while its untaped companion moves; ⇧⌘L tapes the selection, and lifts it once all of it is taped — one undo step each", () => {
    const { engine, step } = makeEngine();
    const a = spawnBox(engine, step, 50, 50);
    const b = spawnBox(engine, step, 200, 50);
    engine.ops.setLocked([a], true);
    step();
    engine.ops.setSelection([a, b]);
    cleanups.push(attachKeymap(engine, window));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    step();
    expect(engine.world.get(a, Position)?.x).toBe(50);
    expect(engine.world.get(b, Position)?.x).toBe(201);
    const tape = (): KeyboardEvent => new KeyboardEvent("keydown", { key: "L", metaKey: true, shiftKey: true, bubbles: true, cancelable: true });
    const first = tape();
    window.dispatchEvent(first);
    step();
    expect(first.defaultPrevented).toBe(true);
    expect([engine.world.hasTag(a, Locked), engine.world.hasTag(b, Locked)]).toEqual([true, true]);
    window.dispatchEvent(tape());
    step();
    expect([engine.world.hasTag(a, Locked), engine.world.hasTag(b, Locked)]).toEqual([false, false]);
    act(() => {
      engine.docs.undo();
    });
    step();
    expect([engine.world.hasTag(a, Locked), engine.world.hasTag(b, Locked)]).toEqual([true, true]);
  });

  it("Escape cancels active gestures through ops", () => {
    const { engine } = makeEngine();
    const spy = vi.spyOn(engine.ops, "cancelActiveGestures");
    cleanups.push(attachKeymap(engine, window));

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("the pegboard tray (design-017 §4, K3): Esc closes it FIRST — cancelling nothing with it — and while it is out the desk's own keys are quiet (Delete, an arrow)", () => {
    const { engine, step } = makeEngine();
    const e = spawnBox(engine, step, 50, 50);
    engine.ops.setSelection([e]);
    const cancel = vi.spyOn(engine.ops, "cancelActiveGestures");
    cleanups.push(attachKeymap(engine, window));
    openTray(engine.world);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    step();
    expect(engine.world.isAlive(e)).toBe(true);
    expect(engine.world.get(e, Position)?.x).toBe(50);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(trayOpen(engine.world)).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
    // control: the drawer closed, the same arrow nudges
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    step();
    expect(engine.world.get(e, Position)?.x).toBe(51);
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

describe("<Desk> — a throwing layer factory", () => {
  /**
   * A `matchMedia` whose listeners can be counted. The reduced-motion listener
   * lives for the life of the WINDOW, so one left behind by a failed mount
   * outlives every engine it captured.
   */
  function countingMatchMedia(): { live: () => number } {
    let live = 0;
    const original = window.matchMedia;
    cleanups.push(() => {
      (window as unknown as { matchMedia: unknown }).matchMedia = original;
    });
    (window as unknown as { matchMedia: unknown }).matchMedia = () => ({
      matches: false,
      addEventListener: () => {
        live += 1;
      },
      removeEventListener: () => {
        live -= 1;
      },
    });
    return { live: () => live };
  }

  /** Mount a layer whose factory throws; return what the mount threw. */
  function mountThrowing(engine: CanvasEngine): unknown {
    const mountEl = document.createElement("div");
    document.body.appendChild(mountEl);
    // React 19 reports an uncaught effect error as well as rethrowing it; the
    // sink keeps this expected failure out of the suite's console.
    const root = createRoot(mountEl, { onUncaughtError: () => {} });
    const layer: LayerFactory = () => {
      throw new Error("no GPU in this fake");
    };
    try {
      act(() => {
        root.render(createElement(Desk, { engine, layer }));
      });
    } catch (error) {
      return error;
    }
    return undefined;
  }

  it("surfaces the factory's own reason, on a remount too", () => {
    // A throwing effect returns no cleanup, so anything the failing path had
    // already claimed on the ENGINE — which outlives the mount — would be claimed
    // for good. The layer is built before any registration, so nothing is.
    const { engine } = makeEngine();
    expect(String(mountThrowing(engine))).toMatch(/no GPU in this fake/);
    expect(String(mountThrowing(engine))).toMatch(/no GPU in this fake/);
  });

  it("claims nothing on the engine or the window on its way out", () => {
    const media = countingMatchMedia();
    const { engine } = makeEngine();
    expect(mountThrowing(engine)).toBeInstanceOf(Error);
    expect(engine.transitions.stats().adapters).toBe(0); // the ground plane is free
    expect(media.live()).toBe(0); // no window-lifetime listener survived
  });

  it("wires and unwires the reduced-motion listener once the layer mounts", () => {
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(() => 1 as unknown as number);
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    const media = countingMatchMedia();
    const { engine } = makeEngine();
    const mountEl = document.createElement("div");
    document.body.appendChild(mountEl);
    const root = createRoot(mountEl);
    const layer = fakeLayer();

    act(() => {
      root.render(createElement(Desk, { engine, layer: layer.factory }));
    });
    expect(media.live()).toBe(1);
    expect(layer.created()).toBe(1);

    act(() => {
      root.unmount();
    });
    expect(media.live()).toBe(0);
    expect(layer.disposed()).toBe(1);
  });
});

describe("<Desk>", () => {
  it("mounts the layer's canvas in the host and detaches on unmount (no rAF leak)", () => {
    const raf = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(() => 1 as unknown as number);
    const caf = vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});

    const { engine } = makeEngine();
    const mountEl = document.createElement("div");
    document.body.appendChild(mountEl);
    const root = createRoot(mountEl);
    const layer = fakeLayer();
    let ready: unknown;

    act(() => {
      root.render(createElement(Desk, { engine, layer: layer.factory, onReady: (h) => { ready = h; } }));
    });

    const container = mountEl.querySelector("[data-ice-canvas]");
    expect(container).toBeTruthy();
    expect(container?.querySelectorAll("canvas")).toHaveLength(1); // the layer's canvas
    expect(container?.children.length).toBeGreaterThan(1); // + the remote-cursors plane
    expect(raf).toHaveBeenCalled(); // the rAF loop started
    expect(ready).toMatchObject({ engine }); // onReady saw the live host
    expect((ready as { focus: { blurFocus(): boolean } }).focus.blurFocus()).toBe(false); // nothing claims focus

    act(() => {
      root.unmount();
    });
    expect(caf).toHaveBeenCalled(); // the loop was cancelled
    expect(mountEl.querySelector("[data-ice-canvas]")).toBeNull(); // host torn down
    expect(layer.disposed()).toBe(1);
  });

  it("StrictMode remount stacks nothing: exactly one canvas, disposed per unmount (the double-grid field report)", () => {
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(() => 1 as unknown as number);
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});

    const { engine } = makeEngine();
    const mountEl = document.createElement("div");
    document.body.appendChild(mountEl);
    const root = createRoot(mountEl);
    // StrictMode runs the mount effect twice ON THE SAME container div — every
    // node the layer inserted must be disposed by the cleanup or it duplicates here.
    const layer = fakeLayer();

    act(() => {
      root.render(createElement(StrictMode, null, createElement(Desk, { engine, layer: layer.factory })));
    });

    const container = mountEl.querySelector("[data-ice-canvas]");
    expect(container).toBeTruthy();
    expect(container?.querySelectorAll("canvas")).toHaveLength(1); // ONE canvas, once
    expect(layer.created()).toBe(2); // StrictMode double-mount…
    expect(layer.disposed()).toBe(1); // …first instance disposed by the cleanup

    act(() => {
      root.unmount();
    });
    expect(layer.disposed()).toBe(2);
    expect(mountEl.querySelectorAll("canvas")).toHaveLength(0);
  });

  it("onReady's cleanup ends what that mount started — once per mount, the discarded StrictMode mount's too, before its layer goes (K9)", () => {
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(() => 1 as unknown as number);
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    const { engine } = makeEngine();
    const mountEl = document.createElement("div");
    document.body.appendChild(mountEl);
    const root = createRoot(mountEl);
    const layer = fakeLayer();
    // each mount's onReady starts something of its own; its cleanup says which, and how many layers were gone by then
    const started: number[] = [];
    const ended: { mount: number; disposedBefore: number }[] = [];
    const onReady = (): (() => void) => {
      const mount = started.length;
      started.push(mount);
      return () => { ended.push({ mount, disposedBefore: layer.disposed() }); };
    };

    act(() => {
      root.render(createElement(StrictMode, null, createElement(Desk, { engine, layer: layer.factory, onReady })));
    });
    expect(started).toEqual([0, 1]); // ready once per mount…
    expect(ended).toEqual([{ mount: 0, disposedBefore: 0 }]); // …the discarded first mount's cleanup ran, before its layer went

    act(() => {
      root.unmount();
    });
    expect(ended).toEqual([{ mount: 0, disposedBefore: 0 }, { mount: 1, disposedBefore: 1 }]); // the live mount's at unmount
    expect(layer.disposed()).toBe(2);
  });

  it("renders its children in the container, above the canvas — screen-space chrome", () => {
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(() => 1 as unknown as number);
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    const { engine } = makeEngine();
    const mountEl = document.createElement("div");
    document.body.appendChild(mountEl);
    const root = createRoot(mountEl);
    const layer = fakeLayer();
    act(() => {
      root.render(createElement(Desk, { engine, layer: layer.factory }, createElement("nav", { id: "chrome" })));
    });
    const container = mountEl.querySelector("[data-ice-canvas]");
    const chrome = container?.querySelector("#chrome");
    expect(chrome).toBeTruthy();
    expect(container?.firstElementChild?.tagName).toBe("CANVAS"); // the desk under everything
    act(() => {
      root.unmount();
    });
  });
});

/**
 * The widget input contract (design-007, petitions I1/I4): defaultPrevented
 * gate, the data-canvas-keyboard standdown, Escape as the release gesture,
 * and keymap overrides as the arbitration surface (the C-key retirement).
 */
describe("keymap standdown (design-007)", () => {
  /** A claiming widget host as the dom-widgets reflector marks it. */
  function claimedNode(escapeOwned = false): HTMLDivElement {
    const el = document.createElement("div");
    el.setAttribute("data-canvas-keyboard", escapeOwned ? "escape" : "");
    el.tabIndex = -1;
    document.body.appendChild(el);
    cleanups.push(() => el.remove());
    return el;
  }

  it("skips events a widget already handled (event.defaultPrevented — Stage 1)", () => {
    const { engine, step } = makeEngine();
    const e = spawnBox(engine, step);
    engine.ops.setSelection([e]);
    cleanups.push(attachKeymap(engine, window));
    // Widget content consumed the key in its own (capture) handler.
    const consume = (ev: Event): void => ev.preventDefault();
    window.addEventListener("keydown", consume, true);
    cleanups.push(() => window.removeEventListener("keydown", consume, true));

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
    step();
    expect(engine.world.isAlive(e)).toBe(true); // deleteSelection never fired
  });

  it("stands down for every entry while a claiming widget holds focus", () => {
    const { engine, step } = makeEngine();
    const e = spawnBox(engine, step);
    engine.ops.setSelection([e]);
    cleanups.push(attachKeymap(engine, window));
    const node = claimedNode();
    node.focus();

    const del = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true });
    node.dispatchEvent(del);
    step();
    expect(engine.world.isAlive(e)).toBe(true); // selection survives — deleteSelection stood down
    expect(del.defaultPrevented).toBe(false); // the key flowed to the widget untouched
  });

  it("Escape RELEASES the claim (blur, preventDefault) instead of cancelling gestures", () => {
    const { engine } = makeEngine();
    const spy = vi.spyOn(engine.ops, "cancelActiveGestures");
    cleanups.push(attachKeymap(engine, window));
    const node = claimedNode();
    node.focus();
    expect(document.activeElement).toBe(node);

    const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    node.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(true);
    expect(document.activeElement).not.toBe(node); // blurred — the release gesture
    expect(spy).not.toHaveBeenCalled(); // cancel waits for the NEXT, unclaimed Escape

    // With focus gone, Escape falls through to cancelActiveGestures as ever.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("keyboardEscape:'widget' passes even Escape through (vim-grade terminals)", () => {
    const { engine } = makeEngine();
    const spy = vi.spyOn(engine.ops, "cancelActiveGestures");
    cleanups.push(attachKeymap(engine, window));
    const node = claimedNode(true); // marker value "escape"
    node.focus();

    const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    node.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(false); // the widget receives it
    expect(document.activeElement).toBe(node); // no engine release
    expect(spy).not.toHaveBeenCalled();
  });

  it("Escape releases an EDITABLE focus proxy inside a claim (gate order — 2026-08-09 review fix)", () => {
    const { engine } = makeEngine();
    const spy = vi.spyOn(engine.ops, "cancelActiveGestures");
    cleanups.push(attachKeymap(engine, window));
    const node = claimedNode();
    const textarea = document.createElement("textarea");
    node.appendChild(textarea);
    textarea.focus();
    expect(document.activeElement).toBe(textarea);

    const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    textarea.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(true);
    expect(document.activeElement).not.toBe(textarea); // released — editable-first would have shadowed this
    expect(spy).not.toHaveBeenCalled();
  });

  it("warns at attach for an override bound to Space (the adapter owns the pan modifier)", () => {
    const { engine } = makeEngine();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    cleanups.push(attachKeymap(engine, window, [{ key: " ", run: () => {} }]));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Space"));
    warn.mockRestore();
  });

  it("overrides replace a default by signature — conditional dispatch lives in run()", () => {
    const { engine, step } = makeEngine();
    const e = spawnBox(engine, step);
    engine.ops.setSelection([e]);
    const ran = vi.fn();
    cleanups.push(attachKeymap(engine, window, [{ key: "Backspace", run: ran }]));

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
    step();
    expect(ran).toHaveBeenCalledTimes(1);
    expect(engine.world.isAlive(e)).toBe(true); // the default it replaced never fired
  });
});
