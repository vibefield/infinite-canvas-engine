// The desk's REFLECTOR — `desk/compose` (design-015 §4.4, §2.4; D2a-world): post-notify,
// output-only, `always: true` with a private dirty union, and an early-out when clean that
// touches neither the swap chain nor the queue: a quiet desk submits NOTHING (idle-zero by
// construction; `instrumentSubmits` is the witness). What dirties a frame: the builder's pulled
// dirt (a journaled world write, a despawn, a reset, the sibling order, the hover — `changed()`,
// drained every tick whether or not a frame follows), the camera, the viewport or the nav flight
// (polled by `resourceStamp` — no observers, the 09-07 lesson), a theme or a look, a pin, a live
// spring or ghost (`live()`), and the AMBIENT (compose/ambient.ts) while it wants a frame — the
// wind's clock is a frame, and the policy is what lets it stop. A pointer move, a gesture or a
// flight is a TOUCH that keeps the ambient awake.
//
// The reflector reads the world's Camera, Viewport, FrameInfo and the local mouse pointer's screen
// point; it writes nothing to the ECS and reads no layout — the viewport is the resource the facade's
// ResizeObserver writes; the frame's dt is `FrameInfo`'s (clamped by the engine), never a clock of
// its own. It is DOM-free: the host (host/layer.ts) owns the canvas and sizes it on request
// (`attach.resize`), hands the Ground in when `Ground.create` resolves (`ground()`), and registers
// this reflector where the ground layer has always gone (right after the plane transform).

import {
  Camera,
  defineQuery,
  FrameInfo,
  GhostRetiring,
  InsertGhost,
  LocalPointer,
  NavRedress,
  NavTransition,
  Pointer,
  PointerScreen,
  PointerVersion,
  type Entity,
  Position,
  PrefabId,
  type ReflectorDef,
  Size,
  specimensOf,
  Tray,
  TrayContent,
  TransformTween,
  trayTakeProps,
  Viewport,
  widgetSpawnInits,
  widgetTypeFor,
  type WidgetType,
  type World,
} from "@ice/core";
import type { KindFaults } from "../faults";
import type { Ground, GroundFrameInputs, GroundStats } from "../ground";
import { type KindLocal, type ObjectKind, rectOf } from "../kinds/world";
import { lampOf } from "../mat/lamp";
import { LAYER_IDLE_MS } from "../kit/layer";
import { DEFAULT_GRID, type GridConfig } from "../mat/grid";
import type { GroundTheme, Palette } from "../theme";
import { objectKindOf } from "../object";
import { drawerRect, type TrayOptions } from "../tray/drawer";
import { createTrayFlux, type TrayFlux } from "../tray/flux";
import { type CarryGhost, type CarrySpecimen, createTrayCarry, type TrayCarry } from "../tray/carry";
import { carriedFrame, carrySlot, specimenFrames, type TrayCarriedFrame, type TraySpecimen, type TraySpecimenFrame } from "../tray/specimens";
import type { Ambient, AmbientState } from "./ambient";
import type { DeskBuilder, DeskBuilderStats, DeskWakeReason, HoldPin } from "./builder";

export interface DeskReflectorOptions {
  readonly world: World;
  readonly builder: DeskBuilder;
  /** The kinds whose `theme()` makes a look — every object kind the ground registers. */
  readonly kinds: readonly ObjectKind[];
  readonly ambient: Ambient;
  /** The ground once `Ground.create` resolved, null before and after the layer ends. */
  readonly ground: () => Ground | null;
  /** The host sizes its canvas to `width × height` DEVICE px (the swap chain follows). */
  readonly attach: { resize(width: number, height: number): void };
  readonly theme: GroundTheme;
  /** The host's palette — what each kind's `theme()` reads its look from. */
  readonly palette: Palette;
  /** The root's grid: the lattice's fade-in and the mat's config (its gobo, its rulers). */
  readonly grid?: GridConfig;
  /** The device pixel ratio the canvas is capped at (2). */
  readonly maxDpr?: number;
  readonly name?: string;
  /** Called after every frame drawn — the layer publishes the selection menu's anchor from it (D4a). */
  readonly onFrame?: () => void;
  /** The kinds' own state on this desk (`KindLocal`, by kind name): what the tray's carried objects are drawn with, as the builder's are (K5b). */
  readonly locals?: ReadonlyMap<string, KindLocal>;
  /** The drawer as the host set it (petition I21 — `deskLayer({ tray })`): its foot inset. */
  readonly tray?: TrayOptions;
  /**
   * THE KIND BOUNDARY (petition I24, faults.ts): the tray's specimens and carried copies are recorded through it (a missing kind's are the
   * missing face; a throw is a strike), and a missing kind is never asked for its look again.
   */
  readonly faults?: KindFaults;
  /**
   * Called when a frame is asked for from OUTSIDE the flush — a wake (a pin, an ink landing, the ambient's policy), the ground
   * arriving, a theme, a grid, a harness's pin (K7a): the host wakes a sleeping loop with it.
   */
  readonly onWake?: (reason: string) => void;
}

