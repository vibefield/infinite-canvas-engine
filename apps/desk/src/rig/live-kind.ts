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
// IN HAND (M24 LT2 — design-019 §5): the face inside its edge is the kind's `live` PART — named only while held (`ctx.held`): at rest a
// named part would take the desk's drags and taps from it, and at rest a live face is an object like any other. The kind is TOLD the
// hand's input (`held`) in its held extent's units and sends the face what lands on its `live` part — a press, its moves and its
// release, the hover over it, the wheel over it — in the DISPLAYED frame's logical coordinates (`LiveTexture.logical`); it takes the
// wheel (`open.wheel: "kind"`) and names the page's cursor over its part (`open.cursor` — `LiveInfo.cursor`). Its DOM half
// (`createRigLiveHand`) LEASES the desk's one editor while one of its objects is in hand — keys, committed text and the IME's
// composition to the face; Esc the desk's (it puts the object down), or the face's for the rig's TERMINAL (`rig.live-term` —
// `open.escape: "kind"`).
// Counters a rig reads (`handle.local("rig-live")`): faces opened, takes that landed, redraws asked, demands sent, ticks; events told,
// inputs sent.

import type { Entity, WidgetType } from "@ice/core";
import { CONTAINABLE, DESK_OBJECT, defineObject, type KindDriver, type KindDriverHost, type KindHost, type KindLocal, type ObjectContext, type ObjectDomHost, type ObjectKind } from "@ice/desk";
import { createSight, type EditorLease, LIVE, type LiveDemand, type LiveFace, type LiveInput, type Seen, type Sight } from "@ice/desk/kit";
import { rigFault } from "./live-fault";
import { RigLivePass, type RigSheetRecord } from "./live-pass";
import { RIG_LIVE_LOGICAL, RIG_LIVE_SIZE } from "./live-source";

export const RIG_LIVE_KIND = "rig-live";
export const RIG_LIVE_TYPE = "rig.live";
/** The rig's TERMINAL face (M24 LT2): the same sheet, whose kind owns Esc in hand (`open.escape: "kind"`). */
export const RIG_LIVE_TERM_KIND = "rig-live-term";
export const RIG_LIVE_TERM_TYPE = "rig.live-term";
/** The face's EDGE, world units: in hand the face inside it is the kind's `live` part, the edge its `content` — the object's. */
export const RIG_LIVE_EDGE = 12;

/** A sheet's geometry: its rect as drawn (world units, centred), its presence, and whether it is drawn in hand. */
interface RigSheetGeometry { readonly cx: number; readonly cy: number; readonly w: number; readonly h: number; readonly alpha: number; readonly held: boolean }

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
  /** Events the hand told the kind (M24 LT2), and inputs it sent its faces — the hand's and the lease's. */
  readonly told: number;
  readonly sent: number;
}

export interface RigLiveLocal extends KindLocal {
  /** `e`'s face — opened (and taken once) at its first ask; undefined with no source or no durable key. */
  face(e: Entity): LiveFace | undefined;
  /** `e`'s face if it is open — never opens one. */
  opened(e: Entity): LiveFace | undefined;
  /** `e` was recorded at `w` × `h` world units — its held extent (`open.extent` is its rect), what the hand's points are mapped by. */
  drawn(e: Entity, w: number, h: number): void;
  /** `e`'s size as last recorded. */
  sizeOf(e: Entity): readonly [number, number] | undefined;
  /** The sight's fact for `e` as of its last step. */
  seen(e: Entity): Seen | undefined;
  /** Every fact the sight said `e` moved to, in order — a rig reads what a hold took a face through. */
  history(e: Entity): readonly Seen[];
  /** The durable key `e`'s face was opened by. */
  keyOf(e: Entity): string | undefined;
  /** Send `e`'s face an input (the lease's keys and text — M24 LT2). */
  send(e: Entity, input: LiveInput): void;
  counts(): RigLiveCounts;
  /** The sight its pass tells (carried on the records). */
  readonly sight: Sight;
}

