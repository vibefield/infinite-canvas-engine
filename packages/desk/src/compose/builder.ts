// The DESK BUILDER — the world's objects as the ground's records (design-015 §4.4; D2a-world).
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
// The builder is pure with respect to the GPU: it makes records; the reflector hands them to
// `Ground.render`. PAN IS O(1) in the world: nothing here is stored per object in the ECS.

import {
  Active,
  Container,
  compareStackOrder,
  createSiblingOrderIndex,
  DEFAULT_STRATUM_BAND,
  defineQuery,
  Grab,
  LocalPointer,
  Locked,
  Pointer,
  Position,
  PrefabId,
  Selected,
  Size,
  type StackOrderReader,
  Stratum,
  TouchesExact,
  WidgetEquipped,
  widgetTypeFor,
  type Component,
  type Entity,
  type Tag,
  type WidgetType,
  type World,
} from "@ice/core";
import type { SlotObject } from "../ground";
import { FLUX_REST, type ObjectContext, type ObjectFlux, type ObjectKind, type ObjectRect, rectOf } from "../kinds/world";
import type { GridConfig } from "../mat/grid";
import { type Lamp, lampOf } from "../paper/paper";
import { objectKindOf } from "../object";
import { type ObjectSprings, SPRINGS, settled, spring } from "../springs";
import type { GroundTheme } from "../theme";
import type { CameraState } from "../nav/flight";

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
}

export interface DeskBuilderStats {
  /** Objects Active in the frame this build saw. */
  readonly active: number;
  /** Objects drawn — within the view and its margin, plus the ghosts. */
  readonly objects: number;
  /** Objects off screen this build. */
  readonly culled: number;
  /** Deleted objects still fading. */
  readonly ghosts: number;
  /** True after a build while any spring or ghost is still moving. */
  readonly live: boolean;
}

/** What can dirty the builder: a journaled world write, a despawn, a document reset, the sibling order, the hover target. */
export type DeskWakeReason = "world" | "removed" | "reset" | "order" | "hover";
const WAKE_REASONS: readonly DeskWakeReason[] = ["world", "removed", "reset", "order", "hover"];

/** The springs a host may pin: each present key holds that spring at the value. */
export type FluxPin = Partial<Pick<ObjectFlux, "lift" | "hover" | "ring">>;

export interface BuiltDesk {
  /** The root slot's objects in paint order — what `SlotInputs.objects` takes. */
  readonly objects: readonly SlotObject[];
  readonly stats: DeskBuilderStats;
}

export interface DeskBuilder {
  /**
   * Advance every on-screen object's springs by `dt` SECONDS and build this frame's records under
   * `cam` and `vp`: `theme` and `grid` are the slot's; `looks` is each kind's `theme()` result by
   * kind name (the reflector keeps them per theme).
   */
  build(cam: CameraState, vp: BuildViewport, dt: number, theme: GroundTheme, grid: GridConfig, looks: ReadonlyMap<string, unknown>): BuiltDesk;
  /** True while a spring or a ghost is still moving after the last build — the reflector paints again. */
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
  /**
   * A per-entity asset the host pins — a committed raster (`ObjectContext.asset`); `undefined`
   * unpins. Kept BY ENTITY, met or not: a pin made in the same task as the spawn (the parity scene's
   * ink, before the entity's facts are readable) waits for the first build. Dirties the builder.
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

const EMPTY_STATS: DeskBuilderStats = { active: 0, objects: 0, culled: 0, ghosts: 0, live: false };
const GHOST_MS = 220;
const MARGIN_PX = 200;

// An object: a widget (PrefabId, Position, Size) Active in the current nav frame — the same membership the cull and the pick use.
const membersQ = defineQuery([Position, Size, PrefabId, Active]);
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

export function createDeskBuilder(world: World, opts: DeskBuilderOptions): DeskBuilder {
  const S = opts.springs ?? SPRINGS;
  const ghostS = (opts.ghostMs ?? GHOST_MS) / 1000;
  const marginPx = opts.marginPx ?? MARGIN_PX;
  const order = createSiblingOrderIndex(world);
  const states = new Map<Entity, ObjectState>();
  const ghosts = new Map<Entity, Ghost>();
  const pins = new Map<Entity, FluxPin>();
  /** The hosts' pinned assets by entity (a committed raster) — outside the state, so a pin outlives a state the builder has not made yet. */
  const assets = new Map<Entity, unknown>();
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
  const collector = world.changes.collect({
    components: [Position, Size, PrefabId, Grab, ...propComponents(opts.objects), ...readsC],
    tags: [Selected, Active, Container, Locked, WidgetEquipped, ...readsT],
    coarse: false,
  });
  // The comparator's reader: the stratum from the cache (stamped at equip, cached at first sight), the rest the world's.
  const reader: StackOrderReader = {
    get<T>(e: Entity, c: Component<T>): T | undefined {
      if ((c as Component) === (Stratum as Component)) { const st = states.get(e); return st === undefined ? world.get(e, c) : ({ band: st.band } as unknown as T); }
      return world.get(e, c);
    },
  };

