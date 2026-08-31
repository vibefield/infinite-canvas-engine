/**
 * spawnWidget — the paved-road widget creation op (app handler, design-005 §2).
 *
 * One guardedTransaction: spawnPrefab with Position (+Size) overrides and any
 * prop overrides folded into their group components (whole-group values —
 * design-001 §5.2's conflict-group granularity). Validation runs through each
 * prop's Standard Schema before the write.
 */
import type { Component, Entity, OrderPlace, Relation, World } from "@vibecook/strata-ecs";
import type { DurableStore } from "@vibecook/strata-ecs/durable";
import { ChildOf, Position, Size } from "../catalog";
import { guardedTransaction, type GuardedTx } from "../guards/guarded-tx";
import type { AnyBehaviorDef } from "../behavior/types";
import { widgetTypeFor } from "../canvas/engine-catalog";
import { frameParent } from "../ops/sibling-order";
import { init, type ComponentInit } from "../schema/prefab";
import { widgets, type WidgetType } from "./define-widget";
import { defaultValueOf } from "./props";

export interface SpawnWidgetOpts {
  readonly x: number;
  readonly y: number;
  readonly w?: number;
  readonly h?: number;
  /**
   * Sibling placement in the spawn parent's `ChildOf` sequence (petition 8);
   * default "last" = painted last = on top. "first" spawns UNDER everything in
   * the frame (e.g. a comment box spawning behind its members).
   */
  readonly order?: OrderPlace;
  /** Explicit `ChildOf` parent; default = the frame parent (nav frame ?? board root). */
  readonly parent?: Entity;
  readonly props?: Readonly<Record<string, unknown>>;
  /** false ⇒ the spawn never enters the local undo stack (batch seeds). */
  readonly undoable?: boolean;
}

/**
 * Hang the spawn's `ChildOf` edge (petition 8) — shared by `spawnWidget` and
 * the doc sink's create-intent execution so frame placement can never diverge
 * between the two spawn paths. A legacy world (no BoardRoot, no nav frame,
 * no explicit parent) gets NO edge: the entity stays legacy-fallback-ordered.
 */
export function attachSpawnParent(
  tx: { setRelation(e: Entity, r: Relation, target: Entity, place?: OrderPlace): void },
  world: World,
  spawned: Entity,
  opts?: { readonly parent?: Entity; readonly order?: OrderPlace },
): void {
  const parent = opts?.parent ?? frameParent(world);
  if (parent === undefined) return;
  tx.setRelation(spawned, ChildOf, parent, opts?.order ?? "last");
}

/**
 * The prefab-override list for a widget spawn (Position/Size + validated
 * whole-group prop values). Shared by `spawnWidget` and the doc sink's
 * create-intent execution (draw tool) so the two can never diverge.
 */
export function widgetSpawnInits(
  type: string,
  opts: SpawnWidgetOpts,
  resolvedWidget?: WidgetType,
): { prefab: import("../schema/prefab").Prefab; overrides: ComponentInit[] } {
  const widget = resolvedWidget ?? widgets.get(type);
  if (widget === undefined) throw new Error(`ice: spawnWidget — unknown widget type "${type}".`);

  // Fold prop overrides into whole-group values (defaults + overrides).
  const overrides: ComponentInit[] = [
    init(Position, { x: opts.x, y: opts.y }),
    init(Size, {
      w: opts.w ?? widget.defaultSize.w,
      h: opts.h ?? widget.defaultSize.h,
    }),
  ];
  const givenProps = opts.props ?? {};
  for (const [name, value] of Object.entries(givenProps)) {
    const group = widget.propToGroup[name];
    if (group === undefined) throw new Error(`ice: spawnWidget("${type}") — unknown prop "${name}".`);
  }
  for (const g of widget.groups) {
    const touched = Object.keys(givenProps).some((name) => widget.propToGroup[name] === g.name);
    if (!touched) continue;
    const value: Record<string, string | number | boolean> = {};
    for (const [name, spec] of Object.entries(g.fields)) {
      const given = givenProps[name];
      if (given !== undefined) {
        const result = spec["~standard"].validate(spec.kind === "json" ? given : given);
        if ("issues" in result) {
          throw new Error(
            `ice: spawnWidget("${type}") prop "${name}" invalid — ${result.issues[0]?.message}`,
          );
        }
        value[name] = spec.kind === "json" ? JSON.stringify(given) : (given as string | number | boolean);
      } else {
        // group values are whole-component writes: fill from defaults
        value[name] = defaultValueOf(spec);
      }
    }
    overrides.push([g.component, value] as ComponentInit);
  }

  return { prefab: widget.prefab, overrides };
}

/**
 * Attach a widget type's DURABLE pre-attached behaviors (design-009 §6), as
 * post-spawn `addComponent` calls inside the spawn transaction.
 *
 * Post-spawn rather than spawn-init overrides: `instantiate` checks every
 * override against the prefab's eligible set, and a behavior is eligible on
 * every entity by definition (BF-D6) — it is not in any prefab's set and never
 * will be. Runtime pre-attachments are NOT here: they ride projection (the
 * equip system), which is the only path that also equips a widget arriving
 * from a peer or a restored file.
 */
export function attachSpawnBehaviors(tx: GuardedTx, widget: WidgetType, e: Entity): void {
  for (const entry of widget.behaviors) {
    if (entry.behavior.store !== "durable") continue;
    tx.addComponent(
      e,
      entry.behavior.component as Component<Record<string, unknown>>,
      behaviorCell(entry.behavior, entry.data),
    );
  }
}

/** Defaults ∪ the declared pre-attach data, serialized for the cell. */
function behaviorCell(b: AnyBehaviorDef, data: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(b.defaults as Record<string, unknown>) };
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    const spec = b.schema[k];
    out[k] = spec?.kind === "json" ? JSON.stringify(v) : v;
  }
  return out;
}

export function spawnWidget(
  store: DurableStore,
  world: World,
  type: string,
  opts: SpawnWidgetOpts,
): Entity {
  const widget = widgetTypeFor(world, type);
  if (widget === undefined) throw new Error(`ice: spawnWidget — unknown widget type "${type}".`);
  const { prefab, overrides } = widgetSpawnInits(type, opts, widget);
  let spawned: Entity | undefined;
  guardedTransaction(
    store,
    world,
    (tx) => {
      spawned = tx.spawnPrefab(prefab, overrides);
      attachSpawnParent(tx, world, spawned, opts);
      attachSpawnBehaviors(tx, widget, spawned);
    },
    opts.undoable === false ? { undoable: false } : undefined,
  );
  if (spawned === undefined) throw new Error("ice: spawnWidget — transaction did not spawn.");
  return spawned;
}
