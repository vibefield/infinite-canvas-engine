/**
 * A KIND'S MENU ACTIONS (design-016 §5 · K-L2, K8a) — the acts a widget type offers in the selection menu for a selection of its
 * objects, declared on its TYPE (`defineWidget({ menu })` — the desk's `defineObject` passes them through), so the one menu and
 * an app's keys reach them through the engine (`ops.runMenuAction`), never through a kind: the menu shows an act when EVERY selected
 * object's type declares it (a selection of that kind), and the op runs it on the selected objects whose types declare it — each
 * type's own `run`, handed its own objects. Until K8a a kind's act (the mini mat's vinyl) was app code over a type name.
 * An act may say its STATE NOW (petition I61 — I49's word for the held bar's tools): disabled, another glyph, another label (a pane's
 * Mute becomes Unmute), or a colour in place of its glyph (a phone's finish).
 */
import type { Entity, World } from "@vibecook/strata-ecs";
import type { GuardedTx } from "../guards/guarded-tx";
import type { ActChoice, ActChoiceTaken } from "./act-choices";
import { type HeldGlyph, isHeldGlyph } from "./held-tools";
import { isSwatch } from "./swatch";

/** What an act's op is handed (outside the tick, like every op): its type's selected objects and ONE door each to write them. */
export interface MenuActionApi {
  readonly world: World;
  /** The selected objects of the declaring type, in selection order. */
  readonly entities: readonly Entity[];
  /** An object's own props as the world holds them now. */
  props(entity: Entity): Readonly<Record<string, unknown>>;
  /** An object's props, validated, in ONE transaction (`ops.setWidgetProps`'s path); false on a read-only document. */
  setProps(entity: Entity, props: Readonly<Record<string, unknown>>, opts?: { readonly undoable?: boolean }): boolean;
  /** ONE transaction on the document (one undo step unless `undoable: false`); false — nothing written — on a read-only one. */
  transact(fn: (tx: GuardedTx) => void, opts?: { readonly undoable?: boolean }): boolean;
}

/**
 * An act's STATE as the selection menu shows it NOW (petition I61; the held bar's `HeldToolState`, I49): what its kind says of it each
 * time the selection's anchor is recomposed, and again when the act is run. `enabled` false: the act is DISABLED now — its slot dim
 * and `aria-disabled`, its press and its keys doing nothing; absent or true, live. `glyph` and `label`: shown now instead of the
 * declared ones. `swatch`: a colour shown now in place of its glyph, CSS, as a held bar's marker shows its ink (the kind's own word,
 * never parsed here). Every field absent — or no answer — is the act as declared.
 */
export interface MenuActionState {
  readonly enabled?: boolean;
  readonly glyph?: HeldGlyph;
  readonly label?: string;
  readonly swatch?: string;
}

/**
 * What an act's `state` reads (petition I61): its type's selected objects, their props as the world holds them now, and the kind's
 * STATE ON THE DESK that draws them (`ObjectKind.local`); `local` is undefined where no desk answers (an engine with no renderer). READ
 * ONLY: a `state` is asked at the host's rate, and writes nothing.
 */
export interface MenuActionStateContext {
  readonly world: World;
  /** The selected objects of the declaring type, in selection order. */
  readonly entities: readonly Entity[];
  /** An object's own props as the world holds them now. */
  props(entity: Entity): Readonly<Record<string, unknown>>;
  readonly local: unknown;
}

/** One act of the selection menu, as a type declares it. */
export interface MenuActionDef {
  /** Unique within the type: what `ops.runMenuAction` names (and what an app's key names). */
  readonly id: string;
  /** Its name — the button's accessible label and its tip. */
  readonly label: string;
  /** Its glyph (`HeldGlyph`): a name of the bar's set, or its own drawing (`{ path }`). */
  readonly glyph?: HeldGlyph;
  /** The key that does the same, as the tip and More show it ("T") — the app binds it to `ops.runMenuAction`. */
  readonly keys?: string;
  /**
   * Its op. An act that is a CHOICE (petition I62 — `choices`) is handed the choice the host took (`taken`: its id, and its fields'
   * values held to their bounds), only when it is one of the act's choices now; run with none, it does its plain op (or nothing).
   */
  run(api: MenuActionApi, taken?: ActChoiceTaken): void;
  /**
   * Its STATE NOW (petition I61 — `MenuActionState`): asked with the anchor, as a held tool's `state` is (I49), and when the act is run.
   * Undefined — or absent — the act as declared. One that THROWS is caught where it is asked (the desk says so once, never a strike):
   * the act stands as declared.
   */
  state?(ctx: MenuActionStateContext): MenuActionState | undefined;
  /**
   * Its CHOICES NOW (petition I62 — an act may be a choice: a pane's device, a phone's finish): plain data the host draws as rows, the
   * current one marked, read with the anchor as its state is. Undefined — or absent — the act is one op. One that THROWS is caught
   * where it is asked (said once): the act stands as one op.
   */
  choices?(ctx: MenuActionStateContext): readonly ActChoice[] | undefined;
}

