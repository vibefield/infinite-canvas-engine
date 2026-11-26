// THE INK ACTS (petition I60 — ink-bar A, "the selection bar comes to the words"; ink-colour A, the desk's pens by name; ink-scratch A,
// a line through): the WORDS acts every written object shares (core's `MenuActionDef`, `on: "words"`), declared once with its type —
// `defineObject({ menu: inkActs({ marks }) })`, a plugin's export alike — from the marks its words may take: PEN ▾ (the desk's pens by
// name, each a swatch in the host's colour for `pen.<name>`; the sheet's own pen clears the pen), HIGHLIGHT ▾ (the desk's highlighters, and None), STRIKE
// and UNDERLINE (toggles: on when every selected letter carries one; pressed again they lift it), and CLEAR (all four). Each is ONE
// undoable step on the object's ink cell (`api.setProps`, the marks alone moving; nothing at all when nothing would move).
//
// The acts are STATIC and the typing is per desk: an act finds the typing on its object through the kit's registry (`inkTypingOn` —
// kit/ink-typing.ts), so with a draft open there it LANDS the draft first, its own step, and then marks — the range it is told is the
// editor's, so the draft's indices. With no typing on the object (an agent's act on stored props, another desk's object) it marks the
// stored cell. A toggle's `state` (its `pressed`, petition I61's state) and a choice act's `choices` (I62's, the letters' common one
// `current`) read the same words — the draft while one is open, else the cell — and write nothing.
//
// THE MARKS' KEYS (the design's): ⇧⌘X Strike, ⌘U Underline, ⇧⌘H Highlight — declared on the acts as a host's tip prints them
// (`MenuActionDef.keys`) and read by the written part while words are selected (`inkKeyOf`, kit/ink-part.ts: a host's bar reads no act
// id). ⌘ or Ctrl, as the keymap's `mod` reads them. Highlight's key (and its press without a choice) takes the highlighter LAST CHOSEN
// on this desk in this visit — yellow at first — and lifts it where every letter carries one.

import type { ActChoice, Entity, HeldGlyph, MenuActionApi, MenuActionDef, MenuActionStateContext, World } from "@ice/core";
import { encodeMarks, highlightOf, type InkChange, type InkValue, inkOf, mark, penOf, strikeOf, underlineOf } from "./ink";
import { INK_FIELDS, type InkField, inkTypingOn } from "./ink-typing";
import { HIGHLIGHTERS, type HighlighterName, PENS, type PenName } from "./text";

/** The ink acts' ids (`ops.runMenuAction(id, taken?, { range })`) — `ink.`-named, so a kind's own act ("clear") never meets one. */
export const INK_ACTS = { pen: "ink.pen", highlight: "ink.highlight", strike: "ink.strike", underline: "ink.underline", clear: "ink.clear" } as const;

/** The highlighter act's choice that lifts the highlight. */
export const NO_HIGHLIGHT = "none" as const;

/** The marks that have a KEY: their chord (⌘ or Ctrl — `mod` —, ⇧ or not, the key) and the key as a tip prints it. */
export const INK_KEYS = {
  strike: { keys: "⇧⌘X", key: "x", shift: true },
  underline: { keys: "⌘U", key: "u", shift: false },
  highlight: { keys: "⇧⌘H", key: "h", shift: true },
} as const;
export type InkKeyed = keyof typeof INK_KEYS;

