// The MONTH — the calendar's arithmetic (CALENDAR.md §2). Pure: no Date in the hot path. A day is an
// integer, its DAY NUMBER (days since 1970-01-01 on the proleptic Gregorian calendar, the civil date,
// no time zone); a month is its grid of weeks as the sheet prints it — the rows it needs (four, five
// or six), the cells before its first and after its last; a week has its ISO number; a day may hold
// one of the Moon's four principal phases (Meeus, *Astronomical Algorithms* ch. 49, the periodic
// terms to 1e-4 day — a printed calendar's accuracy). Only `today` and the phases' local days touch
// the platform's clock and time zone, and each takes them as an argument where a test needs to pin them.

/** A civil date: year, month 1–12, day 1–31. */
export interface Ymd { readonly y: number; readonly m: number; readonly d: number }

/** Days since 1970-01-01 of a civil date (Hinnant's days_from_civil). */
export function dayNumber(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const mp = (m + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** The civil date of a day number (Hinnant's civil_from_days). */
export function civil(n: number): Ymd {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d };
}

/** 0 = Sunday … 6 = Saturday (1970-01-01 was a Thursday). */
export const weekday = (n: number): number => (((n + 4) % 7) + 7) % 7;

const pad2 = (v: number) => (v < 10 ? `0${v}` : String(v));
/** "2026-09-24". */
export const keyOf = (n: number): string => { const c = civil(n); return `${c.y}-${pad2(c.m)}-${pad2(c.d)}`; };
/** The day number of a "YYYY-MM-DD" key. */
export function dayOfKey(key: string): number {
  const m = /^(-?\d+)-(\d{1,2})-(\d{1,2})$/.exec(key);
  if (!m) throw new Error(`calendar: not a day key: ${key}`);
  return dayNumber(Number(m[1]), Number(m[2]), Number(m[3]));
}

export const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export const daysIn = (y: number, m: number): number => (m === 2 ? (isLeap(y) ? 29 : 28) : [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] as number);

/** A month as one integer (y·12 + m − 1): the pad counts months with it. */
export const monthIndex = (y: number, m: number): number => y * 12 + (m - 1);
export const monthOf = (index: number): { readonly y: number; readonly m: number } => ({ y: Math.floor(index / 12), m: (((index % 12) + 12) % 12) + 1 });
/** The month a day falls in, as its index. */
export const monthOfDay = (n: number): number => { const c = civil(n); return monthIndex(c.y, c.m); };

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
/** Sunday first; a sheet rotates them by its week's start. */
export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** A month's grid as the sheet prints it: whole weeks, from the week holding the 1st to the week holding the last day. */
export interface MonthGrid {
  readonly y: number;
  readonly m: number;
  readonly index: number;
  /** The weekday a row starts on: 0 Sunday, 1 Monday. */
  readonly weekStart: 0 | 1;
  /** The day number of the first cell (a day of the month before, unless the 1st starts the week). */
  readonly first: number;
  /** Weeks the month spans: 4 (a February that starts the week), 5 or 6. */
  readonly rows: number;
  /** Cells before the 1st. */
  readonly lead: number;
  readonly days: number;
}

export function monthGrid(index: number, weekStart: 0 | 1): MonthGrid {
  const { y, m } = monthOf(index);
  const one = dayNumber(y, m, 1);
  const lead = (weekday(one) - weekStart + 7) % 7;
  const days = daysIn(y, m);
  return { y, m, index, weekStart, first: one - lead, rows: Math.ceil((lead + days) / 7), lead, days };
}

/** The day number in a grid's cell. */
export const cellDay = (g: MonthGrid, row: number, col: number): number => g.first + row * 7 + col;
/** Does a day belong to the grid's own month (not a neighbour's day in its first or last row)? */
export const inMonth = (g: MonthGrid, n: number): boolean => n >= g.first + g.lead && n < g.first + g.lead + g.days;
/** The row and column of a day in a grid (either may fall outside it). */
export const cellOf = (g: MonthGrid, n: number): { readonly row: number; readonly col: number } => ({ row: Math.floor((n - g.first) / 7), col: (((n - g.first) % 7) + 7) % 7 });
/** Is a column a weekend (Saturday or Sunday) under this grid's week? */
export const isWeekendCol = (g: MonthGrid, col: number): boolean => { const wd = (col + g.weekStart) % 7; return wd === 0 || wd === 6; };

/** ISO 8601 week number of a day (weeks start Monday; week 1 holds the year's first Thursday). */
export function isoWeek(n: number): number {
  const wd = (weekday(n) + 6) % 7;            // Monday 0 … Sunday 6
  const thursday = n - wd + 3;
  const { y } = civil(thursday);
  return Math.floor((thursday - dayNumber(y, 1, 1)) / 7) + 1;
}

/** The local civil day of a moment (ms since the epoch) under the platform's time zone. */
export function localDay(ms: number): number {
  const t = new Date(ms);
  return dayNumber(t.getFullYear(), t.getMonth() + 1, t.getDate());
}
/** One formatter per IANA zone asked (a zone's rules are the platform's Intl data). */
const zoneFormats = new Map<string, Intl.DateTimeFormat>();
/** The civil day of a moment in the IANA zone `zone` — the calendar's CLOCK SEAM (D7); absent, the platform's own (`localDay`). */
export function dayIn(ms: number, zone?: string): number {
  if (zone === undefined) return localDay(ms);
  let f = zoneFormats.get(zone);
  if (f === undefined) { f = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "numeric", day: "numeric" }); zoneFormats.set(zone, f); }
  let y = 0;
  let m = 0;
  let d = 0;
  for (const part of f.formatToParts(ms)) {
    if (part.type === "year") y = Number(part.value);
    else if (part.type === "month") m = Number(part.value);
    else if (part.type === "day") d = Number(part.value);
  }
  return dayNumber(y, m, d);
}
/** Today — the platform's clock and time zone unless the caller hands its own (a pad's clock seam, D7). */
export const today = (ms: number = Date.now(), zone?: string): number => dayIn(ms, zone);

