// The NOTEBOOK (NOTEBOOK.md) as a kind (kind.ts): the real 3D book behind the registry's door — a
// thin adapter, the pass and its WGSL as they were. Stratum `things`, registered `composite`: the
// pass renders EVERY book into a layer of its own in `prepare` — each book's shadow map, then the 4×
// layer (the books, then the mat under them), recorded into the frame's encoder after the mat's wind —
// and its one run is the layer laid over the frame, after every other run of the stratum (the
// prototype's "books above everything": its lab drew them in a command buffer of their own after the
// ground's). The composite lays every book at once, so a thing laid ON a notebook still draws under it:
// interleaving books among other things needs a layer per run of books (design-015 §4.2 — D-D4's
// exception, named, D-D3r-b.2). The desk eye (eye.ts) is the slot's view's; the law and the ruling's
// ink are the host's (a lab's panel edits the law; the ink is the product's colour — the theme gate).
// ROOT ONLY (D-D18): a spawned slot's pass draws nothing (kinds/layer.ts).
//
// And its WORLD half (kinds/world.ts; D3w): `notebookKind` — an entity of the notebook's widget type becomes a
// `NotebookDraw` exactly as the lab's `makeBook` → `resolveBooks` → `drawBooks` makes one: its motion from the
// durable spread (`spread` sheets turned onto the left) and a still's FLUX pin (open, a sheet mid-turn, the
// peek, the tilt — the kind's own state, never a Grab), its lift the builder's (held ← Grab: 30 units through
// the desk eye, the hover's 3.5), its ring the selection's — never under a lifted or an open book —, its tilt
// into the carry's motion (the rect's velocity, sprung), its mesh rebuilt only when its pose moves. Its hit is
// `pickNotebook`: the eye's ray through the SAME desk eye the pass draws with (the geometry carries it), into
// the case or a page — `content` either way (the parts, the turn zones and the pen, are D3t's). Its colours
// are the product's (`theme()`: the covers, the page, the ruling's ink — set on the root pass by the kind's
// local, the theme gate). A deleted book is gone at once (NOTEBOOK.md: instant) — its ghost draws nothing.
//
// IN HAND (D3t-b — NOTEBOOK.md §6–8 on D3t-a's seam): the book's sheets are a MOTION the kind keeps from frame to frame
// while it is held (the cover stays the hand's spring, D4b): the spread the document says — or the one the hand asked for,
// until its transaction lands — is where the sheets go, one sheet a frame (a run of turns fans), their springs stepped here;
// the peek and a sheet in the hand are the hand's (objects/leaf.ts). Its hit answers PARTS in hand: a page's outer 30 % —
// `turn`; the rest of a page that takes ink — `content`, the pen's; the case and the endpapers — `frame`. Its INK is a cache
// of its strokes (data children `desk.stroke` with their `page`, board/data.ts): the pass's eight layers handed out LRU to the
// pages in view (notebook/pages.ts), each page replayed from its strokes, the pen's live stroke drawn into its page a segment
// at a time and adopted when it lands. Its held bar: ‹ › (the arrow keys — a count of turns the hand turns by), the four pens
// (the note's, `1`–`4`: the tool in hand), undo (⌘Z) and redo (⇧⌘Z) — the document's history over its strokes.

import { defineComponent, type Entity, field, type HeldToolApi, type HeldToolDef } from "@ice/core";
import { BoardStroke, decodePoints, decodeTimes, inking, type StrokeRow, type MatPass, type MarkFrame, type DeskEye, eyeOf, type BuiltMesh, MeshWriter, lampDir, type Rigid, rigidOf, type ShaderText, settled, spring, HOLD, readingTarget, LayeredKind, LAYER_IDLE_MS } from "@ice/desk/kit";
import { type KindPass, type KindProgram, type SlotContext, MAT_COLORS, type Palette, type RGB, type RGBA, rgb, type ThemeName, type TokenRef, type KindHost, type KindLocal, numberProp, type ObjectContext, type ObjectHit, type ObjectKind, stringProp } from "@ice/desk";
import { NOTEBOOK, type NotebookLaw } from "./law";
import { type NotebookLook, type Ruling, RULINGS } from "./layout";
import { buildMesh } from "./mesh";
import { inkPoints, pageOfSide, pagesInView } from "./ink";
import { newMotion, type NotebookMotion, poseKey, poseOf, setOpen, stepLeaves, tiltToward, turnable, turnPage, withDesk } from "./motion";
import { type InkTable, type LiveStroke, PageInk, type PageStroke, pageStrokeKey } from "./pages";
import { type NotebookDraw, NotebookPass } from "./pass";
import { type NotebookHit, pickNotebook } from "./pick";
import { NOTEBOOK_SHADER_FILES, notebookShaders } from "./shaders";
import { coverFrame, type Frame, frameOf, type NotebookPose, relaxOf, specOf, swingOf } from "./shape";
import { shaderText } from "../shaders";

/** The notebook's kind name — its key in the registry and in every slot's `objects`. */
export const NOTEBOOK_KIND = "notebook";

/** No ink: what the knobs carry while no book draws (a host sets `ruleInk` before one does). */
const NO_INK: RGBA = [0, 0, 0, 0];

export class NotebookKind extends LayeredKind<NotebookDraw, NotebookPass> {
  /** The notebook's law — its eye, its light and shadow, its lift: the host's (a lab's panel edits it); `NOTEBOOK` until one says. */
  law: NotebookLaw = NOTEBOOK;
  /** The ruling's ink and its presence on the page — the PRODUCT's colour (the theme gate): a host sets it before a book draws. */
  ruleInk: RGBA | null = null;

