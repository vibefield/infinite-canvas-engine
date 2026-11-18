/**
 * THE TRAY'S OPS (design-017 §2; K3) — the ways a host, the keymap and a rig move the pegboard drawer's facts (`Tray`, runtime, one
 * per view). Outside the tick, world-taking like `cancelActiveGestures`; the tray's input system (systems/tray.ts) is their one
 * in-tick peer. Opening is refused while an object is in hand (the hand is a focus of its own — put it down first) and cancels every
 * gesture in flight (widgetlab's hygiene: nothing freezes mid-drag under the drawer); closing lets the band go. design-018 §6 (R2):
 * the drawer's CATEGORY — which of the entries it lays ("" all), and the categories the frame hangs, for a host's chips. Petition
 * I37: the board's KEYBOARD FOCUS — which specimen a host's arrows are on (`focusTray`), the one its ⏎ lays (the facade's
 * `ops.layFromTray`). Petition I54: the SET the drawer lays across its categories (`setTrayOnly` — a host's "what just arrived")
 * and the types the board does not hang while the desk still draws them (`setTrayHidden` — a person's per-object switch).
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

const write = (world: World, patch: Partial<{ open: boolean; scroll: number; stretch: number; hover: string; category: string; focus: string; only: string; hidden: string }>): void => {
  const e = ensureTray(world);
  const cur = world.read(e, Tray);
  const next = { ...cur, ...patch };
  if (next.open !== cur.open || next.scroll !== cur.scroll || next.stretch !== cur.stretch || next.hover !== cur.hover || next.category !== cur.category || next.focus !== cur.focus
    || next.only !== cur.only || next.hidden !== cur.hidden) world.edit(e).set(Tray, next);
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

/**
 * The types the board hangs now, in the LAY'S order — row by row, and across the categories when the drawer shows all or a set (`TrayContent.
 * order`, the lay's record) — what the keyboard focus walks (petition I37). Empty until the lay has run (the renderer's first frame);
 * a set or a hidden type asked (petition I54) is in it from the lay of the step after.
 */
export function trayHung(world: World): string[] {
  const e = world.firstOf(trayQ);
  const raw = e === undefined ? undefined : world.get(e, TrayContent)?.order;
  if (raw === undefined || raw === null || raw === "") return [];
  const list: unknown = JSON.parse(raw);
  return Array.isArray(list) ? list.filter((q): q is string => typeof q === "string") : [];
}

/** Where the board's keyboard focus moves (petition I37): along the lay's order, or to its ends. */
export type TrayFocusMove = "next" | "prev" | "first" | "last";

/** The specimen the board's keyboard focus is on — its object type ("" — none). */
export function trayFocus(world: World): string {
  const e = world.firstOf(trayQ);
  return e === undefined ? "" : (world.get(e, Tray)?.focus ?? "");
}

/**
 * Move the board's KEYBOARD FOCUS (petition I37): `next`/`prev` along the specimens the lay hangs, in its order (row by row, and
 * across the categories when the drawer shows all or a set, I54) — from none, `next` is the first and `prev` the last; at an end it stays —
 * `first`/`last`, or a type by its id (one the board does not hang: the focus stays where it was). The lay scrolls the specimen it
 * moves to into the board's face (`createTrayLay`); nothing is drawn for it (a host rings `TrayAnchor.focused`). Open or shut, the
 * board is laid alike. Returns the focused type ("" — the board hangs nothing).
 */
export function focusTray(world: World, to: TrayFocusMove | string): string {
  const order = trayHung(world);
  const cur = trayFocus(world);
  const i = order.indexOf(cur);
  const last = order.length - 1;
  let next: string;
  if (to === "first") next = order[0] ?? "";
  else if (to === "last") next = order[last] ?? "";
  else if (to === "next") next = order[i < 0 ? 0 : Math.min(i + 1, last)] ?? "";
  else if (to === "prev") next = order[i < 0 ? last : Math.max(i - 1, 0)] ?? "";
  else next = order.includes(to) ? to : cur;
  write(world, { focus: next });
  return next;
}

/** A tray category as a host's chip shows it (design-018 §6): its id (an entry's `category`), its label, how many entries the frame hangs in it. */
export interface TrayCategory {
  readonly id: string;
  /** The id with its first letter capitalized ("surfaces" → "Surfaces"). */
  readonly label: string;
  readonly count: number;
}

/**
 * The category the drawer shows ("" — all). While a SET stands (petition I54) it is "" — from the next lay: one asked meanwhile reads
 * as asked until the next step's lay writes it back "".
 */
export function trayCategory(world: World): string {
  const e = world.firstOf(trayQ);
  return e === undefined ? "" : (world.get(e, Tray)?.category ?? "");
}

/**
 * Show one category of the tray's entries ("" — all): the lay (systems/tray.ts `createTrayLay`) hangs only its entries, zeroes the
 * scroll and the band on the change, and falls back to all when the frame hangs none of it (an id no entry names included). While a
 * SET stands (petition I54, `setTrayOnly`) the set wins: the next step's lay writes the category back "", as it does one the frame
 * hangs none of — until then `trayCategory` reads it as asked. A host's chip that should END the set says `setTrayOnly(world, null)`
 * first, then the category.
 */
export function setTrayCategory(world: World, id: string): void {
  write(world, { category: id });
}

