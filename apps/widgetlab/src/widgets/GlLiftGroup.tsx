/**
 * GL twin of CardShell's lift — via the COMPOSITE quad (useIslandLift), not a
 * scene-scale: the quad carries the texture's rounded alpha corners with it
 * and pops the card over its neighbors, while a scene-scale pushed the
 * backplate past the card-sized frustum and cropped the corners square
 * (field report 2026-07-12). Lift signals match CardShell: hold-armed
 * (post-Sequence-hand-off Drag capturing this widget, no Grab yet) or
 * live-dragged (Grab).
 */
import {
  Captures,
  Drag,
  GesturePhases,
  Grab,
  HadSequence,
  type Entity,
  type World,
} from "@ice/core";
import { useIslandLift, useIslandOpacity } from "@ice/r3f";
import { useEffect, useState, type ReactNode } from "react";
import { LIFT_OPACITY } from "./CardShell";

function isLifted(world: World, entity: Entity): boolean {
  if (world.has(entity, Grab)) return true;
  for (const rec of world.getReverse(entity, Captures)) {
    if (!world.has(rec, Drag) || !world.hasTag(rec, HadSequence)) continue;
    if (world.hasTag(rec, GesturePhases.tags.Possible) || world.hasTag(rec, GesturePhases.tags.Active)) {
      return true;
    }
  }
  return false;
}

export function GlLiftGroup({
  world,
  entity,
  children,
}: {
  world: World;
  entity: Entity;
  children: ReactNode;
}) {
  const [lifted, setLifted] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setLifted(isLifted(world, entity)), 60);
    return () => clearInterval(id);
  }, [world, entity]);
  useIslandLift(lifted ? 1.05 : 1);
  // The drag-lift fade: same value as CardShell's CSS opacity, so the DOM
  // chrome (P1) and the floating 3D content (the composite quad) drop to 75 %
  // and restore together.
  useIslandOpacity(lifted ? LIFT_OPACITY : 1);
  return <group>{children}</group>;
}
