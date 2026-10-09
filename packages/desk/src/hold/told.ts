// THE HAND'S INPUT, TOLD (design-019 §5 · §13.2, M24 LT2): while an object is in hand, its kind is TOLD what the hand did with it —
// `KindLocal.held(e, events)` — instead of reading core's pointer components (a plugin kind reaches the desk through `/desk`, `/desk/kit`
// and `/desk/engine` alone). The desk derives the events from what core already writes each tick — `HeldPointer` (the pointer in the
// held extent's units, through the pose the renderer drew, and the kind's part under it), `HeldPress` (a press that began in hand: whose
// it is, its click count) and `HeldWheel` (the kind's wheel) — never a second input path: the adapters only enqueue, core folds, the
// desk reads the folded facts once a frame (the layer's flush, after the drivers, before the kinds' ticks).
//
// The cut (core l0-input.ts) lands a press and its release in separate ticks, and the desk's reflector flushes every step, so a press
// is seen to BEGIN (its `HeldPress` appears — or is replaced: a new down's own time and point) and to END (it leaves) one frame each.
// A press on the object is the kind's to know — on a named part, on its content or frame, a tool's stroke; a pan and a press on the
// soft desk are the HAND's, never told, nor their moves. Pure over the world: it writes nothing.

import { defineQuery, type Entity, HeldPointer, HeldPress, HeldWheel, heldEntity, LocalPointer, Pointer, PointerButtons, type World } from "@ice/core";
import type { HeldEvent } from "../kinds/world";

/** The presses the HAND takes for itself: a pan (the middle button, Space) and a press on the soft desk. */
const HANDS: ReadonlySet<string> = new Set(["pan", "desk"]);

/** What the fold last saw of one pointer: where it was in the held extent, over which part, its buttons, its press, its wheel's `seq`. */
interface Seen {
  x: number;
  y: number;
  part: string | null;
  buttons: number;
  /** The press in progress: its identity (its down's own time and point, its count), whether the kind is told it, its count. */
  press: { readonly sig: string; readonly told: boolean; readonly count: number } | undefined;
  wheel: number;
}

/** One object's events for one frame. */
export interface HeldTold {
  readonly entity: Entity;
  readonly events: readonly HeldEvent[];
}

export interface HeldFold {
  /**
   * This frame's events — for the object in hand when something happened, and for the object the hand just LET GO of when a press of
   * its kind was still down (its `up`, where the pointer was last). Empty when nothing happened or nothing is held.
   */
  step(): readonly HeldTold[];
}

const pointersQ = defineQuery([Pointer, LocalPointer, HeldPointer]);

export function createHeldFold(world: World): HeldFold {
  let holding: Entity | undefined;
  const seen = new Map<Entity, Seen>();
  const up = (s: Seen): HeldEvent => ({ type: "pointer", phase: "up", x: s.x, y: s.y, part: s.part, button: 0, buttons: 0, count: s.press?.count ?? 1 });
  return {
    step() {
      const out: HeldTold[] = [];
      const held = heldEntity(world);
      if (holding !== undefined && holding !== held) {
        // the hand let go (or took another): a press of the kind's still down is told its `up`, so a source never keeps a button held
        const ups = [...seen.values()].filter((s) => s.press?.told === true).map(up);
        if (ups.length > 0 && world.isAlive(holding)) out.push({ entity: holding, events: ups });
        seen.clear();
      }
      holding = held;
      if (held === undefined) return out;
      const events: HeldEvent[] = [];
      const present = new Set<Entity>();
      world.query(pointersQ).each((b) => {
        for (const r of b) {
          const p = b.entity(r);
          present.add(p);
          const hp = world.read(p, HeldPointer);
          const part = hp.part === "" ? null : hp.part;
          const pb = world.get(p, PointerButtons);
          const raw = pb?.buttons ?? 0;
          const pr = world.get(p, HeldPress);
          const wheel = world.get(p, HeldWheel)?.seq ?? 0;
          // a press is ONE press until its HeldPress leaves — or is replaced by a new down (its own time, point and count)
          const sig = pr === undefined ? "" : `${pb?.downMs ?? 0}|${pr.x}|${pr.y}|${pr.count}`;
          let s = seen.get(p);
          if (s === undefined) {
            // first seen in this hold: nowhere yet (its first sample is a move), and the wheel as it stands (a wheel waits for the
            // pickup to settle, so none is lost)
            s = { x: Number.NaN, y: Number.NaN, part, buttons: raw, press: undefined, wheel };
            seen.set(p, s);
          }
          const press = s.press;
          const ended = press !== undefined && press.sig !== sig;
          const began = pr !== undefined && press?.sig !== sig;
          const pressing = press !== undefined && !ended ? press : undefined;
          // between presses only a pointer with no button held is the kind's to follow — a secondary's press (a point, I28) and one held
          // since before the hold (the click that opened it) are not; during a press, the press's owner's
          const told = pressing !== undefined ? pressing.told : raw === 0;
          // a primary press's mask is never empty (a synthetic down that names no button is the primary's — core's pressButton)
          const buttons = pressing?.told === true && raw === 0 ? 1 : raw;
          // the frame's move — one sample — unless a transition carries the point this frame (the cut: a down or an up IS where it was)
          if (!ended && !began && told && (hp.x !== s.x || hp.y !== s.y || part !== s.part || buttons !== s.buttons)) {
            events.push({ type: "pointer", phase: "move", x: hp.x, y: hp.y, part, button: -1, buttons, count: 0 });
          }
          if (wheel !== s.wheel) {
            const w = world.get(p, HeldWheel);
            if (w !== undefined) events.push({ type: "wheel", x: hp.x, y: hp.y, dx: w.dx, dy: w.dy });
            s.wheel = wheel;
          }
          s.x = hp.x;
          s.y = hp.y;
          s.part = part;
          s.buttons = buttons;
          if (ended) {
            if (press.told) events.push(up(s));
            s.press = undefined;
          }
          if (began) {
            const mine = !HANDS.has(pr.kind);
            s.press = { sig, told: mine, count: pr.count };
            if (mine) events.push({ type: "pointer", phase: "down", x: hp.x, y: hp.y, part, button: 0, buttons: raw === 0 ? 1 : raw, count: pr.count });
          }
        }
      });
      // a pointer gone (a touch lifted, its entity let go): a press of the kind's still down is told its `up` where it was last
      for (const [p, s] of seen) {
        if (present.has(p)) continue;
        if (s.press?.told === true) events.push(up(s));
        seen.delete(p);
      }
      if (events.length > 0) out.push({ entity: held, events });
      return out;
    },
  };
}
