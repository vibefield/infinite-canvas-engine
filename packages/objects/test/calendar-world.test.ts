// The DESK CALENDAR from the world (design-015 §5–6; D3w): the Calendar object through `defineObject`; its world
// half = the Node oracle's own `calendarDraw` for every pad scene (at rest, mid-roll as a flux pin, by night —
// PARITY BY CONSTRUCTION); a pinned note's day slot = the oracle's `pinnedAt`; its events and pins as DATA CHILDREN
// (one transaction each, undone and redone, dying and coming back with the pad); its hit through the desk eye — the
// tape carries it, the paper is not taken; the ring's fade; the print's presences on the root pass; its slots.
import { cascadeDestroy, ChildOf, createCanvasEngine, defineQuery, type Entity, guardedTransaction, Position, PrefabId } from "@ice/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CALENDAR } from "../src/calendar/law";
import type { CalendarDraw, CalendarPass } from "../src/calendar/pass";
import type { PrintPass } from "../src/calendar/printing";
import type { PrintRaster, TileSource } from "@ice/desk/kit";
import { TILE_TEX } from "../src/calendar/tiles";
import { dayIn, dayOfKey, monthOfDay } from "../src/calendar/month";
import { padFrame } from "../src/calendar/pad";
import { worldChildren } from "../../desk/src/compose/children";
import { CalendarKind, calendarKind, createPads, type Pads } from "../src/calendar/kind";
import { FLUX_REST, type ObjectContext, rectOf, DEFAULT_GRID, objectKindOf, MAT_GRID } from "@ice/desk";
import { addEvent, Calendar, CALENDAR_TYPE, CalendarEvent, daySlot, NOTE_TYPE, Note, NotePin, pinNote, PinsNote } from "../src";
import { lampOf } from "../src/paper/paper";
import { CALENDAR_LOOK, PALETTE, PENS, THEMES } from "../oracle/fixtures/vf-theme";
import { calendarDraw, pinnedAt } from "../oracle/frame.mjs";
import { fakeOracle, sceneOf } from "./oracle-fake";
import { must } from "../../desk/test/must";

const lamp = lampOf(MAT_GRID.plane);
const palette = { ...PALETTE.light, calendars: CALENDAR_LOOK, pens: PENS };
const kind = calendarKind();
const look = must(kind.theme)(palette, "light");
const PAD = padFrame(CALENDAR);
type Pad = { x: number; y: number; month?: string; weekStart?: 0 | 1; pose?: { dir: 1 | -1; p: number; tilt?: number }; tape?: string; pen?: string };
type Scene = { camX: number; camY: number; zoom: number; calendars: Pad[]; notes?: { pin?: { day: string } }[] };
const viewOf = (s: { camX: number; camY: number; zoom: number }) => ({ camX: s.camX, camY: s.camY, zoom: s.zoom, width: 1200, height: 800, dpr: 2 });
const ctxOf = (c: Pad, s: { camX: number; camY: number; zoom: number }, over: Partial<ObjectContext> = {}): ObjectContext => ({
  entity: 31 as Entity, rect: rectOf({ x: c.x - PAD.W / 2, y: c.y - PAD.H / 2 }, { w: PAD.W, h: PAD.H }),
  props: { month: c.month ?? "2026-09", weekStart: c.weekStart ?? 1, tape: c.tape ?? "ink", pen: c.pen ?? "felt" },
  flux: FLUX_REST, look, theme: THEMES.light, lamp, view: viewOf(s), grid: DEFAULT_GRID, dt: 1 / 60, ...over,
});
const padsOf = () => must(kind.local)({ pass: () => undefined }) as Pads;
const padsQ = defineQuery([PrefabId, Position]);

let undoGpu: () => void;
beforeAll(async () => { undoGpu = (await fakeOracle()).undo; });
afterAll(() => undoGpu());

