/**
 * A KIND'S MENU ACTIONS (design-016 §5 · K-L2, K8a) — the acts a widget type offers in the selection menu for a selection of its
 * objects, declared on its TYPE (`defineWidget({ menu })` — the desk's `defineObject` passes them through), so the one menu and
 * an app's keys reach them through the engine (`ops.runMenuAction`), never through a kind: the menu shows an act when EVERY selected
 * object's type declares it (a selection of that kind), and the op runs it on the selected objects whose types declare it — each
 * type's own `run`, handed its own objects. Until K8a a kind's act (the mini mat's vinyl) was app code over a type name.
 */
import type { Entity, World } from "@vibecook/strata-ecs";
import type { GuardedTx } from "../guards/guarded-tx";
import { type HeldGlyph, isHeldGlyph } from "./held-tools";

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
  run(api: MenuActionApi): void;
}

export function validateMenuActions(type: string, acts: readonly MenuActionDef[]): void {
  const seen = new Set<string>();
  for (const a of acts) {
    if (typeof a.id !== "string" || a.id.length === 0) throw new Error(`ice: defineWidget("${type}") menu — every act needs an id.`);
    if (seen.has(a.id)) throw new Error(`ice: defineWidget("${type}") menu repeats "${a.id}" — an act's id is unique within its type.`);
    seen.add(a.id);
    if (typeof a.label !== "string" || a.label.length === 0) throw new Error(`ice: defineWidget("${type}") menu "${a.id}" — an act needs a label.`);
    if (typeof a.run !== "function") throw new Error(`ice: defineWidget("${type}") menu "${a.id}" — an act runs an op: declare \`run\`.`);
    if (!isHeldGlyph(a.glyph)) throw new Error(`ice: defineWidget("${type}") menu "${a.id}" — a glyph is a name of the bar's set or a drawing \`{ path }\`.`);
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
