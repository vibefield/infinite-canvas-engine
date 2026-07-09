/**
 * Selection ops — bulk `Selected` tag flips from app handlers (design-003 §5.1).
 *
 * `Selected` is a runtime rider; toggling it via `world.addTag/removeTag` is a
 * legal free write from an app handler (design-001 §2 rule 4 — riders are not
 * doc cells). The engine bumps the `SelectionVersion` stamp (helpers/version-stamps.ts)
 * on every actual change, in addition to firing the optional `onChange` hook the
 * app wires for its own bookkeeping. Selection is committed ONCE per interaction,
 * never per frame (the v1 marquee lesson) — so change-only firing matters for both.
 */
import { defineQuery } from "@vibecook/strata-ecs";
import type { Entity, World } from "@vibecook/strata-ecs";
import { Selected } from "../catalog/selection-presence";
import { bumpVersion, SelectionVersion } from "../helpers/version-stamps";

export type SelectionMode = "replace" | "toggle" | "add";

const selectedQuery = defineQuery([Selected]);

/** All entities currently carrying the `Selected` rider. */
export function selectedEntities(world: World): Entity[] {
  const out: Entity[] = [];
  world.query(selectedQuery).each((batch) => {
    for (const row of batch) out.push(batch.entity(row));
  });
  return out;
}

/**
 * Apply a selection.
 *  - `replace`: exactly `entities` end up selected (others cleared).
 *  - `toggle`: flip each of `entities`.
 *  - `add`: union `entities` into the current selection.
 * `onChange` fires once, only if a tag actually flipped.
 */
export function setSelection(
  world: World,
  entities: Iterable<Entity>,
  mode: SelectionMode,
  onChange?: () => void,
): void {
  const next = new Set(entities);
  let changed = false;

  if (mode === "replace") {
    for (const e of selectedEntities(world)) {
      if (!next.has(e)) {
        world.removeTag(e, Selected);
        changed = true;
      }
    }
    for (const e of next) {
      if (!world.hasTag(e, Selected)) {
        world.addTag(e, Selected);
        changed = true;
      }
    }
  } else if (mode === "toggle") {
    for (const e of next) {
      if (world.hasTag(e, Selected)) world.removeTag(e, Selected);
      else world.addTag(e, Selected);
      changed = true;
    }
  } else {
    for (const e of next) {
      if (!world.hasTag(e, Selected)) {
        world.addTag(e, Selected);
        changed = true;
      }
    }
  }

  if (changed) {
    bumpVersion(world, SelectionVersion);
    onChange?.();
  }
}

/** Clear the whole selection. `onChange` fires once, only if something was selected. */
export function clearSelection(world: World, onChange?: () => void): void {
  let changed = false;
  for (const e of selectedEntities(world)) {
    world.removeTag(e, Selected);
    changed = true;
  }
  if (changed) {
    bumpVersion(world, SelectionVersion);
    onChange?.();
  }
}
