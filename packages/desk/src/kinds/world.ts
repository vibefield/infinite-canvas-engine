// The WORLD half of a kind (design-015 §5.2's `ObjectKind`; D2a-world). D2a-render gave the
// ground a kind's RENDER half — `KindProgram`: its name, its stratum, its pass made on the mat —
// and left the world out of it. This is the rest: how an ENTITY of the kind becomes the record
// its pass draws, on the same CPU mirror the pick reads (design-015 §4.5). The builder
// (compose/builder.ts) hands every object of the current nav frame to its kind through an
// `ObjectContext` — the entity's rect in world units, its props, the flux the builder stepped
// for it, the theme's look for the kind, the lamp, the slot's view — and takes back a geometry
// (`resolve`) and a record (`record`); the pick source asks the same geometry what part is under
// a world point (`hit`). A kind never reads the world: what it needs arrives in the context, and
// so the same kind draws for the Node oracle, a test's fake world and the app alike.
//
// COORDINATES (the brief's pinned detail): ICE's `Position` is the object's TOP-LEFT and `Size`
// its extent; the prototype's objects — and every law under `resolve` — are CENTRED. The builder
// converts in ONE place (`rectOf`): a kind sees `ObjectRect { cx, cy, w, h }` and nothing else.
//
// PICK ANSWERS (core's `FramePickSource`): `"content"` and `"frame"` are the widget ITSELF — a
// tap selects it, a drag moves it; any other string is a PART (a tap writes `PartTap`, a drag
// that starts on it is not a move); `null` is a miss (the source answers `outside`). So a note
// answers `content`, a mini mat `content` (its face) or `frame` (its border) — both move and
// select it, as in the prototype — and the real parts (a notebook's turn zone, a board's marker)
// arrive with D3.

import type { Component, Entity, HeldToolDef, Relation, Tag, WidgetType, World } from "@ice/core";
import type { TypingDocs } from "../docs";
import type { RasterBudget } from "../engine/budget";
import type { KindPass, KindProgram, StratumName } from "../kind";
import type { BlobStore, PictureDecoder } from "../kit/blobs";
import type { NoteEditor } from "../kit/editor";
import type { ChildShape, InsideView } from "../kit/inside";
import type { Lamp } from "../kit/light";
import type { PrintRaster } from "../kit/print";
import type { TextRaster } from "../kit/raster";
import type { Rect } from "../kit/nav";
import type { GridConfig, View } from "../kit/view";
import type { MarkFrame } from "../marks/layout";
import type { GroundTheme, Palette, ThemeName } from "../theme";

/**
 * What the builder hands a CONTAINER kind's `record` about its inside (D2b): the bounds of the
 * children's rects (`content`, null = empty — the arrival is the empty desk's), the inside's
 * embedding and camera under this slot's camera (`view`, from the kind's own `face` — the
 * flight's numbers, so the face's far LOD and the live inside agree to the bit), and the children
 * as their kinds chip them (`chips`, in the inside's own units — the kind maps them through `view.M`).
 */
export interface InsideContext {
  readonly content: Rect | null;
  readonly view: InsideView | null;
  readonly chips: readonly ChildShape[];
}

/** An object's rect on its desk, world units, CENTRED — converted from ICE's top-left `Position` + `Size` by the builder, once. */
export interface ObjectRect {
  readonly cx: number;
  readonly cy: number;
  readonly w: number;
  readonly h: number;
}

/**
 * What moves, per entity — the builder's springs, each 0..1 and SNAPPED to its target when settled
 * (the B7 trap: a spring that never quite lands keeps the desk awake forever). `lift` follows the
 * `Grab` fact (held), `hover` the local mouse pointer's exact hit (the B9 pairing — never the
 * dead-band `Targets`), `fade` the delete ghost (1 alive … 0 gone). `ring` is ALWAYS 0 from the
 * builder: the kinds' own selection ring retired at D4a (the marks draw the selection) and its
 * spring went at D6; the Node oracle alone hands a ring, for the baseline against the prototype.
 */