/** Inside the face's edge — the `live` part's extent, in the held extent's units (centred). */
const onFace = (size: readonly [number, number], x: number, y: number): boolean => Math.abs(x) <= size[0] / 2 - RIG_LIVE_EDGE && Math.abs(y) <= size[1] / 2 - RIG_LIVE_EDGE;

function createRigLiveLocal(host: KindHost, kind: string): RigLiveLocal {
  const live = host.use?.(LIVE);
  const sight = createSight(host.frames);
  const faces = new Map<Entity, { readonly key: string; readonly face: LiveFace; demand: LiveDemand | undefined; readonly history: Seen[] }>();
  const sizes = new Map<Entity, readonly [number, number]>();
  /** The objects whose face said something arrived since the last tick (arrivals coalesce: one take each). */
  const woken = new Set<Entity>();
  /** The objects pressed on their `live` part, the press not yet released: its moves and its release are the face's wherever they go. */
  const pressing = new Set<Entity>();
  const counts = { opened: 0, landed: 0, redraws: 0, moved: 0, demands: 0, ticks: 0, told: 0, sent: 0 };
  const send = (e: Entity, input: LiveInput): void => {
    const f = faces.get(e)?.face;
    if (f?.input === undefined) return;
    counts.sent += 1;
    f.input(input);
  };
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
    opened: (e) => faces.get(e)?.face,
    drawn(e, w, h) { sizes.set(e, [w, h]); },
    sizeOf: (e) => sizes.get(e),
    seen: (e) => sight.of(e),
    history: (e) => [...(faces.get(e)?.history ?? [])],
    keyOf: (e) => faces.get(e)?.key,
    send,
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
    // THE HAND'S INPUT (M24 LT2): what lands on the `live` part — a press, its moves and its release wherever they go, the hover over
    // it, the wheel over it — sent to the face in the DISPLAYED frame's logical coordinates; the edge's presses are the hand's
    held(e, events) {
      rigFault(kind, "held");   // the fault door (M24 LT3)
      const size = sizes.get(e);
      const face = faces.get(e)?.face;
      if (size === undefined || face === undefined) return;
      const [lw, lh] = face.texture()?.logical ?? [RIG_LIVE_LOGICAL.width, RIG_LIVE_LOGICAL.height];
      const page = (x: number, y: number): readonly [number, number] => [((x + size[0] / 2) / size[0]) * lw, ((y + size[1] / 2) / size[1]) * lh];
      for (const ev of events) {
        counts.told += 1;
        if (ev.type === "wheel") {
          if (!onFace(size, ev.x, ev.y)) continue;
          const [x, y] = page(ev.x, ev.y);
          send(e, { kind: "wheel", x, y, dx: ev.dx, dy: ev.dy });
          continue;
        }
        if (ev.phase === "down" ? ev.part !== "live" : ev.part !== "live" && !pressing.has(e)) continue;
        if (ev.phase === "down") pressing.add(e);
        else if (ev.phase === "up") pressing.delete(e);
        const [x, y] = page(ev.x, ev.y);
        send(e, { kind: "pointer", x, y, button: ev.button, buttons: ev.buttons, count: ev.count, phase: ev.phase });
      }
    },
    forget(e) {
      faces.get(e)?.face.close();
      faces.delete(e);
      sizes.delete(e);
      woken.delete(e);
      pressing.delete(e);
      sight.forget(e);
    },
    dispose() {
      for (const f of faces.values()) f.face.close();
      faces.clear();
      woken.clear();
    },
  };
}

