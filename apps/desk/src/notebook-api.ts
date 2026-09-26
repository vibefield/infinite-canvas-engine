// `window.__desk.notebook` — the notebook-in-hand's door for the rigs (design-015 D3t-b): a book's strokes as its data children
// state them (tool, pen, page, the path in page units, the timed samples); a page's raster read back — the coverage at page
// points and its inked texels (the CPU raster its layer is a copy of); the hand's word (the stroke in hand, the commits, the turn
// in the hand, the spreads written); the book's motion in hand (the sheets turned and in the air, the spread asked, the peek, the
// phone's page); the pages' replays. Everything reads the kind's own state or the world; nothing writes.

import { type CanvasEngine, ChildOf, type Entity } from "@ice/core";
import { type Books, type DeskLayerHandle, INK_H, INK_W, NOTEBOOK_PAGE } from "@ice/desk";
import { BoardStroke, decodePoints, decodeTimes, Notebook, NOTEBOOK_TYPE, type NotebookHand } from "@ice/desk/objects";

export interface NotebookApi {
  /** A book's strokes in sibling order: tool, pen, page, the path's points (page units), how many timed samples. */
  strokes(book: number): readonly { readonly tool: string; readonly ink: string; readonly page: number; readonly points: readonly (readonly [number, number])[]; readonly timed: number }[];
  /** A page's raster as its layer holds it: the coverage (0–255) at each page point, its inked texels; null when the page has no layer. */
  inkAt(book: number, page: number, points: readonly (readonly [number, number])[]): { readonly alpha: readonly number[]; readonly inked: number } | null;
  /** The notebook's hand: the stroke in hand, the strokes committed, the turn in the hand, the spreads written. */
  hand(): { readonly live: { readonly book: number; readonly page: number; readonly samples: number } | null; readonly commits: number; readonly turning: { readonly side: 0 | 1; readonly sheet: number | null } | null; readonly turns: number } | null;
  /** A book's leaves: the durable spread, the one asked, the sheets turned and in the air (their root angles), the peek, the phone's page. */
  leaves(book: number): { readonly spread: number; readonly pending: number | null; readonly turned: number; readonly airs: readonly number[]; readonly peek: number; readonly peekOn: boolean; readonly face: number; readonly faceT: number } | null;
  /** Whole-page replays of the pages' ink since the desk was made (the pen's own lifted stroke lands with none). */
  replays(): number;
}

export function notebookApi(engine: CanvasEngine, handle: DeskLayerHandle): NotebookApi {
  const { world } = engine;
  const books = (): Books | undefined => handle.local("notebook") as Books | undefined;
  const props = Notebook.groups[0]?.component;
  return {
    strokes(book) {
      return world.getReverse(book as Entity, ChildOf).flatMap((k) => {
        const r = world.get(k, BoardStroke);
        if (r === undefined) return [];
        return [{ tool: r.tool ?? "", ink: r.ink ?? "", page: r.page ?? 0, points: decodePoints(r.points ?? ""), timed: decodeTimes(r.times ?? "").length }];
      });
    },
    inkAt(book, page, points) {
      const b = books();
      if (b === undefined || !world.isAlive(book as Entity)) return null;
      const raster = b.pages.rasterOf(b.state(book as Entity).id, page);
      if (raster === undefined) return null;
      const alpha = points.map(([s, y]) => {
        const tx = Math.min(Math.max(Math.floor((s / NOTEBOOK_PAGE.len) * INK_W), 0), INK_W - 1);
        const ty = Math.min(Math.max(Math.floor((y / NOTEBOOK_PAGE.height) * INK_H), 0), INK_H - 1);
        return raster.bytes[(ty * INK_W + tx) * 4 + 3] ?? 0;
      });
      let inked = 0;
      for (let i = 3; i < raster.bytes.length; i += 4) if ((raster.bytes[i] ?? 0) > 8) inked += 1;
      return { alpha, inked };
    },
    hand() {
      const h = handle.driver(NOTEBOOK_TYPE) as NotebookHand | undefined;   // the notebook's driver (D-D7-A.3)
      if (h === undefined) return null;
      const live = h.live();
      const t = h.turning();
      return { live: live === null ? null : { book: live.book as number, page: live.page, samples: live.samples }, commits: h.commits(), turning: t === null ? null : { side: t.side, sheet: t.sheet }, turns: h.turns() };
    },
    leaves(book) {
      const b = books();
      const e = book as Entity;
      if (b === undefined || !world.isAlive(e) || props === undefined) return null;
      const st = b.state(e);
      const m = st.motion;
      const sheets = m?.sheets ?? [];
      return {
        spread: (world.get(e, props) as { spread: number }).spread, pending: st.pending,
        turned: sheets.filter((q) => q.side === 1).length, airs: sheets.filter((q) => q.air).map((q) => q.phi),
        peek: m?.peek ?? 0, peekOn: m?.peekOn ?? false, face: st.face, faceT: st.faceT,
      };
    },
    replays: () => books()?.pages.replays ?? 0,
  };
}