export interface ObjectFlux {
  readonly lift: number;
  readonly hover: number;
  readonly ring: number;
  readonly fade: number;
}

/** A kind's answer to "what is under this world point" — the widget itself (`content`/`frame`), a part, or nothing. */
export type ObjectHit = "content" | "frame" | (string & {});

/**
 * A slot of the held bar for a kind in hand (design-015 §8 — "the kind's tools take the middle"): core's `HeldToolDef`
 * (D3t-a — widget/held-tools.ts), declared by the kind and carried onto its widget type by `defineObject`, so the one
 * keymap and the one bar reach it through the engine: a `mode` (the tool in hand, core's `HeldTool`), an `action` (an op),
 * or — no `kind` — declared only (dim; a later slice builds it). `glyph` names one of the bar's.
 */
export type { HeldToolDef } from "@ice/core";

/**
 * The kind's OPENING (design-015 §8; D4b) — what "pick it up" means for this kind. `extent`: the OPEN rect in the object's
 * own desk units, centred as its rect is and UNTURNED (the builder turns it with the object): a notebook's spread (twice the
 * case's width, left of the spine), a board's face, a calendar's month — what the reading size fits into the view. `pose`: how
 * the reading size is reached — `camera` (a flat kind, the default: the held slot's camera maps the extent to the held rect
 * and the kind draws at rest) or `eye` (a thing with height: the camera keeps the desk's zoom and the kind RISES toward the
 * desk eye by `ctx.held.grow`). `openness`: how far the kind's own open motion has come (0 shut … 1 open) — the put-down
 * flies home once it is under 0.35 and lands once under 0.02 (absent: 0, a kind with no motion of its own). `spread`: a
 * two-page extent that opens one page at a time on a portrait phone (Q-p); `page`: which of its two is in view there — 0 the
 * right (the default) … 1 the left, flux the view glides by (D3t-b: the notebook reads page by page). `tools`: the held bar's
 * slots (D3t-a: live — a mode or an action each); `tool`: the mode in hand when it is picked up, from its props (default: the first mode);
 * `swatches`: the colour a slot shows instead of its glyph (the board's four inks — the product's palette, through the look).
 */
export interface OpenBinding {
  extent(ctx: Pick<ObjectContext, "rect" | "props">): ObjectRect;
  readonly pose?: "camera" | "eye";
  openness?(ctx: Pick<ObjectContext, "entity" | "local">): number;
  readonly spread?: boolean;
  page?(ctx: Pick<ObjectContext, "entity" | "local">): number;
  readonly tools?: readonly HeldToolDef[];
  tool?(props: Readonly<Record<string, unknown>>): string;
  swatches?(look: unknown): Readonly<Record<string, string>>;
}

/**
 * What the builder hands the object IN HAND (D4b, beside its flux): the carry amount `e` (0 on the desk … 1 in hand — the
 * lift's height, the focus behind), whether it should be OPEN (past 42 % of the pickup going up; never going down), the
 * factor an `eye` kind must reach by rising (1 for a flat kind — the camera did it), and `snap` (a still: the open motion
 * sits at its target, no spring).
 */
export interface HeldContext {
  readonly e: number;
  readonly open: boolean;
  readonly grow: number;
  readonly snap: boolean;
}

/**
 * Everything a kind is handed for one entity, one frame. The props are the widget type's group
 * fields as the builder cached them (refreshed from the change journal, never re-read per frame —
 * the 09-23 profile); `look` is what the kind's own `theme()` made of the palette in force.
 */