  /** Root only (D-D18): a spawned slot's pass — a mini mat's inside, a flight's departed desk — holds nothing and draws nothing. */
  spawn(_mat: MatPass): NotebookKind { return new NotebookKind(null); }

  /**
   * A slot's own pass of this kind takes the ROOT's host-set state before it prepares (its law and the ruling's ink): a spawned pass draws nothing, but a
   * slot that made its own from the program — the tray's specimen (design-017 §8, K5a) — draws with the desk's.
   */
  tune(root: KindPass<unknown>): void { if (root instanceof NotebookKind && root !== this) { this.law = root.law; this.ruleInk = root.ruleInk; } }

  /** The pass's own `prepare`, as the prototype's lab called it: the slot's camera, grid, clocks and light, the desk eye over the slot's view, the law, the colours. */
  protected prepareOwn(pass: NotebookPass, s: SlotContext, records: readonly NotebookDraw[]): number {
    // the host's ink, else a record's own look's (made without the desk's local — a tray specimen, K5a): never none
    const rule = this.ruleInk ?? records.find((r) => r.rule !== undefined)?.rule ?? null;
    if (records.length > 0 && !rule) throw new Error("notebook: the ruling's ink is the host's (the theme gate) — set the kind's `ruleInk` before a book draws");
    const v = s.view;
    const eye = eyeOf({ x: v.camX, y: v.camY, zoom: v.zoom }, { width: v.width, height: v.height }, this.law.eye);
    // a deleted book is gone at once (D3w: its ghost's record is marked, never drawn)
    const shown = records.some((r) => VANISHED.has(r)) ? records.filter((r) => !VANISHED.has(r)) : records;
    return pass.prepare(v, s.fadeIn, s.cfg, s.frame, s.light, eye, this.law, { cast: MAT_COLORS.cast, select: s.select, ruleInk: rule ?? NO_INK }, shown);
  }
}

/** The records of books being deleted: NOTEBOOK.md's delete is instant, so a ghost's record is kept out of the pass. */
const VANISHED = new WeakSet<NotebookDraw>();

/** The notebook's program for a host's shader text: its pass made on the root's mat; its objects one composite run, last in `things`. */
export function notebookProgram(text: ShaderText): KindProgram<NotebookDraw> {
  return {
    name: NOTEBOOK_KIND,
    stratum: "things",
    composite: true,
    create: async (device, format, mat) => new NotebookKind(await NotebookPass.create(device, format, notebookShaders(text), mat)),
  };
}

// ---------------------------------------------------------------- the world half (D3w)

/**
 * What the notebook's kind takes from the host's palette (NOTEBOOK.md's covers): the page, the ruling's ink and its
 * presence, and each cover by name — its cloth, band, three accents, endpaper, its design and whether it is paper. Its
 * pens' inks (D3t-b) are the note's — the palette's `pens` (kinds/paper.ts `PaperPalette`), by name.
 */
export interface NotebookPalette extends Palette {
  readonly notebooks?: {
    readonly paper: TokenRef;
    readonly ink: TokenRef;
    /** The ruling's presence on the page (the dots, the rules), 0 … 1. */
    readonly rule: number;
    readonly covers: Readonly<Record<string, { readonly cloth: TokenRef; readonly band: TokenRef; readonly a: TokenRef; readonly b: TokenRef; readonly c: TokenRef; readonly endpaper: TokenRef; readonly design: NotebookLook["design"]; readonly paperCover: boolean }>>;
  };
  readonly pens?: Readonly<Record<string, TokenRef>>;
}

/** The notebook's look for a theme, parsed: each cover's `NotebookLook`, the ruling's ink with its presence; the pens' inks (sRGB) and each pen tool's swatch (D3t-b). */
export interface NotebookObjectLook {
  readonly covers: Readonly<Record<string, NotebookLook>>;
  readonly ruleInk: RGBA;
  readonly pens: Readonly<Record<string, RGB>>;
  readonly swatches: Readonly<Record<string, string>>;
}

/** A book's still, pinned on the kind's own state (a FLUX pin — D-D2a-world.5): open (or a swing, 0 … 1), a sheet mid-turn, the peek, the tilt. */
export interface BookPose {
  readonly open?: boolean | number;
  readonly turn?: { readonly dir: 1 | -1; readonly phi: number; readonly psi: number; readonly twist?: number };
  readonly peek?: number;
  readonly tilt?: readonly [number, number];
}

/** A book as the builder resolved it: what its record draws, and what its hit reads — the same eye the pass draws with. */
export interface NotebookGeometry {
  readonly frame: Frame;
  readonly pose: NotebookPose;
  readonly mesh: BuiltMesh;
  readonly version: number;
  readonly rigid: Rigid;
  readonly lamp: readonly [number, number, number];
  readonly theta: number;
  readonly ring: number;
  readonly eye: DeskEye;
  readonly fade: number;
  /** Where it lies: the case's centre on the mat and its turn (the placement's, before the lift and the tilt). */
  readonly cx: number;
  readonly cy: number;
  readonly angle: number;
  /** In hand (D3t-b): its hit answers parts — a turn, the pen's page, the case. */
  readonly held: boolean;
  /** Its pages can turn (open, the cover landed) — the turn parts exist only then. */
  readonly turnable: boolean;
  /** The law it was resolved under (the hit, the hand's pick). */
  readonly law: NotebookLaw;
}

