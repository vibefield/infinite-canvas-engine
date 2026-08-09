/**
 * L0 — pointers & ingest (design-003 §2; `input` phase).
 *
 * Order inside the phase is load-bearing:
 *
 * `pointerLifecycle` runs BEFORE `pointerIngest` and reads only immediate
 * values: a touch pointer whose buttons are still 0 at the top of a frame has
 * been idle-up for a full frame (ingest zeroed buttons on the up frame), so its
 * `ctx.destroy` lands at the input flush of frame up+1 — recognizers saw the up
 * frame's `WentUp` in full. Tag-based detection cannot work in-phase (ingest's
 * one-tick tags are deferred to the flush), hence values.
 *
 * `pointerIngest` is scheduled on the CANVAS-SURFACE anchor query (exactly one
 * such entity, guaranteed by install) because a system body only runs when its
 * query matches — and ingest must run on frames where no pointer entity exists
 * yet (the first down CREATES the pointer). It drains the queue once per tick
 * in two passes: fold events into per-pointer samples, then apply — existing
 * pointers get immediate value writes + deferred one-tick tags; NEW pointers
 * spawn once with their folded final state (an identity-only `ctx.spawn` handle
 * cannot take `edit().set`). Facts are always true: `surfaceHandled` events
 * still land, but carry the one-tick `HandledByWidget` tag L1/L2 read (the
 * pinned widget-event contract, design-002 §8).
 */
import type { Entity, System, TickSystem, World } from "@vibecook/strata-ecs";
import { defineQuery, defineSystem, defineTickSystem } from "@vibecook/strata-ecs";
import { screenToWorld } from "@ice/kernel";
import {
  Camera,
  HandledByWidget,
  Keyboard,
  LocalPointer,
  OverInteractive,
  Pointer,
  PointerButtons,
  PointerMods,
  PointerRadius,
  PointerScreen,
  PointerWheel,
  PointerWorld,
  WentCancelled,
  WentDown,
  WentUp,
  WheelHandled,
} from "../catalog";
import { PointerVersion, bumpVersion } from "../helpers/version-stamps";
import type { InputEvent, InputQueue } from "../input/queue";
import { PointerSettings } from "../catalog/settings-resources";
import { POINTER_DEFAULTS } from "../settings/defaults";

const pointerQ = defineQuery([Pointer, PointerScreen]);
const touchLifecycleQ = defineQuery([Pointer, PointerButtons]);

function radiusFor(device: InputEvent["device"], ps?: { radiusTouchPx: number; radiusPenPx: number; radiusMousePx: number }): number {
  if (device === "touch") return (ps ?? POINTER_DEFAULTS).radiusTouchPx;
  if (device === "pen") return (ps ?? POINTER_DEFAULTS).radiusPenPx;
  return (ps ?? POINTER_DEFAULTS).radiusMousePx;
}

/** Per-pointer fold of one tick's drained events. */
interface Sample {
  device: InputEvent["device"];
  x: number;
  y: number;
  buttons: number;
  downX: number;
  downY: number;
  downMs: number;
  wentDown: boolean;
  wentUp: boolean;
  wentCancelled: boolean;
  handled: boolean;
  /** Last hover-bearing fact's verdict; undefined = no hover info this tick (tag holds). */
  overInteractive: boolean | undefined;
  mods: { shift: boolean; ctrl: boolean; alt: boolean; meta: boolean };
  wheelDx: number;
  wheelDy: number;
  wheelPinch: number;
  hasWheel: boolean;
  /** Any wheel fact this tick was ceded to widget scroll (design-007 §3.5). */
  wheelHandled: boolean;
}

export interface L0Systems {
  pointerLifecycle: System;
  pointerIngest: TickSystem;
  pointerWorldSync: System;
}

