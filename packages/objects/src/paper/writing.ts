// The desk's WRITING (design-015 §6.1; D2c) — the paper kind's own state on one desk: every note's
// hand LAYOUT, where its INK lives in the pages, the pen's WIPE and the editor's CARET. Flux, never a
// world fact (design-015 §2.3): the facts are the note's durable cells (its text and its seeds —
// seeds.ts — its seed, its size); what is drawn from them is cached here, per entity, keyed so that
// nothing is redone on a frame:
//
// - the LAYOUT (text.ts `layoutText`, pure) is keyed by the face, the text raster's version (a face
//   landing re-lays every note — the prototype's `fontVersion`), the hand's law, the sheet's size, the
//   note's seed, and the text with its seeds — the "text revision" is the content itself, so two equal
//   writings share a layout and an undo that restores a text restores its layout;
// - the RASTER (the host's `TextRaster`) is keyed by that layout, the BAND and the pen's bleed. The band
//   is the prototype's √2 ladder with hysteresis (paper.ts `rasterBand`): re-rastered on an edit or a
//   rung crossing only, never on a pan or a wobble. Only a note within `marginPx` (200) CSS px of the
//   view pays for a raster; one further out keeps what it has.
// - its PAGES are the paper pass's shelves (pages.ts): a raster of the same size is redrawn in its own
//   rect; a new size frees the old rect first; a note that leaves the desk for good (`forget` — its ghost
//   faded, a nav cut) frees its rect, so a delete leaks no page slot and an undo that respawns re-rasters.
//   Pages full ⇒ the rasters no one drew in the last two frames are evicted, oldest first; still full ⇒
//   the sheet draws BLANK, honestly, and `stats().blanks` says so.
//
// - THE QUEUE (K6b, design-016 §6 — the desk's frame raster queue, `KindHost.rasters`): a raster at another BAND (a rung
//   crossed) or a note's FIRST (it came on screen holding none, the face landed) is ASKED, not drawn in the frame that asked — a
//   zoom across a rung asked it of every note near the view at once (193 ms: 108 notes). The queue lays it in its turn, under the
//   frame's budget: first what shows nothing (a blank sheet), then what shows its ink magnified (a band short of the screen's),
//   then what shows it minified (a band past it — the pages' room), the nearest the view's centre first within each; meanwhile the
//   raster it holds STANDS, scaled by the pass (a rung is √2: a magnified stand-in is at most one rung soft until its turn), and
//   the new one is found room BEFORE the old is let go. Laid, the note's record is remade (`remake`) — the record says where its
//   ink is. A raster whose WORDS moved (an edit, a resize) is laid at once, in the frame that asked: the ink never lags the caret.
//   Without a queue (a bare host, the tests) every raster is laid at once, as before.
//
// A PINNED raster (a parity still's committed ink, `pin`) wins over the live one and is never re-rastered.
// Without a text raster (the Node oracle) nothing is rastered live: the pinned rasters only.
//
// The WIPE (110 ms) and the CARET (blink 530 ms) are the editor's flux, clocked by the frame's `now`
// (`tick`, once a tick, before the draw): `tick` answers whether a frame is wanted — every tick while a
// wipe runs, once per blink phase while the caret stands, once when a face lands or the editor moves.

import type { Entity } from "@ice/core";
import { type KindHost, rasterPriority } from "@ice/desk";
import { type View, HAND, caretAt, glyphBox, type HandLaw, type HandLayout, layoutText, type TextRaster, seedsFor } from "@ice/desk/kit";
import { PAPER } from "./theme";
import type { PaperInstance } from "./layout";
import type { InkRect, UvRect } from "./pages";
import { INK_PAGE } from "./paper-pass";
import { type PaperGeometry, localOf, rasterBand, sdPaper } from "./paper";

/** The pages a writing allocates in — the root paper pass (paper-pass.ts) satisfies it. */
export interface InkPages {
  alloc(w: number, h: number): InkRect | null;
  free(r: InkRect): void;
  write(r: InkRect, bytes: Uint8Array<ArrayBuffer>): UvRect;
  /** Every rect forgotten (the shelves carved afresh); `clear` zeroes the texels too. */
  reset(clear?: boolean): void;
  /** Give back the layers' trailing empty rows (pages.ts `trim`). */
  trim?(): number;
}

