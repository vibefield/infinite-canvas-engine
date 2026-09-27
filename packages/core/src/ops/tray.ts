/**
 * THE TRAY'S OPS (design-017 §2; K3) — the ways a host, the keymap and a rig move the pegboard drawer's facts (`Tray`, runtime, one
 * per view). Outside the tick, world-taking like `cancelActiveGestures`; the tray's input system (systems/tray.ts) is their one
 * in-tick peer. Opening is refused while an object is in hand (the hand is a focus of its own — put it down first) and cancels every
 * gesture in flight (widgetlab's hygiene: nothing freezes mid-drag under the drawer); closing lets the band go.
 */
import type { Entity, World } from "@vibecook/strata-ecs";
import { defineQuery } from "@vibecook/strata-ecs";
import { Tray, TrayContent } from "../catalog/desk";
import { Container } from "../catalog/graph";
import { heldEntity } from "../systems/held";
import { cancelActiveGestures } from "./gestures";

const trayQ = defineQuery([Tray]);

/**
 * The view's tray entity, spawned (runtime, closed) if the world has none — at install, and after a reset. It ROOTS the tray's
 * runtime canvas (K5a — a `Container`, so its specimens' first container is it, never a frame: none is ever `Active`), its
 * content not yet laid.
 */
export function ensureTray(world: World): Entity {
  const existing = world.firstOf(trayQ);
  if (existing !== undefined) return existing;
  return world.spawn({
    components: [[Tray, { open: false, scroll: 0, stretch: 0, lip: false, wheelAt: 0, hover: "" }], [TrayContent, { width: 0, bottom: 0, laid: 0 }]],
    tags: [Container],
  });
}

/** The view's tray entity, if there is one. */
export function trayEntity(world: World): Entity | undefined {
  return world.firstOf(trayQ);
}

/** Is the drawer out? */
export function trayOpen(world: World): boolean {
  const e = world.firstOf(trayQ);
  return e !== undefined && world.get(e, Tray)?.open === true;
}

const write = (world: World, patch: Partial<{ open: boolean; scroll: number; stretch: number; lip: boolean; hover: string }>): void => {
  const e = ensureTray(world);
  const cur = world.read(e, Tray);
  const next = { ...cur, ...patch };
  if (next.open !== cur.open || next.scroll !== cur.scroll || next.stretch !== cur.stretch || next.lip !== cur.lip || next.hover !== cur.hover) world.edit(e).set(Tray, next);
};

/** Open the drawer: refused (false) while an object is in hand; every gesture in flight is cancelled. */
export function openTray(world: World): boolean {
  if (heldEntity(world) !== undefined) return false;
  if (!trayOpen(world)) cancelActiveGestures(world);
  write(world, { open: true, lip: false });
  return true;
}

/** Close the drawer; the band lets go. */
export function closeTray(world: World): void {
  write(world, { open: false, stretch: 0, hover: "" });
}

/** Open a closed drawer, close an open one; returns whether it is open now. */
export function toggleTray(world: World): boolean {
  if (trayOpen(world)) { closeTray(world); return false; }
  return openTray(world);
}

/** Set the board's scroll (CSS px past its top) — a host's or a rig's door; any value (the input clamps what it moves). */
export function scrollTray(world: World, scroll: number): void {
  write(world, { scroll, stretch: 0 });
}
