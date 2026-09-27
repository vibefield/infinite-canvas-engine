// THE CARRY (design-017 §9; K5b) — the take's motion, which lives in the renderer and nowhere else. The COPY lifted off the board: the
// object a take makes, under the grab point, following the pointer at ×1.06 of its specimen's scale (the lift a spring; the specimen stays
// hung — James: "the dragged away tile item now re-appears"). PUT BACK when the take ends in the drawer (a release there, the drawer shut
// under it): it glides onto its specimen at the specimen's scale and is gone — a put-down, widgetlab's glide. HANDED when it leaves the
// drawer: it holds its pose for the frame the insert ghost is spawned after, and the ghost then GROWS out of it about the grab point — the
// two coincide at the hand-off (the same pivot, the same scale: no pop) — on the drawer's own curve, drawn HERE, over the drawer and its
// dim, until it is its own size and the drawer has gone; the desk draws it from then on (the builder's `presented`). An insert ghost flying
// HOME (Esc, a rejected drop, a release back over the drawer) is drawn here too, SHRINKING to nothing as its tween flies it ("also shrink
// its size … along with the fly"). A PURE module: the facts are core's — `Tray`'s take and the insert ghosts in the world — read each
// frame; the out is POSES (a pivot on screen, a scale, a lift) that `carryViews` turns into views for the kinds' own records (K-L3).

import { settled, spring } from "../kit/springs";
import { DRAWER, slideEase } from "./drawer";

/** The carry's numbers: the lift's scale (widgetlab's ×1.06) and spring, the put-back's glide, the hand-off's patience, the grow's length. */
export const CARRY = {
  /** The copy at its full lift is this much larger than its specimen, about the grab point. */
  liftScale: 1.06,
  liftHz: 9,
  /** A take put back glides home in this long (widgetlab's 240 ms), on the drawer's curve. */
  backMs: 240,
  /** A handed copy waits this many frames for its ghost; none (the hand-off was refused), it is put back. */
  handFrames: 3,
  /** The ghost grows to its own size in the drawer's slide (340 ms, its curve): it is itself as the drawer is gone. */
  growMs: DRAWER.slideMs,
} as const;

/** The take as core holds it (`Tray`): the type lifted ("" none), the grab point across the object, the pointer, the hand-off count. */
export interface CarryFacts {
  readonly take: string;
  readonly u: number;
  readonly v: number;
  readonly x: number;
  readonly y: number;
  readonly handed: number;
}

