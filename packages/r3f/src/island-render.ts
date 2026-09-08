/**
 * IslandRender — the composited leg's island half (design-013 §8 B5,
 * §6 reflector 6, §9 Q9 path (a)).
 *
 * An island's pixels live where RESIDENCY put them. Core's Residency system
 * gives every `gl` card a PRIVATE texture handle sized by
 * `geometry().rasterSize` and writes it into `TextureRef`; this module renders
 * three's scene into the target that handle names, on the device the ground
 * owns (three adopts the same one — `webgpu/island-renderer.ts`), realises the
 * handle in the ground's content residency and says it WROTE the card. The
 * ground then samples it in `own` mode, with the `ENCODE_SRGB` pipeline chosen
 * by the texture's ACTUAL format.
 *
 * ── Four things it is NOT ─────────────────────────────────────────────────
 *
 * 1. NOT a pool. Targets are keyed by HANDLE, never by entity. Residency
 *    re-mints a handle whenever the destination changes (a resize, a band
 *    crossing, an eviction and return), so the old target simply drains and is
 *    disposed at `onForget`; what a frame samples is always the CURRENT ref.
 *    That is what dissolves the pin-blind-resize class rather than fixing it:
 *    there is one authority for what is sampled, and no refcount to be blind
 *    to. `Retained` (B7 writes it) is honoured by Residency's LRU alone — this
 *    module never asks whether anything is holding a texture, because nothing
 *    it owns can be taken away while the table still names it.
 *
 * 2. NOT a render loop. It is a reflector, installed into the compose handle's
 *    `renders.island` slot, so it runs in §6's roster order — after the ECS
 *    has settled and BEFORE GpuCompose's submit, which is the whole reason the
 *    ground can sample this frame's pixels rather than last frame's. R3F's own
 *    loop stays `frameloop="never"` and renders nothing.
 *
 * 3. NOT its own eligibility policy. Which islands owe a paint is
 *    `islandPaintable` (island-state.ts), the predicate the old pass uses —
 *    extracted, not forked. What is ADDED is the demand clamp the old pass
 *    never read (design-013 D10): `SurfaceDemand.mode === "paused"` renders
 *    nothing at all, and a bucket is a ceiling on how often a live one renders.
 *
 * 4. NOT a writer of the world. Reflector contract: post-notify, no ECS
 *    writes (the bridge's render trap is armed around every flush), no layout
 *    reads — every size comes from the table entry Residency sized, never from
 *    `getBoundingClientRect`.
 *
 * ── A FRESH destination outranks the clamp (design-013 §10.2) ──────────────
 * `empty` is never sampled: a card draws from a texture only once a render has
 * written THIS destination. A handle the world has just named — a fresh island,
 * a resize, a return from eviction — therefore owes a render immediately, or the
 * card shows the plate until something else happens to move.
 *
 * The PHASE machine already says so: `hasFbo` asks about the CURRENT handle, so
 * a re-minted destination makes the island Waking again and `islandPaintable`
 * returns true with no help from here. What the phase machine does NOT outrank
 * is the demand clamp, and a 15 fps card that resized would draw the plate for
 * up to a bucket interval. So the ONE extra term is exactly that bypass — no
 * separate write ledger, which a mutation probe showed pinned nothing the phase
 * machine did not already pin.
 */
import {
  Active,
  Camera,
  NO_TEXTURE,
  Size,
  StageMode,
  SurfaceBand,
  SurfaceDemand,
  TextureRef,
  Viewport,
  Visible,
  demandIntervalMs,
  navFlightActive,
  toFpsBucket,
  type Entity,
  type TextureHandle,
  type World,
} from "@ice/core";
import { computeIslandPhase, selectBand, type IslandPhase } from "@ice/kernel";
import type { ContentSink, SurfaceContent, TextureDescription } from "@ice/react";
import type { RenderTarget } from "three";
import type { GLBridge } from "./bridge";
import { createIslandTarget } from "./island-target";
import { islandPaintable } from "./island-state";
import { islandTexture, type WebGpuRendererLike } from "./webgpu-backend";

/**
 * Half a 60 Hz frame. A demand bucket is a CEILING, and a 60-bucket island on
 * a 60 Hz grid must not lose every other frame to vsync jitter: without the
 * slack, `now - last < 16.67` is true about half the time and the island runs
 * at 30. Measured against the buckets, not tuned: 30 still lands on every
 * other frame (33.3 > 25.3), 15 on every fourth (66.7 > 58.7).
 */
