// @vitest-environment node
/**
 * IslandRender — the composited-next leg's island half (design-013 §8 B5).
 *
 * The rig is high-fidelity where it matters: a REAL world + engine with the
 * REAL surface infra installed (Band · Demand · Residency), so the handles this
 * renders into are the ones core's Residency actually wrote, at the size it
 * actually chose; a REAL three `RenderTarget` per handle; and the REAL bridge,
 * with its zero-render→ECS-writes trap armed for every flush. What is faked is
 * the GPU (a stand-in backend that allocates a `GPUTexture` the first time a
 * target is rendered into — three's own lazy behaviour) and the ground's
 * `ContentResidency`, which `@ice/r3f` may not import: the stand-in below
 * implements the same `ContentSink` contract over the same texture table, and
 * the compile-time check that the real one satisfies it happens where an app
 * wires `groundCompose(…)` into `<InfiniteCanvas>`.
 *
 * The load-bearing test in this file is "the pin-blind-resize class". Both
 * pools once disposed a PINNED target on a size change while a retained
 * crossfade clone sampled it. There is no pin here to be blind to: a target is
 * keyed by the HANDLE the world names, so a resize MINTS one and the old one
 * dies only when the table has forgotten it. The test drags a `Retained` island
 * through 30 sizes and checks that invariant every frame.
 */
import {
  Active,
  Camera,
  createEngine,
  createLayerAllocator,
  createTextureTable,
  Culled,
  installSurfaceInfra,
  NO_TEXTURE,
  Position,
  RequestedDemand,
  Retained,
  Size,
  SurfaceBand,
  SurfaceDemand,
  SurfaceKind,
  SurfaceTarget,
  TextureRef,
  Viewport,
  Visible,
  type Entity,
  type TextureHandle,
  type TextureTable,
} from "@ice/core";
import type { ContentSink, SurfaceContent, TextureDescription } from "@ice/react";
import { createWorld, type World } from "@vibecook/strata-ecs";
import type { OrthographicCamera, RenderTarget, Scene } from "three";
import { describe, expect, it } from "vitest";
import { createGLBridge, type GLBridge } from "../src/bridge";
import { createIslandRender, type IslandRender } from "../src/island-render";
import { createIslandTarget } from "../src/island-target";
import type { BackendTextureRecord } from "../src/webgpu-backend";

/**
 * A stand-in WebGPU backend. Allocates a record the first time a target is
 * RENDERED into — not when it is created — because that is three's actual
 * behaviour and the reason this module reads the texture back AFTER the render
 * rather than at target creation.
 */
function fakeBackend(srgb = true) {
  const records = new Map<object, BackendTextureRecord>();
  let n = 0;
  return {
    srgb,
    renderer: {
      backend: {
        device: { label: "app-owned" } as unknown as GPUDevice,
        get: (o: object) => records.get(o),
      },
    },
    allocate(texture: object): void {
      records.set(texture, {
        texture: { label: `gpu:${n++}`, format: srgb ? "rgba8unorm-srgb" : "rgba8unorm" } as unknown as GPUTexture,
        msaaTexture: { label: "msaa" } as unknown as GPUTexture,
        textureDescriptorGPU: { format: srgb ? "rgba8unorm-srgb" : "rgba8unorm" } as GPUTextureDescriptor,
      });
    },
    textureOf: (texture: object): GPUTexture | undefined => records.get(texture)?.texture,
  };
}

interface FakeResidency extends ContentSink {
  /** What the host does after the frame's submit: drain the table, fire `onForget`. */
  collect(): TextureHandle[];
  readonly realizeCalls: { handle: TextureHandle; owned: boolean }[];
}

/**
 * The ground's `ContentResidency`, restated against the same table. Only the
 * `ContentSink` half exists here — that is exactly the half a render uses.
 */
