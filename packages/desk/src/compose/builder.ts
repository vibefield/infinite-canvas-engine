// The DESK BUILDER — the world's objects as the ground's records (design-015 §4.4; D2a-world, D2b).
// B3a's frame builder re-aimed: one call per frame the reflector paints, every OBJECT Active in
// the current nav frame, in paint order, becomes the record its kind's pass draws — through the
// kind's own world half (kinds/world.ts): the builder hands each entity to its kind as an
// `ObjectContext` and takes back a geometry and a record; the geometry is kept per entity for the
// pick source (compose/pick.ts), so what is clicked is what was drawn (§4.5).
//
// FACTS vs FLUX (design-013 §3, design-015 §2.3). The facts are the world's, read and never
// written: `Position`/`Size` (ICE's top-left, converted to the centred rect every law reads —
// `rectOf`, the one place), the widget type's prop groups, `Selected`, `Grab` (THE lift signal),
// the sibling order, `Active`. They are CACHED per entity and refreshed from the change journal
// (`changed()` pulls it): an unchanged entity costs the world no read on a frame (the 09-23
// profile's lesson — never a whole-component read in the hot loop). The flux is here, per entity,
// outside the world: the prototype's springs (`SPRINGS` — the hold's lift, the hover's rise, the
// selection ring), advanced by the frame's dt and SNAPPED when settled (B7's trap: every spring
// snaps, or the desk never idles); and the DELETE GHOST — an entity the journal reports removed
// keeps its last rect, props and flux and fades over `ghostMs` in its last paint position, then is
// forgotten. No ECS machinery for any of it: a board at rest carries no per-entity state.
//
// PAINT ORDER: `compareStackOrder` (the stratum first — D2a-core — then the sibling sequence), the
// `Grab` set LAST (S1's rule: a carried object paints over what it crosses; the ground draws strata
// in order whatever the list says, so a held sheet still lies under every thing). The hover comes
// from the local MOUSE pointer's `TouchesExact` edge — the exact hit, never the dead-band `Targets`
// (the B9 pairing) — compared per tick. Dirt is PULLED: a `coarse: false` collector over the facts
// above plus every object kind's props components and the tags; the sibling order's stamp; the
// hover target. The camera and the viewport are the reflector's to poll (`resourceStamp`).
//
// THE NESTED DESKS (D2b; MINIMAT.md §3–§5, the prototype's `deskInputs` line for line): a
// container drawn in a slot gets its INSIDE — its `ChildOf` children, their rects' bounds as the
// content, the view through the kind's `face` (`insideViewOfFace`: the flight's own numbers, so
// the far LOD and the live inside agree to the bit), the children as their kinds chip them — and,
// past the gate (`presence > 0`, depth < 4, the `PORTAL_CAP` largest faces first), a LIVE slot:
// the children built under the inside's camera, recursing. Inside members lie at REST (nothing
// inside is hovered, held or selected; a note put in lands flat, as the prototype's did). THE
// FLIGHT (design-006; `NavTransition`): the departed desk — the frame's `Retained` widgets in
// their sibling order — under `departedCameraOf`, an ENTER as one tree through the face (`at` =
// the container's index among the departed objects), an EXIT and a FROZEN flight as two whole
// slots, the opacities and the lamp HANDOVER `flightPresent`/`flightLights`, the dressing
// (`lodZoom`: the arriving desk for its landing, the departed for the cut). THE RE-DRESSING
// (`NavRedress`, a zoom-through's cut): 320 ms in log space, smoothstep, the lamp on the same
// ramp. THE CUT FRAME (D-D2b.7): while the flight holds at p = 0 no spring advances — the
// departed desk IS its pre-cut frame to the bit (B7 extended to the flux). And THE SEAM
// (`navFace`, design-015 §9): a container's face AS DRAWN this frame — at rest when it is not in
// the frame — with the inside's arrival, embedding, camera, presence and cover test, for core's nav.
//
// The builder is pure with respect to the GPU: it makes records; the reflector hands them to
// `Ground.render`. PAN IS O(1) in the world: nothing here is stored per object in the ECS.

import {
  Active,
  BoardRoot,
  ChildOf,
  Container,
  compareStackOrder,
  createSiblingOrderIndex,
  currentNavFrame,
  DEFAULT_STRATUM_BAND,
  defineQuery,
  departedCameraOf,
  Grab,
  Held,
  HeldView,
  heldEntity,
  LocalPointer,
  Locked,
  type MarqueeBuffer,
  type NavFace,
  NavRedress,
  NavTransition,
  Pointer,
  Position,
  PrefabId,
  Resizable,
  Retained,
  Selected,
  Size,
  type StackOrderReader,
  Stratum,
  TouchesExact,
  Viewport,
  WidgetEquipped,
  widgetTypeFor,
  type Component,
  type Entity,
  type Tag,
  type WidgetType,
  type World,
} from "@ice/core";
import type { HeldFrameInputs, OutgoingInputs, PortalInputs, SlotObject } from "../ground";
import { carryOf, HELD_USER_REST, heldCamera, heldFrame, heldPose, HOLD, homePose, isNarrow, readingTarget } from "../hold/pose";
import { FLUX_REST, type InsideContext, type KindLocal, numberProp, type ObjectContext, type ObjectFlux, type ObjectKind, type ObjectRect, rectFrame, rectOf } from "../kinds/world";
import type { MarksInput } from "../marks/layout";
import { DAY_LIGHT, mixLight } from "../mat/night";
import { createMarksCollector, type MarkRow, type SelectionAnchor } from "./marks";
import type { GridConfig } from "../mat/grid";
import type { MatFrame, SlotLight } from "../mat/layout";
import { flightLights, flightPresent, type InsideView, insidePresent, insideViewOfFace } from "../minimat/inside";
import { type ChildShape, FACE_RADIUS } from "../minimat/minimat";
import { boundsOf, type CameraState, FIT, type Rect, solveFlightStart } from "../nav/flight";
import { clipOf, faceCovers, PORTAL_CAP, PORTAL_GATE, type Presentation } from "../nav/portal";
import { type Lamp, lampOf } from "../paper/paper";
import { objectKindOf } from "../object";
import { type ObjectSprings, SPRINGS, settled, spring } from "../springs";
import { MINIMAT, type GroundTheme } from "../theme";

/** The view a frame is built for: CSS px and the dpr the canvas is at. */
export interface BuildViewport { readonly width: number; readonly height: number; readonly dpr: number }

export interface DeskBuilderOptions {
  /**
   * The OBJECT widget types this desk may hold: their prop groups join the change journal and
   * their kinds' `reach` the pick pad. An object of a type not listed still draws (its kind is found
   * off the widget type) but its props are refreshed only on a Position/Size/tag change.
   */
  readonly objects: readonly WidgetType[];
  /** The objects' springs (springs.ts `SPRINGS`). */
  readonly springs?: ObjectSprings;
  /** A deleted object's fade, ms (the prototype's 0.22 s). */
  readonly ghostMs?: number;
  /** The cull margin past the view, CSS px (the prototype's 200). */
  readonly marginPx?: number;
  /** The re-dressing after a zoom-through cut, ms (PORTAL.md §9's 320). */
  readonly redressMs?: number;
  /**
   * The kinds' own state on this desk by kind name (kinds/world.ts `KindLocal` — the note's writing,
   * D2c): threaded into every context of the kind as `ctx.local`, and told when an entity is FORGOTTEN
   * (its ghost faded, it left the frame, it died unseen) so what it held — a raster's rect — goes back.
   */
  readonly locals?: ReadonlyMap<string, KindLocal>;
  /** The interaction stack's marquee preview (out of the ECS — design-003 §5.7): the vellum the marks draw (D4a). */
  readonly marquee?: () => MarqueeBuffer | undefined;
}