export function createL0Systems(world: World, queue: InputQueue): L0Systems {
  // pointerId → entity lookup. Derived index only (the fact is Pointer.id in
  // the world); entries validate with isAlive and rebuild on miss.
  const byId = new Map<string, Entity>();

  const resolve = (id: string): Entity | undefined => {
    const cached = byId.get(id);
    if (cached !== undefined && world.isAlive(cached)) return cached;
    byId.delete(id);
    let found: Entity | undefined;
    world.query(pointerQ).each((b) => {
      for (const r of b) {
        const e = b.entity(r);
        if (world.read(e, Pointer).id === id) {
          found = e;
          return;
        }
      }
    });
    if (found !== undefined) byId.set(id, found);
    return found;
  };

  const pointerLifecycle = defineSystem(
    touchLifecycleQ,
    (b, ctx) => {
      for (const r of b) {
        const e = b.entity(r);
        if (ctx.read(e, Pointer).device !== "touch") continue;
        if (ctx.read(e, PointerButtons).buttons === 0) ctx.destroy(e); // idle-up a full frame
      }
    },
    {
      name: "pointerLifecycle",
      // The STALE read is the mechanism: last frame's buttons==0 ⇒ up+1 destroy
      // (module doc). Declare no reads so strata's advisory "reads before
      // ingest writes" ordering hint doesn't flag the intentional dependency.
      access: { read: [] },
    },
  );

  // Tick system (strata 0.5.0): the drain runs exactly once per frame by
  // construction — the scheduler owns cardinality, no anchor query needed.
  const pointerIngest = defineTickSystem(
    (ctx) => {
      const events = queue.drain();
      if (events.length === 0) return;
      // Live-tunable pick radii (design-005 §4): resource first, const fallback.
      const pointerSettings = ctx.getResource(PointerSettings);

      // --- pass 1: fold ---
      const samples = new Map<string, Sample>();
      let keyboard: { shift: boolean; ctrl: boolean; alt: boolean; meta: boolean; space: boolean } | null =
        null;
      for (const ev of events) {
        if (ev.kind === "key") {
          keyboard = { ...ev.mods };
          continue;
        }
        let s = samples.get(ev.pointerId);
        if (s === undefined) {
          s = {
            device: ev.device,
            x: ev.screenX,
            y: ev.screenY,
            buttons: ev.buttons,
            downX: 0,
            downY: 0,
            downMs: 0,
            wentDown: false,
            wentUp: false,
            wentCancelled: false,
            handled: false,
            overInteractive: undefined,
            mods: { shift: ev.mods.shift, ctrl: ev.mods.ctrl, alt: ev.mods.alt, meta: ev.mods.meta },
            wheelDx: 0,
            wheelDy: 0,
            wheelPinch: 0,
            hasWheel: false,
            wheelHandled: false,
          };
          samples.set(ev.pointerId, s);
        }
        s.x = ev.screenX;
        s.y = ev.screenY;
        s.buttons = ev.buttons;
        s.mods = { shift: ev.mods.shift, ctrl: ev.mods.ctrl, alt: ev.mods.alt, meta: ev.mods.meta };
        if (ev.kind === "down") {
          s.wentDown = true;
          s.downX = ev.screenX;
          s.downY = ev.screenY;
          s.downMs = ev.tMs ?? 0; // event-time anchor (0 ⇒ consumers use frame now)
        } else if (ev.kind === "up") {
          s.wentUp = true;
        } else if (ev.kind === "cancel") {
          s.wentCancelled = true;
        } else if (ev.kind === "wheel" && ev.wheel !== undefined) {
          s.wheelDx += ev.wheel.dx;
          s.wheelDy += ev.wheel.dy;
          s.wheelPinch += ev.wheel.pinch;
          s.hasWheel = true;
          if (ev.wheelHandled === true) s.wheelHandled = true;
        }
        if (ev.surfaceHandled === true) s.handled = true;
        // Hover truth: last stamped fact wins; unstamped facts (wheel, blur
        // cancel, test drivers that don't track hover) leave it undefined.
        if (ev.overInteractive !== undefined) s.overInteractive = ev.overInteractive;
      }

      // --- pass 2: apply ---
      if (keyboard !== null) world.setResource(Keyboard, keyboard);

      for (const [id, s] of samples) {
        const existing = resolve(id);
        if (existing === undefined) {
          const spawned = ctx.spawn({
            components: [
              [Pointer, { id, device: s.device, owner: "" }],
              [PointerScreen, { x: s.x, y: s.y }],
              [PointerButtons, { buttons: s.buttons, downX: s.downX, downY: s.downY, downMs: s.downMs }],
              [PointerMods, s.mods],
              [PointerWheel, { dx: s.wheelDx, dy: s.wheelDy, pinch: s.wheelPinch }],
              [PointerRadius, { r: radiusFor(s.device, pointerSettings) }],
              [PointerWorld, { x: 0, y: 0 }],
            ],
            tags: [LocalPointer],
          });
          if (s.wentDown) ctx.addTag(spawned, WentDown);
          if (s.wentUp) ctx.addTag(spawned, WentUp);
          if (s.wentCancelled) ctx.addTag(spawned, WentCancelled);
          if (s.handled) ctx.addTag(spawned, HandledByWidget);
          if (s.wheelHandled) ctx.addTag(spawned, WheelHandled);
          if (s.overInteractive === true) ctx.addTag(spawned, OverInteractive);
          byId.set(id, spawned);
          continue;
        }

        ctx.edit(existing).set(PointerScreen, { x: s.x, y: s.y });
        const prev = ctx.read(existing, PointerButtons);
        ctx.edit(existing).set(PointerButtons, {
          buttons: s.buttons,
          downX: s.wentDown ? s.downX : prev.downX,
          downY: s.wentDown ? s.downY : prev.downY,
          downMs: s.wentDown ? s.downMs : prev.downMs,
        });
        ctx.edit(existing).set(PointerMods, s.mods);
        if (s.hasWheel) {
          const w = ctx.read(existing, PointerWheel);
          ctx.edit(existing).set(PointerWheel, {
            dx: w.dx + s.wheelDx,
            dy: w.dy + s.wheelDy,
            pinch: w.pinch + s.wheelPinch,
          });
        }
        if (s.wentDown) ctx.addTag(existing, WentDown);
        if (s.wentUp) ctx.addTag(existing, WentUp);
        if (s.wentCancelled) ctx.addTag(existing, WentCancelled);
        if (s.handled) ctx.addTag(existing, HandledByWidget);
        if (s.wheelHandled) ctx.addTag(existing, WheelHandled);
        // Persistent hover-boundary tag, change-only (interaction-rate law):
        // written only when a hover-bearing fact arrived AND the state flipped.
        if (s.overInteractive !== undefined && s.overInteractive !== ctx.hasTag(existing, OverInteractive)) {
          if (s.overInteractive) ctx.addTag(existing, OverInteractive);
          else ctx.removeTag(existing, OverInteractive);
        }
      }

      bumpVersion(world, PointerVersion);
    },
    {
      name: "pointerIngest",
      // Design-003 §10 table. Runs only when input arrived (runIf on the queue),
      // so idle frames stamp nothing.
      access: { write: [Pointer, PointerScreen, PointerButtons, PointerMods, PointerWheel] },
      runIf: () => queue.size() > 0,
    },
  );

  const pointerWorldSync = defineSystem(
    defineQuery([Pointer, PointerScreen, PointerWorld]),
    (b, ctx) => {
      const cam = ctx.getResource(Camera);
      if (cam === undefined) return;
      for (const r of b) {
        const e = b.entity(r);
        const s = ctx.read(e, PointerScreen);
        const w = screenToWorld(s.x, s.y, cam);
        ctx.edit(e).set(PointerWorld, { x: w.x, y: w.y });
      }
    },
    { name: "pointerWorldSync", access: { write: [PointerWorld] } },
  );

  return { pointerLifecycle, pointerIngest, pointerWorldSync };
}
