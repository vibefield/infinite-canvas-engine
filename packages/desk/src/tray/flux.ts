// THE TRAY'S FLUX (design-017 §3; K3) — the pegboard drawer's motion, which lives in the renderer and nowhere else: the SLIDE (a tween
// on widgetlab rev 1's curve from wherever the drawer is to where the fact says, on the frame's clock — a reversal starts again from
// where it is, as a CSS transition does), the LIP's lift (a critically damped spring toward the hover fact), and the BAND's settle
// (the shown band tracks the fact's pull exactly while there is one; when the fact lets go a spring carries it home). `live()` while
// any of them moves; a drawer at rest is not live, so the desk sleeps. The facts are core's `Tray` (read, never written here); the
// flux publishes the drawer AS DRAWN — its rect, its slide, the layout's scroll range — for core's input to hit-test (the pose seam).
// Pins hold it for a still: the slide, the lift, the band, or the whole tray hidden (a scene that is not about it).

import type { TrayScreenFrame } from "@ice/core";
import { settled, spring } from "../kit/springs";
import { band, DRAWER, drawerRect, scrollRange, slideEase } from "./drawer";
import type { TrayFrameInputs } from "./pass";

/** The facts the flux follows (core's `Tray`, as read). */
export interface TrayFacts {
  readonly open: boolean;
  readonly scroll: number;
  readonly stretch: number;
  readonly lip: boolean;
}

/** A still's pins (a rig's, the oracle's): the slide, the lip's lift, the band's shown pull; `hidden` — no tray at all. Absent keys follow the facts. */
export interface TrayPin {
  readonly p?: number;
  readonly lift?: number;
  readonly band?: number;
  readonly hidden?: boolean;
}

/** What the flux holds, for a rig: the facts it last read, the slide and when (frame clock, ms) its tween began (−1: not yet stepped), the lift, the shown band, whether it moves. */
export interface TrayFluxState {
  readonly facts: TrayFacts | null;
  readonly p: number;
  readonly since: number;
  readonly lift: number;
  readonly band: number;
  readonly live: boolean;
}

export interface TrayFlux {
  /** Read the world's facts (undefined: no tray); true when they changed since the last read — a frame is due. */
  read(facts: TrayFacts | undefined): boolean;
  /** Step the motion to `now` (the frame's clock, ms) for a view `vw × vh` and return the frame's tray — undefined when hidden or absent. */
  step(now: number, vw: number, vh: number): TrayFrameInputs | undefined;
  /** Something still moves: the next frame paints too. */
  live(): boolean;
  /** The drawer as the last step laid it (the pose seam's answer). */
  frame(): TrayScreenFrame | undefined;
  pin(pin: TrayPin | null): void;
  state(): TrayFluxState;
}

const EPS = 1e-4;

export function createTrayFlux(): TrayFlux {
  let facts: TrayFacts | null = null;
  // the slide's tween: from `from` toward `to`, started at `t0` (−1: not yet stepped since the fact moved)
  let p = 0;
  let from = 0;
  let to = 0;
  let t0 = -1;
  let lift = 0;
  let liftV = 0;
  let shown = 0;
  let shownV = 0;
  let last = -1;
  let pinned: TrayPin | null = null;
  let drawn: TrayScreenFrame | undefined;
  let moving = false;

  return {
    read(f) {
      if (f === undefined) { const had = facts !== null; facts = null; return had; }
      const was = facts;
      if (was !== null && was.open === f.open && was.scroll === f.scroll && was.stretch === f.stretch && was.lip === f.lip) return false;
      facts = { open: f.open, scroll: f.scroll, stretch: f.stretch, lip: f.lip };
      const target = f.open ? 1 : 0;
      if (target !== to) { from = p; to = target; t0 = -1; }
      return true;
    },

    step(now, vw, vh) {
      const f = facts;
      if (f === null || pinned?.hidden === true) { drawn = undefined; moving = false; return undefined; }
      const dt = last < 0 ? 0 : Math.min(Math.max(now - last, 0), 50) / 1000;
      last = now;
      // the slide, on the drawer's curve
      if (t0 < 0) t0 = now;
      const k = Math.min(Math.max((now - t0) / DRAWER.slideMs, 0), 1);
      p = from + (to - from) * slideEase(k);
      const sliding = from !== to && k < 1;
      if (k >= 1) from = to;   // a finished tween is at rest where it ended
      // the lip's lift (closed only: open, the lip is the drawer)
      [lift, liftV] = spring(lift, liftV, f.lip && !f.open ? 1 : 0, DRAWER.liftHz, 1, dt);
      const lifting = !settled(lift, liftV, f.lip && !f.open ? 1 : 0, EPS);
      if (!lifting) { lift = f.lip && !f.open ? 1 : 0; liftV = 0; }
      // the band: tracks the pull exactly while the fact holds one; carried home by its spring when it lets go
      let settling = false;
      if (f.stretch !== 0) { shown = band(f.stretch); shownV = 0; }
      else if (shown !== 0) {
        [shown, shownV] = spring(shown, shownV, 0, DRAWER.band.hz, 1, dt);
        settling = !settled(shown, shownV, 0, EPS);
        if (!settling) { shown = 0; shownV = 0; }
      }
      moving = sliding || lifting || settling;
      const P = pinned;
      const pp = P?.p ?? p;
      const pl = P?.lift ?? lift;
      const pb = P?.band ?? shown;
      const rect = drawerRect(vw, vh, pp, pl);
      drawn = { x: rect.x, y: rect.y, w: rect.w, h: rect.h, p: pp, max: scrollRange(vw, vh), pitch: DRAWER.pitch, scroll: f.scroll + pb };
      return { p: pp, lift: pl, scroll: f.scroll + pb };
    },

    live: () => moving && pinned === null,
    frame: () => drawn,
    pin(pin) { pinned = pin; },
    state: () => ({ facts, p, since: t0, lift, band: shown, live: moving }),
  };
}
