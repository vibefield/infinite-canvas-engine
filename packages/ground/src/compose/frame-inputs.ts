// The FRAME BUILDER — the world's cards as the ground's records (design-013 §8
// B3a, §9). One call per frame the reflector paints: every widget Active in
// the current nav frame, in paint order, becomes a card FRAME (its resolved
// SDF geometry over the theme's plate) and a field SOURCE (its silhouette in
// screen px); a container whose face passes the gate becomes a live PORTAL —
// its inside from ICE's own preview store, at rest, under the flight's exact
// camera — and its frame a hole cut to the face.
//
// FACTS vs FLUX (design-013 §2). The facts are the world's, read and never
// written: `Position`/`Size` (or the `MeasuredSize` rider), the sibling order,
// `Selected`, `Grab` (THE lift signal, design-004 §1's rule kept), the drop
// pair `OverlapCandidate`/`OverlapRejected` with the recognizer's `DragBounds`
// (the heat's one world fact, GLOW.md §3), `Container`, and the preview
// snapshot. The flux is here, per entity, outside the world: the springs
// `card/motion.ts` runs — reveal, lift, the heat's presence and tier — advanced
// by the frame's dt and handed to `resolve()` as plain numbers. A card the
// builder no longer sees (despawned, navigated away, culled) forgets its flux:
// a board at rest carries no per-entity state at all.
//
// PAN IS O(1) in the world (design-001 §7): nothing here is stored per widget
// in the ECS; the screen-space numbers are recomputed per painted frame from
// the camera uniform and thrown away.
//
// The builder is pure with respect to the GPU: it makes records, the host
// (`compose/host.ts`) hands them to `Ground.render`. Its dirt is PULLED
// (`changed()`): a strata change collector journals the entities whose facts
// it reads — entity-exact, never a column-wide stamp, so a system that merely
// DECLARES a Position write (the selection chrome, every frame a selection
// exists) cannot wake a frame; `coarse: false` is core's own attestation
// (`helpers/churn-guard.ts`) that every writer goes through the store. The
// sibling order has its own stamp (`stale()`). Only the out-of-world facts
// arrive as wakes (`observe`): a settings write, a container's preview. So
// the reflector paints exactly when a fact changed — plus while a spring is
// still moving (`live()`).

import {
  Active,
  ChromeSettings,
  Container,
  DragBounds,
  DropTarget,
  Grab,
  MeasuredSize,
  OverlapCandidate,
  OverlapRejected,
  Position,
  PrefabId,
  Selected,
  Size,
  compareStackOrder,
  createSiblingOrderIndex,
  defineQuery,
  type Entity,
  type FramePreviewSnapshot,
  type FramePreviewStore,
  type World,
} from "@ice/core";
import { type Geometry, type Material, MATERIAL, REST, resolve } from "../card/choreography";
import { type PortalFace, portalContent } from "../card/content";
import type { FrameInstance } from "../card/frame-pass";
import { MAX_FRAMES } from "../card/layout";
import { type CardMotion, MOTION_DEFAULTS, type MotionInputs, type MotionTuning, newMotion, stepMotion, toMotion } from "../card/motion";
import { type FrameStyle, PRODUCT, PRODUCT_CORNER } from "../card/sheet";
import { type FieldConfig, type FieldSource, fieldReachPx, MAX_SOURCES } from "../field/layout";
import type { CameraState, Rect } from "../nav/flight";
import { FOLDER_FACE, type LivePortal, PORTAL_CAP, PORTAL_GATE, portalAt } from "../nav/portal";
import type { GroundTheme } from "../theme";
import type { PortalInputs } from "./ground";

export interface FrameBuilderOptions {
  /** The card frame's style; the product's composed corners by default. */
  readonly style?: FrameStyle;
  /** The §5 shadow recipe and the §7 lift numbers; theme.ts's by default. */
  readonly material?: Material;
  /** The springs' tuning; `MOTION_DEFAULTS`. */
  readonly motion?: MotionTuning;
  /**
   * The lift scale. Absent = the world's `ChromeSettings.liftScale`, read live
   * each frame (an app-tunable resource — capturing it once would pin the
   * first value ever seen; the old leg's rule, kept).
   */
  readonly liftScale?: number;
  /** Every card's field strength; 1. */
  readonly sourceStrength?: number;
  /** The card's content corner radius, card units; `PRODUCT_CORNER.radius`. */
  readonly radius?: number;
  /** The face's corner radius when a container authors portal insets; `FOLDER_FACE.radius`. */
  readonly faceRadius?: number;
  /** The portal gate, CSS px on the face's short side; `PORTAL_GATE`. */
  readonly gate?: readonly [number, number];
  /** The most faces carrying a slot per frame, largest first; `PORTAL_CAP`. */
  readonly portalCap?: number;
  /**
   * ICE's preview store (`engine.previews`): a container's inside for its
   * portal. Absent = containers draw as plates and no portal exists.
   */
  readonly previews?: FramePreviewStore;
}

