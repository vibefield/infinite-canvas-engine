/**
 * The grid pass — a MODE FACADE since design-010: the classic analytic dot
 * grid (grid-classic.ts, the default — byte-identical to pre-magnet builds)
 * and the magnet field lattice (grid-magnet.ts + magnet-collect.ts) behind
 * ONE `GridPass` contract. `configure` deep-merges the `magnet` key one level
 * (§3.1) so partial re-tunes never clobber the block.
 *
 * Wake graph (all magnet wakes gated on `enabled` — the idle-scene zero-frame
 * guarantee is untouched when off): camera/resize are layer-owned;
 * `SpatialVersion` re-collects widget sources (gated on `widgets` too);
 * injected pole sources wake through their own subscriptions (D5 — the pass
 * observes no pointer/cursor/presence vocabulary). The magnet renderer is
 * built LAZILY on first enable: classic-only apps pay zero magnet cost.
 */
import {
  DEFAULT_GRID_CONFIG,
  SpatialVersion,
  type GridConfig,
  type World,
} from "@ice/core";
import { Group } from "three/webgpu";
import type { GroundFrame, GroundPass } from "../pass";
import type { Pole, PoleSource } from "../poles";
import { createClassicGrid, type ClassicGridRenderer } from "./grid-classic";
import { createMagnetGrid, type MagnetGridRenderer } from "./grid-magnet";
import {
  MAGNET_SOURCE_FLOATS,
  MAX_MAGNET_SOURCES,
  collectMagnetLevels,
  collectMagnetSources,
  magnetFieldScale,
  resolveMagnet,
  type ReadSpatial,
} from "./magnet-collect";

export interface GridPass extends GroundPass {
  /** Live re-tune (the react `grid` prop seam) — partial merge over current values. */
  configure(cfg: Partial<GridConfig>): void;
}

/** Injected magnet inputs (design-010 §3.2) — absent pieces disable their sources. */
export interface GridPassDeps {
  readonly poles?: readonly PoleSource[];
  readonly readSpatial?: ReadSpatial;
}

/** Shallow merge + one-level deep merge of the `magnet` block (design-010 §3.1). */
function mergeGridConfig(base: GridConfig, next: Partial<GridConfig>): GridConfig {
  const merged: GridConfig = { ...base, ...next };
  if (next.magnet !== undefined) merged.magnet = { ...base.magnet, ...next.magnet };
  return merged;
}

export function createGridPass(initial: Partial<GridConfig> = {}, deps: GridPassDeps = {}): GridPass {
  let cfg = mergeGridConfig(DEFAULT_GRID_CONFIG, initial);

  const group = new Group();
  const classic: ClassicGridRenderer = createClassicGrid(cfg);
  group.add(classic.mesh);
  let magnet: MagnetGridRenderer | null = null;

  const poles = deps.poles ?? [];
  const sourceScratch = new Float32Array(MAX_MAGNET_SOURCES * MAGNET_SOURCE_FLOATS);
  const poleScratch: Pole[] = [];

  return {
    name: "grid",
    object: group,
    arm(world: World, wake: () => void) {
      // Gates read LIVE config so configure() re-tunes never re-arm.
      const wakeIfWidgets = (): void => {
        const m = resolveMagnet(cfg);
        if (m.enabled && m.widgets && deps.readSpatial !== undefined) wake();
      };
      const wakeIfEnabled = (): void => {
        if (resolveMagnet(cfg).enabled) wake();
      };
      const unsubs = [world.reactive.observeResource(SpatialVersion, wakeIfWidgets)];
      for (const source of poles) unsubs.push(source.subscribe(world, wakeIfEnabled));
      return unsubs;
    },
    collect(world: World, frame: GroundFrame) {
      const m = resolveMagnet(cfg);
      if (!m.enabled) {
        classic.mesh.visible = true;
        if (magnet !== null) magnet.group.visible = false;
        classic.setCamera(frame);
        return;
      }
      if (magnet === null) {
        magnet = createMagnetGrid();
        group.add(magnet.group);
      }
      classic.mesh.visible = false;
      magnet.group.visible = true;

      const fieldScale = magnetFieldScale(frame.camera.zoom, m.fadeZoom);
      poleScratch.length = 0;
      if (fieldScale > 0) {
        for (const source of poles) poleScratch.push(...source.read(world));
      }
      const sourceCount = collectMagnetSources(
        world,
        frame,
        m,
        fieldScale,
        poleScratch,
        deps.readSpatial,
        sourceScratch,
      );
      const levels = collectMagnetLevels(frame, cfg);
      magnet.update(frame, cfg, m, levels, sourceScratch, sourceCount);
    },
    configure(next) {
      cfg = mergeGridConfig(cfg, next);
      classic.configure(cfg);
      // Magnet uniforms are rewritten wholesale next collect (configureGrid
      // calls invalidateAll) — no push needed here.
    },
    dispose() {
      classic.dispose();
      magnet?.dispose();
      magnet = null;
    },
  };
}
