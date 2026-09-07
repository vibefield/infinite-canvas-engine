/**
 * The content seam reaches the tree (design-013 §5/§6, B5's plumbing).
 *
 * A render reflector — the R3F island root, which the import wall keeps
 * app-side — has to reach two objects the app never holds: the ground's
 * content residency and the roster's render slots. `<InfiniteCanvas>` publishes
 * them from the same effect that builds the layer, so a GL root mounted from
 * `onReady` sees them on its FIRST render (the profile it selects is decided
 * once, exactly like `<GLViews compositor>`).
 *
 * Driven headless (happy-dom) against a REAL `createCanvasEngine` and the REAL
 * composited-next profile, with a fake ground layer standing in for
 * `groundCompose(…)` — the one thing this package may not import.
 */
import {
  createCanvasEngine,
  type CanvasEngine,
  type EngineGpu,
  type Entity,
  type ReflectorDef,
  type TextureHandle,
  type TextureTable,
  type World,
} from "@ice/core";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  compositedNextProfile,
  InfiniteCanvas,
  useSurfaceContent,
  type ContentRenderSlots,
  type ContentSink,
  type SurfaceContent,
} from "../src";
import { surfaceContentOf } from "../src/surface-content";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0).reverse()) c();
  vi.restoreAllMocks();
});

/** The `ContentSink` half of `groundCompose(…)`'s residency, as a stand-in. */
function fakeSink(): ContentSink & { attached: TextureTable | null; attach(t: TextureTable): void } {
  return {
    attached: null,
    attach(t) {
      this.attached = t;
    },
    table: null,
    realize: () => true,
    textureOf: () => undefined,
    wrote: () => true,
    isWritten: () => false,
    onForget: () => () => {},
  };
}

/** A ground layer whose handle carries a compose seam — what `groundCompose(…)` returns. */
function fakeGround(withCompose: boolean) {
  const gpuCompose: ReflectorDef = { name: "ground/gpu-compose", always: true, flush() {} };
  const residency = fakeSink();
  const renders: ContentRenderSlots = {
    dom: { current: null },
    island: { current: null },
    video: { current: null },
  };
  let disposed = 0;
  const factory = (): unknown => ({
    reflector: { name: "ground/compose-slot", always: false, flush() {}, available: () => true },
    configureGrid() {},
    dispose() {
      disposed += 1;
    },
    ...(withCompose ? { compose: { gpuCompose, residency, renders } } : {}),
  });
  return { factory, residency, renders, disposed: () => disposed };
}

/** The app-owned device the composited-next profile's gate asks for, as a stand-in. */
const FAKE_GPU = { device: { limits: { maxTextureDimension2D: 4096 } } } as unknown as EngineGpu;

function makeEngine(withDevice: boolean): CanvasEngine {
  const engine = createCanvasEngine(withDevice ? { compositorDevice: FAKE_GPU } : {});
  engine.docs.create();
  cleanups.push(() => engine.dispose());
  return engine;
}

/** Mount `<InfiniteCanvas>` with a probe child that mirrors what the context gave it. */
function mount(
  engine: CanvasEngine,
  ground: () => unknown,
  profile?: typeof compositedNextProfile,
): { seen: { current: SurfaceContent | undefined }; unmount: () => void } {
  vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(() => 1 as unknown as number);
  vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
  const seen: { current: SurfaceContent | undefined } = { current: undefined };
  /** Stands in for the app's `<Canvas><GLViews/></Canvas>`, which mounts as a CHILD. */
  function Probe(): ReactElement | null {
    seen.current = useSurfaceContent();
    return null;
  }
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root: Root = createRoot(el);
  act(() => {
    root.render(
      createElement(
        InfiniteCanvas,
        {
          engine,
          ground: ground as never,
          ...(profile !== undefined ? { profile } : {}),
        },
        createElement(Probe),
      ),
    );
  });
  const unmount = (): void => {
    act(() => root.unmount());
    el.remove();
  };
  cleanups.push(() => {
    try {
      unmount();
    } catch {
      /* already unmounted */
    }
  });
  return { seen, unmount };
}

