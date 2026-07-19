/**
 * The lifted plane (design-004 §1, planes P1/P3 — M6 slice).
 *
 * M3 stood up ONE camera-transformed content plane (`host.ts`, P1). M6 adds P3,
 * the **lifted** plane: a second transform-origin-0-0 div appended to the
 * container AFTER the content plane, so it stacks ABOVE it (P3 over P1) with no
 * z-index bookkeeping — DOM order is the strata order (§1: "stacking is
 * stratified"). Both planes take the SAME single camera transform (the
 * plane-transform reflector writes both), so a promoted widget re-parented
 * content→lifted keeps its world position; it just paints above the content
 * layer for the duration of the drag.
 *
 * `createCanvasHost` is intentionally untouched: the content plane it owns is
 * the P1 authority. `createPlanes` is additive — it borrows that content plane
 * and mints the lifted sibling next to it.
 */
import type { CanvasHost } from "./host";

/** The two DOM planes M6 addresses: P1 content (host-owned) + P3 lifted. */
export interface Planes {
  /** P1: the host's camera-transformed content plane; world-positioned hosts mount here. */
  readonly content: HTMLDivElement;
  /** P3: camera-transformed, stacked above content; promoted (dragged) hosts re-parent here. */
  readonly lifted: HTMLDivElement;
  /** Remove the lifted plane (the content plane is the host's — host.dispose reaps it). */
  dispose(): void;
}

/**
 * The lifted-plane styles — identical to the content plane's (origin-anchored,
 * transform-ready). Re-declared here rather than reaching into `host.ts` so that
 * file stays the sole owner of the content plane and nothing it exports moves.
 */
const LIFTED_PLANE_STYLE: Readonly<Record<string, string>> = {
  position: "absolute",
  left: "0",
  top: "0",
  transformOrigin: "0 0",
  willChange: "transform",
  // The ONE explicit z in the plane sandwich (2026-07-19): in-container app
  // chrome may slot BETWEEN the planes with z-index 1 — resting widgets
  // slide under it while the dragged (promoted) widget floats over it. DOM
  // order alone leaves no gap for that; everything else stays order-stacked.
  zIndex: "2",
};

/**
 * Mint the lifted plane next to the host's content plane. The lifted div is
 * appended to the container AFTER the content plane, so it renders above it
 * (P3 > P1). Returns both planes for the plane-transform reflector (writes both)
 * and the dom-widgets reflector (re-parents hosts between them on drag-promote).
 */
export function createPlanes(host: CanvasHost): Planes {
  const lifted = host.container.ownerDocument.createElement("div");
  Object.assign(lifted.style, LIFTED_PLANE_STYLE);
  host.container.appendChild(lifted); // after contentPlane ⇒ P3 stacks above P1
  return {
    content: host.contentPlane,
    lifted,
    // Without this a React StrictMode remount stacks a second P3
    // (2026-07-11 reflector-teardown sweep, with the grid-canvas fix).
    dispose() {
      lifted.remove();
    },
  };
}
