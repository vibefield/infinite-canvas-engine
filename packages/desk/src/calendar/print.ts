// The calendar's PRINT and HAND (CALENDAR.md §2–§3; D3t-c) — everything on a month's sheet that is ink, as a display
// list, and the Canvas 2D that draws any rectangle of it at any density: the prototype's lab/calendar-print.ts, moved
// whole. The grid's rules and the weekend's tint are the shader's (crisp at every zoom, free); this is the type — the
// month's name in the product's face, light (DESIGN.md §3: big is light, small is medium), the weekdays as eyebrows,
// each date, the two small months, the week numbers, the Moon's phases, the colophon — and the hand: each event a line
// of the sticky note's handwriting (paper/text.ts, each glyph its own seed), a band of highlighter across a run of days,
// today's date ringed by a marker, a past date ticked off in pencil.
//
// DOM-free as a contract (design-015 §3): the items DRAW into a 2D context they are handed (the host's — desk/host/print.ts,
// an OffscreenCanvas), the type is MEASURED by the host (`measure`), and the hand's face is named, never loaded, here. The
// tile driver (calendar/printing.ts) asks for rectangles; nothing here knows about tiles, textures or the GPU.

import type { CalendarLaw } from "./law";
import { type CalEvent, isSpan, layoutMonth, parseTime } from "./events";
import { cellDay, inMonth, isoWeek, isWeekendCol, MONTH_NAMES, monthGrid, type MonthGrid, type MoonPhase, WEEKDAY_NAMES } from "./month";
import { bandBox, type Box, cellBox, lineBox, lineCapacity, type SheetLayout } from "./sheet";
import { hashHand, type HandLaw, type HandLayout, type HandMetrics, layoutText } from "../paper/text";

/** A 2D context the print draws into — the browser's (a canvas's or an OffscreenCanvas's); a TYPE, never a touch of the DOM. */
export type PrintContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** The print's colours as CSS (the product's — `vf-theme.ts` `calendarPrint`): straight colour + alpha, drawn onto a clear canvas. */
export interface PrintLook {
  /** The dates, the month's name. */
  readonly ink: string;
  /** The year, the eyebrows, the weekend's dates, the small print. */
  readonly muted: string;
  /** A neighbour month's date: the ink at this alpha. */
  readonly faint: number;
  /** Today's ring. */
  readonly hot: string;
  /** A past day's tick. */
  readonly pencil: string;
  readonly pens: Readonly<Record<string, string>>;
  readonly highlighters: Readonly<Record<string, string>>;
  /** The alpha a highlighter lays down (the shader multiplies it into the paper). */
  readonly highlight: number;
}

/** The hand's face as the print sets it: a family and a weight (the host loads it — desk/host/ink.ts `PEN_FACES`). */
export interface PrintFace {
  readonly family: string;
  readonly weight: number;
}

export const SANS = 'system-ui, -apple-system, "Helvetica Neue", sans-serif';
export const MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace';
const font = (weight: number, size: number, family = SANS): string => `${weight} ${size}px ${family}`;
const handFont = (face: PrintFace, px: number): string => `${face.weight} ${px}px "${face.family}"`;

/** One thing printed or written: its bounds on the sheet, the cells it belongs to, and how to draw it (in sheet coordinates). */
export interface PrintItem {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  draw(ctx: PrintContext): void;
}

/** Where an event's writing landed: the editor places its caret by it, the pointer picks by it. */
export interface EventLine {
  readonly event: CalEvent;
  readonly day: number;
  /** The line's (or the band segment's) box on the sheet. */
  readonly box: Box;
  /** The hand's layout and the sheet point its origin is at (a timed line's layout starts after its time). */
  readonly layout: HandLayout;
  readonly ox: number;
  readonly oy: number;
  readonly band: boolean;
}

export interface SheetPrint {
  readonly sheet: SheetLayout;
  readonly items: readonly PrintItem[];
  /** What each cell holds, as a key: a tile over a cell whose key moved is drawn again. Index row·7 + col; the last is the sheet's own print. */
  readonly keys: readonly string[];
  readonly lines: readonly EventLine[];
  /** Days whose count of lines did not fit ("+2 more"). */
  readonly hidden: ReadonlyMap<number, number>;
}

