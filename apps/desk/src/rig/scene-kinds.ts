// The D3w kinds in a STILL — the oracle's scenes (packages/desk/oracle/scenes.mjs) spawned INTO THE WORLD:
// the whiteboards with their strokes as DATA CHILDREN (entities `ChildOf` the board, laid in one
// non-undoable transaction after the spawn), the prints, the notebooks, the desk calendars — in the
// ORACLE'S paint order (frame.mjs `deskInputs`: the mini mats, then the pads, then the things — the scene's
// own `things` list where it gives one, else the whiteboards, the notes, the prints, the notebooks). The
// poses a still pins (a print held, a book open or tilted, a pad mid-roll) are FLUX PINS on the kinds' own
// state (D-D2a-world.5: never a Grab), set by setScene after the spawn.

import { type CanvasEngine, type Entity, guardedTransaction } from "@ice/core";
import type { DeskLayerHandle } from "@ice/desk";
import { type BookPose, type Books, type PadPose, type Pads, type PhotoPose, printRect, type Prints, RGBA_TYPE } from "@ice/desk";
import { addEvent, addStroke, BOARD_TYPE, Calendar, CALENDAR_TYPE, daySlot, monthKeyOf, monthOfKey, Notebook, NOTEBOOK_TYPE, PHOTO_TYPE, pinNote, type StrokeSpec } from "@ice/objects";
import { BLANK_SHEET, type CommittedSheet, type PrintMeta, PRINT_ZONE, printSheetOf } from "@ice/desk/oracle/prints.mjs";
import photoMetaUrl from "@ice/desk/oracle/fixtures/assets/photo-1.json?url";
import photoUrl from "@ice/desk/oracle/fixtures/assets/photo-1.rgba?url";
import { BOARD } from "@ice/desk";
import { deskBlobs } from "../blobs";
import { bytesOf } from "../fixtures";
import type { PrintFixture } from "../rig-door";
import type { SpawnSpec } from "../scene";
import type { OracleNote } from "./stage";

export interface OracleStroke {
  readonly ink?: string;
  readonly tip?: string;
  readonly erase?: boolean;
  readonly points: readonly (readonly [number, number])[];
  readonly speed?: number;
  /** Each sample's time, ms from the first (D3t-a — a stroke laid by hand). */
  readonly times?: readonly number[];
}
export interface OracleBoard {
  readonly x: number;
  readonly y: number;
  readonly w?: number;
  readonly h?: number;
  readonly cap?: string;
  readonly tip?: string;
  readonly selected?: boolean;
  readonly held?: boolean;
  readonly strokes?: readonly OracleStroke[];
  /** A stroke just lifted, WET — laid live and committed wet, not (yet) a child (D3t-a; the kind's `sketch`). */
  readonly wet?: OracleStroke;
  /** A stroke MID-DRAW: its first `upto` samples in the stroke layer (D3t-a). */
  readonly live?: OracleStroke & { readonly upto: number };
}

/** A print as the photo lab's `addRGBA` leaves it, its pose pinned (scenes.mjs `PRINT`, `HELD`, `STACK`): `picture: null` = its paper alone. */
export interface OraclePrint {
  readonly x: number;
  readonly y: number;
  readonly angle?: number;
  readonly height?: number;
  readonly sx?: number;
  readonly sy?: number;
  readonly bend?: number;
  readonly ax?: number;
  readonly ay?: number;
  readonly hold?: { readonly gx: number; readonly gy: number; readonly px: number; readonly py: number };
  readonly picture?: string | null;
  readonly selected?: boolean;
}

/** A notebook as the lab's `makeBook` takes a spec (scenes.mjs `nb()`): where, its cover and seed, and the still's pins. */
export interface OracleBook {
  readonly x: number;
  readonly y: number;
  readonly angle?: number;
  readonly cover?: string;
  readonly ruling?: string;
  readonly seed?: number;
  readonly sheets?: number;
  readonly open?: boolean | number;
  readonly left?: number;
  readonly turn?: { readonly dir: 1 | -1; readonly phi: number; readonly psi: number; readonly twist?: number };
  readonly peek?: number;
  readonly held?: boolean;
  readonly tilt?: readonly [number, number];
  readonly selected?: boolean;
  /** Its pages' writing (D3t-b): strokes on pages — each laid as a `desk.stroke` child of the book. */
  readonly ink?: readonly OracleBookInk[];
}

