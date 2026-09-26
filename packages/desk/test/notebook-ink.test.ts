// @vitest-environment node
// THE NOTEBOOK'S PAGES AS DATA (NOTEBOOK.md §8; design-015 §5.1; D3t-b): a stroke on a page is a `desk.stroke` child of the book
// (v3 — its `page`, its path in page units, its samples' times); the pen's width is the fountain-pen law over the samples' pace,
// causal (the live pen's widths are the replay's); the page raster is pure arithmetic — a stroke laid a segment at a time (each
// the moment it is final) is the stroke laid whole, byte for byte; the eight layers are a CACHE handed out LRU to the pages in
// view with ink, replayed when a page's strokes are not the raster's, the pen's own lifted stroke ADOPTED (no replay), only the
// touched rectangle uploaded while it writes. The kind reads the children through the host (a real engine: laid, undone,
// redone), and its tools are the bar's: ‹ ›, the four pens (modes, their swatches the palette's), undo and redo — the document's.
import { ChildOf, createCanvasEngine, durablePrefabFor, guardedTransaction, HeldTool } from "@ice/core";
import { describe, expect, it } from "vitest";
import { worldChildren } from "../src/compose/children";
import { type Books, FLUX_REST, NOTEBOOK_PENS, NOTEBOOK_TOOLS, NotebookKind, notebookKind, type NotebookObjectLook, type ObjectContext, PageTurns, penToolId, rectOf } from "../src/kinds";
import { DEFAULT_GRID } from "../src/mat/grid";
import { INK_H, INK_LAYERS, INK_W, inkPoints, nibWidth, nibWidths, PEN, pagesInView } from "../src/notebook/ink";
import { NOTEBOOK } from "../src/notebook/law";
import { frameOf, specOf } from "../src/notebook/shape";
import { type InkUploader, type LiveStroke, PageInk, type PageStroke } from "../src/notebook/pages";
import type { NotebookPass } from "../src/notebook/pass";
import { drawSegment, drawStroke, PageRaster, scaleOf, segmentsOf } from "../src/notebook/raster";
import { addStroke, BoardStroke, encodePoints, Notebook, PENS, StrokePrefab } from "../src/objects";
import { lampOf } from "../src/paper/paper";
import { MAT_GRID } from "../src/theme";
import { NOTEBOOK_LOOK, notebookRuleInk, PALETTE, PENS as PEN_TOKENS, THEMES } from "../oracle/fixtures/vf-theme";
import { must } from "./must";

/** A page's open extent, page units (the law's frame: 185.28 × 245.6 — 5.5 texels a unit, NOTEBOOK.md §8). */
const PAGE = frameOf(specOf(NOTEBOOK));
const LEN = PAGE.Wo;
const HT = PAGE.Hp;
const [SX, SY] = scaleOf(LEN, HT);
const BLUE: [number, number, number] = [0.15, 0.29, 0.6];
const RED: [number, number, number] = [0.75, 0.22, 0.17];
const path = (n: number, x0 = 20, y0 = 40, dx = 9, dy = 3): [number, number][] => Array.from({ length: n }, (_, i) => [x0 + dx * i, y0 + dy * i + (i % 2) * 2] as [number, number]);
const timesOf = (n: number, dt = 16): number[] => Array.from({ length: n }, (_, i) => i * dt);
const alphaAt = (r: PageRaster, s: number, y: number): number => r.bytes[(Math.floor(y * SY) * INK_W + Math.floor(s * SX)) * 4 + 3] ?? -1;