/** The viewport a frame is built for: CSS px and the dpr the canvas is at. */
export interface BuildViewport { readonly width: number; readonly height: number; readonly dpr: number }

export interface FrameBuilderStats {
  /** Widgets Active in the frame this build saw. */
  readonly active: number;
  /** Cards on screen — a frame and a source each. */
  readonly cards: number;
  /** Containers among them. */
  readonly containers: number;
  /** Live portals built (a container past the gate, within the cap). */
  readonly portals: number;
  /** Cards inside those portals, from the preview snapshots. */
  readonly inside: number;
  /** Cards dropped at the record cap this build (`MAX_FRAMES`). */
  readonly capped: number;
  /** Portals whose preview was truncated by its budget (design-013 §7 D-B3.2 owes the child entity). */
  readonly truncated: number;
  /** True after a build while any spring is still moving. */
  readonly live: boolean;
}

export interface BuiltFrame {
  readonly sources: FieldSource[];
  readonly frames: FrameInstance[];
  readonly portals: PortalInputs[];
  readonly stats: FrameBuilderStats;
}

export interface FrameBuilder {
  /**
   * Advance every on-screen card's springs by `dt` SECONDS and build this
   * frame's records under `cam` and `vp`: the theme's plate is every surface;
   * `config` (the ground's field config) dresses each portal's inside.
   */
  build(cam: CameraState, vp: BuildViewport, dt: number, theme: GroundTheme, config: FieldConfig): BuiltFrame;
  /** True while a spring is still moving after the last build — the host paints again. */
  live(): boolean;
  /**
   * PULL the world's dirt: did any fact a build reads change since the last
   * pull — a card's position, size or measured size, its Grab, a drop tag, a
   * recognizer's DragBounds, the Active set, a despawn, a document reset, the
   * sibling order? Call it every frame (it drains the journal); it names what
   * changed in `wakes()`.
   */
  changed(): boolean;
  /**
   * Arm the OUT-OF-WORLD wakes: `wake` fires on a settings write
   * (`ChromeSettings`) and on a container's preview changing. Returns the disarm.
   */
  observe(wake: (reason: WakeReason) => void): () => void;
  /** How many times each fact has dirtied the builder since creation — the churn instrument's other half. */
  wakes(): Readonly<Record<WakeReason, number>>;
  /** The last build's geometry for an entity (the rig's witness; the hit test at B3b). */
  geometryOf(e: Entity): Geometry | undefined;
  /** The last build's motion state for an entity — flux, never a world fact. */
  motionOf(e: Entity): CardMotion | undefined;
  stats(): FrameBuilderStats;
  dispose(): void;
}

/** What can dirty the builder: a journaled world write (`world`), a despawn, a document reset, the sibling order, a settings write, a container's preview. */
export type WakeReason = "world" | "removed" | "reset" | "order" | "chrome" | "preview";
const WAKE_REASONS: readonly WakeReason[] = ["world", "removed", "reset", "order", "chrome", "preview"];

/** A card's silhouette as the field and the heat see it: centre, half extents, corner radius (world units). */
export interface Silhouette { readonly x: number; readonly y: number; readonly hx: number; readonly hy: number; readonly r: number }

const NO_BUTTONS: MotionInputs = { hoverClose: false, hoverLock: false, pressClose: false, pressLock: false };
const EMPTY_STATS: FrameBuilderStats = { active: 0, cards: 0, containers: 0, portals: 0, inside: 0, capped: 0, truncated: 0, live: false };

// Widgets carry PrefabId (the preview store's own membership test); Active = a ChildOf root in the current nav frame.
const widgetsQ = defineQuery([Position, Size, PrefabId, Active]);

/** A widget's drawn size: the `MeasuredSize` rider when it has one (auto-sized dom cards), else `Size` — the preview store's rule. */
export function sizeOf(world: World, e: Entity): { readonly w: number; readonly h: number } | undefined {
  const m = world.get(e, MeasuredSize);
  if (m !== undefined && m.w > 0 && m.h > 0) return m;
  return world.get(e, Size);
}