/** The notebook's own state on one desk: each book's id, mesh and pinned pose, the carry's tilt; the ruling's ink on the root pass; in hand (D3t-b) its sheets' motion, the pen's stroke and the pages' ink. */
export interface Books extends KindLocal {
  /** When the kind is next live (K7a — `KindLocal.due`, declared: the six built-ins all say). */
  due(now: number): number;
  /** A still's pose on `e` (undefined unpins). */
  pin(e: Entity, pose: BookPose | undefined): void;
  /** The world half's: the book's pin and its tilt state. */
  state(e: Entity): BookState;
  /** The world half's: the mesh for a pose, rebuilt only when the pose moved. */
  meshFor(e: Entity, F: Frame, pose: NotebookPose, law: NotebookLaw): { readonly mesh: BuiltMesh; readonly version: number };
  /** The world half's: the ruling's ink on the root pass — the product's colour (the theme gate). */
  ink(rule: RGBA): void;
  /** The pages' ink on this desk — the pass's eight layers, a cache of the strokes (a witness's door: its replays, a page's raster). */
  readonly pages: PageInk;
  /** A book's strokes on a page as its raster draws them — the children's, in order, then the stroke the pen lifted until it lands. */
  strokesOn(e: Entity, page: number): readonly PageStroke[];
  /** The world half's: the ink table for a resolved book — its pages in view with ink, each on a layer, brought up to its strokes. */
  table(e: Entity, G: NotebookGeometry, look: NotebookObjectLook): InkTable;
  /** The pen (D3t-b): its stroke in hand on `e` — begun (its samples grow in place, laid a segment at a time) or dropped (null). */
  write(e: Entity, live: LiveStroke | null): void;
  /** The pen lifted its stroke, whose cell will read `key`: drawn to its end, then ADOPTED when its child lands (no replay). */
  lift(e: Entity, key: string): void;
  /** Its transaction was refused (a read-only document, the book gone): the page is its children's again. */
  refuse(e: Entity): void;
  /** The spread the hand asks for (a turn by hand, a click, a key), until its transaction lands; null — the document's again. */
  ask(e: Entity, spread: number | null): void;
  /** The hand moved the book's sheets (a sheet in the hand, the peek): the next frame builds. */
  stir(e: Entity): void;
  /** On a portrait phone, the page of the spread in view (D3t-b — page by page): 0 the right, 1 the left; sprung (the view glides to it). */
  face(e: Entity, side: 0 | 1): void;
}

interface BookState {
  readonly id: number;
  pose: BookPose | undefined;
  /** The carry's tilt (radians about x and y), sprung into the rect's motion; where the rect was. */
  tiltX: number; tiltXV: number; tiltY: number; tiltYV: number;
  lastX: number; lastY: number;
  /** The cover IN HAND (D4b): its swing 0 shut … 1 open on the hand's spring, and its velocity. */
  coverT: number; coverV: number;
  writer: MeshWriter | null;
  mesh: BuiltMesh | null;
  key: string;
  version: number;
  /** IN HAND (D3t-b): the sheets' motion, kept from frame to frame (null on the desk and in a still). */
  motion: NotebookMotion | null;
  /** The spread the hand asked for, until the document says it (null: the document's). */
  pending: number | null;
  /** The pen's stroke in hand, and the one it lifted until its child lands (with the page's stroke count at the lift). */
  live: LiveStroke | null;
  adopt: { readonly page: number; readonly stroke: PageStroke; readonly at: number } | null;
  /** The book's strokes by page, as of the children's stamp — and each decoded once (by `pageStrokeKey`), kept while it is the book's. */
  byPage: Map<number, PageStroke[]>;
  decoded: Map<string, PageStroke>;
  stamp: number;
  /** The last frame in hand moved a sheet or the peek, or has turns to go: the next asks a frame too. */
  stirring: boolean;
  /** The phone's page in view (0 the right … 1 the left), sprung toward `faceT`. */
  face: number; faceV: number; faceT: 0 | 1;
}

/** A stroke's cell → its samples with their widths, once per stroke (`had` — the book's last regroup — is asked first; a replay reads them again). */
function pageStrokeOf(row: StrokeRow, had: ReadonlyMap<string, PageStroke>, now: Map<string, PageStroke>): PageStroke {
  const ink = row.ink ?? "fountain";
  const points = row.points ?? "";
  const times = row.times ?? "";
  const speed = row.speed !== null && row.speed > 0 ? row.speed : 400;
  const key = pageStrokeKey(ink, points, times, speed);
  let st = now.get(key) ?? had.get(key);
  if (st === undefined) st = { key, ink, points: inkPoints(decodePoints(points), times !== "" ? decodeTimes(times) : null, speed) };
  now.set(key, st);
  return st;
}

