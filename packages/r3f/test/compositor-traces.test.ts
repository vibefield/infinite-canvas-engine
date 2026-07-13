/**
 * M7 exit traces (implementation-plan): FBO budget honored under scripted
 * zoom/cull storms; zero render→ECS writes DEV-asserted; plus the design-004
 * §3 rev-2 corrections as regressions — retention decoupled from cull (Warm
 * re-entry from the retained texture), evicted-while-hidden fallback (quad
 * hides until first repaint), band repaints suppressed while gesturing, and
 * two-level invalidation (props dirt repaints ONE island; camera dirt
 * repaints none).
 *
 * Headless: the pass runs against fake pool/quads/gl (the injected surfaces
 * are the GLViews seam) over a REAL world + engine + bridge — Tier-3 props
 * observers, the reflector, and notify() are all live.
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
  createEngine,
  defineWidget,
  p,
  widgets,
  type Engine,
  type Entity,
  type World,
} from "@ice/core";
import { createGLBridge, type GLBridge } from "../src/bridge";
import {
  runCompositorPass,
  type PassStats,
  type PoolLike,
  type QuadsLike,
  type TargetLike,
} from "../src/compositor-pass";

// One widget type per FILE (the defineWidget registry is global; no test reset).
const CARD =
  widgets.get("trace:gl-card") ??
  defineWidget({
    type: "trace:gl-card",
    surface: "gl",
    props: { label: p.string({ default: "hi" }) },
    component: () => null,
  });
const CardProps = (() => {
  const g = CARD.groups[0];
  if (g === undefined) throw new Error("trace widget compiled without a props group");
  return g.component;
})();

// --- fakes over the injected pass surfaces -----------------------------------

interface FakeTarget extends TargetLike {
  readonly key: number;
  readonly bytes: number;
}

function createFakePool(): PoolLike & { acquired: number[]; released: number[] } {
  const entries = new Map<number, { rt: FakeTarget; bytes: number; lastUsedMs: number; pw: number; ph: number }>();
  let clock = 0;
  const acquired: number[] = [];
  const released: number[] = [];
  return {
    acquired,
    released,
    acquire(key, w, h, dpr) {
      clock += 1;
      acquired.push(key);
      const pw = Math.max(1, Math.round(w * dpr));
      const ph = Math.max(1, Math.round(h * dpr));
      const existing = entries.get(key);
      if (existing !== undefined && existing.pw === pw && existing.ph === ph) {
        existing.lastUsedMs = clock;
        return existing.rt;
      }
      const bytes = pw * ph * 4;
      const rt: FakeTarget = { key, bytes, texture: { key } };
      entries.set(key, { rt, bytes, lastUsedMs: clock, pw, ph });
      return rt;
    },
    get: (key) => entries.get(key)?.rt ?? null,
    touch(key) {
      const e = entries.get(key);
      if (e !== undefined) {
        clock += 1;
        e.lastUsedMs = clock;
      }
    },
    release(key) {
      if (entries.delete(key)) released.push(key);
    },
    bytesUsed() {
      let total = 0;
      for (const e of entries.values()) total += e.bytes;
      return total;
    },
    entryInfos() {
      return [...entries.entries()].map(([key, e]) => ({ key, bytes: e.bytes, lastUsedMs: e.lastUsedMs }));
    },
  };
}

function createFakeQuads(): QuadsLike & { visible: Map<number, boolean>; order: Map<number, number> } {
  const visible = new Map<number, boolean>();
  const order = new Map<number, number>();
  return {
    visible,
    order,
    ensure(key) {
      if (!visible.has(key)) visible.set(key, false);
      return {
        setTransform() {},
        setTexture() {},
        setVisible: (v) => visible.set(key, v),
        setRenderOrder: (n) => order.set(key, n),
      };
    },
    remove(key) {
      visible.delete(key);
      order.delete(key);
    },
    keys: () => [...visible.keys()],
  };
}

// --- the rig ------------------------------------------------------------------

interface GLRig {
  world: World;
  engine: Engine;
  bridge: GLBridge;
  pool: ReturnType<typeof createFakePool>;
  quads: ReturnType<typeof createFakeQuads>;
  /** Every gl.render call, in order (island paints then the composite). */
  renders: { scene: object; camera: object }[];
  /** Stable sentinels the pass must hand to the FINAL gl.render. */
  compScene: object;
  compCamRaw: object;
  spawnCard(x: number, y: number, w?: number, h?: number): Entity;
  /** Register a fake island (scene/camera are inert handles). */
  mount(e: Entity): () => void;
  pass(opts?: { maxFboBytes?: number; maxRepaints?: number }): PassStats;
  step(): void;
}