/** A key press as the marks' keys read it (a `KeyboardEvent`'s fields). */
export interface InkKeyPress {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

/** The mark a key press names (`INK_KEYS`): ⌘ or Ctrl, no ⌥, ⇧ exactly as its chord says, the key case-blind — undefined for any other. */
export function inkKeyOf(ev: InkKeyPress): InkKeyed | undefined {
  if (!(ev.metaKey || ev.ctrlKey) || ev.altKey || typeof ev.key !== "string") return undefined;
  const k = ev.key.toLowerCase();
  for (const field of Object.keys(INK_KEYS) as InkKeyed[]) {
    const chord = INK_KEYS[field];
    if (chord.key === k && chord.shift === ev.shiftKey) return field;
  }
  return undefined;
}

/** The highlighter last chosen on each desk (its world) in this visit — the key's, yellow (the first) until one is. */
const LAST_HIGHLIGHTER = new WeakMap<World, HighlighterName>();

export interface InkActsOptions {
  /** The fields the words may take — an act each, Clear with any (`INK_FIELDS` by default). Give the part (`inkPart`) the same. */
  readonly marks?: readonly InkField[];
  /** The ink cell's group whose open draft an act lands first ("ink", as `inkTyping`'s). */
  readonly ink?: string;
  /**
   * The sheet's OWN pen (the pen an unmarked letter is written in): what choosing it means — the pen field cleared — and the name the
   * words' common pen is said by. Its `pen` prop by default (one of `PENS`); undefined: no pen of its own, every choice a pen of its own.
   */
  readonly sheetPen?: (props: Readonly<Record<string, unknown>>) => PenName | undefined;
  /** An act's glyph instead of the kit's (a name of the host bar's set, or a drawing in the bar's 24-unit box). */
  readonly glyphs?: Partial<Readonly<Record<InkField | "clear", HeldGlyph>>>;
  /**
   * A swatch ROLE's colour as CSS (`pen.ball`, `highlight.yellow` — the roles `inkPart`'s `colour` is asked by): each pen's and each
   * highlighter's choice shows it as its swatch (I62's, a CSS colour), asked each time the choices are read, so a theme the host
   * changes follows. The kit names no colour: absent, or undefined for a role, the choice has no swatch (its label alone).
   */
  readonly colour?: (role: string) => string | undefined;
}

/**
 * The kit's glyphs: NAMES of a host bar's set — `pen`, `highlighter`, `strike`, `underline`, `clear-marks` (ICE's React bar draws all
 * five), so a host with a set of its own gives them its look. Pen's and Highlight's are a pen's and a highlighter's, so a host draws a
 * choice act's swatches as a pen's dots or a highlighter's stripes by the act's glyph, never by its id.
 */
const GLYPHS: Readonly<Record<InkField | "clear", HeldGlyph>> = {
  pen: "pen",
  highlight: "highlighter",
  strike: "strike",
  underline: "underline",
  clear: "clear-marks",
};

/** A name as a label: its first letter raised ("felt" → "Felt"). */
const titled = (name: string): string => `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
const SPACE_LIKE = /\s/;

/** The sheet's own pen by default: its `pen` prop when that is one of the desk's pens. */
const PEN_PROP = (props: Readonly<Record<string, unknown>>): PenName | undefined => {
  const v = props.pen;
  return (PENS as readonly unknown[]).includes(v) ? (v as PenName) : undefined;
};

/** A stored prop as a string (a stranger's value reads ""). */
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** The words of `e` an act reads: the draft while the typing on it holds one, else its stored cell. */
function wordsOf(api: MenuActionStateContext, e: Entity, ink: string): InkValue {
  const live = inkTypingOn(api.world, e, ink)?.ink(e);
  if (live !== undefined) return live;
  const p = api.props(e);
  return inkOf({ text: str(p.text), seeds: str(p.seeds), marks: str(p.marks) }, typeof p.seed === "number" ? p.seed : 0);
}

// ---------------------------------------------------------------------------------- what the acts read: an ink and a range
// Plain functions of an ink and a range, apart from the act definitions below that call them (and an agent's tool alike), so the
// acts' shape can move without them.

/** The range's LETTERS' marks — every unit but a space or a break (a mark is the letters'); for a range of spaces alone, its units'. */
function lettersOf(ink: InkValue, from: number, to: number): number[] {
  const n = ink.text.length;
  const a = Math.max(0, Math.min(from, to, n));
  const b = Math.min(n, Math.max(from, to, 0));
  const out: number[] = [];
  for (let i = a; i < b; i++) if (!SPACE_LIKE.test(ink.text.charAt(i))) out.push(ink.marks[i] ?? 0);
  if (out.length === 0) for (let i = a; i < b; i++) if (ink.text.charCodeAt(i) !== 10) out.push(ink.marks[i] ?? 0);
  return out;
}

/** One value every letter shares, or undefined (none, or two). */
function shared<T>(values: readonly T[]): T | undefined {
  const first = values[0];
  return first !== undefined && values.every((v) => v === first) ? first : undefined;
}

/** The field readers by name. */
const FIELD_OF: Readonly<Record<InkField, (m: number) => number>> = { pen: penOf, highlight: highlightOf, strike: strikeOf, underline: underlineOf };

/**
 * The PEN the letters of [from, to) share (petition I60 — the Pen act's `current` choice): its name, a letter in the sheet's own pen
 * named by `own` (the sheet's pen; absent, such a letter names none) — undefined when they write in two, or there is no letter.
 */
export function inkCommonPen(ink: InkValue, from: number, to: number, own?: PenName): PenName | undefined {
  return shared(lettersOf(ink, from, to).map((m) => (penOf(m) === 0 ? own : PENS[penOf(m) - 1])));
}

/** The HIGHLIGHTER the letters of [from, to) share (the Highlight act's `current` choice): its name, `none` when none carries one — undefined when they differ, or there is no letter. */
export function inkCommonHighlighter(ink: InkValue, from: number, to: number): HighlighterName | typeof NO_HIGHLIGHT | undefined {
  return shared(lettersOf(ink, from, to).map((m) => (highlightOf(m) === 0 ? NO_HIGHLIGHT : (HIGHLIGHTERS[highlightOf(m) - 1] as HighlighterName))));
}

/** Does EVERY letter of [from, to) carry `field` (a toggle's state, its `pressed` — Strike, Underline)? False for no letter at all. */
export function inkEveryLetter(ink: InkValue, from: number, to: number, field: InkField): boolean {
  const ms = lettersOf(ink, from, to);
  const of = FIELD_OF[field];
  return ms.length > 0 && ms.every((m) => of(m) !== 0);
}

// ------------------------------------------------------------------------------------------------ the act definitions

/**
 * THE INK ACTS (module doc) for a type whose words take `marks`: PEN ▾ (`ink.pen`), HIGHLIGHT ▾ (`ink.highlight`), STRIKE
 * (`ink.strike`), UNDERLINE (`ink.underline`) — the ones `marks` names, in that order — and CLEAR (`ink.clear`) with any of them; none
 * for no marks. Every act is `on: "words"`: offered while the object is written and words are selected (`SelectionAnchor.words`),
 * run on the words it is told (`ops.runMenuAction(id, taken?, { range })`).
 */
export function inkActs(opts: InkActsOptions = {}): MenuActionDef[] {
  const allowed = new Set<InkField>(opts.marks ?? INK_FIELDS);
  const ink = opts.ink ?? "ink";
  const sheetPen = opts.sheetPen ?? PEN_PROP;
  const glyph = (k: InkField | "clear"): HeldGlyph => opts.glyphs?.[k] ?? GLYPHS[k];

  /** A choice's swatch: the host's colour for its role, or none. */
  const swatchOf = (role: string): { readonly swatch?: string } => {
    const c = opts.colour?.(role);
    return c === undefined ? {} : { swatch: c };
  };
  /**
   * ONE step on the cell: an open draft on the object landed first (its own step — the range is the draft's indices), then the change
   * `of` says for the stored words over the range — the marks written alone, nothing when they would not move.
   */
  const marking = (api: MenuActionApi, of: (words: InkValue, from: number, to: number) => InkChange | undefined): void => {
    const r = api.range;
    if (r === undefined || !api.world.isAlive(r.entity)) return;
    const t = inkTypingOn(api.world, r.entity, ink);
    if (t?.open() === true) t.commit();
    const p = api.props(r.entity);
    const words = inkOf({ text: str(p.text), seeds: str(p.seeds), marks: str(p.marks) }, 0);
    const change = of(words, r.from, r.to);
    if (change === undefined) return;
    const was = encodeMarks(words.marks);
    const next = encodeMarks(mark(words, r.from, r.to, change).marks);
    if (next !== was) api.setProps(r.entity, { marks: next });
  };
  /** A toggle: on when every letter carries the field; pressed, the field set (in the words' own pen) or, when on, lifted. */
  const toggle = (field: "strike" | "underline", label: string): MenuActionDef => ({
    id: INK_ACTS[field],
    label,
    glyph: glyph(field),
    keys: INK_KEYS[field].keys,
    on: "words",
    state: (ctx) => (ctx.range === undefined ? undefined : { pressed: inkEveryLetter(wordsOf(ctx, ctx.range.entity, ink), ctx.range.from, ctx.range.to, field) }),
    run: (api) => marking(api, (words, from, to) => {
      const on = inkEveryLetter(words, from, to, field);
      return field === "strike" ? { strike: !on } : { underline: !on };
    }),
  });

  const acts: MenuActionDef[] = [];
  if (allowed.has("pen")) {
    acts.push({
      id: INK_ACTS.pen,
      label: "Pen",
      glyph: glyph("pen"),
      on: "words",
      // the desk's pens, the letters' common one current — the sheet's own named by the sheet's pen
      choices: (ctx): ActChoice[] => {
        const r = ctx.range;
        const now = r === undefined ? undefined : inkCommonPen(wordsOf(ctx, r.entity, ink), r.from, r.to, sheetPen(ctx.props(r.entity)));
        return PENS.map((name) => ({ id: name, label: `${titled(name)} pen`, ...swatchOf(`pen.${name}`), ...(name === now ? { current: true } : {}) }));
      },
      // the sheet's own pen clears the pen field; any other is the letters' own; a key's press (no choice) chooses nothing
      run: (api, taken) => marking(api, () => {
        const choice = taken?.id;
        if (choice === undefined || api.range === undefined) return undefined;
        return { pen: choice === sheetPen(api.props(api.range.entity)) ? null : (choice as PenName) };
      }),
    });
  }
  if (allowed.has("highlight")) {
    acts.push({
      id: INK_ACTS.highlight,
      label: "Highlight",
      glyph: glyph("highlight"),
      keys: INK_KEYS.highlight.keys,
      on: "words",
      // the desk's highlighters and None, the letters' common one current — `none` when none carries one
      choices: (ctx): ActChoice[] => {
        const now = ctx.range === undefined ? undefined : inkCommonHighlighter(wordsOf(ctx, ctx.range.entity, ink), ctx.range.from, ctx.range.to);
        const cur = (id: string): { readonly current?: true } => (id === now ? { current: true } : {});
        return [...HIGHLIGHTERS.map((name) => ({ id: name, label: titled(name), ...swatchOf(`highlight.${name}`), ...cur(name) })), { id: NO_HIGHLIGHT, label: "None", ...cur(NO_HIGHLIGHT) }];
      },
      // a highlighter by name (the desk's last chosen now), None lifting it; a key's press (no choice): the last chosen — the first
      // until one is —, or lifted where every letter has one
      run: (api, taken) => marking(api, (words, from, to) => {
        const choice = taken?.id;
        if (choice === NO_HIGHLIGHT) return { highlight: null };
        if (choice !== undefined) {
          LAST_HIGHLIGHTER.set(api.world, choice as HighlighterName);
          return { highlight: choice as HighlighterName };
        }
        return inkEveryLetter(words, from, to, "highlight") ? { highlight: null } : { highlight: LAST_HIGHLIGHTER.get(api.world) ?? HIGHLIGHTERS[0] };
      }),
    });
  }
  if (allowed.has("strike")) acts.push(toggle("strike", "Strike"));
  if (allowed.has("underline")) acts.push(toggle("underline", "Underline"));
  if (acts.length > 0) acts.push({ id: INK_ACTS.clear, label: "Clear", glyph: glyph("clear"), on: "words", run: (api) => marking(api, () => ({ clear: true })) });
  return acts;
}
