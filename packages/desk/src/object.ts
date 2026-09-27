// `defineObject` — the desk's typed door (design-015 §5.2, D-D7 · D-D16; D2a-world): sugar over
// core's `defineWidget`, which stays the ONE compiler. An object is a widget whose face is its
// kind — the opaque `object` binding (since design-015 D5b the only face a widget has; a widget
// without one draws nothing) — with the kind's stratum; the
// catalog, placement, containers, `spawnWidget`, migrations, the gate markers and every
// `widgetTypeFor` reader work untouched — and the desk's renderer finds the kind again through
// `objectKindOf(widgetTypeFor(world, PrefabId.id))`, never a second registry.

import { defineWidget, type WidgetContainerDef, type WidgetDef, type WidgetType } from "@ice/core";
import { isObjectKind, type KindDriver, type KindDriverHost, type ObjectHost, type ObjectKind } from "./kinds/world";

// THE DESK'S PROVIDES-KEYS (design-016 §5 · K-L2, K8a): what an object PROVIDES (`defineObject({ provides })` — a container's
// `container.provides`) is what the desk and its containers place it by — never a list of types that names a kind. The keys are the
// SDK's, so a plugin in its own package declares them as a built-in does; core matches them (`CanvasPlacementDef.accepts`, a
// container's `accepts`).

/** An object that PROVIDES this lies on the desk: the desk canvas places what provides it (K5b's D-K5b.2, folded into the SDK). */
export const DESK_OBJECT = "desk.object";
/**
 * An object that PROVIDES this may be held in a container's desk — the mini mat accepts it (K8a: D-K4a.3's type names retired). It
 * declares its CHIP (`ObjectKind.chip` — its far impostor in the container's face), or it vanishes there when the face is far.
 */
export const CONTAINABLE = "desk.containable";
/** An object that PROVIDES this may be pinned to another's part — a note stuck to a desk calendar's day (`KindDriverHost.provides`). */
export const PINNABLE = "desk.pinnable";

/** A kind's drivers on one desk, made by the host from what it lends (D7 #5, D-D7-A.3). Undefined: the kind has none. */
export type DriverFactory = (host: KindDriverHost) => KindDriver | undefined;

/** What an object declares: a widget definition without a view, plus its KIND. */
export interface ObjectDef extends Omit<WidgetDef, "object" | "stratum" | "openable" | "defaultSize" | "container" | "heldTools" | "heldTool"> {
  /** The kind: its program (the ground registers it) and its world half (the builder and the pick source drive it). */
  readonly kind: ObjectKind;
  /** The size a new one spawns at, world units (`defaultSize`). */
  readonly size?: { readonly w: number; readonly h: number };
  /** A container object — the mini mat: what it accepts and the FACE its inside shows through (`portal` insets). */
  readonly container?: WidgetContainerDef;
  /**
   * The kind's DRIVERS (D7 #5): the hand onto its state — a pen, a carry, a leaf, a writing session — made once per desk by
   * the host from what it lends (`KindDriverHost`) and ticked before the kinds' clocks. The object hands its own components to
   * its driver here, so no driver need import its object back. Absent: the kind is looked at and moved, never worked in.
   */
  readonly drivers?: DriverFactory;
  /**
   * The object's DOM HALF (K4b, `ObjectHost`): what its kind needs of the browser — services lent by key (K8a: the calendar's print
   * raster), its TEXT PARTS that lease the desk's one editor (the note's body, the calendar's day line), a screen-space half (the
   * calendar's days and pen) — declared here as its drivers are, so the host builds it without naming the kind. Absent: the object
   * needs nothing of the browser.
   */
  readonly host?: ObjectHost;
}

/** The drivers behind each compiled object — read back by the host through `driversOf`, never a second registry of kinds. */
const DRIVERS = new WeakMap<WidgetType, DriverFactory>();
/** …and the DOM halves (K4b), read back through `hostOf`. */
const HOSTS = new WeakMap<WidgetType, ObjectHost>();

/** Compile an object through `defineWidget` — one door, one registry. */
export function defineObject(def: ObjectDef): WidgetType {
  const { kind, size, container, drivers, host, ...rest } = def;
  if (!isObjectKind(kind)) throw new Error(`desk: defineObject("${def.type}") — \`kind\` is not a desk kind (kinds/world.ts \`ObjectKind\`: a program with resolve · record · hit · reach)`);
  const widget = defineWidget({
    ...rest,
    object: kind,
    stratum: kind.stratum,
    // the kind that declares an opening is what `ops.open` may pick up (design-015 §8, D4b) — the ONE place the word is set
    openable: kind.open !== undefined,
    // …and its held bar's tools ride the widget type (D3t-a), so the keymap and the bar reach them through the engine
    ...(kind.open?.tools !== undefined ? { heldTools: kind.open.tools } : {}),
    ...(kind.open?.tool !== undefined ? { heldTool: kind.open.tool } : {}),
    ...(size !== undefined ? { defaultSize: size } : {}),
    ...(container !== undefined ? { container } : {}),
  });
  if (drivers !== undefined) DRIVERS.set(widget, drivers);
  if (host !== undefined) HOSTS.set(widget, host);
  return widget;
}

/** The kind behind a widget type, or undefined: not an object, or a binding that is not a desk kind. */
export function objectKindOf(widget: WidgetType | undefined): ObjectKind | undefined {
  if (widget === undefined || widget.object === undefined) return undefined;
  return isObjectKind(widget.object) ? widget.object : undefined;
}

/** The drivers an object declared (`ObjectDef.drivers`), or undefined: none, or not an object of this desk. */
export function driversOf(widget: WidgetType | undefined): DriverFactory | undefined {
  return widget === undefined ? undefined : DRIVERS.get(widget);
}

/** The DOM half an object declared (`ObjectDef.host`), or undefined: none, or not an object of this desk. */
export function hostOf(widget: WidgetType | undefined): ObjectHost | undefined {
  return widget === undefined ? undefined : HOSTS.get(widget);
}
