// The MARKS around the four D3w kinds (design-015 §7; D4a over D3w): each kind's `frame` hook — the silhouette the
// builder hands the marks (`kind.frame?.(G) ?? rectFrame(rect)`, compose/builder.ts) — is the one the Node oracle's
// marks put around the same still (frame.mjs `markedObjects`), number for number on screen: the whiteboard's frame,
// the print's sheet, the notebook's FOOTPRINT at its turn (open, the whole spread), the desk calendar's sheet.
import type { Entity } from "@ice/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type BookPose, type Books, bookFrame, notebookKind } from "../src/notebook/kind";
import { boardKind } from "../src/board/kind";
import { calendarFrame, calendarKind } from "../src/calendar/kind";
import { FLUX_REST, type ObjectContext, type ObjectKind, rectFrame, rectOf, DEFAULT_GRID, type MarkFrame, MAT_GRID } from "@ice/desk";
import { photoKind, printRect } from "../src/photo/kind";
import { CALENDAR } from "../src/calendar/law";
import { padFrame } from "../src/calendar/pad";
import { frameOnScreen } from "../../desk/src/marks/layout";
import { NOTEBOOK } from "../src/notebook/law";
import { coverFrame, frameOf, specOf } from "../src/notebook/shape";
import { lampOf } from "../src/paper/paper";
import { PHOTO } from "../src/photo/photo";
import { BOARD } from "../src/board/theme";
import { THEMES } from "../../desk/oracle/fixtures/vf-theme";
import { fakeOracle, type OracleInternals, sceneOf } from "./oracle-fake";
import { must } from "../../desk/test/must";

const lamp = lampOf(MAT_GRID.plane);
const PICTURE = { w: 192, h: 128 };   // the committed picture (oracle/fixtures/assets/photo-1.json)
const PAD = padFrame(CALENDAR);
const BOOK = frameOf(specOf(NOTEBOOK, { sheets: NOTEBOOK.block.sheets }));
type Cam = { camX: number; camY: number; zoom: number };
type Spec = { x: number; y: number; angle?: number; seed?: number; cover?: string; left?: number; open?: boolean | number; held?: boolean; tilt?: [number, number] };
const camOf = (s: Cam) => ({ x: s.camX, y: s.camY, zoom: s.zoom });
const ctxOf = (s: Cam, rect: ObjectContext["rect"], props: Record<string, unknown>, over: Partial<ObjectContext> = {}): ObjectContext => ({
  entity: 41 as Entity, rect, props, flux: FLUX_REST, look: undefined, theme: THEMES.light, lamp,
  view: { camX: s.camX, camY: s.camY, zoom: s.zoom, width: 1200, height: 800, dpr: 2 }, grid: DEFAULT_GRID, dt: 1 / 60, ...over,
});

/** The builder's marks silhouette for an object of `kind` under the scene's camera (compose/builder.ts): its frame on screen. */
function worldFrame<G>(kind: ObjectKind<G>, ctx: ObjectContext, s: Cam): MarkFrame {
  const G = kind.resolve(ctx);
  return frameOnScreen(kind.frame?.(G) ?? rectFrame(ctx.rect), camOf(s));
}

let oracle: OracleInternals;
let undoGpu: () => void;
beforeAll(async () => { const o = await fakeOracle({ photo: PICTURE }); oracle = o.desk; undoGpu = o.undo; });
afterAll(() => undoGpu());

/** The oracle's ONE bracketed object for a still with one selection: its frame on screen. */
function oracleFrame(name: string): MarkFrame {
  const s = sceneOf<Cam>(name);
  const objects = oracle.marksOf(s, camOf(s)).objects.filter((o) => o.style === "brackets");
  expect(objects.length, name).toBe(1);
  return must(objects[0]).frame;
}

