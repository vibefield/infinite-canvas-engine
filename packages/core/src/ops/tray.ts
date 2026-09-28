/**
 * THE TRAY'S OPS (design-017 §2; K3) — the ways a host, the keymap and a rig move the pegboard drawer's facts (`Tray`, runtime, one
 * per view). Outside the tick, world-taking like `cancelActiveGestures`; the tray's input system (systems/tray.ts) is their one
 * in-tick peer. Opening is refused while an object is in hand (the hand is a focus of its own — put it down first) and cancels every
 * gesture in flight (widgetlab's hygiene: nothing freezes mid-drag under the drawer); closing lets the band go. design-018 §6 (R2):
 * the drawer's CATEGORY — which of the entries it lays ("" all), and the categories the frame hangs, for a host's chips.
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
    components: [[Tray, { open: false, scroll: 0, stretch: 0, wheelAt: 0, hover: "" }], [TrayContent, { width: 0, bottom: 0, laid: 0 }]],
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

const write = (world: World, patch: Partial<{ open: boolean; scroll: number; stretch: number; hover: string; category: string }>): void => {
  const e = ensureTray(world);
  const cur = world.read(e, Tray);
  const next = { ...cur, ...patch };
  if (next.open !== cur.open || next.scroll !== cur.scroll || next.stretch !== cur.stretch || next.hover !== cur.hover || next.category !== cur.category) world.edit(e).set(Tray, next);
};

/** Open the drawer: refused (false) while an object is in hand; every gesture in flight is cancelled. */
export function openTray(world: World): boolean {
  if (heldEntity(world) !== undefined) return false;
  if (!trayOpen(world)) cancelActiveGestures(world);
  write(world, { open: true });
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

/** A tray category as a host's chip shows it (design-018 §6): its id (an entry's `category`), its label, how many entries the frame hangs in it. */
export interface TrayCategory {
  readonly id: string;
  /** The id with its first letter capitalized ("surfaces" → "Surfaces"). */
  readonly label: string;
  readonly count: number;
}

/** The category the drawer shows ("" — all). */
export function trayCategory(world: World): string {
  const e = world.firstOf(trayQ);
  return e === undefined ? "" : (world.get(e, Tray)?.category ?? "");
}

/**
 * Show one category of the tray's entries ("" — all): the lay (systems/tray.ts `createTrayLay`) hangs only its entries, zeroes the
 * scroll and the band on the change, and falls back to all when the frame hangs none of it (an id no entry names included).
 */
export function setTrayCategory(world: World, id: string): void {
  write(world, { category: id });
}

/**
 * The categories PRESENT among the entries the drawer's frame hangs (design-018 §6) — the catalog's tray entries the current frame
 * takes (K9 S13), before the category's filter — in the lay's order, each with its label and count: a host's chips. An entry that
 * names no category is laid under all alone (it has no chip). Empty until the lay has run (the renderer's first frame).
 */
export function trayCategories(world: World): TrayCategory[] {
  return presentOf(world).filter(([id]) => id !== "").map(([id, count]) => ({ id, label: id.charAt(0).toUpperCase() + id.slice(1), count }));
}

/** How many entries the drawer's frame hangs, every category (before the filter) — 0: the tray has nothing to offer here. */
export function trayEntryCount(world: World): number {
  return presentOf(world).reduce((n, [, count]) => n + count, 0);
}

/** The lay's record of what the frame could hang (`TrayContent.present`), read back. */
function presentOf(world: World): (readonly [string, number])[] {
  const e = world.firstOf(trayQ);
  const raw = e === undefined ? undefined : world.get(e, TrayContent)?.present;
  if (raw === undefined || raw === null || raw === "") return [];
  const list: unknown = JSON.parse(raw);
  return Array.isArray(list) ? list.filter((q): q is [string, number] => Array.isArray(q) && typeof q[0] === "string" && typeof q[1] === "number") : [];
}