  /** The local mouse pointer's exact hit, if it is one of ours. */
  const hoverTarget = (): Entity | undefined => {
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
    st.band = world.get(e, Stratum)?.band ?? DEFAULT_STRATUM_BAND;
    st.dirty = false;
  };

  /** Meet an entity: its widget type through the engine's catalog, its kind off the binding; not an object = nothing. */
  const enter = (e: Entity): ObjectState | undefined => {
    const id = world.get(e, PrefabId)?.id;
    if (typeof id !== "string") return undefined;
    const widget = widgetTypeFor(world, id);
    const kind = objectKindOf(widget);
    if (widget === undefined || kind === undefined) return undefined;
    meet(kind);
    const st: ObjectState = {
      kind, widget, rect: { cx: 0, cy: 0, w: 0, h: 0 }, props: {}, selected: false, grabbed: false, band: DEFAULT_STRATUM_BAND, dirty: true,
      lift: 0, liftV: 0, hover: 0, hoverV: 0, ring: 0, ringV: 0, geometry: null, record: null, next: undefined, seen: 0,
    };
    states.set(e, st);
    return st;
  };

  /** An entity the journal reports gone: a ghost at its last paint, if it was ever drawn. */
  const ghostOf = (e: Entity, st: ObjectState): void => {
    if (st.geometry === null) return;
    ghosts.set(e, { kind: st.kind, rect: st.rect, props: st.props, flux: { lift: st.lift, hover: st.hover, ring: st.ring, fade: 1 }, band: st.band, next: st.next, asset: assets.get(e), del: 0 });
  };

  const fluxOf = (st: ObjectState): ObjectFlux => ({ lift: st.lift, hover: st.hover, ring: st.ring, fade: 1 });

