/**
 * spawnWidget — the paved-road widget creation op (app handler, design-005 §2).
 *
 * One guardedTransaction: spawnPrefab with Position (+Size) overrides and any
 * prop overrides folded into their group components (whole-group values —
 * design-001 §5.2's conflict-group granularity). Validation runs through each
 * prop's Standard Schema before the write.
 */
import type { Entity, OrderPlace, Relation, World } from "@vibecook/strata-ecs";
import type { DurableStore } from "@vibecook/strata-ecs/durable";
import { ChildOf, Position, Size } from "../catalog";
import { guardedTransaction } from "../guards/guarded-tx";
import { frameParent } from "../ops/sibling-order";
import { init, type ComponentInit } from "../schema/prefab";
import { widgets } from "./define-widget";
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
export function widgetSpawnInits(type: string, opts: SpawnWidgetOpts): { prefab: import("../schema/prefab").Prefab; overrides: ComponentInit[] } {
  const widget = widgets.get(type);
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

export function spawnWidget(
  store: DurableStore,
  world: World,
  type: string,
  opts: SpawnWidgetOpts,
): Entity {
  const { prefab, overrides } = widgetSpawnInits(type, opts);
  let spawned: Entity | undefined;
  guardedTransaction(
    store,
    world,
    (tx) => {
      spawned = tx.spawnPrefab(prefab, overrides);
      attachSpawnParent(tx, world, spawned, opts);
    },
    opts.undoable === false ? { undoable: false } : undefined,
  );
  if (spawned === undefined) throw new Error("ice: spawnWidget — transaction did not spawn.");
  return spawned;
}