export interface DeskBuilderStats {
  /** Objects Active in the frame this build saw. */
  readonly active: number;
  /** Objects drawn in the root slot — within the view and its margin, plus the ghosts. */
  readonly objects: number;
  /** Objects off screen this build (the root slot). */
  readonly culled: number;
  /** Deleted objects still fading. */
  readonly ghosts: number;
  /** Live insides built this frame, every depth (the departed desk's included). */
  readonly portals: number;
  /** True after a build while any spring or ghost is still moving, or a re-dressing ramp runs. */
  readonly live: boolean;
}

/** What can dirty the builder: a journaled world write, a despawn, a document reset, the sibling order, the hover target, the marks' own facts (the snap's chrome, the vellum, a drag meeting tape, the gestures — D4a). */
export type DeskWakeReason = "world" | "removed" | "reset" | "order" | "hover" | "marks";
const WAKE_REASONS: readonly DeskWakeReason[] = ["world", "removed", "reset", "order", "hover", "marks"];

/** The springs a host may pin: each present key holds that spring at the value. */
export type FluxPin = Partial<Pick<ObjectFlux, "lift" | "hover" | "ring">>;

/** What a build may be told beyond the camera (a harness's pins, the reflector's clocks). */
export interface BuildOptions {
  /** The frame's clock, ms (`FrameInfo.now`) — the re-dressing ramp's. */
  readonly now?: number;
  /** The mat's clocks and tilt for every slot this frame (the reflector's ambient frame). */
  readonly mat?: MatFrame;
  /** Live insides on (the default). Off, every face draws its far LOD alone (the oracle's `portals: false`). */
  readonly portals?: boolean;
  /** A pinned root dressing (the oracle's `lodZoom`). */
  readonly lodZoom?: number;
  /** Hold every spring and ghost where it is — a still of a moving frame (a rig's flight pin). */
  readonly freeze?: boolean;
  /** Hold the re-dressing ramp at its start (the prototype harness's `redressPinned`). */
  readonly holdRedress?: boolean;
  /** THE HAND PINNED (D4b — a still of the opening): the carry amount held at `e`, the kind's open motion snapped to `open` (default: open past 42 %). */
  readonly hold?: HoldPin;
}

export interface HoldPin { readonly e: number; readonly open?: boolean }

/**
 * The object IN HAND as the last build made it (design-015 §8; D4b): the entity, whether the pickup has settled and whether
 * it is flying home (the fact already gone), the frame the pose seam publishes (core's `HeldScreenFrame`, CSS px), what the
 * ground draws (`GroundFrameInputs.held` less its `stamp` — the reflector adds the camera's and the viewport's stamps), and the
 * desk's own change count `deskSeq` — everything the desk copy depends on, never the held object's own facts.
 */
export interface HeldBuild {
  readonly entity: Entity;
  /** The carry amount this frame, 0 on the desk … 1 in hand (also `inputs.e` — here for the witnesses). */
  readonly e: number;
  readonly settled: boolean;
  readonly landing: boolean;
  readonly frame: { readonly cx: number; readonly cy: number; readonly hx: number; readonly hy: number; readonly s: number; readonly settled: boolean };
  readonly inputs: Omit<HeldFrameInputs, "stamp">;
  readonly deskSeq: number;
}

export interface BuiltDesk {
  /** The root slot's objects in paint order — what `SlotInputs.objects` takes. */
  readonly objects: readonly SlotObject[];
  /** The root slot's live insides (MINIMAT.md §3). */
  readonly portals: readonly PortalInputs[];
  /** The current frame's grid: the root's, or the entered mini mat's inside grid. */
  readonly grid: GridConfig;
  /** The root's dressing: a flight's landing, a re-dressing's ramp, a pin — absent = its own zoom. */
  readonly lodZoom?: number;
  /** The root's presentation while a flight is on. */
  readonly present?: Presentation;
  /** The root's lamp while it is handed over (a flight, a re-dressing after a cut in). */
  readonly light?: SlotLight;
  /** The departed desk while a flight is on. */
  readonly outgoing?: OutgoingInputs;
  /** The desk's chrome this frame (stratum 5 — `GroundFrameInputs.marks`, D4a): the root slot's, the current frame's desk. */
  readonly marks: MarksInput;
  /** The object in hand, or flying home (D4b): out of `objects` and of the marks, drawn as a slot of its own over the desk out of focus. */
  readonly held?: HeldBuild;
  readonly stats: DeskBuilderStats;
}

export interface DeskBuilder {
  /**
   * Advance every on-screen object's springs by `dt` SECONDS and build this frame's records under
   * `cam` and `vp`: `theme` and `grid` are the root's; `looks` is each kind's `theme()` result by
   * kind name (the reflector keeps them per theme); `opts` the clocks and a harness's pins.
   */
  build(cam: CameraState, vp: BuildViewport, dt: number, theme: GroundTheme, grid: GridConfig, looks: ReadonlyMap<string, unknown>, opts?: BuildOptions): BuiltDesk;
  /** True while a spring, a ghost or a re-dressing ramp still moves after the last build — the reflector paints again. */
  live(): boolean;
  /**
   * PULL the world's dirt: did any fact a build reads change since the last pull — an object's
   * position, size or props, its Grab, its selection, the Active set, a despawn, a document reset,
   * the sibling order, the hover target? Call it every tick (it drains the journal); `wakes()` names
   * what changed.
   */
  changed(): boolean;
  /** How many times each fact has dirtied the builder since creation. */
  wakes(): Readonly<Record<DeskWakeReason, number>>;
  /** The last build's geometry for an entity — the pick source's mirror; `undefined` = not drawn (unseen, culled, gone). */
  geometryOf(e: Entity): unknown | undefined;
  /** The kind an entity draws by, once the builder has met it. */
  kindOf(e: Entity): ObjectKind | undefined;
  /** The last build's flux for an entity (the rig's witness). */
  fluxOf(e: Entity): ObjectFlux | undefined;
  /** The last build's view of a container's inside — its camera, presence and clip under the slot it was drawn in (a rig's witness). */
  insideViewOf(e: Entity): InsideView | undefined;
  /**
   * THE SEAM's answer (design-015 §9): the container's face under the host camera `cam` — AS DRAWN
   * when it was built in the current frame this frame, at REST otherwise (the frame's own container,
   * an exit's) — with the inside's arrival, embedding, camera, presence and cover test. `undefined`:
   * not a container kind, or a face with no area.
   */
  navFace(container: Entity, cam: CameraState): NavFace | undefined;
  /**
   * A per-entity asset the host pins — a committed raster, a note's greeked writing (`ObjectContext.asset`);
   * `undefined` unpins. Kept BY ENTITY, met or not: a pin made in the same task as the spawn (the parity
   * scene's ink, before the entity's facts are readable) waits for the first build. Dirties the builder.
   */
  pin(e: Entity, asset: unknown): void;
  /**
   * Pin an object's springs for a STILL (a parity scene's `held` = `{ lift: 1 }` — never a `Grab`,
   * which would also carry it to the top of the paint order): each pinned spring SITS at its
   * target, snapped, whatever the facts say; the unpinned ones keep following them. `undefined`
   * unpins. Dirties the builder. Flux, never a world fact.
   */
  pinFlux(e: Entity, targets: FluxPin | undefined): void;
  /** Every flux pin lifted. */
  clearFlux(): void;
  /** The widest `reach` among the desk's kinds, world units — the pick source's pad. */
  reach(): number;
  /** The selection menu's anchor as of the last build: the marks' box around the selection on screen, whether a gesture is on (D4a). */
  anchor(): SelectionAnchor;
  /**
   * A drag a host refused on `e` outside core's move — a print's own carry (D3w): a taped object gives, as a core drag that
   * meets the tape makes it give (D4a). The next `changed()` reports it.
   */
  meetTape(e: Entity): void;
  /** The object in hand as of the last build (D4b) — what the pose seam answers from; undefined = nothing held or flying home. */
  hand(): HeldBuild | undefined;
  stats(): DeskBuilderStats;
  dispose(): void;
}

