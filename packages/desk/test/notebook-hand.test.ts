// @vitest-environment node
// THE NOTEBOOK IN HAND — its pen (NOTEBOOK.md §7–8; design-015 §8; D3t-b): through the REAL stack (core's held input maps the
// pointer through the pose seam into `HeldPointer`, the kind's hit answers the part under it — a page's writing is `content`, and
// a press there with a pen in hand is the tool's), the hand lays a stroke LIVE into its page's raster a sample a frame — through
// the SAME desk eye the book was drawn with (`pageHitAt` on the geometry in hand) — and commits it as ONE `desk.stroke` child of
// the book on its page, in page units with its samples' times, which the page's raster ADOPTS (the replay of its row lays the live
// pen's bytes). Put down mid-stroke, the stroke lands first; ⌘Z is the document's; the case and a turn's share take no ink.
import { describe, expect, it } from "vitest";
import { pageHitAt } from "../src/kinds";
import { INK_H, INK_W } from "../src/notebook/ink";
import { PageInk } from "../src/notebook/pages";
import { decodePoints, decodeTimes } from "../src/objects";
import { must } from "./must";
import { bookRig, look } from "./notebook-rig";

const rig = bookRig;

describe("the pen in hand writes on a page and commits ONE child with its page and its samples' times", () => {
  it("press on the right page · moves · a rest · the lift → one desk.stroke on page 1, in page units; its replay is the live pen's raster, byte for byte", async () => {
    const r = rig();
    r.open();
    r.mouse("move", 650, 380, 0); r.frame();
    expect(r.partUnder()).toBe("content");
    r.mouse("down", 650, 380, 1); r.frame();
    expect(r.hand.live()).toMatchObject({ book: r.book, page: 1, samples: 1 });
    r.mouse("move", 670, 386, 1); r.frame();
    r.mouse("move", 700, 392, 1); r.frame();
    r.frame(200);   // the pen rests: a sample on the same point
    r.mouse("move", 730, 404, 1); r.frame();
    r.mouse("up", 730, 404, 0); r.frame();
    expect(r.hand.live()).toBeNull();
    await r.settle();
    const rows = r.strokes();
    expect(rows).toHaveLength(1);
    const row = must(rows[0]);
    expect(row).toMatchObject({ tool: "pen", ink: "fountain", page: 1, erase: false });
    const pts = decodePoints(row.points ?? "");
    const times = decodeTimes(row.times ?? "");
    expect(pts.length).toBe(times.length);
    expect(times[0]).toBe(0);
    // screen (650, 380) is the desk's (−40, −20): the right page's point through the eye, page units — `s` from the gutter, `y` from the head
    const h = must(pageHitAt(r.geometry(), -40, -20));
    if (h.part !== "page") throw new Error("the press is on the right page");
    expect(pts[0]).toEqual([Math.fround(h.s), Math.fround(h.y + r.geometry().frame.Hp / 2)]);
    expect(must(pts[0])[1]).toBeGreaterThan(100);   // 20 units above the page's middle, from its head
    expect(pts.some((p, i) => i > 0 && p[0] === must(pts[i - 1])[0] && p[1] === must(pts[i - 1])[1])).toBe(true);   // the rest
    expect(r.hand.commits()).toBe(1);
    // the page's raster ADOPTED the stroke: its landing was no replay, and it holds what a replay of the child lays
    const replays = r.books.pages.replays;
    r.frame(); r.frame();
    expect(r.books.pages.replays).toBe(replays);
    const mine = must(r.books.pages.rasterOf(r.books.state(r.book).id, 1));
    const fresh = new PageInk();
    fresh.table(1, [1], (p) => r.books.strokesOn(r.book, p), null, () => look.pens.fountain ?? [0, 0, 0], look, { uploadInk: () => {} }, r.geometry().frame.Wo, r.geometry().frame.Hp);
    expect(Buffer.compare(Buffer.from(mine.bytes), Buffer.from(must(fresh.rasterOf(1, 1)).bytes))).toBe(0);
    expect(mine.bytes.length).toBe(INK_W * INK_H * 4);
    // ⌘Z is the document's: the stroke goes, and the page is clean again
    r.ce.docs.undo();
    r.ce.world.sync();
    expect(r.strokes()).toHaveLength(0);
    r.frame();
    expect(r.books.strokesOn(r.book, 1)).toHaveLength(0);
  });

  it("an undo in hand wakes the desk — the book's strokes changed since its pages were brought up to them — and the page gives its ink back", async () => {
    const r = rig();
    r.open();
    r.mouse("move", 650, 380, 0); r.frame();
    r.mouse("down", 650, 380, 1); r.frame();
    r.mouse("move", 700, 392, 1); r.frame();
    r.mouse("up", 700, 392, 0); r.frame();
    await r.settle();
    for (let i = 0; i < 4; i++) r.frame();
    const tick = () => must(r.books.tick)(0);
    tick();
    expect(tick()).toBe(false);   // quiet in hand: nothing moves, nothing to bring up to date
    const id = r.books.state(r.book).id;
    expect(r.books.pages.rasterOf(id, 1)).toBeDefined();
    r.ce.docs.undo();
    r.ce.world.sync();
    expect(tick()).toBe(true);   // the strokes changed: a frame is asked for
    r.frame();
    expect(tick()).toBe(false);
    expect(r.books.pages.rasterOf(id, 1)).toBeUndefined();   // page 1 has no ink: its layer is given back
  });

  it("the pen in hand is the ink: the red pen writes red; a page turned to is written on its own page (the left, a verso)", async () => {
    const r = rig({ spread: 2 });
    r.open();
    r.ce.ops.useHeldTool("pen:red");
    // the left page at spread 2 is sheet 1's verso: page 4 — the desk's (−190, 10), the screen's (500, 410)
    r.mouse("move", 500, 410, 0); r.frame();
    expect(r.partUnder()).toBe("content");
    r.mouse("down", 500, 410, 1); r.frame();
    r.mouse("move", 520, 420, 1); r.frame();
    r.mouse("up", 520, 420, 0); r.frame();
    await r.settle();
    expect(r.strokes().map((s) => [s?.ink, s?.page])).toEqual([["red", 4]]);
  });

  it("put down mid-stroke, the stroke lands first; a press on the case, an endpaper or a turn's share lays no ink", async () => {
    const r = rig();
    r.open();
    r.mouse("move", 650, 380, 0); r.frame();
    r.mouse("down", 650, 380, 1); r.frame();
    r.mouse("move", 690, 390, 1); r.frame();
    r.ce.ops.putDown();
    r.frame();
    await r.settle();
    expect(r.strokes().map((s) => s?.page)).toEqual([1]);
    r.mouse("up", 690, 390, 0); r.frame();
    // in hand again: the left side at spread 0 is the front endpaper (the inside of the cover) — the case's, no page to write on
    r.ce.ops.open(r.book); r.frame(); r.frame();
    r.mouse("move", 500, 400, 0); r.frame();
    expect(r.partUnder()).toBe("frame");
    r.mouse("down", 500, 400, 1); r.frame();
    r.mouse("move", 520, 410, 1); r.frame();
    r.mouse("up", 520, 410, 0); r.frame();
    // the right page's outer 30 %: a turn's, not the pen's
    r.mouse("move", 760, 400, 0); r.frame();
    expect(r.partUnder()).toBe("turn");
    await r.settle();
    expect(r.strokes()).toHaveLength(1);
    expect(r.hand.commits()).toBe(1);
  });
});
