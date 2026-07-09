/**
 * Prefab instantiation — THE spawn routing (design-001 §2: the class is the
 * spawn path). Durable → tx · runtime → world/ctx · ephemeral → eph.
 * Every spawn stamps `PrefabId` (uniform identity for guards + devtools;
 * for durable prefabs it is the document identity stamp, §2 rule 5).
 */
import type { Component, Entity, SystemCtx, Tag, World } from "@vibecook/strata-ecs";
import type { Mutator } from "@vibecook/strata-ecs/durable";
import { PrefabId, type ComponentInit, type Prefab } from "../schema/prefab";

/** Structural shape of the ephemeral store's write surface (components+tags only). */
export interface EphSpawner {
  spawn(init?: { components?: readonly ComponentInit[] }): Entity;
  addTag(e: Entity, t: Tag): void;
}

export type SpawnTarget =
  | { into: "world"; world: World }
  | { into: "ctx"; ctx: SystemCtx }
  | { into: "tx"; tx: Mutator }
  | { into: "eph"; eph: EphSpawner };

function mergedComponents(prefab: Prefab, overrides?: readonly ComponentInit[]): ComponentInit[] {
  const out = new Map<Component, ComponentInit[1]>();
  for (const [c, v] of prefab.components) out.set(c, v);
  for (const [c, v] of overrides ?? []) {
    if (!prefab.eligible.has(c)) {
      throw new Error(
        `ice: instantiate("${prefab.id}"): override component is not in the prefab's eligible set.`,
      );
    }
    out.set(c, v);
  }
  out.set(PrefabId as Component, { id: prefab.id });
  return [...out.entries()].map(([c, v]) => [c, v] as const);
}

const ROUTE: Record<Prefab["store"], SpawnTarget["into"][]> = {
  durable: ["tx"],
  runtime: ["world", "ctx"],
  ephemeral: ["eph"],
};

export interface InstantiateOpts {
  /**
   * DRAFT spawn (design-001 §3, two-phase promote): a durable prefab spawned
   * into the runtime store — its cells are plain session data (not in the doc,
   * live writes free) until `promote` commits a durable twin. Explicit opt-in:
   * without it, durable→world/ctx throws (never a silent downgrade, §6.3).
   */
  draft?: boolean;
  overrides?: readonly ComponentInit[];
}

/**
 * Spawn a prefab into the correct store. Wrong-store spawns fail loudly —
 * notably: a durable prefab without an attached doc/tx has NO fallback
 * (design-001 §6.3: never a silent world.spawn downgrade).
 */
export function instantiate(
  prefab: Prefab,
  target: SpawnTarget,
  opts?: InstantiateOpts | readonly ComponentInit[],
): Entity {
  const norm: InstantiateOpts = Array.isArray(opts) ? { overrides: opts } : ((opts as InstantiateOpts | undefined) ?? {});
  const overrides = norm.overrides;
  const draftOk =
    norm.draft === true &&
    prefab.store === "durable" &&
    (target.into === "world" || target.into === "ctx");
  if (!ROUTE[prefab.store].includes(target.into) && !draftOk) {
    const extra = prefab.store === "durable" ? ", or world/ctx with { draft: true }" : "";
    throw new Error(
      `ice: instantiate("${prefab.id}"): a ${prefab.store} prefab cannot spawn into "${target.into}" (allowed: ${ROUTE[prefab.store].join(", ")}${extra}). The spawn path IS the sovereignty class (design-001 §2).`,
    );
  }
  const components = mergedComponents(prefab, overrides);
  const tags = prefab.tags ?? [];

  switch (target.into) {
    case "world": {
      const e = target.world.spawn({ components });
      for (const t of tags) target.world.addTag(e, t);
      return e;
    }
    case "ctx": {
      const e = target.ctx.spawn({ components });
      for (const t of tags) target.ctx.addTag(e, t);
      return e;
    }
    case "tx": {
      const e = target.tx.spawn({ components });
      for (const t of tags) target.tx.addTag(e, t);
      return e;
    }
    case "eph": {
      const e = target.eph.spawn({ components });
      for (const t of tags) target.eph.addTag(e, t);
      return e;
    }
  }
}
