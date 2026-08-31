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
 *   4. paint pass, Waking-first, staggered by `maxRepaintsPerFrame`, at
 *      `min(pixelRatio, maxPaintDpr) × band`; band repaints suppressed while
 *      gesturing (the composite's bilinear stretch is the accepted transient)
 *      and picked up on the first idle pass;
 *   5. eviction to budget (kernel `selectEvictions`; Hot/Waking immune);
 *   6. quad reconcile: transform from Position/Size (kernel Y-flip), texture
 *      from the pool, sibling-order renderOrder with grabbed widgets on top
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
  cubicBezierEase,
  fboPixelSize,
  isOutOfBand,
  selectBand,
  selectEvictions,
  worldRectToComposite,
  type EvictionCandidate,
} from "@ice/kernel";
import {
  Active,
  Camera,
  Grab,
  navFlightActive,
  Opacity,
  Position,
  PrefabId,
  Size,
  StackZ,
  StageMode,
  Viewport,
  Visible,
  widgets,
  type Entity,
  type World,
} from "@ice/core";
import type { GLBridge } from "./bridge";
import type { SourcesLike } from "./webgpu-sources";

/** Render order far above any sane sibling ordinal or legacy z — the grabbed quad draws last. */
const GRABBED_RENDER_ORDER = 1e9;

/**
 * The lift's spring — the same curve the DOM card lift runs in CSS
 * (`cubic-bezier(0.2, 0.9, 0.3, 1.2)`: slight overshoot, quick settle).
 * GL widgets have no CSS transitions, so the pass owns the ease.
 */
const LIFT_EASE = cubicBezierEase(0.2, 0.9, 0.3, 1.2);

/**
 * The fade's curve — CSS `ease`, NOT the lift spring: an overshoot past 1
 * would write alpha > 1 into the composite (and a dip below the target reads
 * as flicker, not bounce). Matches the DOM chrome's `opacity … ease`
 * transition so card body and GL content fade in lockstep.
 */
const OPACITY_EASE = cubicBezierEase(0.25, 0.1, 0.25, 1);

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
  projectedBytes?(
    key: number,
    worldW: number,
    worldH: number,
    effectiveDpr: number,
  ): number;
  entryInfos(): readonly {
    key: number;
    bytes: number;
    lastUsedMs: number;
    pinned?: boolean;
  }[];
}

export interface QuadLike {
  setTransform(x: number, y: number, sx: number, sy: number): void;
  setTexture(t: unknown): void;
  setVisible(v: boolean): void;
  setRenderOrder(n: number): void;
  /**
   * Composite opacity, 0..1 (design-004 §3: the neutral composite's whole
   * per-widget fact) — the pass passes `Opacity` cell × eased fade channel.
   */
  setOpacity(o: number): void;
  /**
   * Drag clip (v1 RFC-003, composite-space): non-exempt quads discard
   * fragments inside the rect so a dragged card's P1 DOM chrome shows
   * through. (0,0,0,0, false) = inactive.
   */
  setDragClip(minX: number, minY: number, maxX: number, maxY: number, exempt: boolean): void;
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
  /**
   * STRATIFIED PROFILE: the composite quads this pass reconciles and then
   * renders to the backbuffer. Omitted in the composited profile, where there
   * is no second three scene to draw — see {@link PassContext.sources}.
   */
  readonly quads?: QuadsLike;
  /**
   * COMPOSITED PROFILE (design-012 §4, plan §5 S5.3): island targets are
   * published as `gl` sources for the unified compositor, and THIS PASS NO
   * LONGER PRESENTS. Supplying `sources` is what selects that profile.
   *
   * The steps above are untouched — camera, phases, the staggered paint pass at
   * band × paint-DPR, dt-banking, eviction to budget all carry over verbatim,
   * which is design-012 §7's "texture pool constitution: survives unchanged
   * (API swapped beneath)" being literally true. What changes is only the last
   * two steps: quad reconcile becomes source reconcile, and the composite
   * render to the backbuffer is deleted, because ground's `WidgetQuadPass`
   * owns the one present now (plan §4.3: "its ADVANCE collapses into the
   * compositorReflector's single present").
   *
   * Geometry is deliberately NOT published: an island's rect, opacity and paint
   * order are ECS facts (Position/Size/Opacity + the sibling-order index) that
   * the compositor reads for itself, so publishing them here would be a second
   * source of truth for what petition 8 already settled.
   */
  readonly sources?: SourcesLike;
  readonly gl: GlLike;
  readonly compCamera: CompCameraLike;
  /** Adapt an island's ortho camera (three or fake) for frustum writes. */
  readonly islandCamera: (entity: Entity) => IslandCameraLike | undefined;
  readonly compositeScene: object;
  readonly maxFboBytes: number;
  readonly maxRepaintsPerFrame: number;
  /**
   * Idle ceiling on island paint resolution (design-004 §3 amendment,
   * 2026-07-14): new paints allocate at `min(pixelRatio, maxPaintDpr) × band`.
   * On a dpr-2 display the composite's bilinear upscale from a 1.5× texture is
   * visually indistinguishable (A/B knot crops) while Hot repaint cost drops
   * ~22 %. Composes with the gesture drop (pixelRatio is already 1 while
   * gesturing) and with zoom bands. `Infinity` = uncapped.
   */
  readonly maxPaintDpr: number;
  readonly dtMs: number;
  /** T2 fade channel for destination quads; defaults to fully visible. */
  readonly incomingOpacity?: number;
}

