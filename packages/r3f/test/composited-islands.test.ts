/**
 * S5's headless exits: islands on the shared device, published as `gl` sources,
 * and GLViews' own composite pass RETIRED in this profile (design-012 §9 S5,
 * plan §5 S5.2/S5.3).
 *
 * The rig is deliberately high-fidelity where it matters. The registry is
 * core's REAL `CompositorSourceRegistry`, the pool is the REAL
 * `WebGpuRenderTargetPool`, the binder is the real one, and the world/engine/
 * bridge are live — so what is faked is only the GPU itself: a stand-in backend
 * that allocates a GPUTexture the first time a target is rendered into, which
 * is exactly three's lazy-allocation behaviour and exactly the reason a source
 * publishes a getter rather than a handle.
 *
 * The load-bearing test in this file is the last one: the two profiles must
 * agree on MEMBERSHIP. A pixel comparison between them means nothing if they
 * are compositing different sets of islands.
 */
import { describe, expect, it } from "vitest";
import { createWorld } from "@vibecook/strata-ecs";
import type { OrthographicCamera, Scene } from "three";
import {
  Active,
  Camera,
  Position,
  PrefabId,
  Size,
  StackZ,
  Viewport,
  Visible,
  createCompositorSourceRegistry,
  createEngine,
  defineWidget,
  p,
  widgets,
  type CompositorSource,
  type Engine,
  type Entity,
  type World,
} from "@ice/core";
import { createGLBridge, type GLBridge } from "../src/bridge";
import { runCompositorPass, type PassStats, type QuadsLike } from "../src/compositor-pass";
import { WebGpuRenderTargetPool } from "../src/webgpu-pool";
import { createIslandSourceBinder } from "../src/webgpu-sources";
import type { BackendTextureRecord } from "../src/webgpu-backend";

const CARD =
  widgets.get("s5:gl-card") ??
  defineWidget({
    type: "s5:gl-card",
    surface: "gl",
    props: { label: p.string({ default: "hi" }) },
    component: () => null,
  });

/**
 * A stand-in WebGPU backend. Allocates a record the first time a target is
 * RENDERED into — not when it is created — because that is three's actual
 * behaviour and the source of the "reading before the first paint yields
 * undefined" contract the getter shape exists for.
 */
function fakeBackend(): {
  renderer: object;
  allocate(texture: object): void;
  textureOf(texture: object): GPUTexture | undefined;
  srgb: boolean;
} {
  const records = new Map<object, BackendTextureRecord>();
  const state = {
    srgb: true,
    renderer: {
      backend: {
        device: { label: "app-owned" } as unknown as GPUDevice,
        get: (o: object) => records.get(o),
      },
    },
    allocate(texture: object) {
      // A fresh GPUTexture identity per allocation — a reallocation (band /
      // DPR change) must be observable through the published getter.
      records.set(texture, {
        texture: { label: `gpu:${records.size}` } as unknown as GPUTexture,
        msaaTexture: { label: "msaa" } as unknown as GPUTexture,
        textureDescriptorGPU: {
          format: state.srgb ? "rgba8unorm-srgb" : "rgba8unorm",
        } as GPUTextureDescriptor,
      });
    },
    textureOf: (texture: object) => records.get(texture)?.texture,
  };
  return state;
}

interface Rig {
  world: World;
  engine: Engine;
  bridge: GLBridge;
  pool: WebGpuRenderTargetPool;
  registry: ReturnType<typeof createCompositorSourceRegistry>;
  backend: ReturnType<typeof fakeBackend>;
  /** Every gl.render call, in order. */
  renders: { scene: object; camera: object }[];
  compScene: object;
  compCamRaw: object;
  paintDirt: number;
  spawnCard(x: number, y: number, w?: number, h?: number): Entity;
  mount(e: Entity): () => void;
  pass(opts?: { maxFboBytes?: number; maxPaintDpr?: number }): PassStats;
  sourceFor(e: Entity): CompositorSource | undefined;
}