/** The hand's law as theme.ts states it (`HAND`) — the engine's unless a host says. */
export const DEFAULT_HAND_LAW: HandLaw = HAND;
/** The default face — Caveat medium (STICKY.md §3; the app ships the file). */
export const DEFAULT_FACE = "caveat";
/** The pen's bleed, note units — a faint stroke under each glyph (STICKY.md §3). */
export const DEFAULT_BLEED = 0.3;

export interface WritingOptions {
  /** The ink pages — the root paper pass once the ground is made; `undefined` before (a sheet waits). */
  readonly pages: () => InkPages | undefined;
  /** The host's text raster (desk/host/ink.ts); absent — the Node oracle — nothing is rastered live. */
  readonly text?: TextRaster | undefined;
  readonly hand?: HandLaw;
  readonly face?: string;
  readonly bleed?: number;
  /** A typed glyph's wipe, ms (theme.ts `HAND.wipeMs`). */
  readonly wipeMs?: number;
  /** The caret's blink, ms (theme.ts `PAPER.caret.blinkMs`). */
  readonly blinkMs?: number;
  /** Only a note within this many CSS px of the view pays for a raster (the prototype's 200). */
  readonly marginPx?: number;
  /**
   * The builder's word on what is DRAWN (D6, persistent records — `KindHost.drawn`): the paint rank of a note in the root slot this
   * frame, undefined when it is not drawn. With it, "drawn" means the builder's set, not the last `draw` call (a reused record makes
   * none): the eviction spares what is on screen and `noteAt` ranks by paint order. Absent, the writing counts its own draws.
   */
  readonly drawn?: ((e: Entity) => number | undefined) | undefined;
  /** The desk's frame raster queue (K6b, `KindHost.rasters`): a new band or a first raster is asked there; absent, laid at once. */
  readonly queue?: KindHost["rasters"];
  /** The builder's door (K6b, `KindHost.remake`): a note's record remade once the queue laid its raster. */
  readonly remake?: KindHost["remake"];
}

/** What a note draws with this frame — the paper kind's record takes it whole. */
export interface NoteInk {
  readonly raster?: { readonly layer: number; readonly uv: UvRect };
  readonly wipe?: PaperInstance["wipe"];
  readonly caret?: PaperInstance["caret"];
}

/** Where a note's ink lives and what it was drawn at — the rigs' witness. */
export interface NoteRasterInfo {
  readonly band: number;
  readonly w: number;
  readonly h: number;
  readonly layer: number;
  readonly x: number;
  readonly y: number;
  readonly pinned: boolean;
}

export interface WritingStats {
  /** Notes holding a raster now (pinned included). */
  readonly resident: number;
  readonly pinned: number;
  /** Layouts laid and rasters drawn since the mount — the "re-rasters on an edit or a rung only" instrument. */
  readonly layouts: number;
  readonly rasters: number;
  /** Rasters refused because the pages were full (the sheet drew blank). */
  readonly blanks: number;
  /** Rasters evicted to make room. */
  readonly evicted: number;
  /** Notes whose raster is asked of the queue and not laid yet (K6b) — each draws what it holds meanwhile. */
  readonly queued: number;
}