function createGLRig(opts: { devAssert?: boolean } = {}): GLRig {
  const world = createWorld();
  const engine = createEngine(world);
  const bridge = createGLBridge(engine, { devAssertRenderWrites: opts.devAssert === true });
  const pool = createFakePool();
  const quads = createFakeQuads();
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  world.setResource(Viewport, { w: 800, h: 600, dpr: 1 });
  let now = 0;
  let ratio = 1;
  const renders: { scene: object; camera: object }[] = [];
  const compScene = {};
  const compCamRaw = {};
  return {
    renders,
    compScene,
    compCamRaw,
    world,
    engine,
    bridge,
    pool,
    quads,
    spawnCard(x, y, w = 100, h = 100) {
      return world.spawn({
        components: [
          [Position, { x, y }],
          [Size, { w, h }],
          [StackZ, { z: 0 }],
          [PrefabId, { id: CARD.type }],
          [CardProps, { label: "hi" }],
        ],
        // Active mirrors what the core activeMembership system stamps at root —
        // the compositor pass reads it as current-nav-frame membership. This rig
        // drives runCompositorPass directly and never runs activeMembership, so
        // an unstamped card would classify Dormant and blank every island.
        tags: [Visible, Active],
      });
    },
    mount(e) {
      return bridge.registerIsland(e, {
        scene: { children: [] } as unknown as Scene,
        camera: { updateProjectionMatrix() {} } as unknown as OrthographicCamera,
      });
    },
    pass({ maxFboBytes = Number.MAX_SAFE_INTEGER, maxRepaints = 100 } = {}) {
      bridge.renderAssert.begin();
      try {
        return runCompositorPass({
          world,
          bridge,
          pool,
          quads,
          gl: {
            setRenderTarget() {},
            clear() {},
            render(scene, camera) {
              renders.push({ scene, camera });
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
          maxRepaintsPerFrame: maxRepaints,
          dtMs: 16,
        });
      } finally {
        bridge.renderAssert.end();
      }
    },
    step() {
      now += 16;
      engine.step(now);
    },
  };
}

// --- traces --------------------------------------------------------------------

describe("retention decoupled from cull (design-004 §3 fix #1)", () => {
  it("cull round-trip re-enters Warm from the retained texture — no repaint", () => {
    const rig = createGLRig();
    const e = rig.spawnCard(0, 0);
    const unmount = rig.mount(e);

    let stats = rig.pass();
    expect(stats.repainted).toBe(1); // Waking → painted
    expect(rig.quads.visible.get(e)).toBe(true);

    unmount(); // culled: island scene gone…
    stats = rig.pass();
    expect(stats.repainted).toBe(0);
    expect(rig.pool.get(e)).not.toBeNull(); // …FBO retained
    expect(rig.quads.visible.get(e)).toBe(true); // still composites (off-viewport anyway)
    expect(rig.bridge.state.get(e)?.phase).toBe("Cold");

    rig.mount(e); // re-entry
    stats = rig.pass();
    expect(rig.bridge.state.get(e)?.phase).toBe("Warm"); // NOT Waking
    expect(stats.repainted).toBe(0); // composited from the retained texture
  });

  it("evicted-while-hidden: quad hides until first repaint, re-entry is Waking", () => {
    const rig = createGLRig();
    const a = rig.spawnCard(0, 0);
    const b = rig.spawnCard(200, 0);
    const unmountA = rig.mount(a);
    rig.mount(b);
    rig.pass();
    unmountA(); // a: culled, Cold, retained

    // Budget below both: Cold a evicted first (b is Warm — higher priority).
    const bytesOne = 100 * 100 * 4;
    const stats = rig.pass({ maxFboBytes: bytesOne });
    expect(stats.evicted).toBe(1);
    expect(rig.pool.get(a)).toBeNull();
    expect(rig.quads.visible.get(a)).toBe(false); // hidden until first repaint
    expect(rig.quads.visible.get(b)).toBe(true);

    rig.mount(a);
    rig.pass({ maxFboBytes: Number.MAX_SAFE_INTEGER });
    expect(rig.bridge.state.get(a)?.fboGeneration).toBeGreaterThanOrEqual(0); // re-woke via paint
    expect(rig.quads.visible.get(a)).toBe(true);
  });
});

describe("FBO budget under a scripted zoom/cull storm (M7 exit)", () => {
  it("bytesUsed ≤ budget after EVERY pass; Hot/Waking never evicted", () => {
    const rig = createGLRig();
    const entities: Entity[] = [];
    const unmounts = new Map<Entity, () => void>();
    for (let i = 0; i < 8; i++) {
      const e = rig.spawnCard(i * 150, 0);
      entities.push(e);
      unmounts.set(e, rig.mount(e));
    }
    const budget = 100 * 100 * 4 * 3; // room for ~3 of 8 at band 1

    // Deterministic storm: zoom sweeps across bands while widgets cull in
    // and out (tag flip + island unmount — the real cull pipeline's effect).
    const zooms = [1, 2.5, 0.4, 8, 0.1, 1, 4, 0.7, 2, 1];
    for (let step = 0; step < zooms.length; step++) {
      world_setZoom(rig, zooms[step] as number);
      for (let i = 0; i < entities.length; i++) {
        const e = entities[i] as Entity;
        const shouldShow = (step + i) % 3 !== 0; // rolling cull pattern
        const mounted = unmounts.get(e) !== undefined;
        if (shouldShow && !mounted) {
          rig.world.addTag(e, Visible);
          unmounts.set(e, rig.mount(e));
        } else if (!shouldShow && mounted) {
          rig.world.removeTag(e, Visible);
          const un = unmounts.get(e);
          un?.();
          unmounts.delete(e);
        }
      }
      const stats = rig.pass({ maxFboBytes: budget, maxRepaints: 100 });
      expect(rig.pool.bytesUsed()).toBeLessThanOrEqual(budget);
      // Eviction policy honored: nothing Hot/Waking was released this pass.
      for (const key of rig.pool.released) {
        const phase = rig.bridge.state.get(key)?.phase;
        expect(phase === "Hot" || phase === "Waking").toBe(false);
      }
      rig.pool.released.length = 0;
      expect(stats.fboBytes).toBe(rig.pool.bytesUsed());
    }
  });
});

function world_setZoom(rig: GLRig, zoom: number, gesturing = false): void {
  rig.world.setResource(Camera, { x: 0, y: 0, zoom, gesturing });
}

describe("band crossings while gesturing (design-004 §3)", () => {
  it("suppressed mid-gesture; repainted once on the first idle pass", () => {
    const rig = createGLRig();
    const e = rig.spawnCard(0, 0);
    rig.mount(e);
    expect(rig.pass().repainted).toBe(1); // initial paint at band 1

    world_setZoom(rig, 4, true); // ×4 = out of the [×0.5, ×2] window
    expect(rig.pass().repainted).toBe(0); // gesturing: stale composite accepted

    world_setZoom(rig, 4, false); // gesture ended
    expect(rig.pass().repainted).toBe(1); // one repaint at the new band
    expect(rig.bridge.state.get(e)?.paintedAt.band).toBe(4);
    expect(rig.pass().repainted).toBe(0); // settled
  });
});

describe("two-level invalidation (design-004 §3)", () => {
  it("props dirt repaints exactly the touched island; camera dirt repaints none", () => {
    const rig = createGLRig();
    const a = rig.spawnCard(0, 0);
    const b = rig.spawnCard(200, 0);
    rig.mount(a);
    rig.mount(b);
    rig.pass();

    // Island dirt: Tier-3 props observer → bumpPaint(a) at notify().
    rig.world.edit(a).set(CardProps, { label: "changed" });
    rig.step();
    rig.pool.acquired.length = 0;
    const stats = rig.pass();
    expect(stats.repainted).toBe(1);
    expect(rig.pool.acquired).toEqual([a]);

    // Composite dirt only: camera pan re-frustums, textures stay.
    rig.world.setResource(Camera, { x: 50, y: 25, zoom: 1, gesturing: false });
    rig.step();
    expect(rig.pass().repainted).toBe(0);
  });
});

describe("zero render→ECS writes (M7 exit, DEV trap)", () => {
  it("an ECS write inside a useIslandFrame callback throws with attribution", () => {
    const rig = createGLRig({ devAssert: true });
    const e = rig.spawnCard(0, 0);
    rig.mount(e);
    rig.pass(); // clean pass first (reads never trip the trap)

    rig.bridge.addFrameCallback(e, () => {
      rig.world.addTag(e, Visible); // the banned move
    });
    expect(() => rig.pass()).toThrowError(/render pass/);

    // The trap disarmed in finally: mutators are usable again outside the pass.
    expect(() => rig.world.removeTag(e, Visible)).not.toThrow();
    expect(() => rig.world.addTag(e, Visible)).not.toThrow();
  });
});

describe("composite render identity (field bug 2026-07-10)", () => {
  it("the final gl.render uses the REAL camera handle (compCamera.raw), never the adapter", () => {
    // In the browser three instanceof-checks the camera; passing the adapter
    // threw "camera is not an instance of THREE.Camera" every frame and P2
    // never composited. The fakes can't instanceof-check — identity pins it.
    const rig = createGLRig();
    rig.mount(rig.spawnCard(0, 0));
    rig.pass();
    const last = rig.renders[rig.renders.length - 1];
    expect(last?.scene).toBe(rig.compScene);
    expect(last?.camera).toBe(rig.compCamRaw);
    // Island paints (all renders before the last) never use the composite pair.
    for (const r of rig.renders.slice(0, -1)) {
      expect(r.scene).not.toBe(rig.compScene);
      expect(r.camera).not.toBe(rig.compCamRaw);
    }
  });
});

describe("repaint stagger", () => {
  it("caps paints per pass and reports the deferred remainder", () => {
    const rig = createGLRig();
    for (let i = 0; i < 6; i++) rig.mount(rig.spawnCard(i * 150, 0));
    const first = rig.pass({ maxRepaints: 4 });
    expect(first.repainted).toBe(4);
    expect(first.pendingPaints).toBe(2);
    const second = rig.pass({ maxRepaints: 4 });
    expect(second.repainted).toBe(2);
    expect(second.pendingPaints).toBe(0);
  });
});

describe("animation contract", () => {
  it("a live frame callback makes the island Hot (self-sustain) and ticks on paint", () => {
    const rig = createGLRig();
    const e = rig.spawnCard(0, 0);
    rig.mount(e);
    const ticks: number[] = [];
    const un = rig.bridge.addFrameCallback(e, (dt) => ticks.push(dt));
    let stats = rig.pass();
    expect(stats.anyHot).toBe(true);
    expect(ticks).toEqual([16]);
    stats = rig.pass();
    expect(ticks.length).toBe(2); // Hot repaints (and ticks) every pass

    un(); // unsubscribe: back to Warm, demand loop parks
    stats = rig.pass();
    expect(stats.anyHot).toBe(false);
    expect(ticks.length).toBe(2);
  });
});

describe("nav-frame membership (design-004 §7 — Active drives phase)", () => {
  it("a non-Active island keeps its retained FBO but classifies Dormant; the Active peer stays Warm", () => {
    const rig = createGLRig();
    const a = rig.spawnCard(0, 0);
    const b = rig.spawnCard(200, 0);
    rig.mount(a);
    rig.mount(b);
    rig.pass(); // first paint (Waking during this pass)
    rig.pass(); // settle → Warm from the retained textures
    expect(rig.bridge.state.get(a)?.phase).toBe("Warm");
    expect(rig.bridge.state.get(b)?.phase).toBe("Warm");

    // Navigate away from b's frame: activeMembership would clear Active+Visible
    // (adds Culled) for another container's content. b's FBO is retained.
    rig.world.removeTag(b, Active);
    rig.world.removeTag(b, Visible);

    const stats = rig.pass(); // generous budget — nothing is evicted
    expect(rig.pool.get(b)).not.toBeNull(); // retained texture survives
    expect(rig.bridge.state.get(b)?.phase).toBe("Dormant");
    expect(rig.bridge.state.get(a)?.phase).toBe("Warm"); // still a member, composite-ready
    expect(stats.evicted).toBe(0);
  });

  it("Dormant hides its quad and ages toward eviction; re-entry re-shows it", () => {
    const rig = createGLRig();
    const a = rig.spawnCard(0, 0);
    const b = rig.spawnCard(200, 0);
    rig.mount(a);
    rig.mount(b);
    rig.pass(); // first paint (Waking)
    rig.pass(); // settle → Warm, both quads composited and touched
    expect(rig.quads.visible.get(b)).toBe(true);

    const lastUsed = (key: number): number | undefined =>
      rig.pool.entryInfos().find((i) => i.key === key)?.lastUsedMs;

    // Navigate away from b's frame (activeMembership clears Active+Visible).
    rig.world.removeTag(b, Active);
    rig.world.removeTag(b, Visible);
    rig.pass();
    expect(rig.bridge.state.get(b)?.phase).toBe("Dormant");
    expect(rig.quads.visible.get(b)).toBe(false); // retained FBO no longer composites
    const dormantMark = lastUsed(b);
    expect(dormantMark).not.toBeUndefined(); // FBO retained, not evicted

    // Aging: the retained FBO is never re-touched while Dormant, even as its
    // Active peer keeps compositing (and bumping the shared LRU clock).
    rig.pass();
    rig.pass();
    expect(lastUsed(b)).toBe(dormantMark);

    // Re-entry: Active (+Visible) again → Warm from the retained texture; the
    // quad composites again next pass (visibility derived, never latched off).
    rig.world.addTag(b, Active);
    rig.world.addTag(b, Visible);
    rig.pass();
    expect(rig.bridge.state.get(b)?.phase).toBe("Warm");
    expect(rig.quads.visible.get(b)).toBe(true);
  });

  it("an Active + animating island is Hot while a non-Active peer is Dormant", () => {
    const rig = createGLRig();
    const a = rig.spawnCard(0, 0);
    const b = rig.spawnCard(200, 0);
    rig.mount(a);
    rig.mount(b);
    rig.bridge.addFrameCallback(a, () => {}); // a self-sustains → Hot
    rig.world.removeTag(b, Active);
    rig.world.removeTag(b, Visible);

    const stats = rig.pass();
    expect(stats.anyHot).toBe(true);
    expect(rig.bridge.state.get(a)?.phase).toBe("Hot");
    expect(rig.bridge.state.get(b)?.phase).toBe("Dormant");
  });
});