describe("the pen's law over the samples (the fountain pen: thinner as the hand hurries)", () => {
  it("the first at rest; a fast hand thins it; a near sample keeps its width; the law is causal — a prefix's widths are the whole's", () => {
    const pts = path(12);
    const slow = nibWidths(pts, timesOf(12, 60), 400);
    const fast = nibWidths(pts, timesOf(12, 4), 400);
    expect(slow[0]).toBeCloseTo(nibWidth(PEN, 0, null), 12);
    expect(Math.min(...fast.slice(4))).toBeLessThan(Math.min(...slow.slice(4)));
    // a resting sample (the same point again) neither swells nor thins
    const rest = nibWidths([[10, 10], [30, 10], [30, 10], [30.1, 10]], [0, 16, 200, 216], 400);
    expect(rest[2]).toBe(rest[1]);
    expect(rest[3]).toBe(rest[1]);
    // causal: what the live pen computed for its first k samples is what the replay computes for them
    for (const k of [1, 2, 5, 9]) expect(nibWidths(pts.slice(0, k), timesOf(12, 30).slice(0, k), 400)).toEqual(nibWidths(pts, timesOf(12, 30), 400).slice(0, k));
    // untimed: spaced by the pace (a scene's authored stroke) — a steady hand, the same law
    const steady = nibWidths(pts, null, 300);
    expect(steady.every((w) => w >= PEN.width * PEN.thin && w <= PEN.width * PEN.thick)).toBe(true);
  });
});

describe("a page's raster — pure arithmetic, the midpoint quadratic", () => {
  it("the ink lies under the path and nowhere far from it; the rect a stroke returns bounds every texel it changed", () => {
    const r = new PageRaster();
    const p = inkPoints(path(10), timesOf(10), 400);
    const rect = must(drawStroke(r, BLUE, p, SX, SY));
    // the curve runs through the midpoints between samples (and from the first, to the last): the ink is whole there
    for (let i = 1; i < p.length; i++) { const a = must(p[i - 1]); const b = must(p[i]); expect(alphaAt(r, (a.s + b.s) / 2, (a.y + b.y) / 2)).toBe(255); }
    expect(alphaAt(r, 140, 200)).toBe(0);
    let outside = 0;
    for (let y = 0; y < INK_H; y += 3) for (let x = 0; x < INK_W; x += 3) {
      const a = r.bytes[(y * INK_W + x) * 4 + 3] as number;
      if (a > 0 && (x < rect.x || y < rect.y || x >= rect.x + rect.w || y >= rect.y + rect.h)) outside += 1;
    }
    expect(outside).toBe(0);
    // the pen's colour, straight alpha, where it lies whole
    const q = must(p[5]);
    const i = (Math.floor(q.y * SY) * INK_W + Math.floor(q.s * SX)) * 4;
    expect([r.bytes[i], r.bytes[i + 1], r.bytes[i + 2]]).toEqual(BLUE.map((c) => Math.round(c * 255)));
  });

  it("laid a segment at a time — each the moment it is final, the last at the lift — it is the stroke laid whole, byte for byte", () => {
    const whole = new PageRaster();
    const live = new PageRaster();
    const all = inkPoints(path(14, 30, 60, 7, -2), timesOf(14, 20), 400);
    drawStroke(whole, RED, all, SX, SY);
    const grown: typeof all = [];
    let done = 0;
    for (const q of all) {
      grown.push(q);
      const final = segmentsOf(grown.length, false);
      for (let k = done + 1; k <= final; k++) drawSegment(live, RED, grown, k, SX, SY);
      done = final;
    }
    for (let k = done + 1; k <= segmentsOf(grown.length, true); k++) drawSegment(live, RED, grown, k, SX, SY);
    expect(Buffer.compare(Buffer.from(live.bytes), Buffer.from(whole.bytes))).toBe(0);
    // a stroke of one sample is a dot, laid at the lift
    const dot = new PageRaster();
    expect(segmentsOf(1, false)).toBe(0);
    expect(drawStroke(dot, RED, inkPoints([[50, 50]], [0], 400), SX, SY)).not.toBeNull();
    expect(alphaAt(dot, 50, 50)).toBe(255);
  });

  it("a stroke over another is laid source-over: the later ink where they cross, both where they do not", () => {
    const r = new PageRaster();
    drawStroke(r, BLUE, inkPoints([[20, 100], [140, 100]], [0, 200], 400), SX, SY);
    drawStroke(r, RED, inkPoints([[80, 40], [80, 160]], [0, 200], 400), SX, SY);
    const at = (s: number, y: number) => { const i = (Math.floor(y * SY) * INK_W + Math.floor(s * SX)) * 4; return [r.bytes[i], r.bytes[i + 1], r.bytes[i + 2], r.bytes[i + 3]]; };
    expect(at(80, 100)).toEqual([...RED.map((c) => Math.round(c * 255)), 255]);
    expect(at(40, 100)).toEqual([...BLUE.map((c) => Math.round(c * 255)), 255]);
  });
});

