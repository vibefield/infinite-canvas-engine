/**
 * TRAY INPUT (design-016 §7; design-017 §4 — K3) — the pegboard drawer's share of the pointer, beside the hand's (systems/held.ts)
 * and in its vocabulary. Right after `heldInput` at the head of `react`: the ingest's one-tick tags are flushed by then (a press is
 * visible), and what this stamps flushes before `ctl`, so the recognizers and both wheel consumers never hear of what the tray
 * takes. PICKING does not hear it either way — it runs in this same phase, before the stamp lands (a tag is a structural write,
 * applied at the phase boundary) — so it reads `Tray.open` itself and answers the bare canvas for every local pointer while the
 * drawer is out (l1-pick; K9 law #1: without that, the DOM-at-event-time halves read a live hit THROUGH the drawer). While an
 * object is in hand the tray stands aside (the hand's frame never draws it).
 *
 *  - CLOSED, the drawer takes no pointer (design-018 §5, R2 — the lip's handle, its hover and its press retired): a press at the
 *    bottom centre is the desk's like any other. What opens the drawer is the app's — the `a` key, and the DOM bar (`<TrayBar>`,
 *    @ice/react), whose down never reaches the canvas as a press. Only a wheel stream it took while out stays its own (below).
 *  - OPEN, the desk is INERT: every local pointer gets the one-tick `HandledByWidget` and `WheelHandled`, each tick, as the hand's
 *    do — so "the wheel never moves the camera" is not a rule the camera keeps; it is a fact the camera never hears about. Over the
 *    drawer the wheel scrolls it (`dy`; the OS's momentum arrives as deltas and is applied as it comes — no inertia of ours; ⌘/ctrl
 *    and a pinch are swallowed) and a press-drag scrolls it; past an end the rest is the band's `stretch` (a reversal unwinds it
 *    first), which lets go once the scroll input has been quiet `letGoMs` — or (K9) once a FADING tail has pushed it `fadeDeltas`
 *    shrinking deltas, the rest of that tail spent (the OS's momentum no longer holds it for its second). A click on the dimmed desk — pressed and released there,
 *    unmoved — closes it. Shut, the wheel stays the tray's until it has been quiet `letGoMs` (K9): a flick's momentum still
 *    arriving as the drawer shuts never zooms the desk.
 *  - K5b, TAKING ONE (design-017 §9): a press on a SPECIMEN is `TrayPress specimen` — its type, the grab point across the object as the
 *    board draws it (kernel `specimenFit`), the specimen's centre on screen. Past the slop its COPY lifts (`Tray.take` and the pointer:
 *    the renderer's flux draws it; the specimen stays hung); a press on a specimen never scrolls the board. Out of the drawer's open
 *    rect the copy is HANDED to the desk: the drawer slides away (`open` false), `handed` bumps (that tick `take` still names it, where
 *    it left — what the renderer's ghost grows out of — and it clears the tick after), and the one-tick `TrayIntent` asks the
 *    facade for `ops.insertByDrag` after the step — the insert ghost under the same grab point, its synthetic down this pointer's, the
 *    ordinary drag from there. The press becomes `carry`: released back over the drawer as drawn — still sliding away, its open rect
 *    the desk's once it has shut (K9) — the ghost's gesture is CANCELLED
 *    (`CancelRequest` — the ctl sweep reads it this tick, before the release can commit) and it flies home. Released inside the drawer,
 *    or the drawer shut under it (Esc, the key), the take is put back: nothing was made, nothing enters undo.
 *
 * Where the drawer is comes through the SEAM `TrayPoseSlot` beside `heldPose`: the renderer's word on the drawer as it DREW it this
 * frame (its rect mid-slide, the scroll range its layout gives), so a hit and the clamp agree with the pixels. Nothing here reads a
 * kind or a pixel; opening a drawer cancels every gesture in flight (`CancelRequest`, read by the `ctl:spawn` sweep this tick).
 */