export interface ObjectContext {
  readonly entity: Entity;
  readonly rect: ObjectRect;
  readonly props: Readonly<Record<string, unknown>>;
  readonly flux: ObjectFlux;
  /** The kind's `theme(palette, name)` result for the theme in force; `undefined` when the kind declares none. */
  readonly look: unknown;
  readonly theme: GroundTheme;
  /** The desk's one lamp — the gobo projector on the desk plane (`lampOf`), world units. */
  readonly lamp: Lamp;
  /** The slot's camera and attachment (CSS px) with the device pixel ratio. */
  readonly view: View & { readonly dpr: number };
  /** The slot's grid: the mat's config (its vinyl, its gobo, its rulers) and the lattice's fade-in. */
  readonly grid: GridConfig;
  /** The frame's dt, SECONDS (the engine's clamped dt). */
  readonly dt: number;
  /**
   * A per-entity asset the HOST pinned through the builder (`DeskBuilder.pin`) — `undefined` = none.
   * Flux, never a world fact. (The note's committed raster moved into its kind's `local` at D2c.)
   */
  readonly asset?: unknown;
  /**
   * The kind's OWN state on this desk — what `ObjectKind.local()` made for it (the note's writing:
   * its layouts, its rasters' residency, the caret, the wipe — D2c); `undefined` when the kind keeps
   * none. Flux, never a world fact; the builder threads it and tells it when an entity is forgotten.
   */
  readonly local?: unknown;
  /** A container's inside, for its `record` (D2b): the content bounds, the view through its face, the children's chips. Absent = not a container, or `resolve`. */
  readonly inside?: InsideContext;
  /** The object is IN HAND (D4b): its carry amount, its open target, the eye kind's rise. Absent = on the desk. */
  readonly held?: HeldContext;
}

/** What a desk hands a kind's `local()` (D2c): its ROOT pass once the ground is made, and the host's text seam. */
export interface KindHost {
  /** The kind's root pass on this desk's ground; `undefined` before `Ground.create` resolves and after the layer ends. */
  pass(): KindPass | undefined;
  /** The host's text raster (desk/host/ink.ts in a browser); absent in Node — the oracle pins committed rasters. */
  readonly text?: TextRaster | undefined;
  /** An object's DATA children (D3w, design-015 §5.1 — a board's strokes, a pad's events and pins); absent = none (a test, the oracle). */
  readonly children?: DataChildren | undefined;
  /** The app's byte store (D3w, D-D12 — a print's picture) and the host's decoder for what it holds; absent = no pictures. */
  readonly blobs?: BlobStore | undefined;
  readonly decode?: PictureDecoder | undefined;
  /** The host's PRINT raster (D3t-c — the desk calendar's tiles: desk/host/print.ts in a browser); absent in Node — the oracle pins committed tiles. */
  readonly print?: PrintRaster | undefined;
  /**
   * The builder's word on what is DRAWN (D6, persistent records): the paint rank of `e` in the last build's root slot, undefined when it
   * was not drawn there. A kind's residency reads it instead of counting its own `record` calls — those come only when a record is
   * remade. Absent (a bare host, the oracle): the kind counts its own.
   */
  readonly drawn?: ((e: Entity) => number | undefined) | undefined;
  /**
   * THE RASTER BUDGET (D6, engine/budget.ts): one ledger for every raster a kind keeps as a cache of its data — a board's ink, a
   * notebook page's CPU raster, the calendar's tiles. A kind charges what it makes with a way to let it go and answers `keeps` for
   * what is on screen; the host trims the ledger once a tick. Absent: nothing is counted or evicted.
   */
  readonly budget?: RasterBudget | undefined;
}

/**
 * An object's DATA children as its kind reads them (D3w): entities `ChildOf` the object, never members of the desk's
 * paint order — the `stamp` turns over whenever the set or its order changes (strata's order stamp), and `rows` are the
 * children's values of one component, in sibling order (the oldest stroke first).
 */
export interface DataChildren {
  stamp(parent: Entity): number;
  rows<T>(parent: Entity, c: Component<T>): readonly T[];
  /** The children holding `c`, each with its value, in sibling order (D3t-c — a pad's events by entity: the line you point at is one). */
  entries?<T>(parent: Entity, c: Component<T>): readonly { readonly entity: Entity; readonly value: T }[];
  /** A child's one edge `r` — the entity it names (D3t-c — a pin's note), undefined when it names none. */
  target?(child: Entity, r: Relation): Entity | undefined;
}