function fakeResidency(table: TextureTable, world: World): FakeResidency {
  const realised = new Map<TextureHandle, GPUTexture>();
  const written = new Map<Entity, string>();
  const forgetters = new Set<(h: TextureHandle) => void>();
  const realizeCalls: { handle: TextureHandle; owned: boolean }[] = [];
  const keyOf = (e: Entity): string => {
    const r = world.get(e, TextureRef);
    return r === undefined ? "" : `${r.texture}|${r.layer}|${r.u0}|${r.v0}|${r.u1}|${r.v1}`;
  };
  return {
    table,
    realizeCalls,
    realize(handle, texture, opts) {
      realizeCalls.push({ handle, owned: opts?.owned ?? true });
      if (!table.realize(handle, texture)) return false;
      realised.set(handle, texture);
      return true;
    },
    textureOf: (handle) => realised.get(handle),
    wrote(e) {
      const r = world.get(e, TextureRef);
      if (r === undefined || r.texture === NO_TEXTURE) return false;
      written.set(e, keyOf(e));
      return true;
    },
    isWritten(e) {
      const r = world.get(e, TextureRef);
      return r !== undefined && r.texture !== NO_TEXTURE && written.get(e) === keyOf(e);
    },
    onForget(cb) {
      forgetters.add(cb);
      return () => {
        forgetters.delete(cb);
      };
    },
    collect() {
      const drained = table.drain();
      for (const h of drained) {
        realised.delete(h);
        for (const cb of forgetters) cb(h);
      }
      for (const [e, key] of written) if (keyOf(e) !== key) written.delete(e);
      return drained;
    },
  };
}

interface CardOpts {
  w?: number;
  h?: number;
  kind?: "dom" | "gl";
  paused?: boolean;
  fpsBucket?: number;
}

interface Rig {
  world: World;
  bridge: GLBridge;
  table: TextureTable;
  sink: FakeResidency;
  render: IslandRender;
  backend: ReturnType<typeof fakeBackend>;
  /** Every render call, with the target that was bound. */
  renders: { scene: object; target: RenderTarget | null }[];
  clock: { ms: number };
  card(o?: CardOpts): Entity;
  mount(e: Entity): () => void;
  step(n?: number): void;
  /** One roster tick: the render's slot, then the host's post-submit collect. */
  frame(): void;
  handleOf(e: Entity): TextureHandle;
  destroy(): void;
}

function rig(backendSrgb = true): Rig {
  const world: World = createWorld();
  const engine = createEngine(world);
  // A reflector arms reactivity — without one nothing journals and the churn
  // guard is fed an empty world (design-002 §4).
  engine.registerReflector({ name: "armed", observe: { resources: [Camera] }, flush: () => {} });
  const table = createTextureTable({ pageSize: 512 });
  installSurfaceInfra(engine, {
    residency: { table, allocator: createLayerAllocator({ layerSize: 512, maxLayers: 8 }), budgetBytes: 64 * 1024 * 1024 },
  });
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  world.setResource(Viewport, { w: 800, h: 600, dpr: 2 });

  // The trap is ARMED: a reflector that writes the world fails these tests.
  const bridge = createGLBridge(engine, { devAssertRenderWrites: true });
  const backend = fakeBackend(backendSrgb);
  const sink = fakeResidency(table, world);
  const renders: { scene: object; target: RenderTarget | null }[] = [];
  let bound: RenderTarget | null = null;
  const content: SurfaceContent = {
    residency: sink,
    renders: { dom: { current: null }, island: { current: null }, video: { current: null } },
  };
  const clock = { ms: 0 };
  const render = createIslandRender({
    gl: {
      setRenderTarget(t) {
        bound = t as RenderTarget | null;
      },
      clear() {},
      render(scene) {
        renders.push({ scene, target: bound });
        // three allocates the backing GPUTexture on first render into a target.
        if (bound !== null && backend.textureOf(bound.texture) === undefined) backend.allocate(bound.texture);
      },
    },
    renderer: () => backend.renderer as never,
    bridge,
    world,
    content,
    now: () => clock.ms,
  });

  let t = 0;
  return {
    world,
    bridge,
    table,
    sink,
    render,
    backend,
    renders,
    clock,
    card(o: CardOpts = {}) {
      return world.spawn({
        components: [
          [Position, { x: 0, y: 0 }],
          [Size, { w: o.w ?? 40, h: o.h ?? 40 }],
          [SurfaceKind, { kind: o.kind ?? "gl" }],
          [SurfaceTarget, { target: "gpu" }],
          [SurfaceBand, { band: 0 }],
          [TextureRef, { texture: 0, layer: 0, u0: 0, v0: 0, u1: 0, v1: 0 }],
          [RequestedDemand, { mode: o.paused === true ? "paused" : "live", fpsBucket: o.fpsBucket ?? 60, interactive: false }],
          [SurfaceDemand, { mode: "live", fpsBucket: 60, interactive: false }],
        ],
        tags: [Visible, Active],
      });
    },
    mount(e) {
      return bridge.registerIsland(e, {
        scene: { children: [], name: `scene:${e}` } as unknown as Scene,
        camera: { updateProjectionMatrix() {} } as unknown as OrthographicCamera,
      });
    },
    step(n = 1) {
      for (let i = 0; i < n; i++) {
        t += 16;
        clock.ms += 16;
        engine.step(t);
      }
    },
    frame() {
      content.renders.island.current?.flush(world);
      sink.collect();
    },
    handleOf: (e) => world.get(e, TextureRef)?.texture ?? NO_TEXTURE,
    destroy() {
      render.dispose();
      bridge.uninstall();
    },
  };
}

