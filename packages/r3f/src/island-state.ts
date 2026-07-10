/**
 * Module-side island render state (design-004 §3 fix #3: ZERO render→ECS
 * writes — v1 kept this as an ECS component `R3FRenderState` and wrote it
 * from inside `useFrame`, which the engine laws ban; band/generation/paint
 * bookkeeping now lives here, outside the world entirely).
 *
 * One entry per GL widget the compositor has ever touched this session.
 * Entries OUTLIVE island unmount (cull) — that is the retention decoupling:
 * a culled widget's entry keeps its `fboGeneration`/`paintedAt` so re-entry
 * composites from the retained texture (phase Warm) instead of re-waking.
 * Entries die only on entity death, world reset, or `drop()`.
 *
 * Pure state + counters; no three.js, no ECS, no timing — the GLViews frame
 * pass reads/writes it synchronously.
 */
import type { IslandPhase } from "@ice/kernel";

/** Resolution + band an island's FBO was last painted at (v1 `paintedAt`). */
export interface PaintedAt {
  readonly w: number;
  readonly h: number;
  readonly dpr: number;
  /** The zoom BAND painted at (not live zoom) — hysteresis compares against it. */
  readonly band: number;
}

export interface IslandRenderState {
  phase: IslandPhase;
  /** Bumped by dirt (props Tier-3, size dirt, manual invalidate). */
  paintGeneration: number;
  /** Generation last painted into the FBO; -1 = no valid texture (fresh or evicted). */
  fboGeneration: number;
  paintedAt: PaintedAt;
  /** Live `useIslandFrame` subscriptions (animation signal while > 0). */
  animRefs: number;
  /** The widget type declared `animated` (repaint every visible frame). */
  animatedDecl: boolean;
}

const FRESH_PAINTED_AT: PaintedAt = { w: 0, h: 0, dpr: 1, band: 0 };

export interface IslandStateStore {
  /** Get-or-create (Cold, unpainted). */
  ensure(key: number): IslandRenderState;
  get(key: number): IslandRenderState | undefined;
  all(): IterableIterator<[number, IslandRenderState]>;
  /** Island dirt: the next frame pass must repaint this island. */
  bumpPaint(key: number): void;
  markPainted(key: number, at: PaintedAt): void;
  /** FBO released (eviction/death): the quad hides until first repaint. */
  markEvicted(key: number): void;
  addAnimRef(key: number): void;
  removeAnimRef(key: number): void;
  /** Animation signal: declared `animated` OR any live `useIslandFrame`. */
  isAnimating(key: number): boolean;
  setAnimatedDecl(key: number, animated: boolean): void;
  drop(key: number): void;
  clear(): void;
}

export function createIslandStateStore(): IslandStateStore {
  const entries = new Map<number, IslandRenderState>();

  const ensure = (key: number): IslandRenderState => {
    let s = entries.get(key);
    if (s === undefined) {
      s = {
        phase: "Cold",
        paintGeneration: 0,
        fboGeneration: -1,
        paintedAt: FRESH_PAINTED_AT,
        animRefs: 0,
        animatedDecl: false,
      };
      entries.set(key, s);
    }
    return s;
  };

  return {
    ensure,
    get: (key) => entries.get(key),
    all: () => entries.entries(),
    bumpPaint(key) {
      ensure(key).paintGeneration += 1;
    },
    markPainted(key, at) {
      const s = ensure(key);
      s.fboGeneration = s.paintGeneration;
      s.paintedAt = at;
    },
    markEvicted(key) {
      const s = entries.get(key);
      if (s !== undefined) s.fboGeneration = -1;
    },
    addAnimRef(key) {
      ensure(key).animRefs += 1;
    },
    removeAnimRef(key) {
      const s = entries.get(key);
      if (s !== undefined && s.animRefs > 0) s.animRefs -= 1;
    },
    isAnimating(key) {
      const s = entries.get(key);
      return s !== undefined && (s.animatedDecl || s.animRefs > 0);
    },
    setAnimatedDecl(key, animated) {
      ensure(key).animatedDecl = animated;
    },
    drop(key) {
      entries.delete(key);
    },
    clear() {
      entries.clear();
    },
  };
}
