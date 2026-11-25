/**
 * AN ACT MAY BE A CHOICE (petition I62) — for the selection menu's acts and the held bar's tools alike: what a kind offers is sometimes
 * not one op but one of several (a browser pane's device, a phone's finish), and one of them may ask for a few values first (the
 * pane's Custom: a width, a height, an agent). The kind says its choices NOW (`choices(ctx)`, read with the anchor as its state is —
 * I49, I61), as plain data the host draws as rows, the current one marked; the host takes one (`ops.runMenuAction(id, taken)`,
 * `ops.useHeldTool(id, taken)`), and core hands it to the act's `run` only when it is one of the act's choices now and its values
 * fit its fields. A kind's choices are never drawn by ICE's own words: the host prints what the kind declares.
 */
import { isSwatch } from "./swatch";

/** A value a choice asks for before it acts (petition I62): a number or a short text, its value now, its bounds. */
export interface ActChoiceField {
  /** Unique within its choice: the key its value is handed under. */
  readonly id: string;
  /** Its name — the field's label and accessible name ("Width"). */
  readonly label: string;
  readonly kind: "number" | "text";
  /** Its value now (the pane's width; a text field's agent, "" for none). */
  readonly value: number | string;
  /** A number's bounds (inclusive) and its step, counted from `min` (or 0): a value off its step does not fit. */
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** A text's longest value (default 2048). */
  readonly maxLength?: number;
  /** Shown while a text field is empty ("The browser's own"). */
  readonly placeholder?: string;
}

/** One choice of an act that is a choice (petition I62): plain data — a row of the host's list. */
export interface ActChoice {
  /** Unique within the act: what the host hands back when it is taken. */
  readonly id: string;
  /** Its name — the row's label and accessible name ("iPhone 17 Pro"). */
  readonly label: string;
  /** Said at the row's end, in the key's place (a device's size, "402 × 874"). */
  readonly hint?: string;
  /** A colour shown at the row's start (a phone's finish), CSS — the kind's own word, never parsed here. */
  readonly swatch?: string;
  /** The one the object is on now: the host marks it. */
  readonly current?: boolean;
  /** Choices sharing a group are drawn together; a change of group between two choices is a rule (Turn to landscape). */
  readonly group?: string;
  /** The values this choice asks for before it acts, drawn under its row when it is taken. */
  readonly fields?: readonly ActChoiceField[];
}

/** What the host hands back when a choice is TAKEN (petition I62): its id, and the values its fields were given. */
export interface ActChoiceTaken {
  readonly id: string;
  readonly values?: Readonly<Record<string, number | string>>;
}

const MAX_CHOICES = 64;
const MAX_FIELDS = 8;
const DEFAULT_TEXT = 2048;
const word = (s: unknown, max: number): s is string => typeof s === "string" && s.length > 0 && s.length <= max;
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** One field as a host may draw it, or undefined when it is not one (a choice with such a field is dropped whole). */
function fieldOf(f: unknown): ActChoiceField | undefined {
  if (typeof f !== "object" || f === null) return undefined;
  const v = f as Partial<ActChoiceField>;
  if (!word(v.id, 64) || !word(v.label, 120)) return undefined;
  if (v.kind === "number") {
    if (!finite(v.value)) return undefined;
    if ((v.min !== undefined && !finite(v.min)) || (v.max !== undefined && !finite(v.max)) || (v.step !== undefined && !(finite(v.step) && v.step > 0))) return undefined;
    if (v.min !== undefined && v.max !== undefined && v.min > v.max) return undefined;
    return { id: v.id, label: v.label, kind: "number", value: v.value, ...(v.min !== undefined ? { min: v.min } : {}), ...(v.max !== undefined ? { max: v.max } : {}), ...(v.step !== undefined ? { step: v.step } : {}) };
  }
  if (v.kind === "text") {
    const maxLength = v.maxLength === undefined ? DEFAULT_TEXT : v.maxLength;
    if (!(Number.isInteger(maxLength) && maxLength >= 1 && maxLength <= 4096)) return undefined;
    if (typeof v.value !== "string" || v.value.length > maxLength) return undefined;
    return { id: v.id, label: v.label, kind: "text", value: v.value, ...(v.maxLength !== undefined ? { maxLength } : {}), ...(word(v.placeholder, 120) ? { placeholder: v.placeholder } : {}) };
  }
  return undefined;
}

