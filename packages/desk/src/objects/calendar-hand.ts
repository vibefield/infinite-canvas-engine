// THE DESK CALENDAR AT WORK — its hand (CALENDAR.md §5; D3t-c): the world half of the calendar's interaction, the whiteboard pen's
// sibling (objects/pen.ts). Once a frame, before the kinds' clocks, it READS the world — each pad's selection (`PadSelection`, the
// user's fact), the entry being written (objects/calendar-writing.ts) and the editor's caret (host/calendar-input.ts) — and hands
// the calendar kind's local what to MARK on each pad this frame (`Pads.mark`: the days selected, the entry, the caret's blink, the
// newest glyph's wipe). It WRITES only as an op would, each out of the frame (a reflector never writes — D-D2c.5): the bar's today
// (`home` bumped) rolls the pad home — its month, ONE transaction, off the undo stack (D-D3t-c.5) — and selects today.

import { defineQuery, type Entity, setWidgetProps, type World } from "@ice/core";
import { dayOr, monthKeyOf, PadSelection } from "../calendar/data";
import { keyOf, monthOfDay } from "../calendar/month";
import { DRAFT_ID, type PadMarks, type Pads } from "../kinds/calendar";
import type { CalendarWriting } from "./calendar-writing";
import type { TypingDocs } from "./typing";

export interface CalendarHandOptions {
  readonly world: World;
  readonly docs: TypingDocs;
  readonly pads: () => Pads | undefined;
  readonly writing: CalendarWriting;
  /** The editor's caret on the line being written — its index and when its blink restarted (the hand's clock) — and the newest glyph's wipe. */
  readonly caret: () => { readonly index: number; readonly t0: number; readonly wipe: { readonly index: number; readonly t0: number } | null } | null;
  /** The caret's blink, ms (530). */
  readonly blinkMs?: number;
  /** The newest glyph's wipe, ms (the hand's 110). */
  readonly wipeMs?: number;
  /** Where a transaction runs: out of the frame (a microtask) unless a test says. */
  readonly defer?: (fn: () => void) => void;
}

export interface CalendarHand {
  /** Once a frame, before the kinds' clocks: the marks on every pad; the bar's today acted on. */
  follow(now: number): void;
}

const selectionsQ = defineQuery([PadSelection]);


export function createCalendarHand(opts: CalendarHandOptions): CalendarHand {
  const { world, docs } = opts;
  const defer = opts.defer ?? ((fn: () => void) => queueMicrotask(fn));
  const blinkMs = opts.blinkMs ?? 530;
  const wipeMs = opts.wipeMs ?? 110;
  /** The pads marked last frame (a pad whose selection went is given back its bare sheet). */
  let marked = new Set<Entity>();
  /** Each pad's `home` as last seen: a bump is the bar's today. */
  const homes = new Map<Entity, number>();

  /** Roll a pad home and select today: its month (one transaction, off the undo stack) and its days. */
  const goHome = (pad: Entity): void => {
    const pads = opts.pads();
    if (pads === undefined) return;
    const today = pads.today();
    const key = keyOf(today);
    const month = monthKeyOf(monthOfDay(today));
    defer(() => {
      if (!world.isAlive(pad)) return;
      const cur = world.get(pad, PadSelection);
      if (cur !== undefined) world.edit(pad).set(PadSelection, { ...cur, anchor: key, focus: key, entry: 0 as Entity });
      const session = docs.current();
      if (session === undefined) return;
      try { setWidgetProps(session.store, world, pad, { month }, { undoable: false }); } catch { /* a read-only document keeps its month */ }
    });
  };

  return {
    follow(now) {
      const pads = opts.pads();
      if (pads === undefined) return;
      const next = new Set<Entity>();
      const w = opts.writing.current();
      world.query(selectionsQ).each((b) => {
        for (const r of b) {
          const pad = b.entity(r);
          const sel = world.read(pad, PadSelection);
          const seen = homes.get(pad);
          if (sel.home !== (seen ?? 0)) goHome(pad);
          homes.set(pad, sel.home);
          const a = dayOr(sel.anchor ?? "");
          const f = dayOr(sel.focus ?? "");
          const entry = sel.entry as number;
          const marks: { -readonly [K in keyof PadMarks]: PadMarks[K] } = {};
          if (a !== undefined && f !== undefined) marks.days = [Math.min(a, f), Math.max(a, f)];
          if (entry !== 0 && world.isAlive(sel.entry)) marks.entry = entry;
          pads.mark(pad, Object.keys(marks).length > 0 ? marks : undefined);
          next.add(pad);
        }
      });
      // the line being written: its caret (the blink on the hand's clock), its newest glyph's wipe
      if (w !== null) {
        const id = w.draft !== null ? DRAFT_ID : ((w.entry as number | null) ?? DRAFT_ID);
        const c = opts.caret();
        const base = pads.marksOf(w.pad) ?? {};
        const on = c === null ? true : Math.floor(Math.max(0, now - c.t0) / blinkMs) % 2 === 0;
        const wipe = c?.wipe !== null && c?.wipe !== undefined && now - c.wipe.t0 < wipeMs ? { entry: id, index: c.wipe.index, t: Math.max(0, (now - c.wipe.t0) / wipeMs) } : undefined;
        const { days: _days, ...rest } = base;
        pads.mark(w.pad, { ...rest, entry: id, writing: { entry: id, index: c?.index ?? w.draft?.text.length ?? 0, on }, ...(wipe !== undefined ? { wipe } : {}) });
        next.add(w.pad);
      }
      for (const pad of marked) if (!next.has(pad)) pads.mark(pad, undefined);
      marked = next;
      for (const pad of [...homes.keys()]) if (!world.isAlive(pad) || !world.has(pad, PadSelection)) homes.delete(pad);
    },
  };
}
