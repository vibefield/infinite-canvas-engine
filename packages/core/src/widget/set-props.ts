/**
 * setWidgetProps — the paved-road widget prop UPDATE op (2026-07-13 review:
 * spawn validated through each prop's Standard Schema, but the update path —
 * raw `useCommit` writes — bypassed bounds/enum/json-shape checks entirely).
 *
 * Mirrors `widgetSpawnInits` semantics exactly: unknown prop names throw,
 * each given value runs `spec["~standard"].validate` (an invalid value throws
 * BEFORE anything is written), `p.json` values are validated as parsed shapes
 * then serialized into their string cell. Writes are whole-group absolute
 * values (the current cell merged with the validated updates — design-001
 * §5.2 conflict-group granularity), one guardedTransaction = one undo step.
 */
import type { Component, Entity, World } from "@vibecook/strata-ecs";
import type { DurableStore } from "@vibecook/strata-ecs/durable";
import { guardedTransaction, type GuardedTxOpts } from "../guards/guarded-tx";
import { widgetTypeFor } from "../canvas/engine-catalog";
import { PrefabId } from "../schema/prefab";

export function setWidgetProps(
  store: DurableStore,
  world: World,
  entity: Entity,
  props: Readonly<Record<string, unknown>>,
  opts?: GuardedTxOpts,
): void {
  const type = world.get(entity, PrefabId)?.id;
  const widget = typeof type === "string" ? widgetTypeFor(world, type) : undefined;
  if (widget === undefined) {
    throw new Error(`ice: setWidgetProps — entity ${String(entity)} is not a defined widget.`);
  }
  for (const name of Object.keys(props)) {
    if (widget.propToGroup[name] === undefined) {
      throw new Error(`ice: setWidgetProps("${widget.type}") — unknown prop "${name}".`);
    }
  }

  // Validate + serialize every touched group BEFORE the transaction opens, so
  // an invalid value can never leave a partial multi-group update behind.
  const groupWrites: [Component, Record<string, string | number | boolean>][] = [];
  for (const g of widget.groups) {
    const touched = Object.keys(props).some((name) => widget.propToGroup[name] === g.name);
    if (!touched) continue;
    const current = (world.get(entity, g.component) ?? {}) as Record<string, string | number | boolean>;
    const value = { ...current };
    for (const [name, spec] of Object.entries(g.fields)) {
      const given = props[name];
      if (given === undefined) continue;
      const result = spec["~standard"].validate(given);
      if ("issues" in result) {
        throw new Error(
          `ice: setWidgetProps("${widget.type}") prop "${name}" invalid — ${result.issues[0]?.message}`,
        );
      }
      value[name] = spec.kind === "json" ? JSON.stringify(given) : (given as string | number | boolean);
    }
    groupWrites.push([g.component as Component, value]);
  }

  guardedTransaction(
    store,
    world,
    (tx) => {
      for (const [component, value] of groupWrites) {
        tx.edit(entity).set(component, value);
      }
    },
    opts,
  );
}