export interface PrintInputs {
  readonly law: CalendarLaw;
  readonly look: PrintLook;
  readonly sheet: SheetLayout;
  readonly events: readonly CalEvent[];
  /** Days with a sticky note stuck to them (their cells keep the foot clear). */
  readonly noted: ReadonlySet<number>;
  readonly today: number;
  readonly moons: ReadonlyMap<number, MoonPhase>;
  readonly face: PrintFace;
  readonly metrics: HandMetrics;
  /** The sticky note's hand (theme.ts `HAND`): its jitter and wander; the size is the calendar's. */
  readonly hand: HandLaw;
  readonly measure: (font: string, text: string) => number;
  /** Tick the past days off in pencil. */
  readonly ticks: boolean;
  /** A key of everything above that is not per cell (the face, the look, the law's print): part of every cell's key. */
  readonly style: string;
  /** The entry being written: printed whole, its time not set apart, so the pen's caret maps one to one (−1 = none). */
  readonly plain?: number;
}

// ---------------------------------------------------------------- the hand, and the marks a hand makes

/** A line of the hand, laid out once per (text, seeds, width) — the raster draws exactly these glyphs. */
function handLine(text: string, seeds: readonly number[], seed: number, width: number, size: number, inp: PrintInputs): HandLayout {
  const law: HandLaw = { ...inp.hand, size, lineHeight: inp.law.hand.pitch / size, pad: 0 };
  return layoutText(text, { w: width, h: inp.law.hand.pitch * 2 }, law, inp.metrics, seed, seeds);
}

function drawHand(ctx: PrintContext, L: HandLayout, ox: number, oy: number, face: PrintFace, color: string, alpha = 1, bleed = 0.3): void {
  ctx.font = handFont(face, L.em);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const g of L.glyphs) {
    ctx.save();
    ctx.translate(ox + g.x, oy + g.y);
    ctx.rotate(g.rot);
    ctx.scale(g.scale, g.scale);
    if (bleed > 0) { ctx.globalAlpha = alpha * g.press * 0.4; ctx.lineWidth = bleed / g.scale; ctx.strokeText(g.ch, 0, 0); }
    ctx.globalAlpha = alpha * g.press;
    ctx.fillText(g.ch, 0, 0);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

/** A seeded wobble: a few slow sines, deterministic. */
function wobble(seed: number): (t: number) => number {
  const [a, b, c, d] = hashHand(seed, 71);
  return (t) => 0.55 * Math.sin(t * 2 + a * 6.28) + 0.3 * Math.sin(t * 3.1 + b * 6.28) + 0.15 * Math.sin(t * 5.3 + c * 6.28) + (d - 0.5) * 0.2;
}

/** Today's ring: a marker's loop round the date, a little off round, overshooting where it closes. */
function ring(cx: number, cy: number, rx: number, ry: number, seed: number, color: string, width: number): PrintItem {
  const w = wobble(seed);
  const [r0, r1] = hashHand(seed, 5);
  const tilt = -0.2 + r0 * 0.18;
  const start = -2.3 + r1 * 0.5;
  const span = Math.PI * 2 + 0.42;
  return {
    x0: cx - rx - 8, y0: cy - ry - 8, x1: cx + rx + 8, y1: cy + ry + 8,
    draw(ctx) {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      // the marker's stroke: its width swells in the middle of the loop and thins where it lifts off
      const n = 64;
      let px = 0;
      let py = 0;
      for (let i = 0; i <= n; i++) {
        const t = start + (span * i) / n;
        const k = 1 + 0.045 * w(t) + 0.03 * (i / n);
        const ex = Math.cos(t) * rx * k;
        const ey = Math.sin(t) * ry * k;
        const x = cx + ex * Math.cos(tilt) - ey * Math.sin(tilt);
        const y = cy + ex * Math.sin(tilt) + ey * Math.cos(tilt);
        if (i > 0) {
          const f = i / n;
          ctx.globalAlpha = 0.88 * Math.min(1, f * 7, (1 - f) * 5 + 0.25);
          ctx.lineWidth = width * (0.75 + 0.35 * Math.sin(Math.PI * f));
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(x, y);
          ctx.stroke();
        }
        px = x;
        py = y;
      }
      ctx.restore();
    },
  };
}

/** A pencil's tick through a past date: one quick stroke, a little curved, lighter where it starts and ends. */
function tick(x0: number, y0: number, x1: number, y1: number, seed: number, color: string): PrintItem {
  const [a, b] = hashHand(seed, 13);
  const bow = (a - 0.5) * 5;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  return {
    x0: Math.min(x0, x1) - 6, y0: Math.min(y0, y1) - 6, x1: Math.max(x0, x1) + 6, y1: Math.max(y0, y1) + 6,
    draw(ctx) {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineCap = "round";
      const n = 14;
      let px = x0;
      let py = y0;
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const s = Math.sin(Math.PI * t);
        const x = x0 + dx * t + nx * bow * s;
        const y = y0 + dy * t + ny * bow * s;
        ctx.globalAlpha = 0.5 + 0.5 * Math.min(1, s * 2.2);
        ctx.lineWidth = 1.35 + 0.35 * s + (b - 0.5) * 0.2;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(x, y);
        ctx.stroke();
        px = x;
        py = y;
      }
      ctx.restore();
    },
  };
}