/** The notebook's `local()`. */
export function createBooks(host: KindHost): Books {
  const books = new Map<Entity, BookState>();
  /** The root slot's pass (the layer's owner). */
  const rootPass = (): NotebookPass | undefined => { const k = host.pass(); return k instanceof NotebookKind ? (k.pass ?? undefined) : undefined; };
  /** What has LANDED on each object, counted (D7 — `KindLocal.landed`): the held desk copy is made again when a desk object's moves. */
  const landedOf = new Map<Entity, number>();
  const land = (e: Entity): void => { landedOf.set(e, (landedOf.get(e) ?? 0) + 1); };
  const pages = new PageInk(host.budget);   // its page rasters under the desk's one budget (D6)
  let next = 1;
  let woke = false;
  let moving = false;
  const state = (e: Entity): BookState => {
    let st = books.get(e);
    if (st === undefined) {
      st = {
        id: next++, pose: undefined, tiltX: 0, tiltXV: 0, tiltY: 0, tiltYV: 0, lastX: Number.NaN, lastY: Number.NaN, coverT: 0, coverV: 0, writer: null, mesh: null, key: "", version: 0,
        motion: null, pending: null, live: null, adopt: null, byPage: new Map(), decoded: new Map(), stamp: -1, stirring: false, face: 0, faceV: 0, faceT: 0,
      };
      books.set(e, st);
    }
    return st;
  };
  /** A book's pen strokes by page, regrouped whenever its children's stamp turns over. */
  const byPage = (e: Entity, st: BookState): Map<number, PageStroke[]> => {
    const stamp = host.children?.stamp(e) ?? 0;
    if (stamp === st.stamp) return st.byPage;
    const m = new Map<number, PageStroke[]>();
    const decoded = new Map<string, PageStroke>();
    for (const row of host.children?.rows(e, BoardStroke) ?? []) {
      const page = row.page ?? 0;
      if (row.tool !== "pen" || page < 1) continue;
      let list = m.get(page);
      if (list === undefined) { list = []; m.set(page, list); }
      list.push(pageStrokeOf(row, st.decoded, decoded));
    }
    st.byPage = m;
    st.decoded = decoded;
    st.stamp = stamp;
    return m;
  };
  const strokesOn = (e: Entity, page: number): readonly PageStroke[] => {
    const st = state(e);
    const rows = byPage(e, st).get(page) ?? [];
    const a = st.adopt;
    if (a === null || a.page !== page) return rows;
    // the stroke the pen lifted: its child has landed once the page lists it past where the page stood at the lift
    if (rows.findIndex((r, i) => i >= a.at && r.key === a.stroke.key) >= 0) { st.adopt = null; return rows; }
    return [...rows, a.stroke];
  };
  return {
    pin(e, pose) { state(e).pose = pose; woke = true; },
    state,
    meshFor(e, F, pose, law) {
      const st = state(e);
      const key = `${poseKey(pose)}#${F.spec.sheets}`;
      if (st.mesh === null || key !== st.key) {
        st.writer ??= new MeshWriter();
        st.mesh = buildMesh(st.writer, F, pose, law);
        st.key = key;
        st.version += 1;
      }
      return { mesh: st.mesh, version: st.version };
    },
    ink(rule) {
      const k = host.pass();
      if (!(k instanceof NotebookKind)) return;
      const had = k.ruleInk;
      if (had === null || had[0] !== rule[0] || had[1] !== rule[1] || had[2] !== rule[2] || had[3] !== rule[3]) k.ruleInk = rule;
    },
    pages,
    strokesOn,
    table(e, G, look) {
      const st = state(e);
      byPage(e, st);   // the strokes as of now, in view or not: the clock below compares the children's stamp with this one
      const inView = pagesInView(G.pose, swingOf(G.theta));
      const live = st.live;
      let t = NO_TABLE;
      if (inView.length > 0) {
        const k = host.pass();
        const up = k instanceof NotebookKind ? (k.pass ?? undefined) : undefined;
        const fallback: RGB = Object.values(look.pens)[0] ?? [look.ruleInk[0], look.ruleInk[1], look.ruleInk[2]];
        const replays = pages.replays;
        t = pages.table(st.id, inView, (p) => strokesOn(e, p), live, (ink) => look.pens[ink] ?? fallback, look, up, G.frame.Wo, G.frame.Hp);
        if (pages.replays !== replays) land(e);
      }
      // the lifted stroke drawn to its end (a page out of the table replays with it): from here the page lists it until its child lands
      if (live?.lifted === true) {
        st.adopt = { page: live.page, stroke: { key: live.key, ink: live.ink, points: live.points }, at: (byPage(e, st).get(live.page) ?? []).length };
        st.live = null;
      }
      return t;
    },
    write(e, live) {
      state(e).live = live;   // dropped (null): the page replays from its strokes at the next table
      moving = true;
    },
    lift(e, key) {
      const st = state(e);
      if (st.live === null) return;
      st.live.lifted = true;
      st.live.key = key;
      moving = true;
    },
    refuse(e) {
      const st = books.get(e);
      if (st === undefined) return;
      st.live = null;
      st.adopt = null;
      moving = true;
    },
    ask(e, spread) { state(e).pending = spread; moving = true; },
    stir() { moving = true; },
    face(e, side) { state(e).faceT = side; moving = true; },
    landed: (e) => landedOf.get(e) ?? 0,
    // K7a: next live now while a book in hand moves or writes (its tick's own test) or a turn, a stroke, a face was asked; when the
    // layer is made, LAYER_IDLE_MS after it was last drawn (it is let go then — at rest too); never otherwise
    due(now) {
      if (woke || moving) return now;
      for (const [e, st] of books) if (st.motion !== null && (st.live !== null || st.pending !== null || st.stirring || (host.children?.stamp(e) ?? 0) !== st.stamp)) return now;
      const own = rootPass();
      return own?.layerMade === true ? own.lastDrawn + LAYER_IDLE_MS : Number.POSITIVE_INFINITY;
    },
    tick() {
      // the layer's targets and shadow maps (K6a, D-K6a.3): made at the first book drawn, let go once none was for LAYER_IDLE_MS
      const own = rootPass();
      if (own?.layerMade && !own.drawnWithin(LAYER_IDLE_MS)) own.releaseLayer();
      const w = woke || moving;
      woke = false;
      moving = false;
      // a book in hand keeps asking while it moves or writes — or while its strokes changed since its pages were last brought up to
      // them (an undo, a redo, a peer's stroke: its pages replay at the next record)
      for (const [e, st] of books) if (st.motion !== null && (st.live !== null || st.pending !== null || st.stirring || (host.children?.stamp(e) ?? 0) !== st.stamp)) return true;
      return w;
    },
    /** The budget's ask (D6): a page raster is kept while its page was in a table this frame. */
    keeps: (key) => pages.keeps(key),
    forget(e) {
      const st = books.get(e);
      if (st !== undefined) pages.forget(st.id);
      books.delete(e);
      if (books.size === 0) { rootPass()?.releaseLayer(); rootPass()?.releaseInk(); rootPass()?.releaseMeshes(); }   // no notebook on the desk: its layer, shadow maps and page ink go (K6a)
      landedOf.delete(e);
    },
    dispose() { books.clear(); pages.dispose(); },
  };
}