/**
 * An act's state NOW, read safely (petition I61, as `readHeldToolState` reads a tool's): its `state(ctx)` with only what is well-formed
 * kept — `enabled` when it is `false`, a glyph that is one (`isHeldGlyph`), a label that is a word, a swatch that is one — or undefined:
 * none declared, nothing said, or it THREW (`threw` is told; the act stands as declared).
 */
export function readMenuActionState(act: MenuActionDef, ctx: MenuActionStateContext, threw?: (err: unknown) => void): MenuActionState | undefined {
  if (act.state === undefined) return undefined;
  let said: MenuActionState | undefined;
  try { said = act.state(ctx); } catch (err) { threw?.(err); return undefined; }
  if (typeof said !== "object" || said === null) return undefined;
  const glyph = said.glyph !== undefined && isHeldGlyph(said.glyph) ? said.glyph : undefined;
  const label = typeof said.label === "string" && said.label.length > 0 ? said.label : undefined;
  const swatch = isSwatch(said.swatch) ? said.swatch : undefined;
  if (said.enabled !== false && glyph === undefined && label === undefined && swatch === undefined) return undefined;
  return {
    ...(said.enabled === false ? { enabled: false } : {}),
    ...(glyph !== undefined ? { glyph } : {}),
    ...(label !== undefined ? { label } : {}),
    ...(swatch !== undefined ? { swatch } : {}),
  };
}

/**
 * THE MENU STATE SEAM (petition I61): the renderer's word on a kind's state on its desk, through which `ops.runMenuAction` reads an
 * act's `state` as the anchor does, so an act its kind says is disabled does nothing — its press, its key. The desk sets it at mount and
 * clears it at dispose; empty (an engine with no renderer), an act's state is read with no desk state.
 */
export interface MenuStateSource {
  /** The state on the desk of the kind that draws `entity` (`ObjectKind.local`), or undefined. */
  local(entity: Entity): unknown;
}

/** The stack's slot for the menu state source — a mutable box, so the renderer can arrive after install (as `heldPose`). */
export interface MenuStateSlot { current: MenuStateSource | null }

export function validateMenuActions(type: string, acts: readonly MenuActionDef[]): void {
  const seen = new Set<string>();
  for (const a of acts) {
    if (typeof a.id !== "string" || a.id.length === 0) throw new Error(`ice: defineWidget("${type}") menu — every act needs an id.`);
    if (seen.has(a.id)) throw new Error(`ice: defineWidget("${type}") menu repeats "${a.id}" — an act's id is unique within its type.`);
    seen.add(a.id);
    if (typeof a.label !== "string" || a.label.length === 0) throw new Error(`ice: defineWidget("${type}") menu "${a.id}" — an act needs a label.`);
    if (typeof a.run !== "function") throw new Error(`ice: defineWidget("${type}") menu "${a.id}" — an act runs an op: declare \`run\`.`);
    if (!isHeldGlyph(a.glyph)) throw new Error(`ice: defineWidget("${type}") menu "${a.id}" — a glyph is a name of the bar's set or a drawing \`{ path }\`.`);
    if (a.state !== undefined && typeof a.state !== "function") throw new Error(`ice: defineWidget("${type}") menu "${a.id}" — an act's \`state\` is a function of what it reads (petition I61).`);
    if (a.choices !== undefined && typeof a.choices !== "function") throw new Error(`ice: defineWidget("${type}") menu "${a.id}" — an act's \`choices\` is a function of what it reads (petition I62).`);
  }
}

/**
 * The acts the selection menu shows for `entities`: those EVERY entity's type declares (by id; the first type's declaration names
 * it), in the first type's order — none for an empty selection or an object of a type that declares none.
 */
export function menuActionsFor(entities: readonly Entity[], menuOf: (entity: Entity) => readonly MenuActionDef[]): readonly MenuActionDef[] {
  const first = entities[0];
  if (first === undefined) return [];
  let acts = menuOf(first);
  for (let i = 1; i < entities.length && acts.length > 0; i++) {
    const ids = new Set(menuOf(entities[i] as Entity).map((a) => a.id));
    acts = acts.filter((a) => ids.has(a.id));
  }
  return acts;
}