/** What woke a frame, counted since the mount — the builder's reasons and the reflector's own. */
export type DeskWakes = Readonly<Record<DeskWakeReason | "camera" | "viewport" | "nav" | "theme" | "grid" | "pin" | "ambient" | "live" | "ink" | "tray", number>>;

export interface DeskReflectorStats extends DeskBuilderStats {
  /** Whole-frame renders so far — the churn instrument (0 on an idle desk). */
  readonly redraws: number;
  /** The ground's stats for the last frame drawn (null before the first). */
  readonly frame: GroundStats | null;
  readonly ambient: AmbientState;
}

export interface DeskReflector {
  /** The drawing reflector (`always: true`): register it where the ground layer goes. */
  readonly reflector: ReflectorDef & { available(): boolean };
  /** The ground is here (or gone): the next tick paints. */
  ready(): void;
  /** The host's projection changed (a theme switch): the looks are remade, the next frame re-renders. */
  setTheme(theme: GroundTheme, palette?: Palette): void;
  /** The root's grid (the mat's config, the fade-in) as a whole. */
  configureGrid(grid: GridConfig): void;
  /** Wake a frame for a reason the world does not carry (a pin, an asset, the writing's flux — D2c's `ink`). */
  wake(reason: "pin" | "ambient" | "ink"): void;
  /**
   * A harness's pins on the build (D2b): live insides on or off (the oracle's `portals: false`), a pinned root
   * dressing (`lodZoom`), every spring and ghost held where it is (`freeze` — a still of a moving frame), the
   * re-dressing ramp held at its start (`holdRedress`). Each present key is set; the next frame paints.
   */
  pinBuild(pins: { readonly portals?: boolean; readonly lodZoom?: number | null; readonly freeze?: boolean; readonly holdRedress?: boolean; readonly hold?: HoldPin | null }): void;
  /** The kinds whose own state moved this tick (their `local.tick` wanted a frame): the builder remakes their records this build (D6). */
  restless(kinds: ReadonlySet<string>): void;
  /** The frame dirty and not yet drawn (a rig's witness). */
  dirty(): boolean;
  /**
   * WHEN THE REFLECTOR IS NEXT DUE (K7a — its registered wake): `now` while a frame is owed (dirt, a live spring or ghost, the
   * drawer on its way) or the ambient still moves (the wind's clock is a frame); `Infinity` otherwise — and while it cannot
   * draw (no ground yet, no viewport): the ground's arrival and the viewport's write wake it.
   */
  due(now: number): number;
  redraws(): number;
  stats(): DeskReflectorStats;
  wakes(): DeskWakes;
  /** The inputs of the last render, as handed to `Ground.render`. */
  lastInputs(): GroundFrameInputs | null;
  grid(): GridConfig;
  theme(): GroundTheme;
  /** A kind's look for the theme in force (its `theme()` of the palette) — the held bar's swatches read it (D3t-a). */
  look(kind: string): unknown;
  /** The pegboard drawer's flux (design-017 §3): its motion, the drawer as drawn (the pose seam's answer), the pins for a still. */
  readonly tray: TrayFlux;
  /** The tray's specimens as the last frame drew them (K5a) — a rig's witness; empty while the drawer is shut or bare. */
  traySpecimens(): readonly TraySpecimenFrame[];
  /**
   * Would the tray DRAW a specimen of `type` (petition I38)? Its widget an object whose kind passes the kind set (I25 — under the
   * boundary, one this desk was mounted with): the rule the tray draws by, answered to core's lay through the pose seam (`draws`), so
   * the lay hangs, counts and offers only what is drawn.
   */
  drawsType(type: string): boolean;
  /**
   * Did the last frame's TRAY draw `e` — a specimen, a lifted copy's key, an insert ghost it presented (K5b over K6b)? The frame raster
   * queue's word on what shows is the builder's and this: an ask a specimen's writing made (its word, `tray.local`) is run, not let go.
   */
  trayShows(e: Entity): boolean;
  /** The take's motion (K5b — tray/carry.ts): the lifted copy, the ghost's grow and its flight home. */
  readonly carry: TrayCarry;
  /** What the tray carried in the last frame drawn (K5b) — a rig's witness: each pose's slot, phase, ghost and rect on screen. */
  trayCarried(): readonly TrayCarriedFrame[];
  dispose(): void;
}