/**
 * A kind's own state on ONE desk (D2c) — made once per desk by `ObjectKind.local`, threaded by the
 * builder into every context of the kind as `ctx.local`, and told the frame's clock and each entity's
 * end, so a kind can keep per-entity residency (a raster, a decoded picture) outside the world.
 */
export interface KindLocal {
  /** Once a tick, before the draw, with the frame's clock (ms): does the state want a frame now (a wipe, a blink, an asset landed)? */
  tick?(now: number): boolean;
  /**
   * What has LANDED on `e` so far — a count the kind moves when something arrives that changes how the object looks with no fact
   * of its own moving (a picture decoded, ink replayed, a raster laid, tiles drawn, a wipe ended), never for a running motion (the
   * ink drying, a wipe running, a pen). The builder reads it after it remakes a restless kind's record: a desk object's that moved
   * remakes the blurred desk copy behind the hand (D7 — its stamp saw only the facts). Absent: nothing lands.
   */
  landed?(e: Entity): number;
  /** The entity left this desk for good — its ghost faded, it left the frame, the desk was reset: free what it held. */
  forget?(e: Entity): void;
  /**
   * The entity is drawn LIFTED off the desk's order and away from its facts (D3t-a — a print in a hand, flicked, gliding or
   * flying home): the builder paints it with the carried set, above its siblings, and the pick asks it first where it is drawn.
   */
  lifted?(e: Entity): boolean;
  /**
   * Entities this kind's state says are NOT drawn this frame, of any kind (D3t-c — a note stuck to a day of a month the calendar is
   * not showing): the builder draws none of them and the pick answers `outside` for them. Asked after `tick`, before the draw.
   */
  veils?(): ReadonlySet<Entity>;
  /** The kind's word on a raster it charged to the budget (D6): true = on screen this frame, never evicted now. */
  keeps?(key: string): boolean;
  dispose?(): void;
}

/**
 * A kind, whole: the render half the ground registers (`KindProgram` — name, stratum, the pass)
 * and the world half the builder and the pick source drive. `G` is the kind's resolved geometry,
 * `R` the record its pass draws, `L` its look (what `theme()` returns).
 */
export interface ObjectKind<G = unknown, R = unknown, L = unknown> extends KindProgram<R> {
  /**
   * How far the kind's drawing may reach PAST its rect, world units — its shadow, its lift, its
   * tilt's overhang: the builder's cull margin, and the pick source's pad (`FramePickSource.pad`).
   */
  readonly reach: number;
  /** Components and tags the kind reads beyond its own props (the builder adds them to its change journal). */
  readonly reads?: { readonly components?: readonly Component[]; readonly tags?: readonly Tag[] };
  /**
   * The record reads the view's ZOOM or dpr (a raster band, a far-LOD lattice) and nothing else of the camera (design-015 §4.3; D6):
   * the builder remakes it when they move and reuses it across a pan. Absent = the record is the facts' and the flux's alone. A
   * composite kind is remade every frame it is drawn whatever it says (its `resolve` steps its own motion).
   */
  readonly rezoom?: boolean;
  /** A host's LIVE law (D5a — the dev panel's door, `handle.tuneLaw`): the kind resolves under it from the next build. Absent, its law is fixed. */
  tune?(law: unknown): void;
  /** The entity's geometry this frame, from its rect, its props and its flux — the prototype's `resolve*`. */
  resolve(ctx: ObjectContext): G;
  /** The record the kind's pass draws for that geometry — the prototype's instance. */
  record(geometry: G, ctx: ObjectContext): R;
  /** The CPU mirror on the SAME geometry the pass drew: the part under a world point, or null for a miss. */
  hit(geometry: G, wx: number, wy: number): ObjectHit | null;
  /**
   * A CONTAINER kind's FACE as drawn — the window its inside shows through, in the desk's units
   * (the mini mat: the sheet inset by its printed border, through its springs). The builder builds
   * the live inside through it and the nav geometry seam answers core's nav with it (design-015 §9).
   * Absent = the kind holds no desk.
   */
  face?(geometry: G): Rect | undefined;
  /**
   * The kind's far-LOD face inside a mini mat (MINIMAT.md §5): the child as a `ChildShape` in ITS
   * desk's units — a note as paper with its writing greeked, a mini mat as vinyl with its border;
   * `null` = nothing to chip. Absent = the kind has no chip yet (the oracle's prints).
   */
  chip?(geometry: G, ctx: ObjectContext): ChildShape | null;
  /** The grid a CONTAINER kind's inside draws with (the mini mat: the desk's fade-in, the mat in its vinyl, no rulers). Absent = the root's. */
  insideGrid?(ctx: Pick<ObjectContext, "props" | "look">, root: GridConfig): GridConfig;
  /**
   * The silhouette the desk's MARKS go around (D4a — the brackets, a member's ticks, several's union, the tape):
   * the geometry's centre, half extents AS DRAWN (the lift's scale in), turn and corner, world units. Absent =
   * the rect, square to the mat (`rectFrame`).
   */
  frame?(geometry: G): MarkFrame;
  /** The kind's colours from the host's palette, per theme — the look `record` reads (`ctx.look`). */
  theme?(palette: Palette, name: ThemeName): L;
  /** The kind's own state on one desk (`ctx.local`) — made by the host once per desk; absent = none (D2c). */
  local?(host: KindHost): KindLocal;
  /** The kind's OPENING (design-015 §8, D4b): what picking it up means. Absent = the object never opens (`ops.open` refuses it). */
  readonly open?: OpenBinding;
}

