// THE NOTEBOOK IN HAND — its pen and its leaves (NOTEBOOK.md §6–8; design-015 §8; D3t-b): the hand half of the notebook kind,
// the whiteboard's pen's sibling (objects/pen.ts). It READS the world — the book in hand (core's `Held`), the pen in hand
// (`HeldTool`), the local pointer through the pose the renderer drew (`HeldPointer`, mapped to the desk by the builder's
// `heldToWorld`, then into the book through the SAME desk eye the pass drew it with — `pageHitAt`), the press (`HeldPress`:
// `tool` on a page's writing, `part` on a turn) — and drives the notebook kind's own state (kinds/notebook.ts `Books`): the
// stroke laid LIVE into its page's raster. It WRITES exactly one kind of thing, ONE transaction each, deferred out of the frame
// (a reflector never writes — D-D2c.5): at the lift, the stroke — one `desk.stroke` child of the book on its `page`, its path in
// page units with its samples' times (board/data.ts), which the page's raster ADOPTS rather than replays.
//
// A press on a page's writing with a pen in hand begins a stroke at that frame's point; every later frame the pointer is over
// the SAME page is a sample (a frame it rested is a sample too: the law keeps its width); the frame the press is gone is the
// lift, at the pointer's last point on the page. The samples reach the raster as f32s — the cell's own — so what the pen laid
// live is what a replay lays. Put down while a stroke is laid, the stroke lands first.
//
// THE LEAVES (NOTEBOOK.md §6–7): a press on a page's outer 30 % (the kind's `turn` part — core's `HeldPress` "part") that
// travels 5 px across takes hold of the top sheet on that side and it follows the hand over the gutter (motion.ts `grabSheet`
// · `dragSheet` — the pinch's angle is the grip); let go, it goes past the vertical or flung, else it falls back
// (`releaseSheet`). A press there that never travels is a CLICK: a page on (the right) or back (the left). The keys and the
// bar's ‹ › count their turns on the book (`PageTurns`); the hand turns by what the count moved. Every completed turn moves the
// durable `spread` in ONE transaction out of the frame, OFF the undo stack (D-D3t-b.2: a turn is the reader's place, ⌘Z takes
// back ink) — until it lands the kind heads for it (`Books.ask`), one sheet a frame, so a run of turns fans. Over the right
// page's fore-edge corner, with nothing pressed, the corner peeks. On a portrait phone (one page of the spread in view, D4b's
// `spread`) a step is ONE page: from the right page on, the sheet turns and the view follows it to its verso on the left; from
// the left page on, the view goes to the right page; back, the other way round (`Books.face`).

import { defineQuery, type Entity, guardedTransaction, heldEntity, HeldPointer, HeldPress, HeldTool, LocalPointer, Pointer, PointerButtons, PointerScreen, setWidgetProps, Viewport, type World } from "@ice/core";
import { addStroke, encodePoints } from "../board/data";
import { readingTarget } from "../hold/pose";
import { type Books, DEFAULT_PEN, type NotebookGeometry, PageTurns, pageHitAt, partOf, penOfTool } from "../kinds/notebook";
import { inkPoints, pageOfSide } from "../notebook/ink";
import { counts, dragSheet, grabSheet, releaseSheet } from "../notebook/motion";
import type { LiveStroke } from "../notebook/pages";
import { type NotebookHit, localXAt } from "../notebook/pick";
import { Notebook } from "./notebook";
import type { TypingDocs } from "./typing";

/** The notebook's props cell (`desk.notebook:props` — its `spread` the durable fact a completed turn moves). */
const NOTEBOOK_PROPS = Notebook.groups[0]?.component;

export interface NotebookHandOptions {
  readonly world: World;
  /** The document a stroke commits into — the facade's `engine.docs`. */
  readonly docs: TypingDocs;
  /** The notebook kind's state on this desk (undefined before it is made). */
  readonly books: () => Books | undefined;
  /** Is this entity a notebook (the desk's builder knows each entity's kind). */
  readonly isBook: (e: Entity) => boolean;
  /** A point of the held object's own frame as a desk point, through the pose the last frame drew (the builder's). */
  readonly heldToWorld: (e: Entity, x: number, y: number) => readonly [number, number] | undefined;
  /** The geometry the book was drawn with in hand (the builder's). */
  readonly geometryOf: (e: Entity) => unknown;
  /** Where a transaction runs: out of the frame (a microtask) unless a test says. */
  readonly defer?: (fn: () => void) => void;
}