const localPointersQ = defineQuery([Pointer, LocalPointer, PointerScreen]);
const trayQ = defineQuery([Tray]);
const insertQ = defineQuery([InsertGhost, Position, Size]);

export function createDeskReflector(opts: DeskReflectorOptions): DeskReflector {
  const { world, builder, ambient, faults } = opts;
  const maxDpr = opts.maxDpr ?? 2;
  let theme = opts.theme;
  let palette = opts.palette;
  let grid = opts.grid ?? DEFAULT_GRID;
  /** The kinds a look is made for: every one but a MISSING kind (petition I24 — nothing of it is called again). */
  const lookKinds = (): readonly ObjectKind[] => (faults === undefined || faults.size === 0 ? opts.kinds : opts.kinds.filter((k) => !faults.missing(k.name)));
  /**
   * THE KIND SET (petition I25): what the tray draws by — under the boundary, a kind this desk was MOUNTED with (`kinds`, what the ground
   * compiled), never one a type registered after the mount names: its specimen and its carried copy are not drawn, as a kindless type's
   * are not (the builder says it once, at its first object). Absent the boundary, any kind (as before).
   */
  const mountedKinds = new Set(opts.kinds.map((k) => k.name));
  const kindOn = (kind: ObjectKind | undefined): ObjectKind | undefined => (kind === undefined || faults === undefined || mountedKinds.has(kind.name) ? kind : undefined);
  let looks = looksOf(lookKinds(), palette, theme);
  let dirty = true;
  let disposed = false;
  let redraws = 0;
  let lastInputs: GroundFrameInputs | null = null;
  let lastFrame: GroundStats | null = null;
  let builtTick = -1;
  /** The ambient wanted the last frame (the wind blows or eases): the next is owed too (K7a). */
  let ambientLive = false;
  /** The last flush could not draw (no ground, no viewport): nothing is owed until they come (K7a). */
  let blocked = true;
  let camStamp = -1;
  let vpStamp = -1;
  let navStamp = -1;
  let redressStamp = -1;
  let pointerStamp = -1;
  let mouse: ReturnType<World["firstOf"]>;
  /** The harness's pins on the build (D2b). */
  let portalsOn = true;
  let lodPin: number | undefined;
  let freeze = false;
  let holdRedress = false;
  /** The hand pinned for a still (D4b). */
  let holdPin: HoldPin | undefined;
  /** The kinds restless this tick (D6) — set by the host before the flush, spent by the build. */
  let restless: ReadonlySet<string> | undefined;
  /** What the desk copy behind the hand depends on beyond the builder's count and the camera's and viewport's stamps (D4b). */
  let themeGen = 0;
  let gridGen = 0;
  let pinGen = 0;
  const wakes: Record<keyof DeskWakes, number> = { world: 0, removed: 0, reset: 0, order: 0, hover: 0, marks: 0, camera: 0, viewport: 0, nav: 0, theme: 0, grid: 0, pin: 0, ambient: 0, live: 0, ink: 0, tray: 0 };
  /** The pegboard drawer's motion (design-017 §3): the facts are core's `Tray`, polled each tick; the slide and the band are here. */
  const tray = createTrayFlux(opts.tray?.foot !== undefined ? { foot: opts.tray.foot } : {});
  // the tray's specimens (K5a): read from the world each frame the drawer shows (a handful of facts — a lay, a reset or a prop moves them)
  let drawnSpecimens: readonly TraySpecimenFrame[] = [];
  /** The take's motion (K5b): the copy, the ghost's grow, its flight home — and what it drew last. */
  const carry = createTrayCarry();
  let drawnCarried: readonly TrayCarriedFrame[] = [];
  /** The keys the tray drew in the last frame (specimens, carried copies and ghosts) — the raster queue's `shows` beside the builder's. */
  let trayDrawn: ReadonlySet<number> = new Set();
  /** The keys drawn with a kind's desk state from the tray (K5b — a specimen's entity, a copy's key): let go of as each goes. */
  const faced = new Map<number, KindLocal>();
  /** When the drawer last showed (frame clock, ms): its specimens' desk state is let go once it has been shut `LAYER_IDLE_MS`. */
  let trayShownAt = Number.NEGATIVE_INFINITY;
  /** When the specimens' desk state is let go (K7a — a registered time: the loop may sleep since the drawer shut); ∞ — none held. */
  let facedAt = Number.POSITIVE_INFINITY;
  let builderWakes = builder.wakes();

  /** The local mouse pointer's screen point as NDC (x right, y up), or null before one was seen. */
  const pointerNdc = (vp: { readonly w: number; readonly h: number }): readonly [number, number] | null => {
    if (mouse === undefined || !world.isAlive(mouse)) {
      mouse = undefined;
      world.query(localPointersQ).each((b) => { for (const r of b) { const p = b.entity(r); if (world.read(p, Pointer).device === "mouse") mouse = p; } });
    }
    if (mouse === undefined || vp.w <= 0 || vp.h <= 0) return null;
    const s = world.get(mouse, PointerScreen);
    if (s === undefined) return null;
    return [(s.x / vp.w) * 2 - 1, -((s.y / vp.h) * 2 - 1)];
  };

  const reflector: ReflectorDef & { available(): boolean } = {
    name: opts.name ?? "desk/compose",
    always: true,
    available: () => opts.ground() !== null,
    flush(w) {
      if (disposed) return;
      const info = w.getResource(FrameInfo);
      const tick = info?.tick ?? -1;
      if (tick >= 0 && builtTick === tick) return;   // once per tick
      builtTick = tick;
      const now = info?.now ?? 0;
      // THE PULLS, every tick, above the pre-ready return: the journal drains once per frame, whether a frame follows or not.
      if (builder.changed()) {
        dirty = true;
        const bw = builder.wakes();
        for (const k of ["world", "removed", "reset", "order", "hover", "marks"] as const) wakes[k] += bw[k] - builderWakes[k];
        builderWakes = bw;
      }
      const cs = w.resourceStamp(Camera);
      if (cs !== camStamp) { if (camStamp !== -1) { dirty = true; wakes.camera += 1; ambient.touch(now); } camStamp = cs; }
      const vs = w.resourceStamp(Viewport);
      if (vs !== vpStamp) { if (vpStamp !== -1) { dirty = true; wakes.viewport += 1; } vpStamp = vs; }
      const ns = w.resourceStamp(NavTransition);
      if (ns !== navStamp) { if (navStamp !== -1) { dirty = true; wakes.nav += 1; ambient.touch(now); } navStamp = ns; }
      // a zoom-through cut: the desk re-dresses over its ramp (the builder keeps the frame live while it runs)
      const rs = w.resourceStamp(NavRedress);
      if (rs !== redressStamp) { if (redressStamp !== -1) { dirty = true; wakes.nav += 1; ambient.touch(now); } redressStamp = rs; }
      // the pointer moved (a wheel, a down, a move): the ambient stays awake; the hover itself is the builder's dirt — but not
      // while something is in hand (D4b): the desk behind stands still, so its blurred copy is made once and reused
      const inHand = builder.hand() !== undefined;
      const ps = w.resourceStamp(PointerVersion);
      if (ps !== pointerStamp) { if (pointerStamp !== -1 && !inHand) ambient.touch(now); pointerStamp = ps; }
      if (w.getResource(Camera)?.gesturing === true) ambient.touch(now);
      // THE TRAY (design-017 §3): its facts polled as the camera's stamp is — a change is a frame (one entity, a handful of fields)
      const te = w.firstOf(trayQ);
      const tf = te === undefined ? undefined : w.get(te, Tray);
      const tc = te === undefined ? undefined : w.get(te, TrayContent);
      if (tray.read(tf === undefined ? undefined : { ...tf, hover: tf.hover ?? "", bottom: tc?.bottom ?? 0, laid: tc?.laid ?? 0 })) { dirty = true; wakes.tray += 1; }
      // the specimens drawn with their kinds' desk state let go of it once the drawer has been shut a while, as the tray's layers do (K5b;
      // D-K6a.3 — a pad's print keeps the desk's tiles while it has a pad): no frame is asked for; the next open makes it again
      const pinned = tray.pinned();
      const showing = pinned !== null ? pinned.hidden !== true && (pinned.p ?? 1) > 0 : tf?.open === true || (tray.frame()?.p ?? 0) > 0;
      if (showing) trayShownAt = now;
      else if (faced.size > 0 && now - trayShownAt > LAYER_IDLE_MS) {
        for (const [key, local] of faced) if (key > 0) { local.forget?.(key as Entity); faced.delete(key); }
      }
      // …at a registered TIME (K7a): with the drawer shut the loop sleeps and no tick comes to poll it — the desk is due when it lets go
      facedAt = Number.POSITIVE_INFINITY;
      if (!showing) for (const key of faced.keys()) if (key > 0) { facedAt = trayShownAt + LAYER_IDLE_MS + 1; break; }
      const ground = opts.ground();
      blocked = true;
      if (ground === null) return;   // pre-ready: the dirt is kept
      const cam = w.getResource(Camera);
      const vp = w.getResource(Viewport);
      if (cam === undefined || vp === undefined || vp.w <= 0 || vp.h <= 0) return;   // no viewport yet: stay dirty, paint when it exists
      blocked = false;
      // the ambient's clocks: stepped every tick the ground is here — a frame is wanted while the wind blows or the tilt moves
      const dtMs = info?.dt ?? 16;
      // in hand the desk behind the hand STANDS STILL (§8): the clocks are not stepped — the wind holds its breath, the tilt lets
      // go of nothing — so under the default `idle` ambient too the blurred copy is made once and no frame is the wind's (D7)
      const amb = inHand ? { frame: ambient.frame(), live: false } : ambient.step(dtMs / 1000, now, pointerNdc(vp));
      ambientLive = amb.live;
      if (amb.live) { dirty = true; wakes.ambient += 1; }
      if (!dirty) return;   // IDLE-ZERO: no getCurrentTexture, no submit
      dirty = false;
      const dpr = Math.min(vp.dpr > 0 ? vp.dpr : 1, maxDpr);
      opts.attach.resize(Math.max(1, Math.round(vp.w * dpr)), Math.max(1, Math.round(vp.h * dpr)));
      const camera = { x: cam.x, y: cam.y, zoom: cam.zoom };
      // the drawer over it all, as its flux has it this frame (design-017 §3)
      let trayed = tray.step(now, vp.w, vp.h);
      // …and the specimens on it (K5a), while it shows (a still's `bare` pin leaves the board alone): each kind's composite pass made
      // the first time the tray shows one (a frame is asked for when it is), the frames recorded by their own kinds
      drawnSpecimens = [];
      if (trayed !== undefined && trayed.p > 0 && tray.pinned()?.bare !== true) {
        const specimens = readSpecimens(w, te, opts.locals, kindOn);
        if (specimens.length > 0) {
          ground.warmTray(specimens.map((q) => [q.type, q.kind.name] as const), trayLanded);
          for (const q of specimens) if (q.local !== undefined) faced.set(q.key, q.local as KindLocal);
          drawnSpecimens = specimenFrames(specimens, { rect: drawerRect(vp.w, vp.h, trayed.p), scroll: trayed.scroll, ...(trayed.foot !== undefined ? { foot: trayed.foot } : {}) }, { view: { width: vp.w, height: vp.h, dpr }, theme, grid, looks, lift: (t) => tray.lift(t), ...(faults !== undefined ? { faults } : {}) });
          trayed = { ...trayed, specimens: drawnSpecimens };
        }
      }
      // THE TAKE (K5b): its motion stepped on the facts — the take, the specimens as drawn, the insert ghosts — before the desk is built,
      // so a ghost the carry draws this frame (its grow, its flight home) is none of the desk's rows
      const poses = carry.step(
        now,
        tf === undefined ? undefined : { take: tf.take ?? "", u: tf.takeU, v: tf.takeV, x: tf.takeX, y: tf.takeY, handed: tf.handed },
        drawnSpecimens.map((f): CarrySpecimen => ({ type: f.type, zoom: f.view.zoom, ...f.object })),
        readGhosts(w),
        camera,
        trayed?.p ?? 0,
      );
      const built = builder.build(camera, { width: vp.w, height: vp.h, dpr }, dtMs / 1000, theme, grid, looks, {
        now, mat: amb.frame, portals: portalsOn, freeze, holdRedress, ...(lodPin !== undefined ? { lodZoom: lodPin } : {}), ...(holdPin !== undefined ? { hold: holdPin } : {}),
        // the host's word as told — an EMPTY set included: none restless is a word, and no word has the builder ask every object (K7a)
        ...(restless !== undefined ? { restless } : {}),
        ...(carry.presented().size > 0 ? { presented: carry.presented() as ReadonlySet<Entity> } : {}),
      });
      restless = undefined;
      // the hand (D4b): the desk copy's stamp is everything the copy depends on — the builder's desk count (never the held
      // object's own facts), the camera, the viewport, the theme, the grid, the pins, the mat's clocks and tilt this frame
      const held = built.held === undefined ? undefined : {
        ...built.held.inputs,
        stamp: `${built.held.deskSeq}|${camStamp}|${vpStamp}|${themeGen}|${gridGen}|${pinGen}|${amb.frame === undefined ? "still" : `${amb.frame.time},${amb.frame.goboTime},${amb.frame.noise[0]},${amb.frame.noise[1]},${amb.frame.goboMatrix.join(",")}`}`,
      };
      // what the tray carries (K5b), recorded by the kinds under their poses — the lifted copy with what one taken is made with, a ghost
      // with its own props and rect; each lit by the desk's lamp where it is (a copy: where the ghost it becomes will be)
      drawnCarried = [];
      if (trayed !== undefined && poses.length > 0) {
        const L = lampOf(built.grid.mat.plane);
        const env = { view: { width: vp.w, height: vp.h, dpr }, theme, grid, looks, ...(faults !== undefined ? { faults } : {}) };
        const made: TrayCarriedFrame[] = [];
        for (const pose of poses) {
          const widget = widgetTypeFor(w, pose.type);
          const kind = kindOn(objectKindOf(widget));
          if (widget === undefined || kind === undefined) continue;
          const local = opts.locals?.get(kind.name);
          if (pose.ghost !== undefined) {
            const g = pose.ghost as Entity;
            const at = w.get(g, Position);
            const size = w.get(g, Size);
            if (at === undefined || size === undefined) continue;
            const r = rectOf(at, size);
            const frame = carriedFrame(pose, { kind, rect: { x: r.cx - r.w / 2, y: r.cy - r.h / 2, w: r.w, h: r.h }, props: propsOf(w, g, widget), key: g as number, lamp: L, ...(local !== undefined ? { local } : {}) }, env);
            if (frame !== undefined) made.push(frame);
            continue;
          }
          const n = widget.defaultSize;
          const copyLocal = widget.tray?.local === true ? local : undefined;
          const cx = cam.x + pose.px / cam.zoom - (pose.u - 0.5) * n.w;
          const cy = cam.y + pose.py / cam.zoom - (pose.v - 0.5) * n.h;
          const key = -(0x40000000 + pose.id);
          if (copyLocal !== undefined) faced.set(key, copyLocal as KindLocal);
          const frame = carriedFrame(pose, { kind, rect: { x: -n.w / 2, y: -n.h / 2, w: n.w, h: n.h }, props: takenProps(widget), key, lamp: { x: L.x - cx, y: L.y - cy, h: L.h }, ...(copyLocal !== undefined ? { local: copyLocal } : {}) }, env);
          if (frame !== undefined) made.push(frame);
        }
        // a composite kind's pass is made async: made ahead, from the lift, so the hand-off never waits a frame for it
        ground.warmTray(carry.types().flatMap((t) => { const k = kindOn(objectKindOf(widgetTypeFor(w, t))); return k === undefined ? [] : [[carrySlot(t), k.name] as const]; }), trayLanded);
        drawnCarried = made;
        if (made.length > 0) trayed = { ...trayed, carried: made };
      }
      trayDrawn = new Set([...drawnSpecimens.map((f) => f.key), ...drawnCarried.map((f) => f.key)]);
      // what was drawn with a kind's desk state and is gone — a specimen re-laid away, a copy put back or handed — its records let go
      for (const [key, local] of faced) {
        const gone = key < 0 ? !poses.some((q) => q.ghost === undefined && -(0x40000000 + q.id) === key) : !w.isAlive(key as Entity);
        if (gone) { local.forget?.(key as Entity); faced.delete(key); }
      }
      // the frame: the current desk (the root's grid, or the entered mini mat's), its live insides, and while a flight is on the
      // departed desk beside it — exactly the inputs the prototype's lab hands `ground.render()` (D2b)
      const inputs: GroundFrameInputs = {
        view: { camX: cam.x, camY: cam.y, zoom: cam.zoom, width: vp.w, height: vp.h, dpr },
        mat: amb.frame,
        grid: built.grid,
        objects: built.objects,
        ...(built.portals.length ? { portals: built.portals } : {}),
        ...(built.lodZoom !== undefined ? { lodZoom: built.lodZoom } : {}),
        ...(built.present !== undefined ? { present: built.present } : {}),
        ...(built.light !== undefined ? { light: built.light } : {}),
        ...(built.outgoing !== undefined ? { outgoing: built.outgoing } : {}),
        theme,
        marks: built.marks,
        ...(held !== undefined ? { held } : {}),
        ...(trayed !== undefined ? { tray: trayed } : {}),
      };
      lastInputs = inputs;
      lastFrame = ground.render(inputs);
      redraws += 1;
      opts.onFrame?.();
      if (builder.live()) { dirty = true; wakes.live += 1; }   // a spring, a ghost or a re-dressing ramp still moves: the next frame paints too
      if (tray.live()) { dirty = true; wakes.tray += 1; }        // …and so does a drawer on its way, a band letting go
      if (carry.live()) { dirty = true; wakes.tray += 1; }       // …and a copy lifting, gliding back, a ghost growing or flying home
    },
  };

  const outside = (reason: string): void => { opts.onWake?.(reason); };
  /** A tray pass made BETWEEN frames — a specimen's slot, a carried copy's (composite kinds' passes are made async): a frame is owed, and
   *  the loop may sleep since the drawer rested — a door from outside (K7a). */
  const trayLanded = (): void => { dirty = true; wakes.tray += 1; outside("tray"); };
  return {
    reflector,
    ready() { dirty = true; outside("ready"); },
    setTheme(t, p) {
      theme = t;
      if (p !== undefined) palette = p;
      looks = looksOf(lookKinds(), palette, theme);
      dirty = true;
      wakes.theme += 1;
      themeGen += 1;
      outside("theme");
    },
    configureGrid(g) { grid = g; dirty = true; wakes.grid += 1; gridGen += 1; outside("grid"); },
    wake(reason) { dirty = true; wakes[reason] += 1; if (reason === "pin") pinGen += 1; outside(reason); },
    pinBuild(pins) {
      if (pins.portals !== undefined) portalsOn = pins.portals;
      if (pins.lodZoom !== undefined) lodPin = pins.lodZoom === null ? undefined : pins.lodZoom;
      if (pins.freeze !== undefined) freeze = pins.freeze;
      if (pins.holdRedress !== undefined) holdRedress = pins.holdRedress;
      if (pins.hold !== undefined) holdPin = pins.hold === null ? undefined : pins.hold;
      dirty = true;
      wakes.pin += 1;
      pinGen += 1;
      outside("pin");
    },
    restless(kinds) { restless = kinds; },
    dirty: () => dirty,
    due: (now) => (blocked || disposed ? Number.POSITIVE_INFINITY : dirty || ambientLive ? now : facedAt),
    redraws: () => redraws,
    stats: () => ({ ...builder.stats(), redraws, frame: lastFrame, ambient: ambient.state() }),
    wakes: () => ({ ...wakes }),
    lastInputs: () => lastInputs,
    grid: () => grid,
    theme: () => theme,
    look: (kind) => looks.get(kind),
    tray,
    traySpecimens: () => drawnSpecimens,
    drawsType: (type) => kindOn(objectKindOf(widgetTypeFor(world, type))) !== undefined,
    trayShows: (e) => trayDrawn.has(e as number),
    carry,
    trayCarried: () => drawnCarried,
    dispose() { disposed = true; },
  };
}