/** An uploader that keeps what it was sent: each call's layer and rect. */
function spy(): InkUploader & { calls: { layer: number; x: number; y: number; w: number; h: number }[] } {
  const calls: { layer: number; x: number; y: number; w: number; h: number }[] = [];
  return { calls, uploadInk: (layer, _b, x = 0, y = 0, w = INK_W, h = INK_H) => { calls.push({ layer, x, y, w, h }); } };
}
const strokeOf = (key: string, pts: [number, number][], ink = "fountain"): PageStroke => ({ key, ink, points: inkPoints(pts, timesOf(pts.length), 400) });
const colour = () => BLUE;

describe("the pages' ink on the device — a cache of the strokes (notebook/pages.ts)", () => {
  it("only pages with ink take a layer; a page's strokes changed → it replays whole; the same strokes → nothing drawn or sent", () => {
    const ink = new PageInk();
    const up = spy();
    const a = strokeOf("a", path(6));
    const rows = new Map<number, PageStroke[]>([[1, [a]]]);
    const of = (p: number) => rows.get(p) ?? [];
    const t1 = ink.table(1, [2, 1], of, null, colour, "look", up, LEN, HT);
    expect(t1).toEqual({ pages: [1], layers: [0] });
    expect(up.calls).toEqual([{ layer: 0, x: 0, y: 0, w: INK_W, h: INK_H }]);
    expect(ink.replays).toBe(1);
    ink.table(1, [2, 1], of, null, colour, "look", up, LEN, HT);
    expect(up.calls).toHaveLength(1);
    expect(ink.replays).toBe(1);
    // a stroke laid by another hand (or an undo): a replay
    rows.set(1, [a, strokeOf("b", path(4, 60, 90))]);
    ink.table(1, [2, 1], of, null, colour, "look", up, LEN, HT);
    expect(ink.replays).toBe(2);
    rows.set(1, [a]);
    ink.table(1, [2, 1], of, null, colour, "look", up, LEN, HT);
    expect(ink.replays).toBe(3);
    // the look changed: a replay
    ink.table(1, [2, 1], of, null, colour, "night", up, LEN, HT);
    expect(ink.replays).toBe(4);
  });

  it("the pen's live stroke: each final segment drawn and only its rectangle sent; lifted, it is ADOPTED — its landing is no replay", () => {
    const ink = new PageInk();
    const up = spy();
    const rows: PageStroke[] = [strokeOf("a", path(5))];
    const pts = path(9, 25, 120, 8, 1);
    const live: LiveStroke = { page: 3, ink: "red", points: [], lifted: false, key: "" };
    const all = inkPoints(pts, timesOf(9), 400);
    for (const q of all) {
      live.points.push(q);
      ink.table(7, [3], () => rows, live, colour, "look", up, LEN, HT);
    }
    const partial = up.calls.slice(1);
    expect(up.calls[0]).toEqual({ layer: 0, x: 0, y: 0, w: INK_W, h: INK_H });   // the page came into a layer: whole
    expect(partial.length).toBeGreaterThan(4);
    expect(partial.every((c) => c.w < INK_W / 2 && c.h < INK_H / 2)).toBe(true);
    live.lifted = true;
    live.key = encodePoints(pts);
    ink.table(7, [3], () => rows, live, colour, "look", up, LEN, HT);
    const replays = ink.replays;
    // the kind lists it until its child lands, then the children do: neither is a replay
    const lifted: PageStroke = { key: live.key, ink: "red", points: live.points };
    ink.table(7, [3], () => [...rows, lifted], null, colour, "look", up, LEN, HT);
    ink.table(7, [3], () => [...rows, strokeOf(live.key, pts, "red")], null, colour, "look", up, LEN, HT);
    expect(ink.replays).toBe(replays);
    // what it holds is the page replayed whole, byte for byte
    const fresh = new PageInk();
    fresh.table(7, [3], () => [...rows, lifted], null, colour, "look", spy(), LEN, HT);
    expect(Buffer.compare(Buffer.from(must(ink.rasterOf(7, 3)).bytes), Buffer.from(must(fresh.rasterOf(7, 3)).bytes))).toBe(0);
    // refused (the kind drops it): the page is its children's again — a replay
    ink.table(7, [3], () => rows, null, colour, "look", up, LEN, HT);
    expect(ink.replays).toBe(replays + 1);
  });

  it("the eight layers are handed out LRU over the pages in view: a ninth page takes the least recently used; a book's end frees its layers", () => {
    const ink = new PageInk();
    const up = spy();
    const of = () => [strokeOf("x", path(3))];
    expect(INK_LAYERS).toBe(8);
    const t = ink.table(1, [1, 2, 3, 4, 5, 6, 7, 8], of, null, colour, "look", up, LEN, HT);
    expect(t.layers).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    ink.table(2, [9], of, null, colour, "look", up, LEN, HT);   // book 2's page takes the oldest — book 1's page 1 was used first
    expect(ink.rasterOf(1, 1)).toBeUndefined();
    expect(ink.rasterOf(2, 9)).toBeDefined();
    ink.forget(2);
    expect(ink.rasterOf(2, 9)).toBeUndefined();
  });
});