import type { Component, Entity, System, SystemCtx, TickSystem, World } from "@vibecook/strata-ecs";
import { defineQuery, defineSystem, defineTickSystem } from "@vibecook/strata-ecs";
import { layTray, specimenFit, type TrayItem, trayScrollMax } from "@ice/kernel";
import { Specimen, Tray, TrayContent, TrayIntent, TrayPress } from "../catalog/desk";
import { HandledByWidget, LocalPointer, Pointer, PointerButtons, PointerMods, PointerScreen, PointerWheel, WentCancelled, WentDown, WentUp, WheelHandled } from "../catalog/pointer";
import { BoardRoot, ChildOf, Position, Size } from "../catalog/scene";
import { currentNavFrame } from "../nav/nested-canvas";
import type { DropPlacementPolicy } from "./l3-drop";
import { engineCatalogFor, widgetTypeFor } from "../canvas/engine-catalog";
import { Viewport } from "../catalog/camera-derived";
import { FrameInfo } from "../engine/frame-info";
import { cancelActiveGestures } from "../ops/gestures";
import { type ComponentInit, type FieldWrite, PrefabId } from "../schema/prefab";
import { WidgetEquipped, type WidgetType, widgets } from "../widget/define-widget";
import { widgetSpawnInits } from "../widget/spawn";
import { heldEntity } from "./held";

/**
 * The drawer ON SCREEN as the renderer drew it this frame, CSS px: its outline box (top-left, width, full height — the part below
 * the view included), the slide `p` (0 closed … 1 open), the scroll range `max` the laid content gives, the board's `pitch`, and
 * the `scroll` as DRAWN — the fact's plus the band's shown pull — so a board point under the pointer is the one on screen. K9: the
 * `face`, the board's height the drawer shows inside its rim — the range is the content's foot plus a pitch less it (kernel
 * `trayScrollMax`), so the lay can clamp the scroll in the tick a new foot or face moves the range; absent, nothing clamps it.
 */
export interface TrayScreenFrame {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly p: number;
  readonly max: number;
  readonly pitch: number;
  readonly scroll: number;
  readonly face?: number;
}

/** The pose seam: the renderer's word on where the drawer is — `undefined` before its first frame. */
export interface TrayPoseSource { frame(): TrayScreenFrame | undefined }

/** The stack's slot for the pose source — a mutable box, so the renderer can arrive after install (as `heldPose`). */
export interface TrayPoseSlot { current: TrayPoseSource | null }

/** The tray's input numbers (design-017 §7): a click's slop, how long the scroll input must be quiet before the band lets go — and (K9, D-K9-c.3) how many shrinking deltas in a row a fading tail pushes the band before it lets go. (design-018 §5: the lip's drag, handle and pad retired with it.) */
export const TRAY_INPUT = { slopPx: 4, letGoMs: 120, fadeDeltas: 3 } as const;

const trayQ = defineQuery([Tray]);
/** A tray press on no specimen (K5b): its take fields at rest. */
const NO_TAKE = { type: "", u: 0.5, v: 0.5, homeX: 0, homeY: 0 } as const;
const localPointerQ = defineQuery([Pointer, PointerScreen, LocalPointer]);

/** The tray's specimens (K5a): the tray entity's children tagged `Specimen`, in sibling order. */
export function specimensOf(world: World, tray: Entity): Entity[] {
  const out: Entity[] = [];
  for (const c of world.getReverse(tray, ChildOf)) if (world.isAlive(c) && world.hasTag(c, Specimen)) out.push(c);
  return out;
}

