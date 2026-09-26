// The DESK CALENDAR (CALENDAR.md) as an OBJECT (design-015 §6; D3w): a pad of the notebook's paper under a cloth
// tape, lying beneath everything (stratum `pads`). Durable props: the MONTH it shows (YYYY-MM), its week start
// (1 Monday, 0 Sunday), its tape and the pen its caret is drawn in, by name (the colours are the host's). What is
// WRITTEN on it and what is STUCK to it are data children (calendar/data.ts): its events `desk.event`, its pins
// `desk.pin` (a note stuck to a day) — read-only in this slice; the roll, the entries and the sticking are D3t's.
// Its rect is the sheet (1760 × 1852 at the law's cell); movable by its tape, selectable; a ROOT object (D-D18).

import { p } from "@ice/core";
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
    month: p.string({ default: "2026-09" }),
    weekStart: p.number({ default: 1 }),
    tape: p.enum(TAPES, { default: "ink" }),
    pen: p.enum(PENS, { default: "felt" }),
  },
  size: { w: PAD.W, h: PAD.H },
  kind: calendarKind(),
  interaction: { selectable: true, movable: true, resizable: false, snap: "both" },
});