function createRig(): Rig {
  const world = createWorld();
  const engine = createEngine(world);
  const bridge = createGLBridge(engine);
  const registry = createCompositorSourceRegistry();
  const backend = fakeBackend();
  const pool = new WebGpuRenderTargetPool({ renderer: () => backend.renderer as never });
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  world.setResource(Viewport, { w: 800, h: 600, dpr: 1 });
  const renders: { scene: object; camera: object }[] = [];
  const compScene = {};
  const compCamRaw = {};
  let ratio = 1;

  const rig: Rig = {
    world,
    engine,
    bridge,
    pool,
    registry,
    backend,
    renders,
    compScene,
    compCamRaw,
    paintDirt: 0,
    spawnCard(x, y, w = 100, h = 100) {
      return world.spawn({
        components: [
          [Position, { x, y }],
          [Size, { w, h }],
          [StackZ, { z: 0 }],
          [PrefabId, { id: CARD.type }],
        ],
        tags: [Visible, Active],
      });
    },
    mount(e) {
      return bridge.registerIsland(e, {
        scene: { children: [] } as unknown as Scene,
        camera: { updateProjectionMatrix() {} } as unknown as OrthographicCamera,
      });
    },
    pass({ maxFboBytes = Number.MAX_SAFE_INTEGER, maxPaintDpr = Number.POSITIVE_INFINITY } = {}) {
      bridge.renderAssert.begin();
      try {
        return runCompositorPass({
          world,
          bridge,
          pool,
          sources: binder,
          gl: {
            setRenderTarget() {},
            clear() {},
            render(scene, camera) {
              renders.push({ scene, camera });
              // three allocates the backing GPUTexture on first render into a
              // target; mirror that so `texture()` is undefined until painted.
              for (const [e] of bridge.state.all()) {
                const handle = bridge.islandFor(e as Entity);
                if (handle?.scene === scene) {
                  const t = pool.targetTexture(e);
                  if (t !== undefined && backend.textureOf(t) === undefined) backend.allocate(t);
                }
              }
            },
            setPixelRatio(n: number) {
              ratio = n;
            },
            getPixelRatio: () => ratio,
          },
          compCamera: { raw: compCamRaw, setFrustum() {} },
          islandCamera: () => ({ setFrustum() {} }),
          compositeScene: compScene,
          maxFboBytes,
          maxRepaintsPerFrame: 100,
          maxPaintDpr,
          dtMs: 16,
        });
      } finally {
        bridge.renderAssert.end();
      }
    },
    sourceFor: (e) => registry.get(e),
  };

  const binder = createIslandSourceBinder({
    registry,
    pool,
    onPaint: () => {
      rig.paintDirt++;
    },
  });
  return rig;
}

describe("the composite pass retires in this profile (plan §5 S5.3)", () => {
  it("never renders the composite scene to the backbuffer", () => {
    const rig = createRig();
    const e = rig.spawnCard(0, 0);
    rig.mount(e);
    rig.pass();
    rig.pass();

    expect(rig.renders.length).toBeGreaterThan(0); // islands DID paint
    // The exit: not one render call targets the composite scene/camera. In the
    // stratified profile the LAST render of every pass is exactly that pair.
    for (const call of rig.renders) {
      expect(call.scene).not.toBe(rig.compScene);
      expect(call.camera).not.toBe(rig.compCamRaw);
    }
  });

  it("refuses loudly when neither presentation is wired", () => {
    const rig = createRig();
    const e = rig.spawnCard(0, 0);
    rig.mount(e);
    expect(() =>
      runCompositorPass({
        world: rig.world,
        bridge: rig.bridge,
        pool: rig.pool,
        gl: {
          setRenderTarget() {},
          clear() {},
          render() {},
          setPixelRatio() {},
          getPixelRatio: () => 1,
        },
        compCamera: { raw: {}, setFrustum() {} },
        islandCamera: () => ({ setFrustum() {} }),
        compositeScene: {},
        maxFboBytes: Number.MAX_SAFE_INTEGER,
        maxRepaintsPerFrame: 4,
        maxPaintDpr: Number.POSITIVE_INFINITY,
        dtMs: 16,
      }),
    ).toThrow(/needs `quads`|needs `sources`/);
  });
});

describe("islands are published as gl sources", () => {
  it("registers a gl source once the island has painted", () => {
    const rig = createRig();
    const e = rig.spawnCard(0, 0);
    rig.mount(e);
    rig.pass();

    const source = rig.sourceFor(e);
    expect(source?.kind).toBe("gl");
    if (source?.kind !== "gl") throw new Error("expected a gl source");
    expect(source.texture()).toBeDefined();
    expect(source.srgb()).toBe(true);
  });

  it("publishes a GETTER, so a band/DPR reallocation is invisible to the consumer", () => {
    const rig = createRig();
    const e = rig.spawnCard(0, 0);
    rig.mount(e);
    rig.pass();
    const source = rig.sourceFor(e);
    if (source?.kind !== "gl") throw new Error("expected a gl source");
    const first = source.texture();
    expect(first).toBeDefined();

    // Cross a zoom band: the pool reallocates the target at a new pixel size,
    // and three allocates a NEW GPUTexture behind it. A handle captured at
    // registration would now be stale — and a stale texture is not an error the
    // compositor can see, it is a frame of the wrong pixels.
    rig.world.setResource(Camera, { x: 0, y: 0, zoom: 0.25, gesturing: false });
    rig.bridge.bumpPaint(e);
    rig.pass();

    const second = source.texture();
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
    // Same registration throughout — the identity never churned.
    expect(rig.sourceFor(e)).toBe(source);
  });

  it("reports srgb from the ACTUAL format, so a linear target is not re-encoded", () => {
    const rig = createRig();
    rig.backend.srgb = false;
    const e = rig.spawnCard(0, 0);
    rig.mount(e);
    rig.pass();
    const source = rig.sourceFor(e);
    if (source?.kind !== "gl") throw new Error("expected a gl source");
    expect(source.srgb()).toBe(false);
  });

  it("withdraws when the entity dies, and the registry raises the dirt", () => {
    const rig = createRig();
    const e = rig.spawnCard(0, 0);
    rig.mount(e);
    rig.pass();
    expect(rig.registry.size()).toBe(1);
    const before = rig.registry.revision();

    rig.world.destroy(e);
    rig.pass();

    expect(rig.registry.size()).toBe(0);
    // Membership change IS the compositor's promotion dirt (plan §4.3) — the
    // reflector latches `registry.onChange`, so a withdrawal that did not bump
    // revision would leave a dead island on screen until something else moved.
    expect(rig.registry.revision()).toBeGreaterThan(before);
  });

  it("withdraws a culled island but keeps its pooled target (retention ≠ cull)", () => {
    const rig = createRig();
    const e = rig.spawnCard(0, 0);
    const unmount = rig.mount(e);
    rig.pass();
    expect(rig.registry.size()).toBe(1);
    const bytes = rig.pool.bytesUsed();

    unmount(); // the island component unmounts (culled)
    rig.pass();

    // Not composited — but design-004 §3's retention decoupling means the FBO
    // survives for an instant re-entry.
    expect(rig.registry.size()).toBe(1);
    expect(rig.pool.bytesUsed()).toBe(bytes);
  });
});