const DEMAND_SLACK_MS = 8;

/** The renderer surface this module drives. GLViews binds three; tests bind fakes. */
export interface IslandGlLike {
  setRenderTarget(target: object | null): void;
  /** Clear the CURRENT target to transparent black. */
  clear(): void;
  render(scene: object, camera: object): void;
}

export interface IslandRenderStats {
  /** Island renders performed since the mount. */
  readonly rendered: number;
  /** Live render targets right now — one per handle the world still names. */
  readonly targets: number;
  /** Targets disposed (a handle the residency forgot, or the teardown). */
  readonly disposed: number;
  /** Renders skipped because the card's demand is `paused`. */
  readonly skippedPaused: number;
  /** Renders skipped because the card's fps bucket was not due yet. */
  readonly skippedBudget: number;
  /**
   * Renders whose resolve texture the backend had not allocated yet (the renderer resolves
   * asynchronously) or whose handle the table refused: NOT painted. The target is dropped so the
   * destination is fresh again and the next flush renders — an island marked painted with no
   * realised texture would sit Warm on the plate for good (B9 review).
   */
  readonly unrealised: number;
  /**
   * Renders NOT attempted because the table already refused this exact handle and nothing has
   * moved since (D-C4.7). Without the backoff a persistently refusing handle is an allocate →
   * render → destroy of a full target on every single flush, forever, spending Hot content's
   * owed animation time on frames nobody will ever see. A climbing counter here with a still
   * `unrealised` is the honest shape of "the table will not take this card".
   */
  readonly skippedRefused: number;
}

export interface IslandRenderOpts {
  readonly gl: IslandGlLike;
  /**
   * The renderer whose backend holds the resolved `GPUTexture`. A GETTER
   * because `<Canvas gl={…}>` resolves its renderer asynchronously — a value
   * captured at construction would be `undefined` forever.
   */
  readonly renderer: () => WebGpuRendererLike | undefined;
  readonly bridge: GLBridge;
  readonly world: World;
  /** The mounted ground's content seam (`useSurfaceContent()`). */
  readonly content: SurfaceContent;
  /** Injected monotonic clock for the demand clamp and dt banking (tests pass a stub). */
  readonly now?: () => number;
}

export interface IslandRender {
  /** Installed into `content.renders.island` at construction; cleared at `dispose`. */
  readonly reflector: { readonly name: string; flush(world: World): void };
  stats(): IslandRenderStats;
  /** The live target for a handle — the rig's witness that a resize leaves ONE. */
  targetOf(handle: TextureHandle): RenderTarget | undefined;
  dispose(): void;
}

