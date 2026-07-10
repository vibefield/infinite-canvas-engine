/**
 * The compositor frame pass (design-004 §3) — ONE function, dependency-
 * injected so the M7 exit traces (FBO budget under zoom/cull storms, zero
 * render→ECS writes) run headlessly with fakes while `GLViews` binds it to
 * the real renderer/pool/quads.
 *
 * Order per invalidation (v1 Compositor.useFrame, re-cut law-clean):
 *   1. camera/viewport read → composite frustum (kernel — Law 13) + dynamic
 *      DPR (min(dpr,1) while `Camera.gesturing`, restore on idle);
 *   2. phase update per island-state entry (kernel `computeIslandPhase`,
 *      module-side state ONLY — no ECS writes anywhere in the pass);
 *   3. `useIslandFrame` callbacks for Hot islands (paint-attributed — this
 *      is why plain `useFrame` is not the contract);
 *   4. paint pass, Waking-first, staggered by `maxRepaintsPerFrame`; band
 *      repaints suppressed while gesturing (the composite's bilinear stretch
 *      is the accepted transient) and picked up on the first idle pass;
 *   5. eviction to budget (kernel `selectEvictions`; Hot/Waking immune);
 *   6. quad reconcile: transform from Position/Size (kernel Y-flip), texture
 *      from the pool, `StackZ` render order with grabbed widgets on top
 *      (design-004 §1: renderOrder-top within P2 suffices), `pool.touch` on
 *      every composited quad (still-Warm textures must not look LRU-stale);
 *   7. composite render to the backbuffer;
 *   8. self-sustain report (`anyHot`/`pendingPaints` → caller invalidates).
 *
 * The world is READ ONLY here (reads outside the tick are verified-
 * unrestricted); the caller arms the render write trap around the whole pass.
 */
import {
  computeIslandPhase,
  compositeCameraFrustum,
  fboPixelSize,
  isOutOfBand,
  selectBand,
  selectEvictions,
  worldRectToComposite,
  type EvictionCandidate,
} from "@ice/kernel";
import { Camera, Grab, Position, Size, StackZ, Viewport, Visible, type Entity, type World } from "@ice/core";
import type { GLBridge } from "./bridge";

/** Render order far above any sane StackZ — the grabbed quad draws last. */
const GRABBED_RENDER_ORDER = 1e9;

// --- injected surfaces (GLViews binds three.js; traces bind fakes) ----------

export interface TargetLike {
  /** Opaque texture handle threaded to the quad (three: `.texture`). */
  readonly texture: unknown;
}

export interface PoolLike {
  acquire(key: number, worldW: number, worldH: number, effectiveDpr: number): TargetLike;
  get(key: number): TargetLike | null;
  touch(key: number): void;
  release(key: number): void;
  bytesUsed(): number;
  entryInfos(): readonly { key: number; bytes: number; lastUsedMs: number }[];
}

export interface QuadLike {
  setTransform(x: number, y: number, sx: number, sy: number): void;
  setTexture(t: unknown): void;
  setVisible(v: boolean): void;
  setRenderOrder(n: number): void;
}

export interface QuadsLike {
  ensure(key: number): QuadLike;
  remove(key: number): void;
  keys(): readonly number[];
}

export interface GlLike {
  setRenderTarget(t: TargetLike | null): void;
  /** Clear the CURRENT target to transparent black. */
  clear(): void;
  render(scene: object, camera: object): void;
  setPixelRatio(n: number): void;
  getPixelRatio(): number;
}

export interface CompCameraLike {
  setFrustum(f: { left: number; right: number; top: number; bottom: number; x: number; y: number }): void;
  /**
   * The ACTUAL camera object handed to `gl.render` for the composite pass —
   * three's renderer instanceof-checks it, so this must be the real
   * `OrthographicCamera`, NOT this adapter. (Field bug 2026-07-10: the pass
   * rendered with the adapter itself; three threw "camera is not an instance
   * of THREE.Camera" every frame and P2 never composited. The headless fakes
   * couldn't catch it — both types erase to `object` and the fake render is
   * a no-op.)
   */
  readonly raw: object;
}

