// The CALENDAR's numbers (CALENDAR.md) — one place. World units are CSS px at zoom 1: the sticky note
// is 200 (a 3″ square), so a day's cell is sized to take one under its date: 240 wide, and in a
// six-week month still 252 tall (the note's 200, turned a degree or two, under the 40 the date
// prints in). The sheet is what those cells make — a desk pad of a blotter's size, 1760 × 1852.
// The pad's build (board, block, tape), the roll the months before go into, the print, the hand,
// the light and the springs follow; the colours are the host's (lab/theme.ts `CALENDAR_LOOK`).

export interface CalendarLaw {
  /** The sheet's bands, head to foot, and its margins. */
  readonly sheet: {
    /** Left and right, beside the grid (the week numbers print in the left one). */
    readonly margin: number;
    /** The cloth tape across the head: the sheets are bound under it. */
    readonly tape: number;
    /** Blank paper under the tape: where the roll of the months before lies. */
    readonly rollZone: number;
    /** The month's name and the two small months. */
    readonly title: number;
    /** The weekdays' row. */
    readonly weekdays: number;
    readonly foot: number;
    /** The pad's corners. */
    readonly radius: number;
  };
  readonly grid: {
    /** A day's width. */
    readonly cw: number;
    /** The grid's height: a month's rows share it (four, five or six). */
    readonly height: number;
    /** The rules between days, and the heavier one under the weekdays (world units). */
    readonly rule: number;
    readonly head: number;
  };
  /** The printed type (the product's stack, DESIGN.md §3: big is light, small is medium). */
  readonly print: {
    readonly numeral: { readonly size: number; readonly baseline: number; readonly pad: number; readonly weight: number };
    readonly title: { readonly size: number; readonly baseline: number; readonly weight: number; readonly year: number };
    readonly weekday: { readonly size: number; readonly tracking: number; readonly weight: number };
    readonly mini: { readonly size: number; readonly pitch: number; readonly col: number; readonly gap: number };
    readonly small: { readonly size: number; readonly weight: number };
    readonly moon: { readonly r: number; readonly inset: number };
  };
  /** The handwriting in the cells (paper/text.ts's hand, at a pen's size). */
  readonly hand: {
    readonly size: number;
    /** A line's pitch. */
    readonly pitch: number;
    /** The first line's top, from the cell's top (under the date). */
    readonly top: number;
    readonly pad: number;
    /** A timed line's time, × the pen's size. */
    readonly time: number;
    /** A band's height, and how far its ends rag. */
    readonly band: number;
    readonly rag: number;
  };
  /** A sticky note stuck to a day: the note's own side, and the gap it keeps from the cell's foot. */
  readonly note: { readonly size: number; readonly gap: number };
  /** The pad's build: the chipboard back, the sheets under the month (the months after), each sheet. */
  readonly pad: { readonly board: number; readonly block: number; readonly sheet: number };
  /**
   * The ROLL: a month rolled up goes into a roll of paper under the tape — an Archimedean spiral whose
   * turns thicken by `tau` each (paper's thickness, made visible), wound on a core so its outer radius
   * at rest is `rest`; `turns` of it are drawn (the rest is inside). The corner's tilt as a roll starts.
   */
  readonly roll: { readonly rest: number; readonly tau: number; readonly turns: number; readonly tilt: number; readonly peek: number };
  /** Carried, the pad rises this far. */
  readonly lift: number;
  /** Springs: [hz, damping]. */
  readonly springs: { readonly roll: readonly [number, number]; readonly lift: readonly [number, number]; readonly ring: readonly [number, number]; readonly peek: readonly [number, number] };
  /** The light: the sky's share, the lambert's cap, the dapple's share on paper and on cloth. */
  readonly light: { readonly ambient: number; readonly cap: number; readonly dapple: number; readonly clothDapple: number };
  /** The shadows: σ at contact, σ per unit of height, the cast's alpha, the contact's alpha and σ. */
  readonly shadow: { readonly sigma0: number; readonly perUnit: number; readonly alpha: number; readonly contact: number; readonly contactSigma: number; readonly slopeMax: number };
  /** The paper (the notebook's baked texture): fibre, mottle, tooth, cockle. */
  readonly paper: { readonly fibre: number; readonly mottle: number; readonly tooth: number; readonly cockle: number };
  readonly cloth: { readonly pitch: number; readonly relief: number; readonly sheen: readonly [number, number] };
  /** The selection ring around the pad (CSS px). */
  readonly ring: { readonly offset: number; readonly width: number };
  /** The eye (the notebook's desk eye). */
  readonly eye: { readonly k: number; readonly min: number };
}

export const CALENDAR: CalendarLaw = {
  sheet: { margin: 40, tape: 56, rollZone: 64, title: 136, weekdays: 40, foot: 44, radius: 3 },
  grid: { cw: 240, height: 1512, rule: 0.9, head: 1.5 },
  print: {
    numeral: { size: 30, baseline: 34, pad: 13, weight: 300 },
    title: { size: 96, baseline: 102, weight: 300, year: 200 },
    weekday: { size: 13, tracking: 0.16, weight: 600 },
    mini: { size: 10.5, pitch: 15, col: 21, gap: 44 },
    small: { size: 11, weight: 500 },
    moon: { r: 5.5, inset: 17 },
  },
  hand: { size: 23, pitch: 30, top: 44, pad: 12, time: 0.82, band: 25, rag: 5 },
  note: { size: 200, gap: 6 },
  pad: { board: 2.2, block: 10, sheet: 0.22 },
  roll: { rest: 27, tau: 0.35, turns: 1.4, tilt: 0.42, peek: 105 },
  lift: 3,
  springs: { roll: [1.25, 0.92], lift: [2.2, 0.8], ring: [4, 1], peek: [3.2, 0.8] },
  light: { ambient: 0.46, cap: 1.28, dapple: 0.35, clothDapple: 1 },
  shadow: { sigma0: 1.4, perUnit: 0.3, alpha: 0.55, contact: 0.42, contactSigma: 1.6, slopeMax: 2.2 },
  paper: { fibre: 3 / 255, mottle: 4 / 255, tooth: 0.55, cockle: 0.3 },
  cloth: { pitch: 0.9, relief: 0.35, sheen: [14, 0.07] },
  ring: { offset: 5, width: 1.5 },
  eye: { k: 1.15, min: 1250 },
};

/** The sheet's size under a law. */
export const sheetSize = (law: CalendarLaw): { readonly W: number; readonly H: number } => {
  const s = law.sheet;
  return { W: 2 * s.margin + 7 * law.grid.cw, H: s.tape + s.rollZone + s.title + s.weekdays + law.grid.height + s.foot };
};
