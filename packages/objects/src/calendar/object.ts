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
import { type KindDriver, defineObject } from "@ice/desk";
import { type CalendarHand, createCalendarHand } from "./hand";
import { type CalendarWriting, createCalendarWriting } from "./writing";
import { PENS } from "@ice/desk/kit";
import { createCalendarInput } from "./host/input";
import { printRaster } from "./host/print";

/** The tapes a pad is bound with (CALENDAR.md §4) — names; the cloths and foils are the host's. */
export const TAPES = ["ink", "tobacco", "kraft"] as const;
export type TapeName = (typeof TAPES)[number];

/** The desk calendar's durable type id. */
export const CALENDAR_TYPE = "desk.calendar";

const PAD = padFrame(CALENDAR);

/**
 * The kind whose objects stick to a day (D3t-c): the note's, asked of the host by its registry NAME (`KindDriverHost.kind`) —
 * never imported, as a plugin kind would name another (K4a, design-016 K-L1): a desk that registers no note kind lends no
 * predicate, and the pad pins nothing. (K8 turns this into a provides-key.)
 */
export const PINNABLE_KIND = "paper";

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
  interaction: { selectable: true, movable: true, resizable: false, snap: "both", drop: "never" },
  // its entries and its pins are its DATA (D3t-a's door, D3t-c): the catalog stamps, gates and migrates their prefabs with the pad's own
  data: [EventPrefab, PinPrefab],
  // the notes stuck to it RIDE with it (D3t-c — core's `riders`): carried by its tape, they move with it and land in its transaction
  riders: (world, pad) => pinnedNotes(world, pad).map((p) => p.note),
  // the desk calendar at work (D3t-c): its WRITING (the sessions the ONE editor is lent to) and its HAND (the marks, the rolls, the
  // notes' landing) — its DOM half (the days and the pen at event time) is the host's and joins through `input` (D-D7-A.3)
  drivers: (h): CalendarDriver => {
    const pads = (): Pads | undefined => h.local as Pads | undefined;
    const writing = createCalendarWriting({ world: h.world, docs: h.docs, pads });
    const isNote = h.kind(PINNABLE_KIND);
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
  // (host/calendar-input.ts), mounted over the ONE editor it borrows — none on a desk that made no editor
  host: {
    lend: (h) => (h.text === undefined ? {} : { print: printRaster({ text: h.text }) }),
    mount: (h) => {
      if (h.editor === undefined) return;
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
