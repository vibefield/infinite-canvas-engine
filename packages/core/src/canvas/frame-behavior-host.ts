/** View-independent, dirt-routed semantic FrameBehavior host. */
import {
  Related,
  defineQuery,
  valueEquals,
  type ChangeCollector,
  type Component,
  type Entity,
  type Relation,
  type Resource,
  type Tag,
  type World,
} from "@vibecook/strata-ecs";
import { BoardRoot, ChildOf, Position } from "../catalog/scene";
import type { DocSession } from "../doc/doc-kit";
import { gateVerdict } from "../doc/version-gate";
import type { Engine } from "../engine/engine";
import { guardedTransaction } from "../guards/guarded-tx";
import { PrefabId } from "../schema/prefab";
import { schemaMeta } from "../schema/meta";
import { canvasPackId } from "./define-canvas-type";
import type { EngineCatalog } from "./engine-catalog";
import {
  frameBehaviorPackId,
  type CanvasReadFacet,
  type FrameBehavior,
  type FrameBehaviorWriteContext,
} from "./extensions";

const durableQ = defineQuery([PrefabId]);

interface Facets {
  readonly components: Set<Component>;
  readonly tags: Set<Tag>;
  readonly relations: Set<Relation>;
  readonly resources: Set<Resource>;
}

type FrameOp =
  | { readonly kind: "set"; readonly entity: Entity; readonly component: Component; readonly value: unknown }
  | { readonly kind: "remove"; readonly entity: Entity; readonly component: Component }
  | { readonly kind: "set-relation"; readonly entity: Entity; readonly relation: Relation; readonly target: Entity }
  | { readonly kind: "remove-relation"; readonly entity: Entity; readonly relation: Relation; readonly target?: Entity };

interface BehaviorState {
  readonly behavior: FrameBehavior;
  readonly canvasIds: ReadonlySet<string>;
  readonly facets: Facets;
  readonly collector: ChangeCollector;
  readonly unsubs: (() => void)[];
  readonly pending: Set<Entity>;
  readonly ownerByEntity: Map<Entity, Entity>;
  externalDirty: boolean;
  full: boolean;
  faulted: boolean;
}

export interface FrameBehaviorHost {
  isCanvasWritable(canvasTypeId: string): boolean;
  dispose(): void;
}

function partition(facets: readonly CanvasReadFacet[]): Facets {
  const components = new Set<Component>();
  const tags = new Set<Tag>();
  const relations = new Set<Relation>();
  const resources = new Set<Resource>();
  for (const facet of facets) {
    if (schemaMeta.component(facet as Component) !== undefined) components.add(facet as Component);
    else if (schemaMeta.tagName(facet as Tag) !== undefined) tags.add(facet as Tag);
    else if (schemaMeta.relation(facet as Relation) !== undefined) relations.add(facet as Relation);
    else if (schemaMeta.resource(facet as Resource) !== undefined) resources.add(facet as Resource);
  }
  return { components, tags, relations, resources };
}

function canvasForFrame(
  world: World,
  catalog: EngineCatalog,
  session: DocSession,
  frame: Entity,
): string | undefined {
  const root = world.getResource(BoardRoot)?.root;
  if (frame === root) return session.versionReport().rootCanvas?.id;
  const typeId = world.get(frame, PrefabId)?.id;
  return typeof typeId === "string" ? catalog.canvasForContainer(typeId)?.id : undefined;
}

function validFrame(world: World, catalog: EngineCatalog, frame: Entity): boolean {
  if (!world.isAlive(frame)) return false;
  if (frame === world.getResource(BoardRoot)?.root) return true;
  const typeId = world.get(frame, PrefabId)?.id;
  return typeof typeId === "string" && catalog.widget(typeId)?.container !== undefined;
}

function stableFrames(store: DocSession["store"], frames: Iterable<Entity>): Entity[] {
  return [...new Set(frames)].sort((a, b) => {
    const ka = String(store.keyOf(a) ?? a);
    const kb = String(store.keyOf(b) ?? b);
    return ka.localeCompare(kb);
  });
}