/** A stroke on a notebook's page as a scene states it (scenes.mjs `BOOK_INK`): its page, its pen, its path in page units, each sample's time. */
export interface OracleBookInk {
  readonly page: number;
  readonly pen?: string;
  readonly points: readonly (readonly [number, number])[];
  readonly times?: readonly number[];
  readonly speed?: number;
}

/** A desk's thing as the oracle lists it (frame.mjs `thingsOf`). */
export type OracleThing =
  | ({ readonly kind: "note" } & OracleNote)
  | ({ readonly kind: "board" } & OracleBoard)
  | ({ readonly kind: "print" } & OraclePrint)
  | ({ readonly kind: "book" } & OracleBook);

/** A desk calendar as the lab's `reset` + `pose` take one (scenes.mjs `pad()`): where, which month, the week's start, a roll pinned part-way. */
export interface OraclePad {
  readonly x: number;
  readonly y: number;
  readonly month?: string;
  readonly weekStart?: 0 | 1;
  readonly pose?: { readonly dir?: 1 | -1; readonly p?: number; readonly tilt?: number; readonly peek?: number };
  readonly tape?: string;
  readonly pen?: string;
  readonly selected?: boolean;
  readonly held?: boolean;
  /** Its entries (D3t-c): laid as its data children, one non-undoable transaction — the print draws them. */
  readonly events?: readonly { readonly start: string; readonly end?: string; readonly text: string; readonly ink?: string }[];
  /** Today pinned for the still (the print rings it and ticks the days before it). */
  readonly today?: string;
  /** The COMMITTED print by month (`YYYY-MM` → a fixture's name, oracle/prints.mjs): pinned as both hosts draw it; a month it names none of is blank. */
  readonly print?: Readonly<Record<string, string>>;
  /** Draw the LIVE print instead of a committed one (the fixture tool's and the live check's). */
  readonly livePrint?: boolean;
}

/** The scene fields the D3w kinds read. */
export interface KindScene {
  readonly boards?: readonly OracleBoard[];
  readonly notes?: readonly OracleNote[];
  readonly prints?: readonly OraclePrint[];
  readonly books?: readonly OracleBook[];
  readonly calendars?: readonly OraclePad[];
  readonly things?: readonly OracleThing[];
}

/**
 * The scene's things in the oracle's paint order: its own list, else the whiteboards, the notes, the prints, the notebooks —
 * and a note stuck to a pad's day (`pin: { pad, day }`) lies where the pad snaps it: its day's slot (`daySlot`, the lab's `slotOf`).
 */
export function thingsOf(s: KindScene): OracleThing[] {
  const list: OracleThing[] = s.things !== undefined ? [...s.things] : [
    ...(s.boards ?? []).map((b) => ({ ...b, kind: "board" as const })),
    ...(s.notes ?? []).map((n) => ({ ...n, kind: "note" as const })),
    ...(s.prints ?? []).map((p) => ({ ...p, kind: "print" as const })),
    ...(s.books ?? []).map((b) => ({ ...b, kind: "book" as const })),
  ];
  return list.map((t) => {
    const pin = t.kind === "note" ? (t as { pin?: { pad?: number; day: string } }).pin : undefined;
    if (pin === undefined) return t;
    const pad = (s.calendars ?? [])[pin.pad ?? 0];
    if (pad === undefined) throw new Error(`desk: a note pinned to pad ${pin.pad ?? 0}, which the scene does not lay`);
    return { ...t, ...daySlot(pad.x, pad.y, pin.day, pad.weekStart ?? 1) };
  });
}

