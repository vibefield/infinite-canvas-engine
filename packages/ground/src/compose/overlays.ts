// The compose host's overlay DRIVER (design-013 §8 C1, D-C1.3): the wires and
// the guides as the ROOT slot's two overlays.
//
// Both are collected in SCREEN px under the LIVE camera — that is what the
// collectors do inside (`worldToScreen`, then triangles in CSS px), and it is
// why they belong to the root and to no other slot: a nested portal slot and a
// flight's departed slot see a different camera, and a screen-px soup collected
// for one is nonsense in the other. Design-011 §7.3's destination-frame truth
// says the same thing about the flight, so wires and guides CUT at the switch,
// like the stratified islands (B9). The departed frame's wires are OWED and
// named in the plan: a world-space soup whose widths are re-collected per frame.
//
// The dirt is PULLED, never observed: a strata change collector journals the
// facts the two collectors read — the same components and tags the old
// `passes/wires.ts` and `passes/guides.ts` armed observers on, one for one —
// and `changed()` drains it. A Tier-1 `observeQuery` on Position/Size would
// wake every frame a selection exists (the column-wide stamp a chrome system
// declares); this cannot.
//
// The GATE is the canvas type's (`presentation.ground.wires` / `.guides`,
// core's `define-canvas-type.ts`) — the same booleans the old program host
// reconciled its two shared passes on (deleted at C2), defaulting to ON. It is
// read at the mount and again on every canvas switch, never inside a flush.
//
// COLOURS. The collectors take theirs from core's `WiresConfig` /
// `SnapGuidesConfig` — plain-data vocabulary an app passes in (`groundField({
// wires, guides })` / `groundCompose({ wires, guides })`, what the old leg's
// `ground({ wires, guides })` took before C2), NOT from `GroundTheme` and not
// from `ChromeSettings`. So an app that themed its wires under the old leg
// themes them the same way here. Nothing about them is a colour literal in
// this package, so the theme test has nothing to say.

import {
  Active,
  type CanvasType,
  DEFAULT_SNAP_GUIDES_CONFIG,
  DEFAULT_WIRES_CONFIG,
  Drag,
  GuideLine,
  MeasuredSize,
  Port,
  PortAnchor,
  Position,
  RoutedConnect,
  Selected,
  Size,
  type SnapGuidesConfig,
  SpacingBar,
  Wire,
  type WirePreviewBuffer,
  type WiresConfig,
  type World,
} from "@ice/core";
import { collectGuides } from "./guides-collect";
import { guidesOverlay, type OverlayInputs, type OverlayProgram, wiresOverlay } from "./overlay";
import type { OverlayFrame, TriSoup } from "./soup";
import { collectWires } from "./wires-collect";

export interface OverlayDriverOptions {
  /** The wires' look and widths (core's `WiresConfig`); the app's partial over `DEFAULT_WIRES_CONFIG`. */
  readonly wires?: Partial<WiresConfig>;
  /** The snap guides' look (core's `SnapGuidesConfig`). */
  readonly guides?: Partial<SnapGuidesConfig>;
  /**
   * The current canvas type, for the gate. Absent = both overlays on (a
   * headless mount, a lab, a world with no canvas types at all).
   */
  readonly canvas?: { type(): CanvasType | undefined; subscribe(onChange: () => void): () => void };
  /** The connect-drag preview buffer (graph boards); absent = no preview stroke. */
  readonly readWirePreview?: () => WirePreviewBuffer;
}

/** What the last `build` collected — the churn instrument, and the rigs' witness. */
export interface OverlayStats {
  /** Vertices in the wires soup (0 = nothing drawn, or the gate is off). */
  readonly wires: number;
  readonly guides: number;
  /** The gate as the canvas type last set it. */
  readonly wiresOn: boolean;
  readonly guidesOn: boolean;
  /** Collections run since the mount — one per painted frame whose facts or camera moved, never one per frame. */
  readonly collects: number;
}

