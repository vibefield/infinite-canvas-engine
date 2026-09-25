// The EVENTS — what is written on the calendar, and where on a sheet each line goes (CALENDAR.md §5).
// Pure. An event is a line of handwriting on a day, or a highlighter's band across several: its days
// (day numbers, inclusive), its text as written, each glyph's own seed (the hand, carried through
// edits as the sticky note's are), its ink. A time at the head of the text ("9:30 dentist", "3pm
// call") makes it a TIMED event: a day sorts its lines as a system calendar's month view does —
// the bands first, in lanes that hold across the week, then the day's untimed lines in the order
// they were written, then the timed ones by their time.

/** One entry on the calendar. */
export interface CalEvent {
  readonly id: number;
  /** First and last day (day numbers, inclusive); equal for a one-day line. */
  start: number;
  end: number;
  text: string;
  /** Each glyph's seed — its hand (paper/text.ts `carrySeeds`). */
  seeds: number[];
  seed: number;
  /** The pen (a line) or the highlighter (a band) — the host's names; the law never reads them. */
  ink: string;
  /** Bumped on every edit: part of the raster's key. */
  rev: number;
}

export const isSpan = (e: CalEvent): boolean => e.end > e.start;

/**
 * A time at the head of an entry: `9:30`, `14:00`, `9am`, `9.30pm`, `3 pm`, `12a` — hours and minutes,
 * or an hour with am/pm. A bare number is not a time ("3 apples"). Returns minutes after midnight
 * and how many characters it took (with the space after it), or null.
 */
export function parseTime(text: string): { readonly minutes: number; readonly len: number } | null {
  const m = /^\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.|a|p)?(?=\s|$)\s*/i.exec(text);
  if (!m) return null;
  const hasMin = m[2] !== undefined;
  const ap = m[3]?.toLowerCase().replace(/\./g, "");
  if (!hasMin && !ap) return null;
  let h = Number(m[1]);
  const min = hasMin ? Number(m[2]) : 0;
  if (min > 59) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    const pm = ap.startsWith("p");
    h = (h % 12) + (pm ? 12 : 0);
  } else if (h > 23) return null;
  return { minutes: h * 60 + min, len: m[0].length };
}

/** An event's time, or null (an all-day line). */
export const timeOf = (e: CalEvent): number | null => (isSpan(e) ? null : parseTime(e.text)?.minutes ?? null);

/** The order of a day's one-day lines: untimed first (as written, by id), then timed by the clock. */
export function compareLines(a: CalEvent, b: CalEvent): number {
  const ta = timeOf(a);
  const tb = timeOf(b);
  if (ta === null && tb === null) return a.id - b.id;
  if (ta === null) return -1;
  if (tb === null) return 1;
  return ta - tb || a.id - b.id;
}

/** One week's piece of a band: the columns it covers in that row, its lane, whether the event starts or ends in it. */
export interface SpanSeg {
  readonly event: CalEvent;
  readonly row: number;
  readonly col0: number;
  readonly col1: number;
  readonly lane: number;
  readonly head: boolean;
  readonly tail: boolean;
}

/** A day's lines as its cell writes them (an entry may take two lines: `layoutMonth`'s `size`). */
export interface CellLines {
  readonly day: number;
  /** Lines the week's bands take at the top of this cell (their lanes through it). */
  readonly lanes: number;
  /** The one-day lines, sorted; those that fit and those that do not. */
  readonly shown: readonly CalEvent[];
  readonly hidden: number;
}

/**
 * Lay a grid's weeks out: every band cut into its week rows and given a lane that holds across the row
 * (sorted by start, the longer first; the first lane free for all its columns), and every day's one-day
 * lines. `capacity(day, lanes)` says how many lines a cell has in all (the host knows the cell's height
 * and whether a note hangs in it); `size(e)` how many a one-day entry takes (its writing wraps).
 */
export function layoutMonth(events: readonly CalEvent[], first: number, rows: number, capacity: (day: number, lanes: number) => number, size: (e: CalEvent) => number = () => 1): { readonly spans: readonly SpanSeg[]; readonly cells: readonly CellLines[] } {
  const last = first + rows * 7 - 1;
  const spans: SpanSeg[] = [];
  const laneAt = new Map<number, number>();   // day → lanes its bands take
  const bands = events.filter((e) => isSpan(e) && e.end >= first && e.start <= last)
    .sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start) || a.id - b.id);
  for (let r = 0; r < rows; r++) {
    const w0 = first + r * 7;
    const w1 = w0 + 6;
    const taken: boolean[][] = [];   // lane → the week's 7 columns
    for (const e of bands) {
      if (e.end < w0 || e.start > w1) continue;
      const c0 = Math.max(e.start, w0) - w0;
      const c1 = Math.min(e.end, w1) - w0;
      let lane = 0;
      for (; ; lane++) {
        let row = taken[lane];
        if (row === undefined) { row = [false, false, false, false, false, false, false]; taken[lane] = row; }
        let free = true;
        for (let c = c0; c <= c1; c++) if (row[c]) { free = false; break; }
        if (free) { for (let c = c0; c <= c1; c++) row[c] = true; break; }
      }
      spans.push({ event: e, row: r, col0: c0, col1: c1, lane, head: e.start >= w0, tail: e.end <= w1 });
      for (let c = c0; c <= c1; c++) laneAt.set(w0 + c, Math.max(laneAt.get(w0 + c) ?? 0, lane + 1));
    }
  }
  const byDay = new Map<number, CalEvent[]>();
  for (const e of events) {
    if (isSpan(e) || e.start < first || e.start > last) continue;
    let list = byDay.get(e.start);
    if (!list) { list = []; byDay.set(e.start, list); }
    list.push(e);
  }
  const cells: CellLines[] = [];
  for (let n = first; n <= last; n++) {
    const lanes = laneAt.get(n) ?? 0;
    const list = (byDay.get(n) ?? []).sort(compareLines);
    const room = Math.max(0, capacity(n, lanes) - lanes);
    // lines as they come while they fit; a cell that cannot show them all gives its last line to the count ("+2 more")
    let used = 0;
    let fit = 0;
    const total = list.reduce((a, e) => a + size(e), 0);
    const limit = total <= room ? room : room - 1;
    while (fit < list.length && used + size(list[fit] as CalEvent) <= limit) { used += size(list[fit] as CalEvent); fit += 1; }
    cells.push({ day: n, lanes, shown: list.slice(0, fit), hidden: list.length - fit });
  }
  return { spans, cells };
}