/** A rig live kind: its name, and whether Esc in hand is the desk's (it puts the object down) or the face's (a terminal's). */
function rigLiveKindOf(name: string, esc: "desk" | "kind"): ObjectKind<RigSheetGeometry, RigSheetRecord> {
  return {
    name,
    stratum: "things",
    reach: 2,
    create: (device, format, mat) => RigLivePass.create(device, format, mat, name),
    resolve: (ctx: ObjectContext): RigSheetGeometry => ({ cx: ctx.rect.cx, cy: ctx.rect.cy, w: ctx.rect.w, h: ctx.rect.h, alpha: ctx.flux.fade, held: ctx.held !== undefined }),
    record(G: RigSheetGeometry, ctx: ObjectContext): RigSheetRecord {
      const local = ctx.local as RigLiveLocal | undefined;
      local?.drawn(ctx.entity, G.w, G.h);
      return { e: ctx.entity, cx: G.cx, cy: G.cy, w: G.w, h: G.h, alpha: G.alpha, face: local?.face(ctx.entity), sight: local?.sight };
    },
    // the face inside its edge is the kind's `live` part IN HAND only; at rest — and on its edge — the object itself
    hit: (G, wx, wy) => {
      const dx = Math.abs(wx - G.cx);
      const dy = Math.abs(wy - G.cy);
      if (dx > G.w / 2 || dy > G.h / 2) return null;
      return G.held && dx <= G.w / 2 - RIG_LIVE_EDGE && dy <= G.h / 2 - RIG_LIVE_EDGE ? "live" : "content";
    },
    local: (host) => createRigLiveLocal(host, name),
    // picked up, it is held (design-015 §8): the hand's one focused object — its sight says `held`; the wheel over it is the face's,
    // its cursor the page's over its part, and Esc the desk's or (the terminal) the face's (M24 LT2)
    open: {
      extent: (c) => c.rect,
      wheel: "kind",
      escape: esc,
      cursor: (c) => (c.part === "live" ? (c.local as RigLiveLocal | undefined)?.opened(c.entity)?.info().cursor : undefined),
    },
  };
}

export const rigLiveKind = rigLiveKindOf(RIG_LIVE_KIND, "desk");
export const rigLiveTermKind = rigLiveKindOf(RIG_LIVE_TERM_KIND, "kind");

/** The rig live kind's hand on the editor — its driver, which its DOM half joins at the mount. */
interface RigLiveHand extends KindDriver {
  join(dom: ObjectDomHost): void;
}

/** CDP's modifier mask (Alt 1, Ctrl 2, Meta 4, Shift 8 — `LiveInput` key's `mods`). */
const modsOf = (ev: KeyboardEvent): number => (ev.altKey ? 1 : 0) | (ev.ctrlKey ? 2 : 0) | (ev.metaKey ? 4 : 0) | (ev.shiftKey ? 8 : 0);

/**
 * THE FACE'S KEYBOARD (M24 LT2 — design-019 §5.4, the calendar's day-line pattern): while one of the kind's objects is in hand its DOM
 * half LEASES the desk's one editor for the face — lent in the frame it is first seen held (a pickup by ⏎ or a double-click alike) and
 * again should a blur end it; let go when the object leaves the hand (`live()`). Keys go to the face raw (`key`, down and up — a
 * printable one TYPES, and the field's text reaches the face as `text`), the IME's composition as `compose` and its commit as `text`;
 * Esc is the desk's — declined, so the keymap puts the object down — unless the kind owns it (the terminal: sent, and taken). A press
 * on the held face keeps the editor's focus (its default would move the focus off the textarea and end the lease mid-typing).
 */