describe("an island renders into the target Residency named", () => {
  it("installs itself in the roster's island slot and renders once, at the table's size, as a producer's object", () => {
    const r = rig();
    const e = r.card({ w: 40, h: 40 });
    r.mount(e);
    r.step(2);

    const handle = r.handleOf(e);
    expect(handle).not.toBe(NO_TEXTURE);
    const entry = r.table.describe(handle) as TextureDescription;
    expect(entry.kind).toBe("own");
    // dpr 2, band 1: the destination is the raster, and the target is the destination.
    expect([entry.width, entry.height]).toEqual([80, 80]);

    r.frame();
    expect(r.render.stats().rendered).toBe(1);
    expect(r.renders).toHaveLength(1);
    const target = r.render.targetOf(handle);
    if (target === undefined) throw new Error("no target");
    expect(r.renders[0]?.target).toBe(target);
    expect([target.width, target.height]).toEqual([entry.width, entry.height]);
    // Realised as the PRODUCER's object: the residency forgets it, this module destroys it.
    expect(r.sink.realizeCalls).toEqual([{ handle, owned: false }]);
    expect(r.sink.textureOf(handle)).toBe(r.backend.textureOf(target.texture));
    expect(r.sink.isWritten(e)).toBe(true);
    r.destroy();
  });

  it("realises whatever the backend resolved — the sRGB variant is the residency's read of the ANSWER, never this module's request", () => {
    for (const srgb of [true, false]) {
      const r = rig(srgb);
      const e = r.card();
      r.mount(e);
      r.step(2);
      r.frame();
      const handle = r.handleOf(e);
      const target = r.render.targetOf(handle);
      if (target === undefined) throw new Error("no target");
      // The REQUEST is the recipe's, shared with the old leg's pool.
      expect(target.texture.colorSpace).toBe("srgb");
      expect(target.samples).toBe(4);
      // The ANSWER is the format the backend gave back, and it is what was realised.
      const realised = r.sink.textureOf(handle) as unknown as { format: string };
      expect(realised.format.endsWith("-srgb")).toBe(srgb);
      r.destroy();
    }
  });

  it("renders nothing on a second tick with no dirt — a still island is idle-zero", () => {
    const r = rig();
    const e = r.card();
    r.mount(e);
    r.step(2);
    r.frame();
    expect(r.render.stats().rendered).toBe(1);

    for (let i = 0; i < 10; i++) {
      r.step();
      r.frame();
    }
    expect(r.render.stats().rendered).toBe(1);
    expect(r.render.stats().targets).toBe(1);
    r.destroy();
  });

  it("renders again when the island's own content goes dirty (the paint generation)", () => {
    const r = rig();
    const e = r.card();
    r.mount(e);
    r.step(2);
    r.frame();
    r.bridge.bumpPaint(e);
    r.step();
    r.frame();
    expect(r.render.stats().rendered).toBe(2);
    // The same handle, so the same target — a repaint is not a reallocation.
    expect(r.render.stats().targets).toBe(1);
    r.destroy();
  });
});