describe("the marks go around what each kind draws — the world's frame = the oracle's, on screen", () => {
  it("the whiteboard (board-selected-z1): its aluminium frame's outside, square to the mat, its corner", () => {
    const s = sceneOf<Cam & { boards: Spec[] }>("board-selected-z1");
    const b = must(s.boards[0]);
    const ctx = ctxOf(s, rectOf({ x: b.x - BOARD.spec.width / 2, y: b.y - BOARD.spec.height / 2 }, { w: BOARD.spec.width, h: BOARD.spec.height }), { cap: "black", tip: "bullet" });
    const got = worldFrame(boardKind(), ctx, s);
    expect(got).toEqual(oracleFrame("board-selected-z1"));
    expect(got.r).toBeGreaterThan(0);   // the frame's corner: never the bare rect's
  });

  it("the print (marks-print-z1): the sheet's own axes at its turn, its corner", () => {
    const s = sceneOf<Cam & { prints: Spec[] }>("marks-print-z1");
    const p = must(s.prints[0]);
    const r = printRect(p.x, p.y, PICTURE.w, PICTURE.h);
    const ctx = ctxOf(s, { cx: r.cx, cy: r.cy, w: r.w, h: r.h }, { blob: "", width: PICTURE.w, height: PICTURE.h, border: PHOTO.border, angle: p.angle ?? 0 });
    const got = worldFrame(photoKind(), ctx, s);
    expect(got).toEqual(oracleFrame("marks-print-z1"));
    expect(got.angle).toBeCloseTo(p.angle ?? 0, 12);
  });

  for (const name of ["marks-book-z2.2", "book-held-z1.8"]) {
    it(`the notebook (${name}): its case's footprint on the mat at its turn — lifted and tilted, the marks stay where it lies`, () => {
      const s = sceneOf<Cam & { books: Spec[] }>(name);
      const b = must(s.books[0]);
      const kind = notebookKind();
      const books = must(kind.local)({ pass: () => undefined }) as Books;
      const pose: BookPose = { ...(b.open !== undefined ? { open: b.open } : {}), ...(b.tilt !== undefined ? { tilt: b.tilt } : {}) };
      if (Object.keys(pose).length > 0) books.pin(41 as Entity, pose);
      const ctx = ctxOf(s, rectOf({ x: b.x - BOOK.W / 2, y: b.y - BOOK.H / 2 }, { w: BOOK.W, h: BOOK.H }), { title: "", cover: b.cover ?? "orbit", ruling: "dots", seed: b.seed ?? 7, spread: b.left ?? 0, angle: b.angle ?? 0 }, { local: books, flux: { ...FLUX_REST, lift: b.held ? 1 : 0 } });
      const got = worldFrame(kind, ctx, s);
      expect(got).toEqual(oracleFrame(name));
      const z = s.zoom;
      expect([got.hx, got.hy, got.angle, got.r]).toEqual([(BOOK.W / 2) * z, (BOOK.H / 2) * z, b.angle ?? 0, NOTEBOOK.cover.radius * z]);
    });
  }

  it("the desk calendar (marks-pad-z0.42): its sheet's footprint, square to the mat, the sheet's corner", () => {
    const s = sceneOf<Cam & { calendars: Spec[] }>("marks-pad-z0.42");
    const c = must(s.calendars[0]);
    const ctx = ctxOf(s, rectOf({ x: c.x - PAD.W / 2, y: c.y - PAD.H / 2 }, { w: PAD.W, h: PAD.H }), { month: "2026-09", weekStart: 1, tape: "ink", pen: "felt" });
    const got = worldFrame(calendarKind(), ctx, s);
    expect(got).toEqual(oracleFrame("marks-pad-z0.42"));
    expect([got.hx, got.hy, got.angle, got.r]).toEqual([(PAD.W / 2) * s.zoom, (PAD.H / 2) * s.zoom, 0, CALENDAR.sheet.radius * s.zoom]);
  });
});

describe("the footprints", () => {
  it("a book's: the closed case W × H about its centre at its turn; as the cover swings over, its footprint joins — open, the whole spread", () => {
    const closed = bookFrame(BOOK, 0, 100, 50, 0.3);
    expect(closed).toEqual({ cx: 100, cy: 50, hx: BOOK.W / 2, hy: BOOK.H / 2, angle: 0.3, r: NOTEBOOK.cover.radius });
    // open: the spread spans [−W/2 − the spine − W, W/2] in the book's own x (notebook/shape.ts), its centre along the turned x axis
    const open = bookFrame(BOOK, Math.PI, 100, 50, 0.3);
    const left = -BOOK.W / 2 - BOOK.sw - BOOK.W;
    expect(open.hx).toBeCloseTo((BOOK.W / 2 - left) / 2, 9);
    const mid = (left + BOOK.W / 2) / 2;
    expect(open.cx).toBeCloseTo(100 + mid * Math.cos(0.3), 9);
    expect(open.cy).toBeCloseTo(50 + mid * Math.sin(0.3), 9);
    // standing (a quarter of the way over and more), the cover's edge is inside the spread's reach: the footprint only grows
    const standing = bookFrame(BOOK, Math.PI / 2, 0, 0, 0);
    expect(standing.hx).toBeGreaterThan(BOOK.W / 2);
    expect(standing.hx).toBeLessThan(open.hx);
    const c = coverFrame(BOOK, Math.PI / 2);
    expect(standing.cx - standing.hx).toBeCloseTo(Math.min(c.ox, c.ox + c.ux * BOOK.W), 9);
  });

  it("a book pinned open (book-open-z2.2) wears its marks around the spread it lies as", () => {
    const s = sceneOf<Cam & { books: Spec[] }>("book-open-z2.2");
    const b = must(s.books[0]);
    const kind = notebookKind();
    const books = must(kind.local)({ pass: () => undefined }) as Books;
    books.pin(41 as Entity, { open: true });
    const ctx = ctxOf(s, rectOf({ x: b.x - BOOK.W / 2, y: b.y - BOOK.H / 2 }, { w: BOOK.W, h: BOOK.H }), { title: "", cover: "orbit", ruling: "dots", seed: 7, spread: b.left ?? 0, angle: b.angle ?? 0 }, { local: books });
    const f = must(kind.frame)(kind.resolve(ctx));
    expect(f.hx).toBeCloseTo((BOOK.W + BOOK.sw + BOOK.W) / 2, 9);
    expect(f.cx).toBeCloseTo(b.x - (BOOK.sw + BOOK.W) / 2, 9);
  });

  it("a desk calendar's: its sheet, square to the mat, whatever the law's sheet corner", () => {
    expect(calendarFrame(-40, 25)).toEqual({ cx: -40, cy: 25, hx: PAD.W / 2, hy: PAD.H / 2, angle: 0, r: CALENDAR.sheet.radius });
  });
});
