// THE WRITTEN PART (petition I60 — the editing is the desk's own, so a downstream object gets it whole, shows it in its menu and
// hands it to an agent): one helper that gives a kind's objects the whole of the desk's writing — typing, the caret, the selection by
// drag, word and line, the clipboard in three flavours, a paste in a fresh hand — so a kind DECLARES what only it knows and writes no
// selection, no clipboard and no typing of its own. What it declares is its GEOMETRY (`InkGeometry`: its writing as last laid, a
// world point in the layout's units and back, where the editor's textarea stands), its ink cell (the group holding `text`, `seeds`,
// `marks`), the marks its words may take, and a SINK its render half draws from (`InkSink`: the draft, the caret, the selection —
// drawing is the kind's). `inkPart` answers the desk's taps on its objects with a LEASE on the ONE editor whose every member the kit
// fills: the typing's (kit/ink-typing.ts — the DRAFT, landed in one step), the ink's verbs and geometry (kit/ink.ts — `indexIn`,
// `wordAt`, `lineAt`, `spansOf`, `lift`, `paste`, `cleanPiece`), and the lease's own word for the words' menu (`entity`, `rangeBox`),
// so the object's words acts (`inkActs`) come to the words selected.
//
// The CLIPBOARD's three flavours (the lease's `lift`): the words as plain text; `text/html` styled by the marks (`inkHtml` — `<mark>`,
// `<s>`, `<u>`, a pen's colour where the kind names one); and the kind's PIECE, `{ text, marks }` as JSON under the desk's private
// flavour, read back by any written part (the marks are kept by name — kit/ink.ts). A PASTE (the lease's `lay`) reads the piece as a
// stranger's — else the plain words — through `cleanPiece` (the kind's `keep` and `max`), lays it on the draft in a fresh hand, the
// marks the kind keeps only, and writes the field through the editor (`DeskEditor.write`), whose input then changes nothing.
// DOM-free: the part reads the editor it is handed (its element's value and range), never a global.

import { Active, type Entity, Grab, guardedTransaction, type MenuActionApi, PrefabId, setWidgetProps } from "@ice/core";
import { writable } from "../docs";
import type { ObjectDomHost } from "../kinds/world";
import type { EditorLease, EditorLift, EditorPlace, RangeBox, TextPart } from "./editor";
import { cleanPiece, decodeMarks, highlightOf, indexIn, type InkPiece, type InkValue, lineAt, penOf, spansOf, strikeOf, underlineOf, wordAt } from "./ink";
import { INK_ACTS, inkKeyOf } from "./ink-acts";
import { INK_FIELDS, type InkField, type InkSink, type InkTyping, inkTyping } from "./ink-typing";
import { HIGHLIGHTERS, type HandLayout, PENS } from "./text";

/**
 * What only the KIND knows of where its writing lies (petition I60): its layout as last laid and the two maps between the world and
 * the layout's own units (`layoutText`'s: from the writing box's top-left, y down — a sheet's turn and its held scale in them), and
 * where the editor's textarea stands. The part reads nothing else of the kind's drawing.
 */
export interface InkGeometry {
  /** `e`'s writing as last laid (`layoutText`'s — the draft's while one is open: the sink feeds it), undefined before its first. */
  layout(e: Entity): HandLayout | undefined;
  /** A world point in `e`'s layout units — undefined OFF THE PART (a press there is not its writing's; a tap there puts the caret at the end). */
  toLayout(e: Entity, wx: number, wy: number): readonly [number, number] | undefined;
  /** A point of `e`'s layout units in the world (a range's box, turned with the sheet) — undefined when `e` is not drawn. */
  toWorld(e: Entity, x: number, y: number): readonly [number, number] | undefined;
  /** Where the textarea stands while `e` is written (container px — `EditorPlace`); null keeps it where it was. */
  place(e: Entity): EditorPlace | null;
  /** The topmost of the part's objects drawn at a world point — asked for a tap whose pointer is gone (a touch lifted); absent, such a tap takes nothing. */
  objectAt?(wx: number, wy: number): Entity | undefined;
}

