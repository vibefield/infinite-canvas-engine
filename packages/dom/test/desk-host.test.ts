// ONE DEVICE PER ENGINE (design-015 D7): `createDeskHost` hands the engine's device (`createCanvasEngine({ compositorDevice })`)
// to the layer through its context, so the desk draws with it instead of acquiring a second one; an engine with none hands none.
// THE DEVICE'S RATIO (ICE M21 K1): a ratio change that resizes nothing still reaches the viewport, before the next step.
// THE ROOM'S OTHER PEOPLE (petition I26): a layer whose handle says `cursors: false` — its host draws its peers itself — gets no
// remote cursors from the host: no plane, no reflector, nothing of two peers' hands drawn; absent or `true`, they are drawn as ever.
// Their reflector is the host's one OBSERVING reflector (the desk's and the OS cursor's are `always`), and the first observer is what
// arms the world's reactive layer — strata's dev access enforcement with it (reactive.ts): off, the host arms nothing, and the world
// arms at the host's own first observer (`usePresencePeers` is one) — core's petition-7 pin S5, "arming comes from the mount".
// THE STACK'S PICK (petition I27): the layer's context carries the interaction stack's exact pick, `stack.pickAt` itself — the one
// door the desk's `handle.pick` answers a host's screen point through.
import { createCanvasEngine, CursorVisual, type EngineGpu, Follows, Position, PresenceInfo, PresencePeer, Viewport, type World } from "@ice/core";
import { describe, expect, it } from "vitest";
import { createDeskHost, type LayerContext, type LayerHandle } from "../src/desk-host";

function mountWith(compositorDevice: EngineGpu | undefined): LayerContext | undefined {
  const engine = createCanvasEngine(compositorDevice !== undefined ? { compositorDevice } : {});
  const container = document.createElement("div");
  document.body.appendChild(container);
  let seen: LayerContext | undefined;
  const layer = (ctx: LayerContext): LayerHandle => {
    seen = ctx;
    return { reflector: { name: "fake-desk", always: true, flush() {}, available: () => true }, dispose() {} };
  };
  createDeskHost({ container, engine, layer }).dispose();
  engine.dispose();
  container.remove();
  return seen;
}

describe("createDeskHost · the engine's device (D7)", () => {
  it("hands `engine.compositorDevice` to the layer as `ctx.gpu`", () => {
    const gpu = { adapter: {}, device: {}, enabled: [], hasTimestampQuery: false, errors: () => [], destroy() {} } as unknown as EngineGpu;
    expect(mountWith(gpu)?.gpu).toBe(gpu);
  });

  it("hands none when the engine has none — the layer acquires its own", () => {
    const ctx = mountWith(undefined);
    expect(ctx).toBeDefined();
    expect(ctx !== undefined && "gpu" in ctx).toBe(false);
  });
});

describe("createDeskHost · the stack's pick (petition I27)", () => {
  it("hands the layer the interaction stack's exact pick — the same door a press's `TouchesExact` is written through", () => {
    const engine = createCanvasEngine();
    const container = document.createElement("div");
    document.body.appendChild(container);
    let seen: LayerContext | undefined;
    const layer = (ctx: LayerContext): LayerHandle => {
      seen = ctx;
      return { reflector: { name: "fake-desk", always: true, flush() {}, available: () => true }, dispose() {} };
    };
    const mount = createDeskHost({ container, engine, layer });
    expect(seen?.pickAt).toBe(engine.stack.pickAt);
    expect(seen?.pickAt(40, 40)).toBeUndefined();   // an empty desk: the bare canvas
    mount.dispose();
    engine.dispose();
    container.remove();
  });
});

describe("createDeskHost · the device's ratio (ICE M21 K1)", () => {
  it("a ratio change with no resize re-syncs the viewport before the next step — the desk draws at the new ratio", () => {
    const frames: FrameRequestCallback[] = [];
    const raf = globalThis.requestAnimationFrame;
    const caf = globalThis.cancelAnimationFrame;
    const had = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
    globalThis.requestAnimationFrame = (cb) => frames.push(cb);
    globalThis.cancelAnimationFrame = () => {};
    const setRatio = (r: number): void => { Object.defineProperty(window, "devicePixelRatio", { value: r, configurable: true }); };
    try {
      setRatio(2);
      const engine = createCanvasEngine();
      const container = document.createElement("div");
      document.body.appendChild(container);
      const layer = (): LayerHandle => ({ reflector: { name: "fake-desk", always: true, flush() {}, available: () => true }, dispose() {} });
      const mount = createDeskHost({ container, engine, layer });
      expect(engine.world.getResource(Viewport)?.dpr).toBe(2);
      frames.shift()?.(16);
      setRatio(1); // another display, the browser's zoom, an emulated ratio: nothing resizes
      expect(engine.world.getResource(Viewport)?.dpr).toBe(2);
      frames.shift()?.(32);
      expect(engine.world.getResource(Viewport)?.dpr).toBe(1);
      mount.dispose();
      engine.dispose();
      container.remove();
    } finally {
      globalThis.requestAnimationFrame = raf;
      globalThis.cancelAnimationFrame = caf;
      if (had !== undefined) Object.defineProperty(window, "devicePixelRatio", had);
      else Reflect.deleteProperty(window, "devicePixelRatio");
    }
  });
});

/** Dispatch a synthetic DOM event with assigned props (happy-dom has no PointerEvent ctor). */
function fire(target: EventTarget, type: string, props: Record<string, unknown>): void {
  const ev = new Event(type, { cancelable: true, bubbles: true });
  Object.assign(ev, props);
  target.dispatchEvent(ev);
}