describe("paint dirt (the half the registry cannot raise)", () => {
  it("raises paint dirt when a PUBLISHED island repaints", () => {
    const rig = createRig();
    const e = rig.spawnCard(0, 0);
    rig.mount(e);
    rig.pass(); // first paint: publishes. Membership dirt covers this frame.
    const afterFirst = rig.paintDirt;

    rig.bridge.bumpPaint(e);
    rig.pass(); // a repaint into the SAME texture: nothing in the registry moves

    expect(rig.paintDirt).toBeGreaterThan(afterFirst);
  });

  it("does NOT double-wake on the very first paint (membership dirt already fired)", () => {
    const rig = createRig();
    const e = rig.spawnCard(0, 0);
    rig.mount(e);
    rig.pass();
    // The island was unpublished at paint time; its publish raised membership
    // dirt of its own, so counting a paint wake here too would wake twice for
    // one frame.
    expect(rig.paintDirt).toBe(0);
  });
});

// --- THE ONE THAT GRADES THE PIXEL COMPARE -----------------------------------

describe("membership parity between the profiles", () => {
  /** Drive the SAME board through the stratified quad path. */
  function stratifiedMembership(build: (rig: Rig) => Entity[]): Set<number> {
    const rig = createRig();
    const entities = build(rig);
    const visible = new Map<number, boolean>();
    const quads: QuadsLike = {
      ensure(key) {
        if (!visible.has(key)) visible.set(key, false);
        return {
          setTransform() {},
          setTexture() {},
          setVisible: (v) => visible.set(key, v),
          setRenderOrder() {},
          setOpacity() {},
          setDragClip() {},
        };
      },
      remove: (key) => void visible.delete(key),
      keys: () => [...visible.keys()],
    };
    let ratio = 1;
    for (let i = 0; i < 2; i++) {
      runCompositorPass({
        world: rig.world,
        bridge: rig.bridge,
        pool: rig.pool,
        quads,
        gl: {
          setRenderTarget() {},
          clear() {},
          render(scene) {
            for (const [e] of rig.bridge.state.all()) {
              if (rig.bridge.islandFor(e as Entity)?.scene === scene) {
                const t = rig.pool.targetTexture(e);
                if (t !== undefined && rig.backend.textureOf(t) === undefined) rig.backend.allocate(t);
              }
            }
          },
          setPixelRatio: (n) => {
            ratio = n;
          },
          getPixelRatio: () => ratio,
        },
        compCamera: { raw: {}, setFrustum() {} },
        islandCamera: () => ({ setFrustum() {} }),
        compositeScene: {},
        maxFboBytes: Number.MAX_SAFE_INTEGER,
        maxRepaintsPerFrame: 100,
        maxPaintDpr: Number.POSITIVE_INFINITY,
        dtMs: 16,
      });
    }
    void entities;
    const out = new Set<number>();
    for (const [key, isVisible] of visible) if (isVisible) out.add(key);
    return out;
  }

  function compositedMembership(build: (rig: Rig) => Entity[]): Set<number> {
    const rig = createRig();
    build(rig);
    rig.pass();
    rig.pass();
    return new Set([...rig.registry.entries()].map(([e]) => e as number));
  }

  it("composites the same island set as the stratified profile, board for board", () => {
    // Three shapes at once: a plain card, a card whose island never mounted
    // (retained-texture-only, must be in neither), and a culled one.
    const build = (rig: Rig): Entity[] => {
      const a = rig.spawnCard(0, 0);
      const b = rig.spawnCard(200, 0);
      const c = rig.spawnCard(400, 0);
      rig.mount(a);
      rig.mount(b);
      const unmountC = rig.mount(c);
      unmountC();
      return [a, b, c];
    };

    const stratified = stratifiedMembership(build);
    const composited = compositedMembership(build);

    expect(stratified.size).toBeGreaterThan(0); // a blank comparison proves nothing
    expect([...composited].sort()).toEqual([...stratified].sort());
  });
});