function createRigLiveHand(h: KindDriverHost, esc: "desk" | "kind"): RigLiveHand {
  let dom: ObjectDomHost | undefined;
  /** The object the lease is lent for (undefined: not lent). */
  let leased: Entity | undefined;
  /** What the field held when the face was last sent its text (the field is emptied each frame: `value` answers ""). */
  let sent = "";
  const local = (): RigLiveLocal | undefined => h.local as RigLiveLocal | undefined;
  const send = (input: LiveInput): void => { if (leased !== undefined) local()?.send(leased, input); };
  /** The kind's object in hand, settled or flying in — never one flying home. */
  const inHand = (): Entity | undefined => { const hand = h.hand(); return hand !== undefined && !hand.landing && h.isKind(hand.entity) ? hand.entity : undefined; };
  const onKeyUp = (ev: KeyboardEvent): void => { send({ kind: "key", key: ev.key, code: ev.code, phase: "up", mods: modsOf(ev), repeat: false }); };
  const onDown = (ev: PointerEvent): void => {
    const e = leased;
    const hand = h.hand();
    const size = e === undefined ? undefined : local()?.sizeOf(e);
    if (dom === undefined || e === undefined || hand === undefined || hand.entity !== e || size === undefined) return;
    // the container's px (the rig's page lays it out untransformed — a host under a transform maps the point as the desk's editor does,
    // through `@ice/kernel`'s `clientToScreen`)
    const r = dom.container.getBoundingClientRect();
    const x = ev.clientX - r.left;
    const y = ev.clientY - r.top;
    if (Math.abs(x - hand.frame.cx) <= (size[0] / 2) * hand.frame.s && Math.abs(y - hand.frame.cy) <= (size[1] / 2) * hand.frame.s) ev.preventDefault();
  };
  const lease: EditorLease = {
    part: "rig.live",
    label: "type on the live face",
    value: () => { sent = ""; return ""; },
    input(v) {
      const add = v.startsWith(sent) ? v.slice(sent.length) : v;
      sent = v;
      if (add !== "") send({ kind: "text", text: add });
    },
    compose(text, caret) { send({ kind: "compose", text, caret }); },
    commit(text) {
      if (text !== "") send({ kind: "text", text });
      sent = dom?.editor.element.value ?? "";
    },
    keydown(ev) {
      if (ev.key === "Escape" && esc === "desk") return false;   // the desk's: declined, the keymap puts the object down
      send({ kind: "key", key: ev.key, code: ev.code, phase: "down", mods: modsOf(ev), repeat: ev.repeat });
      return !(ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey);   // a printable key TYPES: the field takes it, its text the face's
    },
    caret() {},
    place() {
      const e = leased;
      const hand = h.hand();
      const size = e === undefined ? undefined : local()?.sizeOf(e);
      if (e === undefined || hand === undefined || hand.entity !== e || size === undefined) return null;
      const s = hand.frame.s;
      // over the face's top line: where a page's IME candidates would show
      return { x: hand.frame.cx - (size[0] / 2 - RIG_LIVE_EDGE) * s, y: hand.frame.cy - (size[1] / 2 - RIG_LIVE_EDGE) * s, w: (size[0] - 2 * RIG_LIVE_EDGE) * s, h: 20 * s, fontPx: 14 * s };
    },
    idle() {},
    ended() {
      dom?.editor.element.removeEventListener("keyup", onKeyUp);
      leased = undefined;
    },
    live: () => leased !== undefined && inHand() === leased,
  };
  return {
    join(d) {
      dom = d;
      d.container.addEventListener("pointerdown", onDown, { capture: true });
    },
    follow() {
      const e = inHand();
      if (dom === undefined || e === undefined) return;
      if (leased === e && dom.editor.lease() === lease) return;
      leased = e;
      sent = "";
      dom.editor.lend(lease);
      dom.editor.element.addEventListener("keyup", onKeyUp);
    },
    idle: () => leased === undefined && inHand() === undefined,
    dispose() {
      dom?.container.removeEventListener("pointerdown", onDown, { capture: true });
      if (dom !== undefined && dom.editor.lease() === lease) dom.editor.release(lease);
    },
  };
}

/** A rig live object: a sheet 320 × 200 on the desk, a thing that goes into a mini mat by what it provides; its DOM half leases the editor in hand. */
function rigLiveObject(type: string, kind: ObjectKind<RigSheetGeometry, RigSheetRecord>, esc: "desk" | "kind"): WidgetType {
  return defineObject({
    type,
    version: 1,
    props: {},
    size: { w: 320, h: 200 },
    kind,
    interaction: { selectable: true, movable: true, resizable: false, snap: "both" },
    provides: [type, DESK_OBJECT, CONTAINABLE],
    drivers: (h) => createRigLiveHand(h, esc),
    host: { mount: (dom) => { (dom.driver as RigLiveHand | undefined)?.join(dom); } },
  });
}

export const RigLive: WidgetType = rigLiveObject(RIG_LIVE_TYPE, rigLiveKind, "desk");
/** The rig's terminal face (M24 LT2): Esc in hand is the face's — the hand is put down by Done, a click off it, or the pinch. */
export const RigLiveTerm: WidgetType = rigLiveObject(RIG_LIVE_TERM_TYPE, rigLiveTermKind, "kind");

export const RIG_LIVE_OBJECTS: readonly WidgetType[] = [RigLive, RigLiveTerm];