describe("createDeskHost · the container's LAYOUT size (petition I39)", () => {
  it("a container drawn under `transform: scale(0.98)` — its rendered box 1156.4 × 733.04, its layout 1180 × 748 — writes the LAYOUT size to the viewport, and a pointer at the scaled box's far corner maps to (1180, 748)", () => {
    const engine = createCanvasEngine();
    const container = document.createElement("div");
    document.body.appendChild(container);
    // the layout box no transform changes, and the box an ancestor's `scale(0.98)` draws it in (about its centre, the page at 20, 30)
    Object.defineProperty(container, "clientWidth", { value: 1180, configurable: true });
    Object.defineProperty(container, "clientHeight", { value: 748, configurable: true });
    const S = 0.98;
    const r = { left: 20 + (1180 * (1 - S)) / 2, top: 30 + (748 * (1 - S)) / 2, width: 1180 * S, height: 748 * S };
    container.getBoundingClientRect = () => ({ ...r, x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height, toJSON: () => ({}) }) as DOMRect;
    const layer = (): LayerHandle => ({ reflector: { name: "fake-desk", always: true, flush() {}, available: () => true }, dispose() {} });
    const mount = createDeskHost({ container, engine, layer });
    try {
      const vp = engine.world.getResource(Viewport);
      expect([vp?.w, vp?.h]).toEqual([1180, 748]);
      // the pointer, through the host's own adapter: the scaled box's far corner, its top-left and its centre — the layout's
      engine.stack.queue.drain();
      fire(container, "pointermove", { pointerType: "mouse", pointerId: 1, clientX: r.left + r.width, clientY: r.top + r.height, buttons: 0 });
      fire(container, "pointerdown", { pointerType: "mouse", pointerId: 1, clientX: r.left, clientY: r.top, buttons: 1 });
      fire(container, "pointerup", { pointerType: "mouse", pointerId: 1, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, buttons: 0 });
      const at = engine.stack.queue.drain().map((e) => [e.kind, (e as { screenX?: number }).screenX, (e as { screenY?: number }).screenY] as const);
      expect(at.map((q) => q[0])).toEqual(["move", "down", "up"]);
      const [far, near, mid] = at;
      expect(far?.[1]).toBeCloseTo(1180, 9);
      expect(far?.[2]).toBeCloseTo(748, 9);
      expect([near?.[1], near?.[2]]).toEqual([0, 0]);
      expect(mid?.[1]).toBeCloseTo(590, 9);
      expect(mid?.[2]).toBeCloseTo(374, 9);
    } finally {
      mount.dispose();
      engine.dispose();
      container.remove();
    }
  });
});

describe("createDeskHost · the room's other people (petition I26)", () => {
  /** Two peers' hands in the world as core's presence derives them: a `CursorVisual "remote"` at a world point, `Follows` → the peer. */
  function twoPeers(world: World): void {
    for (const [name, color, x, y] of [["Ada", "#e5484d", 100, 50], ["Bo", "#8e4ec6", 300, 200]] as const) {
      const peer = world.spawn({ components: [[PresenceInfo, { name, color }]], tags: [PresencePeer] });
      const hand = world.spawn({ components: [[Position, { x, y }], [CursorVisual, { kind: "remote", pressed: false }]] });
      world.setRelation(hand, Follows, peer);
    }
  }

  /** The host over that world, the layer's handle saying `cursors` (or nothing), one frame stepped: what the container showed, the reflectors, whether the world armed, and what the dispose left. */
  function mountRoom(cursors: boolean | undefined): { children: number; names: string[]; reflectors: readonly string[]; armed: boolean; left: number } {
    const raf = globalThis.requestAnimationFrame;
    const caf = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = () => 0;   // the frame is the test's to step
    globalThis.cancelAnimationFrame = () => {};
    try {
      const engine = createCanvasEngine();
      twoPeers(engine.world);
      const container = document.createElement("div");
      document.body.appendChild(container);
      const layer = (): LayerHandle => ({ reflector: { name: "fake-desk", always: true, flush() {}, available: () => true }, dispose() {}, ...(cursors !== undefined ? { cursors } : {}) });
      const mount = createDeskHost({ container, engine, layer });
      engine.step(16);
      // a cursor's name is its chip's text: the leaf divs with any
      const names = Array.from(container.querySelectorAll("div")).filter((d) => d.children.length === 0 && d.textContent !== "").map((d) => d.textContent ?? "");
      const shown = { children: container.children.length, names: names.sort(), reflectors: engine.engine.reflectorNames(), armed: engine.world.isReactiveEnabled };
      mount.dispose();
      const left = container.children.length;
      engine.dispose();
      container.remove();
      return { ...shown, left };
    } finally {
      globalThis.requestAnimationFrame = raf;
      globalThis.cancelAnimationFrame = caf;
    }
  }

  it("`cursors: false` — its host draws the peers itself: no plane, no reflector, nothing of two peers' hands; the OS cursor's reflector stands, and the host arms nothing", () => {
    const off = mountRoom(false);
    expect(off.reflectors).not.toContain("remoteCursors");
    expect(off.reflectors).toContain("cursor");
    expect(off.children).toBe(0);
    expect(off.names).toEqual([]);
    expect(off.armed).toBe(false);   // the host registered no observer: the world arms at the host's own first
  });

  it("absent or `true` — the host mounts them as ever: the plane over the desk, each peer's hand under its name, the world armed, gone at the dispose", () => {
    for (const cursors of [undefined, true]) {
      const on = mountRoom(cursors);
      expect(on.reflectors, String(cursors)).toContain("remoteCursors");
      expect(on.children, String(cursors)).toBe(1);
      expect(on.names, String(cursors)).toEqual(["Ada", "Bo"]);
      expect(on.armed, String(cursors)).toBe(true);
      expect(on.left, String(cursors)).toBe(0);
    }
  });
});