export interface NotebookHand {
  /** Once a frame, before the kinds' clocks: the hand onto the book in hand — its stroke laid, lifted, committed. */
  follow(now: number): void;
  /** The stroke in hand: its book, its page and how many samples so far; null when none. */
  live(): { readonly book: Entity; readonly page: number; readonly samples: number } | null;
  /** Strokes committed since creation (a rig's witness). */
  commits(): number;
  /** The turn in the hand: its book, the side it was taken from, the sheet held (null until the hand has travelled); null when none. */
  turning(): { readonly book: Entity; readonly side: 0 | 1; readonly sheet: number | null } | null;
  /** Spreads written since creation — each completed turn one transaction (a rig's witness). */
  turns(): number;
}

interface Stroke {
  readonly book: Entity;
  readonly pointer: Entity;
  readonly side: 0 | 1;
  readonly page: number;
  readonly t0: number;
  readonly points: [number, number][];
  readonly times: number[];
  readonly live: LiveStroke;
}

interface Turn {
  readonly book: Entity;
  readonly pointer: Entity;
  readonly side: 0 | 1;
  /** Where the page was pinched: its arc length from the gutter, its height from the middle, the page's length. */
  readonly s: number;
  readonly y: number;
  readonly len: number;
  /** The screen x the press began at; the sheet held once it travelled; the last move's clock. */
  readonly x0: number;
  sheet: number | null;
  lt: number;
  moved: boolean;
}

const pointersQ = defineQuery([Pointer, LocalPointer, PointerScreen]);
const f32 = Math.fround;
const clamp = (x: number, a: number, b: number): number => Math.min(Math.max(x, a), b);
/** How far a pinch travels across before the sheet is taken (the prototype's 5 CSS px). */
const TAKE_PX = 5;

/** The corner of the right page a hit is over — the tail's (+1) or the head's (−1) — or 0 (NOTEBOOK.md §6: the peek). */
function cornerOf(G: NotebookGeometry, h: NotebookHit): 1 | -1 | 0 {
  if (h.part !== "page" || h.side !== 0) return 0;
  const z = G.law.peek.zone;
  if (h.s < h.len - z) return 0;
  const edge = G.frame.Hp / 2 - z;
  return h.y > edge ? 1 : h.y < -edge ? -1 : 0;
}

