/**
 * One island = one GL widget's private Scene + center-origin Y-up ortho
 * camera, mounted via R3F `createPortal` so the content tree (hooks, state,
 * drei) lives OUTSIDE the composite scene and paints into a pooled FBO
 * (design-004 §3; the island-space convention is kernel's — Law 13).
 *
 * Deliberately thin: registration/unregistration is the ONLY effect. The
 * camera frustum is written by the frame pass at paint time from the live
 * `Size` (v1 set it from a React effect AND bumped an ECS component — both
 * moved out; islands never write ECS). Unmount (cull) drops scene + camera;
 * the FBO and island state survive in the pool/bridge — retention is
 * decoupled from culling by design.
 */
import { createPortal } from "@react-three/fiber";
import { createElement, useEffect, useMemo, type ComponentType, type ReactElement } from "react";
import { OrthographicCamera, Scene, type Texture } from "three";
import type { Entity, WidgetType, World } from "@ice/core";
import type { WidgetComponentProps } from "@ice/react";
import type { GLBridge } from "./bridge";
import { IslandContext } from "./use-island-frame";

export interface IslandProps {
  readonly bridge: GLBridge;
  readonly world: World;
  readonly entity: Entity;
  readonly widget: WidgetType;
  /** Shared IBL for this island's private scene (see GLViews.environment). */
  readonly environment?: Texture | null;
}

export function Island({ bridge, world, entity, widget, environment }: IslandProps): ReactElement | null {
  const scene = useMemo(() => new Scene(), []);
  const camera = useMemo(() => {
    // Generous depth range (ortho — free): at z=100 a large card's rotating
    // geometry (e.g. a 329px torus knot's lobe swinging toward the camera)
    // crossed the near plane and clipped (field report 2026-07-12).
    const cam = new OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
    cam.position.set(0, 0, 500); // +Z looking at the XY content plane
    cam.lookAt(0, 0, 0);
    return cam;
  }, []);

  useEffect(
    () => bridge.registerIsland(entity, { scene, camera }),
    [bridge, entity, scene, camera],
  );

  // Shared environment (v1's Compositor propagated its env map to every widget
  // scene; v3 islands are private, so propagation is this explicit stamp). The
  // HDR usually arrives AFTER the first cold paint — bumpPaint repaints even
  // static (animated:false) islands with the new lighting.
  useEffect(() => {
    scene.environment = environment ?? null;
    bridge.bumpPaint(entity);
  }, [environment, scene, bridge, entity]);

  const View = widget.component as ComponentType<WidgetComponentProps>;
  if (View == null) return null;

  return createPortal(
    createElement(
      IslandContext.Provider,
      { value: { bridge, entity } },
      createElement(View, { entity, world }),
    ),
    scene,
  ) as unknown as ReactElement;
}
