/**
 * spawnWidget — the paved-road widget creation op (app handler, design-005 §2).
 *
 * One guardedTransaction: spawnPrefab with Position (+Size) overrides and any
 * prop overrides folded into their group components (whole-group values —
 * design-001 §5.2's conflict-group granularity). Validation runs through each
 * prop's Standard Schema before the write.
 */
import type { Entity, World } from "@vibecook/strata-ecs";
import type { DurableStore } from "@vibecook/strata-ecs/durable";
import { Position, Size } from "../catalog";
import { guardedTransaction } from "../guards/guarded-tx";
import { init, type ComponentInit } from "../schema/prefab";
import { widgets } from "./define-widget";

export interface SpawnWidgetOpts {
  readonly x: number;
  readonly y: number;
  readonly w?: number;
  readonly h?: number;
  readonly props?: Readonly<Record<string, unknown>>;
}

export function spawnWidget(
  store: DurableStore,
  world: World,
  type: string,
  opts: SpawnWidgetOpts,
): Entity {
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
        if (spec.kind === "json") value[name] = spec.default ?? "null";
        else if (spec.kind === "enum") value[name] = spec.default ?? spec.options[0] ?? "";
        else if (spec.kind === "string") value[name] = spec.default ?? "";
        else if (spec.kind === "number") value[name] = spec.default ?? 0;
        else value[name] = spec.default ?? false;
      }
    }
    overrides.push([g.component, value] as ComponentInit);
  }

  let spawned: Entity | undefined;
  guardedTransaction(store, world, (tx) => {
    spawned = tx.spawnPrefab(widget.prefab, overrides);
  });
  if (spawned === undefined) throw new Error("ice: spawnWidget — transaction did not spawn.");
  return spawned;
}
