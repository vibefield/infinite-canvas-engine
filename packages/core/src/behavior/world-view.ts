/**
 * `ctx.world` and `ctx.query` — the behavior read surface (design-009 §4.4,
 * BF-D19).
 *
 * `ctx.world` is a HOST-BUILT WRAPPER and that is a decision, not an
 * implementation shortcut. The obvious alternative — hand authors strata's
 * `ReadonlyWorld` — is not a sandbox: it is `Omit<World, WorldMutatorName>`,
 * which keeps `.runtime` (the full mutable store) and, being a type, erases at
 * runtime anyway. A wrapper object exposes exactly what it forwards.
 *
 * `ctx.query` closes the DISCOVERY hole. Without it a behavior could navigate
 * only outward from its own instances, and `changed` got abused as a discovery
 * channel — a journal is a terrible search index. Scoping the terms to the
 * declared `reads` keeps the access story honest, and walking through the
 * running system's `SystemCtx` means the walk is ATTRIBUTED: strata's only
 * ENFORCED read path and its only zero-allocation bulk path. Three arguments,
 * one mechanism.
 */
import { Not, defineQuery } from "@vibecook/strata-ecs";
import type { Component, Entity, Query, Relation, Resource, SystemCtx, Tag, World } from "@vibecook/strata-ecs";
import { devGuardsEnabled } from "../guards/dev";
import { schemaMeta } from "../schema/meta";
import type { AnyBehaviorDef, BehaviorQuery, BehaviorQuerySpec, BehaviorWorld } from "./types";

export function createBehaviorWorld(world: World): BehaviorWorld {
  return {
    read: (e, c) => world.read(e, c),
    get: (e, c) => world.get(e, c),
    readField: (e, c, f) => world.readField(e, c, f),
    has: (e, c) => world.has(e, c),
    hasTag: (e, t) => world.hasTag(e, t),
    getRelation: (e, r) => world.getRelation(e, r),
    getRelations: (e, r) => world.getRelations(e, r),
    getReverse: (e, r) => world.getReverse(e, r),
    orderStamp: (parent, r) => world.orderStamp(parent, r),
    getResource: (res) => world.getResource(res),
    componentsOf: (e) => world.componentsOf(e),
    tagsOf: (e) => world.tagsOf(e),
    isAlive: (e) => world.isAlive(e),
  };
}

/** Resolve a query term to its underlying handle (a behavior means its component). */
function termOf(t: Component | Tag | AnyBehaviorDef): Component | Tag {
  if (typeof t === "object" && t !== null && (t as AnyBehaviorDef).__behavior === true) {
    return (t as AnyBehaviorDef).component as Component;
  }
  return t as Component | Tag;
}

function termName(t: Component | Tag): string {
  return schemaMeta.component(t as Component)?.name ?? schemaMeta.tagName(t as Tag) ?? "<handle>";
}

/**
 * The compiled-query cache for one behavior. Keyed on the term identity list,
 * so the common case (a behavior calling `ctx.query` with the same spec every
 * frame) compiles ONCE — `defineQuery` identity is strata's own cache key for
 * the matched-archetype list, so re-compiling per call would defeat two caches.
 */
export function createQueryScope(behavior: AnyBehaviorDef, allowed: ReadonlySet<Component | Tag>) {
  const cache = new Map<string, Query>();
  let nextId = 0;
  const ids = new Map<Component | Tag, number>();
  const idOf = (t: Component | Tag): number => {
    let id = ids.get(t);
    if (id === undefined) {
      id = nextId++;
      ids.set(t, id);
    }
    return id;
  };

  const check = (t: Component | Tag): void => {
    if (!devGuardsEnabled() || allowed.has(t)) return;
    throw new Error(
      `ice: behavior "${behavior.name}" queried "${termName(t)}", which is not in its reads: — a behavior may only query what it declared (design-009 §4.4). Add it to reads:, or navigate from ctx.entities() instead.`,
    );
  };

  const compile = (spec: BehaviorQuerySpec): Query => {
    const all = (spec.all ?? []).map(termOf);
    const none = (spec.none ?? []).map(termOf);
    for (const t of all) check(t);
    for (const t of none) check(t);
    const key = `${all.map(idOf).join(",")}|${none.map(idOf).join(",")}`;
    let q = cache.get(key);
    if (q === undefined) {
      q = defineQuery([...all, ...none.map((t) => Not(t))]);
      cache.set(key, q);
    }
    return q;
  };

  /** Build the per-call query handle bound to the current walker. */
  return function scopedQuery(walker: BehaviorWalker, spec: BehaviorQuerySpec): BehaviorQuery {
    const q = compile(spec);
    return {
      entities() {
        const out: Entity[] = [];
        walker.each(q, (e) => out.push(e));
        return out;
      },
      each(fn) {
        walker.each(q, fn);
      },
      first() {
        return walker.first(q);
      },
    };
  };
}

/**
 * Where a behavior's walks and structural ops go, which depends on WHERE it is
 * running — and the difference is not cosmetic.
 *
 * In a pipeline phase the behavior is inside a system: walks go through
 * `SystemCtx` (attributed — strata's enforced read path), and structural ops
 * are DEFERRED to the phase boundary because immediate `world.*` structural
 * mutation throws at iteration depth > 0.
 *
 * At the publish slot there is no running system and no iteration bracket:
 * walks are plain `world.query` (unattributed — nothing to attribute them to),
 * and structural ops are immediate and legal. Ephemeral behaviors live here,
 * which is exactly why eph structural writes are legal for them and illegal
 * for everyone else.
 */
export interface BehaviorWalker {
  each(q: Query, fn: (e: Entity) => void): void;
  first(q: Query): Entity | undefined;
  addComponent(e: Entity, c: Component, v: unknown): void;
  removeComponent(e: Entity, c: Component): void;
}

export function systemWalker(ctx: SystemCtx): BehaviorWalker {
  return {
    each(q, fn) {
      ctx.query(q).each((b) => {
        for (const row of b) fn(b.entity(row));
      });
    },
    first: (q) => ctx.firstOf(q),
    addComponent: (e, c, v) => ctx.addComponent(e, c as Component<unknown>, v),
    removeComponent: (e, c) => ctx.removeComponent(e, c),
  };
}

export function publishWalker(world: World): BehaviorWalker {
  return {
    each(q, fn) {
      world.query(q).each((b) => {
        for (const row of b) fn(b.entity(row));
      });
    },
    first: (q) => world.firstOf(q),
    addComponent: (e, c, v) => world.addComponent(e, c as Component<unknown>, v),
    removeComponent: (e, c) => world.removeComponent(e, c),
  };
}

/** The term set a behavior may query: its own component ∪ declared components/tags. */
export function allowedQueryTerms(
  behavior: AnyBehaviorDef,
  readComponents: readonly Component[],
  readTags: readonly Tag[],
): ReadonlySet<Component | Tag> {
  const set = new Set<Component | Tag>([behavior.component as Component]);
  for (const c of readComponents) set.add(c);
  for (const t of readTags) set.add(t);
  return set;
}

export type { Relation, Resource };