interface ObjectState {
  readonly kind: ObjectKind;
  readonly widget: WidgetType;
  /** The cached facts — refreshed on the journal's word, never per frame. */
  rect: ObjectRect;
  props: Record<string, unknown>;
  selected: boolean;
  grabbed: boolean;
  /** Taped down (`Locked`) and resizable (`Resizable`) — what the marks read (D4a). */
  locked: boolean;
  resizable: boolean;
  band: number;
  dirty: boolean;
  /** The springs: value and velocity. */
  lift: number;
  liftV: number;
  hover: number;
  hoverV: number;
  ring: number;
  ringV: number;
  /** The last build's geometry and record; null when not drawn (culled, unseen). */
  geometry: unknown | null;
  record: unknown | null;
  /** The last build's view of its inside (a container), null when none. */
  inside: InsideView | null;
  /** Where it was drawn last: the current frame's root slot, a live inside, the departed desk. */
  slot: "root" | "inside" | "departed";
  /** The object painted right after it in the last build — where a ghost of it keeps its place (the indices shift when it leaves; a neighbour does not). */
  next: Entity | undefined;
  /** The build that last saw it in the frame. */
  seen: number;
}

interface Ghost {
  readonly kind: ObjectKind;
  readonly rect: ObjectRect;
  readonly props: Readonly<Record<string, unknown>>;
  readonly flux: ObjectFlux;
  readonly band: number;
  /** The object it was painted just before; absent = it was its band's last. */
  readonly next: Entity | undefined;
  readonly asset: unknown;
  /** The fade's progress, 0 … 1 gone. */
  del: number;
}

interface Row {
  readonly entity: Entity | undefined;
  readonly kind: string;
  readonly record: unknown;
  readonly band: number;
}

/** One slot's build: its rows in paint order, its live insides, its containers' geometry by entity. */
interface SlotBuild {
  readonly rows: Row[];
  readonly portals: PortalInputs[];
  readonly culled: number;
}

const EMPTY_STATS: DeskBuilderStats = { active: 0, objects: 0, culled: 0, ghosts: 0, portals: 0, live: false };
const GHOST_MS = 220;
const MARGIN_PX = 200;
const REDRESS_MS = 320;
/** The host belt: a live inside's insides show live to this depth (the prototype's `depth < 4`). */
const PORTAL_DEPTH = 4;
/** At most this many chips per face (MINIMAT.chips.max). */
const CHIPS_MAX = MINIMAT.chips.max;

// An object: a widget (PrefabId, Position, Size) Active in the current nav frame — the same membership the cull and the pick use.
const membersQ = defineQuery([Position, Size, PrefabId, Active]);
// The departed frame's widgets while a flight is on (nav-flight.ts `retainDeparted`).
const retainedQ = defineQuery([Position, Size, PrefabId, Retained]);
// The local pointers; the MOUSE one's exact hit is the hover.
const localPointersQ = defineQuery([Pointer, LocalPointer]);

/** The prop groups of the object types, deduplicated — what joins the journal. */
function propComponents(objects: readonly WidgetType[]): Component[] {
  const out = new Set<Component>();
  for (const w of objects) for (const g of w.groups) out.add(g.component);
  return [...out];
}

/** One spring's frame: pinned = it sits at its target (a still); else advanced by `dt` and SNAPPED when settled. Returns [x, v, still moving]. */
function advance(x: number, v: number, target: number, hz: number, damp: number, dt: number, pinned: boolean): [number, number, boolean] {
  if (pinned) return [target, 0, false];
  const [nx, nv] = spring(x, v, target, hz, damp, dt);
  return settled(nx, nv, target) ? [target, 0, false] : [nx, nv, true];
}