/**
 * The tray's specimens as the renderer reads them (K5a): the tray entity's `Specimen` children — each's object type, its kind, where it
 * hangs, its props, its entry's hang and label — and its kind's desk state when its entry asks for it (K5b). A specimen whose kind `on`
 * refuses (petition I25: one the desk was not mounted with) is not read, as a kindless one is not.
 */
function readSpecimens(w: World, tray: Entity | undefined, locals: ReadonlyMap<string, KindLocal> | undefined, on: (kind: ObjectKind | undefined) => ObjectKind | undefined): TraySpecimen[] {
  if (tray === undefined) return [];
  const out: TraySpecimen[] = [];
  for (const e of specimensOf(w, tray)) {
    const type = w.get(e, PrefabId)?.id;
    if (typeof type !== "string") continue;
    const widget = widgetTypeFor(w, type);
    const kind = on(objectKindOf(widget));
    const entry = widget?.tray;
    const at = w.get(e, Position);
    const size = w.get(e, Size);
    if (widget === undefined || kind === undefined || entry === undefined || at === undefined || size === undefined) continue;
    const props: Record<string, unknown> = {};
    for (const g of widget.groups) {
      const v = w.get(e, g.component) as Record<string, unknown> | undefined;
      if (v !== undefined) for (const name of Object.keys(g.fields)) props[name] = v[name];
    }
    const local = entry.local === true ? locals?.get(kind.name) : undefined;
    out.push({ key: e as number, type, kind, natural: widget.defaultSize, rect: { x: at.x, y: at.y, w: size.w, h: size.h }, props, accessory: entry.hang.accessory, pegs: entry.hang.pegs, label: entry.label, ...(local !== undefined ? { local } : {}) });
  }
  return out;
}