export interface InkPartOptions {
  /** The text part's name ("comment-pad.sheet") — what the lease carries (`DeskEditor.lease().part`). */
  readonly part: string;
  /** The textarea's accessible name while one of its objects is written ("write on the comment pad"). */
  readonly label: string;
  readonly geometry: InkGeometry;
  /** The ink cell's group ("ink" unless the kind says — `inkTyping`'s). */
  readonly ink?: string;
  /** The fields its words may take (`INK_FIELDS` by default): a paste keeps these alone — give `inkActs` the same. */
  readonly marks?: readonly InkField[];
  /** Is `e` one of the part's objects? Default: an object of the type the part was declared on (`ObjectDomHost.object`). */
  readonly accepts?: (e: Entity) => boolean;
  /** What its render half is told: the draft, the caret, the selection (the wash). */
  readonly sink?: InkSink;
  /** A swatch ROLE's colour as CSS (`pen.ball`, `highlight.yellow` — the menu's own role names) for the copy's `text/html`; absent or undefined: the tags alone. */
  readonly colour?: (role: string) => string | undefined;
  /** A character a paste may lay (`cleanPiece`'s `keep`) — by default any but a control character. */
  readonly keep?: (ch: string) => boolean;
  /** The most UTF-16 units a paste lays (`cleanPiece`'s `max`, 4000 unless the kind says). */
  readonly max?: number;
  /** A fresh seed for a glyph just written (`freshSeed` unless a test says). */
  readonly fresh?: () => number;
}

/** A kind's WRITTEN PART: its text part (the desk routes taps to it), its doors (a rig's, a key's) and its typing. */
export interface InkPart extends TextPart {
  /** Put the editor on `e`, the caret before glyph `index` (the end by default). False for another type's object, a dead one or a read-only document. */
  focus(e: Entity, index?: number): boolean;
  /** The object being written, or undefined (the editor lent elsewhere, or to nothing). */
  editing(): Entity | undefined;
  /** The typing under it (kit/ink-typing.ts): the draft, its commit. */
  readonly typing: InkTyping;
}

const NEWLINE = 10;

/**
 * A character a paste lays by default (`InkPartOptions.keep`'s, and a live typing's `lay` — `cleanPiece`'s `keep`): any but a control
 * character — the C0 controls below 32, DEL and the C1 controls, 127 to 159 — a break ("\n") kept (`cleanPiece` has made every break a
 * "\n" and every tab a space).
 */
export const printable = (ch: string): boolean => {
  const c = ch.charCodeAt(0);
  return ch === "\n" || !(c < 32 || (c >= 127 && c <= 159));
};

/**
 * The private PIECE a paste hands back (`EditorPaste.piece`, the `PIECE_FLAVOUR` a lift wrote), read as a stranger's: `{ text, marks }`
 * with words — marks that are not a string read none — else undefined (no JSON, not an object, no words).
 */
export function readPiece(json: string | undefined): InkPiece | undefined {
  if (typeof json !== "string" || json === "") return undefined;
  let v: unknown;
  try { v = JSON.parse(json); } catch { return undefined; }
  if (typeof v !== "object" || v === null) return undefined;
  const { text, marks } = v as { readonly text?: unknown; readonly marks?: unknown };
  if (typeof text !== "string" || text === "") return undefined;
  return { text, marks: typeof marks === "string" ? marks : "" };
}

/**
 * A kind's WRITTEN PART (module doc) on the desk its DOM half is declared on (`defineObject({ host: { text: (h) => [inkPart(h, { … })] } })`):
 * a `TextPart` the desk routes every tap to — the object the interaction stack hit (or, the pointer gone, the kind's `objectAt`), never
 * a carried one, its typing begun, the caret where the tap fell on the writing (the end off it) — and whose lease is COMPLETE: the
 * value, the input, the keys (Escape lets it go), the caret and the selection (told to the sink), where its writing lies and where a
 * range of it is (`indexAt`, `rangeAt`, `rangeBox`), the clipboard (`lift` in three flavours, `lay`), the textarea's place, the idle
 * commit, the end, its life, and the object it writes (`entity` — the words' menu is its own). One lease an object: a tap on the same
 * object keeps it. The part makes its typing (`inkTyping`, on `host.object`), which registers itself on the world for the acts.
 */