export function installFrameBehaviors(opts: {
  readonly world: World;
  readonly engine: Engine;
  readonly catalog: EngineCatalog;
  readonly session: () => DocSession | undefined;
  readonly onAvailabilityChange?: () => void;
}): FrameBehaviorHost {
  const { world, engine, catalog } = opts;
  const used = new Map<string, { behavior: FrameBehavior; canvasIds: Set<string> }>();
  for (const canvas of catalog.canvasTypeDefs()) {
    for (const behavior of catalog.frameBehaviorsFor(canvas.id)) {
      const entry = used.get(behavior.id) ?? { behavior, canvasIds: new Set<string>() };
      entry.canvasIds.add(canvas.id);
      used.set(behavior.id, entry);
    }
  }
  if (used.size === 0) return { isCanvasWritable: () => true, dispose() {} };

  const states = new Map<string, BehaviorState>();
  const breakers = new Map<string, ReturnType<Engine["guests"]["addDriven"]>>();

  for (const { behavior, canvasIds } of used.values()) {
    const facets = partition(behavior.reads);
    const state: BehaviorState = {
      behavior,
      canvasIds,
      facets,
      collector: world.changes.collect({
        components: [...new Set<Component>([PrefabId, Position, ...facets.components])],
        ...(facets.tags.size === 0 ? {} : { tags: [...facets.tags] }),
        coarse: false,
      }),
      unsubs: [],
      pending: new Set(),
      ownerByEntity: new Map(),
      externalDirty: false,
      full: true,
      faulted: false,
    };
    for (const relation of facets.relations) {
      state.unsubs.push(
        world.reactive.observeQuery(defineQuery([Related(relation)]), () => {
          state.externalDirty = true;
        }),
      );
    }
    for (const resource of facets.resources) {
      state.unsubs.push(
        world.reactive.observeResource(resource, () => {
          state.externalDirty = true;
        }),
      );
    }
    states.set(behavior.id, state);
    breakers.set(
      behavior.id,
      engine.guests.addDriven({
        id: `frame-behavior:${behavior.id}`,
        budgetMs: behavior.budget.ms,
        busy: () => state.pending.size > 0 || state.full || state.faulted,
      }),
    );
  }

  const markAllFrames = (state: BehaviorState, session: DocSession): void => {
    const root = world.getResource(BoardRoot)?.root;
    if (
      root !== undefined &&
      state.canvasIds.has(session.versionReport().rootCanvas?.id ?? "")
    ) {
      state.pending.add(root);
    }
    world.query(durableQ).each((batch) => {
      for (const row of batch) {
        const entity = batch.entity(row);
        const typeId = world.read(entity, PrefabId).id;
        const canvasId = typeof typeId === "string" ? catalog.canvasForContainer(typeId)?.id : undefined;
        if (canvasId !== undefined && state.canvasIds.has(canvasId)) state.pending.add(entity);
        const parent = world.getRelation(entity, ChildOf);
        if (parent !== undefined) state.ownerByEntity.set(entity, parent);
      }
    });
  };

  const routeEntity = (state: BehaviorState, session: DocSession, entity: Entity): void => {
    if (!world.isAlive(entity)) {
      const prior = state.ownerByEntity.get(entity);
      if (prior !== undefined) state.pending.add(prior);
      state.ownerByEntity.delete(entity);
      return;
    }
    const parent = world.getRelation(entity, ChildOf);
    if (parent !== undefined) {
      const previous = state.ownerByEntity.get(entity);
      if (previous !== undefined && previous !== parent) state.pending.add(previous);
      state.ownerByEntity.set(entity, parent);
      if (validFrame(world, catalog, parent)) state.pending.add(parent);
    }
    if (validFrame(world, catalog, entity)) {
      const canvasId = canvasForFrame(world, catalog, session, entity);
      if (canvasId !== undefined && state.canvasIds.has(canvasId)) state.pending.add(entity);
    }
  };

  const drainState = (state: BehaviorState, session: DocSession): void => {
    const delta = state.collector.drain();
    if (state.full || state.externalDirty || delta.reset || delta.coarse.length > 0) {
      markAllFrames(state, session);
      state.full = false;
      state.externalDirty = false;
    }
    for (const entity of delta.changed) routeEntity(state, session, entity);
    for (const entity of delta.removed) routeEntity(state, session, entity);
  };

  const planFrame = (
    state: BehaviorState,
    session: DocSession,
    frame: Entity,
    canvasTypeId: string,
  ): FrameOp[] => {
    const children = world
      .getReverse(frame, ChildOf)
      .filter((entity) => world.isAlive(entity) && world.get(entity, PrefabId) !== undefined);
    if (children.length > state.behavior.budget.entities) {
      throw new Error(
        `ice: FrameBehavior "${state.behavior.id}" frame exceeds its ` +
          `${state.behavior.budget.entities}-entity budget.`,
      );
    }
    const scope = new Set<Entity>([frame, ...children]);
    const ops: FrameOp[] = [];
    const assertEntity = (entity: Entity): void => {
      if (!scope.has(entity) || !world.isAlive(entity)) {
        throw new Error(
          `ice: FrameBehavior "${state.behavior.id}" addressed an entity outside its direct frame.`,
        );
      }
    };
    const context: FrameBehaviorWriteContext = {
      canvasTypeId,
      frame,
      children: Object.freeze([...children]),
      read(entity, component) {
        assertEntity(entity);
        if (!state.facets.components.has(component)) {
          throw new Error(`ice: FrameBehavior "${state.behavior.id}" read an undeclared component.`);
        }
        return world.read(entity, component);
      },
      get(entity, component) {
        assertEntity(entity);
        if (!state.facets.components.has(component)) {
          throw new Error(`ice: FrameBehavior "${state.behavior.id}" read an undeclared component.`);
        }
        return world.get(entity, component);
      },
      hasTag(entity, tag) {
        assertEntity(entity);
        if (!state.facets.tags.has(tag)) {
          throw new Error(`ice: FrameBehavior "${state.behavior.id}" read an undeclared tag.`);
        }
        return world.hasTag(entity, tag);
      },
      getRelation(entity, relation) {
        assertEntity(entity);
        if (!state.facets.relations.has(relation)) {
          throw new Error(`ice: FrameBehavior "${state.behavior.id}" read an undeclared relation.`);
        }
        const target = world.getRelation(entity, relation);
        return target !== undefined && scope.has(target) ? target : undefined;
      },
      getRelations(entity, relation) {
        assertEntity(entity);
        if (!state.facets.relations.has(relation)) {
          throw new Error(`ice: FrameBehavior "${state.behavior.id}" read an undeclared relation.`);
        }
        return world.getRelations(entity, relation).filter((target) => scope.has(target));
      },
      getReverse(entity, relation) {
        assertEntity(entity);
        if (!state.facets.relations.has(relation)) {
          throw new Error(`ice: FrameBehavior "${state.behavior.id}" read an undeclared relation.`);
        }
        return world.getReverse(entity, relation).filter((source) => scope.has(source));
      },
      getResource(resource) {
        if (!state.facets.resources.has(resource)) {
          throw new Error(`ice: FrameBehavior "${state.behavior.id}" read an undeclared resource.`);
        }
        return world.getResource(resource);
      },
      set(entity, component, value) {
        assertEntity(entity);
        if (entity === world.getResource(BoardRoot)?.root) {
          throw new Error("ice: FrameBehavior cannot add mutable state to BoardRoot.");
        }
        if (!state.behavior.writesDurable.includes(component)) {
          throw new Error(`ice: FrameBehavior "${state.behavior.id}" wrote an undeclared component.`);
        }
        ops.push({ kind: "set", entity, component, value });
      },
      remove(entity, component) {
        assertEntity(entity);
        if (!state.behavior.writesDurable.includes(component)) {
          throw new Error(`ice: FrameBehavior "${state.behavior.id}" removed an undeclared component.`);
        }
        ops.push({ kind: "remove", entity, component });
      },
      setRelation(entity, relation, target) {
        assertEntity(entity);
        if (!scope.has(target) || !state.behavior.writesRelations.includes(relation)) {
          throw new Error(`ice: FrameBehavior "${state.behavior.id}" wrote an undeclared/cross-frame relation.`);
        }
        ops.push({ kind: "set-relation", entity, relation, target });
      },
      removeRelation(entity, relation, target) {
        assertEntity(entity);
        if (
          !state.behavior.writesRelations.includes(relation) ||
          (target !== undefined && !scope.has(target))
        ) {
          throw new Error(`ice: FrameBehavior "${state.behavior.id}" removed an undeclared/cross-frame relation.`);
        }
        ops.push({ kind: "remove-relation", entity, relation, ...(target === undefined ? {} : { target }) });
      },
    };
    const returned: unknown = state.behavior.run(context);
    if (typeof (returned as { then?: unknown } | null | undefined)?.then === "function") {
      throw new Error(`ice: FrameBehavior "${state.behavior.id}" returned a thenable.`);
    }
    return ops;
  };

  const applyOps = (state: BehaviorState, session: DocSession, ops: readonly FrameOp[]): void => {
    const effective = ops.filter((op) => {
      switch (op.kind) {
        case "set": {
          const current = world.get(op.entity, op.component);
          return current === undefined || !valueEquals(op.component, current, op.value);
        }
        case "remove":
          return world.has(op.entity, op.component);
        case "set-relation":
          return world.getRelation(op.entity, op.relation) !== op.target;
        case "remove-relation":
          return op.target === undefined
            ? world.getRelation(op.entity, op.relation) !== undefined
            : world.getRelations(op.entity, op.relation).includes(op.target);
      }
    });
    if (effective.length === 0) return;
    guardedTransaction(
      session.store,
      world,
      (tx) => {
        for (const op of effective) {
          switch (op.kind) {
            case "set":
              if (world.has(op.entity, op.component)) tx.edit(op.entity).set(op.component, op.value);
              else tx.addComponent(op.entity, op.component, op.value);
              break;
            case "remove":
              tx.removeComponent(op.entity, op.component);
              break;
            case "set-relation":
              tx.setRelation(op.entity, op.relation, op.target);
              break;
            case "remove-relation":
              tx.removeRelation(op.entity, op.relation, op.target);
              break;
          }
        }
      },
      {
        undoable: false,
        live: session.liveWriter,
        keyOf: (entity) => session.store.keyOf(entity) as string | undefined,
        meta: { origin: `frame-behavior:${state.behavior.id}` },
      },
    );
  };

  const availabilityChanged = (state: BehaviorState, next: boolean): void => {
    if (state.faulted === next) return;
    state.faulted = next;
    opts.onAvailabilityChange?.();
  };

  const removeDispatcher = engine.guests.add({
    id: "frame-behavior:dispatcher",
    make: () => ({
      run() {
        const session = opts.session();
        if (
          session === undefined ||
          session.readOnly ||
          gateVerdict(session.versionReport()) !== "ok"
        ) {
          for (const state of states.values()) state.full = true;
          return;
        }
        // Canvas-local topological order is already compiled. Iterating the
        // catalog order here means a downstream behavior drains after an
        // upstream behavior's same-frame guarded transaction.
        const ordered: BehaviorState[] = [];
        const seen = new Set<string>();
        for (const canvas of catalog.canvasTypeDefs()) {
          for (const behavior of catalog.frameBehaviorsFor(canvas.id)) {
            if (seen.has(behavior.id)) continue;
            seen.add(behavior.id);
            const state = states.get(behavior.id);
            if (state !== undefined) ordered.push(state);
          }
        }
        for (const state of ordered) {
          drainState(state, session);
          const frames = stableFrames(session.store, state.pending);
          for (const frame of frames) {
            if (!validFrame(world, catalog, frame)) {
              state.pending.delete(frame);
              continue;
            }
            const canvasId = canvasForFrame(world, catalog, session, frame);
            if (canvasId === undefined || !state.canvasIds.has(canvasId)) {
              state.pending.delete(frame);
              continue;
            }
            const report = session.versionReport();
            const canvas = catalog.canvasType(canvasId);
            if (
              canvas === undefined ||
              report.docPacks[canvasPackId(canvasId)] !== canvas.semanticVersion ||
              report.docPacks[frameBehaviorPackId(state.behavior.id)] !== state.behavior.version
            ) {
              continue;
            }
            const breaker = breakers.get(state.behavior.id);
            const ok = breaker?.run(() => {
              const ops = planFrame(state, session, frame, canvasId);
              applyOps(state, session, ops);
            }) ?? false;
            if (ok) {
              state.pending.delete(frame);
              availabilityChanged(state, false);
            } else {
              availabilityChanged(state, true);
              break;
            }
          }
        }
      },
      dispose() {
        for (const state of states.values()) {
          state.collector.clear();
          state.pending.clear();
          state.ownerByEntity.clear();
          state.full = true;
        }
      },
      busy: () => [...states.values()].some((state) => state.pending.size > 0),
    }),
  });

  return {
    isCanvasWritable(canvasTypeId) {
      for (const behavior of catalog.frameBehaviorsFor(canvasTypeId)) {
        const state = states.get(behavior.id);
        const breaker = breakers.get(behavior.id);
        if (state?.faulted === true || breaker?.suspended() === true) return false;
      }
      return true;
    },
    dispose() {
      removeDispatcher();
      for (const state of states.values()) {
        state.collector.dispose();
        for (const unsub of state.unsubs) unsub();
      }
      for (const breaker of breakers.values()) breaker.remove();
      states.clear();
      breakers.clear();
    },
  };
}