/** A highlighter's pass over a run of days: a chisel's flat stroke, its ends cut on the slant and ragged, a little uneven along it. */
function band(b: Box, seed: number, color: string, alpha: number, rag: number, head: boolean, tail: boolean): PrintItem {
  const w = wobble(seed);
  const [r0, r1] = hashHand(seed, 29);
  return {
    x0: b.x - rag - 2, y0: b.y - 3, x1: b.x + b.w + rag + 2, y1: b.y + b.h + 3,
    draw(ctx) {
      ctx.save();
      ctx.fillStyle = color;
      ctx.globalAlpha = alpha;
      const top: [number, number][] = [];
      const bot: [number, number][] = [];
      const n = Math.max(8, Math.round(b.w / 14));
      const slant = 4 + r0 * 3;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = b.x + b.w * t;
        const e = 1.1 * w(x * 0.03);
        top.push([x, b.y + e * 0.8]);
        bot.push([x, b.y + b.h + e * 0.7 + 0.6 * w(x * 0.05 + 3)]);
      }
      const t0 = top[0] as [number, number];
      const tn = top[n] as [number, number];
      const b0 = bot[0] as [number, number];
      const bn = bot[n] as [number, number];
      ctx.beginPath();
      // the head: cut on the chisel's slant (a continuation from the week before is cut square — it runs on)
      const hx = head ? rag * (0.4 + r1 * 0.6) : 0;
      ctx.moveTo(t0[0] + hx + slant * 0.5, t0[1]);
      for (const [x, y] of top) if (x > b.x + hx + slant * 0.5) ctx.lineTo(x, y);
      const tx = tail ? rag * (0.3 + r0 * 0.7) : 0;
      ctx.lineTo(b.x + b.w + tx, tn[1]);
      ctx.lineTo(b.x + b.w + tx - slant, bn[1]);
      for (let i = n; i >= 0; i--) { const [x, y] = bot[i] as [number, number]; if (x < b.x + b.w + tx - slant && x > b.x + hx - slant * 0.5) ctx.lineTo(x, y); }
      ctx.lineTo(b.x + hx - slant * 0.5, b0[1]);
      ctx.closePath();
      ctx.fill();
      // the second pass a highlighter leaves where the stroke started (the tip rests a moment)
      if (head) { ctx.globalAlpha = alpha * 0.35; ctx.fillRect(b.x + hx - slant * 0.3, b.y + 1, 6 + r1 * 4, b.h - 2); }
      ctx.restore();
    },
  };
}