// ---------------------------------------------------------------- the kind, over a real engine's children

const lamp = lampOf(MAT_GRID.plane);
const palette = { ...PALETTE.light, notebooks: { ...NOTEBOOK_LOOK, rule: notebookRuleInk()[3] }, pens: PEN_TOKENS };
const kind = notebookKind();
const look = must(kind.theme)(palette, "light") as NotebookObjectLook;
const W = NOTEBOOK.cover.width;
const H = NOTEBOOK.cover.height;

function book(props: Record<string, unknown> = {}) {
  const ce = createCanvasEngine({ widgets: [Notebook] });
  ce.docs.create();
  const e = ce.ops.spawnWidget("desk.notebook", { x: 0, y: 0, props: { seed: 7, ...props }, undoable: false });
  ce.world.sync();
  const up = spy();
  const pass = new NotebookKind(up as unknown as NotebookPass);
  const books = must(kind.local)({ pass: () => pass, children: worldChildren(ce.world) }) as Books;
  const lay = (page: number, pts: [number, number][], ink = "fountain") => {
    const session = must(ce.docs.current());
    guardedTransaction(session.store, ce.world, (tx) => { addStroke(tx, e, { tool: "pen", ink, page, points: pts, times: timesOf(pts.length) }); });
    ce.world.sync();
  };
  const ctx = (spread: number): ObjectContext => ({
    entity: e, rect: rectOf({ x: -W / 2, y: -H / 2 }, { w: W, h: H }), props: { title: "", cover: "orbit", ruling: "dots", seed: 7, spread, angle: 0 },
    flux: FLUX_REST, look, theme: THEMES.light, lamp, view: { camX: -700, camY: -400, zoom: 1, width: 1200, height: 800, dpr: 2 }, grid: DEFAULT_GRID, dt: 1 / 60, local: books,
  });
  return { ce, e, up, books, lay, ctx };
}