/** The specimen at a board point (board px — x from the drawer's left edge, y down from the board's top at scroll 0): its type and where it hangs, or undefined. */
function specimenAt(world: World, tray: Entity, bx: number, by: number): { readonly type: string; readonly x: number; readonly y: number; readonly w: number; readonly h: number } | undefined {
  let hit: { type: string; x: number; y: number; w: number; h: number } | undefined;
  for (const e of specimensOf(world, tray)) {
    const p = world.get(e, Position);
    const z = world.get(e, Size);
    const id = world.get(e, PrefabId)?.id;
    if (p === undefined || z === undefined || typeof id !== "string") continue;
    if (bx >= p.x && bx <= p.x + z.w && by >= p.y && by <= p.y + z.h) hit = { type: id, x: p.x, y: p.y, w: z.w, h: z.h };
  }
  return hit;
}

/** A delta down the board into scroll ∈ [0, max], the rest into the band; a delta back unwinds the band first. */
export function scrollBy(scroll: number, stretch: number, d: number, max: number): { readonly scroll: number; readonly stretch: number } {
  let s = scroll;
  let b = stretch;
  let rest = d;
  if (b !== 0 && Math.sign(rest) !== Math.sign(b)) {
    const back = Math.sign(b) * Math.min(Math.abs(b), Math.abs(rest));
    b -= back;
    rest += back;
  }
  if (b === 0 && rest !== 0) {
    const next = Math.min(Math.max(s + rest, 0), Math.max(max, 0));
    const took = next - s;
    s = next;
    rest -= took;
  }
  return { scroll: s, stretch: b + rest };
}