/**
 * The light SOURCE for a lit card (GLOW.md §3): the recognizer targeting it
 * carries `DragBounds` — the dragged set's post-move union of content rects —
 * and the silhouette AS DRAWN is that union grown by the frame's thickness
 * and scaled by the lift, its corner the revealed outer radius. A multi-drag's
 * union is one source (design-013 Q14's lean). `null` when no recognizer
 * targets the card or the bounds are empty (a stale tag mid-teardown).
 */
export function heatSourceOf(world: World, target: Entity, style: FrameStyle, radius: number, lift: number): Silhouette | null {
  for (const rec of world.getReverse(target, DropTarget)) {
    const b = world.get(rec, DragBounds);
    if (b === undefined) continue;
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    if (!(w > 0) || !(h > 0)) continue;
    const T = style.thickness;
    const Ro = style.outerR ?? radius + T;
    return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, hx: (w / 2 + T) * lift, hy: (h / 2 + T) * lift, r: Ro * lift };
  }
  return null;
}

/**
 * The face a container shows its inside through, from its preview: the
 * snapshot's `portal` is the face in the CONTAINER's own frame (its insets, or
 * the whole body when it authors none — `resolvePortal`'s rule), so the world
 * face is that rect at the container's position. The radius is the face's own
 * when authored, the card's when the face IS the body (`faceRadius`'s rule).
 */
export function faceOfSnapshot(pos: { readonly x: number; readonly y: number }, size: { readonly w: number; readonly h: number }, s: Pick<FramePreviewSnapshot, "portal">, cardRadius: number, faceRadius: number): { readonly K: Rect; readonly r: number } {
  const p = s.portal;
  const whole = p.x === 0 && p.y === 0 && p.width === size.w && p.height === size.h;
  return { K: { x: pos.x + p.x, y: pos.y + p.y, width: p.width, height: p.height }, r: whole ? cardRadius : faceRadius };
}

/** A geometry's silhouette as a field source under `cam` — screen CSS px (field/layout.ts `FieldSource`). */
export function fieldSourceOf(G: Geometry, cam: CameraState, strength: number): FieldSource {
  const z = cam.zoom;
  return { cx: (G.centre[0] - cam.x) * z, cy: (G.centre[1] - cam.y) * z, hx: G.half[0] * z, hy: G.half[1] * z, r: G.outerR * z, strength };
}

/** The hole's face in the card's own frame (content.ts `PortalFace`). */
export const portalFaceOf = (K: Rect, r: number): PortalFace => ({ cx: K.x + K.width / 2, cy: K.y + K.height / 2, hx: K.width / 2, hy: K.height / 2, r });

/**
 * Is a card's rect, grown by `margin` (world units), off the viewport under
 * `cam`? The margin covers the shadow, the lift and the field's reach, so a
 * card just off the edge still bends the needles and casts its shadow in.
 */
export function offscreen(centre: readonly [number, number], contentHalf: readonly [number, number], margin: number, cam: CameraState, vp: { readonly width: number; readonly height: number }): boolean {
  const z = cam.zoom;
  const hx = (contentHalf[0] + margin) * z;
  const hy = (contentHalf[1] + margin) * z;
  const cx = (centre[0] - cam.x) * z;
  const cy = (centre[1] - cam.y) * z;
  return cx + hx < 0 || cy + hy < 0 || cx - hx > vp.width || cy - hy > vp.height;
}

interface CardState {
  readonly motion: CardMotion;
  geometry: Geometry | null;
  /** The preview subscription, while the card is a container the builder watches. */
  unsub?: (() => void) | undefined;
}

interface Row {
  readonly e: Entity;
  readonly G: Geometry;
  readonly portal?: { readonly K: Rect; readonly r: number; readonly live: LivePortal; readonly snap: FramePreviewSnapshot } | undefined;
}