describe("the demand clamp the old pass never read (design-013 D10)", () => {
  it("renders nothing for a paused card, however dirty it is", () => {
    const r = rig();
    const e = r.card({ paused: true });
    r.mount(e);
    r.step(3);
    expect(r.world.get(e, SurfaceDemand)?.mode).toBe("paused");

    for (let i = 0; i < 5; i++) {
      r.bridge.bumpPaint(e);
      r.step();
      r.frame();
    }
    expect(r.render.stats().rendered).toBe(0);
    expect(r.render.stats().skippedPaused).toBeGreaterThanOrEqual(5);
    r.destroy();
  });

  it("holds an animating card to its bucket — 15 fps is one render per ~66 ms, not one per frame", () => {
    const r = rig();
    const e = r.card({ fpsBucket: 15 });
    r.mount(e);
    // A live frame callback is the animation signal: the island turns Hot.
    r.bridge.addFrameCallback(e, () => {});
    r.step(3);
    expect(r.world.get(e, SurfaceDemand)?.fpsBucket).toBe(15);

    // 60 ticks at 16 ms = 960 ms. At 15 fps that is ~15 renders, not 60.
    for (let i = 0; i < 60; i++) {
      r.step();
      r.frame();
    }
    const s = r.render.stats();
    expect(s.rendered).toBeGreaterThanOrEqual(12);
    expect(s.rendered).toBeLessThanOrEqual(18);
    expect(s.skippedBudget).toBeGreaterThan(30);
    r.destroy();
  });

  it("a 60-bucket island on a 16 ms grid keeps every frame (the bucket is a ceiling, not a decimator)", () => {
    const r = rig();
    const e = r.card({ fpsBucket: 60 });
    r.mount(e);
    r.bridge.addFrameCallback(e, () => {});
    r.step(3);
    for (let i = 0; i < 20; i++) {
      r.step();
      r.frame();
    }
    expect(r.render.stats().rendered).toBe(20);
    expect(r.render.stats().skippedBudget).toBe(0);
    r.destroy();
  });

  it("delivers the animation time OWED, so a clamped bucket changes cadence and never speed", () => {
    const r = rig();
    const e = r.card({ fpsBucket: 15 });
    r.mount(e);
    let total = 0;
    r.bridge.addFrameCallback(e, (dt) => {
      total += dt;
    });
    r.step(3);
    for (let i = 0; i < 60; i++) {
      r.step();
      r.frame();
    }
    // 60 ticks × 16 ms of wall time, banked across ~15 renders.
    expect(total).toBeGreaterThan(60 * 16 * 0.9);
    r.destroy();
  });
});

describe("a fresh destination", () => {
  it("is Waking again with no content dirt at all, so a re-minted handle is rendered into", () => {
    // The camera crosses a zoom band WHILE GESTURING: Residency keys its destination by
    // (entity, band), so a new band is a new handle — and the gesture is what makes this
    // isolating, because `bandStale` is suppressed in motion and the paint generation
    // never moves. What is left is the phase machine alone: `hasFbo` asked of the CURRENT
    // handle finds no target, so the island is Waking again.
    const r = rig();
    const e = r.card();
    r.mount(e);
    r.step(2);
    r.frame();
    const first = r.handleOf(e);
    expect(r.render.stats().rendered).toBe(1);
    const gen = r.bridge.state.get(e)?.paintGeneration;

    r.world.setResource(Camera, { x: 0, y: 0, zoom: 0.25, gesturing: true });
    r.step(3);
    r.frame();

    const second = r.handleOf(e);
    expect(second, "Residency minted a new destination").not.toBe(first);
    expect(r.bridge.state.get(e)?.paintGeneration, "and no content dirt was raised").toBe(gen);
    expect(r.render.stats().rendered).toBe(2);
    expect(r.sink.isWritten(e), "the new destination is written, so the card stops drawing the plate").toBe(true);
    r.destroy();
  });

  it("outranks the demand clamp: a 15 fps island that resizes renders NOW, not one interval later", () => {
    const r = rig();
    const e = r.card({ fpsBucket: 15 });
    r.mount(e);
    r.bridge.addFrameCallback(e, () => {});
    r.step(3);
    r.frame();
    const before = r.render.stats();
    expect(before.rendered).toBeGreaterThan(0);

    // One tick later — far inside the 66 ms bucket the clamp would otherwise hold.
    r.world.edit(e).set(Size, { w: 96, h: 96 });
    r.step();
    r.frame();
    const handle = r.handleOf(e);
    expect(r.render.stats().rendered).toBe(before.rendered + 1);
    expect(r.render.stats().skippedBudget).toBe(before.skippedBudget);
    expect(r.render.targetOf(handle)).toBeDefined();
    expect(r.sink.isWritten(e)).toBe(true);
    r.destroy();
  });
});