/**
 * What the host lends a kind's DRIVERS (D7 #5, D-D7-A.3 — the hand onto the kind's state: a pen, a carry, a leaf, the
 * calendar's writing and marks). A kind declares them in `defineObject` (`ObjectDef.drivers`); the host makes them once per
 * desk, generically, and ticks them before the kinds' clocks — a third-party openable kind with held tools gets its driver
 * the same way. Everything a driver needs comes through here: the world, the document's doors (docs.ts), the kind's own
 * local and look, the builder's word (geometry as drawn, a held point into the world, the hand), the builder's give.
 */
export interface KindDriverHost {
  readonly world: World;
  /** The document's doors — `current()`, the writer's gate, the commit door, the history doors (docs.ts). */
  readonly docs: TypingDocs;
  /** This kind's own local (`ObjectKind.local`), if it declared one. */
  readonly local: KindLocal | undefined;
  /** This kind's look as the desk composed it (the swatches a pen draws in). */
  readonly look: () => unknown;
  /** Is `e` an object of this kind? */
  readonly isKind: (e: Entity) => boolean;
  /** Is `e` an object of the kind named — undefined when that kind is not on this desk (the calendar asks after notes). */
  readonly kind: (name: string) => ((e: Entity) => boolean) | undefined;
  /** The builder's word: an object's geometry as drawn (the kind's `G`), a held-screen point into its world, the hand. */
  readonly geometryOf: (e: Entity) => unknown;
  readonly heldToWorld: (e: Entity, x: number, y: number) => readonly [number, number] | undefined;
  readonly hand: () => { readonly entity: Entity; readonly landing: boolean; readonly frame: { readonly cx: number; readonly cy: number; readonly s: number } } | undefined;
  /** The builder's give for a drag the kind refuses (a taped print meets the tape — D4a). */
  readonly refused: (e: Entity) => void;
  /** Ask the desk for a frame (something landed, a mark moved). */
  readonly wake: () => void;
}

/** A kind's driver on one desk: ticked once a frame before the kinds' clocks; idle when it has nothing to follow (D7 #14). */
export interface KindDriver {
  follow(now: number): void;
  /** Nothing to follow this frame — nothing in hand, no press, no rest or roll owed: the host may skip `follow` (the idle-tick budget). Absent: never skipped. */
  idle?(): boolean;
  dispose?(): void;
}

