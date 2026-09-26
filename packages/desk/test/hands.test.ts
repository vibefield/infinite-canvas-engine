// @vitest-environment node
// A ROOM'S OTHER PEOPLE on the desk (D5a, D-D5a.1 — remote hands drawn by the marks pass, so collab keeps a picture
// when dom's world half goes): the hand's path is ONE path (the theme's, the shader's, the mirror's), the layout draws
// each hand at its tip with its name in an ink flag over everything and each peer's selection as YOUR brackets in their
// colour at 50 % (no knobs) under your own marks; and from the world — core's presence projections (a remote
// `CursorVisual` following its peer's `PresenceInfo`, the peer's `SelectionSummary` keys resolved to this desk's
// objects) — through the real builder, with a wake when a hand moves. The pictures are the oracle's (marks-remote-*).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createCanvasEngine, CursorVisual, Follows, Position, PresenceInfo, PresencePeer, SelectionSummary, Viewport } from "@ice/core";
import { describe, expect, it } from "vitest";
import { createDeskBuilder } from "../src/compose/builder";
import { DEFAULT_GRID } from "../src/mat/grid";
import { layoutMarks, MARK, NO_MARKS } from "../src/marks/layout";
import { handDistance, markDistance } from "../src/marks/mirror";
import { MiniMat, Note } from "../src/objects";
import { minimatKind, paperKind } from "../src/kinds";
import { cssColor, MARKS } from "../src/theme";
import { PALETTE, PENS, SURFACES, THEMES, VINYLS } from "../oracle/fixtures/vf-theme";
import { must } from "./must";

const VP = { width: 1200, height: 800, dpr: 2 };
const DT = 1 / 60;
const palette = { ...PALETTE.light, papers: { yellow: SURFACES.note }, pens: PENS, vinyls: VINYLS };
const LOOKS = new Map<string, unknown>([["paper", must(paperKind().theme)(palette, "light")], ["minimat", must(minimatKind().theme)(palette, "light")]]);
const VIOLET = cssColor(MARKS.hand.inks[0]);
const frame = { cx: 400, cy: 300, hx: 100, hy: 100, angle: 0, r: 2 };

describe("the hand's path is one path", () => {
  it("marks.wgsl's `marks_hand_sd` walks the theme's path, and its tip is the path's first vertex", () => {
    const wgsl = readFileSync(join(import.meta.dirname, "../shaders/marks/marks.wgsl"), "utf8");
    const arr = must(/fn marks_hand_sd[\s\S]*?array<vec2f, (\d+)>\(([^;]*)\);/.exec(wgsl), "the shader's path");
    const verts = [...(arr[2] as string).matchAll(/vec2f\(([-\d.]+), ([-\d.]+)\)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(Number(arr[1])).toBe(MARKS.hand.path.length);
    expect(verts).toEqual(MARKS.hand.path.map((v) => [...v]));
    const tip = must(/const HAND_TIP = vec2f\(([-\d.]+), ([-\d.]+)\);/.exec(wgsl), "the shader's tip");
    expect([Number(tip[1]), Number(tip[2])]).toEqual([...MARKS.hand.path[0]]);
  });

  it("the mirror's distance is signed: inside the arrow, outside it, and 0 on its vertices", () => {
    expect(handDistance(4, 9)).toBeLessThan(-2);   // the arrow's body
    expect(handDistance(12, 3)).toBeGreaterThan(3); // beside its long edge
    expect(handDistance(3, 18)).toBeGreaterThan(0); // under its stem, between the notch and the tail
    for (const [x, y] of MARKS.hand.path) expect(Math.abs(handDistance(x, y))).toBeLessThan(1e-9);
  });
});

describe("the layout draws a room's other people", () => {
  const atlas = { scale: 2, cellW: 16, cellH: 26, advance: 12, baseline: 20, cap: 14, width: 1024, height: 64, count: 48 };
  const input = {
    ...NO_MARKS(VP),
    objects: [{ frame: { ...frame, cx: 800 }, style: "brackets" as const, t: 1, alpha: 1, knobs: true }],
    peers: { selections: [{ frame, ink: VIOLET }], hands: [{ x: 598, y: 262, name: "Bob Loblaw the Second of Mine", ink: VIOLET }] },
  };
  const out = layoutMarks(input, atlas);

  it("their selection wears your brackets in their colour at 50 % — no knobs — under your own marks", () => {
    const theirs = out.filter((m) => m.colour[0] === VIOLET[0] && m.colour[1] === VIOLET[1] && m.colour[2] === VIOLET[2]);
    const brackets = theirs.filter((m) => m.shape[0] === MARK.brackets);
    expect(brackets).toHaveLength(1);
    expect(brackets[0]?.colour[3]).toBeCloseTo(MARKS.hand.selection, 12);
    expect(brackets[0]?.shape[2]).toBe(MARKS.select.stroke);
    expect(theirs.filter((m) => m.shape[0] === MARK.fill)).toHaveLength(0); // no knob faces
    const firstMine = out.findIndex((m) => m.centre[0] === 800);
    expect(out.indexOf(must(brackets[0], "their brackets"))).toBeLessThan(firstMine);
  });

  it("each hand: one record at its tip in their colour, the same size on screen, and its name in an ink flag beside it — over everything", () => {
    const hands = out.filter((m) => m.shape[0] === MARK.hand);
    expect(hands).toHaveLength(1);
    const h = must(hands[0], "the hand");
    expect([h.centre[0], h.centre[1]]).toEqual([598, 262]);
    expect([...h.colour]).toEqual([VIOLET[0], VIOLET[1], VIOLET[2], 1]);
    expect(h.shape[2]).toBe(MARKS.hand.rim);
    expect([h.half[0], h.half[1], h.half[2]]).toEqual([...MARKS.hand.shadow.offset, MARKS.hand.shadow.blur]);
    // its quad holds the box and every reach of its ink (the mirror's say): nothing painted outside it
    const [x0, y0, x1, y1] = h.quad;
    const bx = 598 - MARKS.hand.path[0][0];
    const by = 262 - MARKS.hand.path[0][1];
    expect(x0 < bx && y0 < by && x1 > bx + MARKS.hand.box[0] && y1 > by + MARKS.hand.box[1]).toBe(true);
    for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]] as const) expect(markDistance(h, x, y)).toBeGreaterThan(0);
    // the flag: the tray's ink, 13 right and 17 down from the box's corner; the name in capitals, at most 16 of them
    const tray = cssColor(MARKS.inks.tray.css);
    const flags = out.filter((m) => m.shape[0] === MARK.fill && m.centre[3] === MARKS.pill.radius && m.half[1] * 2 === MARKS.pill.height);
    expect(flags).toHaveLength(1);
    const flag = must(flags[0], "the flag");
    expect([...flag.colour]).toEqual([...tray]);
    expect(flag.centre[0] - flag.half[0]).toBe(Math.round(bx + MARKS.hand.flag[0]));
    expect(flag.centre[1] - flag.half[1]).toBe(Math.round(by + MARKS.hand.flag[1]));
    const glyphs = out.filter((m) => m.shape[0] === MARK.glyph && m.colour[0] === cssColor(MARKS.inks.paper.css)[0]);
    expect(glyphs.length).toBe("BOB LOBLAW THE S".length); // 16 cells (the atlas sets a space too)
    // the hand and its flag come last: a hand rides the glass over every mark
    expect(out.indexOf(h)).toBe(out.length - 1 - glyphs.length - 1);
  });

  it("a desk alone draws nobody", () => {
    expect(layoutMarks({ ...NO_MARKS(VP) }, atlas).filter((m) => m.shape[0] === MARK.hand)).toHaveLength(0);
  });
});