/** Smooth at both ends; exactly 0 at or below `a` and 1 at or above `b`. */
const smoothstep = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** `from` → `to` in log space at `u` (PORTAL.md §9: the re-dressing eases the dressing's ZOOM, so it looks like a zoom). */
const lodEase = (from: number, to: number, u: number): number => (u >= 1 ? to : u <= 0 ? from : Math.exp(Math.log(from) + (Math.log(to) - Math.log(from)) * u));

export function createDeskBuilder(world: World, opts: DeskBuilderOptions): DeskBuilder {
  const S = opts.springs ?? SPRINGS;
  const locals = opts.locals;
  /** The entity is gone from this desk for good: its kind's own state lets go of it (D2c). */
  const forget = (kind: ObjectKind, e: Entity): void => { locals?.get(kind.name)?.forget?.(e); };
  const ghostS = (opts.ghostMs ?? GHOST_MS) / 1000;
  const marginPx = opts.marginPx ?? MARGIN_PX;
  const redressMs = opts.redressMs ?? REDRESS_MS;
  const order = createSiblingOrderIndex(world);
  const states = new Map<Entity, ObjectState>();
  const ghosts = new Map<Entity, Ghost>();
  const pins = new Map<Entity, FluxPin>();
  /** The hosts' pinned assets by entity (a committed raster) — outside the state, so a pin outlives a state the builder has not made yet. */
  const assets = new Map<Entity, unknown>();
  /** Each parent's children in sibling order, cached against the parent's order stamp (strata's per-parent `orderStamp`). */
  const kids = new Map<Entity, { stamp: number; list: Entity[] }>();
  const wakes = Object.fromEntries(WAKE_REASONS.map((r) => [r, 0])) as Record<DeskWakeReason, number>;
  let stats: DeskBuilderStats = EMPTY_STATS;
  let disposed = false;
  let seq = 0;
  let dirtyAll = true;
  /** A wake the world does not carry (a pin): `changed()` reports it once. */
  let woke = false;
  let lastHover: Entity | undefined;
  let mouse: Entity | undefined;
  /** The widest reach: the listed types' kinds, and any kind met since. */
  let reach = 0;
  /** The re-dressing ramp: the epoch seen and the clock it started at. */
  let redressEpoch = 0;
  let redressStart = 0;
  /** The nav frame of the last build: a change drops the ghosts (they belong to the desk they died in). */
  let lastFrame: Entity | undefined;
  /** The last build's root grid, looks and theme — what a container resolves at REST with when the seam asks between builds. */
  let lastGrid: GridConfig | undefined;
  let lastLooks: ReadonlyMap<string, unknown> | undefined;
  let lastTheme: GroundTheme | undefined;
  const kindsSeen = new Set<ObjectKind>();
  const meet = (kind: ObjectKind): void => {
    if (kindsSeen.has(kind)) return;
    kindsSeen.add(kind);
    if (kind.reach > reach) reach = kind.reach;
  };
  for (const w of opts.objects) { const k = objectKindOf(w); if (k !== undefined) meet(k); }
  // The journal of every fact a build reads — value writes, adds, removals and despawns of the components, membership flips
  // of the tags. `coarse: false`: every writer of these goes through the store (core's attestation, the ground's precedent).
  const readsC: Component[] = [];
  const readsT: Tag[] = [];
  for (const k of kindsSeen) { readsC.push(...(k.reads?.components ?? [])); readsT.push(...(k.reads?.tags ?? [])); }
  const marks = createMarksCollector(world, opts.marquee !== undefined ? { marquee: opts.marquee } : {});
  const collector = world.changes.collect({
    components: [Position, Size, PrefabId, Grab, HeldView, ...propComponents(opts.objects), ...readsC],
    tags: [Selected, Active, Container, Locked, WidgetEquipped, Retained, Held, ...readsT],
    coarse: false,
  });
  /**
   * THE HAND (design-015 §8; D4b): the one object in hand or flying home — its clock (`p` over 560 ms up, 440 ms home after a
   * 140 ms close lead), its carry `e` (the island ease of `p`; home from `e0` where the put-down caught it), and the kind's
   * openness as of the last build (the flight home starts once it is under 0.35, the landing once under 0.02). Flux — the FACT
   * is core's `Held`; this outlives it by the flight home.
   */
  let hand: { entity: Entity; dir: 1 | -1; p: number; e: number; e0: number; closeT: number; openness: number } | null = null;
  let lastHand: HeldBuild | undefined;
  /** The desk's change count — everything the blurred copy behind the hand depends on; a change to the held object alone never bumps it. */
  let deskSeq = 0;
  /** The pickup's progress at a carry amount — the island ease inverted by bisection (a put-down caught mid-flight, a pinned still). */
  const inverseCarry = (e: number): number => {
    if (e <= 0) return 0;
    if (e >= 1) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (carryOf(mid) < e) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  };
  // The comparator's reader: the stratum from the cache (stamped at equip, cached at first sight), the rest the world's.
  const reader: StackOrderReader = {
    get<T>(e: Entity, c: Component<T>): T | undefined {
      if ((c as Component) === (Stratum as Component)) { const st = states.get(e); return st === undefined ? world.get(e, c) : ({ band: st.band } as unknown as T); }
      return world.get(e, c);
    },
  };

  /** The local mouse pointer's exact hit, if it is one of ours — none while something is in hand (the desk behind is inert, D4b). */
  const hoverTarget = (): Entity | undefined => {
    if (hand !== null) return undefined;
    if (mouse === undefined || !world.isAlive(mouse)) {
      mouse = undefined;
      world.query(localPointersQ).each((b) => { for (const r of b) { const p = b.entity(r); if (world.read(p, Pointer).device === "mouse") mouse = p; } });
    }
    if (mouse === undefined) return undefined;
    const t = world.getRelation(mouse, TouchesExact);
    return t !== undefined && states.has(t) ? t : undefined;
  };

  /** Read the facts into the cache. */
  const refresh = (e: Entity, st: ObjectState): void => {
    const x = world.readField(e, Position, "x") ?? 0;
    const y = world.readField(e, Position, "y") ?? 0;
    const w = world.readField(e, Size, "w") ?? 0;
    const h = world.readField(e, Size, "h") ?? 0;
    st.rect = rectOf({ x, y }, { w, h });
    const props: Record<string, unknown> = {};
    for (const g of st.widget.groups) {
      const v = world.get(e, g.component) as Record<string, unknown> | undefined;
      if (v !== undefined) for (const name of Object.keys(g.fields)) props[name] = v[name];
    }
    st.props = props;
    st.selected = world.hasTag(e, Selected);
    st.grabbed = world.has(e, Grab);
    st.locked = world.hasTag(e, Locked);
    st.resizable = world.hasTag(e, Resizable);
    st.band = world.get(e, Stratum)?.band ?? DEFAULT_STRATUM_BAND;
    st.dirty = false;
  };

  /** Meet an entity: its widget type through the engine's catalog, its kind off the binding; not an object = nothing. */
  const enter = (e: Entity): ObjectState | undefined => {
    if (!world.isAlive(e)) return undefined;
    const id = world.get(e, PrefabId)?.id;
    if (typeof id !== "string") return undefined;
    const widget = widgetTypeFor(world, id);
    const kind = objectKindOf(widget);
    if (widget === undefined || kind === undefined) return undefined;
    meet(kind);
    const st: ObjectState = {
      kind, widget, rect: { cx: 0, cy: 0, w: 0, h: 0 }, props: {}, selected: false, grabbed: false, locked: false, resizable: false, band: DEFAULT_STRATUM_BAND, dirty: true,
      lift: 0, liftV: 0, hover: 0, hoverV: 0, ring: 0, ringV: 0, geometry: null, record: null, inside: null, slot: "root", next: undefined, seen: 0,
    };
    states.set(e, st);
    return st;
  };

  /** The state for an entity, met and fresh — or undefined when it is not an object. */
  const stateOf = (e: Entity): ObjectState | undefined => {
    const st = states.get(e) ?? enter(e);
    if (st === undefined) return undefined;
    if (st.dirty || dirtyAll) refresh(e, st);
    return st;
  };

  /** An entity the journal reports gone: a ghost at its last paint, if it was ever drawn in the root slot. */
  const ghostOf = (e: Entity, st: ObjectState): void => {
    if (st.geometry === null || st.slot !== "root") return;
    ghosts.set(e, { kind: st.kind, rect: st.rect, props: st.props, flux: { lift: st.lift, hover: st.hover, ring: st.ring, fade: 1 }, band: st.band, next: st.next, asset: assets.get(e), del: 0 });
  };

  const fluxOf = (st: ObjectState): ObjectFlux => ({ lift: st.lift, hover: st.hover, ring: st.ring, fade: 1 });

  /**
   * A parent's children that are objects, in sibling order (strata's ordered `ChildOf`), the strata
   * bands ascending within — the inside's paint order (sheets under things) — cached against the
   * parent's order stamp; every cache is dropped when the journal reports a removal or a reset.
   */
  const childrenOf = (parent: Entity): Entity[] => {
    const stamp = world.orderStamp(parent, ChildOf);
    const hit = kids.get(parent);
    if (hit !== undefined && hit.stamp === stamp) return hit.list;
    const list: Entity[] = [];
    for (const c of world.getReverse(parent, ChildOf)) if (stateOf(c) !== undefined) list.push(c);
    const band = (e: Entity): number => states.get(e)?.band ?? DEFAULT_STRATUM_BAND;
    list.sort((a, b) => band(a) - band(b));   // stable: the sibling sequence within a band
    kids.set(parent, { stamp, list });
    return list;
  };

  /** The bounds of a container's children — the inside's content (`contentOf`); null = empty. */
  const contentOf = (container: Entity): Rect | null => {
    const rects: Rect[] = [];
    for (const c of childrenOf(container)) {
      const st = stateOf(c);
      if (st === undefined) continue;
      rects.push({ x: st.rect.cx - st.rect.w / 2, y: st.rect.cy - st.rect.h / 2, width: st.rect.w, height: st.rect.h });
    }
    return boundsOf(rects);
  };

  const viewportOf = (): { readonly width: number; readonly height: number } => {
    const vp = world.getResource(Viewport);
    return { width: vp?.w ?? 0, height: vp?.h ?? 0 };
  };

  /** The frame's grid: the root's for the board root, a container kind's `insideGrid` for a mini mat entered. */
  const frameGridOf = (frame: Entity | undefined, root: GridConfig, looks: ReadonlyMap<string, unknown>): GridConfig => {
    if (frame === undefined || !world.isAlive(frame) || !world.hasTag(frame, Container)) return root;
    const st = stateOf(frame);
    if (st === undefined || st.kind.insideGrid === undefined) return root;
    return st.kind.insideGrid({ props: st.props, look: looks.get(st.kind.name) }, root);
  };

  /** THE SEAM's answer (design-015 §9) — see `DeskBuilder.navFace`. */
  const navFace = (container: Entity, cam: CameraState): NavFace | undefined => {
    const st = stateOf(container);
    if (st === undefined || st.kind.face === undefined) return undefined;
    // as DRAWN when it was built in the current frame this frame; at REST otherwise (the frame's own container, an exit's)
    let G: unknown;
    if (st.seen === seq && st.geometry !== null && st.slot === "root") G = st.geometry;
    else {
      const grid = lastGrid;
      const theme = lastTheme;
      if (grid === undefined || theme === undefined) return undefined;
      const vp = world.getResource(Viewport);
      const view: ObjectContext["view"] = { camX: cam.x, camY: cam.y, zoom: cam.zoom, width: vp?.w ?? 0, height: vp?.h ?? 0, dpr: vp?.dpr ?? 1 };
      const local = locals?.get(st.kind.name);
      const ctx: ObjectContext = { entity: container, rect: st.rect, props: st.props, flux: FLUX_REST, look: lastLooks?.get(st.kind.name), theme, lamp: lampOf(grid.mat.plane), view, grid, dt: 0, ...(local !== undefined ? { local } : {}) };
      G = st.kind.resolve(ctx);
    }
    const face = st.kind.face(G);
    if (face === undefined) return undefined;
    const vpSize = viewportOf();
    const view = insideViewOfFace(face, contentOf(container), cam, vpSize, FIT, PORTAL_GATE);
    if (view === null) return undefined;
    return { face, arrival: view.arrival, affine: view.M, camera: view.cam, presence: view.presence, covers: (marginPx: number) => faceCovers(view.clip, vpSize, marginPx) };
  };

  return {
    build(cam, vp, dt0, theme, grid, looks, bopts = {}) {
      if (disposed) return { objects: [], portals: [], grid, marks: marks.frame({ rows: [], cam, view: vp, dt: 0, night: false, rulers: null }), stats: EMPTY_STATS };
      seq += 1;
      lastGrid = grid;
      lastLooks = looks;
      lastTheme = theme;
      const now = bopts.now ?? 0;
      const portalsOn = bopts.portals !== false;
      const nav = world.getResource(NavTransition);
      const flying = nav?.active === true;
      // the cut frame (D-D2b.7) and a harness's freeze: no spring advances — the departed desk IS its pre-cut frame
      const dt = bopts.freeze === true || (flying && nav.p === 0) ? 0 : dt0;
      const lamp: Lamp = lampOf(grid.mat.plane);
      const vpSize = { width: vp.width, height: vp.height };
      const ordinals = order.ordinals();
      const hover = hoverTarget();
      const frame = currentNavFrame(world);
      // a nav cut changes the desk under the camera: a ghost of the desk left would fade in the wrong desk's units (the prototype has
      // no ghost across desks) — the ghosts go with the frame
      if (frame !== lastFrame) { ghosts.clear(); lastFrame = frame; }
      const frameGrid = frameGridOf(frame, grid, looks);
      let portalsCount = 0;
      let live = false;
      /** The root slot's objects as the marks go around them (D4a) — the inside and departed slots add none. */
      const markRows: MarkRow[] = [];

      /** One object's context for a slot, its springs advanced (`springs`) or at rest. */
      const contextOf = (e: Entity, st: ObjectState, view: ObjectContext["view"], slotGrid: GridConfig, slotLamp: Lamp, springs: boolean, rect: ObjectRect = st.rect): ObjectContext => {
        let flux: ObjectFlux;
        if (springs) {
          // the springs: the hold's lift (Grab), the hover's rise (the exact hit, never while held), the ring (Selected) — each snapped
          // when settled; a host's pin (`pinFlux`) holds a spring AT its value, a still
          const pin = pins.get(e);
          let moving: boolean;
          [st.lift, st.liftV, moving] = advance(st.lift, st.liftV, pin?.lift ?? (st.grabbed ? 1 : 0), S.liftHz, S.liftDamp, dt, pin?.lift !== undefined);
          live ||= moving;
          [st.hover, st.hoverV, moving] = advance(st.hover, st.hoverV, pin?.hover ?? (hover === e && !st.grabbed ? 1 : 0), S.liftHz, S.liftDamp, dt, pin?.hover !== undefined);
          live ||= moving;
          [st.ring, st.ringV, moving] = advance(st.ring, st.ringV, pin?.ring ?? (st.selected ? 1 : 0), S.ringHz, S.ringDamp, dt, pin?.ring !== undefined);
          live ||= moving;
          // the kinds' own selection ring is retired — the marks draw the selection (D4a): they are handed ring 0, so a selected
          // object's pixels are the unselected object's
          flux = { ...fluxOf(st), ring: 0 };
        } else flux = FLUX_REST;
        const asset = assets.get(e);
        const local = locals?.get(st.kind.name);
        return { entity: e, rect, props: st.props, flux, look: looks.get(st.kind.name), theme, lamp: slotLamp, view, grid: slotGrid, dt, ...(asset !== undefined ? { asset } : {}), ...(local !== undefined ? { local } : {}) };
      };

      /**
       * A container's inside for its record (D2b): its content, its view through its face under the slot's camera, its children as
       * chips (each resolved at rest in the inside's own units) — and the candidate for a live slot when the gate lets it through.
       */
      const insideOf = (e: Entity, st: ObjectState, G: unknown, ctx: ObjectContext, slotCam: CameraState, slotGrid: GridConfig): InsideContext | undefined => {
        const face = st.kind.face?.(G);
        if (face === undefined) { st.inside = null; return undefined; }
        const content = contentOf(e);
        const view = insideViewOfFace(face, content, slotCam, vpSize, FIT, PORTAL_GATE);
        st.inside = view;
        const insideGrid = st.kind.insideGrid?.({ props: st.props, look: ctx.look }, slotGrid) ?? slotGrid;
        const chips: ChildShape[] = [];
        if (view !== null) {
          const insideLamp = lampOf(insideGrid.mat.plane);
          const insideView: ObjectContext["view"] = { camX: view.cam.x, camY: view.cam.y, zoom: view.cam.zoom, width: vp.width, height: vp.height, dpr: vp.dpr };
          for (const c of childrenOf(e)) {
            if (chips.length >= CHIPS_MAX) break;
            const cst = stateOf(c);
            if (cst === undefined || cst.kind.chip === undefined) continue;
            const cctx = contextOf(c, cst, insideView, insideGrid, insideLamp, false);
            const chip = cst.kind.chip(cst.kind.resolve(cctx), cctx);
            if (chip !== null) chips.push(chip);
          }
        }
        return { content, view, chips };
      };

      /**
       * Build one slot: `members` in paint order under `slotCam`, culled against the view and its margin (plus each kind's reach);
       * each container gets its inside, and the live insides that pass the gate — depth < 4, `presence > 0`, not the flight's `skip`
       * — are built through their faces, the largest first up to the cap, recursing.
       */
      const buildSlot = (members: readonly Entity[], slotCam: CameraState, slotGrid: GridConfig, slot: ObjectState["slot"], depth: number, skip: Entity | undefined, redressOut: { frame: Entity; from: number; u: number } | undefined): SlotBuild => {
        const slotLamp = lampOf(slotGrid.mat.plane);
        const view: ObjectContext["view"] = { camX: slotCam.x, camY: slotCam.y, zoom: slotCam.zoom, width: vp.width, height: vp.height, dpr: vp.dpr };
        const m = marginPx / slotCam.zoom;
        const x0 = slotCam.x - m;
        const y0 = slotCam.y - m;
        const x1 = slotCam.x + vp.width / slotCam.zoom + m;
        const y1 = slotCam.y + vp.height / slotCam.zoom + m;
        const rows: Row[] = [];
        const cands: { at: number; e: Entity; view: InsideView; grid: GridConfig }[] = [];
        let culled = 0;
        for (let i = 0; i < members.length; i++) {
          const e = members[i] as Entity;
          const st = stateOf(e);
          if (st === undefined) continue;
          st.seen = seq;
          st.slot = slot;
          st.next = slot === "root" ? members[i + 1] : undefined;
          // the object in hand (or flying home) is drawn as a slot of its own over the desk, never among the desk's rows nor its marks (D4b)
          if (hand !== null && e === hand.entity && slot === "root") continue;
          const r = st.rect;
          const hx = r.w / 2 + st.kind.reach;
          const hy = r.h / 2 + st.kind.reach;
          if (r.cx + hx < x0 || r.cx - hx > x1 || r.cy + hy < y0 || r.cy - hy > y1) { st.geometry = null; st.record = null; st.inside = null; culled += 1; continue; }
          // a drag that met the tape shivers the object by its give (CSS px → world) — in the root slot alone, where the marks are (D4a)
          const give = slot === "root" ? marks.giveOf(e) : 0;
          const drawn = give === 0 ? r : { ...r, cx: r.cx + give / slotCam.zoom };
          // the root's and the departed desk's objects run their springs; an inside's members lie at rest
          const ctx = contextOf(e, st, view, slotGrid, slotLamp, slot !== "inside", drawn);
          const G = st.kind.resolve(ctx);
          const inside = insideOf(e, st, G, ctx, slotCam, slotGrid);
          const R = st.kind.record(G, inside === undefined ? ctx : { ...ctx, inside });
          st.geometry = G;
          st.record = R;
          const at = rows.length;
          rows.push({ entity: e, kind: st.kind.name, record: R, band: st.band });
          // the marks go around what was drawn: the kind's frame on the geometry just resolved, ICE's rect (D4a)
          if (slot === "root") markRows.push({ entity: e, frame: st.kind.frame?.(G) ?? rectFrame(drawn), rect: { x0: r.cx - r.w / 2, y0: r.cy - r.h / 2, x1: r.cx + r.w / 2, y1: r.cy + r.h / 2 }, selected: st.selected, locked: st.locked, grabbed: st.grabbed, resizable: st.resizable });
          if (inside?.view && portalsOn && depth < PORTAL_DEPTH && e !== skip && inside.view.presence > 0) {
            cands.push({ at, e, view: inside.view, grid: st.kind.insideGrid?.({ props: st.props, look: ctx.look }, slotGrid) ?? slotGrid });
          }
        }
        // the live insides: the largest faces first, up to the cap (MINIMAT.md §3), each a slot of its own through its face
        cands.sort((a, b) => b.view.clip.hx * b.view.clip.hy - a.view.clip.hx * a.view.clip.hy);
        const portals: PortalInputs[] = [];
        for (const c of cands.slice(0, PORTAL_CAP)) {
          const sub = buildSlot(childrenOf(c.e), c.view.cam, c.grid, "inside", depth + 1, undefined, undefined);
          portalsCount += 1;
          // a desk cut out of by a zoom-through is still dressed and lit as it left itself, handing both to this desk over the ramp (MINIMAT.md §4)
          const redress = redressOut !== undefined && redressOut.frame === c.e ? redressOut : undefined;
          portals.push({
            view: { camX: c.view.cam.x, camY: c.view.cam.y, zoom: c.view.cam.zoom, width: vp.width, height: vp.height, dpr: vp.dpr, box: c.view.box },
            ...(bopts.mat !== undefined ? { mat: bopts.mat } : {}),
            lodZoom: redress === undefined ? c.view.arrival.zoom : lodEase(redress.from, c.view.arrival.zoom, redress.u),
            present: insidePresent(c.view),
            ...(redress !== undefined ? { light: { a: c.view.cam, b: slotCam, t: redress.u } } : {}),
            grid: c.grid,
            objects: sub.rows.map((r) => ({ kind: r.kind, record: r.record })),
            ...(sub.portals.length ? { portals: sub.portals } : {}),
            at: c.at,
          });
        }
        return { rows, portals, culled };
      };

      // THE RE-DRESSING (a zoom-through cut): its ramp from the clock it was first seen at; a harness may hold it at 0
      const redress = world.getResource(NavRedress);
      let redressIn: { from: number; u: number; frame: Entity } | undefined;
      let redressOut: { frame: Entity; from: number; u: number } | undefined;
      if (redress !== undefined && redress.epoch > 0 && !flying) {
        if (redress.epoch !== redressEpoch) { redressEpoch = redress.epoch; redressStart = now; }
        const u = bopts.holdRedress === true ? 0 : smoothstep(0, 1, Math.min(1, (now - redressStart) / Math.max(redressMs, 1)));
        if (u < 1) {
          live = true;
          if (redress.kind === "in") redressIn = { from: redress.from, u, frame: redress.frame };
          else redressOut = { frame: redress.frame, from: redress.from, u };
        }
      }

      // THE HAND (design-015 §8; D4b): the fact is `Held` — picked up, the clock starts (or resumes from where a put-down caught it);
      // let go, it flies home from where it is. A harness pins the carry for a still. The object is resolved ONCE, in its own slot
      // under the pose's camera (its extent to the reading size, no dapple, the day's light by night as the carry rises), never
      // among the desk's rows; landed — home and shut — it is the desk's again this very frame, and the brackets lock back on.
      const heldNow = heldEntity(world);
      if (heldNow !== undefined) {
        if (hand === null || hand.entity !== heldNow) hand = { entity: heldNow, dir: 1, p: 0, e: 0, e0: 0, closeT: 0, openness: 0 };
        else if (hand.dir < 0) { hand.dir = 1; hand.p = inverseCarry(hand.e); hand.closeT = 0; }
      } else if (hand !== null && hand.dir > 0) { hand.dir = -1; hand.p = 0; hand.e0 = hand.e; hand.closeT = 0; }
      let heldBuild: HeldBuild | undefined;
      if (hand !== null) {
        const hst = world.isAlive(hand.entity) ? stateOf(hand.entity) : undefined;
        const binding = hst?.kind.open;
        if (hst === undefined || binding === undefined) hand = null;   // gone (deleted, undone) or no opening after all: nothing is in the hand
        else {
          const pin = bopts.hold;
          const hdt = bopts.freeze === true ? 0 : dt0;
          let openTarget: boolean;
          if (pin !== undefined) { hand.dir = 1; hand.e = Math.min(Math.max(pin.e, 0), 1); hand.p = inverseCarry(hand.e); openTarget = pin.open ?? hand.p >= HOLD.openAt; }
          else if (hand.dir > 0) { hand.p = Math.min(1, hand.p + hdt / (HOLD.inMs / 1000)); hand.e = carryOf(hand.p); openTarget = hand.p >= HOLD.openAt; }
          else {
            // putting it down: it shuts first (the lead, or once the cover is under 0.35), then flies home and lands softly
            hand.closeT += hdt;
            if (hand.closeT >= HOLD.closeLead || hand.openness < 0.35) { hand.p = Math.min(1, hand.p + hdt / (HOLD.outMs / 1000)); hand.e = (1 - carryOf(hand.p)) * hand.e0; }
            openTarget = false;
          }
          if (hand.dir < 0 && hand.p >= 1 && hand.openness < 0.02) hand = null;   // LANDED
          else {
            const extentLocal = binding.extent({ rect: hst.rect, props: hst.props });
            const angle = numberProp(hst.props, "angle", 0);
            // the extent turned with the object about its centre — where it lies on the desk (the home pose); in hand the turn lets go
            const ox = extentLocal.cx - hst.rect.cx;
            const oy = extentLocal.cy - hst.rect.cy;
            const ca = Math.cos(angle);
            const sa = Math.sin(angle);
            const extentWorld: ObjectRect = { cx: hst.rect.cx + ca * ox - sa * oy, cy: hst.rect.cy + sa * ox + ca * oy, w: extentLocal.w, h: extentLocal.h };
            const target = readingTarget(extentLocal, vpSize, binding.spread === true);
            const user = world.get(hand.entity, HeldView) ?? HELD_USER_REST;
            const pose = heldPose(homePose(extentWorld, angle, cam), target, user, hand.e);
            const { cam: heldCam, grow } = heldCamera(pose, hst.rect, extentLocal, cam.zoom, binding.pose === "eye", vpSize);
            const heldView: ObjectContext["view"] = { camX: heldCam.x, camY: heldCam.y, zoom: heldCam.zoom, width: vp.width, height: vp.height, dpr: vp.dpr };
            const heldGrid: GridConfig = { ...frameGrid, mat: { ...frameGrid.mat, gobo: { ...frameGrid.mat.gobo, opacity: 0 } } };   // dapple 0 in hand
            const base = contextOf(hand.entity, hst, heldView, heldGrid, lampOf(heldGrid.mat.plane), false);
            const props = typeof hst.props.angle === "number" ? { ...hst.props, angle: pose.angle } : hst.props;
            const snap = pin !== undefined || bopts.freeze === true;
            const hctx: ObjectContext = { ...base, props, held: { e: hand.e, open: openTarget, grow, snap } };
            const G = hst.kind.resolve(hctx);
            const R = hst.kind.record(G, hctx);
            hst.geometry = G;
            hst.record = R;
            hst.inside = null;
            hst.slot = "root";
            hst.seen = seq;
            hand.openness = binding.openness?.(hctx) ?? 0;
            const settledNow = pin !== undefined ? hand.e >= 1 : hand.dir > 0 && hand.p >= 1;
            const coverMoving = openTarget ? hand.openness < 1 - 1e-3 : hand.openness > 1e-3;
            if (pin === undefined && (hand.dir < 0 || hand.p < 1 || coverMoving)) live = true;
            const night = theme.name === "dark";
            heldBuild = {
              entity: hand.entity, e: hand.e, settled: settledNow, landing: hand.dir < 0,
              frame: { ...heldFrame(pose, extentLocal, target.single), settled: settledNow },
              inputs: {
                object: { kind: hst.kind.name, record: R }, view: heldView, grid: heldGrid, e: hand.e,
                blur: isNarrow(vpSize) ? HOLD.blurPhone : HOLD.blur, dim: HOLD.dim * hand.e,
                filter: night ? { saturate: 1 - (1 - HOLD.light.saturate) * hand.e, brightness: 1 - (1 - HOLD.light.brightness) * hand.e } : { saturate: 1, brightness: 1 },
                light: night ? mixLight(theme.matLight, DAY_LIGHT, hand.e) : theme.matLight,
              },
              deskSeq,
            };
          }
        }
      }
      lastHand = heldBuild;

      // membership: every object Active in the frame, its facts refreshed where the journal said, in two tiers — the carried set last
      const tiers: [Entity[], Entity[]] = [[], []];
      world.query(membersQ).each((b) => {
        for (const r of b) {
          const e = b.entity(r);
          const st = stateOf(e);
          if (st === undefined) continue;
          (st.grabbed ? tiers[1] : tiers[0]).push(e);
        }
      });
      dirtyAll = false;
      for (const t of tiers) t.sort((a, b) => compareStackOrder(reader, ordinals, a, b));
      const list = [...tiers[0], ...tiers[1]];
      // the root slot: the current frame's desk under the camera
      const root = buildSlot(list, cam, frameGrid, "root", 0, undefined, redressOut);
      const rows = root.rows;
      // the ghosts: each fades where it was — just before the object that followed it, else at its band's end — then is forgotten
      const rootView: ObjectContext["view"] = { camX: cam.x, camY: cam.y, zoom: cam.zoom, width: vp.width, height: vp.height, dpr: vp.dpr };
      const rootLamp = lampOf(frameGrid.mat.plane);
      for (const [e, g] of ghosts) {
        // a ghost fades on the frame's own clock, held or not: a held clock (a pinned flight) must not keep a deleted object on the desk
        g.del = Math.min(g.del + dt0 / ghostS, 1);
        if (g.del >= 1) { ghosts.delete(e); forget(g.kind, e); continue; }
        live = true;
        const local = locals?.get(g.kind.name);
        const ctx: ObjectContext = { entity: e, rect: g.rect, props: g.props, flux: { ...g.flux, ring: 0, fade: 1 - g.del }, look: looks.get(g.kind.name), theme, lamp: rootLamp, view: rootView, grid: frameGrid, dt, ...(g.asset !== undefined ? { asset: g.asset } : {}), ...(local !== undefined ? { local } : {}) };
        const G = g.kind.resolve(ctx);
        const row: Row = { entity: undefined, kind: g.kind.name, record: g.kind.record(G, ctx), band: g.band };
        let at = g.next === undefined ? -1 : rows.findIndex((q) => q.entity === g.next);
        if (at < 0) { at = rows.length; for (let i = 0; i < rows.length; i++) { if ((rows[i] as Row).band > row.band) { at = i; break; } } }
        rows.splice(at, 0, row);
        // a ghost before a live inside's mini mat shifts that inside's `at`
        for (let i = 0; i < root.portals.length; i++) { const p = root.portals[i] as PortalInputs; if (p.at >= at) root.portals[i] = { ...p, at: p.at + 1 }; }
      }

      // THE FLIGHT: the departed desk beside the arriving one
      let present: Presentation | undefined;
      let light: SlotLight | undefined;
      let lodZoom: number | undefined = bopts.lodZoom;
      let outgoing: OutgoingInputs | undefined;
      if (flying) {
        const entering = nav.kind === "enter";
        const outCam = departedCameraOf(nav, cam);
        // the departed frame's desk: its Retained widgets in their sibling order (the frame's parent: the board root, or the container left)
        const departedFrame = nav.fromFrame;
        const root0 = world.getResource(BoardRoot)?.root;
        const parent = departedFrame !== (0 as Entity) && world.isAlive(departedFrame) ? departedFrame : root0;
        let members: Entity[];
        if (parent !== undefined && world.isAlive(parent)) members = childrenOf(parent).filter((e) => world.hasTag(e, Retained));
        else { members = []; world.query(retainedQ).each((b) => { for (const r of b) members.push(b.entity(r)); }); }
        const departedGrid = frameGridOf(parent !== undefined && world.hasTag(parent, Container) ? parent : undefined, grid, looks);
        // the container the flight is through: entered (its inside is the arriving desk) or left (the arriving desk's live inside shows the same pixels)
        const container = entering ? nav.toFrame : nav.fromFrame;
        const departed = buildSlot(members, outCam, departedGrid, "departed", 0, entering ? container : undefined, undefined);
        // the face lives in the PARENT desk: the departed one on enter, the arriving one on exit. A frozen flight has none — it is a dissolve.
        let clip: Presentation["portal"] | undefined;
        let at = -1;
        if (!nav.frozen) {
          const cst = states.get(container);
          const face = cst !== undefined && cst.geometry !== null && cst.seen === seq ? cst.kind.face?.(cst.geometry) : undefined;
          if (face !== undefined) clip = clipOf(face, FACE_RADIUS, entering ? outCam : cam);
          if (entering) at = departed.rows.findIndex((r) => r.entity === container);
        }
        const f = { kind: nav.kind, p: nav.p, frozen: nav.frozen };
        const pres = flightPresent(f, clip, PORTAL_GATE);
        const lights = flightLights(f, cam, outCam);
        present = pres.incoming;
        light = lights.incoming;
        lodZoom = nav.c1z;   // the arriving desk is dressed for its landing (PORTAL.md §9)
        outgoing = {
          view: { camX: outCam.x, camY: outCam.y, zoom: outCam.zoom, width: vp.width, height: vp.height, dpr: vp.dpr },
          ...(bopts.mat !== undefined ? { mat: bopts.mat } : {}),
          lodZoom: nav.fromZ,   // the departed desk keeps the dressing it had at the cut
          present: pres.outgoing,
          ...(lights.outgoing !== undefined ? { light: lights.outgoing } : {}),
          grid: departedGrid,
          objects: departed.rows.map((r) => ({ kind: r.kind, record: r.record })),
          ...(departed.portals.length ? { portals: departed.portals } : {}),
          order: entering ? "under" : "over",
          ...(at >= 0 && clip !== undefined ? { at } : {}),
        };
      } else if (redressIn !== undefined) {
        // cut INTO by a zoom-through: the desk is dressed as its face showed it and lit by the desk it was cut from, easing to its own (MINIMAT.md §4)
        lodZoom = lodEase(redressIn.from, cam.zoom, redressIn.u);
        const face = navFace(redressIn.frame, cam);
        if (face !== undefined) light = { a: solveFlightStart(face.affine, cam), b: cam, t: redressIn.u };
      }

      // an object that left the frame without dying (a nav cut) is forgotten, no ghost: it was not deleted — its kind lets go of it (D2c)
      for (const [e, st] of states) if (st.seen !== seq) { states.delete(e); forget(st.kind, e); }
      const objects: SlotObject[] = rows.map((r) => ({ kind: r.kind, record: r.record }));
      // the marks: the root slot's rows under the root camera — the current frame's desk — and its grid's rulers (an entered mini mat prints none) (D4a)
      const ruler = frameGrid.mat.ruler;
      const marked = marks.frame({ rows: markRows, cam, view: vp, dt, night: theme.name === "dark", rulers: ruler.on ? { margin: ruler.margin, band: ruler.band } : null });
      live ||= marks.live();
      stats = { active: list.length, objects: objects.length, culled: root.culled, ghosts: ghosts.size, portals: portalsCount, live };
      return {
        objects,
        portals: root.portals,
        grid: frameGrid,
        ...(lodZoom !== undefined ? { lodZoom } : {}),
        ...(present !== undefined ? { present } : {}),
        ...(light !== undefined ? { light } : {}),
        ...(outgoing !== undefined ? { outgoing } : {}),
        marks: marked,
        ...(heldBuild !== undefined ? { held: heldBuild } : {}),
        stats,
      };
    },
    live: () => stats.live,
    changed() {
      if (disposed) return false;
      const delta = collector.drain();
      const wokeNow = woke;
      let any = woke;
      woke = false;
      // the desk copy behind the hand (D4b) stands while the only change is the held object's own (its HeldView, its facts): every
      // other dirt below bumps `deskSeq`
      const heldE = hand?.entity ?? heldEntity(world);
      let deskDirt = wokeNow;
      if (delta.reset) { wakes.reset += 1; dirtyAll = true; kids.clear(); any = true; deskDirt = true; }
      if (delta.changed.length > 0 || delta.coarse.length > 0) {
        wakes.world += 1;
        any = true;
        for (const e of delta.changed) { const st = states.get(e); if (st !== undefined) st.dirty = true; if (e !== heldE) deskDirt = true; }
        if (delta.coarse.length > 0) { dirtyAll = true; deskDirt = true; }
      }
      if (delta.removed.length > 0) {
        kids.clear();
        for (const e of delta.removed) {
          const st = states.get(e);
          if (st === undefined) continue;
          ghostOf(e, st);   // the ghost takes the asset with it
          if (!ghosts.has(e)) forget(st.kind, e);   // never drawn in the root: nothing fades, the kind lets go now (D2c)
          states.delete(e);
          pins.delete(e);
          assets.delete(e);
          wakes.removed += 1;
          any = true;
          deskDirt = true;
        }
      }
      if (order.stale()) { wakes.order += 1; any = true; deskDirt = true; }
      const h = hoverTarget();
      if (h !== lastHover) { lastHover = h; wakes.hover += 1; any = true; deskDirt = true; }
      if (marks.changed()) { wakes.marks += 1; any = true; deskDirt = true; }
      if (deskDirt) deskSeq += 1;
      return any;
    },
    wakes: () => ({ ...wakes }),
    geometryOf: (e) => states.get(e)?.geometry ?? undefined,
    kindOf: (e) => states.get(e)?.kind,
    fluxOf: (e) => { const st = states.get(e); return st === undefined ? undefined : fluxOf(st); },
    insideViewOf: (e) => states.get(e)?.inside ?? undefined,
    navFace,
    pin(e, asset) {
      if (asset === undefined) { if (!assets.delete(e)) return; } else assets.set(e, asset);
      woke = true;   // every record is remade at the next build; the facts need no re-read
      wakes.world += 1;
    },
    pinFlux(e, targets) {
      if (targets === undefined) { if (!pins.delete(e)) return; } else pins.set(e, targets);
      woke = true;
      wakes.world += 1;
    },
    clearFlux() {
      if (pins.size === 0) return;
      pins.clear();
      woke = true;
      wakes.world += 1;
    },
    reach: () => reach,
    anchor: () => marks.anchor(),
    meetTape: (e) => marks.refused(e),
    hand: () => lastHand,
    stats: () => stats,
    dispose() {
      disposed = true;
      marks.dispose();
      collector.dispose();
      states.clear();
      ghosts.clear();
      pins.clear();
      assets.clear();
      kids.clear();
    },
  };
}

/** The flux of an object nobody has met: at rest. */
export { FLUX_REST };