/** A desk calendar as a spawn: its sheet centred where the scene says; September 2026 from Monday unless it says. */
export const padSpec = (c: OraclePad): SpawnSpec => ({ type: CALENDAR_TYPE, cx: c.x, cy: c.y, w: Calendar.defaultSize.w, h: Calendar.defaultSize.h, props: { month: c.month ?? "2026-09", weekStart: c.weekStart ?? 1, tape: c.tape ?? "ink", pen: c.pen ?? "felt" } });

/** A pad's still — a month rolling part-way, the corner's peek — pinned on the calendar kind's state (a FLUX pin, never a Grab). */
export function pinPads(handle: DeskLayerHandle, pads: readonly { readonly entity: Entity; readonly spec: OraclePad }[]): void {
  const local = handle.local("calendar") as Pads | undefined;
  for (const { entity, spec: c } of pads) {
    const q = c.pose;
    if (q === undefined) continue;
    const pose: PadPose = q.p !== undefined ? { roll: { dir: q.dir ?? 1, p: q.p, ...(q.tilt !== undefined ? { tilt: q.tilt } : {}) } } : { ...(q.peek !== undefined ? { peek: q.peek } : {}) };
    local?.pin(entity, pose);
  }
}

/** The pads' entries (D3t-c): an EVENT entity each, a child of its pad — one non-undoable transaction, in the scene's order. */
export function layEvents(engine: CanvasEngine, pads: readonly { readonly entity: Entity; readonly spec: OraclePad }[]): number {
  const all = pads.flatMap((p) => (p.spec.events ?? []).map((e) => ({ pad: p.entity, e })));
  if (all.length === 0) return 0;
  const session = engine.docs.current();
  if (session === undefined) throw new Error("desk: no document");
  guardedTransaction(session.store, engine.world, (tx) => { for (const { pad, e } of all) addEvent(tx, pad, { start: e.start, ...(e.end !== undefined ? { end: e.end } : {}), text: e.text, ...(e.ink !== undefined ? { ink: e.ink } : {}) }); }, { undoable: false });
  return all.length;
}

