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

import { defineQuery, type Entity, guardedTransaction, heldEntity, HeldPointer, HeldPress, HeldTool, LocalPointer, Pointer, PointerButtons, PointerScreen, type World } from "@ice/core";
import { addStroke, encodePoints } from "../board/data";
import { type Books, DEFAULT_PEN, type NotebookGeometry, pageHitAt, partOf, penOfTool } from "../kinds/notebook";
import { inkPoints, pageOfSide } from "../notebook/ink";
import type { LiveStroke } from "../notebook/pages";
import type { TypingDocs } from "./typing";

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

const pointersQ = defineQuery([Pointer, LocalPointer, PointerScreen]);
const f32 = Math.fround;

export function createNotebookHand(opts: NotebookHandOptions): NotebookHand {
  const { world, docs } = opts;
  const defer = opts.defer ?? ((fn: () => void) => queueMicrotask(fn));
  let stroke: Stroke | null = null;
  let commits = 0;

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
      if (book === undefined) return;
      const books = opts.books();
      if (books === undefined) return;
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
  };
}
