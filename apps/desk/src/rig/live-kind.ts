// THE RIG LIVE KIND (M24 LT1 — design-019 §3.3–§3.5 as a kind uses them; `rig.html?live` alone, never a public kind): a lit sheet
// whose face is a LIVE TEXTURE its desk's `LIVE` source fills. Its desk state (`RigLiveLocal`):
//  - opens a face per object on its first record, by the object's DURABLE key (`KindHost.keyOf`), and takes once at the open (frame 0
//    lands in the frame that opens it);
//  - on an ARRIVAL (`arrived`, outside a frame) marks the face and wakes (`KindHost.wake`); its tick takes each woken face, and when one
//    landed asks `KindHost.redraw()` and answers FALSE — the frame drawn again, no record remade;
//  - folds where its faces were drawn (`createSight(host.frames)`, told by its pass's prepares) and hands its SOURCE a demand by the
//    rig's law (`rigDemand` — paused unseen, live seen: 60 in the hand and interactive, else 30; the raster the source's native size
//    halved as the seen px allows, a rung held through a zoom's or a flight's px) — CHANGE-ONLY; due now while a frame was drawn its
//    sight has not stepped over, never else.
// Counters a rig reads (`handle.local("rig-live")`): faces opened, takes that landed, redraws asked, demands sent, ticks.

import type { Entity, WidgetType } from "@ice/core";
import { CONTAINABLE, DESK_OBJECT, defineObject, type KindHost, type KindLocal, type ObjectContext, type ObjectKind } from "@ice/desk";
import { createSight, LIVE, type LiveDemand, type LiveFace, type Seen, type Sight } from "@ice/desk/kit";
import { RigLivePass, type RigSheetRecord } from "./live-pass";
import { RIG_LIVE_SIZE } from "./live-source";

export const RIG_LIVE_KIND = "rig-live";
export const RIG_LIVE_TYPE = "rig.live";

/** A sheet's geometry: its rect as drawn (world units, centred) and its presence. */
interface RigSheetGeometry { readonly cx: number; readonly cy: number; readonly w: number; readonly h: number; readonly alpha: number }

/**
 * The rig's demand law over what its sight says (design-019 §4 — the kind's law, in a browser's shape): paused unseen; seen, 60 in the
 * hand (interactive) and 30 at rest, its raster the source's NATIVE size halved as often as the seen px allows — at most three times —
 * so a zoom's or a flight's px moving every frame moves the raster only when it crosses a rung (`native` the source's frame size).
 */
export function rigDemand(s: Seen, native: readonly [number, number]): LiveDemand {
  if (!s.seen) return { mode: "paused", fps: 0, raster: [0, 0], interactive: false };
  const k = Math.min(3, Math.max(0, Math.floor(Math.log2(native[0] / Math.max(s.px[0], 1)))));
  return { mode: "live", fps: s.held ? 60 : 30, raster: [native[0] >> k, native[1] >> k], interactive: s.held };
}

const sameDemand = (a: LiveDemand | undefined, b: LiveDemand): boolean =>
  a !== undefined && a.mode === b.mode && a.fps === b.fps && a.interactive === b.interactive && a.raster[0] === b.raster[0] && a.raster[1] === b.raster[1];

export interface RigLiveCounts {
  readonly opened: number;
  readonly landed: number;
  readonly redraws: number;
  /** Facts the sight said moved (an object's seen, px or held), and the demands they made — fewer: the law's rungs hold. */
  readonly moved: number;
  readonly demands: number;
  readonly ticks: number;
}

export interface RigLiveLocal extends KindLocal {
  /** `e`'s face — opened (and taken once) at its first ask; undefined with no source or no durable key. */
  face(e: Entity): LiveFace | undefined;
  /** The sight's fact for `e` as of its last step. */
  seen(e: Entity): Seen | undefined;
  /** Every fact the sight said `e` moved to, in order — a rig reads what a hold took a face through. */
  history(e: Entity): readonly Seen[];
  /** The durable key `e`'s face was opened by. */
  keyOf(e: Entity): string | undefined;
  counts(): RigLiveCounts;
  /** The sight its pass tells (carried on the records). */
  readonly sight: Sight;
}