  return {
    build(cam, vp, dt, theme, grid, looks) {
      if (disposed) return { objects: [], stats: EMPTY_STATS };
      seq += 1;
      const lamp: Lamp = lampOf(grid.mat.plane);
      const ordinals = order.ordinals();
      const view = { camX: cam.x, camY: cam.y, zoom: cam.zoom, width: vp.width, height: vp.height, dpr: vp.dpr };
      const m = marginPx / cam.zoom;
      const x0 = cam.x - m;
      const y0 = cam.y - m;
      const x1 = cam.x + vp.width / cam.zoom + m;
      const y1 = cam.y + vp.height / cam.zoom + m;
      const hover = hoverTarget();
      // membership: every object Active in the frame, its facts refreshed where the journal said, in two tiers — the carried set last
      const tiers: [Entity[], Entity[]] = [[], []];
      world.query(membersQ).each((b) => {
        for (const r of b) {
          const e = b.entity(r);
          const st = states.get(e) ?? enter(e);
          if (st === undefined) continue;
          if (st.dirty || dirtyAll) refresh(e, st);
          st.seen = seq;
          (st.grabbed ? tiers[1] : tiers[0]).push(e);
        }
      });
      dirtyAll = false;
      for (const t of tiers) t.sort((a, b) => compareStackOrder(reader, ordinals, a, b));
      const list = [...tiers[0], ...tiers[1]];
      // an object that left the frame without dying (a nav cut — D2b) is forgotten, no ghost: it was not deleted
      for (const [e, st] of states) if (st.seen !== seq) states.delete(e);
      // pass: the cull, the springs, the kind's geometry and record, in paint order
      const rows: Row[] = [];
      let live = false;
      let culled = 0;
      for (let i = 0; i < list.length; i++) {
        const e = list[i] as Entity;
        const st = states.get(e) as ObjectState;
        st.next = list[i + 1];
        const r = st.rect;
        const reachOf = st.kind.reach;
        const hx = r.w / 2 + reachOf;
        const hy = r.h / 2 + reachOf;
        if (r.cx + hx < x0 || r.cx - hx > x1 || r.cy + hy < y0 || r.cy - hy > y1) { st.geometry = null; st.record = null; culled += 1; continue; }
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
        const asset = assets.get(e);
        const ctx: ObjectContext = { entity: e, rect: r, props: st.props, flux: fluxOf(st), look: looks.get(st.kind.name), theme, lamp, view, grid, dt, ...(asset !== undefined ? { asset } : {}) };
        const G = st.kind.resolve(ctx);
        const R = st.kind.record(G, ctx);
        st.geometry = G;
        st.record = R;
        rows.push({ entity: e, kind: st.kind.name, record: R, band: st.band });
      }
      // the ghosts: each fades where it was — just before the object that followed it, else at its band's end — then is forgotten
      for (const [e, g] of ghosts) {
        g.del = Math.min(g.del + dt / ghostS, 1);
        if (g.del >= 1) { ghosts.delete(e); continue; }
        live = true;
        const ctx: ObjectContext = { entity: e, rect: g.rect, props: g.props, flux: { ...g.flux, fade: 1 - g.del }, look: looks.get(g.kind.name), theme, lamp, view, grid, dt, ...(g.asset !== undefined ? { asset: g.asset } : {}) };
        const G = g.kind.resolve(ctx);
        const row: Row = { entity: undefined, kind: g.kind.name, record: g.kind.record(G, ctx), band: g.band };
        let at = g.next === undefined ? -1 : rows.findIndex((q) => q.entity === g.next);
        if (at < 0) { at = rows.length; for (let i = 0; i < rows.length; i++) { if ((rows[i] as Row).band > row.band) { at = i; break; } } }
        rows.splice(at, 0, row);
      }
      const objects: SlotObject[] = rows.map((r) => ({ kind: r.kind, record: r.record }));
      stats = { active: list.length, objects: objects.length, culled, ghosts: ghosts.size, live };
      return { objects, stats };
    },
    live: () => stats.live,
    changed() {
      if (disposed) return false;
      const delta = collector.drain();
      let any = woke;
      woke = false;
      if (delta.reset) { wakes.reset += 1; dirtyAll = true; any = true; }
      if (delta.changed.length > 0 || delta.coarse.length > 0) {
        wakes.world += 1;
        any = true;
        for (const e of delta.changed) { const st = states.get(e); if (st !== undefined) st.dirty = true; }
        if (delta.coarse.length > 0) dirtyAll = true;
      }
      if (delta.removed.length > 0) {
        for (const e of delta.removed) {
          const st = states.get(e);
          if (st === undefined) continue;
          ghostOf(e, st);   // the ghost takes the asset with it
          states.delete(e);
          pins.delete(e);
          assets.delete(e);
          wakes.removed += 1;
          any = true;
        }
      }
      if (order.stale()) { wakes.order += 1; any = true; }
      const h = hoverTarget();
      if (h !== lastHover) { lastHover = h; wakes.hover += 1; any = true; }
      return any;
    },
    wakes: () => ({ ...wakes }),
    geometryOf: (e) => states.get(e)?.geometry ?? undefined,
    kindOf: (e) => states.get(e)?.kind,
    fluxOf: (e) => { const st = states.get(e); return st === undefined ? undefined : fluxOf(st); },
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
    stats: () => stats,
    dispose() {
      disposed = true;
      collector.dispose();
      states.clear();
      ghosts.clear();
      pins.clear();
      assets.clear();
    },
  };
}

/** The flux of an object nobody has met: at rest. */
export { FLUX_REST };
