// The DESK CALENDAR (CALENDAR.md) as an OBJECT (design-015 §6; D3w): a pad of the notebook's paper under a cloth
// tape, lying beneath everything (stratum `pads`). Durable props: the MONTH it shows (YYYY-MM), its week start
// (1 Monday, 0 Sunday), its tape and the pen its caret is drawn in, by name (the colours are the host's). What is
// WRITTEN on it and what is STUCK to it are data children (calendar/data.ts): its events `desk.event`, its pins
// `desk.pin` (a note stuck to a day; D3t-c writes both, and the notes stuck to it ride with it — its `riders`).
// Its rect is the sheet (1760 × 1852 at the law's cell); movable by its tape, selectable; a ROOT object (D-D18:
// `interaction.drop: "never"` — no container takes it, whatever it accepts).

import { type Entity, p } from "@ice/core";
import { EventPrefab, PinPrefab, pinnedNotes } from "./data";
import { CALENDAR } from "./law";
import { padFrame } from "./pad";
import { type CalendarPart, calendarKind, type Pads } from "./kind";
import { DESK_OBJECT, type KindDriver, defineObject, PINNABLE } from "@ice/desk";
import { type CalendarHand, createCalendarHand } from "./hand";
import { type CalendarWriting, createCalendarWriting } from "./writing";
import { PENS, PRINT_RASTER, service, TEXT_RASTER } from "@ice/desk/kit";
import { CALENDAR_LINE, createCalendarInput } from "./host/input";
import { printRaster } from "./host/print";

/** The tapes a pad is bound with (CALENDAR.md §4) — names; the cloths and foils are the host's. */
export const TAPES = ["ink", "tobacco", "kraft"] as const;
export type TapeName = (typeof TAPES)[number];

/** The desk calendar's durable type id. */
export const CALENDAR_TYPE = "desk.calendar";

const PAD = padFrame(CALENDAR);

/**
 * What sticks to a day (D3t-c): an object that PROVIDES `PINNABLE` (K8a — the note does; a plugin kind may), asked of the host by that
 * key (`KindDriverHost.provides`) — never by another kind's name: a desk where nothing provides it lends no predicate, and the pad
 * pins nothing.
 */
export { PINNABLE } from "@ice/desk";

export const Calendar = defineObject({
  type: CALENDAR_TYPE,
  version: 1,
  props: {
    // '' — no month chosen: the pad shows the month of its today (the calendar's clock seam, D7) until a roll writes one
    month: p.string({ default: "" }),
    weekStart: p.number({ default: 1 }),
    tape: p.enum(TAPES, { default: "ink" }),
    pen: p.enum(PENS, { default: "felt" }),
  },
  size: { w: PAD.W, h: PAD.H },
  kind: calendarKind(),
  // on the pegboard tray (design-017 §8): the pad on a hook
  // …printing the month of its today through its own print (K5b — `local`: `month` '' follows the clock); one taken is this month's too
  tray: { label: "Calendar", category: "paper", order: 3, local: true, hang: { w: 152, h: 160, accessory: "hook", pegs: [[0, -0.5]] } },
  interaction: { selectable: true, movable: true, resizable: false, snap: "both", drop: "never" },
  // it lies on the desk by what it provides (K8a — `DESK_OBJECT`, the desk canvas's one key), as a plugin kind does
  provides: [DESK_OBJECT],
  // its entries and its pins are its DATA (D3t-a's door, D3t-c): the catalog stamps, gates and migrates their prefabs with the pad's own
  data: [EventPrefab, PinPrefab],
  // the notes stuck to it RIDE with it (D3t-c — core's `riders`): carried by its tape, they move with it and land in its transaction
  riders: (world, pad) => pinnedNotes(world, pad).map((p) => p.note),
  // the desk calendar at work (D3t-c): its WRITING (the sessions the ONE editor is lent to) and its HAND (the marks, the rolls, the
  // notes' landing) — its DOM half (the days and the pen at event time) is the host's and joins through `input` (D-D7-A.3)
  drivers: (h): CalendarDriver => {
    const pads = (): Pads | undefined => h.local as Pads | undefined;
    const writing = createCalendarWriting({ world: h.world, docs: h.docs, pads });
    const isNote = h.provides(PINNABLE);
    const driver: CalendarDriver = {
      writing,
      pads,
      isPad: h.isKind,
      input: undefined,
      hand: createCalendarHand({
        world: h.world, docs: h.docs, pads, writing, caret: () => driver.input?.caret() ?? null,
        geometryOf: h.geometryOf, hand: h.hand, heldToWorld: h.heldToWorld, isPad: h.isKind, ...(isNote !== undefined ? { isNote } : {}),
      }),
      follow: (now) => driver.hand.follow(now),
      idle: () => driver.hand.idle(),
      dispose: () => { driver.hand.dispose(); driver.input?.dispose(); driver.input = undefined; },
    };
    return driver;
  },
  // its DOM HALF (K4b — declared, never found by type): its PRINT raster, lent to its world half before its local (the tiles in
  // the host's hand, D3t-c — none without a text raster: the oracle pins committed tiles), and its days and its pen at event time
  // (host/calendar-input.ts), mounted over the desk's ONE editor, which it leases (K8a: every desk has one)
  host: {
    lend: (h) => { const text = h.use(TEXT_RASTER); return text === undefined ? [] : [service(PRINT_RASTER, printRaster({ text }))]; },
    // its TEXT PART (K8a): a day's line — leased by its own half at event time (a day selected), never routed a tap by the desk
    text: () => [{ part: CALENDAR_LINE }],
    mount: (h) => {
      createCalendarInput({
        container: h.container, world: h.world, object: h.object, driver: h.driver as CalendarDriver | undefined, editor: h.editor, docs: h.docs,
        geometryOf: h.geometryOf, hand: h.hand, heldToWorld: h.heldToWorld, look: h.look, wake: h.wake,
      });
    },
  },
});

/** The calendar's DOM half as its driver sees it (host/calendar-input.ts implements it): the caret on the line being written, the part under a client point, the selection's doors. */
export interface CalendarInputDoors {
  caret(): { readonly index: number; readonly t0: number; readonly wipe: { readonly index: number; readonly t0: number } | null } | null;
  partAtClient(x: number, y: number): { readonly pad: Entity; readonly part: CalendarPart } | null;
  selectDays(pad: Entity, anchor: number, focus: number): void;
  selectEntry(pad: Entity, entry: Entity): void;
  clear(): void;
  dispose(): void;
}

/** The calendar's driver (`driversOf(Calendar)`): its writing, its hand, its pads, its membership — and the DOM half that joins it. */
export interface CalendarDriver extends KindDriver {
  readonly writing: CalendarWriting;
  readonly hand: CalendarHand;
  readonly pads: () => Pads | undefined;
  readonly isPad: (e: Entity) => boolean;
  /** The DOM half, once the host has made it (the days and the pen at event time); the hand reads its caret. */
  input: CalendarInputDoors | undefined;
}