/** No page in view with ink. */
const NO_TABLE: InkTable = { pages: [], layers: [] };

/** A page of the law's book, open: its width out of the gutter and its height, page units — what a page's raster spans (`INK_W × INK_H`). */
export const NOTEBOOK_PAGE: { readonly len: number; readonly height: number } = (() => { const F = frameOf(specOf(NOTEBOOK)); return { len: F.Wo, height: F.Hp }; })();

/** A book's DEFAULT turn on the mat when a host lays one: the lab's `makeBook` (never set down quite square). */
export const bookAngle = (seed: number): number => { const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return (s - Math.floor(s) - 0.5) * 0.06; };

/**
 * How far a book's drawing reaches past its closed case, world units: the open spread to its left (a cover and the
 * spine), the lift (held and opening) seen through the desk eye and cast along the lamp's capped slope, blurred.
 */
export function notebookReach(law: NotebookLaw = NOTEBOOK): number {
  const F = frameOf(specOf(law));
  const h = law.lift.held + law.lift.open + law.lift.hover;
  return F.W + F.sw + law.shadow.slopeMax * h + 3 * (law.shadow.sigma0 + law.shadow.perUnit * h) + F.W * (law.eye.min / (law.eye.min - h) - 1);
}

/**
 * A book's silhouette for the desk's marks (D4a — the brackets, a member's ticks, the tape): the footprint of its case on
 * the mat at its turn — the closed case W × H about the book's centre and, as the cover swings over, the cover's own
 * footprint beside it (open, the whole spread) — with the fore-edge's corner. The height's parallax aside, as the print's:
 * the marks go around where the book LIES. The oracle's marks read the same function (oracle/frame.mjs).
 */
export function bookFrame(F: Frame, theta: number, cx: number, cy: number, angle: number): MarkFrame {
  const c = coverFrame(F, theta);
  const x0 = Math.min(-F.W / 2, c.ox, c.ox + c.ux * F.W);
  const x1 = F.W / 2;
  const mid = (x0 + x1) / 2;
  return { cx: cx + mid * Math.cos(angle), cy: cy + mid * Math.sin(angle), hx: (x1 - x0) / 2, hy: F.H / 2, angle, r: F.spec.coverRadius };
}

/** The notebook's silhouette on a resolved book (`bookFrame` on its geometry). */
export const notebookFrame = (G: NotebookGeometry): MarkFrame => bookFrame(G.frame, G.theta, G.cx, G.cy, G.angle);

/** The page (and where on it) under a desk point of a resolved book — the pick through the SAME eye the pass drew it with (the hand's). */
export const pageHitAt = (G: NotebookGeometry, wx: number, wy: number): NotebookHit | null => pickNotebook(G.frame, G.pose, G.law, G.rigid, G.eye, wx, wy, G.mesh);

/** A page hit's share of the page that TURNS it (the outer `turnZone` of its length — NOTEBOOK.md §7). */
export const inTurnZone = (h: NotebookHit, law: NotebookLaw): boolean => h.part === "page" && h.s > (1 - law.turnZone) * h.len;

/**
 * A held book's PART under a hit (D3t-b): a page's outer 30 % that has a sheet to turn — `turn`; the rest of a page that takes
 * ink — `content`, the pen's (a mode in hand makes a press there the tool's); the case, the endpapers — `frame`, the book itself
 * (two taps put it down — the notebook's case rule).
 */
export function partOf(G: NotebookGeometry, h: NotebookHit): ObjectHit {
  if (h.part !== "page" || !G.turnable) return "frame";
  const page = pageOfSide(G.pose, h.side);
  if (inTurnZone(h, G.law)) return page !== null ? "turn" : "frame";
  return page !== null ? "content" : "frame";
}

const clamp = (x: number, a: number, b: number): number => Math.min(Math.max(x, a), b);
/** The phone's glide from one page of the spread to the other (D3t-b): a hand moving the book under the eye. */
const FACE = { hz: 1.8, zeta: 0.9 } as const;
/** One damped spring step (the motion's own: semi-implicit Euler). */
const springStep = (x: number, v0: number, to: number, hz: number, z: number, h: number): [number, number] => {
  const w = 2 * Math.PI * hz;
  const v = v0 + (w * w * (to - x) - 2 * z * w * v0) * h;
  return [x + v * h, v];
};