/** A list of object types as the tray's facts hold one (petition I54): each once, sorted, JSON `string[]` — "" for none. */
function typesFact(types: readonly string[], door: string): string {
  if (!Array.isArray(types) || types.some((q) => typeof q !== "string")) {
    throw new Error(`[ice] tray: ${door} — the types are ${JSON.stringify(types) ?? String(types)}: an array of object types (strings)`);
  }
  const list = [...new Set(types)].sort();
  return list.length === 0 ? "" : JSON.stringify(list);
}

/**
 * The object types a tray fact lists (petition I54 — `Tray.only`, `Tray.hidden`: JSON `string[]`, "" for none) — the ONE reader, the
 * lay's (systems/tray.ts, memoised by the raw string), the input's for a lifted take whose specimen went, and these ops'. A string
 * that is not such a list (a fact written by hand, not by the ops), or none at all (null, undefined), reads as none, never a throw:
 * the lay reads it inside the tick.
 */
export function trayTypesOf(raw: string | null | undefined): string[] {
  if (raw === undefined || raw === null || raw === "") return [];
  let list: unknown;
  try { list = JSON.parse(raw); } catch { return []; }
  return Array.isArray(list) ? list.filter((q): q is string => typeof q === "string") : [];
}

/**
 * Petition I54 — lay a SET of object types across their categories (`null` — none: the drawer lays what its category says): the lay
 * (systems/tray.ts `createTrayLay`) hangs only the set's types the frame hangs, in the lay's (category, order, type) order — no tape
 * per category is drawn. The set WINS over the category: the category reads "" while it stands (written "" here with it, and written
 * back "" by the next lay over one asked meanwhile), so clearing the set shows every object — never the category before it. A move of
 * the set re-lays and starts the board at its top — but a focus that still hangs is then scrolled into the face, the least that shows
 * it; a focus that no longer hangs is let go. The categories (`trayCategories`) and the count (`trayEntryCount`) stay the frame's whole
 * hang, so a host's chips can quiet themselves while a set shows.
 * THE FALLBACK IS DESTRUCTIVE (the category's rule — the fact says what is shown): a set the frame hangs none of — an empty list, ids
 * no entry names, every one hidden, refused in an entered container, or kinds the mounted desk cannot draw (I38) — is dropped at the
 * next lay (written back none), and the category it replaced is not restored. So a host says the set again to restore it, and says a
 * set over NEW kinds only once the desk that draws them is mounted (I25: a remount) and its `subscribe` reports them. What this op
 * writes is the set AS ASKED (`trayOnly` reads it, ids that hang nothing included); what hangs is the lay's record (`trayHung`) and
 * its count. Never durable: a desk remounted on one engine keeps it; a new world — a new engine, a document switch — starts with none.
 * Throws unless `types` is `null` or an array of strings.
 */
export function setTrayOnly(world: World, types: readonly string[] | null): void {
  const only = types === null ? "" : typesFact(types, "only");
  write(world, only === "" ? { only } : { only, category: "" });
}

/** The set the drawer lays, as asked (petition I54): its types, sorted — null, none. What hangs of it is `trayHung`. */
export function trayOnly(world: World): string[] | null {
  const e = world.firstOf(trayQ);
  const list = trayTypesOf(e === undefined ? undefined : world.get(e, Tray)?.only);
  return list.length === 0 ? null : list;
}

/**
 * Petition I54 — the types the board does NOT hang (`[]` — none), a host's word (a person's per-object switch): the lay hangs no
 * specimen of a hidden type — so no hover, no press, no take (one in flight is put back), and `ops.layFromTray` refuses it at once —
 * counts it nowhere and offers no category it alone would fill (`trayCategories`, `trayEntryCount`); with every type hidden the count
 * is 0, as for a frame that hangs nothing. A change re-lays: the scroll is kept (clamped as any move of the range clamps it), a focus on
 * a type now hidden is let go. No system but the tray's own reads it — the type's objects on the desk draw, select, duplicate and work as
 * before. Never durable: a desk remounted on one engine keeps it; a new world — a new engine, a document switch — starts with none (a
 * host that keeps a person's switches says them again then). Throws unless `types` is an array of strings.
 */
export function setTrayHidden(world: World, types: readonly string[]): void {
  write(world, { hidden: typesFact(types, "hide") });
}

/** The types the board does not hang (petition I54), sorted — [] for none. */
export function trayHidden(world: World): string[] {
  const e = world.firstOf(trayQ);
  return trayTypesOf(e === undefined ? undefined : world.get(e, Tray)?.hidden);
}

/**
 * The categories PRESENT among the entries the drawer's frame hangs (design-018 §6) — the catalog's tray entries the current frame
 * takes (K9 S13), before the category's filter and the set (petition I54), a hidden type counted nowhere — in the lay's order, each
 * with its label and count: a host's chips. An entry that names no category is laid under all alone (it has no chip). Empty until the
 * lay has run (the renderer's first frame).
 */
export function trayCategories(world: World): TrayCategory[] {
  return presentOf(world).filter(([id]) => id !== "").map(([id, count]) => ({ id, label: id.charAt(0).toUpperCase() + id.slice(1), count }));
}

/** How many entries the drawer's frame hangs, every category (before the filter and the set; none hidden — I54) — 0: the tray has nothing to offer here. */
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