export function createIslandRender(opts: IslandRenderOpts): IslandRender {
  const { gl, bridge, content } = opts;
  const sink: ContentSink = content.residency;
  const now = opts.now ?? ((): number => performance.now());

  /** handle → the target rendered into it. Never keyed by entity: see the header. */
  const targets = new Map<TextureHandle, RenderTarget>();
  /** entity → when it last rendered (the demand clamp's floor). */
  const lastRenderAt = new Map<Entity, number>();
  /** entity → animation time owed to its paint-attributed callbacks. */
  const owed = new Map<Entity, number>();
  /**
   * THE REFUSAL BACKOFF (D-C4.7): entity → the handle the table refused and the
   * residency's revision at that moment. While the world still names that same
   * handle and the revision has not moved, the card is skipped ENTIRELY — not
   * rendered, not allocated, not marked painted — so it keeps drawing the
   * plate and costs nothing. It retries the moment either term changes.
   */
  const refused = new Map<Entity, { readonly handle: TextureHandle; readonly revision: number | undefined }>();
  let rendered = 0;
  let disposed = 0;
  let skippedPaused = 0;
  let skippedBudget = 0;
  let unrealised = 0;
  let skippedRefused = 0;
  let lastFlushMs: number | null = null;

  const disposeTarget = (handle: TextureHandle): void => {
    const rt = targets.get(handle);
    if (rt === undefined) return; // a page or a stable handle: another render's business
    targets.delete(handle);
    rt.dispose();
    disposed += 1;
  };
  // The ONLY disposal path while mounted. A target dies when the TABLE has let
  // its handle go — after the frame's submit, because the residency collects
  // there — so nothing is ever destroyed under a command that reads it.
  const unforget = sink.onForget((handle) => {
    disposeTarget(handle);
    // A forgotten handle is the table letting go: any backoff standing against
    // it is spent (D-C4.7). Keeping it would hold a card off a handle the
    // residency no longer knows about.
    for (const [e, back] of refused) if (back.handle === handle) refused.delete(e);
  });

  const ensureTarget = (handle: TextureHandle, entry: TextureDescription): RenderTarget | undefined => {
    const existing = targets.get(handle);
    if (existing !== undefined) return existing;
    const w = entry.width ?? 0;
    const h = entry.height ?? 0;
    if (!(w > 0 && h > 0)) return undefined;
    const rt = createIslandTarget(w, h, `ice:island:${handle}`);
    targets.set(handle, rt);
    return rt;
  };

  const flush = (world: World): void => {
    const table = sink.table;
    if (table === null) return; // the profile has not installed yet

    const t = now();
    const dtMs = lastFlushMs === null ? 0 : Math.max(0, t - lastFlushMs);
    lastFlushMs = t;

    const cam = world.getResource(Camera);
    const vp = world.getResource(Viewport);
    if (cam === undefined || vp === undefined) return;
    // The camera's posture, derived exactly as the old pass derives it.
    const inFlight = navFlightActive(world);
    const inMotion = cam.gesturing || inFlight;
    const backgrounded = (world.getResource(StageMode)?.backgroundHolds ?? 0) > 0;
    const frozen = inFlight || backgrounded;

    /** The handle the world names for this card RIGHT NOW. */
    const handleOf = (e: Entity): TextureHandle => world.get(e, TextureRef)?.texture ?? NO_TEXTURE;

    // Phases first, over every island the bridge knows (entries outlive cull —
    // the retention decoupling). `hasFbo` asks about the CURRENT destination:
    // a re-minted handle has no target yet, which is what makes a resized
    // island Waking again rather than falsely Warm.
    const phaseOf = (key: number): IslandPhase => {
      const e = key as Entity;
      const alive = world.isAlive(e);
      const active = alive && world.hasTag(e, Active);
      const visible = alive && world.hasTag(e, Visible) && bridge.islandFor(e) !== undefined;
      const s = bridge.state.get(key);
      const hasFbo = s !== undefined && s.fboGeneration >= 0 && targets.has(handleOf(e));
      return computeIslandPhase(active, visible, bridge.state.isAnimating(key), hasFbo);
    };
    for (const [key, s] of bridge.state.all()) s.phase = phaseOf(key);

    bridge.renderAssert.begin();
    try {
      for (const [key, s] of bridge.state.all()) {
        const e = key as Entity;
        const island = bridge.islandFor(e);
        // Unmounted (culled, or T2-frozen): render nothing and KEEP the target.
        // Residency keeps the handle too — retention is not cull — so coming
        // back is a hit rather than a re-wake.
        if (island === undefined) continue;
        const handle = handleOf(e);
        if (handle === NO_TEXTURE) continue; // no destination this frame
        const entry = table.describe(handle);
        if (entry === undefined || entry.kind !== "own") continue; // not a private target: not ours

        // BACKED OFF (D-C4.7). The table refused this exact handle and neither
        // it nor the residency's revision has moved since, so the render below
        // would allocate a full target, paint it, be refused again and destroy
        // it — every flush, forever. Skip the card whole: it stays UNPAINTED
        // and draws the plate, which is the honest picture, and it retries the
        // moment the world names a new handle or the residency says something
        // changed.
        const back = refused.get(e);
        if (back !== undefined) {
          if (back.handle === handle && back.revision === sink.revision?.()) {
            skippedRefused += 1;
            continue;
          }
          refused.delete(e); // a new handle, or the residency moved: try again
        }

        const demand = world.get(e, SurfaceDemand);
        if (demand?.mode === "paused") {
          skippedPaused += 1;
          continue;
        }

        // A destination with no target yet is FRESH: nothing has written it, so the
        // card is drawing the plate until this render lands (§10.2).
        const fresh = !targets.has(handle);
        if (!islandPaintable(s, { zoom: cam.zoom, inMotion, frozen })) continue;

        // Animation time is owed to every paint-ELIGIBLE Hot island, rendered
        // this flush or clamped below — the deferred render delivers the
        // balance, so the clamp changes cadence, never speed.
        if (s.phase === "Hot") owed.set(e, (owed.get(e) ?? 0) + dtMs);

        // The demand clamp (design-013 D10), which the old pass never read.
        const last = lastRenderAt.get(e);
        const interval = demandIntervalMs({
          mode: demand?.mode ?? "live",
          // The cell is a u8; `toFpsBucket` is the narrowing the contract owns — it rounds
          // DOWN, so an already-bucketed value is itself and a hand-written one cannot buy a
          // rate it did not ask for.
          fpsBucket: toFpsBucket(demand?.fpsBucket ?? 60),
          interactive: demand?.interactive ?? false,
        });
        // A fresh destination outranks the bucket: a clamped island must not show the
        // plate for an interval because it was resized.
        if (!fresh && last !== undefined && t - last < interval - DEMAND_SLACK_MS) {
          skippedBudget += 1;
          continue;
        }

        const size = world.get(e, Size);
        if (size === undefined || size.w <= 0 || size.h <= 0) continue;
        const rt = ensureTarget(handle, entry);
        if (rt === undefined) continue;

        // Hot content ticks exactly when it renders — the attribution contract —
        // and receives the FULL time owed since its last tick.
        if (s.phase === "Hot") {
          const owedMs = owed.get(e) ?? 0;
          owed.set(e, 0);
          for (const cb of bridge.frameCallbacksFor(e)) cb(owedMs);
        }

        // The island's ortho camera is centre-origin and Y-up over the card's
        // WORLD box; the target's resolution is Residency's business, so the
        // frustum never mentions it (design-004 §3, kernel Law 13).
        const camera = island.camera;
        camera.left = -size.w / 2;
        camera.right = size.w / 2;
        camera.top = size.h / 2;
        camera.bottom = -size.h / 2;
        camera.updateProjectionMatrix();

        gl.setRenderTarget(rt);
        try {
          // A throwing island must not leave its target bound — that would
          // corrupt the next pass into it (v1 lesson, kept).
          gl.clear();
          gl.render(island.scene, island.camera);
        } finally {
          gl.setRenderTarget(null);
        }

        // The RESOLVE texture (single-sampled — three names the multisample
        // surface separately and resolves into this one), realised as a
        // PRODUCER's object: the residency only forgets it, and `onForget`
        // above is where it dies.
        const texture = islandTexture(opts.renderer(), rt.texture);
        if (texture === undefined) {
          // NOT a refusal — the backend has not resolved this render target
          // yet, and resolving is exactly what the next frames are for. No
          // backoff here: nothing bumps a revision when an async allocation
          // lands, so backing off would strand the island on the plate for
          // good (the B9 arm, unchanged).
          disposeTarget(handle); // fresh again: the next flush renders, nothing is marked painted
          unrealised += 1;
          continue;
        }
        if (!sink.realize(handle, texture, { owned: false })) {
          // THE TABLE REFUSED (D-C4.7): a decision, not a delay. Repeating it
          // per frame buys nothing, so record the handle + revision and stand
          // down until one of them moves.
          disposeTarget(handle);
          unrealised += 1;
          refused.set(e, { handle, revision: sink.revision?.() });
          continue;
        }
        refused.delete(e); // realised: whatever was refused here is history
        sink.wrote(e); // every render: this IS the touch that wakes the ground
        lastRenderAt.set(e, t);
        const band = world.get(e, SurfaceBand)?.band ?? selectBand(cam.zoom);
        bridge.state.markPainted(e, {
          w: entry.width ?? 0,
          h: entry.height ?? 0,
          dpr: vp.dpr > 0 ? vp.dpr : 1,
          band,
        });
        rendered += 1;
      }
    } finally {
      bridge.renderAssert.end();
    }
  };

  const reflector = { name: "island-render", flush };
  content.renders.island.current = reflector;

  return {
    reflector,
    stats: () => ({
      rendered,
      targets: targets.size,
      disposed,
      skippedPaused,
      skippedBudget,
      unrealised,
      skippedRefused,
    }),
    targetOf: (handle) => targets.get(handle),
    dispose() {
      unforget();
      if (content.renders.island.current === reflector) content.renders.island.current = null;
      for (const handle of [...targets.keys()]) disposeTarget(handle);
      lastRenderAt.clear();
      owed.clear();
      refused.clear();
    },
  };
}
