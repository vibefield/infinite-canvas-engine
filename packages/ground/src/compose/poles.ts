// Magnet POLES (design-010 §3.3, decision D5; design-013 §8 C2, D-C2.2): the
// point sources an app injects into the field — its cursor halo, a remote
// collaborator's cursor, anything that should bend the lattice and is not a
// card. The field is CURSOR-AGNOSTIC: a pole enters through this protocol,
// never through vocabulary the ground knows. No source wired ⇒ no
// subscription, no reads, a card-only field. The canned helpers below are
// where any cursor dependency lives; the host imports NEITHER — apps compose
// what fits (widgetlab wraps its own `Cur` halo the same way, in `halo-poles`).
//
// Moved onto the engine at C2 from the old leg's `poles.ts` (pure, unchanged
// in shape) with one addition: `Pole.pointer`. The engine's cursor is ANALYTIC
// inside the glyph pass (`magnet.wgsl` `field_at_site`) so pointer motion
// never re-bakes the atlas, and the bake key hashes the packed sources. So a
// pole that IS the local pointer rides the field's `pointer` input, and every
// other pole becomes a degenerate `FieldSource` — a rounded box with zero
// half extents and zero radius, which the field maths reduce exactly to the
// point-charge formula (design-010 D3). `packPoles` is that split.

import {
  CursorVisual,
  defineQuery,
  LocalPointer,
  Pointer,
  PointerScreen,
  Position,
  type World,
} from "@ice/core";
import type { FieldSource } from "../field/layout";
import type { CameraState } from "../nav/flight";

/**
 * One point field source. `space` defaults to "world"; "screen" is CSS px —
 * zero-conversion for screen-space cursors (the field evaluates in screen
 * space anyway).
 */
export interface Pole {
  readonly x: number;
  readonly y: number;
  /** Relative field strength; ≤ 0 poles are skipped at pack time. */
  readonly strength: number;
  readonly space?: "world" | "screen";
  /**
   * This pole IS the local pointer (D-C2.2): it rides the field's analytic
   * cursor term — its motion redraws but never re-bakes — instead of the
   * source buffer. One pointer per frame: the first flagged pole in read order
   * is the pointer; any further flagged pole packs as a source like the rest.
   */
  readonly pointer?: boolean;
}

export interface PoleSource {
  /** Called on a dirty frame — read-only world access (the reflector contract: never writes ECS). */
  read(world: World): readonly Pole[];
  /**
   * Called once at the mount — `wake` marks the ground dirty. Returns the unsubscriber. An
   * OUT-OF-WORLD source (a halo's ease, a socket's cursor) is what this is for; a source whose
   * poles are world facts should PULL instead (`changed`) and return an inert disarm here.
   */
  subscribe(world: World, wake: () => void): () => void;
  /**
   * The world's dirt for this source, PULLED (D-C4.9): the host drains it EVERY tick, beside the
   * builder's and the overlays', and a `true` marks the ground dirty. Optional — a source with no
   * world facts to watch has nothing to answer.
   *
   * It exists because a Tier-1 `observeQuery` on the hot columns is not a wake but a heartbeat: a
   * system that DECLARES a write on `Position` stamps the whole column every tick it runs, whether
   * or not it wrote, and every Tier-1 observer of that column then fires. A change collector sees
   * the writes themselves.
   */
  changed?(world: World): boolean;
}

/** The analytic cursor's inputs for one frame (`FieldFrame.pointer`): screen CSS px, on/off, its strength. */
export interface PointerInput {
  readonly x: number;
  readonly y: number;
  readonly on: boolean;
  readonly strength: number;
}

export const NO_POINTER: PointerInput = { x: 0, y: 0, on: false, strength: 1 };

/** What `packPoles` makes of a frame's poles: the analytic pointer (or none) and the degenerate sources. */
export interface PackedPoles {
  readonly pointer: PointerInput;
  readonly sources: readonly FieldSource[];
}

/**
 * Split a frame's poles under the LIVE camera: the first pointer-flagged pole
 * onto the analytic term, the rest into `FieldSource`s in screen CSS px —
 * `{ cx, cy, hx: 0, hy: 0, r: 0, strength }`, the pack the old magnet grid
 * wrote as `[cx, cy, 0, 0, 0, strength, 0, 0]`. A pole at or under zero
 * strength is dropped. World poles project through the camera
 * (`(p − cam) · zoom`, coords.ts's one rule); screen poles are verbatim.
 */
