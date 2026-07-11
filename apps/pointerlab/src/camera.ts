/**
 * Camera utilities (v2 camera.ts's imperative helpers, ported to v3's Camera
 * resource + Position/Size top-left widgets). The pan/zoom BEHAVIOR lives in
 * the engine (cameraControl consumes the L2 recognizers); these are the
 * host-called helpers: first-fit framing + the zoom pill's absolute zooms.
 */
import { Camera, Viewport, type World } from "@ice/core";
import { Position, Size } from "@ice/core";
import { defineQuery } from "@ice/core";
import { screenToWorld } from "@ice/kernel";
import { WidgetVisual } from "./components";

// v2 prototype clamp (tighter than the engine default 0.1) — CameraLimits is seeded to match.
export const ZOOM_MIN = 0.2;
export const ZOOM_MAX = 5;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

const widgetQ = defineQuery([Position, Size, WidgetVisual]);

/** Frame all demo widgets into the viewport with padding (v2 zoomToFit; runs once on first viewport sync). */
export function zoomToFit(world: World, padding = 64): void {
  const vp = world.getResource(Viewport);
  if (vp === undefined || vp.w === 0 || vp.h === 0) return;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  world.query(widgetQ).each((b) => {
    for (const r of b) {
      const e = b.entity(r);
      const p = world.read(e, Position);
      const s = world.read(e, Size);
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + s.w);
      maxY = Math.max(maxY, p.y + s.h);
    }
  });
  if (!Number.isFinite(minX)) return;

  const cw = maxX - minX + padding * 2;
  const ch = maxY - minY + padding * 2;
  const zoom = clamp(Math.min(vp.w / cw, vp.h / ch), ZOOM_MIN, ZOOM_MAX);
  const cam = world.getResource(Camera) ?? { x: 0, y: 0, zoom: 1, gesturing: false };
  world.setResource(Camera, {
    ...cam,
    zoom,
    x: minX - padding - (vp.w / zoom - cw) / 2,
    y: minY - padding - (vp.h / zoom - ch) / 2,
  });
}

/** Zoom to an absolute level about a SCREEN point — anchored, so the world point under (sx,sy) holds. */
export function setZoomAtPoint(world: World, sx: number, sy: number, targetZoom: number): void {
  const cam = world.getResource(Camera);
  if (cam === undefined) return;
  const before = screenToWorld(sx, sy, cam);
  const zoom = clamp(targetZoom, ZOOM_MIN, ZOOM_MAX);
  world.setResource(Camera, { ...cam, zoom, x: before.x - sx / zoom, y: before.y - sy / zoom });
}

/** Zoom to an absolute level about the viewport centre (the zoom pill's path). */
export function setZoomAtCenter(world: World, targetZoom: number): void {
  const vp = world.getResource(Viewport);
  if (vp === undefined) return;
  setZoomAtPoint(world, vp.w / 2, vp.h / 2, targetZoom);
}

/** Multiply the zoom by a factor, about the viewport centre. */
export function zoomByCenter(world: World, factor: number): void {
  const cam = world.getResource(Camera);
  if (cam === undefined) return;
  setZoomAtCenter(world, cam.zoom * factor);
}