export interface Writing {
  /** The frame's clock, once a tick before the draw: does the writing want a frame now? */
  tick(now: number): boolean;
  /**
   * What note `e` draws with this frame: its ink (pinned or live), the pen's wipe, the caret. A `fading` note (a
   * delete ghost) draws only the raster it already holds — never a new layout or raster, no marks.
   */
  draw(e: Entity, props: Readonly<Record<string, unknown>>, rect: { readonly cx: number; readonly cy: number; readonly w: number; readonly h: number }, view: View & { readonly dpr: number }, geometry: PaperGeometry, fading?: boolean): NoteInk;
  /**
   * The band note `e` asks at `zoom` × `dpr` (K6b — the paper kind's RUNG): its raster's band under the ladder's hysteresis, the one
   * `draw` would raster at; 0 when it asks none (an empty sheet, a pinned still, no text raster). The note's record reads the zoom
   * through this alone, so a zoom within the band remakes nothing.
   */
  bandOf(e: Entity, props: Readonly<Record<string, unknown>>, rect: { readonly w: number; readonly h: number }, zoom: number, dpr: number): number;
  /**
   * Note `e`'s RUNG at `zoom` × `dpr` (K6b — the paper kind's `rung`): without a queue, the band it asks (`bandOf` — its record,
   * remade at a crossing, rasters it at once); with one, the band of the raster it HOLDS — what its record shows — the band the zoom
   * asks being ASKED of the queue here, `px` (screen px from the view's centre) its order: a crossing remakes no record, the raster's
   * landing does (`remake`).
   */
  rungOf(e: Entity, props: Readonly<Record<string, unknown>>, rect: { readonly w: number; readonly h: number }, zoom: number, dpr: number, px: number): number;
  /** The note's layout as last drawn (undefined before, for a still, or while the face loads). */
  layoutOf(e: Entity): HandLayout | undefined;
  rasterOf(e: Entity): NoteRasterInfo | undefined;
  /** Pin a committed raster (r8 rows) on a note — allocated NOW, in call order (the oracle's texels). */
  pin(e: Entity, bytes: Uint8Array<ArrayBuffer>, size: { readonly w: number; readonly h: number }): boolean;
  isPinned(e: Entity): boolean;
  /** The editor's caret: on note `e` before glyph `index`, its blink restarted at `now`; `undefined` lifts it. */
  caret(e: Entity | undefined, index?: number, now?: number): void;
  /** The caret as drawn: its note, its index, whether it shows. */
  caretOf(): { readonly entity: Entity; readonly index: number; readonly on: boolean } | undefined;
  /** A glyph was just written at `index` (the pen's wipe from `now`); `undefined` = nothing to wipe (a paste, a newline). */
  wrote(e: Entity, index: number | undefined, now: number): void;
  wipeOf(e: Entity): { readonly index: number; readonly t0: number } | undefined;
  /** What has LANDED on the note, counted — its raster laid, its wipe let go (D7 — `KindLocal.landed`); never the wipe running. */
  landed(e: Entity): number;
  /** The caret index nearest a world point on a drawn note — where a tap puts the pen. */
  caretIndexAt(e: Entity, wx: number, wy: number): number | undefined;
  /** The topmost note drawn last frame under a world point. */
  noteAt(wx: number, wy: number): Entity | undefined;
  /** The note left the desk for good: its rect back to the pages. */
  forget(e: Entity): void;
  /** Every raster forgotten and the pages carved afresh (a scene reload). */
  reset(): void;
  stats(): WritingStats;
  dispose(): void;
}

interface Raster {
  readonly rect: InkRect;
  readonly uv: UvRect;
  readonly band: number;
  /** The layout it drew (identity: a new layout is a new writing), absent for a pinned still. */
  readonly layout: HandLayout | undefined;
  readonly bleed: number;
}

interface Entry {
  text: string;
  seeds: string;
  seed: number;
  w: number;
  h: number;
  version: number;
  layout: HandLayout | undefined;
  keyed: boolean;
  raster: Raster | null;
  pinned: boolean;
  /** The band asked of the queue and not laid yet (K6b); 0 = nothing asked. */
  want: number;
  /** The note's run for the queue, made once. */
  run: (() => "done" | "wait") | undefined;
  /** The render it was last drawn in, and its place in that render's paint order. */
  drawnAt: number;
  order: number;
  geometry: PaperGeometry | undefined;
}

/** The queue's name for the paper's asks (K6b) — the kind's. */
const OWNER = "paper";

const str = (props: Readonly<Record<string, unknown>>, name: string): string => { const v = props[name]; return typeof v === "string" ? v : ""; };
const num = (props: Readonly<Record<string, unknown>>, name: string): number => { const v = props[name]; return typeof v === "number" && Number.isFinite(v) ? v : 0; };