/**
 * An object's DOM HALF (K4b, design-016 §5 · K-L2) — what its kind needs of the browser, DECLARED with the object as its drivers
 * are (`defineObject({ host })`): the desk layer builds what the registered objects declare and never finds a half by type or
 * names a kind. Three moments, in the layer's order:
 * - `lend`, before the kind's local: a service its world half reads through `KindHost` that only a browser can make (the desk
 *   calendar's print raster, in the host's hand — none without a text raster);
 * - `editor`, once the drivers are made: the desk's ONE focused editor (the note's); the first object that makes one owns it;
 * - `mount`, after that: a screen-space half, lent the editor if one was made (the desk calendar's days and pen borrow it). A
 *   mounted half is ended by what it joins — the calendar's by the calendar's driver.
 * K8 opens this into a service registry and lets any kind take the editor's lease.
 */
export interface ObjectHost {
  readonly lend?: (host: Pick<KindHost, "text">) => Pick<KindHost, "print">;
  readonly editor?: (host: ObjectDomHost) => NoteEditor | undefined;
  readonly mount?: (host: ObjectDomHost & { readonly editor: NoteEditor | undefined }) => void;
}

/**
 * What the host lends an object's DOM half (K4b): the screen-space container, the object the half was declared on and ITS
 * driver, its kind's look, and the builder's word — a driver host's fields, and the few a browser half adds.
 */
export interface ObjectDomHost {
  /** The host's container (screen space): a half's elements go in it, its taps are read on it. */
  readonly container: HTMLElement;
  readonly world: World;
  /** The document's doors (docs.ts) — a half that writes, writes through them. */
  readonly docs: TypingDocs;
  /** The object the half was declared on — its compiled widget type (its props' groups). */
  readonly object: WidgetType;
  /** The object's own driver (`defineObject({ drivers })`), if it declared one. */
  readonly driver: KindDriver | undefined;
  /** The object's kind's look as the desk composed it. */
  readonly look: () => unknown;
  /** The builder's word: an object's geometry as drawn, the hand, a held-screen point into its world. */
  readonly geometryOf: KindDriverHost["geometryOf"];
  readonly hand: KindDriverHost["hand"];
  readonly heldToWorld: KindDriverHost["heldToWorld"];
  /** Ask the desk for a frame. */
  readonly wake: () => void;
  /** A writing session ends after this long without input, ms (`DeskLayerOptions.idleMs`); absent: the half's own. */
  readonly idleMs?: number | undefined;
}

/** The strata a kind may declare — re-exported beside the contract for a kind's author. */
export type { StratumName };

/** ICE's top-left `Position` + `Size` → the centred rect every law reads: the ONE conversion. */
export function rectOf(pos: { readonly x: number; readonly y: number }, size: { readonly w: number; readonly h: number }): ObjectRect {
  return { cx: pos.x + size.w / 2, cy: pos.y + size.h / 2, w: size.w, h: size.h };
}

/** An object's marks' silhouette when its kind draws none of its own: the rect, square to the mat, no corner. */
export const rectFrame = (r: ObjectRect): MarkFrame => ({ cx: r.cx, cy: r.cy, hx: r.w / 2, hy: r.h / 2, angle: 0, r: 0 });

/** The flux of an object at rest: down, unhovered, unselected, whole. */
export const FLUX_REST: ObjectFlux = { lift: 0, hover: 0, ring: 0, fade: 1 };

/** A prop read with a type and a default — the kinds' one door to `ctx.props`. */
export const numberProp = (props: Readonly<Record<string, unknown>>, name: string, fallback: number): number => {
  const v = props[name];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
};
export const stringProp = (props: Readonly<Record<string, unknown>>, name: string, fallback: string): string => {
  const v = props[name];
  return typeof v === "string" ? v : fallback;
};

/** Is this opaque widget binding a desk kind — the world half present beside the program? */
export function isObjectKind(binding: unknown): binding is ObjectKind {
  if (typeof binding !== "object" || binding === null) return false;
  const k = binding as Partial<ObjectKind>;
  return typeof k.name === "string" && typeof k.stratum === "string" && typeof k.create === "function" && typeof k.resolve === "function" && typeof k.record === "function" && typeof k.hit === "function" && typeof k.reach === "number";
}