/** An object's props as the world holds them: each prop group's fields. */
function propsOf(w: World, e: Entity, widget: WidgetType): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const g of widget.groups) {
    const v = w.get(e, g.component) as Record<string, unknown> | undefined;
    if (v !== undefined) for (const name of Object.keys(g.fields)) props[name] = v[name];
  }
  return props;
}

/** What one taken off the tray is made with, as props (K5b): the widget's defaults with its entry's `take` folded in — the insert ghost's. */
function takenProps(widget: WidgetType): Record<string, unknown> {
  const cells = new Map<unknown, Record<string, unknown>>();
  for (const [c, v] of widget.prefab.components) cells.set(c, v as Record<string, unknown>);
  const take = widget.tray === undefined ? undefined : trayTakeProps(widget.tray);
  if (take !== undefined) for (const [c, v] of widgetSpawnInits(widget.type, { x: 0, y: 0, props: take }, widget).overrides) cells.set(c, v as Record<string, unknown>);
  const props: Record<string, unknown> = {};
  for (const g of widget.groups) {
    const v = cells.get(g.component);
    if (v !== undefined) for (const name of Object.keys(g.fields)) props[name] = v[name];
  }
  return props;
}

/** The insert ghosts in the world (K5b): each's rect, and — flying home — how far its tween has run. */
function readGhosts(w: World): CarryGhost[] {
  const out: CarryGhost[] = [];
  w.query(insertQ).each((b) => {
    for (const r of b) {
      const e = b.entity(r);
      const at = w.read(e, Position);
      const size = w.read(e, Size);
      const retiring = w.hasTag(e, GhostRetiring);
      const tw = retiring ? w.get(e, TransformTween) : undefined;
      out.push({ entity: e as number, type: w.read(e, InsertGhost).type ?? "", x: at.x, y: at.y, w: size.w, h: size.h, retiring, progress: tw === undefined ? (retiring ? 1 : 0) : tw.durationMs > 0 ? tw.elapsedMs / tw.durationMs : 1 });
    }
  });
  return out;
}

/** Each kind's look for a theme, by kind name — what `ObjectContext.look` carries. */
export function looksOf(kinds: readonly ObjectKind[], palette: Palette, theme: GroundTheme): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const k of kinds) if (k.theme !== undefined) out.set(k.name, k.theme(palette, theme.name));
  return out;
}
