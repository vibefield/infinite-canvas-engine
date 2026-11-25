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

import type { ActChoice, Entity, HeldGlyph, MenuActionApi, MenuActionDef, MenuActionStateContext } from "@ice/core";
import { encodeMarks, highlightOf, type InkChange, type InkValue, inkOf, mark, penOf, strikeOf, underlineOf } from "./ink";
import { INK_FIELDS, type InkField, inkTypingOn } from "./ink-typing";
import { HIGHLIGHTERS, type HighlighterName, PENS, type PenName } from "./text";

/** The ink acts' ids (`ops.runMenuAction(id, taken?, { range })`) — `ink.`-named, so a kind's own act ("clear") never meets one. */
export const INK_ACTS = { pen: "ink.pen", highlight: "ink.highlight", strike: "ink.strike", underline: "ink.underline", clear: "ink.clear" } as const;

/** The highlighter act's choice that lifts the highlight. */
export const NO_HIGHLIGHT = "none";

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

/** The kit's glyphs: the bar's own `pen` and `eraser`, and drawings for the rest (SVG path data, the bar's 24-unit box, stroked). */
const GLYPHS: Readonly<Record<InkField | "clear", HeldGlyph>> = {
  pen: "pen",
  highlight: { path: "M5 20h14M8.5 16.5l-1.5-1.5 8-8a1.8 1.8 0 0 1 2.5 0l.5.5a1.8 1.8 0 0 1 0 2.5l-8 8z" },
  strike: { path: "M5 12h14M16 7.5C15.3 6 13.8 5 12 5c-2.2 0-4 1.3-4 3.1 0 1.3.9 2.3 2.4 2.9M8 16.5c.7 1.5 2.2 2.5 4 2.5 2.2 0 4-1.3 4-3.1 0-.7-.3-1.4-.8-1.9" },
  underline: { path: "M7.5 4.5v6a4.5 4.5 0 0 0 9 0v-6M5.5 20h13" },
  clear: "eraser",
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
  /** The words' letters' marks for the context's range (none without one). */
  const letters = (ctx: MenuActionStateContext): number[] => {
    const r = ctx.range;
    return r === undefined ? [] : lettersOf(wordsOf(ctx, r.entity, ink), r.from, r.to);
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
  const toggle = (field: "strike" | "underline", label: string, of: (m: number) => number): MenuActionDef => ({
    id: INK_ACTS[field],
    label,
    glyph: glyph(field),
    on: "words",
    state: (ctx) => { const ms = letters(ctx); return ctx.range === undefined ? undefined : { pressed: ms.length > 0 && ms.every((m) => of(m) !== 0) }; },
    run: (api) => marking(api, (words, from, to) => {
      const ms = lettersOf(words, from, to);
      const on = ms.length > 0 && ms.every((m) => of(m) !== 0);
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
        const own = r === undefined ? undefined : sheetPen(ctx.props(r.entity));
        const now = r === undefined ? undefined : shared(letters(ctx).map((m) => (penOf(m) === 0 ? own : PENS[penOf(m) - 1])));
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
      on: "words",
      // the desk's highlighters and None, the letters' common one current — `none` when none carries one
      choices: (ctx): ActChoice[] => {
        const now = ctx.range === undefined ? undefined : shared(letters(ctx).map((m) => (highlightOf(m) === 0 ? NO_HIGHLIGHT : (HIGHLIGHTERS[highlightOf(m) - 1] as string))));
        const cur = (id: string): { readonly current?: true } => (id === now ? { current: true } : {});
        return [...HIGHLIGHTERS.map((name) => ({ id: name, label: titled(name), ...swatchOf(`highlight.${name}`), ...cur(name) })), { id: NO_HIGHLIGHT, label: "None", ...cur(NO_HIGHLIGHT) }];
      },
      // a highlighter by name, None lifting it; a key's press (no choice): the first highlighter, or lifted where every letter has one
      run: (api, taken) => marking(api, (words, from, to) => {
        const choice = taken?.id;
        if (choice === NO_HIGHLIGHT) return { highlight: null };
        if (choice !== undefined) return { highlight: choice as HighlighterName };
        const ms = lettersOf(words, from, to);
        return ms.length > 0 && ms.every((m) => highlightOf(m) !== 0) ? { highlight: null } : { highlight: HIGHLIGHTERS[0] };
      }),
    });
  }
  if (allowed.has("strike")) acts.push(toggle("strike", "Strike", strikeOf));
  if (allowed.has("underline")) acts.push(toggle("underline", "Underline", underlineOf));
  if (acts.length > 0) acts.push({ id: INK_ACTS.clear, label: "Clear", glyph: glyph("clear"), on: "words", run: (api) => marking(api, () => ({ clear: true })) });
  return acts;
}