/** The committed prints, fetched and inflated once (oracle/prints.mjs — the same bytes the Node oracle reads from disk). */
const committed = new Map<string, Promise<CommittedSheet>>();
function committedPrint(name: string): Promise<CommittedSheet> {
  let p = committed.get(name);
  if (p === undefined) {
    const base = new URL(`../../../packages/desk/oracle/fixtures/assets/${name}`, location.href).href;
    p = (async () => {
      const [meta, bin] = await Promise.all([fetch(`${base}.json`).then((r) => { if (!r.ok) throw new Error(`${name}.json: ${r.status}`); return r.json() as Promise<PrintMeta>; }), fetch(`${base}.bin`).then((r) => { if (!r.ok) throw new Error(`${name}.bin: ${r.status}`); return r.blob(); })]);
      const bytes = new Uint8Array(await new Response(bin.stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
      return printSheetOf(meta, bytes);
    })();
    committed.set(name, p);
  }
  return p;
}

/**
 * The pads' prints for a still (D3t-c): today pinned; each month the pad may show (its own, the one before, the one after) pinned
 * with the COMMITTED print the scene names, else BLANK — every pad before D3t-c drew its paper and grid alone, as the Node oracle
 * still does — unless the scene asks for the live print.
 */
export async function pinPadPrints(handle: DeskLayerHandle, pads: readonly { readonly entity: Entity; readonly spec: OraclePad }[]): Promise<void> {
  const local = handle.local("calendar") as Pads | undefined;
  if (local === undefined) return;
  const today = pads.find((p) => p.spec.today !== undefined)?.spec.today ?? null;
  local.pinToday(today);
  // …and the zone the committed prints were drawn in, beside it (D7): the Moon's days on a live print are then the same anywhere
  local.pinZone(today === null ? null : PRINT_ZONE);
  for (const { entity, spec } of pads) {
    if (spec.livePrint === true) continue;
    const shown = monthOfKey(spec.month ?? "2026-09") ?? 0;
    for (const m of [shown - 1, shown, shown + 1]) {
      const name = spec.print?.[monthKeyOf(m)];
      local.pinPrint(entity, m, name === undefined ? BLANK_SHEET : await committedPrint(name));
    }
  }
}

/** The scene's notes stuck to days: a PIN entity each, a child of its pad holding the note — one non-undoable transaction. */
export function layPins(engine: CanvasEngine, pads: readonly Entity[], notes: readonly { readonly entity: Entity; readonly spec: OracleNote }[]): number {
  const pinned = notes.flatMap((n) => { const pin = (n.spec as { pin?: { pad?: number; day: string } }).pin; return pin === undefined ? [] : [{ note: n.entity, pad: pads[pin.pad ?? 0], day: pin.day }]; });
  if (pinned.length === 0) return 0;
  const session = engine.docs.current();
  if (session === undefined) throw new Error("desk: no document");
  guardedTransaction(session.store, engine.world, (tx) => { for (const p of pinned) if (p.pad !== undefined) pinNote(tx, p.pad, p.note, p.day); }, { undoable: false });
  return pinned.length;
}

/** A notebook as a spawn: the closed case centred where the scene says; its spread durable, its seed 7 and its cover orbit unless the scene says. */
export function bookSpec(b: OracleBook): SpawnSpec {
  if (b.sheets !== undefined) throw new Error("desk: a notebook of another thickness is not a desk object yet");
  return { type: NOTEBOOK_TYPE, cx: b.x, cy: b.y, w: Notebook.defaultSize.w, h: Notebook.defaultSize.h, props: { cover: b.cover ?? "orbit", ruling: b.ruling ?? "dots", seed: b.seed ?? 7, spread: b.left ?? 0, angle: b.angle ?? 0 } };
}

/** A book's still — open, a sheet mid-turn, the peek, the tilt — pinned on the notebook kind's state (a FLUX pin, never a Grab). */
export function pinBooks(handle: DeskLayerHandle, books: readonly { readonly entity: Entity; readonly spec: OracleBook }[]): void {
  const local = handle.local("notebook") as Books | undefined;
  for (const { entity, spec: b } of books) {
    const pose: BookPose = { ...(b.open !== undefined ? { open: b.open } : {}), ...(b.turn !== undefined ? { turn: b.turn } : {}), ...(b.peek !== undefined ? { peek: b.peek } : {}), ...(b.tilt !== undefined ? { tilt: b.tilt } : {}) };
    if (Object.keys(pose).length > 0) local?.pin(entity, pose);
  }
}

/** The committed picture (tools/make-photo-fixture.mjs) as the scenes' prints name it: its bytes in the app's store, its size. */
export type { PrintFixture };
let fixture: Promise<{ readonly bytes: Uint8Array<ArrayBuffer>; readonly w: number; readonly h: number }> | null = null;
/** The fixture put in the desk's BlobStore and PRELOADED on the photo kind — so the scene's first frame has its picture. */
export async function printFixture(handle: DeskLayerHandle): Promise<PrintFixture> {
  fixture ??= Promise.all([bytesOf(photoUrl), fetch(photoMetaUrl).then((r) => r.json() as Promise<{ w: number; h: number }>)]).then(([bytes, meta]) => ({ bytes, w: meta.w, h: meta.h }));
  const f = await fixture;
  const hash = await deskBlobs.put(f.bytes, RGBA_TYPE);
  await (handle.local("photo") as Prints | undefined)?.preload(hash, f.w, f.h);
  return { hash, w: f.w, h: f.h };
}

/** A print as a spawn: centred where the scene says, its extent the picture's aspect (the f32 `Size` the world keeps, so the centre is exact). */
export function printSpec(p: OraclePrint, fx: PrintFixture): SpawnSpec {
  const r = printRect(p.x, p.y, fx.w, fx.h);
  if (p.picture !== undefined && p.picture !== null && p.picture !== "photo-1") throw new Error(`desk: no picture "${p.picture}" (the fixture is photo-1)`);
  return { type: PHOTO_TYPE, cx: r.cx, cy: r.cy, w: r.w, h: r.h, props: { blob: p.picture === null ? "" : fx.hash, width: fx.w, height: fx.h, angle: p.angle ?? 0 } };
}

/** A print's still: its pose pinned on the photo kind's body — a FLUX pin, never a Grab (D-D2a-world.5). */
export function pinPrints(handle: DeskLayerHandle, prints: readonly { readonly entity: Entity; readonly spec: OraclePrint }[]): void {
  const local = handle.local("photo") as Prints | undefined;
  for (const { entity, spec: p } of prints) {
    const pose: PhotoPose = {
      ...(p.height !== undefined ? { h: p.height } : {}), ...(p.sx !== undefined ? { sx: p.sx } : {}), ...(p.sy !== undefined ? { sy: p.sy } : {}),
      ...(p.bend !== undefined ? { bend: p.bend } : {}), ...(p.ax !== undefined ? { ax: p.ax } : {}), ...(p.ay !== undefined ? { ay: p.ay } : {}),
      ...(p.hold !== undefined ? { hold: p.hold } : {}),
    };
    if (Object.keys(pose).length > 0) local?.pin(entity, pose);
  }
}

/** A whiteboard as a spawn: the bench's size, its capped marker black and bullet unless the scene says. */
export const boardSpec = (b: OracleBoard): SpawnSpec => ({ type: BOARD_TYPE, cx: b.x, cy: b.y, w: b.w ?? BOARD.spec.width, h: b.h ?? BOARD.spec.height, props: { cap: b.cap ?? "black", tip: b.tip ?? "bullet" } });

/** The boards' strokes laid as their children — the bench's `sketch` order — in ONE non-undoable transaction (a scene is not an edit). */
/** A scene's stroke as the data states one (its samples' times too, D3t-a). */
export const strokeSpecOf = (s: OracleStroke): StrokeSpec => ({ points: s.points, ...(s.ink !== undefined ? { ink: s.ink } : {}), ...(s.tip !== undefined ? { tip: s.tip as "bullet" } : {}), ...(s.erase ? { erase: true } : {}), ...(s.speed !== undefined ? { speed: s.speed } : {}), ...(s.times !== undefined ? { times: s.times } : {}) });

/** The books' writing laid as their children (D3t-b) — each stroke on its page, the pen's — in ONE non-undoable transaction (a scene is not an edit). */
export function layBookInk(engine: CanvasEngine, books: readonly { readonly entity: Entity; readonly spec: OracleBook }[]): number {
  const inked = books.filter((b) => (b.spec.ink ?? []).length > 0);
  if (inked.length === 0) return 0;
  const session = engine.docs.current();
  if (session === undefined) throw new Error("desk: no document");
  let n = 0;
  guardedTransaction(session.store, engine.world, (tx) => {
    for (const { entity, spec } of inked) {
      for (const s of spec.ink ?? []) {
        addStroke(tx, entity, { tool: "pen", page: s.page, ink: s.pen ?? "fountain", points: s.points, ...(s.times !== undefined ? { times: s.times } : {}), ...(s.speed !== undefined ? { speed: s.speed } : {}) });
        n += 1;
      }
    }
  }, { undoable: false });
  return n;
}

export function layStrokes(engine: CanvasEngine, boards: readonly { readonly entity: Entity; readonly spec: OracleBoard }[]): number {
  const session = engine.docs.current();
  if (session === undefined) throw new Error("desk: no document");
  let n = 0;
  const inked = boards.filter((b) => (b.spec.strokes ?? []).length > 0);
  if (inked.length === 0) return 0;
  guardedTransaction(session.store, engine.world, (tx) => {
    for (const { entity, spec } of inked) {
      for (const s of spec.strokes ?? []) {
        addStroke(tx, entity, strokeSpecOf(s));
        n += 1;
      }
    }
  }, { undoable: false });
  return n;
}