describe("a room's other people from the world (compose/marks.ts, through the builder)", () => {
  it("core's presence projections become their hand at their cursor and their selection on this desk's object — and a hand that moves wakes the builder", () => {
    const ce = createCanvasEngine({ widgets: [Note, MiniMat] });
    ce.docs.create();
    ce.world.setResource(Viewport, { w: VP.width, h: VP.height, dpr: VP.dpr });
    let now = 0;
    const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; ce.step(now); } };
    const note = ce.ops.spawnWidget("desk.note", { x: 200, y: 150, props: { seed: 7 }, undoable: false });
    step(3);
    const key = must(ce.docs.current()?.store.keyOf(note), "the note's key");
    const builder = createDeskBuilder(ce.world, { objects: [Note, MiniMat], resolveKey: (k) => ce.docs.current()?.store.resolve(k as never) });
    const cam = { x: -50, y: -20, zoom: 2 };
    const build = () => { builder.changed(); return builder.build(cam, VP, DT, THEMES.light, DEFAULT_GRID, LOOKS); };
    expect(build().marks.peers).toBeUndefined(); // alone: nobody

    // a remote peer as core's presence projects one (no Local): its identity, a one-object selection summary by KEY
    const w = ce.world;
    const peer = w.spawn({ components: [[PresenceInfo, { name: "Bob", color: MARKS.hand.inks[0] }], [SelectionSummary, { count: 1, x: 200, y: 150, w: 200, h: 200, keys: JSON.stringify([key]) }]], tags: [PresencePeer] });
    const cursor = w.spawn({ components: [[Position, { x: 100, y: 60 }], [CursorVisual, { kind: "remote", pressed: false }]] });
    w.setRelation(cursor, Follows, peer);
    w.sync();
    expect(builder.changed()).toBe(true); // they arrived: a wake
    const peers = must(builder.build(cam, VP, DT, THEMES.light, DEFAULT_GRID, LOOKS).marks.peers, "the room's marks");
    expect(peers.hands).toEqual([{ x: (100 - cam.x) * cam.zoom, y: (60 - cam.y) * cam.zoom, name: "Bob", ink: VIOLET }]);
    expect(peers.selections).toHaveLength(1);
    const f = must(peers.selections[0], "their selection").frame;
    expect(f.cx).toBeCloseTo((300 - cam.x) * cam.zoom, 6); // the note's frame on screen, where the builder drew it
    expect(f.cy).toBeCloseTo((250 - cam.y) * cam.zoom, 6);
    expect(builder.changed()).toBe(false); // nothing moved: quiet

    w.edit(cursor).set(Position, { x: 140, y: 60 });
    expect(builder.changed()).toBe(true); // the hand moved: a wake
    expect(must(builder.build(cam, VP, DT, THEMES.light, DEFAULT_GRID, LOOKS).marks.peers, "the room's marks").hands[0]?.x).toBe((140 - cam.x) * cam.zoom);

    // a colour no one can parse is the hand table's grey — a peer's bad byte never throws here
    w.edit(peer).set(PresenceInfo, { name: "Bob", color: "not a colour" });
    expect(builder.changed()).toBe(true);
    expect(must(builder.build(cam, VP, DT, THEMES.light, DEFAULT_GRID, LOOKS).marks.peers, "the room's marks").hands[0]?.ink).toEqual(cssColor(MARKS.hand.fallback));
    ce.dispose();
  });
});