// ---------------------------------------------------------------- the tools in hand (design-015 §8; D3t-b)

/** The pens a notebook is written with — the NOTE's (objects/note.ts `PENS`, STICKY.md §3): names; the inks are the host's. */
export const NOTEBOOK_PENS = ["felt", "ball", "fountain", "red"] as const;
/** The pen in hand when a book is picked up (the note's own default). */
export const DEFAULT_PEN = "fountain";
/** A pen's tool id in the held bar ("pen:fountain"). */
export const penToolId = (pen: string): string => `pen:${pen}`;
/** The pen a tool id names, or undefined. */
export const penOfTool = (id: string): string | undefined => (id.startsWith("pen:") ? id.slice(4) : undefined);
const PEN_LABEL: Readonly<Record<string, string>> = { felt: "Felt pen", ball: "Ballpoint", fountain: "Fountain pen", red: "Red pen" };

/**
 * Runtime, on the notebook in hand (D3t-b): the pages the keys and the bar asked to turn — a running count, +1 a page on, −1 a
 * page back. The hand (objects/leaf.ts) turns by what the count moved since it last looked: a tool writes a fact, the hand
 * turns (a spread of turns — a sheet each frame — fans; on a portrait phone a step is ONE page). The user's, never the document's.
 */
export const PageTurns = defineComponent("desk.pageTurns", { n: field("f64", { default: 0 }) });

/** Ask for a turn: the count moves by `dir` (a tool's op — a runtime write, as the tool in hand is). */
export function askTurn(api: Pick<HeldToolApi, "world" | "entity">, dir: 1 | -1): void {
  const { world, entity } = api;
  const cur = world.get(entity, PageTurns);
  if (cur === undefined) world.addComponent(entity, PageTurns, { n: dir });
  else world.edit(entity).set(PageTurns, { n: cur.n + dir });
}

/**
 * The notebook's tools in hand (*Marks on the Mat* v2's held bar, `heldBarHTML`): ‹ and › (← → and PageUp/PageDown) — a page
 * back, a page on; the four pens (`1`–`4`) — MODES, the tool in hand, the cursor a crosshair over a page (NOTEBOOK.md §7); undo
 * (⌘Z) and, on keys alone, redo (⇧⌘Z) — the DOCUMENT's history over the book's strokes (a stroke is one transaction), waiting
 * for a stroke in hand to land. A turn is never on the undo stack (D-D3t-b.2): ⌘Z takes back ink, never a page.
 */
export const NOTEBOOK_TOOLS: readonly HeldToolDef[] = [
  { id: "turn:-1", label: "Previous page", kind: "action", keys: ["ArrowLeft", "PageUp"], hint: "←", glyph: "chevron-left", run: (api) => { askTurn(api, -1); } },
  { id: "turn:1", label: "Next page", kind: "action", keys: ["ArrowRight", "PageDown"], hint: "→", glyph: "chevron", run: (api) => { askTurn(api, 1); } },
  ...NOTEBOOK_PENS.map((pen, i): HeldToolDef => ({ id: penToolId(pen), label: PEN_LABEL[pen] ?? pen, kind: "mode", keys: [String(i + 1)], hint: String(i + 1), glyph: "pen", cursor: "crosshair" })),
  { id: "undo", label: "Undo", kind: "action", keys: ["mod+z"], hint: "⌘Z", glyph: "undo", run: (api) => { if (!inking(api.world)) api.undo(); } },
  { id: "redo", label: "Redo", kind: "action", keys: ["mod+shift+z", "mod+y"], hint: "⇧⌘Z", glyph: "redo", bar: false, run: (api) => { if (!inking(api.world)) api.redo(); } },
];

export interface NotebookKindOptions {
  readonly text?: ShaderText;
  /** The notebook's numbers (notebook/law.ts `NOTEBOOK`) — the engine's unless a host tweaks them. */
  readonly law?: NotebookLaw;
}