describe("the ground's content seam reaches the tree", () => {
  it("publishes the compose handle's residency and render slots under composited-next", () => {
    const engine = makeEngine(true);
    const ground = fakeGround(true);
    const { seen } = mount(engine, ground.factory, compositedNextProfile);

    const content = seen.current;
    if (content === undefined) throw new Error("the context published nothing");
    // The SAME objects the ground handed out — a render installs into these slots.
    expect(content.residency).toBe(ground.residency);
    expect(content.renders).toBe(ground.renders);
    expect(content.renders.island.current).toBeNull();
    // And the profile attached its table to that same residency at install (B4a).
    expect(ground.residency.attached).not.toBeNull();
  });

  it("publishes nothing for the old leg's ground, which carries no compose handle", () => {
    const engine = makeEngine(true);
    const ground = fakeGround(false);
    const { seen } = mount(engine, ground.factory);
    expect(seen.current).toBeUndefined();
  });

  it("publishes nothing when there is no ground at all", () => {
    const engine = makeEngine(true);
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(() => 1 as unknown as number);
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    const seen: { current: SurfaceContent | undefined } = { current: undefined };
    function Probe(): ReactElement | null {
      seen.current = useSurfaceContent();
      return null;
    }
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    act(() => {
      root.render(createElement(InfiniteCanvas, { engine }, createElement(Probe)));
    });
    expect(seen.current).toBeUndefined();
    act(() => root.unmount());
    el.remove();
  });

  it("re-publishes on a re-boot, so nothing is handed the slots of a ground already disposed", () => {
    // The mount effect re-runs when the `ground` factory changes identity: the first
    // layer is disposed and the second one's seam must be what the tree sees. A stale
    // seam here would install a render into slots nobody forwards any more.
    const engine = makeEngine(true);
    const first = fakeGround(true);
    const second = fakeGround(true);
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(() => 1 as unknown as number);
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    const seen: { current: SurfaceContent | undefined } = { current: undefined };
    function Probe(): ReactElement | null {
      seen.current = useSurfaceContent();
      return null;
    }
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    const render = (g: { factory: () => unknown }): void => {
      act(() => {
        root.render(
          createElement(
            InfiniteCanvas,
            { engine, ground: g.factory as never, profile: compositedNextProfile },
            createElement(Probe),
          ),
        );
      });
    };
    render(first);
    expect(seen.current?.renders).toBe(first.renders);
    render(second);
    expect(first.disposed(), "the first layer is gone").toBe(1);
    expect(seen.current?.renders, "and its slots went with it").toBe(second.renders);
    expect(seen.current?.residency).toBe(second.residency);
    act(() => root.unmount());
    el.remove();
    expect(second.disposed()).toBe(1);
  });
});

describe("surfaceContentOf — the structural read", () => {
  it("takes a handle that carries both halves and refuses every partial one", () => {
    const residency = fakeSink();
    const renders: ContentRenderSlots = {
      dom: { current: null },
      island: { current: null },
      video: { current: null },
    };
    expect(surfaceContentOf({ compose: { residency, renders } })).toEqual({ residency, renders });
    expect(surfaceContentOf({ compose: { residency } })).toBeUndefined();
    expect(surfaceContentOf({ compose: { renders } })).toBeUndefined();
    expect(surfaceContentOf({ compose: {} })).toBeUndefined();
    expect(surfaceContentOf({})).toBeUndefined();
    expect(surfaceContentOf(null)).toBeUndefined();
    expect(surfaceContentOf(undefined)).toBeUndefined();
  });
});

// Type-level: the shapes a render reflector names are the ones the slots carry.
const _slotShape: ContentRenderSlots["island"] = {
  current: { name: "island-render", flush(_w: World) {} },
};
const _sinkShape: Pick<ContentSink, "realize" | "wrote"> = {
  realize: (_h: TextureHandle, _t: GPUTexture) => true,
  wrote: (_e: Entity) => true,
};
void _slotShape;
void _sinkShape;
