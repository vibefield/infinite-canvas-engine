// `defineObject` — the desk's typed door (design-015 §5.2, D-D7 · D-D16; D2a-world): sugar over
// core's `defineWidget`, which stays the ONE compiler. An object is a widget whose face is its
// kind — the opaque `object` binding (since design-015 D5b the only face a widget has; a widget
// without one draws nothing) — with the kind's stratum; the
// catalog, placement, containers, `spawnWidget`, migrations, the gate markers and every
// `widgetTypeFor` reader work untouched — and the desk's renderer finds the kind again through
// `objectKindOf(widgetTypeFor(world, PrefabId.id))`, never a second registry.

import { defineWidget, type WidgetContainerDef, type WidgetDef, type WidgetType } from "@ice/core";
import { isObjectKind, type ObjectKind } from "./kinds/world";

/** What an object declares: a widget definition without a view, plus its KIND. */
export interface ObjectDef extends Omit<WidgetDef, "object" | "stratum" | "openable" | "defaultSize" | "container"> {
  /** The kind: its program (the ground registers it) and its world half (the builder and the pick source drive it). */
  readonly kind: ObjectKind;
  /** The size a new one spawns at, world units (`defaultSize`). */
  readonly size?: { readonly w: number; readonly h: number };
  /** A container object — the mini mat: what it accepts and the FACE its inside shows through (`portal` insets). */
  readonly container?: WidgetContainerDef;
}

/** Compile an object through `defineWidget` — one door, one registry. */
export function defineObject(def: ObjectDef): WidgetType {
  const { kind, size, container, ...rest } = def;
  if (!isObjectKind(kind)) throw new Error(`desk: defineObject("${def.type}") — \`kind\` is not a desk kind (kinds/world.ts \`ObjectKind\`: a program with resolve · record · hit · reach)`);
  return defineWidget({
    ...rest,
    object: kind,
    stratum: kind.stratum,
    // the kind that declares an opening is what `ops.open` may pick up (design-015 §8, D4b) — the ONE place the word is set
    openable: kind.open !== undefined,
    ...(size !== undefined ? { defaultSize: size } : {}),
    ...(container !== undefined ? { container } : {}),
  });
}

/** The kind behind a widget type, or undefined: not an object, or a binding that is not a desk kind. */
export function objectKindOf(widget: WidgetType | undefined): ObjectKind | undefined {
  if (widget === undefined || widget.object === undefined) return undefined;
  return isObjectKind(widget.object) ? widget.object : undefined;
}