/** One choice as a host may draw it, or undefined when it is not one. */
function choiceOf(c: unknown): ActChoice | undefined {
  if (typeof c !== "object" || c === null) return undefined;
  const v = c as Partial<ActChoice>;
  if (!word(v.id, 64) || !word(v.label, 120)) return undefined;
  let fields: ActChoiceField[] | undefined;
  if (v.fields !== undefined) {
    if (!Array.isArray(v.fields) || v.fields.length === 0 || v.fields.length > MAX_FIELDS) return undefined;
    fields = [];
    const seen = new Set<string>();
    for (const f of v.fields) {
      const field = fieldOf(f);
      if (field === undefined || seen.has(field.id)) return undefined;
      seen.add(field.id);
      fields.push(field);
    }
  }
  return {
    id: v.id,
    label: v.label,
    ...(word(v.hint, 64) ? { hint: v.hint } : {}),
    ...(isSwatch(v.swatch) ? { swatch: v.swatch } : {}),
    ...(v.current === true ? { current: true } : {}),
    ...(word(v.group, 32) ? { group: v.group } : {}),
    ...(fields !== undefined ? { fields } : {}),
  };
}

/**
 * An act's choices NOW, read safely (petition I62, as its state is — I49, I61): its `choices(ctx)` with only what is well-formed kept —
 * at most 64, each with an id unique among them and a label; a hint, a swatch, a group, the current mark, and fields that are fields
 * (a choice with one that is not is dropped whole: it could not be taken safely) — or undefined: none declared, nothing said, nothing
 * well-formed, or it THREW (`threw` is told; the act stands as one op).
 */
export function readActChoices<C>(def: { readonly choices?: (ctx: C) => readonly ActChoice[] | undefined }, ctx: C, threw?: (err: unknown) => void): readonly ActChoice[] | undefined {
  if (def.choices === undefined) return undefined;
  let said: unknown;
  try { said = def.choices(ctx); } catch (err) { threw?.(err); return undefined; }
  if (!Array.isArray(said)) return undefined;
  const out: ActChoice[] = [];
  const seen = new Set<string>();
  for (const c of said.slice(0, MAX_CHOICES)) {
    const choice = choiceOf(c);
    if (choice === undefined || seen.has(choice.id)) continue;
    seen.add(choice.id);
    out.push(choice);
  }
  return out.length > 0 ? out : undefined;
}

/** A number on its field's step, counted from its `min` (or 0) — to a part in a billion, so 0.3 lies on a step of 0.1. */
function onStep(n: number, f: ActChoiceField): boolean {
  if (f.step === undefined) return true;
  const q = (n - (f.min ?? 0)) / f.step;
  return Math.abs(q - Math.round(q)) <= 1e-9 * Math.max(1, Math.abs(q));
}

/**
 * The choice a host TOOK, held to what the act offers now (petition I62): the choice by its id among `choices`, and its fields' values
 * — each the value handed, or the field's own where none was — every number finite, within its bounds and on its step (a number
 * handed as text is read as one: a host's field gives its text), every text a string within its length. Undefined: no such choice now,
 * or a value that does not fit (core then runs nothing).
 */
export function takenChoice(choices: readonly ActChoice[] | undefined, taken: ActChoiceTaken): ActChoiceTaken | undefined {
  const choice = choices?.find((c) => c.id === taken.id);
  if (choice === undefined) return undefined;
  if (choice.fields === undefined) return { id: choice.id };
  const values: Record<string, number | string> = {};
  for (const f of choice.fields) {
    const given = taken.values?.[f.id] ?? f.value;
    if (f.kind === "number") {
      const n = typeof given === "number" ? given : typeof given === "string" && given.trim() !== "" ? Number(given) : Number.NaN;
      if (!Number.isFinite(n) || (f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max) || !onStep(n, f)) return undefined;
      values[f.id] = n;
    } else {
      if (typeof given !== "string" || given.length > (f.maxLength ?? DEFAULT_TEXT)) return undefined;
      values[f.id] = given;
    }
  }
  return { id: choice.id, values };
}
