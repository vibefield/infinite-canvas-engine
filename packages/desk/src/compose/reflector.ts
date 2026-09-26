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
  LocalPointer,
  NavRedress,
  NavTransition,
  Pointer,
  PointerScreen,
  PointerVersion,
  type ReflectorDef,
  Viewport,
  type World,
} from "@ice/core";
import type { Ground, GroundFrameInputs, GroundStats } from "../ground";
import type { ObjectKind } from "../kinds/world";
import { DEFAULT_GRID, type GridConfig } from "../mat/grid";
import type { GroundTheme, Palette } from "../theme";
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
}

/** What woke a frame, counted since the mount — the builder's reasons and the reflector's own. */
export type DeskWakes = Readonly<Record<DeskWakeReason | "camera" | "viewport" | "nav" | "theme" | "grid" | "pin" | "ambient" | "live" | "ink", number>>;

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
  redraws(): number;
  stats(): DeskReflectorStats;
  wakes(): DeskWakes;
  /** The inputs of the last render, as handed to `Ground.render`. */
  lastInputs(): GroundFrameInputs | null;
  grid(): GridConfig;
  theme(): GroundTheme;
  /** A kind's look for the theme in force (its `theme()` of the palette) — the held bar's swatches read it (D3t-a). */
  look(kind: string): unknown;
  dispose(): void;
}

const localPointersQ = defineQuery([Pointer, LocalPointer, PointerScreen]);

export function createDeskReflector(opts: DeskReflectorOptions): DeskReflector {
  const { world, builder, ambient } = opts;
  const maxDpr = opts.maxDpr ?? 2;
  let theme = opts.theme;
  let palette = opts.palette;
  let grid = opts.grid ?? DEFAULT_GRID;
  let looks = looksOf(opts.kinds, palette, theme);
  let dirty = true;
  let disposed = false;
  let redraws = 0;
  let lastInputs: GroundFrameInputs | null = null;
  let lastFrame: GroundStats | null = null;
  let builtTick = -1;
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
  const wakes: Record<keyof DeskWakes, number> = { world: 0, removed: 0, reset: 0, order: 0, hover: 0, marks: 0, camera: 0, viewport: 0, nav: 0, theme: 0, grid: 0, pin: 0, ambient: 0, live: 0, ink: 0 };
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
      const ground = opts.ground();
      if (ground === null) return;   // pre-ready: the dirt is kept
      const cam = w.getResource(Camera);
      const vp = w.getResource(Viewport);
      if (cam === undefined || vp === undefined || vp.w <= 0 || vp.h <= 0) return;   // no viewport yet: stay dirty, paint when it exists
      // the ambient's clocks: stepped every tick the ground is here — a frame is wanted while the wind blows or the tilt moves
      const dtMs = info?.dt ?? 16;
      // in hand the mat's tilt lets go of the pointer too: the desk behind the hand stands still
      const amb = ambient.step(dtMs / 1000, now, inHand ? null : pointerNdc(vp));
      if (amb.live) { dirty = true; wakes.ambient += 1; }
      if (!dirty) return;   // IDLE-ZERO: no getCurrentTexture, no submit
      dirty = false;
      const dpr = Math.min(vp.dpr > 0 ? vp.dpr : 1, maxDpr);
      opts.attach.resize(Math.max(1, Math.round(vp.w * dpr)), Math.max(1, Math.round(vp.h * dpr)));
      const camera = { x: cam.x, y: cam.y, zoom: cam.zoom };
      const built = builder.build(camera, { width: vp.w, height: vp.h, dpr }, dtMs / 1000, theme, grid, looks, {
        now, mat: amb.frame, portals: portalsOn, freeze, holdRedress, ...(lodPin !== undefined ? { lodZoom: lodPin } : {}), ...(holdPin !== undefined ? { hold: holdPin } : {}),
        ...(restless !== undefined && restless.size > 0 ? { restless } : {}),
      });
      restless = undefined;
      // the hand (D4b): the desk copy's stamp is everything the copy depends on — the builder's desk count (never the held
      // object's own facts), the camera, the viewport, the theme, the grid, the pins, the mat's clocks and tilt this frame
      const held = built.held === undefined ? undefined : {
        ...built.held.inputs,
        stamp: `${built.held.deskSeq}|${camStamp}|${vpStamp}|${themeGen}|${gridGen}|${pinGen}|${amb.frame === undefined ? "still" : `${amb.frame.time},${amb.frame.goboTime},${amb.frame.noise[0]},${amb.frame.noise[1]},${amb.frame.goboMatrix.join(",")}`}`,
      };
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
      };
      lastInputs = inputs;
      lastFrame = ground.render(inputs);
      redraws += 1;
      opts.onFrame?.();
      if (builder.live()) { dirty = true; wakes.live += 1; }   // a spring, a ghost or a re-dressing ramp still moves: the next frame paints too
    },
  };

  return {
    reflector,
    ready() { dirty = true; },
    setTheme(t, p) {
      theme = t;
      if (p !== undefined) palette = p;
      looks = looksOf(opts.kinds, palette, theme);
      dirty = true;
      wakes.theme += 1;
      themeGen += 1;
    },
    configureGrid(g) { grid = g; dirty = true; wakes.grid += 1; gridGen += 1; },
    wake(reason) { dirty = true; wakes[reason] += 1; if (reason === "pin") pinGen += 1; },
    pinBuild(pins) {
      if (pins.portals !== undefined) portalsOn = pins.portals;
      if (pins.lodZoom !== undefined) lodPin = pins.lodZoom === null ? undefined : pins.lodZoom;
      if (pins.freeze !== undefined) freeze = pins.freeze;
      if (pins.holdRedress !== undefined) holdRedress = pins.holdRedress;
      if (pins.hold !== undefined) holdPin = pins.hold === null ? undefined : pins.hold;
      dirty = true;
      wakes.pin += 1;
      pinGen += 1;
    },
    restless(kinds) { restless = kinds; },
    dirty: () => dirty,
    redraws: () => redraws,
    stats: () => ({ ...builder.stats(), redraws, frame: lastFrame, ambient: ambient.state() }),
    wakes: () => ({ ...wakes }),
    lastInputs: () => lastInputs,
    grid: () => grid,
    theme: () => theme,
    look: (kind) => looks.get(kind),
    dispose() { disposed = true; },
  };
}

/** Each kind's look for a theme, by kind name — what `ObjectContext.look` carries. */
export function looksOf(kinds: readonly ObjectKind[], palette: Palette, theme: GroundTheme): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const k of kinds) if (k.theme !== undefined) out.set(k.name, k.theme(palette, theme.name));
  return out;
}