describe("the Calendar object (design-015 §6)", () => {
  it("desk.calendar — month · weekStart · tape · pen; the sheet 1760 × 1852; beneath everything (pads)", () => {
    expect(Calendar.type).toBe(CALENDAR_TYPE);
    expect(objectKindOf(Calendar)?.name).toBe("calendar");
    expect(Calendar.defaultSize).toEqual({ w: 1760, h: 1852 });
    expect(Calendar.stratum).toBe("pads");
    expect(Object.keys(Calendar.propToGroup).sort()).toEqual(["month", "pen", "tape", "weekStart"]);
  });
});

describe("the calendar's world half = the oracle's `calendarDraw` (parity by construction)", () => {
  it("every pad scene — at rest, mid-roll (a flux pin), by night, under pinned notes: the whole record, its sheets, its roll", () => {
    for (const name of ["pad-rest-z0.42", "pad-roll-z0.42", "pad-night-z0.42", "pad-notes-z0.85"]) {
      const s = sceneOf<Scene>(name);
      const c = must(s.calendars[0]);
      const pads = padsOf();
      if (c.pose !== undefined) pads.pin(31 as Entity, { roll: c.pose });
      const ctx = ctxOf(c, s, { local: pads });
      const { mesh, ...mine } = kind.record(kind.resolve(ctx), ctx);
      const { mesh: oMesh, ...oracle } = calendarDraw(c, 0) as CalendarDraw;
      expect(mine, name).toEqual(oracle);
      // the pad's one mesh, byte for byte over what was built (a deep equality over its typed arrays is slow under load)
      expect([mesh.vcount, mesh.icount, mesh.sheetFirst, mesh.rollFirst, mesh.min, mesh.max], name).toEqual([oMesh.vcount, oMesh.icount, oMesh.sheetFirst, oMesh.rollFirst, oMesh.min, oMesh.max]);
      const bytes = (a: Float32Array | Uint32Array, n: number) => Buffer.from(a.buffer, a.byteOffset, n * a.BYTES_PER_ELEMENT);
      expect(Buffer.compare(bytes(mesh.vertices, mesh.vcount * 16), bytes(oMesh.vertices, oMesh.vcount * 16)), name).toBe(0);
      expect(Buffer.compare(bytes(mesh.indices, mesh.icount), bytes(oMesh.indices, oMesh.icount)), name).toBe(0);
    }
  }, 30_000);

  it("a note stuck to a day lies in its day's slot: `daySlot` = the oracle's `pinnedAt`, for both of the scene's days and a Sunday-first pad", () => {
    const s = sceneOf<Scene>("pad-notes-z0.85");
    const c = must(s.calendars[0]);
    for (const n of s.notes ?? []) { const day = must(n.pin).day; expect(daySlot(c.x, c.y, day, 1)).toEqual(pinnedAt(c, day)); }
    expect(daySlot(300, -200, "2026-02-01", 0)).toEqual(pinnedAt({ x: 300, y: -200, weekStart: 0 }, "2026-02-01"));
    expect(() => daySlot(0, 0, "2026-09-31")).toThrow(/not a day/);
    expect(() => daySlot(0, 0, "someday")).toThrow(/not a day/);
  });
});

