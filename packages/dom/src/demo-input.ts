/**
 * ⚠️ TEMPORARY M3-DEMO ADAPTER — NOT the real input path. ⚠️
 *
 * This exists only to make the M3 gray-box demo pan and zoom before the
 * interaction stack lands. M4's L0 (design-003 §2–§3: adapters enqueue input
 * facts, systems own all interaction state in the world) REPLACES this file
 * wholesale — delete it then.
 *
 * It deliberately violates the "one input path" law's spirit by writing camera
 * state directly from event handlers. That write is legal specifically because
 * it is the app-handler path of design-002 §3: handlers running BETWEEN frames
 * may write RESOURCES (`Camera`, `Viewport`) — resources reorder no archetype
 * rows, and the write lands before the next `world.sync()`. It writes no
 * components, spawns nothing, and holds no gesture claim, so it stays inside
 * that narrow allowance. Do not grow it into a general interaction handler.
 *
 * Pan: pointer drag translates the camera by the cursor delta in world units
 * (`dx / zoom`). Zoom: wheel zooms about the cursor via kernel `zoomAtPoint`
 * (the world point under the cursor stays put), clamped to CAMERA_DEFAULTS.
 * Viewport is synced from the container's measured size (initial + ResizeObserver).
 */
import { CAMERA_DEFAULTS, Camera, Viewport, type World } from "@ice/core";
import { zoomAtPoint } from "@ice/kernel";
import type { CanvasHost } from "./host";

/** Wheel delta → zoom factor; exp keeps zoom multiplicative (uniform per notch). */
const ZOOM_SENSITIVITY = 0.0015;

export function attachDemoPanZoom(host: CanvasHost, world: World): () => void {
  const { container } = host;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  const camera = () => world.getResource(Camera) ?? { x: 0, y: 0, zoom: 1, gesturing: false };

  const onPointerDown = (e: PointerEvent): void => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    if (typeof container.setPointerCapture === "function") container.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    const cam = camera();
    world.setResource(Camera, { ...cam, x: cam.x - dx / cam.zoom, y: cam.y - dy / cam.zoom });
  };

  const onPointerUp = (e: PointerEvent): void => {
    dragging = false;
    if (typeof container.releasePointerCapture === "function") {
      container.releasePointerCapture(e.pointerId);
    }
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rect = container.getBoundingClientRect();
    const cam = camera();
    const factor = Math.exp(-e.deltaY * ZOOM_SENSITIVITY);
    const newZoom = Math.min(
      CAMERA_DEFAULTS.maxZoom,
      Math.max(CAMERA_DEFAULTS.minZoom, cam.zoom * factor),
    );
    const next = zoomAtPoint(cam, e.clientX - rect.left, e.clientY - rect.top, newZoom);
    world.setResource(Camera, { x: next.x, y: next.y, zoom: next.zoom, gesturing: cam.gesturing });
  };

  const measure = (): void => {
    const rect = container.getBoundingClientRect();
    const dpr =
      world.getResource(Viewport)?.dpr ??
      (typeof window !== "undefined" ? window.devicePixelRatio : 1);
    world.setResource(Viewport, { w: rect.width, h: rect.height, dpr });
  };

  measure();
  let resize: ResizeObserver | undefined;
  if (typeof ResizeObserver !== "undefined") {
    resize = new ResizeObserver(measure);
    resize.observe(container);
  }

  container.addEventListener("pointerdown", onPointerDown);
  container.addEventListener("pointermove", onPointerMove);
  container.addEventListener("pointerup", onPointerUp);
  container.addEventListener("pointercancel", onPointerUp);
  container.addEventListener("wheel", onWheel, { passive: false });

  return () => {
    container.removeEventListener("pointerdown", onPointerDown);
    container.removeEventListener("pointermove", onPointerMove);
    container.removeEventListener("pointerup", onPointerUp);
    container.removeEventListener("pointercancel", onPointerUp);
    container.removeEventListener("wheel", onWheel);
    resize?.disconnect();
  };
}