export interface IslandCameraLike {
  setFrustum(halfW: number, halfH: number): void;
}

export interface PassContext {
  readonly world: World;
  readonly bridge: GLBridge;
  readonly pool: PoolLike;
  readonly quads: QuadsLike;
  readonly gl: GlLike;
  readonly compCamera: CompCameraLike;
  /** Adapt an island's ortho camera (three or fake) for frustum writes. */
  readonly islandCamera: (entity: Entity) => IslandCameraLike | undefined;
  readonly compositeScene: object;
  readonly maxFboBytes: number;
  readonly maxRepaintsPerFrame: number;
  readonly dtMs: number;
}

export interface PassStats {
  repainted: number;
  /** Paint-needing islands deferred by the stagger cap — caller re-invalidates. */
  pendingPaints: number;
  evicted: number;
  fboBytes: number;
  anyHot: boolean;
}

export function runCompositorPass(ctx: PassContext): PassStats {
  const { world, bridge, pool, quads, gl } = ctx;
  const stats: PassStats = { repainted: 0, pendingPaints: 0, evicted: 0, fboBytes: 0, anyHot: false };

  const cam = world.getResource(Camera);
  const vp = world.getResource(Viewport);
  if (cam === undefined || vp === undefined || vp.w === 0) return stats;

  // 1. composite camera + dynamic DPR ---------------------------------------
  ctx.compCamera.setFrustum(compositeCameraFrustum(cam, vp.w, vp.h));
  const idleDpr = vp.dpr > 0 ? vp.dpr : 1;
  const targetDpr = cam.gesturing ? Math.min(idleDpr, 1) : idleDpr;
  if (gl.getPixelRatio() !== targetDpr) gl.setPixelRatio(targetDpr);

  // 2. phases (module-side state only) --------------------------------------
  // `active` is the M8 nested-canvas input — always true until then.
  const phaseOf = (e: number): ReturnType<typeof computeIslandPhase> => {
    const alive = world.isAlive(e as Entity);
    const visible = alive && world.hasTag(e as Entity, Visible) && bridge.islandFor(e as Entity) !== undefined;
    const s = bridge.state.get(e);
    const hasFbo = s !== undefined && s.fboGeneration >= 0 && pool.get(e) !== null;
    return computeIslandPhase(true, visible, bridge.state.isAnimating(e), hasFbo);
  };
  for (const [e, s] of bridge.state.all()) {
    s.phase = phaseOf(e);
    if (s.phase === "Hot") stats.anyHot = true;
  }

  // 3+4. paint pass (Waking first, staggered) --------------------------------
  const band = selectBand(cam.zoom);
  const effectiveDpr = gl.getPixelRatio() * band;
  const toPaint: Entity[] = [];
  for (const [e, s] of bridge.state.all()) {
    if (bridge.islandFor(e as Entity) === undefined) continue; // unmounted: retained texture only
    const wantsPhase = s.phase === "Hot" || s.phase === "Waking";
    const genDirty = s.paintGeneration > s.fboGeneration;
    const bandStale = !cam.gesturing && s.fboGeneration >= 0 && isOutOfBand(cam.zoom, s.paintedAt.band);
    if (wantsPhase || genDirty || bandStale) toPaint.push(e as Entity);
  }
  toPaint.sort((a, b) => {
    const sa = bridge.state.get(a);
    const sb = bridge.state.get(b);
    return (sa !== undefined && sa.fboGeneration < 0 ? 0 : 1) - (sb !== undefined && sb.fboGeneration < 0 ? 0 : 1);
  });

  const cap = Math.max(1, ctx.maxRepaintsPerFrame);
  for (const e of toPaint) {
    if (stats.repainted >= cap) {
      stats.pendingPaints = toPaint.length - stats.repainted;
      break;
    }
    const handle = bridge.islandFor(e);
    const s = bridge.state.get(e);
    const size = world.isAlive(e) ? world.get(e, Size) : undefined;
    if (handle === undefined || s === undefined || size === undefined || size.w <= 0 || size.h <= 0) continue;

    // Hot content ticks exactly when it paints — the attribution contract.
    if (s.phase === "Hot") {
      for (const cb of bridge.frameCallbacksFor(e)) cb(ctx.dtMs);
    }

    ctx.islandCamera(e)?.setFrustum(size.w / 2, size.h / 2);
    const fbo = pool.acquire(e, size.w, size.h, effectiveDpr);
    gl.setRenderTarget(fbo);
    try {
      // A throwing island must not leave its FBO bound — that would corrupt
      // the composite into the backbuffer (v1 lesson, kept).
      gl.clear();
      gl.render(handle.scene, handle.camera);
    } finally {
      gl.setRenderTarget(null);
    }
    const px = fboPixelSize(size.w, size.h, effectiveDpr, 1);
    bridge.state.markPainted(e, { w: px.width, h: px.height, dpr: effectiveDpr, band });
    stats.repainted += 1;
  }

  // 5. eviction to budget (Hot/Waking immune — kernel policy) ----------------
  if (pool.bytesUsed() > ctx.maxFboBytes) {
    const candidates: EvictionCandidate<number>[] = [];
    for (const info of pool.entryInfos()) {
      const s = bridge.state.get(info.key);
      // Phases RECOMPUTED post-paint: an island that woke and painted this
      // very pass is Warm now, not Waking — the stage-2 snapshot would grant
      // it spurious eviction immunity and let a first-paint storm blow the
      // budget (caught by the storm trace).
      const phase = s === undefined ? "Dormant" : phaseOf(info.key);
      if (s !== undefined) s.phase = phase;
      candidates.push({
        id: info.key,
        phase,
        bytes: info.bytes,
        lastUsedMs: info.lastUsedMs,
      });
    }
    for (const key of selectEvictions(candidates, pool.bytesUsed(), ctx.maxFboBytes)) {
      if (bridge.state.get(key)?.phase === "Dormant") {
        // Tunable-budget breadcrumb (v1 kept it; "no silent caps").
        console.debug(`[ice/r3f] evicting Dormant island ${key} — consider raising the FBO budget`);
      }
      pool.release(key);
      bridge.state.markEvicted(key);
      stats.evicted += 1;
    }
  }

  // 6. quad reconcile ---------------------------------------------------------
  // Membership = island-state entries (they outlive cull; bridge drops them on
  // death/reset). Pool entries with no state entry are stale (post-reset) —
  // release them; quads with no state entry are removed.
  const liveKeys = new Set<number>();
  for (const [e] of bridge.state.all()) liveKeys.add(e);
  for (const info of pool.entryInfos()) {
    if (!liveKeys.has(info.key)) pool.release(info.key);
  }
  for (const key of quads.keys()) {
    if (!liveKeys.has(key)) quads.remove(key);
  }
  for (const [e, s] of bridge.state.all()) {
    const quad = quads.ensure(e);
    const alive = world.isAlive(e as Entity);
    const fbo = pool.get(e);
    const pos = alive ? world.get(e as Entity, Position) : undefined;
    const size = alive ? world.get(e as Entity, Size) : undefined;
    if (fbo === null || s.fboGeneration < 0 || pos === undefined || size === undefined) {
      // Evicted-while-retained fallback: hidden until first repaint
      // (design-004 §3 — instant reactivation holds only when the FBO survived).
      quad.setVisible(false);
      continue;
    }
    const q = worldRectToComposite({ x: pos.x, y: pos.y, width: size.w, height: size.h });
    quad.setTransform(q.x, q.y, q.sx, q.sy);
    quad.setTexture(fbo.texture);
    const grabbed = world.get(e as Entity, Grab) !== undefined;
    quad.setRenderOrder(grabbed ? GRABBED_RENDER_ORDER : (world.get(e as Entity, StackZ)?.z ?? 0));
    quad.setVisible(true);
    pool.touch(e);
  }

  // 7. composite to the backbuffer -------------------------------------------
  gl.setRenderTarget(null);
  gl.clear();
  gl.render(ctx.compositeScene, ctx.compCamera.raw);

  stats.fboBytes = pool.bytesUsed();
  return stats;
}