describe("its events and pins are DATA CHILDREN (read-only here)", () => {
  function desk() {
    const ce = createCanvasEngine({ widgets: [Calendar, Note] });
    ce.docs.create();
    let now = 0;
    const step = (): void => { now += 16; ce.step(now); };
    const session = () => must(ce.docs.current(), "a document");
    const pad = ce.ops.spawnWidget(CALENDAR_TYPE, { x: -880, y: -926, undoable: false });
    const note = ce.ops.spawnWidget(NOTE_TYPE, { x: 0, y: 0, props: { seed: 3 }, undoable: false });
    step();
    const pads = must(kind.local)({ pass: () => undefined, children: worldChildren(ce.world) }) as Pads;
    return { ce, step, session, pad, note, pads };
  }

  it("an event and a pin are one transaction each — entities ChildOf the pad; the pin's edge holds the note; ⌘Z takes each back", () => {
    const { ce, step, session, pad, note, pads } = desk();
    guardedTransaction(session().store, ce.world, (tx) => { addEvent(tx, pad, { start: "2026-09-15", end: "2026-09-17", text: "offsite", ink: "yellow" }); });
    step();
    guardedTransaction(session().store, ce.world, (tx) => { pinNote(tx, pad, note, "2026-09-26"); });
    step();
    expect(pads.events(pad)).toEqual([{ start: "2026-09-15", end: "2026-09-17", text: "offsite", seeds: "", ink: "yellow" }]);
    const kids = ce.world.getReverse(pad, ChildOf);
    expect(kids.length).toBe(2);
    const pin = must(kids.find((k) => ce.world.get(k, NotePin) !== undefined));
    expect(ce.world.get(pin, NotePin)?.day).toBe("2026-09-26");
    expect(ce.world.getRelation(pin, PinsNote)).toBe(note);
    expect(ce.world.get(must(kids[0]), CalendarEvent)?.start).toBe("2026-09-15");
    session().store.undo();
    step();
    expect(ce.world.getReverse(pad, ChildOf).length).toBe(1);
    session().store.undo();
    step();
    expect(pads.events(pad)).toEqual([]);
    session().store.redo();
    step();
    expect(pads.events(pad).length).toBe(1);
  });

  it("a pad deleted takes its children with it (core's cascade); ⌘Z brings them back with it", () => {
    const { ce, step, session, pad, pads } = desk();
    guardedTransaction(session().store, ce.world, (tx) => { addEvent(tx, pad, { start: "2026-09-02", text: "dentist" }); });
    step();
    session().store.transaction((tx) => { cascadeDestroy(tx, ce.world, pad); });
    step();
    expect(ce.world.isAlive(pad)).toBe(false);
    expect(pads.events(pad)).toEqual([]);
    session().store.undo();
    step();
    let back: Entity | undefined;   // an undone delete brings the pad back as a new runtime entity: found by its type
    ce.world.query(padsQ).each((b) => { for (const r of b) { const e = b.entity(r); if (ce.world.get(e, PrefabId)?.id === CALENDAR_TYPE) back = e; } });
    back = must(back);
    expect(pads.events(back).map((e) => e.text)).toEqual(["dentist"]);
  });
});

