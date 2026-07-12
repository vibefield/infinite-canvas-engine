/**
 * `GlCardBackplate` — the in-scene equivalent of v1's DOM gradient card behind
 * a GL widget's geometry. v3 GL islands have no DOM chrome, so the five v1
 * `withCard: true` cards (matte-sphere, torus-knot, gold-knot, shapes,
 * orbit-cube) render their card as a plane textured with a CanvasTexture: a 2D
 * canvas painted with the card's recorded v1 linear gradient, clipped to a
 * rounded rect (radius 22) so the corners are transparent and the island's
 * alpha composite keeps them rounded.
 *
 * Sizing: the plane + texture track the LIVE widget size (passed in from the
 * scene, which already reads `Size`); the texture is redrawn whenever w/h
 * change (useMemo dep) and disposed on change/unmount (no GL leak).
 *
 * Placement + hit behavior: mounted just behind the content (default z=-40).
 * By default it is NOT raycastable (`raycast` no-op) so it never swallows
 * events for non-interactive cards — dragging anywhere on them still reaches
 * the engine. ShapesCard passes `handlers` (and thus becomes raycastable): its
 * backplate IS the RFC-006 interaction claim surface, so the swarm's repel and
 * accent-cycle live on it (the router delivers events to it through the body
 * cloud — invisible or visible material is irrelevant to the raycast).
 */
import { type ReactElement, useEffect, useMemo } from "react";
import { CanvasTexture } from "three";

export interface GradientStop {
  /** 0..1 along the 135° diagonal (top-left → bottom-right). */
  readonly offset: number;
  readonly color: string;
}

/** The router's synthetic event, minimally (also satisfies R3F handler slots). */
type BackplatePointer = {
  stopPropagation(): void;
  point?: { x: number; y: number };
  nativeEvent?: PointerEvent;
};

export interface GlCardBackplateHandlers {
  onPointerDown?: (e: BackplatePointer) => void;
  onPointerMove?: (e: BackplatePointer) => void;
  onPointerUp?: (e: BackplatePointer) => void;
  onPointerOut?: (e: BackplatePointer) => void;
  onClick?: (e: BackplatePointer) => void;
}

export interface GlCardBackplateProps {
  readonly width: number;
  readonly height: number;
  readonly stops: readonly GradientStop[];
  /** Corner radius in island units (v1 card radius). Default 22. */
  readonly radius?: number;
  /** Z behind the content. Default -40. */
  readonly z?: number;
  /** Present → the plane is raycastable and carries these handlers (ShapesCard). */
  readonly handlers?: GlCardBackplateHandlers;
}

/** Non-raycastable marker for decorative (non-interactive) backplates. */
const NO_RAYCAST = (): void => {};

function makeGradientTexture(
  width: number,
  height: number,
  stops: readonly GradientStop[],
  radius: number,
): CanvasTexture {
  const cw = Math.max(1, Math.round(width));
  const ch = Math.max(1, Math.round(height));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) {
    ctx.clearRect(0, 0, cw, ch); // transparent outside the rounded rect
    const r = Math.max(0, Math.min(radius, cw / 2, ch / 2));
    ctx.beginPath();
    ctx.roundRect(0, 0, cw, ch, r);
    ctx.clip();
    const grad = ctx.createLinearGradient(0, 0, cw, ch); // 135°-ish diagonal
    for (const s of stops) grad.addColorStop(Math.min(1, Math.max(0, s.offset)), s.color);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, cw, ch);
  }
  const tex = new CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

export function GlCardBackplate({
  width,
  height,
  stops,
  radius = 22,
  z = -40,
  handlers,
}: GlCardBackplateProps): ReactElement {
  const texture = useMemo(
    () => makeGradientTexture(width, height, stops, radius),
    [width, height, stops, radius],
  );
  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <mesh position={[0, 0, z]} {...(handlers === undefined ? { raycast: NO_RAYCAST } : handlers)}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={texture} transparent toneMapped={false} />
    </mesh>
  );
}