export function createTrayInput(world: World, opts: { readonly pose: TrayPoseSlot }): System {
  /** The one-tick ask to hand a take to the desk (the facade applies it after the step — `HeldIntent`'s way). */
  const hand = (i: { readonly type: string; readonly x: number; readonly y: number; readonly pointerId: string; readonly device: "mouse" | "touch" | "pen"; readonly buttons: number; readonly u: number; readonly v: number; readonly homeX: number; readonly homeY: number }): void => {
    const prev = world.getResource(TrayIntent);
    world.setResource(TrayIntent, { ...i, epoch: (prev?.epoch ?? 0) + 1 });
  };
  return defineSystem(
    localPointerQ,
    (b, ctx) => {
      const tray: Entity | undefined = world.firstOf(trayQ);
      if (tray === undefined || !ctx.isAlive(tray)) return;
      const t = ctx.read(tray, Tray);
      if (heldEntity(world) !== undefined) {
        // the hand's focus: the tray stands aside, its presses let go (a take among them — put back)
        for (const r of b) { const p = b.entity(r); if (ctx.has(p, TrayPress)) ctx.removeComponent(p, TrayPress); }
        if ((t.hover ?? "") !== "" || (t.take ?? "") !== "") ctx.edit(tray).set(Tray, { ...t, hover: "", take: "" });
        return;
      }
      const frame = opts.pose.current?.frame();
      const now = world.getResource(FrameInfo)?.now ?? 0;
      const max = Math.max(0, frame?.max ?? 0);
      let open = t.open;
      let scroll = t.scroll;
      let stretch = t.stretch;
      let wheelAt = t.wheelAt;
      let wheelDy = t.wheelDy;
      let fade = t.fade;
      let hover = "";
      let dragging = false;
      let take = t.take ?? "";
      let takeU = t.takeU;
      let takeV = t.takeV;
      let takeX = t.takeX;
      let takeY = t.takeY;
      let handed = t.handed;
      const over = (x: number, y: number, pad: number): boolean =>
        frame !== undefined && x >= frame.x && x <= frame.x + frame.w && y >= frame.y - pad;
      // the drawer's OPEN rect (K5b): its outline at the full slide — the pose's box with its top the view's foot less its height
      const vh = world.getResource(Viewport)?.h ?? 0;
      const inOpen = (x: number, y: number): boolean => frame !== undefined && x >= frame.x && x <= frame.x + frame.w && y >= vh - frame.h;
      for (const r of b) {
        const p = b.entity(r);
        const s = ctx.read(p, PointerScreen);
        // a down the ingest already flagged is DOM chrome's (design-002 §8): it stays the chrome's — the drawer never takes it
        const chrome = ctx.hasTag(p, HandledByWidget);
        const down = ctx.hasTag(p, WentDown) && !chrome && ((ctx.get(p, PointerButtons)?.buttons ?? 0) & 1) !== 0;
        const press = ctx.get(p, TrayPress);
        if (!open) {
          // K9 (S7): the wheel stays the tray's until it goes quiet — the rest of a stream it took while out (a trackpad's momentum
          // still arriving as the drawer shut: Esc, the key, a take handed out) would zoom the desk; swallowed, each keeping the latch
          const lw = ctx.get(p, PointerWheel);
          if (lw !== undefined && (lw.dy !== 0 || lw.dx !== 0 || lw.pinch !== 0) && wheelAt > 0 && now - wheelAt < TRAY_INPUT.letGoMs) {
            if (!ctx.hasTag(p, WheelHandled)) ctx.addTag(p, WheelHandled);
            wheelAt = now;
          }
          if (press?.kind === "carry") {
            // K5b: the take handed to the desk — the insert ghost's drag is this pointer's (its synthetic down included: never the
            // lip's). Released back over the drawer AS DRAWN this frame — still sliding away — the gesture is cancelled — this tick's
            // ctl sweep, before the release can commit — and the ghost flies home; anywhere else the ordinary drag ends it. Once it
            // has slid shut its open rect is the desk's again (K9 S2), and so is the lip's strip (D-K9-c.1, as D-K3.10 gave it back).
            const ended = ctx.hasTag(p, WentUp) || ctx.hasTag(p, WentCancelled);
            if (ctx.hasTag(p, WentUp) && frame !== undefined && frame.p > 0 && over(s.x, s.y, 0)) cancelActiveGestures(world);
            if (ended) ctx.removeComponent(p, TrayPress);
            continue;
          }
          if (press?.kind === "specimen") {
            // K5b: the drawer shut under a take (Esc, the key, a peer's op) — the copy goes back on its peg; nothing was made
            take = "";
            ctx.removeComponent(p, TrayPress);
            continue;
          }
          // a press the open drawer took (its board, the dimmed desk), shut under it — Esc, the key, a peer's op: let go. A closed
          // drawer takes no press (design-018 §5: the lip's handle retired — the bottom centre is the desk's like anywhere else)
          if (press !== undefined) ctx.removeComponent(p, TrayPress);
          continue;
        }
        // OPEN: the desk is inert — picking, the recognizers and both wheel consumers skip this pointer this tick
        if (!ctx.hasTag(p, HandledByWidget)) ctx.addTag(p, HandledByWidget);
        if (!ctx.hasTag(p, WheelHandled)) ctx.addTag(p, WheelHandled);
        // the specimen under the mouse (K5a): the board point as DRAWN — the pose's shown scroll, the band's pull in it
        if (frame !== undefined && over(s.x, s.y, 0) && ctx.read(p, Pointer).device === "mouse") hover = specimenAt(world, tray, s.x - frame.x, s.y - frame.y + frame.scroll)?.type ?? "";
        const w = ctx.get(p, PointerWheel);
        if (w !== undefined && (w.dy !== 0 || w.dx !== 0 || w.pinch !== 0)) {
          // every wheel is the tray's while it is out — its clock is the band's let-go and the latch after a close (K9)
          const quiet = now - wheelAt > TRAY_INPUT.letGoMs;
          wheelAt = now;
          const mods = ctx.get(p, PointerMods);
          if (over(s.x, s.y, 0) && w.pinch === 0 && mods?.ctrl !== true && mods?.meta !== true && w.dy !== 0) {
            // K9 (S11, D-K9-c.3): the band lets go on a FADING tail, not only after it — a delta pushing the band further that is
            // smaller than the one before counts (an equal one neither counts nor resets: slowing deltas plateau as integers), a
            // larger one, a reversal or quiet start the count over; at `fadeDeltas` the band lets go, and each later delta of that
            // tail lets it go again in the tick it pulls (the fact never shows it: the tail is spent) until it reverses, grows or rests
            const same = Math.sign(w.dy) === Math.sign(wheelDy);
            if (quiet || !same || Math.abs(w.dy) > Math.abs(wheelDy)) fade = 0;
            ({ scroll, stretch } = scrollBy(scroll, stretch, w.dy, max));
            if (stretch !== 0 && Math.sign(stretch) === Math.sign(w.dy) && same && Math.abs(w.dy) < Math.abs(wheelDy)) fade += 1;
            if (fade >= TRAY_INPUT.fadeDeltas) stretch = 0;
            wheelDy = w.dy;
          }
        }
        if (down) {
          const onBoard = over(s.x, s.y, 0);
          // K5b: a press on a specimen takes it (past the slop) — the grab point across the object as the board draws it
          const hit = onBoard && frame !== undefined ? specimenAt(world, tray, s.x - frame.x, s.y - frame.y + frame.scroll) : undefined;
          const natural = hit === undefined ? undefined : widgetTypeFor(world, hit.type)?.defaultSize;
          const fit = hit !== undefined && natural !== undefined && natural.w > 0 && natural.h > 0 ? specimenFit(hit, natural) : undefined;
          const at = { x: s.x, y: s.y, scroll0: scroll + stretch, moved: false };
          const next = hit !== undefined && fit !== undefined && frame !== undefined
            ? {
              ...at, kind: "specimen" as const, type: hit.type,
              u: Math.min(Math.max((s.x - frame.x - fit.x) / fit.w, 0), 1),
              v: Math.min(Math.max((s.y - frame.y + frame.scroll - fit.y) / fit.h, 0), 1),
              homeX: frame.x + fit.x + fit.w / 2, homeY: frame.y + fit.y + fit.h / 2 - frame.scroll,
            }
            : { ...at, kind: onBoard ? ("board" as const) : ("desk" as const), ...NO_TAKE };
          if (press !== undefined) ctx.edit(p).set(TrayPress, next);
          else ctx.addComponent(p, TrayPress, next);
          if (next.kind === "board") dragging = true;
          continue;
        }
        if (press === undefined) continue;
        const moved = press.moved || Math.hypot(s.x - press.x, s.y - press.y) > TRAY_INPUT.slopPx;
        const ended = ctx.hasTag(p, WentUp) || ctx.hasTag(p, WentCancelled);
        if (press.kind === "specimen") {
          // K5b — TAKING ONE. Released (or cancelled) inside the drawer: the copy goes back on its peg — nothing was made.
          if (ended) { take = ""; ctx.removeComponent(p, TrayPress); continue; }
          if (!moved) continue;
          if (!inOpen(s.x, s.y)) {
            // out of the drawer: it slides away, and the desk takes the copy — the insert ghost under the same grab point, after the step.
            // This tick the take still names it, where it was handed (a flick lifts and hands in one event): the renderer's word on
            // what the ghost grows out of; it clears the tick after, the drawer shut
            open = false;
            take = press.type ?? "";
            takeU = press.u;
            takeV = press.v;
            takeX = s.x;
            takeY = s.y;
            handed += 1;
            const pt = ctx.read(p, Pointer);
            hand({ type: press.type ?? "", x: s.x, y: s.y, pointerId: pt.id ?? "mouse", device: pt.device, buttons: ctx.get(p, PointerButtons)?.buttons ?? 1, u: press.u, v: press.v, homeX: press.homeX, homeY: press.homeY });
            ctx.edit(p).set(TrayPress, { ...press, kind: "carry", moved: true });
            continue;
          }
          // past the slop, in the drawer: the copy is lifted and follows the pointer (the specimen stays hung)
          take = press.type ?? "";
          takeU = press.u;
          takeV = press.v;
          takeX = s.x;
          takeY = s.y;
          if (moved !== press.moved) ctx.edit(p).set(TrayPress, { ...press, moved });
          continue;
        }
        if (press.kind === "board" && !ended) {
          // the board under the finger: where it began, less how far the pointer travelled — past an end, the band
          if (moved) {
            const target = press.scroll0 - (s.y - press.y);
            scroll = Math.min(Math.max(target, 0), max);
            stretch = target - scroll;
            wheelAt = now;
          }
          dragging = true;
        }
        if (ended) {
          if (press.kind === "desk" && ctx.hasTag(p, WentUp) && !moved) open = false;
          ctx.removeComponent(p, TrayPress);
        } else if (moved !== press.moved) ctx.edit(p).set(TrayPress, { ...press, moved });
      }
      // the band lets go once the scroll input is quiet — never under a finger still dragging the board — and as the drawer closes
      if (stretch !== 0 && ((!dragging && now - wheelAt > TRAY_INPUT.letGoMs) || !open)) stretch = 0;
      if (!open) { hover = ""; if (handed === t.handed) take = ""; }
      if (open !== t.open || scroll !== t.scroll || stretch !== t.stretch || wheelAt !== t.wheelAt || hover !== t.hover
        || take !== t.take || takeU !== t.takeU || takeV !== t.takeV || takeX !== t.takeX || takeY !== t.takeY || handed !== t.handed
        || wheelDy !== t.wheelDy || fade !== t.fade) {
        ctx.edit(tray).set(Tray, { open, scroll, stretch, wheelAt, wheelDy, fade, hover, take, takeU, takeV, takeX, takeY, handed });
      }
    },
    { name: "trayInput", access: { write: [Tray, TrayPress] } },
  );
}