describe("the pad's mirror, ring, presences and slots", () => {
  const s = { camX: -600 / 0.42, camY: -400 / 0.42, zoom: 0.42 };
  const c: Pad = { x: 0, y: 0 };
  it("hit through the desk eye at the pad's face: the tape is the pad (`frame` — it carries it), the paper is not taken, past it nothing", () => {
    const G = kind.resolve(ctxOf(c, s));
    expect(kind.hit(G, 0, -PAD.H / 2 + PAD.T / 2)).toBe("frame");
    expect(kind.hit(G, 0, 0)).toBeNull();
    expect(kind.hit(G, 0, -PAD.H / 2 - 40)).toBeNull();
    // lifted (held), its face stands 3 units higher: the eye sees it spread, and the hit follows the drawn face
    const held = kind.resolve(ctxOf(c, s, { flux: { ...FLUX_REST, lift: 1 } }));
    expect(held.lift).toBe(CALENDAR.lift);
    expect(held.rigid.t[2]).toBe(CALENDAR.lift);
  });

  it("the ring is the selection's and fades with the ghost (the lab's ring × (1 − fade)); the pad itself stays whole until it is gone", () => {
    expect(kind.resolve(ctxOf(c, s, { flux: { ...FLUX_REST, ring: 1 } })).ring).toBe(1);
    expect(kind.resolve(ctxOf(c, s, { flux: { ...FLUX_REST, ring: 1, fade: 0.25 } })).ring).toBe(0.25);
  });

  it("the print's presences are the product's: set on the root pass by the kind's local; slots are the pad's own, reused when a pad is forgotten", () => {
    const pass = new CalendarKind(null);
    const pads = must(kind.local)({ pass: () => pass }) as Pads;
    const ctx = ctxOf(c, s, { local: pads });
    kind.record(kind.resolve(ctx), ctx);
    expect(pass.alpha).toEqual(CALENDAR_LOOK.alpha);
    const second = kind.record(kind.resolve(ctxOf(c, s, { local: pads, entity: 32 as Entity })), ctxOf(c, s, { local: pads, entity: 32 as Entity }));
    expect(second.base.slot).toBe(2);
    expect(second.id).toBe(2);
    pads.forget?.(31 as Entity);
    expect(pads.state(33 as Entity).slot).toBe(0);
    expect(() => kind.record(kind.resolve(ctxOf(c, s)), ctxOf(c, s, { look: must(kind.theme)(PALETTE.light, "light") }))).toThrow(/calendars/);
  });

  it("tiles still to draw ask for a frame only while their pad DRAWS (D7): culled, the pad's waiting tiles are no reason; forgotten, they go with it", () => {
    // a print pass and a raster that spends 50 ms of the pads' clock a tile — past the frame's 6 ms budget after the first, so the
    // rest of the sheet waits (pending) frame after frame
    let t = 0;
    // (and the residency's doors, K6a: the tiles and the layer let go with the last pad)
    const printPass: PrintPass & { releaseTiles(): void; releaseLayer(): void; releaseTables(): void; releaseMeshes(): void; readonly tileBytes: number } = { layers: 160, uploadTile: () => {}, writeTileBytes: () => {}, writeTable: () => {}, releaseTiles: () => {}, releaseLayer: () => {}, releaseTables: () => {}, releaseMeshes: () => {}, tileBytes: 0 };
    const raster: PrintRaster = {
      hand: () => ({ face: { family: "Caveat", weight: 500 }, metrics: { ascent: 0.8, descent: 0.25, advance: (ch) => (ch === " " ? 0.3 : 0.5) } }),
      version: () => 1,
      measure: (_font, text) => text.length * 6,
      tile: (): TileSource => { t += 50; return {} as TileSource; },
      bytes: () => new Uint8Array(TILE_TEX * TILE_TEX * 4),
    };
    const pads = createPads({ pass: () => new CalendarKind(printPass as unknown as CalendarPass), print: raster }, { now: () => t });
    const s = { camX: 0 - PAD.W / 2, camY: 0 - PAD.H / 2, zoom: 0.5 };
    const ctx = ctxOf(c, s, { local: pads });
    const draw = (): void => { kind.record(kind.resolve(ctx), ctx); };
    draw();
    expect(pads.landed?.(31 as Entity)).toBe(1);   // tiles drawn for its sheet: a landing (D7)
    expect(pads.tick?.(t)).toBe(true);   // the first frame's marks and tiles
    draw();
    expect(pads.tiles().pending).toBeGreaterThan(0);
    expect(pads.tick?.(t)).toBe(true);   // the CONTROL: tiles waiting on a pad that draws — another frame, rightly
    // the pad is culled: the frames after resolve nothing of it, and its waiting tiles are nobody's reason
    expect(pads.tick?.(t)).toBe(false);
    expect(pads.tick?.(t)).toBe(false);
    // drawn again, then forgotten in the same frame: its waiting tiles go with it
    draw();
    expect(pads.tiles().pending).toBeGreaterThan(0);
    pads.forget?.(31 as Entity);
    expect(pads.tiles().pending).toBe(0);
    expect(pads.tick?.(t)).toBe(false);
  });
});

