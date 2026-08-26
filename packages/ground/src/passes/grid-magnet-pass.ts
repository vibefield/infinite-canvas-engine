/**
 * Magnet lattice as a complete GridPass implementation.
 *
 * There is no classic branch here: source collection, wake subscriptions and
 * rendering all belong to the selected implementation. Dot/needle remains a
 * cheap glyph uniform inside the one magnet renderer.
 */
import { SpatialVersion } from "@ice/core";
import type { Pole } from "../poles";
import {
  mergeGridConfig,
  resolveInitialGridConfig,
  type GridPassFactory,
} from "./grid-contract";
import { createMagnetGrid } from "./grid-magnet";
import {
  MAGNET_SOURCE_FLOATS,
  MAX_MAGNET_SOURCES,
  collectMagnetLevels,
  collectMagnetSources,
  magnetFieldScale,
  resolveMagnet,
} from "./magnet-collect";

export const createGridPass: GridPassFactory = (initial = {}, deps = {}) => {
  let cfg = resolveInitialGridConfig(initial);
  const renderer = createMagnetGrid();
  const poles = deps.poles ?? [];
  const sourceScratch = new Float32Array(MAX_MAGNET_SOURCES * MAGNET_SOURCE_FLOATS);
  const poleScratch: Pole[] = [];

  return {
    name: "grid",
    object: renderer.group,
    arm(world, wake) {
      // Gates read LIVE config so configure() re-tunes never re-arm.
      const wakeIfWidgets = (): void => {
        const magnet = resolveMagnet(cfg);
        if (magnet.widgets && deps.readSpatial !== undefined) wake();
      };
      const unsubs = [world.reactive.observeResource(SpatialVersion, wakeIfWidgets)];
      for (const source of poles) unsubs.push(source.subscribe(world, wake));
      return unsubs;
    },
    collect(world, frame) {
      const magnet = resolveMagnet(cfg);
      const fieldScale = magnetFieldScale(frame.camera.zoom, magnet.fadeZoom);
      poleScratch.length = 0;
      if (fieldScale > 0) {
        for (const source of poles) poleScratch.push(...source.read(world));
      }
      const sourceCount = collectMagnetSources(
        world,
        frame,
        magnet,
        fieldScale,
        poleScratch,
        deps.readSpatial,
        sourceScratch,
      );
      const levels = collectMagnetLevels(frame, cfg);
      renderer.update(frame, cfg, magnet, levels, sourceScratch, sourceCount);
    },
    configure(next) {
      cfg = mergeGridConfig(cfg, next);
      // Every magnet uniform is rewritten on the next collect; configureGrid
      // invalidates the layer after calling this method.
    },
    dispose() {
      renderer.dispose();
    },
  };
};