export interface PassStats {
  repainted: number;
  /** Paint-needing islands deferred by the stagger cap — caller re-invalidates. */
  pendingPaints: number;
  evicted: number;
  fboBytes: number;
  anyHot: boolean;
  /** A composite ease (lift scale or fade) is mid-flight — caller re-invalidates (composite-only frames). */
  liftAnimating: boolean;
}

export function runCompositorPass(ctx: PassContext): PassStats {
  const { world, bridge, pool, gl } = ctx;
  // The profile, derived from what the caller wired rather than from a flag:
  // `sources` present ⇒ the unified compositor presents, this pass does not.
  const sources = ctx.sources;
  const compositedProfile = sources !== undefined;
  const stats: PassStats = {
    repainted: 0,
    pendingPaints: 0,
    evicted: 0,
    fboBytes: 0,
    anyHot: false,
    liftAnimating: false,
  };

  const cam = world.getResource(Camera);
  const vp = world.getResource(Viewport);
  if (cam === undefined || vp === undefined || vp.w === 0) return stats;

  // 1. composite camera + dynamic DPR ---------------------------------------
  // "Camera in transient motion" = user gesture OR a design-006 nav flight
  // (§8.2, answered 2026-07-16): both sweep the camera per frame and get the
  // same duty treatment — DPR drop, band-repaint suppression. Flights go
  // further (islands turn COLD, below): the flight-end camera write re-fires
  // the reflector, so everything thaws in one pass with no extra machinery.
  const inFlight = navFlightActive(world);
  const inMotion = cam.gesturing || inFlight;
  // STAGE BACKGROUND (StageMode holds, 2026-07-19): app chrome covers the
  // canvas — same freeze posture as a nav flight (retained textures stretch,
  // Hot repaints and their paint-attributed `useIslandFrame` ticks pause,
  // never-painted islands still get their first paint) but WITHOUT the
  // motion-DPR drop: a resting frame stays full quality.
  const backgrounded = (world.getResource(StageMode)?.backgroundHolds ?? 0) > 0;
  const frozen = inFlight || backgrounded;
  ctx.compCamera.setFrustum(compositeCameraFrustum(cam, vp.w, vp.h));
  const idleDpr = vp.dpr > 0 ? vp.dpr : 1;
  const targetDpr = inMotion ? Math.min(idleDpr, 1) : idleDpr;
  if (gl.getPixelRatio() !== targetDpr) gl.setPixelRatio(targetDpr);

  // 2. phases (module-side state only) --------------------------------------
  // `active` = current-nav-frame membership (design-004 §7): the core
  // activeMembership system tags Active on the entities of the frame you are in
  // and clears it for other containers' content. A non-Active island keeps its
  // retained FBO but classifies Dormant (kernel truth table) — evicted only
  // under real pressure, re-Warms on re-entry.
  const phaseOf = (e: number): ReturnType<typeof computeIslandPhase> => {
    const alive = world.isAlive(e as Entity);
    const active = alive && world.hasTag(e as Entity, Active);
    const visible = alive && world.hasTag(e as Entity, Visible) && bridge.islandFor(e as Entity) !== undefined;
    const s = bridge.state.get(e);
    const hasFbo = s !== undefined && s.fboGeneration >= 0 && pool.get(e) !== null;
    return computeIslandPhase(active, visible, bridge.state.isAnimating(e), hasFbo);
  };
  for (const [e, s] of bridge.state.all()) {
    s.phase = phaseOf(e);
    if (s.phase === "Hot") stats.anyHot = true;
  }

  // 3+4. paint pass (Waking first, staggered) --------------------------------
  const band = selectBand(cam.zoom);
  const effectiveDpr = Math.min(gl.getPixelRatio(), ctx.maxPaintDpr) * band;
  const toPaint: Entity[] = [];
  for (const [e, s] of bridge.state.all()) {
    if (bridge.islandFor(e as Entity) === undefined) continue; // unmounted: retained texture only
    const wantsPhase = s.phase === "Hot" || s.phase === "Waking";
    const genDirty = s.paintGeneration > s.fboGeneration;
    const bandStale = !inMotion && s.fboGeneration >= 0 && isOutOfBand(cam.zoom, s.paintedAt.band);
    // FLIGHT FREEZE (design-006 §8.2): islands with a retained texture go
    // COLD for the flight — no Hot repaints (their `useIslandFrame` ticks are
    // paint-attributed, so animation pauses with them), no props repaints,
    // no band chasing; the composite stretches the stale FBO (the accepted
    // gesture transient). NEVER-PAINTED islands (fboGeneration < 0) still get
    // their first paint — an empty quad through a 400 ms enter reads as
    // missing content, not as motion.
    const paintable = frozen ? wantsPhase && s.fboGeneration < 0 : wantsPhase || genDirty || bandStale;
    if (paintable) {
      toPaint.push(e as Entity);
      // Animation time is owed to every paint-ELIGIBLE Hot island, painted
      // this pass or deferred by the stagger cap — the deferred paint delivers
      // the balance, so the cap changes cadence, never speed (design-004 §3;
      // the pre-accumulation behavior ran 5-Hot-vs-cap-4 boards at 4/5 speed).
      // Frozen islands never reach here — a stage hold PAUSES, not banks.
      if (s.phase === "Hot") s.pendingDtMs += ctx.dtMs;
    }
  }
  // Order: never-painted first (cold paints jump the queue), then LEAST
  // RECENTLY PAINTED — the fairness key. Insertion order starved the same
  // island every pass once Hot count exceeded the stagger cap (five Hot vs
  // cap four froze the shapes card at boot, 2026-07-12 field report).
  toPaint.sort((a, b) => {
    const sa = bridge.state.get(a);
    const sb = bridge.state.get(b);
    const coldA = sa !== undefined && sa.fboGeneration < 0 ? 0 : 1;
    const coldB = sb !== undefined && sb.fboGeneration < 0 ? 0 : 1;
    if (coldA !== coldB) return coldA - coldB;
    return (sa?.lastPaintSeq ?? 0) - (sb?.lastPaintSeq ?? 0);
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

    if (pool.projectedBytes !== undefined) {
      let projected = pool.projectedBytes(e, size.w, size.h, effectiveDpr);
      if (projected > ctx.maxFboBytes) {
        const reclaimable = pool
          .entryInfos()
          .filter((info) => {
            if (info.key === e || info.pinned === true) return false;
            return (bridge.state.get(info.key)?.phase ?? "Dormant") === "Dormant";
          })
          .sort((a, b) => a.lastUsedMs - b.lastUsedMs || a.key - b.key);
        for (const candidate of reclaimable) {
          if (projected <= ctx.maxFboBytes) break;
          pool.release(candidate.key);
          bridge.state.markEvicted(candidate.key);
          stats.evicted += 1;
          projected = pool.projectedBytes(e, size.w, size.h, effectiveDpr);
        }
      }
      if (projected > ctx.maxFboBytes) {
        // Hot/Waking/pinned targets are immune. Defer this first/repaint until
        // an exact release creates room; never allocate above the shared cap.
        stats.pendingPaints += 1;
        continue;
      }
    }

    // Hot content ticks exactly when it paints — the attribution contract —
    // and receives the FULL time owed since its last tick (its own pass dt
    // plus any stagger-deferred passes' dt banked above).
    if (s.phase === "Hot") {
      const owedMs = s.pendingDtMs;
      s.pendingDtMs = 0;
      for (const cb of bridge.frameCallbacksFor(e)) cb(owedMs);
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
    // Composited profile: new pixels in a texture the compositor is ALREADY
    // sampling change nothing about the registry, so nothing would otherwise
    // fire — an animating island would show its first frame forever. This is
    // the paint half of the two-level invalidation, raised at the one place
    // that knows a repaint really happened.
    sources?.painted(e);
    stats.repainted += 1;
  }

  // 5. eviction to budget (Hot/Waking immune — kernel policy) ----------------
  if (pool.bytesUsed() > ctx.maxFboBytes) {
    const candidates: EvictionCandidate<number>[] = [];
    for (const info of pool.entryInfos()) {
      if (info.pinned === true) continue;
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

  /**
   * Is this island presentable this pass? The predicate is SHARED by both
   * profiles on purpose — membership must not drift between them, or the
   * stratified-vs-composited pixel compare stops being a comparison of
   * renderers and becomes a comparison of two different boards.
   *
   * Two ways to be false, both meaning "retained but not shown": Dormant (a
   * texture from another nav frame, design-004 §7 — derived every pass, so
   * re-entry shows it again and it is never latched), and evicted-while-
   * retained (hidden until its first repaint; instant reactivation holds only
   * when the FBO survived).
   */
  const presentable = (
    e: number,
    s: { phase: string; fboGeneration: number },
  ): { fbo: TargetLike; pos: { x: number; y: number }; size: { w: number; h: number } } | null => {
    if (s.phase === "Dormant" || s.fboGeneration < 0 || !world.isAlive(e as Entity)) return null;
    const fbo = pool.get(e);
    if (fbo === null) return null;
    const pos = world.get(e as Entity, Position);
    const size = world.get(e as Entity, Size);
    if (pos === undefined || size === undefined) return null;
    return { fbo, pos, size };
  };

  // --- 6a. COMPOSITED PROFILE: reconcile SOURCES, and present nothing --------
  // The whole of steps 6 and 7 in this profile. Ground's WidgetQuadPass draws
  // these sources inside the compositor's one pass, reading each island's rect,
  // opacity and paint order from the ECS itself — so there is no quad to
  // transform here, no composite scene to render, and no backbuffer to clear.
  if (compositedProfile) {
    const publishedNow = new Set<number>();
    for (const [e, s] of bridge.state.all()) {
      if (presentable(e, s) === null) continue;
      publishedNow.add(e);
      sources.publish(e);
      // Still-Warm textures must not look LRU-stale just because they did not
      // repaint — the same reason the quad path touches every composited quad.
      pool.touch(e);
    }
    for (const key of sources.keys()) {
      if (!publishedNow.has(key)) sources.withdraw(key);
    }
    stats.fboBytes = pool.bytesUsed();
    if (backgrounded) stats.anyHot = false;
    return stats;
  }

  // --- 6b. STRATIFIED PROFILE: reconcile QUADS, then composite --------------
  const quads = ctx.quads;
  if (quads === undefined) {
    throw new Error(
      "runCompositorPass: the stratified profile needs `quads` (and the composited profile " +
        "needs `sources`) — one of the two must be wired, or the pass has nothing to present.",
    );
  }
  for (const key of quads.keys()) {
    if (!liveKeys.has(key)) quads.remove(key);
  }
  // Drag clip collection (v1 RFC-003): the first grabbed CHROME-carrying
  // widget's lift-scaled composite rect; every other composited quad discards
  // inside it so the dragged card's P1 DOM chrome pairs with its content.
  const hasChrome = (e: number): boolean => {
    const type = world.get(e as Entity, PrefabId)?.id;
    return typeof type === "string" && widgets.get(type)?.chrome != null;
  };
  const composited: Array<{ key: number; quad: QuadLike }> = [];
  let clip: { key: number; minX: number; minY: number; maxX: number; maxY: number } | null = null;

  // Frame ordinals once per pass (petition 8): quad renderOrder IS sibling
  // position. Reading through the bridge's shared index also resets the
  // staleness its reorder wake filters on.
  const ordinals = bridge.order.ordinals();

  for (const [e, s] of bridge.state.all()) {
    const quad = quads.ensure(e);
    const live = presentable(e, s);
    if (live === null) {
      // Not composited this pass — hidden, and its FBO ages toward eviction
      // (the `continue` skips the touch() below, so a hidden island never
      // stays artificially LRU-warm). See `presentable` for the two ways in.
      quad.setVisible(false);
      continue;
    }
    const { fbo, pos, size } = live;
    const q = worldRectToComposite({ x: pos.x, y: pos.y, width: size.w, height: size.h });
    // Lift-on-hold scales the QUAD (center-anchored — q.x/q.y is the rect
    // center): texture + rounded alpha corners scale together, and the card
    // overlaps its neighbors — scaling the SCENE instead crops the corners
    // at the card-sized frustum (2026-07-12 field report).
    //
    // The drawn scale EASES toward its target here, advanced by ctx.dtMs
    // (deterministic under the traces — no wall clock in the pass). Elapsed
    // time is the ONLY terminator: the overshoot spring crosses the target
    // value mid-flight, so a value comparison would freeze at the crossing.
    if (s.liftElapsedMs < s.liftMs) {
      s.liftElapsedMs += ctx.dtMs;
      const t = Math.min(1, s.liftElapsedMs / s.liftMs);
      s.compositeScale = t >= 1 ? s.liftTarget : s.liftFrom + (s.liftTarget - s.liftFrom) * LIFT_EASE(t);
      if (t < 1) stats.liftAnimating = true;
    }
    // The fade eases the same way (same terminator rationale), on its own
    // non-overshoot curve — see OPACITY_EASE.
    if (s.opacityElapsedMs < s.opacityMs) {
      s.opacityElapsedMs += ctx.dtMs;
      const t = Math.min(1, s.opacityElapsedMs / s.opacityMs);
      s.compositeOpacity =
        t >= 1 ? s.opacityTarget : s.opacityFrom + (s.opacityTarget - s.opacityFrom) * OPACITY_EASE(t);
      if (t < 1) stats.liftAnimating = true;
    }
    const lift = s.compositeScale;
    quad.setTransform(q.x, q.y, q.sx * lift, q.sy * lift);
    quad.setTexture(fbo.texture);
    // Drawn opacity = the widget's durable Opacity cell × the eased fade
    // channel (absent cell = 1). Clamped: CompositeMaterial passes through
    // unclamped, and userland cells are raw f32s.
    const baseOpacity = world.get(e as Entity, Opacity)?.a ?? 1;
    quad.setOpacity(
      Math.min(
        1,
        Math.max(0, baseOpacity * s.compositeOpacity * (ctx.incomingOpacity ?? 1)),
      ),
    );
    const grabbed = world.get(e as Entity, Grab) !== undefined;
    // Sibling ordinal, else the legacy StackZ fallback (pre-schema-2 read-only
    // docs are ALL-fallback; mixed frames are nominally impossible, and the
    // two scales interleaving there is accepted — see core sibling-order.ts).
    quad.setRenderOrder(
      grabbed || lift !== 1
        ? GRABBED_RENDER_ORDER
        : (ordinals.get(e as Entity) ?? world.get(e as Entity, StackZ)?.z ?? 0),
    );
    quad.setVisible(true);
    pool.touch(e);
    composited.push({ key: e, quad });
    if (clip === null && grabbed && hasChrome(e)) {
      const hw = (q.sx * lift) / 2;
      const hh = (q.sy * lift) / 2;
      clip = { key: e, minX: q.x - hw, minY: q.y - hh, maxX: q.x + hw, maxY: q.y + hh };
    }
  }
  // Apply after the loop — the grabbed widget may reconcile after a neighbor.
  for (const { key, quad } of composited) {
    if (clip === null) quad.setDragClip(0, 0, 0, 0, false);
    else quad.setDragClip(clip.minX, clip.minY, clip.maxX, clip.maxY, key === clip.key);
  }

  // 7. composite to the backbuffer -------------------------------------------
  gl.setRenderTarget(null);
  gl.clear();
  gl.render(ctx.compositeScene, ctx.compCamera.raw);

  stats.fboBytes = pool.bytesUsed();
  // Backgrounded stages report NO Hot demand: with anyHot suppressed the
  // self-sustain loop stops requesting frames and the GPU goes fully idle —
  // the whole point of the hold. (A flight keeps anyHot semantics: its
  // camera writes drive the frames regardless.) The StageMode flip itself
  // re-fires this reflector on release — the bridge observes the resource —
  // so the first foreground pass repaints Hot islands with no extra wake.
  if (backgrounded) stats.anyHot = false;
  return stats;
}