function createRigLiveLocal(host: KindHost): RigLiveLocal {
  const live = host.use?.(LIVE);
  const sight = createSight(host.frames);
  const faces = new Map<Entity, { readonly key: string; readonly face: LiveFace; demand: LiveDemand | undefined; readonly history: Seen[] }>();
  /** The objects whose face said something arrived since the last tick (arrivals coalesce: one take each). */
  const woken = new Set<Entity>();
  const counts = { opened: 0, landed: 0, redraws: 0, moved: 0, demands: 0, ticks: 0 };
  return {
    sight,
    face(e) {
      const had = faces.get(e);
      if (had !== undefined) return had.face;
      const key = host.keyOf?.(e);
      if (live === undefined || key === undefined) return undefined;
      const face = live.open(key, { rig: true }, () => { woken.add(e); host.wake?.(); });
      faces.set(e, { key, face, demand: undefined, history: [] });
      counts.opened += 1;
      if (face.take()) counts.landed += 1;   // what the source already holds lands in the frame that opens it
      return face;
    },
    seen: (e) => sight.of(e),
    history: (e) => [...(faces.get(e)?.history ?? [])],
    keyOf: (e) => faces.get(e)?.key,
    counts: () => ({ ...counts }),
    tick() {
      counts.ticks += 1;
      let landed = false;
      for (const e of woken) if (faces.get(e)?.face.take() === true) { landed = true; counts.landed += 1; }
      woken.clear();
      // the frame drawn again, no record remade: the sheet's record stands and its pass reads the face's new texture
      if (landed) { counts.redraws += 1; host.redraw?.(); }
      for (const [e, s] of sight.step()) {
        const f = faces.get(e);
        if (f === undefined) continue;
        counts.moved += 1;
        f.history.push(s);
        const t = f.face.texture();
        const d = rigDemand(s, t === undefined ? [RIG_LIVE_SIZE.width, RIG_LIVE_SIZE.height] : [t.width, t.height]);
        if (sameDemand(f.demand, d)) continue;
        f.demand = d;
        counts.demands += 1;
        f.face.demand(d);
      }
      return false;
    },
    due: (now) => (sight.owed() ? now : Number.POSITIVE_INFINITY),
    forget(e) {
      faces.get(e)?.face.close();
      faces.delete(e);
      woken.delete(e);
      sight.forget(e);
    },
    dispose() {
      for (const f of faces.values()) f.face.close();
      faces.clear();
      woken.clear();
    },
  };
}

export const rigLiveKind: ObjectKind<RigSheetGeometry, RigSheetRecord> = {
  name: RIG_LIVE_KIND,
  stratum: "things",
  reach: 2,
  create: (device, format, mat) => RigLivePass.create(device, format, mat),
  resolve: (ctx: ObjectContext): RigSheetGeometry => ({ cx: ctx.rect.cx, cy: ctx.rect.cy, w: ctx.rect.w, h: ctx.rect.h, alpha: ctx.flux.fade }),
  record(G: RigSheetGeometry, ctx: ObjectContext): RigSheetRecord {
    const local = ctx.local as RigLiveLocal | undefined;
    return { e: ctx.entity, cx: G.cx, cy: G.cy, w: G.w, h: G.h, alpha: G.alpha, face: local?.face(ctx.entity), sight: local?.sight };
  },
  hit: (G, wx, wy) => (Math.abs(wx - G.cx) <= G.w / 2 && Math.abs(wy - G.cy) <= G.h / 2 ? "content" : null),
  local: (host) => createRigLiveLocal(host),
  // picked up, it is held (design-015 §8): the hand's one focused object — its sight says `held`
  open: { extent: (c) => c.rect },
};

/** The rig's live object: a sheet 320 × 200 on the desk, a thing that goes into a mini mat by what it provides. */
export const RigLive: WidgetType = defineObject({
  type: RIG_LIVE_TYPE,
  version: 1,
  props: {},
  size: { w: 320, h: 200 },
  kind: rigLiveKind,
  interaction: { selectable: true, movable: true, resizable: false, snap: "both" },
  provides: [RIG_LIVE_TYPE, DESK_OBJECT, CONTAINABLE],
});

export const RIG_LIVE_OBJECTS: readonly WidgetType[] = [RigLive];