export function createFrameBuilder(world: World, opts: FrameBuilderOptions = {}): FrameBuilder {
  const style = opts.style ?? PRODUCT;
  const material = opts.material ?? MATERIAL;
  const tuning = opts.motion ?? MOTION_DEFAULTS;
  const strength = opts.sourceStrength ?? 1;
  const radius = opts.radius ?? PRODUCT_CORNER.radius;
  const faceR = opts.faceRadius ?? FOLDER_FACE.radius;
  const gate = opts.gate ?? PORTAL_GATE;
  const cap = opts.portalCap ?? PORTAL_CAP;
  const previews = opts.previews;
  const order = createSiblingOrderIndex(world);
  const states = new Map<Entity, CardState>();
  let wake: ((reason: WakeReason) => void) | null = null;
  const wakes = Object.fromEntries(WAKE_REASONS.map((r) => [r, 0])) as Record<WakeReason, number>;
  const woke = (reason: WakeReason): void => { wakes[reason] += 1; wake?.(reason); };
  // The journal of every fact a build reads — value writes, adds, removals and despawns of the
  // components, membership flips of the tags. `coarse: false`: no writer of these pokes raw columns.
  const collector = world.changes.collect({
    components: [Position, Size, MeasuredSize, Grab, DragBounds],
    tags: [Selected, OverlapCandidate, OverlapRejected, Active, Container],
    coarse: false,
  });
  let stats: FrameBuilderStats = EMPTY_STATS;
  let disposed = false;

  const liftScale = (): number => opts.liftScale ?? world.getResource(ChromeSettings)?.liftScale ?? 1;

  /** The cull margin, world units: the lifted shadow's reach or the field's, whichever is wider. */
  const marginOf = (config: FieldConfig, zoom: number): number => {
    const shadow = material.shadow.lifted.sigma * 3 + material.shadow.lifted.offset + style.thickness;
    const reach = fieldReachPx(config.reach) / zoom;
    return Math.max(shadow, reach);
  };

  const forget = (e: Entity, st: CardState): void => {
    st.unsub?.();
    states.delete(e);
  };

  /** A portal's inside at REST from its snapshot: the children's frames and sources under the slot's camera. */
  const insideOf = (snap: FramePreviewSnapshot, cam: CameraState, theme: GroundTheme): { frames: FrameInstance[]; sources: FieldSource[] } => {
    const frames: FrameInstance[] = [];
    const sources: FieldSource[] = [];
    for (const c of snap.children) {
      if (frames.length >= MAX_FRAMES) break;
      const r = c.rect;
      if (!(r.width > 0) || !(r.height > 0)) continue;
      const G = resolve(style, { centre: [r.x + r.width / 2, r.y + r.height / 2], contentHalf: [r.width / 2, r.height / 2], radius }, REST, material);
      frames.push({ geometry: G, surface: theme.card });
      sources.push(fieldSourceOf(G, cam, strength));
    }
    return { frames, sources };
  };

  return {
    build(cam, vp, dt, theme, config) {
      if (disposed) return { sources: [], frames: [], portals: [], stats: EMPTY_STATS };
      const lift = liftScale();
      const margin = marginOf(config, cam.zoom);
      const ordinals = order.ordinals();
      const list: Entity[] = [];
      world.query(widgetsQ).each((batch) => { for (const row of batch) list.push(batch.entity(row)); });
      list.sort((a, b) => compareStackOrder(world, ordinals, a, b));

      // Pass 1 — every on-screen card's flux and geometry, and the portal candidates.
      const seen = new Set<Entity>();
      const rows: Row[] = [];
      const cands: { row: Row; area: number }[] = [];
      let live = false;
      let containers = 0;
      let truncated = 0;
      for (const e of list) {
        const pos = world.get(e, Position);
        const size = sizeOf(world, e);
        if (pos === undefined || size === undefined || !(size.w > 0) || !(size.h > 0)) continue;
        const centre: readonly [number, number] = [pos.x + size.w / 2, pos.y + size.h / 2];
        const contentHalf: readonly [number, number] = [size.w / 2, size.h / 2];
        if (offscreen(centre, contentHalf, margin, cam, vp)) continue;
        seen.add(e);
        let st = states.get(e);
        // locked (the closed padlock) as the lab's and the oracle's cards rest — REST's `lockOpen: 0`; ICE has no lock fact yet
        if (st === undefined) { st = { motion: newMotion(world.hasTag(e, Selected), true), geometry: null }; states.set(e, st); }
        const m = st.motion;
        m.selected = world.hasTag(e, Selected);
        m.held = world.has(e, Grab);
        const accept = world.hasTag(e, OverlapCandidate);
        const reject = world.hasTag(e, OverlapRejected);
        m.hotTarget = accept || reject;
        if (m.hotTarget) {
          m.hotTier = accept ? 1 : 0;
          const src = heatSourceOf(world, e, style, radius, lift);
          if (src !== null) { m.hotAt = [src.x, src.y]; m.hotHalf = [src.hx, src.hy]; m.hotR = src.r; }
        }
        if (stepMotion(m, dt, NO_BUTTONS, tuning)) live = true;
        const G = resolve(style, { centre, contentHalf, radius }, toMotion(m, lift), material);
        st.geometry = G;
        let portal: Row["portal"];
        if (world.hasTag(e, Container)) {
          containers += 1;
          if (previews !== undefined) {
            if (st.unsub === undefined) st.unsub = previews.subscribe(e, () => woke("preview"));
            const snap = previews.snapshot(e);
            const face = faceOfSnapshot(pos, size, snap, radius, faceR);
            const lp = portalAt(face.K, face.r, snap.resolvedView, cam, vp, gate);
            if (lp !== null) portal = { K: face.K, r: face.r, live: lp, snap };
          }
        } else if (st.unsub !== undefined) { st.unsub(); st.unsub = undefined; }
        const row: Row = { e, G, portal };
        rows.push(row);
        if (portal !== undefined) cands.push({ row, area: portal.live.clip.hx * portal.live.clip.hy });
      }
      // A card the builder no longer sees forgets its flux.
      for (const [e, st] of states) if (!seen.has(e)) forget(e, st);

      // The cap: the largest faces carry a slot (PORTAL.md Q-f); the rest draw as plates.
      cands.sort((a, b) => b.area - a.area);
      const holes = new Set<Row>(cands.slice(0, cap).map((c) => c.row));

      // Pass 2 — the records in paint order; a hole's slot names the container's index.
      const frames: FrameInstance[] = [];
      const sources: FieldSource[] = [];
      const portals: PortalInputs[] = [];
      let capped = 0;
      let inside = 0;
      const limit = Math.min(MAX_FRAMES, MAX_SOURCES);
      for (const row of rows) {
        if (frames.length >= limit) { capped += 1; continue; }
        const p = row.portal;
        if (p !== undefined && holes.has(row)) {
          const at = frames.length;
          const lp = p.live;
          const in_ = insideOf(p.snap, lp.cam, theme);
          inside += in_.frames.length;
          if (p.snap.truncated) truncated += 1;
          portals.push({
            view: { camX: lp.cam.x, camY: lp.cam.y, zoom: lp.cam.zoom, width: vp.width, height: vp.height, dpr: vp.dpr, box: lp.box },
            pointer: { x: 0, y: 0, on: false },
            // dressed for its arrival: the inside as it will look when entered, scaled (PORTAL.md §9)
            lodZoom: lp.arrival.zoom,
            present: { opacity: lp.presence, portal: lp.clip },
            config,
            sources: in_.sources,
            frames: in_.frames,
            at,
            plate: theme.card,
          });
          frames.push({ geometry: row.G, surface: theme.card, content: portalContent(portalFaceOf(p.K, p.r)) });
        } else {
          frames.push({ geometry: row.G, surface: theme.card });
        }
        sources.push(fieldSourceOf(row.G, cam, strength));
      }
      if (capped > 0) console.warn(`[ice] ground/compose: ${capped} card${capped === 1 ? "" : "s"} past the ${limit}-record cap were not drawn`);
      stats = { active: list.length, cards: frames.length, containers, portals: portals.length, inside, capped, truncated, live };
      return { sources, frames, portals, stats };
    },
    live: () => stats.live,
    changed() {
      if (disposed) return false;
      const delta = collector.drain();
      let any = false;
      if (delta.reset) { wakes.reset += 1; any = true; }
      if (delta.changed.length > 0 || delta.coarse.length > 0) { wakes.world += 1; any = true; }
      if (delta.removed.length > 0) { wakes.removed += 1; any = true; }
      if (order.stale()) { wakes.order += 1; any = true; }
      return any;
    },
    observe(cb) {
      wake = cb;
      const subs: Array<() => void> = [world.reactive.observeResource(ChromeSettings, () => woke("chrome"))];
      return () => { for (const u of subs) u(); subs.length = 0; if (wake === cb) wake = null; };
    },
    wakes: () => ({ ...wakes }),
    geometryOf: (e) => states.get(e)?.geometry ?? undefined,
    motionOf: (e) => states.get(e)?.motion,
    stats: () => stats,
    dispose() {
      disposed = true;
      collector.dispose();
      for (const [e, st] of states) forget(e, st);
      wake = null;
    },
  };
}