/** The notebook's kind, whole (kinds/world.ts `ObjectKind`): the program, and the world half on the lab's own book. */
export function notebookKind(opts: NotebookKindOptions = {}): ObjectKind<NotebookGeometry, NotebookDraw, NotebookObjectLook> {
  const law = opts.law ?? NOTEBOOK;
  const program = notebookProgram(opts.text ?? shaderText);
  const F = frameOf(specOf(law, { sheets: law.block.sheets }));
  const sheets = F.spec.sheets;
  return {
    ...program,
    reach: notebookReach(law),
    local: (host: KindHost): Books => createBooks(host),
    resolve(ctx: ObjectContext): NotebookGeometry {
      const books = ctx.local as Books | undefined;
      const st = books?.state(ctx.entity);
      const pin = st?.pose;
      const left = clamp(Math.round(numberProp(ctx.props, "spread", 0)), 0, sheets);
      // IN HAND (design-015 §8, D4b): the cover swings toward its target on the hand's spring (a palm's — 1.4 Hz, ζ .78), snapped for
      // a still; the swing is the kind's `openness`, which the builder reads to time the flight home. On the desk the cover is shut.
      const held = ctx.held;
      let cover: number | undefined;
      if (st !== undefined) {
        if (held === undefined) { st.coverT = 0; st.coverV = 0; }
        else {
          const target = held.open ? 1 : 0;
          if (held.snap) { st.coverT = target; st.coverV = 0; }
          else {
            [st.coverT, st.coverV] = spring(st.coverT, st.coverV, target, HOLD.cover.hz, HOLD.cover.zeta, ctx.dt);
            if (settled(st.coverT, st.coverV, target, 1e-3)) { st.coverT = target; st.coverV = 0; }
          }
          cover = st.coverT;
        }
      }
      let m: NotebookMotion;
      if (st !== undefined && held !== undefined && pin === undefined) {
        // IN HAND, live (D3t-b): the sheets are a motion kept from frame to frame — the cover the hand's, the sheets their own springs,
        // heading for the spread the hand asked for (until its transaction lands) or the document's, one sheet a frame
        m = st.motion ?? newMotion(sheets, left, false);
        st.motion = m;
        const c = cover ?? 0;
        setOpen(m, c >= 0.5);   // closing lands every sheet in the air on the side it was heading
        m.theta = c * Math.PI;
        m.fluttered = true;
        if (st.pending !== null && st.pending === left) st.pending = null;
        const want = clamp(st.pending ?? left, 0, sheets);
        let turned = 0;
        for (const q of m.sheets) if (q.side === 1) turned += 1;
        if (turned !== want && turnable(m) && !m.sheets.some((q) => q.held)) turnPage(m, turned < want ? 1 : -1, law);
        st.stirring = stepLeaves(m, ctx.dt, law) || turned !== want;
        // a portrait phone reads the spread a page at a time: the view glides to the page the hand turned to (the pose's `page`)
        const single = readingTarget({ cx: 0, cy: 0, w: ctx.rect.w * 2, h: ctx.rect.h }, { width: ctx.view.width, height: ctx.view.height }, true).single;
        if (!single) st.faceT = 0;
        if (held.snap || !single) { st.face = st.faceT; st.faceV = 0; }
        else {
          [st.face, st.faceV] = spring(st.face, st.faceV, st.faceT, FACE.hz, FACE.zeta, ctx.dt);
          if (settled(st.face, st.faceV, st.faceT, 1e-3)) { st.face = st.faceT; st.faceV = 0; }
          else st.stirring = true;
        }
      } else {
        if (st !== undefined) { st.motion = null; st.stirring = false; if (held === undefined) { st.face = 0; st.faceV = 0; st.faceT = 0; } }
        const open = cover !== undefined ? cover : pin?.open;
        m = newMotion(sheets, left, open === true || (typeof open === "number" && open >= 0.5));
        if (typeof open === "number") { m.theta = open * Math.PI; m.fluttered = true; }
        if (pin?.turn) {
          const t = pin.turn;
          const i = t.dir === 1 ? m.sheets.findIndex((q) => q.side === 0) : m.sheets.map((q) => q.side).lastIndexOf(1);
          const q = m.sheets[i];
          if (q) { q.air = true; q.side = t.dir === 1 ? 1 : 0; q.phi = t.phi; q.psi = t.psi; q.tw = t.twist ?? 0; }
        }
        if (pin?.peek !== undefined) { m.peek = pin.peek; m.peekOn = pin.peek > 0; }
      }
      m.lift = ctx.flux.lift;
      m.held = ctx.flux.lift > 0;
      m.hover = m.opened ? 0 : ctx.flux.hover;
      // the tilt: a still's pin, else into the carry's motion (the rect's velocity, CSS px/s) while it is lifted, sprung
      if (pin?.tilt) { m.tiltX = pin.tilt[0]; m.tiltY = pin.tilt[1]; }
      else if (st !== undefined) {
        const dt = Math.min(Math.max(ctx.dt, 0), 0.05);
        const moved = !Number.isNaN(st.lastX) && dt > 0;
        const vx = moved ? ((ctx.rect.cx - st.lastX) / dt) * ctx.view.zoom : 0;
        const vy = moved ? ((ctx.rect.cy - st.lastY) / dt) * ctx.view.zoom : 0;
        st.lastX = ctx.rect.cx;
        st.lastY = ctx.rect.cy;
        tiltToward(m, vx, vy, law);
        const tx = m.held ? m.tiltTX : 0;
        const ty = m.held ? m.tiltTY : 0;
        for (let k = 0; k < 8; k++) {
          [st.tiltX, st.tiltXV] = springStep(st.tiltX, st.tiltXV, tx, law.springs.tilt[0], law.springs.tilt[1], dt / 8);
          [st.tiltY, st.tiltYV] = springStep(st.tiltY, st.tiltYV, ty, law.springs.tilt[0], law.springs.tilt[1], dt / 8);
        }
        if (Math.abs(st.tiltX - tx) + Math.abs(st.tiltY - ty) < 1e-4 && Math.abs(st.tiltXV) + Math.abs(st.tiltYV) < 1e-3) { st.tiltX = tx; st.tiltY = ty; st.tiltXV = st.tiltYV = 0; }
        m.tiltX = st.tiltX;
        m.tiltY = st.tiltY;
      }
      // the ring: a selected book lying closed on the mat — never under a lifted or an open one
      m.ring = m.opened ? 0 : ctx.flux.ring * (1 - ctx.flux.lift);
      const angle = numberProp(ctx.props, "angle", 0);
      const swing = Math.min(Math.max(swingOf(m.theta), 0), Math.PI);
      // biome-ignore lint/style/useExponentiationOperator: the lab's arithmetic (lab/notebook.ts `placementOf`), verbatim — it feeds a record
      const opening = law.lift.open * Math.pow(Math.sin(swing), 0.85);
      const v = ctx.view;
      const eye = eyeOf({ x: v.camX, y: v.camY, zoom: v.zoom }, { width: v.width, height: v.height }, law.eye);
      // in hand the book RISES toward the desk eye (the pose is the eye's, D4b): a point z up reads H/(H − z) times its size, so
      // z = H·(1 − 1/grow) is the reading size — the perspective of a book held close, not a zoomed camera's
      const rise = held !== undefined && held.grow > 1 ? eye.h * (1 - 1 / held.grow) : 0;
      const place = { cx: ctx.rect.cx, cy: ctx.rect.cy, angle, lift: m.lift * law.lift.held + m.hover * law.lift.hover + opening + rise, tiltX: m.tiltX, tiltY: m.tiltY, zc: F.b + F.T / 2 };
      const pose = withDesk(poseOf(m, law), place.lift);
      const built = books?.meshFor(ctx.entity, F, pose, law) ?? { mesh: buildMesh(new MeshWriter(), F, pose, law), version: 1 };
      return {
        frame: F, pose, mesh: built.mesh, version: built.version, rigid: rigidOf(place), lamp: lampDir(ctx.lamp, ctx.rect.cx, ctx.rect.cy, law.shadow.slopeMax),
        theta: m.theta, ring: m.ring, eye, fade: ctx.flux.fade,
        cx: ctx.rect.cx, cy: ctx.rect.cy, angle,
        held: held !== undefined, turnable: turnable(m), law,
      };
    },
    record(G: NotebookGeometry, ctx: ObjectContext): NotebookDraw {
      const look = ctx.look as NotebookObjectLook | undefined;
      const covers = look?.covers ?? {};
      const cover = covers[stringProp(ctx.props, "cover", "")] ?? Object.values(covers)[0];
      if (look === undefined || cover === undefined) throw new Error("desk/notebook: the covers are the host's — the palette names no `notebooks` (kinds/notebook.ts `NotebookPalette`)");
      const books = ctx.local as Books | undefined;
      books?.ink(look.ruleInk);
      const rulingName = stringProp(ctx.props, "ruling", "dots") as Ruling;
      const sw = swingOf(G.theta);
      const draw: NotebookDraw = {
        id: books?.state(ctx.entity).id ?? 1, mesh: G.mesh, version: G.version, frame: G.frame, rigid: G.rigid, lamp: G.lamp,
        theta: G.theta, gamma: relaxOf(G.theta), look: cover, ruling: RULINGS.includes(rulingName) ? rulingName : "dots", seed: numberProp(ctx.props, "seed", 0) % 97, ring: G.ring,
        // the pages in view with ink, each on a layer brought up to its strokes (D3t-b) — a ghost draws nothing, so asks for none
        selfShadow: G.pose.airs.length > 0 || (sw > 0.02 && sw < Math.PI - 0.02), ink: books !== undefined && G.fade >= 1 ? books.table(ctx.entity, G, look) : NO_TABLE,
        // without the desk's local nobody sets the pass's ink: the record carries its look's
        ...(books === undefined ? { rule: look.ruleInk } : {}),
      };
      if (G.fade < 1) VANISHED.add(draw);
      return draw;
    },
    hit(G: NotebookGeometry, wx: number, wy: number): ObjectHit | null {
      if (G.fade < 1) return null;
      const h = pageHitAt(G, wx, wy);
      if (h === null) return null;
      // on the desk the book is itself (select, carry); in hand its parts (D3t-b)
      return G.held ? partOf(G, h) : "content";
    },
    frame: notebookFrame,
    // THE OPENING (design-015 §8, D4b): the spread — twice the case's width, left of the spine — comes to the hand under the desk
    // eye; the cover's swing is its motion; D3t-b: its tools live — ‹ ›, the four pens (the fountain pen in hand at the pickup),
    // undo and redo — each pen's slot the swatch of its ink
    open: {
      extent: (c) => ({ cx: c.rect.cx - c.rect.w / 2, cy: c.rect.cy, w: c.rect.w * 2, h: c.rect.h }),
      pose: "eye",
      spread: true,
      openness: (c) => (c.local as Books | undefined)?.state(c.entity).coverT ?? 0,
      page: (c) => (c.local as Books | undefined)?.state(c.entity).face ?? 0,
      tools: NOTEBOOK_TOOLS,
      tool: () => penToolId(DEFAULT_PEN),
      swatches: (look) => (look as NotebookObjectLook).swatches,
    },
    theme(palette: Palette, _name: ThemeName): NotebookObjectLook {
      const n = (palette as NotebookPalette).notebooks;
      const penRefs = (palette as NotebookPalette).pens ?? {};
      const pens: Record<string, RGB> = Object.fromEntries(Object.entries(penRefs).map(([name, t]) => [name, rgb(t.css)]));
      const swatches: Record<string, string> = Object.fromEntries(Object.entries(penRefs).map(([name, t]) => [penToolId(name), t.css]));
      if (n === undefined) return { covers: {}, ruleInk: [0, 0, 0, 0], pens, swatches };
      const paper: RGB = rgb(n.paper.css);
      const ink: RGB = rgb(n.ink.css);
      const covers = Object.fromEntries(Object.entries(n.covers).map(([name, c]) => [name, {
        cloth: rgb(c.cloth.css), band: rgb(c.band.css), accents: [rgb(c.a.css), rgb(c.b.css), rgb(c.c.css)] as const, endpaper: rgb(c.endpaper.css), paper, ink, design: c.design, paperCover: c.paperCover,
      } satisfies NotebookLook]));
      return { covers, ruleInk: [ink[0], ink[1], ink[2], n.rule], pens, swatches };
    },
  };
}