export interface OverlayDriver {
  /** The programs to register (`Ground.create({ overlays })`) — the wires `under`, the guides `over`. */
  readonly programs: readonly OverlayProgram[];
  /** PULL the world's dirt for the two collectors; call it EVERY frame (it drains the journal). */
  changed(): boolean;
  /** Arm the out-of-world wake: a canvas switch flips the gate. Returns the disarm. */
  observe(wake: () => void): () => void;
  /**
   * This frame's root-slot overlay inputs, re-collected when a fact or the
   * camera moved since the last build and returned from the last collection
   * otherwise. `undefined` = nothing to draw at all.
   */
  build(frame: OverlayFrame): OverlayInputs | undefined;
  stats(): OverlayStats;
  dispose(): void;
}

const EMPTY: TriSoup = { positions: new Float32Array(0), colors: new Float32Array(0), vertexCount: 0 };

export function createOverlays(world: World, opts: OverlayDriverOptions = {}): OverlayDriver {
  const wiresConfig: WiresConfig = { ...DEFAULT_WIRES_CONFIG, ...(opts.wires ?? {}) };
  const guidesConfig: SnapGuidesConfig = { ...DEFAULT_SNAP_GUIDES_CONFIG, ...(opts.guides ?? {}) };
  const programs = [wiresOverlay(), guidesOverlay()] as const;
  // The journal of every fact the two collectors read. One for one with what
  // `passes/wires.ts` and `passes/guides.ts` observed: the wires' geometry
  // (Position/Size and the MeasuredSize rider), the port anchors, the connect
  // drag's value, the guide and bar values; and by membership the wires
  // themselves, the selection, the nav-frame Active set (the scope filter), the
  // materialized ports and a routed connect. `coarse: false`: no writer of
  // these pokes raw columns.
  const collector = world.changes.collect({
    components: [Position, Size, MeasuredSize, PortAnchor, Drag, GuideLine, SpacingBar],
    tags: [Wire, Selected, Active, Port, RoutedConnect],
    coarse: false,
  });
  let wiresOn = true;
  let guidesOn = true;
  let dirty = true;
  let disposed = false;
  let collects = 0;
  let last: OverlayInputs | undefined;
  let lastKey = "";
  let wiresSoup: TriSoup = EMPTY;
  let guidesSoup: TriSoup = EMPTY;

  const readGate = (): boolean => {
    let type: CanvasType | undefined;
    try {
      type = opts.canvas?.type();
    } catch {
      type = undefined;   // a headless or half-built canvas seam must not take the ground down
    }
    const ground = type?.presentation?.ground;
    const w = ground?.wires !== false;
    const g = ground?.guides !== false;
    const changed = w !== wiresOn || g !== guidesOn;
    wiresOn = w;
    guidesOn = g;
    return changed;
  };
  readGate();

  return {
    programs,
    changed() {
      if (disposed) return false;
      const delta = collector.drain();
      const any = delta.reset || delta.changed.length > 0 || delta.coarse.length > 0 || delta.removed.length > 0;
      if (any) dirty = true;
      return any;
    },
    observe(wake) {
      const unsub = opts.canvas?.subscribe(() => {
        if (disposed) return;
        if (readGate()) { dirty = true; wake(); }
      });
      return () => { unsub?.(); };
    },
    build(frame) {
      if (disposed) return undefined;
      // The camera and the viewport are the other half of a collector's input: a
      // pan re-maps every triangle. Fold them into the key so a frame painted for
      // an unrelated reason (a spring still moving) re-uses the last soups.
      const key = `${frame.camera.x},${frame.camera.y},${frame.camera.zoom},${frame.width},${frame.height},${frame.dpr}`;
      if (!dirty && key === lastKey && last !== undefined) return last;
      dirty = false;
      lastKey = key;
      collects += 1;
      wiresSoup = wiresOn ? collectWires(world, frame, wiresConfig, opts.readWirePreview?.()) : EMPTY;
      guidesSoup = guidesOn ? collectGuides(world, frame, guidesConfig) : EMPTY;
      const out: Record<string, TriSoup> = {};
      if (wiresSoup.vertexCount > 0) out[programs[0].name] = wiresSoup;
      if (guidesSoup.vertexCount > 0) out[programs[1].name] = guidesSoup;
      last = Object.keys(out).length > 0 ? out : undefined;
      return last;
    },
    stats: () => ({ wires: wiresSoup.vertexCount, guides: guidesSoup.vertexCount, wiresOn, guidesOn, collects }),
    dispose() {
      disposed = true;
      collector.dispose();
      last = undefined;
    },
  };
}