export function packPoles(poles: readonly Pole[], cam: CameraState): PackedPoles {
  let pointer: PointerInput = NO_POINTER;
  const sources: FieldSource[] = [];
  for (const p of poles) {
    if (!(p.strength > 0)) continue;
    const screen = p.space === "screen";
    const x = screen ? p.x : (p.x - cam.x) * cam.zoom;
    const y = screen ? p.y : (p.y - cam.y) * cam.zoom;
    if (p.pointer === true && !pointer.on) {
      pointer = { x, y, on: true, strength: p.strength };
      continue;
    }
    sources.push({ cx: x, cy: y, hx: 0, hy: 0, r: 0, strength: p.strength });
  }
  return { pointer, sources };
}

const localPointerQ = defineQuery([Pointer, PointerScreen, LocalPointer]);

/**
 * Poles from the local pointer entity (`LocalPointer` + `PointerScreen`) — the
 * raw-cursor wiring for apps without their own cursor visual. SCREEN-space, one
 * pole per local pointer (multi-touch yields one per finger while pressed),
 * each flagged as the pointer — the first rides the analytic term.
 *
 * It reads the pointer's SCREEN cell, and both the value and the wake are
 * the pointer EVENT's — `PointerScreen`, which ingest writes only when the
 * adapter delivered one. Not `PointerWorld`, on two counts: core's
 * `pointerWorldSync` rewrites that cell every tick a pointer exists (screen ×
 * camera, unconditionally), so a subscription on it is a frame per tick for as
 * long as the cursor is over the window — the old leg's helper had exactly
 * that wake, and widgetlab never saw it because its halo pole settles — and it
 * LAGS the event by a tick on the pointer's spawn (the derive runs before the
 * structural spawn lands), so a frame woken by the event would read a stale
 * world position. The field evaluates its cursor in screen px anyway (the
 * analytic term is a screen point in every slot), so a screen pole is the exact
 * input with no camera between; a camera move leaves it where it is on screen,
 * and is a wake of the ground's own.
 */
export function localPointerPoles(opts: { readonly strength?: number } = {}): PoleSource {
  const strength = opts.strength ?? 1;
  return {
    read(world) {
      const out: Pole[] = [];
      world.query(localPointerQ).each((b) => {
        for (const r of b) {
          const p = world.read(b.entity(r), PointerScreen);
          out.push({ x: p.x, y: p.y, strength, space: "screen", pointer: true });
        }
      });
      return out;
    },
    subscribe(world, wake) {
      // The pointer's cell is EVENT-written (ingest writes it only when the adapter delivered one),
      // so this observer is idle-zero by construction and stays an observer (D-C4.9).
      return world.reactive.observeQuery(localPointerQ, wake, { cols: [PointerScreen] });
    },
  };
}

const cursorVisualQ = defineQuery([Position, CursorVisual]);

/**
 * Poles from cursor-visual entities (`Position` + `CursorVisual`) — presence
 * apps: remote collaborators' pooled cursors (core `remote-cursors.ts`) drive
 * the field. This helper is where the CursorVisual dependency lives (D5).
 * Remote cursors are SOURCES: each move is one bake, by design (D-C2.2).
 */
export function cursorVisualPoles(opts: { readonly strength?: number } = {}): PoleSource {
  const strength = opts.strength ?? 1;
  // The dirt is PULLED, never observed (D-C4.9). `Position` is the hot column: a chrome or drag
  // system that DECLARES a write on it stamps the column on every tick it runs, so a Tier-1
  // `observeQuery` here woke the ground every frame a selection existed — idle-zero with a live
  // remote cursor was witnessed nowhere. A `coarse: false` collector sees the WRITES. It is
  // deliberately not narrowed to the cursor entities: a card's move journals here too, and that is
  // a frame the builder was going to draw anyway — the same shape `compose/overlays.ts` collects on.
  type Collector = ReturnType<World["changes"]["collect"]>;
  let collector: Collector | null = null;
  const collect = (world: World): Collector => {
    collector ??= world.changes.collect({ components: [Position, CursorVisual], coarse: false });
    return collector;
  };
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
    changed(world) {
      const d = collect(world).drain();
      return d.reset || d.changed.length > 0 || d.coarse.length > 0 || d.removed.length > 0;
    },
    /** No observer — the host PULLS `changed` every tick. The mount's call is where the collector is armed, and the disarm is where it is released. */
    subscribe(world) {
      collect(world);
      return () => { collector?.dispose(); collector = null; };
    },
  };
}