/** The catalog's object types that carry a tray entry — the tray's contents (K-L2: no list here names a kind); the registry's in an unbound world. The lay hangs those the current frame takes (K9). */
export function hungTypes(world: World): WidgetType[] {
  const all = engineCatalogFor(world)?.widgetTypes() ?? widgets.all();
  return all.filter((t) => t.tray !== undefined && t.object !== undefined);
}

/**
 * THE TRAY'S LAY (design-017 §8; K5a) — the specimens in the world: one RUNTIME entity per object type whose widget carries a tray
 * entry (`hungTypes`), `ChildOf` the tray entity (the root of its runtime canvas), `PrefabId` its type, `Position`/`Size` where the
 * lattice law lays it (kernel `layTray`) across the drawer AS THE RENDERER DREW IT (the pose seam's width and pitch), its entry's
 * props over the widget's defaults, spawned `Specimen` and already `WidgetEquipped` (nothing stamps it; the spatial index never
 * takes it). Laid once the renderer has said how wide the drawer is; re-laid when that width, the pitch or the entries change (a
 * kind registered), a specimen whose kind left destroyed; after a reset the new tray entity is laid afresh. `TrayContent` records
 * what was laid — the content's foot is the renderer's scroll range. A tick system: its spawns are the scheduler's, once a frame.
 * K9 (S10, D-K9-c.2): when that range MOVES — a lay (the width, the kinds) or the drawer's face (the view's height) — a scroll past its
 * new end with nothing stretching is clamped to it in the same tick, so no frame draws blank board past the content and the next wheel
 * starts from the end; only on a move, so the rig's door (`scrollTray`) still takes any value until the range next moves.
 * K9 (S13, D-K9-c.4): it hangs what the CURRENT frame takes — inside an entered container its ingress, at the root its canvas's
 * placement, the authority a drop's commit asks (`placement`) — so no specimen offers a take the frame would refuse; entering or
 * leaving re-lays it (the drawer is shut then: the desk is inert while it is out). Without a policy, every hung type.
 */