describe("the calendar's CLOCK SEAM (D7): today, the zone, the month no one chose", () => {
  const s = { camX: -600 / 0.42, camY: -400 / 0.42, zoom: 0.42 };
  const at = (iso: string): number => Date.parse(iso);

  it("a pad spawned with no month shows the month of ITS today — the pad's clock, a still's pinned day — never a literal", () => {
    // spawned with no month, the durable month is '' — none chosen
    const ce = createCanvasEngine({ widgets: [Calendar] });
    ce.docs.create();
    const spawned = ce.ops.spawnWidget(CALENDAR_TYPE, { x: 0, y: 0, undoable: false });
    ce.step(16);
    const month = Calendar.groups.map((g) => ce.world.get(spawned, g.component as never) as { month?: string } | undefined).find((v) => v?.month !== undefined)?.month;
    expect(month).toBe("");
    // a pad met with no month — its clock at each moment, a fresh pad each (a pad already shown TURNS to a new month, animated)
    const padAt = (wall: number, today?: string): Pads => { const pads = createPads({ pass: () => undefined }, { now: () => wall, zone: "UTC" }); if (today !== undefined) pads.pinToday(today); return pads; };
    const unrolled = (pads: Pads): number => kind.resolve(ctxOf({ x: 0, y: 0 }, s, { local: pads, props: { month: "", weekStart: 1, tape: "ink", pen: "felt" } })).base;
    expect(unrolled(padAt(at("2026-11-05T12:00:00Z")))).toBe(monthOfDay(dayOfKey("2026-11-05")));
    expect(unrolled(padAt(at("2027-02-01T08:00:00Z")))).toBe(monthOfDay(dayOfKey("2027-02-01")));   // the clock's month, whatever it is
    expect(unrolled(padAt(at("2027-02-01T08:00:00Z"), "2026-09-24"))).toBe(monthOfDay(dayOfKey("2026-09-24")));   // a still's pinned day
    // a month CHOSEN stands
    expect(kind.resolve(ctxOf({ x: 0, y: 0, month: "2026-03" }, s, { local: padAt(at("2026-11-05T12:00:00Z")) })).base).toBe(monthOfDay(dayOfKey("2026-03-01")));
  });

  it("today turns over at midnight — a frame is asked for it (the ring, the ticks), on the pad's own clock; a pinned today never turns", () => {
    let wall = at("2026-09-24T23:59:58Z");
    const pads = createPads({ pass: () => undefined }, { now: () => wall, zone: "UTC" });
    pads.tick?.(0);
    expect(pads.today()).toBe(dayOfKey("2026-09-24"));
    wall += 1500;   // 23:59:59.5 — the same day
    expect(pads.tick?.(16)).toBe(false);
    wall += 1500;   // 00:00:01 on the 25th
    expect(pads.tick?.(32)).toBe(true);
    expect(pads.today()).toBe(dayOfKey("2026-09-25"));
    wall += 1500;
    expect(pads.tick?.(48)).toBe(false);   // once
    pads.pinToday("2026-09-24");
    pads.tick?.(64);   // the pin's own frame
    wall += 86_400_000;
    expect(pads.tick?.(80)).toBe(false);
    expect(pads.today()).toBe(dayOfKey("2026-09-24"));
  });

  it("the ZONE a day is reckoned in: the same moment is the 26th in Los Angeles and the 27th in Tokyo — today's, and the Moon's days on the print; a still pins it", () => {
    const moment = at("2026-09-27T05:30:00Z");
    expect(dayIn(moment, "America/Los_Angeles")).toBe(dayOfKey("2026-09-26"));
    expect(dayIn(moment, "Asia/Tokyo")).toBe(dayOfKey("2026-09-27"));
    const pads = createPads({ pass: () => undefined }, { now: () => moment, zone: "Asia/Tokyo" });
    expect(pads.today()).toBe(dayOfKey("2026-09-27"));
    pads.pinZone("America/Los_Angeles");
    expect(pads.today()).toBe(dayOfKey("2026-09-26"));
    pads.pinZone(null);
    expect(pads.today()).toBe(dayOfKey("2026-09-27"));
  });
});