/** The Moon's phase as printed: new filled, full an outline, the quarters half-filled (the lit side as the northern sky shows it). */
function moon(cx: number, cy: number, r: number, phase: MoonPhase, color: string): PrintItem {
  return {
    x0: cx - r - 2, y0: cy - r - 2, x1: cx + r + 2, y1: cy + r + 2,
    draw(ctx) {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      if (phase === 0) ctx.fill();
      else ctx.stroke();
      if (phase === 1 || phase === 3) {
        // first quarter: the right half lit (drawn as the dark left half filled); last: the left lit
        ctx.beginPath();
        ctx.arc(cx, cy, r, Math.PI / 2, (Math.PI * 3) / 2, phase === 3);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    },
  };
}

function text(x: number, y: number, s: string, f: string, color: string, opts: { align?: "left" | "right" | "center"; alpha?: number; tracking?: number; size: number; width: number }): PrintItem {
  const align = opts.align ?? "left";
  const x0 = align === "left" ? x : align === "right" ? x - opts.width : x - opts.width / 2;
  return {
    x0: x0 - 2, y0: y - opts.size, x1: x0 + opts.width + 2, y1: y + opts.size * 0.35,
    draw(ctx) {
      ctx.font = f;
      ctx.fillStyle = color;
      ctx.globalAlpha = opts.alpha ?? 1;
      ctx.textAlign = align;
      ctx.textBaseline = "alphabetic";
      if (opts.tracking) ctx.letterSpacing = `${opts.tracking}px`;
      ctx.fillText(s, x, y);
      if (opts.tracking) ctx.letterSpacing = "0px";
      ctx.globalAlpha = 1;
    },
  };
}

// ---------------------------------------------------------------- the sheet

/** Everything inked on one month's sheet. */
export function printSheet(inp: PrintInputs): SheetPrint {
  const { law, look, sheet: L } = inp;
  const g = L.grid;
  const P = law.print;
  const Hd = law.hand;
  const items: PrintItem[] = [];
  const cellItems: string[][] = Array.from({ length: L.rows * 7 }, () => []);
  const sheetKey: string[] = [`${g.index}:${g.weekStart}:${L.rows}:${inp.style}`];
  const lines: EventLine[] = [];
  const hiddenMap = new Map<number, number>();
  const measure = inp.measure;

  // ---- the month's name, the year beside it in a lighter weight
  const tf = font(P.title.weight, P.title.size);
  const yf = font(P.title.year, P.title.size);
  const name = MONTH_NAMES[g.m - 1] as string;
  const nameW = measure(tf, name);
  const ty = L.titleY + P.title.baseline;
  items.push(text(L.x0, ty, name, tf, look.ink, { size: P.title.size, width: nameW }));
  const year = String(g.y);
  items.push(text(L.x0 + nameW + P.title.size * 0.28, ty, year, yf, look.muted, { size: P.title.size, width: measure(yf, year) }));

  // ---- the foil stamped on the tape: the year, and what the pad is (the tape's shader lays its foil where this prints)
  {
    const ff = font(650, 12.5);
    const track = 3.2;
    const ty0 = law.sheet.tape / 2 + 4.5;
    const yr = String(g.y);
    const what = "MONTHLY";
    items.push(text(L.x0, ty0, yr, ff, look.ink, { size: 12.5, width: measure(ff, yr) + yr.length * track, tracking: track }));
    items.push(text(L.W - law.sheet.margin, ty0, what, ff, look.ink, { align: "right", size: 12.5, width: measure(ff, what) + what.length * track, tracking: track }));
  }

  // ---- the two small months at the title's right: the one before and the one after
  const mf = font(500, P.mini.size);
  const mh = font(650, P.mini.size * 0.92);
  const miniW = 7 * P.mini.col;
  const minis = [g.index - 1, g.index + 1];
  minis.forEach((mi, k) => {
    const mg = monthGrid(mi, g.weekStart);
    const right = L.W - law.sheet.margin - (1 - k) * (miniW + P.mini.gap);
    const left = right - miniW;
    const top = L.titleY + 26;
    const label = (MONTH_NAMES[mg.m - 1] as string).toUpperCase() + (mg.y !== g.y ? ` ${mg.y}` : "");
    items.push(text(left, top, label, mh, look.muted, { size: P.mini.size, width: measure(mh, label) + label.length * 1.4, tracking: 1.4 }));
    for (let c = 0; c < 7; c++) {
      const wd = (c + g.weekStart) % 7;
      const initial = (WEEKDAY_NAMES[wd] as string)[0] as string;
      items.push(text(left + (c + 1) * P.mini.col - 4, top + P.mini.pitch + 3, initial, mf, look.muted, { align: "right", size: P.mini.size, width: P.mini.size, alpha: 0.7 }));
    }
    for (let d = 1; d <= mg.days; d++) {
      const i = mg.lead + d - 1;
      const r = Math.floor(i / 7);
      const c = i % 7;
      const s = String(d);
      items.push(text(left + (c + 1) * P.mini.col - 4, top + P.mini.pitch * (r + 2) + 4, s, mf, isWeekendCol(mg, c) ? look.muted : look.ink, { align: "right", size: P.mini.size, width: measure(mf, s), alpha: 0.82 }));
    }
    sheetKey.push(`m${mi}`);
  });

  // ---- the weekdays, as eyebrows over their columns
  const wf = font(P.weekday.weight, P.weekday.size);
  const track = P.weekday.size * P.weekday.tracking;
  for (let c = 0; c < 7; c++) {
    const wd = (c + g.weekStart) % 7;
    const s = (WEEKDAY_NAMES[wd] as string).toUpperCase();
    const weekend = wd === 0 || wd === 6;
    items.push(text(L.x0 + c * L.cw + P.numeral.pad, L.weekdaysY + law.sheet.weekdays - 13, s, wf, weekend ? look.muted : look.ink, { size: P.weekday.size, width: measure(wf, s) + s.length * track, tracking: track, alpha: weekend ? 0.8 : 0.72 }));
  }

  // ---- the week numbers in the left margin (a Monday week's ISO number)
  if (g.weekStart === 1) {
    const kf = font(500, P.small.size - 1, MONO);
    for (let r = 0; r < L.rows; r++) {
      const s = String(isoWeek(cellDay(g, r, 0)));
      items.push(text(L.x0 - 9, L.y0 + r * L.ch + P.numeral.baseline - 4, s, kf, look.muted, { align: "right", size: P.small.size, width: measure(kf, s), alpha: 0.55 }));
    }
  }

  // ---- the colophon at the foot: the Moon's legend, the month's number
  {
    const ff = font(500, P.small.size - 1, MONO);
    const fy = L.H - law.sheet.foot / 2 + 4;
    const s = `${String(g.m).padStart(2, "0")} / ${g.y}`;
    items.push(text(L.W - law.sheet.margin, fy, s, ff, look.muted, { align: "right", size: P.small.size, width: measure(ff, s), alpha: 0.6 }));
    const lf = font(500, P.small.size - 1);
    let lx = L.x0;
    for (const [ph, label] of [[0, "new moon"], [1, "first quarter"], [2, "full moon"], [3, "last quarter"]] as const) {
      items.push(moon(lx + 5, fy - 4, 4.2, ph, look.muted));
      items.push(text(lx + 15, fy, label, lf, look.muted, { size: P.small.size, width: measure(lf, label), alpha: 0.6 }));
      lx += 15 + measure(lf, label) + 22;
    }
  }

  // ---- the days
  const nf = font(P.numeral.weight, P.numeral.size);
  // each one-day entry's writing, laid out once: the time small and apart, what it is wrapping under itself (two lines at most)
  const hands = new Map<number, { t: HandLayout | null; tw: number; r: HandLayout; n: number }>();
  const lineW = L.cw - 2 * Hd.pad;
  for (const e of inp.events) {
    if (isSpan(e) || e.start < g.first || e.start >= g.first + g.rows * 7) continue;
    const t = e.id === inp.plain ? null : parseTime(e.text);
    const Lt = t ? handLine(e.text.slice(0, t.len).trimEnd(), e.seeds.slice(0, t.len), e.seed, lineW, Hd.size * Hd.time, inp) : null;
    const tw = Lt ? (Lt.lines[0]?.width ?? 0) + Hd.size * 0.3 : 0;
    const Lr = handLine(t ? e.text.slice(t.len) : e.text, t ? e.seeds.slice(t.len) : e.seeds, e.seed + 1, Math.max(lineW - tw, 20), Hd.size, inp);
    hands.set(e.id, { t: Lt, tw, r: Lr, n: Math.min(Math.max(Lr.lines.length, 1), 2) });
  }
  const layout = layoutMonth(inp.events, g.first, g.rows, (day, lanes) => Math.max(lineCapacity(L, law, inp.noted.has(day)), lanes), (e) => hands.get(e.id)?.n ?? 1);
  const pens = (name: string): string => look.pens[name] ?? (look.pens.felt as string);
  for (let r = 0; r < L.rows; r++) {
    for (let c = 0; c < 7; c++) {
      const day = cellDay(g, r, c);
      const own = inMonth(g, day);
      const b = cellBox(L, r, c);
      const key = cellItems[r * 7 + c] as string[];
      const s = String(civilDay(day));
      const nx = b.x + P.numeral.pad;
      const ny = b.y + P.numeral.baseline;
      const nw = measure(nf, s);
      const weekend = isWeekendCol(g, c);
      items.push(text(nx, ny, s, nf, weekend ? look.muted : look.ink, { size: P.numeral.size, width: nw, alpha: own ? 1 : look.faint }));
      key.push(`${day}:${own ? 1 : 0}`);
      if (!own) continue;
      const ph = inp.moons.get(day);
      if (ph !== undefined) { items.push(moon(b.x + b.w - P.moon.inset, b.y + P.moon.inset + 2, P.moon.r, ph, look.muted)); key.push(`moon${ph}`); }
      if (day === inp.today) {
        const cap = P.numeral.size * 0.72;
        items.push(ring(nx + nw / 2, ny - cap / 2, nw / 2 + 12, cap / 2 + 10, day * 7 + 3, look.hot, 2.3));
        key.push("today");
      } else if (inp.ticks && day < inp.today) {
        const cap = P.numeral.size * 0.72;
        items.push(tick(nx - 4, ny + 3, nx + nw + 4, ny - cap - 3, day * 13 + 1, look.pencil));
        key.push("past");
      }
      if (inp.noted.has(day)) key.push("note");
    }
  }
  // the bands: a highlighter across the run, the title written on its first day in each week
  for (const seg of layout.spans) {
    const e = seg.event;
    const bb = bandBox(L, seg.row, seg.col0, seg.col1, seg.lane, law);
    items.push(band(bb, e.seed + seg.row * 31, look.highlighters[e.ink] ?? (Object.values(look.highlighters)[0] as string), look.highlight, Hd.rag, seg.head, seg.tail));
    const Lh = handLine(e.text, e.seeds, e.seed, bb.w - 14, Hd.size * 0.92, inp);
    // the layout's origin is its top-left: its first baseline sits `ascent` below it
    const ox = bb.x + 8;
    const oy = bb.y + bb.h * 0.5 + Lh.ascent * 0.36 - Lh.ascent;
    items.push(clipHand(Lh, ox, oy, { x: bb.x, y: bb.y - 8, w: bb.w, h: bb.h + 16 }, inp.face, pens("felt")));
    lines.push({ event: e, day: g.first + seg.row * 7 + seg.col0, box: bb, layout: Lh, ox, oy, band: true });
    for (let cc = seg.col0; cc <= seg.col1; cc++) (cellItems[seg.row * 7 + cc] as string[]).push(`b${e.id}.${e.rev}.${seg.lane}.${seg.head ? 1 : 0}${seg.tail ? 1 : 0}`);
  }
  // each day's lines: the time small and a shade lighter, then what it is
  for (const cell of layout.cells) {
    const i = cell.day - g.first;
    const r = Math.floor(i / 7);
    const c = i % 7;
    if (!inMonth(g, cell.day)) continue;
    const key = cellItems[r * 7 + c] as string[];
    let at = cell.lanes;
    for (const e of cell.shown) {
      const h = hands.get(e.id) as { t: HandLayout | null; tw: number; r: HandLayout; n: number };
      const lb = lineBox(L, r, c, at, law);
      const box = { x: lb.x, y: lb.y, w: lb.w, h: lb.h * h.n };
      const color = pens(e.ink);
      if (h.t) items.push(clipHand(h.t, lb.x, lb.y + Hd.pitch * 0.74 - h.t.ascent, { x: lb.x, y: lb.y - 6, w: lb.w + 4, h: lb.h + 10 }, inp.face, color, 0.66, 1));
      const ox = lb.x + h.tw;
      const oy = lb.y + Hd.pitch * 0.74 - h.r.ascent;
      items.push(clipHand(h.r, ox, oy, { x: lb.x, y: lb.y - 6, w: lb.w + 4, h: box.h + 10 }, inp.face, color, 1, h.n));
      lines.push({ event: e, day: cell.day, box, layout: h.r, ox, oy, band: false });
      key.push(`e${e.id}.${e.rev}.${at}`);
      at += h.n;
    }
    if (cell.hidden > 0) {
      const lb = lineBox(L, r, c, at, law);
      const s = `+${cell.hidden} more`;
      const sf = font(P.small.size >= 11 ? 600 : 500, P.small.size + 1);
      items.push(text(lb.x, lb.y + Hd.pitch * 0.66, s, sf, look.muted, { size: P.small.size + 1, width: measure(sf, s) }));
      hiddenMap.set(cell.day, cell.hidden);
      key.push(`+${cell.hidden}`);
    }
  }
  const keys = cellItems.map((k) => `${sheetKey[0]}|${k.join(",")}`);
  keys.push(sheetKey.join(","));
  return { sheet: L, items, keys, lines, hidden: hiddenMap };
}

/** The day of the month of a day number, without building the whole civil date twice. */
const civilDay = (n: number): number => {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  return doy - Math.floor((153 * mp + 2) / 5) + 1;
};

/**
 * Writing, clipped to its box: `keep` lines of it; where there is more than that, the last kept line
 * fades out over its last few units — the pen ran on past the cell — rather than stopping short.
 */
function clipHand(Lh: HandLayout, ox: number, oy: number, clip: Box, face: PrintFace, color: string, alpha = 1, keep = 1): PrintItem {
  const right = clip.x + clip.w;
  const more = Lh.lines.length > keep;
  const kept: HandLayout = more ? { ...Lh, glyphs: Lh.glyphs.filter((gl) => gl.line < keep) } : Lh;
  return {
    x0: clip.x - 2, y0: clip.y - 2, x1: clip.x + clip.w + 2, y1: clip.y + clip.h + 2,
    draw(ctx) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(clip.x, clip.y, clip.w, clip.h);
      ctx.clip();
      drawHand(ctx, kept, ox, oy, face, color, alpha);
      if (more) {
        const last = Lh.lines[keep - 1];
        const end = Math.min(ox + (last?.width ?? 0), right);
        const y = oy + (last?.y ?? 0);
        ctx.globalCompositeOperation = "destination-out";
        const grad = ctx.createLinearGradient(end - 26, 0, end, 0);
        grad.addColorStop(0, "transparent");
        grad.addColorStop(1, "black");
        ctx.fillStyle = grad;
        ctx.fillRect(end - 26, y - Lh.ascent - 4, 30, Lh.ascent + Lh.descent + 8);
      }
      ctx.restore();
    },
  };
}

/** Is an event drawn on this sheet at all (a band may start or end off it)? */
export const onSheet = (e: CalEvent, g: MonthGrid): boolean => e.end >= g.first && e.start < g.first + g.rows * 7 && (isSpan(e) || inMonth(g, e.start));

// ---------------------------------------------------------------- the raster

/**
 * Draw the rectangle [x, y, w, h] of a sheet (sheet units) into `ctx`, `band` texels a unit, onto a
 * clear canvas: the items it overlaps, in order. The canvas's alpha is the ink's presence.
 */
export function drawRegion(ctx: PrintContext, print: SheetPrint, x: number, y: number, w: number, h: number, band: number): number {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(band, 0, 0, band, -x * band, -y * band);
  let n = 0;
  for (const it of print.items) {
    if (it.x1 < x || it.x0 > x + w || it.y1 < y || it.y0 > y + h) continue;
    it.draw(ctx);
    n += 1;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return n;
}

/** Does anything print in the rectangle? (An empty tile is never drawn nor stored.) */
export function anyIn(print: SheetPrint, x: number, y: number, w: number, h: number): boolean {
  for (const it of print.items) if (!(it.x1 < x || it.x0 > x + w || it.y1 < y || it.y0 > y + h)) return true;
  return false;
}
