/**
 * GL twin of CardShell's lift: scales the island scene 1.05 while the widget
 * is hold-armed (post-Sequence-hand-off Drag capturing it, no Grab yet) or
 * live-dragged (Grab). Static islands repaint via useIslandInvalidate on
 * flip; animated ones pick the scale up on their next Hot tick anyway.
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
import { useIslandInvalidate } from "@ice/r3f";
import { useEffect, useState, type ReactNode } from "react";

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
  const invalidate = useIslandInvalidate();
  useEffect(() => {
    const id = setInterval(() => setLifted(isLifted(world, entity)), 60);
    return () => clearInterval(id);
  }, [world, entity]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `lifted` is the TRIGGER — the effect must fire on every flip to repaint static islands
  useEffect(() => {
    invalidate(); // repaint even static (animated:false) islands on flip
  }, [lifted, invalidate]);
  return <group scale={lifted ? 1.05 : 1}>{children}</group>;
}