export function createNotebookHand(opts: NotebookHandOptions): NotebookHand {
  const { world, docs } = opts;
  const defer = opts.defer ?? ((fn: () => void) => queueMicrotask(fn));
  let stroke: Stroke | null = null;
  let commits = 0;
  let turn: Turn | null = null;
  let turns = 0;
  /** The book last in hand and the turn count it had when it came into the hand (the keys' and the bar's, `PageTurns`). */
  let inHand: { readonly book: Entity; seen: number } | null = null;

  /** The spread the book is at or heading for: the one the hand asked (until it lands), else the document's. */
  const spreadOf = (books: Books, book: Entity): number => {
    const asked = books.state(book).pending;
    if (asked !== null) return asked;
    const v = NOTEBOOK_PROPS === undefined ? undefined : (world.get(book, NOTEBOOK_PROPS) as { spread?: number } | undefined)?.spread;
    return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0;
  };
  /** Move the durable spread to `to` — ONE transaction out of the frame, off the undo stack; the kind heads for it meanwhile. */
  const write = (books: Books, book: Entity, to: number): void => {
    books.ask(book, to);
    defer(() => {
      const session = docs.current();
      let ok = false;
      if (session !== undefined && world.isAlive(book)) {
        try { setWidgetProps(session.store, world, book, { spread: to }, { undoable: false }); ok = true; } catch { ok = false; }
      }
      if (ok) turns += 1;
      // landed (the document says it now) or refused (the book goes back to the document's): the kind heads for the document's
      if (books.state(book).pending === to) books.ask(book, null);
    });
  };
  /** One page on the phone, a sheet on a desk: `d` steps of the reader, from where the book is heading. */
  const step = (books: Books, book: Entity, G: NotebookGeometry, d: number, single: boolean): void => {
    const sheets = G.frame.spec.sheets;
    let at = spreadOf(books, book);
    if (!single) {
      const to = clamp(at + d, 0, sheets);
      if (to !== at) write(books, book, to);
      return;
    }
    // a portrait phone: page by page — the right page on turns its sheet and the view follows it left; the left page on, the view goes right
    let face = books.state(book).faceT;
    for (let k = 0; k < Math.abs(d); k++) {
      if (d > 0) {
        if (face === 0 && at < sheets) { at += 1; face = 1; }
        else if (face === 1 && at < sheets) face = 0;
      } else if (face === 1 && at > 0) { at -= 1; face = 0; }
      else if (face === 0 && at > 0) face = 1;
    }
    books.face(book, face);
    if (at !== spreadOf(books, book)) write(books, book, at);
  };

  /** The page point under a desk point — on `side`'s page of a resolved book, as the cell stores it (page units, f32); null off it. */
  const onPage = (G: NotebookGeometry, at: readonly [number, number], s: Stroke | null): { side: 0 | 1; page: number; s: number; y: number } | null => {
    const h = pageHitAt(G, at[0], at[1]);
    if (h === null || h.part !== "page") return null;
    const page = pageOfSide(G.pose, h.side);
    if (page === null || (s !== null && (s.side !== h.side || s.page !== page))) return null;
    return { side: h.side, page, s: f32(h.s), y: f32(h.y + G.frame.Hp / 2) };
  };

  /** A sample: its point and time, and the live stroke's next point with its width (the law is causal: the earlier ones stand). */
  const sample = (s: Stroke, x: number, y: number, t: number): void => {
    s.points.push([x, y]);
    s.times.push(t);
    const all = inkPoints(s.points, s.times, 400);
    s.live.points.push(all[all.length - 1] as (typeof all)[number]);
  };

  /** The lift: the last sample, the stroke laid to its end, its ONE transaction out of the frame. */
  const lift = (s: Stroke, at: readonly [number, number] | undefined, now: number): void => {
    const books = opts.books();
    const G = opts.geometryOf(s.book) as NotebookGeometry | undefined;
    const q = at !== undefined && G !== undefined ? onPage(G, at, s) : null;
    if (q !== null) sample(s, q.s, q.y, f32(now - s.t0));
    const key = encodePoints(s.points);
    books?.lift(s.book, key);
    const spec = { tool: "pen" as const, ink: s.live.ink, page: s.page, points: s.points, times: s.times };
    defer(() => {
      const session = docs.current();
      let ok = false;
      if (session !== undefined && world.isAlive(s.book)) {
        try { guardedTransaction(session.store, world, (tx) => { addStroke(tx, s.book, spec); }); ok = true; } catch { ok = false; }
      }
      if (ok) commits += 1;
      else books?.refuse(s.book);   // refused (a read-only document, a book gone): the page is its children's again
    });
  };

  return {
    follow(now) {
      const held = heldEntity(world);
      const book = held !== undefined && world.isAlive(held) && opts.isBook(held) ? held : undefined;
      if (stroke !== null && !world.isAlive(stroke.book)) { opts.books()?.write(stroke.book, null); stroke = null; }
      // the book was put down (or another taken up) mid-stroke: the stroke lands first
      if (stroke !== null && stroke.book !== book) { lift(stroke, undefined, now); stroke = null; }
      if (turn !== null && turn.book !== book) turn = null;
      if (book === undefined) { inHand = null; return; }
      const books = opts.books();
      if (books === undefined) return;
      // the keys' and the bar's turns: the count as it came into the hand is where the hand starts from
      const asked = world.get(book, PageTurns)?.n ?? 0;
      if (inHand === null || inHand.book !== book) inHand = { book, seen: asked };
      const pen = penOfTool(world.get(book, HeldTool)?.id ?? "") ?? DEFAULT_PEN;
      // the pointer: the one laying the stroke, else one pressing, else the local mouse
      let pointer: Entity | undefined;
      world.query(pointersQ).each((b) => {
        for (const r of b) {
          const p = b.entity(r);
          if (stroke !== null ? p === stroke.pointer : world.get(p, HeldPress) !== undefined || world.read(p, Pointer).device === "mouse") pointer = pointer ?? p;
        }
      });
      const hp = pointer !== undefined ? world.get(pointer, HeldPointer) : undefined;
      const at = hp !== undefined ? opts.heldToWorld(book, hp.x, hp.y) : undefined;
      const G = opts.geometryOf(book) as NotebookGeometry | undefined;
      const press = pointer !== undefined ? world.get(pointer, HeldPress) : undefined;
      const buttons = pointer !== undefined ? (world.get(pointer, PointerButtons)?.buttons ?? 0) : 0;
      const writing = press?.kind === "tool" && (buttons & 1) !== 0;
      const vp = world.getResource(Viewport);
      const single = G !== undefined && vp !== undefined && readingTarget({ cx: 0, cy: 0, w: G.frame.W * 2, h: G.frame.H }, { width: vp.w, height: vp.h }, true).single;
      if (G !== undefined && asked !== inHand.seen) { step(books, book, G, asked - inHand.seen, single); inHand.seen = asked; }
      const m = books.state(book).motion;
      const screen = pointer !== undefined ? world.get(pointer, PointerScreen) : undefined;
      // THE LEAVES: a turn in the hand follows it, lets go, or was a click
      if (turn !== null && (press?.kind !== "part" || turn.pointer !== pointer)) {
        if (turn.sheet !== null && m !== null) {
          const s = m.sheets[turn.sheet];
          releaseSheet(m, turn.sheet);
          // it goes over (past the vertical, or flung): a completed turn; else it falls back — nothing written
          if (s !== undefined && s.side !== turn.side && G !== undefined) {
            const to = clamp(spreadOf(books, book) + (s.side === 1 ? 1 : -1), 0, G.frame.spec.sheets);
            books.face(book, s.side === 1 ? 1 : 0);   // a phone follows the sheet: to its verso on the left, or its recto back on the right
            write(books, book, to);
          }
        } else if (!turn.moved && G !== undefined) step(books, book, G, turn.side === 0 ? 1 : -1, single);   // a click: a page on, or back
        turn = null;
      } else if (turn !== null && G !== undefined && m !== null && at !== undefined && screen !== undefined) {
        if (press?.moved === true) turn.moved = true;
        if (turn.sheet === null && Math.abs(screen.x - turn.x0) >= TAKE_PX) turn.sheet = grabSheet(m, turn.side);
        if (turn.sheet !== null) {
          const c = counts(m);
          const z = G.frame.b + Math.max(c.right, c.left) * G.frame.spec.sheet;
          const x = localXAt(G.eye, G.rigid, at[0], at[1], z);
          dragSheet(m, turn.sheet, x, G.frame.xg, turn.s, turn.len, turn.y / (G.frame.Hp / 2), G.law, Math.max((now - turn.lt) / 1000, 1e-3));
          turn.lt = now;
          books.stir(book);
        }
      } else if (turn === null && press?.kind === "part" && press.part === "turn" && pointer !== undefined && G !== undefined && at !== undefined && screen !== undefined) {
        const h = pageHitAt(G, at[0], at[1]);
        if (h !== null && h.part === "page") turn = { book, pointer, side: h.side, s: h.s, y: h.y, len: h.len, x0: screen.x, sheet: null, lt: now, moved: false };
      }
      // the peek: over the right page's fore-edge corner with nothing pressed, that corner lifts — an invitation
      if (m !== null) {
        const h = press === undefined && at !== undefined && G !== undefined ? pageHitAt(G, at[0], at[1]) : null;
        const corner = h !== null ? cornerOf(G as NotebookGeometry, h) : 0;
        if ((corner !== 0) !== m.peekOn || (corner !== 0 && corner !== m.peekSide)) {
          m.peekOn = corner !== 0;
          if (corner !== 0) m.peekSide = corner;
          books.stir(book);
        }
      }
      if (stroke !== null && (!writing || stroke.pointer !== pointer)) { lift(stroke, at, now); stroke = null; }
      else if (stroke !== null && at !== undefined && G !== undefined) {
        // a frame of the stroke: a sample where the pen is on its page (off the page, the pen skips — the prototype's)
        const q = onPage(G, at, stroke);
        if (q !== null) { sample(stroke, q.s, q.y, f32(now - stroke.t0)); books.write(book, stroke.live); }
      } else if (stroke === null && writing && pointer !== undefined && at !== undefined && G !== undefined) {
        // the press: the pen meets a page's writing (never a turn's share, never an endpaper)
        const h = pageHitAt(G, at[0], at[1]);
        const q = h !== null && partOf(G, h) === "content" ? onPage(G, at, null) : null;
        if (q !== null) {
          const live: LiveStroke = { page: q.page, ink: pen, points: [], lifted: false, key: "" };
          stroke = { book, pointer, side: q.side, page: q.page, t0: now, points: [], times: [], live };
          sample(stroke, q.s, q.y, 0);
          books.write(book, live);
        }
      }
    },
    live: () => (stroke === null ? null : { book: stroke.book, page: stroke.page, samples: stroke.points.length }),
    commits: () => commits,
    turning: () => (turn === null ? null : { book: turn.book, side: turn.side, sheet: turn.sheet }),
    turns: () => turns,
  };
}
