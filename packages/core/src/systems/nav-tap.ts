/**
 * The ENTER GESTURE (design-015 §9; D2b) — a double-tap on a `Container` asks to enter it, a
 * double-tap on the bare frame asks to leave. `ctl:behave`, after `selectBehavior`: the first
 * tap SELECTS at once (the prototype's click), the second — the same target, within
 * `multiTapWindowMs`, within `multiTapSlopPx` — is the gesture. Detected from two INSTANT
 * taps (each Recognized at count 1) held in `NavTapMemo`, not from a `MultiTap(2)` opt-in on
 * the target: that machinery parks the first tap Pending for the whole window, so a plain
 * click on a container would select 280 ms late — a latency the prototype never had (its
 * first click selected, its dblclick entered). `MultiTap` stays what it is for widgets that
 * want a counted tap.
 *
 * The op itself is NOT run here: `enterContainer` spawns, writes tags and rebuilds the index —
 * structural writes, illegal mid-tick. The gesture writes the one-tick `NavIntent` fact and the
 * facade applies it once `engine.step` returns (nav-geometry.ts). A tap on a PART (`DownPart`)
 * is the app's and never counts; a tap while a flight drives is not a double-tap's first half
 * (the flight yields to nothing but a camera gesture).
 */
import type { Entity, System, World } from "@vibecook/strata-ecs";
import { defineQuery, defineSystem, field } from "@vibecook/strata-ecs";
import { CanvasSurface } from "../catalog/camera-derived";
import { HeldIntent } from "../catalog/desk";
import { Captures, Down, DownPart, GesturePhases as P, Tap, Watches } from "../catalog/gesture";
import { Container } from "../catalog/graph";
import { PointerButtons } from "../catalog/pointer";
import { GestureSettings } from "../catalog/settings-resources";
import { FrameInfo } from "../engine/frame-info";
import { currentNavEntry } from "../nav/nested-canvas";
import { NavIntent } from "../nav/nav-geometry";
import { NavTransition } from "./nav-flight";
import { defineResource } from "../schema/meta";
import { GESTURE_DEFAULTS } from "../settings/defaults";

/** The last instant tap: its target (0 = the bare frame), where and when — the double-tap's first half. */
export const NavTapMemo = defineResource(
  "NavTapMemo",
  {
    target: field("eid", { default: 0 as Entity }),
    x: field("f64", { default: 0 }),
    y: field("f64", { default: 0 }),
    at: field("f64", { default: 0 }),
    /** Bumps per tap seen; 0 = no memo. */
    seq: field("u32", { default: 0 }),
  },
  { durable: false },
);

const tapRecognizedQ = defineQuery([Tap, P.justTags.Recognized]);

export interface NavTapOpts {
  /** Is this entity a container the engine may enter (the facade's catalog-backed test)? Default: the `Container` tag. */
  readonly isContainer?: (entity: Entity) => boolean;
  /**
   * Is this entity an object that OPENS (design-015 §8, D4b — the facade's catalog-backed test: its widget type
   * declares `openable`)? A double-tap on one asks to pick it up (`HeldIntent`), not to enter it. Default: nothing opens.
   */
  readonly isOpenable?: (entity: Entity) => boolean;
}

export function createNavTap(world: World, opts: NavTapOpts = {}): System {
  const isContainer = opts.isContainer ?? ((e: Entity): boolean => world.hasTag(e, Container));
  const isOpenable = opts.isOpenable ?? ((): boolean => false);
  return defineSystem(
    tapRecognizedQ,
    (b, ctx) => {
      for (const r of b) {
        const rec = b.entity(r);
        // a tap on a part is the app's (design-014 B3b) — it neither counts nor clears the memo
        if ((ctx.get(rec, DownPart)?.part ?? "") !== "") continue;
        // a tap while a flight drives is not a double-tap's first half (the header; D7 #12): the arriving desk is not yet
        // where the eye has it, so it neither counts nor pairs — the memo is spent, a tap after the landing starts afresh
        if (world.getResource(NavTransition)?.active === true) {
          world.setResource(NavTapMemo, { target: 0 as Entity, x: 0, y: 0, at: 0, seq: 0 });
          continue;
        }
        const down = ctx.read(rec, Down);
        const captured = ctx.getRelation(rec, Captures);
        // the bare frame: no target, or the canvas surface entity picking falls back to
        const bare = captured === undefined || ctx.hasTag(captured, CanvasSurface);
        const target = bare ? (0 as Entity) : captured;
        const gs = world.getResource(GestureSettings);
        const windowMs = gs?.multiTapWindowMs ?? GESTURE_DEFAULTS.multiTapWindowMs;
        const slopPx = gs?.multiTapSlopPx ?? GESTURE_DEFAULTS.multiTapSlopPx;
        // The tap's time is its down EVENT's own (K9 S6 — K-H's product call): the pointer this recognizer watches carries
        // `PointerButtons.downMs` = the adapter's `e.timeStamp` (l0-input), kept through the release — so a main-thread stall
        // between two taps (their frames 400 ms apart, their events 110) still pairs them, and two events 400 ms apart on adjacent
        // frames do not. 0 (a synthetic input with no time) falls back to the frame's `now`; never the frame CLOCK (its dt is
        // clamped, and the loop sleeps between taps — taps seconds apart could pair).
        const watched = ctx.getRelations(rec, Watches)[0];
        const downMs = watched !== undefined && ctx.isAlive(watched) ? (ctx.get(watched, PointerButtons)?.downMs ?? 0) : 0;
        const now = downMs !== 0 ? downMs : (world.getResource(FrameInfo)?.now ?? down.ms);
        const memo = world.getResource(NavTapMemo);
        const seq = (memo?.seq ?? 0) + 1;
        const pairs =
          memo !== undefined &&
          memo.seq > 0 &&
          memo.target === target &&
          now - memo.at <= windowMs &&
          Math.hypot(down.x - memo.x, down.y - memo.y) <= slopPx;
        if (!pairs) {
          world.setResource(NavTapMemo, { target, x: down.x, y: down.y, at: now, seq });
          continue;
        }
        // the second tap: the gesture. The memo is spent either way (a third tap starts afresh).
        world.setResource(NavTapMemo, { target: 0 as Entity, x: 0, y: 0, at: 0, seq: 0 });
        const prev = world.getResource(NavIntent);
        const epoch = (prev?.epoch ?? 0) + 1;
        if (!bare) {
          if (!ctx.isAlive(target)) continue;
          // an OPENABLE object is picked up (design-015 §8): its kind declared an opening, the more specific word
          if (isOpenable(target)) {
            const held = world.getResource(HeldIntent);
            world.setResource(HeldIntent, { kind: "open", target, epoch: (held?.epoch ?? 0) + 1 });
            continue;
          }
          if (!isContainer(target)) continue;
          world.setResource(NavIntent, { kind: "enter", target, transition: "zoom", source: "tap", epoch });
        } else if (currentNavEntry(world) !== undefined) {
          world.setResource(NavIntent, { kind: "exit", target: 0 as Entity, transition: "zoom", source: "tap", epoch });
        }
      }
    },
    { name: "navTap" },
  );
}