describe("the notebook's strokes are its DATA — one child each, on its page (desk.stroke v3)", () => {
  it("the Notebook declares the stroke prefab as its data: the catalog stamps desk.stroke@3 in a notebook-only desk; a stroke is a child with its page", () => {
    expect(Notebook.data).toEqual([StrokePrefab]);
    const b = book();
    expect(b.ce.docs.current()?.versionReport().localPacks["desk.stroke"]).toBe(3);
    expect(durablePrefabFor(b.ce.world, "desk.stroke")).toBe(StrokePrefab);
    b.lay(3, path(4));
    const kids = b.ce.world.getReverse(b.e, ChildOf);
    expect(kids).toHaveLength(1);
    expect(b.ce.world.get(must(kids[0]), BoardStroke)).toMatchObject({ tool: "pen", ink: "fountain", page: 3, erase: false });
  });

  it("an open spread's record names its pages in view with ink, each on a layer — the children replayed; undone, the page leaves the table; redone, it replays", () => {
    const b = book({ spread: 1 });
    b.lay(2, path(5));   // sheet 0's verso: the left page at spread 1
    b.lay(3, path(5, 40, 60));   // sheet 1's recto: the right page
    b.lay(5, path(3));   // two pages on: not in view
    b.books.pin(b.e, { open: true });
    const resolve = () => { const c = b.ctx(1); const G = kind.resolve(c); return kind.record(G, c); };
    const r1 = resolve();
    expect(pagesInView(kind.resolve(b.ctx(1)).pose, Math.PI)).toEqual([2, 3]);
    expect(r1.ink).toEqual({ pages: [2, 3], layers: [0, 1] });
    const replays = b.books.pages.replays;
    expect(replays).toBe(2);
    b.ce.docs.undo();   // the stroke on page 5 — the newest child
    b.ce.docs.undo();   // page 3's
    b.ce.world.sync();
    expect(resolve().ink).toEqual({ pages: [2], layers: [0] });
    expect(b.books.pages.rasterOf(b.books.state(b.e).id, 3)).toBeUndefined();   // a page whose ink is gone holds no layer
    b.ce.docs.redo();
    b.ce.world.sync();
    expect(resolve().ink).toEqual({ pages: [2, 3], layers: [0, 1] });
    expect(b.books.pages.replays).toBe(replays + 1);   // page 3 gave its layer back when its ink went: back, it replays; page 2's never moved
    expect(b.books.pages.rasterOf(b.books.state(b.e).id, 5)).toBeUndefined();   // never in view: never on a layer
    // a closed book shows no page: no table, nothing sent
    b.books.pin(b.e, undefined);
    const shut = kind.record(kind.resolve(b.ctx(1)), b.ctx(1));
    expect(shut.ink).toEqual({ pages: [], layers: [] });
  });
});

describe("the notebook's tools in hand (the held bar: ‹ pages › · pens · undo)", () => {
  it("‹ › are actions that count a turn; the four pens are the note's — modes, 1–4, a crosshair, their swatches the palette's inks; undo and redo are the document's", () => {
    expect(NOTEBOOK_PENS).toEqual(PENS);
    expect(NOTEBOOK_TOOLS.map((t) => [t.id, t.kind, t.keys?.join(" ")])).toEqual([
      ["turn:-1", "action", "ArrowLeft PageUp"], ["turn:1", "action", "ArrowRight PageDown"],
      ["pen:felt", "mode", "1"], ["pen:ball", "mode", "2"], ["pen:fountain", "mode", "3"], ["pen:red", "mode", "4"],
      ["undo", "action", "mod+z"], ["redo", "action", "mod+shift+z mod+y"],
    ]);
    expect(NOTEBOOK_TOOLS.filter((t) => t.kind === "mode").every((t) => t.cursor === "crosshair")).toBe(true);
    expect(NOTEBOOK_TOOLS.find((t) => t.id === "redo")?.bar).toBe(false);
    expect(look.swatches[penToolId("red")]).toBe(PEN_TOKENS.red.css);
    const b = book();
    b.ce.step(1000);
    b.ce.ops.open(b.e);
    expect(b.ce.world.get(b.e, HeldTool)?.id).toBe("pen:fountain");   // the pen in hand at the pickup
    b.ce.ops.useHeldTool("turn:1");
    b.ce.ops.useHeldTool("turn:1");
    b.ce.ops.useHeldTool("turn:-1");
    expect(b.ce.world.get(b.e, PageTurns)?.n).toBe(1);
    b.ce.ops.useHeldTool("pen:red");
    expect(b.ce.world.get(b.e, HeldTool)?.id).toBe("pen:red");
    b.lay(1, path(3));
    b.ce.ops.useHeldTool("undo");
    b.ce.world.sync();
    expect(b.ce.world.getReverse(b.e, ChildOf)).toHaveLength(0);
    b.ce.ops.useHeldTool("redo");
    b.ce.world.sync();
    expect(b.ce.world.getReverse(b.e, ChildOf)).toHaveLength(1);
  });
});