export function createTrayLay(world: World, opts: { readonly pose: TrayPoseSlot; readonly placement?: DropPlacementPolicy | undefined }): TickSystem {
  let laidKey = "";
  let rangeKey = "";
  const clampToRange = (ctx: SystemCtx, tray: Entity, frame: TrayScreenFrame, bottom: number): void => {
    if (frame.face === undefined) return;
    const range = trayScrollMax(bottom, frame.face, frame.pitch);
    const key = `${tray}|${range}`;
    if (key === rangeKey) return;
    const t = ctx.read(tray, Tray);
    if (t.stretch !== 0) return;   // the band's pull (a wheel's, a finger's) is its own: judged once it lets go
    rangeKey = key;
    if (t.scroll > range) ctx.edit(tray).set(Tray, { ...t, scroll: range });
  };
  return defineTickSystem(
    (ctx) => {
      const tray: Entity | undefined = world.firstOf(trayQ);
      if (tray === undefined || !ctx.isAlive(tray)) return;
      const frame = opts.pose.current?.frame();
      if (frame === undefined || !(frame.w > 0) || !(frame.pitch > 0)) return;
      const content = ctx.get(tray, TrayContent);
      const policy = opts.placement;
      const inside = policy === undefined ? undefined : currentNavFrame(world);
      const root = world.getResource(BoardRoot)?.root;
      const takes = (type: string): boolean =>
        policy === undefined ? true : inside !== undefined ? policy.canIngress(type, inside) : root === undefined || policy.canPlace === undefined || policy.canPlace(type, root);
      const types = hungTypes(world).filter((t) => takes(t.type));
      const key = `${tray}|${content?.laid ?? 0}|${frame.w}|${frame.pitch}|${types.map((t) => t.type).join(",")}`;
      if (key === laidKey) { clampToRange(ctx, tray, frame, content?.bottom ?? 0); return; }
      const items: TrayItem[] = types.map((t) => {
        const e = t.tray as NonNullable<WidgetType["tray"]>;
        return { type: t.type, hang: e.hang, ...(e.category !== undefined ? { category: e.category } : {}), ...(e.order !== undefined ? { order: e.order } : {}) };
      });
      const layout = layTray(items, frame.w, frame.pitch);
      const have = new Map<string, Entity>();
      for (const e of specimensOf(world, tray)) { const id = world.get(e, PrefabId)?.id; if (typeof id === "string") have.set(id, e); }
      for (const p of layout.placed) {
        const t = types.find((q) => q.type === p.type) as WidgetType;
        const e = have.get(p.type);
        if (e !== undefined) {
          have.delete(p.type);
          const at = ctx.get(e, Position);
          const size = ctx.get(e, Size);
          if (at?.x !== p.x || at?.y !== p.y) ctx.edit(e).set(Position, { x: p.x, y: p.y });
          if (size?.w !== p.w || size?.h !== p.h) ctx.edit(e).set(Size, { w: p.w, h: p.h });
          continue;
        }
        // the widget's own spawn inits (Position, Size, the entry's props folded into their groups), the untouched groups at their defaults
        const cells = new Map<Component, Record<string, FieldWrite>>();
        for (const [c, v] of t.prefab.components) cells.set(c, v);
        for (const [c, v] of widgetSpawnInits(t.type, { x: p.x, y: p.y, w: p.w, h: p.h, props: t.tray?.props ?? {} }, t).overrides) cells.set(c, v);
        cells.set(PrefabId, { id: t.type });
        const spawned = ctx.spawn({ components: [...cells] as ComponentInit[], tags: [Specimen, WidgetEquipped] });
        ctx.setRelation(spawned, ChildOf, tray, "last");
      }
      for (const e of have.values()) ctx.destroy(e);
      const next = { width: frame.w, bottom: layout.bottom, laid: (content?.laid ?? 0) + 1 };
      if (content === undefined) ctx.addComponent(tray, TrayContent, next);
      else ctx.edit(tray).set(TrayContent, next);
      laidKey = `${tray}|${next.laid}|${frame.w}|${frame.pitch}|${types.map((t) => t.type).join(",")}`;
      clampToRange(ctx, tray, frame, layout.bottom);
    },
    { name: "trayLay", access: { write: [Position, Size, TrayContent, Tray] } },
  );
}