/** The caret index nearest a point in a note's own units (the prototype's `caretIndexAt`): lines weigh three times the columns. */
export function caretIndexIn(L: HandLayout, nx: number, ny: number, length: number): number {
  let best = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let i = 0; i <= length; i++) {
    const px = L.positions[2 * i] as number;
    const py = L.positions[2 * i + 1] as number;
    const score = Math.abs(py - L.ascent * 0.4 - ny) * 3 + Math.abs(px - nx);
    if (score < bestScore) { bestScore = score; best = i; }
  }
  return best;
}

export function createWriting(opts: WritingOptions): Writing {
  const law = opts.hand ?? DEFAULT_HAND_LAW;
  const face = opts.face ?? DEFAULT_FACE;
  const bleed = opts.bleed ?? DEFAULT_BLEED;
  const wipeMs = Math.max(opts.wipeMs ?? HAND.wipeMs, 1);
  const blinkMs = Math.max(opts.blinkMs ?? PAPER.caret.blinkMs, 60);
  const marginPx = opts.marginPx ?? 200;
  const text = opts.text;
  const entries = new Map<Entity, Entry>();
  const wipes = new Map<Entity, { index: number; t0: number }>();
  const landedOf = new Map<Entity, number>();
  const land = (e: Entity): void => { landedOf.set(e, (landedOf.get(e) ?? 0) + 1); };
  let focus: { entity: Entity; index: number; t0: number } | undefined;
  let now = 0;
  let ticks = 0;
  let render = 0;
  let renderTick = -1;
  let order = 0;
  let dirty = false;
  let seenVersion = text?.version() ?? 0;
  let lastPhase: boolean | undefined;
  let layouts = 0;
  let rasters = 0;
  let blanks = 0;
  let evicted = 0;

  const phaseAt = (t: number): boolean => (focus === undefined ? false : Math.floor(Math.max(0, t - focus.t0) / blinkMs) % 2 === 0);

  const queue = opts.queue;
  const remake = opts.remake;
  const release = (pages: InkPages | undefined, en: Entry): void => {
    if (en.raster === null) return;
    pages?.free(en.raster.rect);
    en.raster = null;
    pages?.trim?.();
    queue?.wake(OWNER);   // room made: a note held for it tries again
  };

  const drawn = opts.drawn;
  /** Not on screen this frame: the builder's word when it gives one (D6), else not drawn in the last two renders. */
  const offScreen = (e: Entity, q: Entry): boolean => (drawn !== undefined ? drawn(e) === undefined : q.drawnAt < render - 1);
  /** Room for a `w × h` raster: the pages' own, else what no one drew in the last two frames, oldest first. */
  const room = (pages: InkPages, w: number, h: number): InkRect | null => {
    const got = pages.alloc(w, h);
    if (got !== null) return got;
    const stale = [...entries.entries()].filter(([e, q]) => q.raster !== null && !q.pinned && offScreen(e, q)).map(([, q]) => q).sort((a, b) => a.drawnAt - b.drawnAt);
    for (const q of stale) {
      release(pages, q);
      evicted += 1;
      const r = pages.alloc(w, h);
      if (r !== null) return r;
    }
    return null;
  };

  /** The band a note asks at `zoom` × `dpr`: the ladder's, with the hysteresis around the band its raster holds, capped at the page. */
  const askBand = (en: Entry | undefined, w: number, h: number, zoom: number, dpr: number): number => rasterBand(zoom, dpr, en?.raster?.band ?? 0, INK_PAGE / Math.max(w, h, 1));

  const near = (rect: { readonly cx: number; readonly cy: number; readonly w: number; readonly h: number }, view: View): boolean => {
    const m = marginPx / view.zoom;
    const r = Math.hypot(rect.w, rect.h) / 2;
    return rect.cx + r >= view.camX - m && rect.cx - r <= view.camX + view.width / view.zoom + m && rect.cy + r >= view.camY - m && rect.cy - r <= view.camY + view.height / view.zoom + m;
  };

  /**
   * Lay note `e`'s ink at `band` for its layout `L` on a `w × h` sheet: in its own rect when the size is the same, else a new one.
   * `keep` (the queue's run): the new rect is found BEFORE the old is let go — no room, and the old raster stands; else (the frame
   * that asked) the old goes first and no room draws the sheet blank, honestly. False: no room.
   */
  const lay = (e: Entity, en: Entry, pages: InkPages, T: TextRaster, L: HandLayout, w: number, h: number, band: number, keep: boolean): boolean => {
    const pw = Math.max(1, Math.ceil(w * band));
    const ph = Math.max(1, Math.ceil(h * band));
    const r = en.raster;
    let at: InkRect | null = r !== null && r.rect.w === pw && r.rect.h === ph ? r.rect : null;
    if (at === null && keep) {
      at = room(pages, pw, ph);
      if (at === null) return false;
      release(pages, en);
    } else if (at === null) {
      release(pages, en);
      at = room(pages, pw, ph);
      if (at === null) { blanks += 1; return false; }
    }
    const bmp = T.raster(L, face, { w, h }, band, bleed);
    en.raster = { rect: at, uv: pages.write(at, bmp.bytes), band, layout: L, bleed };
    rasters += 1;
    land(e);
    return true;
  };

  /** The band note `e` asks (`bandOf`): 0 for an empty sheet, a pinned still, no text raster. */
  const bandAsked = (e: Entity, props: Readonly<Record<string, unknown>>, rect: { readonly w: number; readonly h: number }, zoom: number, dpr: number): number => {
    const en = entries.get(e);
    if (text === undefined || en?.pinned === true || str(props, "text").length === 0) return 0;
    return askBand(en, rect.w, rect.h, zoom, dpr);
  };

  /** Nothing owed to the queue for `e` any more (its band came back, its words moved, it left): its ask withdrawn. */
  const unask = (e: Entity, en: Entry): void => {
    if (en.want === 0) return;
    en.want = 0;
    queue?.drop(OWNER, e);
  };

  /**
   * The queue's turn for note `e` (K6b): its ink laid at the band it last asked — the old raster standing until the new one has
   * room — and its record remade. No room: it waits, held until a raster is let go. Nothing owed any more: done.
   */
  const run = (e: Entity): "done" | "wait" => {
    const en = entries.get(e);
    const pages = opts.pages();
    const L = en?.layout;
    if (en === undefined || en.want === 0 || en.pinned || pages === undefined || text === undefined || L === undefined) { if (en !== undefined) en.want = 0; return "done"; }
    if (!lay(e, en, pages, text, L, en.w, en.h, en.want, true)) {
      if (en.raster === null) blanks += 1;
      return "wait";
    }
    en.want = 0;
    remake?.(e);
    return "done";
  };

  /** Ask the queue for note `e`'s raster at `band`: its tier by what it shows meanwhile, the nearest the view's centre (`px`) first within it. */
  const ask = (e: Entity, en: Entry, band: number, px: number, Q: NonNullable<KindHost["rasters"]>): void => {
    en.want = band;
    const shows = en.raster === null ? "nothing" : en.raster.band < band ? "magnified" : "minified";
    en.run ??= () => run(e);
    Q.ask(OWNER, e, rasterPriority(shows, px), en.run);
  };

  const entryOf = (e: Entity): Entry => {
    let en = entries.get(e);
    if (en === undefined) {
      en = { text: "", seeds: "", seed: 0, w: 0, h: 0, version: -1, layout: undefined, keyed: false, raster: null, pinned: false, want: 0, run: undefined, drawnAt: -1, order: 0, geometry: undefined };
      entries.set(e, en);
    }
    return en;
  };

  return {
    tick(t) {
      now = t;
      ticks += 1;
      let want = dirty;
      dirty = false;
      if (text !== undefined && text.version() !== seenVersion) { seenVersion = text.version(); want = true; }
      // a wipe runs on the clock whether or not its note is drawn (D7): a frame for it while it runs — and once as its time is up, to
      // draw it done — only for a note on screen (the builder's word, when it gives one); a note panned off or never drawn again
      // asked a frame every tick forever, its wipe let go only by a draw that never came
      for (const [e, wp] of wipes) {
        if (t - wp.t0 >= wipeMs) { wipes.delete(e); land(e); }
        if (drawn === undefined || drawn(e) !== undefined) want = true;
      }
      const phase = focus === undefined ? undefined : phaseAt(t);
      if (phase !== lastPhase) { lastPhase = phase; want = true; }
      return want;
    },

    draw(e, props, rect, view, G, fading = false) {
      if (renderTick !== ticks) { renderTick = ticks; render += 1; order = 0; }
      // a delete ghost keeps what it has and asks for nothing: after a reset it fades blank, never re-rastered
      if (fading) { const r = entries.get(e)?.raster; return r === null || r === undefined ? {} : { raster: { layer: r.rect.layer, uv: r.uv } }; }
      const en = entryOf(e);
      en.drawnAt = render;
      en.order = ++order;
      en.geometry = G;
      const pages = opts.pages();
      if (en.pinned) return en.raster === null ? {} : { raster: { layer: en.raster.rect.layer, uv: en.raster.uv } };
      // the layout: re-laid only when one of its inputs moved
      const t = str(props, "text");
      const s = str(props, "seeds");
      const seed = num(props, "seed");
      const version = text?.version() ?? 0;
      if (!en.keyed || en.text !== t || en.seeds !== s || en.seed !== seed || en.w !== rect.w || en.h !== rect.h || en.version !== version) {
        const metrics = text?.metrics(face);
        en.layout = metrics === undefined ? undefined : layoutText(t, { w: rect.w, h: rect.h }, law, metrics, seed, seedsFor(t, s, seed));
        en.text = t; en.seeds = s; en.seed = seed; en.w = rect.w; en.h = rect.h; en.version = version; en.keyed = true;
        if (en.layout !== undefined) layouts += 1;
      }
      const L = en.layout;
      // the raster: none for an unwritten sheet; else at the band the view asks, redrawn on a new layout or a rung only
      if (t.length === 0 || L === undefined || text === undefined) { release(pages, en); unask(e, en); }
      else if (pages !== undefined && near(rect, view)) {
        const band = askBand(en, rect.w, rect.h, view.zoom, view.dpr);
        const r = en.raster;
        // its WORDS moved under the raster it holds (an edit, a resize): laid in this frame — the ink never lags the caret
        if (r !== null && (r.layout !== L || r.bleed !== bleed)) { unask(e, en); lay(e, en, pages, text, L, rect.w, rect.h, band, false); }
        // none yet, or another band (a rung crossed): the queue's (K6b) — what it holds stands until its turn; without one, at once
        else if (r === null || r.band !== band) {
          if (queue !== undefined) ask(e, en, band, Math.hypot(rect.cx - (view.camX + view.width / (2 * view.zoom)), rect.cy - (view.camY + view.height / (2 * view.zoom))) * view.zoom, queue);
          else lay(e, en, pages, text, L, rect.w, rect.h, band, false);
        } else unask(e, en);   // nothing owed: the zoom came back to the band it holds
      }
      // the pen's wipe over the newest glyph, and the caret
      let wipe: NoteInk["wipe"];
      const wp = wipes.get(e);
      if (wp !== undefined && L !== undefined) {
        const g = L.glyphs.find((q) => q.index === wp.index);
        const u = (now - wp.t0) / wipeMs;
        if (g === undefined || u >= 1) { wipes.delete(e); land(e); }
        else wipe = { ...glyphBox(L, g), t: Math.max(0, u) };
      }
      const caret = focus !== undefined && focus.entity === e && L !== undefined ? { ...caretAt(L, focus.index), on: phaseAt(now) } : undefined;
      return {
        ...(en.raster !== null ? { raster: { layer: en.raster.rect.layer, uv: en.raster.uv } } : {}),
        ...(wipe !== undefined ? { wipe } : {}),
        ...(caret !== undefined ? { caret } : {}),
      };
    },

    bandOf: (e, props, rect, zoom, dpr) => bandAsked(e, props, rect, zoom, dpr),

    rungOf(e, props, rect, zoom, dpr, px) {
      const band = bandAsked(e, props, rect, zoom, dpr);
      const en = entries.get(e);
      // no queue, or nothing laid out to raster yet (a record not made, the face loading): the record's own draw asks, at once
      if (queue === undefined || band === 0 || en?.layout === undefined) return band;
      const held = en.raster?.band ?? 0;
      if (band !== held) ask(e, en, band, px, queue);
      else unask(e, en);
      return held;
    },

    layoutOf: (e) => entries.get(e)?.layout,
    rasterOf(e) {
      const r = entries.get(e)?.raster;
      if (r === null || r === undefined) return undefined;
      return { band: r.band, w: r.rect.w, h: r.rect.h, layer: r.rect.layer, x: r.rect.x, y: r.rect.y, pinned: entries.get(e)?.pinned === true };
    },

    pin(e, bytes, size) {
      const pages = opts.pages();
      if (pages === undefined) return false;
      const en = entryOf(e);
      unask(e, en);
      release(pages, en);
      const at = pages.alloc(size.w, size.h);
      dirty = true;
      if (at === null) { en.pinned = false; return false; }
      en.raster = { rect: at, uv: pages.write(at, bytes), band: 0, layout: undefined, bleed };
      en.pinned = true;
      return true;
    },
    isPinned: (e) => entries.get(e)?.pinned === true,

    caret(e, index = 0, t = now) {
      if (e === undefined) { if (focus !== undefined) { focus = undefined; dirty = true; } return; }
      focus = { entity: e, index, t0: t };
      dirty = true;
    },
    caretOf: () => (focus === undefined ? undefined : { entity: focus.entity, index: focus.index, on: phaseAt(now) }),

    wrote(e, index, t) {
      if (index === undefined) wipes.delete(e);
      else wipes.set(e, { index, t0: t });
      dirty = true;
    },
    wipeOf: (e) => wipes.get(e),
    landed: (e) => landedOf.get(e) ?? 0,

    caretIndexAt(e, wx, wy) {
      const en = entries.get(e);
      const L = en?.layout;
      const G = en?.geometry;
      if (en === undefined || L === undefined || G === undefined) return undefined;
      const [qx, qy] = localOf(G, wx, wy);
      return caretIndexIn(L, qx / G.scale + en.w / 2, qy / G.scale + en.h / 2, en.text.length);
    },

    noteAt(wx, wy) {
      let best: Entity | undefined;
      let bestOrder = -1;
      for (const [e, en] of entries) {
        // the builder's word on what is drawn and in what order (D6), else this writing's own draws of the last render
        const order = drawn !== undefined ? drawn(e) : en.drawnAt === render ? en.order : undefined;
        if (order === undefined || en.geometry === undefined || order <= bestOrder) continue;
        if (sdPaper(en.geometry, wx, wy) < 0) { best = e; bestOrder = order; }
      }
      return best;
    },

    forget(e) {
      const en = entries.get(e);
      if (en !== undefined) { unask(e, en); release(opts.pages(), en); entries.delete(e); }
      wipes.delete(e);
      landedOf.delete(e);
      if (focus?.entity === e) { focus = undefined; dirty = true; }
    },

    reset() {
      queue?.clear(OWNER);
      entries.clear();
      wipes.clear();
      opts.pages()?.reset(true);
      dirty = true;
    },

    stats() {
      let resident = 0;
      let pinned = 0;
      let queued = 0;
      for (const [e, en] of entries) { if (en.raster !== null) resident += 1; if (en.pinned) pinned += 1; if (en.want !== 0 && queue?.has(OWNER, e) !== false) queued += 1; }
      return { resident, pinned, layouts, rasters, blanks, evicted, queued };
    },

    dispose() {
      queue?.clear(OWNER);
      entries.clear();
      wipes.clear();
      focus = undefined;
    },
  };
}
