// The DESK CALENDAR (CALENDAR.md) as an OBJECT (design-015 §6; D3w): a pad of the notebook's paper under a cloth
// tape, lying beneath everything (stratum `pads`). Durable props: the MONTH it shows (YYYY-MM), its week start
// (1 Monday, 0 Sunday), its tape and the pen its caret is drawn in, by name (the colours are the host's). What is
// WRITTEN on it and what is STUCK to it are data children (calendar/data.ts): its events `desk.event`, its pins
// `desk.pin` (a note stuck to a day; D3t-c writes both, and the notes stuck to it ride with it — its `riders`).
// Its rect is the sheet (1760 × 1852 at the law's cell); movable by its tape, selectable; a ROOT object (D-D18:
// `interaction.drop: "never"` — no container takes it, whatever it accepts).

import { p } from "@ice/core";
import { EventPrefab, PinPrefab, pinnedNotes } from "../calendar/data";
import { CALENDAR } from "../calendar/law";
import { padFrame } from "../calendar/pad";
import { calendarKind } from "../kinds/calendar";
import { defineObject } from "../object";
import { PENS } from "./note";

/** The tapes a pad is bound with (CALENDAR.md §4) — names; the cloths and foils are the host's. */
export const TAPES = ["ink", "tobacco", "kraft"] as const;
export type TapeName = (typeof TAPES)[number];

/** The desk calendar's durable type id. */
export const CALENDAR_TYPE = "desk.calendar";

const PAD = padFrame(CALENDAR);

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
});