// ---------------------------------------------------------------- the Moon

/** 0 new · 1 first quarter · 2 full · 3 last quarter. */
export type MoonPhase = 0 | 1 | 2 | 3;
const RAD = Math.PI / 180;
const SYNODIC = 29.530588861;

/** The Julian Ephemeris Day of the principal phase `k` (an integer + 0, .25, .5 or .75 — Meeus 49.1 with its periodic terms). */
export function phaseJde(k: number): number {
  const T = k / 1236.85;
  const T2 = T * T;
  const T3 = T2 * T;
  const T4 = T3 * T;
  let jde = 2451550.09766 + SYNODIC * k + 0.00015437 * T2 - 0.00000015 * T3 + 0.00000000073 * T4;
  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  const M = (2.5534 + 29.1053567 * k - 0.0000014 * T2 - 0.00000011 * T3) * RAD;
  const Mp = (201.5643 + 385.81693528 * k + 0.0107582 * T2 + 0.00001238 * T3 - 0.000000058 * T4) * RAD;
  const F = (160.7108 + 390.67050284 * k - 0.0016118 * T2 - 0.00000227 * T3 + 0.000000011 * T4) * RAD;
  const O = (124.7746 - 1.56375588 * k + 0.0020672 * T2 + 0.00000215 * T3) * RAD;
  const s = Math.sin;
  const frac = ((k % 1) + 1) % 1;
  if (frac < 0.01 || frac > 0.99 || Math.abs(frac - 0.5) < 0.01) {
    const full = Math.abs(frac - 0.5) < 0.01;
    const c = full
      ? [-0.40614, 0.17302, 0.01614, 0.01043, 0.00734, -0.00515, 0.00209, -0.00111, -0.00057, 0.00056, -0.00042, 0.00042, 0.00038, -0.00024, -0.00017]
      : [-0.4072, 0.17241, 0.01608, 0.01039, 0.00739, -0.00514, 0.00208, -0.00111, -0.00057, 0.00056, -0.00042, 0.00042, 0.00038, -0.00024, -0.00017];
    jde += (c[0] as number) * s(Mp) + (c[1] as number) * E * s(M) + (c[2] as number) * s(2 * Mp) + (c[3] as number) * s(2 * F)
      + (c[4] as number) * E * s(Mp - M) + (c[5] as number) * E * s(Mp + M) + (c[6] as number) * E * E * s(2 * M)
      + (c[7] as number) * s(Mp - 2 * F) + (c[8] as number) * s(Mp + 2 * F) + (c[9] as number) * E * s(2 * Mp + M)
      + (c[10] as number) * s(3 * Mp) + (c[11] as number) * E * s(M + 2 * F) + (c[12] as number) * E * s(M - 2 * F)
      + (c[13] as number) * E * s(2 * Mp - M) + (c[14] as number) * s(O);
  } else {
    jde += -0.62801 * s(Mp) + 0.17172 * E * s(M) - 0.01183 * E * s(Mp + M) + 0.00862 * s(2 * Mp) + 0.00804 * s(2 * F)
      + 0.00454 * E * s(Mp - M) + 0.00204 * E * E * s(2 * M) - 0.0018 * s(Mp - 2 * F) - 0.0007 * s(Mp + 2 * F)
      - 0.0004 * s(3 * Mp) - 0.00034 * E * s(2 * Mp - M) + 0.00032 * E * s(M + 2 * F) + 0.00032 * E * s(M - 2 * F)
      - 0.00028 * E * E * s(Mp + 2 * M) + 0.00027 * E * s(2 * Mp + M) - 0.00017 * s(O);
    const c = Math.cos;
    const W = 0.00306 - 0.00038 * E * c(M) + 0.00026 * c(Mp) - 0.00002 * c(Mp - M) + 0.00002 * c(Mp + M) + 0.00002 * c(2 * F);
    jde += frac < 0.5 ? W : -W;
  }
  return jde;
}

/** A Julian Day → ms since the epoch (ΔT, about a minute, is left in: it moves no phase across a midnight that matters here). */
export const jdToMs = (jd: number): number => (jd - 2440587.5) * 86400000;

/**
 * The principal phases whose instant falls on a day of [n0, n1] (inclusive), each on the LOCAL day
 * `dayOf` gives it (the platform's time zone unless a test pins one).
 */
export function phasesBetween(n0: number, n1: number, dayOf: (ms: number) => number = localDay): Map<number, MoonPhase> {
  const out = new Map<number, MoonPhase>();
  // the lunation k nearest the start (2000-01-06 is k = 0), a quarter back to be safe
  const jd0 = n0 + 2440587.5;
  let k = Math.floor(((jd0 - 2451550.1) / SYNODIC) * 4) / 4 - 0.25;
  for (let i = 0; i < 400; i++, k += 0.25) {
    const day = dayOf(jdToMs(phaseJde(k)));
    if (day > n1) break;
    if (day >= n0) out.set(day, (Math.round((((k % 1) + 1) % 1) * 4) % 4) as MoonPhase);
  }
  return out;
}
