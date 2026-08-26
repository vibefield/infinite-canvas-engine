/**
 * Magnet pole sources (design-010 §3.3, decision D5): the grid pass is
 * CURSOR-AGNOSTIC — point field sources enter through this injected protocol,
 * never through pass-known vocabulary. No source wired ⇒ no subscription, no
 * reads, widget-only field. The canned helpers below are where any cursor
 * dependency lives; the pass imports NEITHER — apps compose what fits
 * (vibe-field wraps its own `Cur` halo the same way, in its own repo).
 */
import {
  CursorVisual,
  defineQuery,
  LocalPointer,
  Pointer,
  PointerWorld,
  Position,
  type World,
} from "@ice/core";

/**
 * One point field source. Packed as a degenerate rounded-box SDF (half = 0,
 * r = 0), which reduces exactly to the point-charge formula (design-010 D3).
 * `space` defaults to "world"; "screen" is CSS px — zero-conversion for
 * screen-space cursors (field evaluation is screen-space anyway).
 */
export interface Pole {
  readonly x: number;
  readonly y: number;
  /** Relative field strength; ≤ 0 poles are skipped at pack time. */
  readonly strength: number;
  readonly space?: "world" | "screen";
}

export interface PoleSource {
  /** Called during collect — read-only world access (GroundPass.collect rules). */
  read(world: World): readonly Pole[];
  /**
   * Called during arm — `wake` marks the wired magnet grid dirty. The classic
   * implementation never subscribes. Returns an unsubscriber.
   */
  subscribe(world: World, wake: () => void): () => void;
}

const localPointerQ = defineQuery([Pointer, PointerWorld, LocalPointer]);

/**
 * Poles from the local pointer entity (`LocalPointer` + `PointerWorld`) — the
 * raw-cursor wiring for apps without their own cursor visual. World-space; one
 * pole per local pointer (multi-touch yields one per finger while pressed).
 */
export function localPointerPoles(opts: { readonly strength?: number } = {}): PoleSource {
  const strength = opts.strength ?? 1;
  return {
    read(world) {
      const out: Pole[] = [];
      world.query(localPointerQ).each((b) => {
        for (const r of b) {
          const p = world.read(b.entity(r), PointerWorld);
          out.push({ x: p.x, y: p.y, strength, space: "world" });
        }
      });
      return out;
    },
    subscribe(world, wake) {
      return world.reactive.observeQuery(localPointerQ, wake, { cols: [PointerWorld] });
    },
  };
}

const cursorVisualQ = defineQuery([Position, CursorVisual]);

/**
 * Poles from cursor-visual entities (`Position` + `CursorVisual`) — presence
 * apps: remote collaborators' pooled cursors (core `remote-cursors.ts`) drive
 * the field. This helper is where the CursorVisual dependency lives (D5).
 */
export function cursorVisualPoles(opts: { readonly strength?: number } = {}): PoleSource {
  const strength = opts.strength ?? 1;
  return {
    read(world) {
      const out: Pole[] = [];
      world.query(cursorVisualQ).each((b) => {
        for (const r of b) {
          const p = world.read(b.entity(r), Position);
          out.push({ x: p.x, y: p.y, strength, space: "world" });
        }
      });
      return out;
    },
    subscribe(world, wake) {
      return world.reactive.observeQuery(cursorVisualQ, wake, { cols: [Position] });
    },
  };
}