/** A specimen as the board drew it this frame: its type, the scale its kind drew it at, its object's rect on screen (CSS px). */
export interface CarrySpecimen {
  readonly type: string;
  readonly zoom: number;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** An insert ghost in the world: its entity and type, its rect (world, top-left), whether it flies home and how far (its tween, 0 … 1). */
export interface CarryGhost {
  readonly entity: number;
  readonly type: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly retiring: boolean;
  readonly progress: number;
}

/** The desk's camera (world → screen: `(p − cam) · zoom`). */
export interface CarryCamera { readonly x: number; readonly y: number; readonly zoom: number }

/**
 * One carried object this frame. `ghost` — the insert ghost's entity (its rect is the world's, its props the world's), absent for a copy
 * (its rect its natural size about the origin, its props what one taken is made with). The object's point `(u, v)` across its rect lies at
 * `(px, py)` on screen, at `zoom` screen px per object unit; `lift` its hold (0 … 1).
 */
export interface CarryPose {
  /** The carried thing's id — stable from its lift to its put-back or its hand-off (a copy's record key). */
  readonly id: number;
  readonly type: string;
  readonly ghost?: number;
  readonly u: number;
  readonly v: number;
  readonly px: number;
  readonly py: number;
  readonly zoom: number;
  readonly lift: number;
  /** The phase, a rig's witness. */
  readonly phase: "lift" | "back" | "handing" | "grow" | "home";
}

type Item = { id: number } & (
  | { phase: "lift"; type: string; u: number; v: number; x: number; y: number; l: number; lv: number }
  | { phase: "back"; type: string; u: number; v: number; x: number; y: number; zoom: number; l: number; t0: number; to: { x: number; y: number; zoom: number } }
  | { phase: "handing"; type: string; u: number; v: number; x: number; y: number; zoom: number; l: number; frames: number }
  | { phase: "grow"; type: string; u: number; v: number; ghost: number; k0: number; t0: number; k: number }
  | { phase: "home"; type: string; ghost: number; k0: number });

export interface TrayCarry {
  /**
   * Step to `now` (frame clock, ms) with this frame's facts: the take (undefined: no tray), the specimens as drawn, the insert ghosts, the
   * camera, the drawer's slide `p` (the ghost is the desk's again once it is its own size and the drawer is gone). Returns the poses.
   */
  step(now: number, facts: CarryFacts | undefined, specimens: readonly CarrySpecimen[], ghosts: readonly CarryGhost[], cam: CarryCamera, p: number): readonly CarryPose[];
  /** The ghosts drawn here this frame — none of the desk's rows (the builder's `presented`). */
  presented(): ReadonlySet<number>;
  /** Something still moves: the next frame paints too. */
  live(): boolean;
  /** The types whose copy is up or on its way (their slots are made ahead of a hand-off — a composite kind's pass is made async). */
  types(): readonly string[];
  state(): { readonly poses: readonly CarryPose[]; readonly handed: number; readonly live: boolean };
}

const EPS = 1e-4;
const clamp01 = (x: number): number => Math.min(Math.max(x, 0), 1);

/** Where a specimen's point `(u, v)` is on screen, and its scale — a put-back's target. */
function homeOf(s: CarrySpecimen, u: number, v: number): { x: number; y: number; zoom: number } {
  return { x: s.x0 + u * (s.x1 - s.x0), y: s.y0 + v * (s.y1 - s.y0), zoom: s.zoom };
}

export function createTrayCarry(): TrayCarry {
  let items: Item[] = [];
  let ids = 0;
  let handed = -1;
  let last = -1;
  let moving = false;
  let poses: CarryPose[] = [];
  const presented = new Set<number>();
  /** Ghosts seen before: a handed copy grows into a NEW one. */
  const known = new Set<number>();
  /** Each specimen as last drawn: a put-back aims at it after the drawer has gone. */
  const lastSeen = new Map<string, CarrySpecimen>();

  return {
    step(now, facts, specimens, ghosts, cam, p) {
      const dt = last < 0 ? 0 : Math.min(Math.max(now - last, 0), 50) / 1000;
      last = now;
      moving = false;
      for (const s of specimens) lastSeen.set(s.type, s);
      const specimen = (type: string): CarrySpecimen | undefined => lastSeen.get(type);
      const lifted = items.find((i) => i.phase === "lift") as Extract<Item, { phase: "lift" }> | undefined;
      const zoomOf = (type: string, l: number): number => (specimen(type)?.zoom ?? 1) * (1 + (CARRY.liftScale - 1) * l);
      // THE HAND-OFF: `handed` bumped — the copy up (or, a flick that lifted and left in one event, the take as it left) holds its pose
      if (facts !== undefined && handed >= 0 && facts.handed > handed && facts.take !== "") {
        const l = lifted?.l ?? 0;
        if (lifted !== undefined) items = items.filter((i) => i !== lifted);
        items.push({ id: lifted?.id ?? ++ids, phase: "handing", type: facts.take, u: facts.u, v: facts.v, x: facts.x, y: facts.y, zoom: zoomOf(facts.take, l), l, frames: 0 });
      } else if (facts !== undefined && facts.take !== "") {
        // THE LIFT: the copy follows the pointer; its lift rises
        const cur = lifted !== undefined && lifted.type === facts.take ? lifted : undefined;
        if (cur === undefined) {
          if (lifted !== undefined) items = items.filter((i) => i !== lifted);
          items.push({ id: ++ids, phase: "lift", type: facts.take, u: facts.u, v: facts.v, x: facts.x, y: facts.y, l: 0, lv: 0 });
        } else { cur.x = facts.x; cur.y = facts.y; cur.u = facts.u; cur.v = facts.v; }
      } else if (lifted !== undefined) {
        // PUT BACK: the take ended in the drawer (or the drawer shut under it) — it glides onto its specimen
        const s = specimen(lifted.type);
        items = items.filter((i) => i !== lifted);
        if (s !== undefined) items.push({ id: lifted.id, phase: "back", type: lifted.type, u: lifted.u, v: lifted.v, x: lifted.x, y: lifted.y, zoom: zoomOf(lifted.type, lifted.l), l: lifted.l, t0: now, to: homeOf(s, lifted.u, lifted.v) });
      }
      if (facts !== undefined) handed = facts.handed;
      const byEntity = new Map(ghosts.map((g) => [g.entity, g] as const));
      const claimed = new Set<number>();
      for (const i of items) if (i.phase === "grow" || i.phase === "home") claimed.add(i.ghost);
      const next: Item[] = [];
      poses = [];
      for (const i of items) {
        if (i.phase === "lift") {
          const [l, lv] = spring(i.l, i.lv, 1, CARRY.liftHz, 1, dt);
          if (settled(l, lv, 1, EPS)) { i.l = 1; i.lv = 0; } else { i.l = l; i.lv = lv; moving = true; }
          next.push(i);
          poses.push({ id: i.id, phase: "lift", type: i.type, u: i.u, v: i.v, px: i.x, py: i.y, zoom: zoomOf(i.type, i.l), lift: i.l });
          continue;
        }
        if (i.phase === "back") {
          const s = specimen(i.type);
          const to = s !== undefined ? homeOf(s, i.u, i.v) : i.to;
          const k = slideEase(clamp01((now - i.t0) / CARRY.backMs));
          if (k >= 1) continue;   // home: the specimen under it is the same object at the same scale
          moving = true;
          next.push(i);
          poses.push({ id: i.id, phase: "back", type: i.type, u: i.u, v: i.v, px: i.x + (to.x - i.x) * k, py: i.y + (to.y - i.y) * k, zoom: i.zoom + (to.zoom - i.zoom) * k, lift: i.l * (1 - k) });
          continue;
        }
        if (i.phase === "handing") {
          // the ghost the hand-off spawned: a NEW insert ghost of the type (the op ran after the step that handed it)
          const g = ghosts.find((q) => q.type === i.type && !known.has(q.entity) && !claimed.has(q.entity));
          moving = true;
          if (g !== undefined) {
            claimed.add(g.entity);
            const k0 = i.zoom / cam.zoom;
            const grow: Item = { id: i.id, phase: "grow", type: i.type, u: i.u, v: i.v, ghost: g.entity, k0, t0: now, k: k0 };
            next.push(grow);
            presented.add(g.entity);
            poses.push(ghostPose(grow, g, cam, k0, 1));
            continue;
          }
          i.frames += 1;
          if (i.frames > CARRY.handFrames) {
            // refused (no ghost came): put back
            const s = specimen(i.type);
            if (s !== undefined) next.push({ id: i.id, phase: "back", type: i.type, u: i.u, v: i.v, x: i.x, y: i.y, zoom: i.zoom, l: i.l, t0: now, to: homeOf(s, i.u, i.v) });
            continue;
          }
          next.push(i);
          poses.push({ id: i.id, phase: "handing", type: i.type, u: i.u, v: i.v, px: i.x, py: i.y, zoom: i.zoom, lift: i.l });
          continue;
        }
        const g = byEntity.get(i.ghost);
        if (g === undefined) { presented.delete(i.ghost); continue; }   // gone: promoted (its twin lands) or reaped home
        if (i.phase === "grow") {
          if (g.retiring) {
            const home: Item = { id: i.id, phase: "home", type: i.type, ghost: i.ghost, k0: i.k };
            next.push(home);
            poses.push(homePose(home, g, cam));
            moving = true;
            continue;
          }
          const t = clamp01((now - i.t0) / CARRY.growMs);
          i.k = i.k0 + (1 - i.k0) * slideEase(t);
          if (t >= 1 && p <= 0) { presented.delete(i.ghost); continue; }   // its own size, the drawer gone: the desk's again
          moving = true;
          next.push(i);
          poses.push(ghostPose(i, g, cam, i.k, 1));
          continue;
        }
        moving = true;
        next.push(i);
        poses.push(homePose(i, g, cam));
      }
      // an insert ghost flying home that nothing here carries (an Esc, a rejected drop — any adoption's): it shrinks as it flies
      for (const g of ghosts) {
        if (!g.retiring || claimed.has(g.entity)) continue;
        const home: Item = { id: ++ids, phase: "home", type: g.type, ghost: g.entity, k0: 1 };
        next.push(home);
        presented.add(g.entity);
        poses.push(homePose(home, g, cam));
        moving = true;
      }
      items = next;
      for (const e of [...presented]) if (!items.some((i) => (i.phase === "grow" || i.phase === "home") && i.ghost === e)) presented.delete(e);
      known.clear();
      for (const g of ghosts) known.add(g.entity);
      return poses;
    },
    presented: () => presented,
    live: () => moving,
    types: () => [...new Set(items.map((i) => i.type))],
    state: () => ({ poses, handed, live: moving }),
  };
}

/** A ghost growing out of the copy: its grab point where it is on screen, at `k` × the camera's scale. */
function ghostPose(i: Extract<Item, { phase: "grow" }>, g: CarryGhost, cam: CarryCamera, k: number, lift: number): CarryPose {
  const wx = g.x + i.u * g.w;
  const wy = g.y + i.v * g.h;
  return { id: i.id, phase: "grow", type: i.type, ghost: g.entity, u: i.u, v: i.v, px: (wx - cam.x) * cam.zoom, py: (wy - cam.y) * cam.zoom, zoom: k * cam.zoom, lift };
}

/** A ghost flying home: its centre where it is on screen, shrinking to nothing as its tween runs; its lift settling with it. */
function homePose(i: Extract<Item, { phase: "home" }>, g: CarryGhost, cam: CarryCamera): CarryPose {
  const t = slideEase(clamp01(g.progress));
  const wx = g.x + g.w / 2;
  const wy = g.y + g.h / 2;
  return { id: i.id, phase: "home", type: i.type, ghost: g.entity, u: 0.5, v: 0.5, px: (wx - cam.x) * cam.zoom, py: (wy - cam.y) * cam.zoom, zoom: i.k0 * (1 - t) * cam.zoom, lift: 1 - t };
}

/**
 * A pose's VIEW: the camera under which the object's point `(u, v)` across `rect` (its own units — the world's for a ghost, its natural
 * size about the origin for a copy) lies at the pose's pivot on screen, at its scale.
 */
export function carryView(pose: CarryPose, rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }): { readonly camX: number; readonly camY: number; readonly zoom: number } {
  const z = Math.max(pose.zoom, 1e-6);
  return { camX: rect.x + pose.u * rect.w - pose.px / z, camY: rect.y + pose.v * rect.h - pose.py / z, zoom: z };
}