describe("the pin-blind-resize class, dissolved", () => {
  /**
   * The old shape of this bug: a pool keyed targets by ENTITY, a resize
   * replaced the entry in place, and a retained crossfade clone went on
   * sampling the texture that replaced it. The pools grew a pin refcount and a
   * graveyard to survive it.
   *
   * Here there is nothing to pin. Residency mints a NEW handle for a new size,
   * so the frame samples the ref it just wrote; the previous handle drains, and
   * its target is disposed at the `onForget` the host fires AFTER the submit.
   * `Retained` is checked in the same walk because that tag is precisely what
   * used to make the pin necessary — and it changes nothing here.
   */
  it("a 30-frame resize drag on a Retained island leaves ONE live target, and disposes only what the table forgot", () => {
    const r = rig();
    const e = r.card({ w: 40, h: 40 });
    r.world.addTag(e, Retained);
    r.mount(e);
    r.step(2);
    r.frame();

    const seen = new Set<TextureHandle>();
    seen.add(r.handleOf(e));
    for (let f = 0; f < 30; f++) {
      r.world.edit(e).set(Size, { w: 40 + f, h: 40 });
      r.step();
      const handle = r.handleOf(e);
      seen.add(handle);

      const before = r.render.stats().disposed;
      r.render.reflector.flush(r.world);
      // Mid-frame the OUTGOING target is still alive — that is the whole point of
      // collecting after the submit, and it is the growth bound: at most the one the
      // ref named last frame and the one it names now, never a graveyard.
      expect(r.render.stats().targets).toBeLessThanOrEqual(2);
      expect(r.render.stats().disposed).toBe(before); // nothing dies before the submit
      // What the ground samples is the CURRENT ref's target, always a live one.
      const target = r.render.targetOf(handle);
      if (target === undefined) throw new Error(`no target for handle ${handle} at frame ${f}`);
      expect(r.sink.textureOf(handle)).toBe(r.backend.textureOf(target.texture));
      expect(r.sink.isWritten(e)).toBe(true);

      // The host's post-submit collect: NOW the drained handle's target dies, and the
      // frame ends where every frame ends — at one target for one island.
      const drained = r.sink.collect();
      expect(r.render.stats().disposed).toBe(before + drained.length);
      expect(r.render.stats().targets).toBe(1);
    }

    expect(seen.size, "a resize drag really did re-mint handles").toBeGreaterThan(5);
    expect(r.render.stats().targets).toBe(1);
    expect(r.render.stats().disposed).toBe(seen.size - 1);
    r.destroy();
  });

  it("untagged and culled, the handle survives and so does its target (retention ≠ cull)", () => {
    const r = rig();
    const e = r.card();
    const unmount = r.mount(e);
    r.step(2);
    r.frame();
    const handle = r.handleOf(e);
    expect(r.render.stats().targets).toBe(1);

    // Cull: GLViews unmounts the island component; the world says Culled.
    unmount();
    r.world.removeTag(e, Visible);
    r.world.addTag(e, Culled);
    r.step(2);
    r.frame();

    expect(r.handleOf(e), "Residency keeps a culled card's destination").toBe(handle);
    expect(r.render.targetOf(handle), "and the target it names").toBeDefined();
    expect(r.render.stats().rendered, "but nothing renders into it").toBe(1);
    r.destroy();
  });

  it("a despawned island's target dies through the table's drain, at the collect after the frame", () => {
    const r = rig();
    const e = r.card();
    r.mount(e);
    r.step(2);
    r.frame();
    const handle = r.handleOf(e);
    expect(r.render.targetOf(handle)).toBeDefined();

    r.world.destroy(e);
    r.step(2);
    expect(r.render.stats().disposed).toBe(0); // the step alone destroys nothing
    r.frame();
    expect(r.render.targetOf(handle)).toBeUndefined();
    expect(r.render.stats()).toMatchObject({ targets: 0, disposed: 1 });
    r.destroy();
  });
});

describe("the slot and the walls", () => {
  it("takes the roster's island slot at construction and gives it back at dispose, with every target", () => {
    const r = rig();
    const e = r.card();
    r.mount(e);
    r.step(2);
    r.frame();
    expect(r.render.reflector.name).toBe("island-render");
    expect(r.render.stats().targets).toBe(1);
    r.render.dispose();
    expect(r.render.stats()).toMatchObject({ targets: 0, disposed: 1 });
    r.bridge.uninstall();
  });

  it("ignores a card whose destination is not a private texture (a page slot is DomRender's)", () => {
    const r = rig();
    const e = r.card({ kind: "dom" });
    r.mount(e);
    r.step(2);
    const handle = r.handleOf(e);
    expect(r.table.describe(handle)?.kind).toBe("pages");
    r.frame();
    expect(r.render.stats().rendered).toBe(0);
    expect(r.render.stats().targets).toBe(0);
    r.destroy();
  });
});

describe("the target recipe, shared with the old leg", () => {
  it("is 4× MSAA with a depth buffer and an sRGB request", () => {
    const rt = createIslandTarget(64, 32, "ice:island:test");
    expect([rt.width, rt.height]).toEqual([64, 32]);
    expect(rt.samples).toBe(4);
    expect(rt.depthBuffer).toBe(true);
    expect(rt.stencilBuffer).toBe(false);
    expect(rt.texture.colorSpace).toBe("srgb");
    expect(rt.texture.name).toBe("ice:island:test");
    rt.dispose();
  });
});