export function inkPart(host: Pick<ObjectDomHost, "world" | "docs" | "editor" | "object">, opts: InkPartOptions): InkPart {
  const { world, editor } = host;
  const G = opts.geometry;
  const sink = opts.sink;
  const typing = inkTyping({
    world, docs: host.docs, object: host.object,
    ...(opts.ink !== undefined ? { ink: opts.ink } : {}),
    ...(opts.marks !== undefined ? { marks: opts.marks } : {}),
    ...(sink !== undefined ? { sink } : {}),
    ...(opts.fresh !== undefined ? { fresh: opts.fresh } : {}),
  });
  const accepts = opts.accepts ?? ((e: Entity): boolean => world.isAlive(e) && world.get(e, PrefabId)?.id === host.object.type);
  const keep = opts.keep ?? printable;
  const keeps = new Set<InkField>(opts.marks ?? INK_FIELDS);
  /**
   * The act api a MARK'S KEY runs the type's own act with (as `ops.runMenuAction` hands one): the object and the words, its props as
   * the world holds them, and the document's writer's gate — no document, or a read-only one, writes nothing.
   */
  const actApi = (e: Entity, from: number, to: number): MenuActionApi => ({
    world,
    entities: [e],
    range: { entity: e, from, to },
    props: (x) => Object.assign({}, ...host.object.groups.map((g) => (world.get(x, g.component) as Record<string, unknown> | undefined) ?? {})),
    setProps(x, props, o) {
      const s = writable(host.docs);
      if (s === undefined || !world.isAlive(x)) return false;
      setWidgetProps(s.store, world, x, props, o?.undoable === false ? { undoable: false } : undefined);
      return true;
    },
    transact(fn, o) {
      const s = writable(host.docs);
      if (s === undefined) return false;
      guardedTransaction(s.store, world, fn, o?.undoable === false ? { undoable: false } : undefined);
      return true;
    },
  });
  /**
   * A MARK'S KEY on `e` (`inkKeyOf` — ⇧⌘X, ⌘U, ⇧⌘H): the type's own words act for it run on the field's range — only while words are
   * selected, the part keeps that mark and the type declares the act; false otherwise, so the platform's own ⌘U and ⌘X stand.
   */
  const markKey = (e: Entity, ev: KeyboardEvent): boolean => {
    const field = inkKeyOf(ev);
    if (field === undefined || !keeps.has(field)) return false;
    const el = editor.element;
    const from = Math.min(el.selectionStart, el.selectionEnd);
    const to = Math.max(el.selectionStart, el.selectionEnd);
    if (to <= from || !world.isAlive(e)) return false;
    const act = host.object.menu.find((a) => a.id === INK_ACTS[field] && a.on === "words");
    if (act === undefined) return false;
    act.run(actApi(e, from, to));
    return true;
  };
  /** The object being written and ITS lease — one lease an object, so a tap on the same object keeps it and a tap on another hands over. */
  let current: { readonly entity: Entity; readonly lease: EditorLease } | undefined;

  /** The field's words — what the editor's indices index. */
  const field = (): string => editor.element.value;
  /** `e`'s words where the field's indices hold: the typing's ink when its words are the field's (a peer's edit the field has not followed yet: none). */
  const inkAtField = (e: Entity): InkValue | undefined => {
    const ink = typing.ink(e);
    return ink !== undefined && ink.text === field() ? ink : undefined;
  };
  /** The caret index nearest a world point on `e`'s writing (`length` its words'), or undefined off it (or before its first layout). */
  const indexNear = (e: Entity, wx: number, wy: number, length: number): number | undefined => {
    const L = G.layout(e);
    const q = L === undefined ? undefined : G.toLayout(e, wx, wy);
    return L === undefined || q === undefined ? undefined : indexIn(L, q[0], q[1], length);
  };
  /** Where the words [from, to) lie in the world: their wash's rects (`spansOf`), each corner through the kind's map — the box of them. */
  const boxOf = (e: Entity, from: number, to: number): RangeBox | undefined => {
    const L = G.layout(e);
    if (L === undefined) return undefined;
    let x0 = Number.POSITIVE_INFINITY;
    let y0 = Number.POSITIVE_INFINITY;
    let x1 = Number.NEGATIVE_INFINITY;
    let y1 = Number.NEGATIVE_INFINITY;
    for (const s of spansOf(L, from, to)) {
      for (const [x, y] of [[s.x0, s.y0], [s.x1, s.y0], [s.x1, s.y1], [s.x0, s.y1]] as const) {
        const w = G.toWorld(e, x, y);
        if (w === undefined) return undefined;
        x0 = Math.min(x0, w[0]);
        y0 = Math.min(y0, w[1]);
        x1 = Math.max(x1, w[0]);
        y1 = Math.max(y1, w[1]);
      }
    }
    return x1 >= x0 && Number.isFinite(x0) && Number.isFinite(y0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : undefined;
  };

  const leaseFor = (e: Entity): EditorLease => {
    /** The field's caret and range, told to the sink (an input moves them before the platform says so). */
    const tellField = (): void => {
      const el = editor.element;
      sink?.caret?.(e, el.selectionStart);
      sink?.selection?.(e, Math.min(el.selectionStart, el.selectionEnd), Math.max(el.selectionStart, el.selectionEnd));
    };
    const lease: EditorLease = {
      part: opts.part,
      // the object it writes: the words' menu is this object's by the lease's own word — no claim stamped
      entity: e,
      label: opts.label,
      // between drafts the cell's words reach the field (a peer, an undo); while a draft is open the field is the truth
      value: () => (typing.open() ? null : (typing.committed(e)?.text ?? "")),
      // the platform's value, the edit found by the caret after it (the field's `selectionEnd`)
      input(value) {
        typing.input(value, editor.element.selectionEnd);
        tellField();
      },
      // Escape lets the object go (the keymap's gate 1 stands down; the release is the part's); a mark's key marks the words selected
      keydown(ev) {
        if (ev.key !== "Escape") return markKey(e, ev);
        editor.release(lease);
        return true;
      },
      caret(index) { sink?.caret?.(e, index); },
      selection(from, to) {
        typing.moved(from, to);   // a run typed over a selection ends where the caret leaves it
        sink?.selection?.(e, from, to);
      },
      // where its writing lies: on the part as the kind drew it — a press on another object over it is that object's
      indexAt(wx, wy, hit) { return hit !== undefined && hit !== e ? undefined : indexNear(e, wx, wy, field().length); },
      rangeAt(index, unit) {
        if (unit === "word") return wordAt(field(), index);
        const L = G.layout(e);
        return L === undefined ? undefined : lineAt(L, index);
      },
      // where a range of its words lies: the menu over the words selected is placed by it
      rangeBox: (from, to) => boxOf(e, from, to),
      // a COPY or a CUT: the words, their HTML and the piece — the field's words alone where the cell moved under the field
      lift(from, to): EditorLift | undefined {
        const a = Math.min(from, to);
        const b = Math.max(from, to);
        const text = field().slice(a, b);
        if (text === "") return undefined;
        const piece = inkAtField(e) !== undefined && typing.editing() === e ? typing.lift(a, b) : undefined;
        if (piece === undefined) return { text };
        return { text: piece.text, html: inkHtml(piece, opts.colour), piece: JSON.stringify({ text: piece.text, marks: piece.marks }) };
      },
      // a PASTE: the piece (else the plain words) cleaned, laid on the draft in a fresh hand, the field written to match
      lay(paste, from, to) {
        const raw = readPiece(paste.piece) ?? { text: typeof paste.text === "string" ? paste.text : "", marks: "" };
        if (raw.text === "") return false;   // no words at all: the platform's and the page's
        if (typing.editing() !== e) return false;
        const piece = cleanPiece(raw, keep, opts.max);
        if (piece.text === "") return true;   // every character refused: nothing laid, the platform's paste stood down
        typing.input(field());   // the draft at the field's words first (a peer's edit not followed yet is the field's to write over)
        if (typing.paste(piece, from, to) === null) return true;
        editor.write(piece.text, from, to);
        return true;
      },
      place: () => G.place(e),
      idle() { typing.commit(); },
      ended() {
        if (typing.editing() === e) typing.end();
        if (current?.entity === e) {
          current = undefined;
          sink?.caret?.(undefined);
          sink?.selection?.(undefined);
        }
      },
      // a delete or a nav cut ends the writing
      live: () => world.isAlive(e) && world.hasTag(e, Active),
    };
    return lease;
  };

  /** The lease an object takes, its typing begun — or undefined: refused (not the part's, dead, a read-only document). */
  const take = (e: Entity): EditorLease | undefined => {
    if (!world.isAlive(e) || !accepts(e)) return undefined;
    if (!typing.begin(e)) return undefined;
    if (current?.entity === e && editor.lease() === current.lease) return current.lease;
    current = { entity: e, lease: leaseFor(e) };
    return current.lease;
  };

  return {
    part: opts.part,
    typing,
    tap({ wx, wy, found, hit }) {
      // the stack's exact hit when the pointer is known; the kind's topmost drawn object when it is gone (a touch lifted)
      const e = found ? hit : G.objectAt?.(wx, wy);
      if (e === undefined || !accepts(e) || world.has(e, Grab)) return undefined;
      const lease = take(e);
      if (lease === undefined) return undefined;
      // the caret among the words the field is about to hold (the object's: the field is not yet its own)
      const length = typing.ink(e)?.text.length ?? 0;
      return { lease, caret: indexNear(e, wx, wy, length) ?? length };
    },
    focus(e, index) {
      const lease = take(e);
      if (lease === undefined) return false;
      editor.lend(lease, index ?? (typing.ink(e)?.text.length ?? 0));
      return true;
    },
    editing: () => (current !== undefined && editor.lease() === current.lease ? current.entity : undefined),
  };
}

// ---------------------------------------------------------------------------------------------------------------- the HTML

/** A colour a host's palette may hand the HTML: a hex, a name, or a colour function's — nothing that can close the attribute or add a declaration. */
const SAFE_COLOUR = /^(#[0-9a-f]{3,8}|[a-z]+|(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\([0-9a-z.,%\s/+-]*\))$/i;
const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/**
 * A PIECE as HTML for another app (`text/html` — petition I60): its words, each run of one mark (never across a break) in the tags
 * that say it — `<mark>` a highlight, `<s>` a line through, `<u>` a line under — inside its pen's colour. A colour is given only where
 * `colour(role)` answers one for the SWATCH role the words' menu names (`pen.<name>`, `highlight.<name>`; a line in the words' own pen
 * takes theirs): the kit names no colour, the host's palette does — without it the tags alone. The text is escaped, a break is a
 * `<br>`, and spaces are kept (`white-space: pre-wrap`).
 */
export function inkHtml(piece: InkPiece, colour?: (role: string) => string | undefined): string {
  const text = typeof piece.text === "string" ? piece.text : "";
  const marks = decodeMarks(typeof piece.marks === "string" ? piece.marks : "", text);
  const tint = (role: string): string | undefined => {
    const c = colour?.(role);
    return typeof c === "string" && SAFE_COLOUR.test(c.trim()) ? c.trim() : undefined;
  };
  /** A line's colour: a pen's by its number (n ≥ 2: `PENS[n − 2]`); 1 — the words' own pen — none of its own. */
  const lineTint = (v: number): string | undefined => (v >= 2 ? tint(`pen.${PENS[v - 2] as string}`) : undefined);
  let out = "";
  for (let i = 0; i < text.length; ) {
    if (text.charCodeAt(i) === NEWLINE) {
      out += "<br>";
      i += 1;
      continue;
    }
    const m = marks[i] as number;
    let j = i + 1;
    while (j < text.length && marks[j] === m && text.charCodeAt(j) !== NEWLINE) j += 1;
    let s = escapeHtml(text.slice(i, j));
    const under = underlineOf(m);
    const strike = strikeOf(m);
    const high = highlightOf(m);
    const pen = penOf(m);
    if (under > 0) { const c = lineTint(under); s = `<u${c === undefined ? "" : ` style="text-decoration-color:${c}"`}>${s}</u>`; }
    if (strike > 0) { const c = lineTint(strike); s = `<s${c === undefined ? "" : ` style="text-decoration-color:${c}"`}>${s}</s>`; }
    if (high > 0) { const c = tint(`highlight.${HIGHLIGHTERS[high - 1] as string}`); s = `<mark${c === undefined ? "" : ` style="background-color:${c}"`}>${s}</mark>`; }
    if (pen > 0) { const c = tint(`pen.${PENS[pen - 1] as string}`); if (c !== undefined) s = `<span style="color:${c}">${s}</span>`; }
    out += s;
    i = j;
  }
  return `<span style="white-space:pre-wrap">${out}</span>`;
}
