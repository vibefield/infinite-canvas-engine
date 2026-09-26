/**
 * THE HELD BAR'S TOOLS (design-015 §8; D3t-a) — what an object in hand offers beyond being held: the kind's
 * `open.tools`, declared on its WIDGET TYPE (`defineWidget({ heldTools, heldTool })` — the desk's `defineObject`
 * passes its kind's), so the one keymap and the one held bar reach them through the engine, never through a kind.
 * Each tool is a glyph, a key and a KIND:
 *  - a `mode` makes itself the held object's ACTIVE tool — the runtime `HeldTool` on the object in hand, the user's
 *    fact, never in the document (the board's four markers and its eraser; a notebook's pens; a calendar's pen). A
 *    `toggle` mode chosen again while active hands back the mode before it (the board's eraser lays down for the
 *    marker it took over from);
 *  - an `action` runs its op once (`run`, handed a `HeldToolApi` — outside the tick, like every op): undo and redo
 *    (the DOCUMENT's history: a held object's history is the document's, design-015 §5.1), the board's wipe.
 * Keys route only while an object is held (the keymap asks `matchHeldTool` before its own entries). A tool with no
 * `kind` is DECLARED ONLY — the bar shows it dim and nothing routes to it (a kind whose tools are a later slice's).
 */
import type { Entity, World } from "@vibecook/strata-ecs";
import type { GuardedTx } from "../guards/guarded-tx";

/** What an action's op is handed: the object in hand, the document's history and ONE transaction on the document. */
export interface HeldToolApi {
  readonly world: World;
  /** The object in hand. */
  readonly entity: Entity;
  /** The document's history — the one ⌘Z walks (false: nothing to undo, or a read-only document). */
  undo(): boolean;
  redo(): boolean;
  /** ONE transaction on the document (one undo step unless `undoable: false`); false — nothing written — on a read-only one. */
  transact(fn: (tx: GuardedTx) => void, opts?: { readonly undoable?: boolean }): boolean;
  /** The held object's own props as the world holds them now. */
  props(): Readonly<Record<string, unknown>>;
  /** The held object's own props, validated, in ONE transaction (`ops.setWidgetProps`'s path — the board's tip, a calendar's month); false on a read-only document. */
  setProps(props: Readonly<Record<string, unknown>>, opts?: { readonly undoable?: boolean }): boolean;
}

/** One tool of the held bar, as a kind declares it (its `open.tools`). */
export interface HeldToolDef {
  /** Unique within the type: what `HeldTool.id` holds for a mode, what `ops.useHeldTool` names. */
  readonly id: string;
  /** Its name — the slot's accessible label and its tip. */
  readonly label: string;
  /** `mode` (the active tool) or `action` (an op, run once); absent = declared only (dim, inert). */
  readonly kind?: "mode" | "action";
  /** The keys that choose it while held: `KeyboardEvent.key` with `mod+` (⌘ or ctrl), `shift+`, `alt+` — "1", "e", "mod+z", "mod+Backspace". */
  readonly keys?: readonly string[];
  /** The key as the tip shows it ("1", "E", "⌘Z"). */
  readonly hint?: string;
  /** A glyph of the bar's set, by name. */
  readonly glyph?: string;
  /** A mode chosen again while active hands the hand back the mode before it. */
  readonly toggle?: boolean;
  /** The cursor over the object's drawing surface (its `content` part) while this mode is active — "none" where the tool draws itself. */
  readonly cursor?: string;
  /** false: keys only — no slot in the bar (the board's tip, its wipe). */
  readonly bar?: boolean;
  /** An action's op. */
  run?(api: HeldToolApi): void;
}

/** A key press as the keymap reads it: `KeyboardEvent.key`, ⌘-or-ctrl, ⇧, ⌥. */
export interface KeyChord {
  readonly key: string;
  readonly mod: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
}

const MODS = new Set(["mod", "shift", "alt"]);

/** A key spec's parts, or undefined when malformed: its modifiers and its key. */
function parseKey(spec: string): { readonly key: string; readonly mod: boolean; readonly shift: boolean; readonly alt: boolean } | undefined {
  const parts = spec.split("+");
  const key = parts.pop();
  if (key === undefined || key.length === 0 || parts.some((m) => !MODS.has(m))) return undefined;
  return { key, mod: parts.includes("mod"), shift: parts.includes("shift"), alt: parts.includes("alt") };
}

/** Does a tool's key spec name this chord? Every modifier must match exactly; the key compares case-blind (Caps Lock types "E"). */
export function keyMatches(spec: string, chord: KeyChord): boolean {
  const k = parseKey(spec);
  return k !== undefined && k.mod === chord.mod && k.shift === chord.shift && k.alt === chord.alt && k.key.toLowerCase() === chord.key.toLowerCase();
}

/** The live tool a chord chooses among `tools` — the first whose keys name it; a declared-only tool routes nothing. */
export function matchHeldTool(tools: readonly HeldToolDef[], chord: KeyChord): HeldToolDef | undefined {
  return tools.find((t) => t.kind !== undefined && (t.keys ?? []).some((spec) => keyMatches(spec, chord)));
}

/** A type's tools at definition time: unique ids, a known kind, an action with its op, well-formed keys. */
export function validateHeldTools(type: string, tools: readonly HeldToolDef[]): void {
  const seen = new Set<string>();
  for (const t of tools) {
    if (typeof t.id !== "string" || t.id.length === 0) throw new Error(`ice: defineWidget("${type}") heldTools — every tool needs an id.`);
    if (seen.has(t.id)) throw new Error(`ice: defineWidget("${type}") heldTools repeats "${t.id}" — a tool's id is unique within its type.`);
    seen.add(t.id);
    if (t.kind !== undefined && t.kind !== "mode" && t.kind !== "action") throw new Error(`ice: defineWidget("${type}") heldTools "${t.id}" — a tool is a "mode" or an "action" (or declared with neither).`);
    if (t.kind === "action" && typeof t.run !== "function") throw new Error(`ice: defineWidget("${type}") heldTools "${t.id}" — an action runs an op: declare \`run\`.`);
    for (const spec of t.keys ?? []) {
      if (parseKey(spec) === undefined) throw new Error(`ice: defineWidget("${type}") heldTools "${t.id}" — the key "${spec}" is not a key spec ("1", "e", "mod+z", "mod+shift+z").`);
    }
  }
}
