/** Current-frame CanvasRuntimeExtension dispatcher and fault/output governor. */
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
import { ChildOf, Position } from "../catalog/scene";
import type { Engine } from "../engine/engine";
import { PrefabId } from "../schema/prefab";
import { schemaMeta } from "../schema/meta";
import type { CanvasSessionValue } from "./session";
import type { EngineCatalog } from "./engine-catalog";
import type {
  CanvasReadFacet,
  CanvasRuntimeExtension,
  CanvasRuntimeExtensionContext,
} from "./extensions";

interface Facets {
  readonly components: Set<Component>;
  readonly tags: Set<Tag>;
  readonly relations: Set<Relation>;
  readonly resources: Set<Resource>;
}

interface PriorOutput {
  readonly present: boolean;
  readonly value: unknown;
}

interface Activation {
  readonly extension: CanvasRuntimeExtension;
  readonly facets: Facets;
  readonly collector: ChangeCollector;
  readonly controller: AbortController;
  readonly unsubs: (() => void)[];
  readonly prior: Map<Component, Map<Entity, PriorOutput>>;
  full: boolean;
  externalDirty: boolean;
}

export interface CanvasRuntimeExtensionHost {
  /** Force output teardown at the synchronous authority cut. */
  invalidate(): void;
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

function sessionKey(session: CanvasSessionValue): string {
  return `${session.documentEpoch}:${session.epoch}`;
}

export function installCanvasRuntimeExtensions(opts: {
  readonly world: World;
  readonly engine: Engine;
  readonly catalog: EngineCatalog;
  readonly session: () => CanvasSessionValue;
}): CanvasRuntimeExtensionHost {
  const { world, engine, catalog } = opts;
  const used = new Map<string, CanvasRuntimeExtension>();
  for (const canvas of catalog.canvasTypeDefs()) {
    for (const extension of catalog.runtimeExtensionsFor(canvas.id)) {
      used.set(extension.id, extension);
    }
  }
  if (used.size === 0) return { invalidate() {}, dispose() {} };

  const driven = new Map(
    [...used.values()].map((extension) => [
      extension.id,
      engine.guests.addDriven({
        id: `canvas-runtime:${extension.id}`,
        ...(extension.budgetMs === undefined ? {} : { budgetMs: extension.budgetMs }),
      }),
    ] as const),
  );
  let activeKey = "";
  let activations: Activation[] = [];
  let disposed = false;

  const restoreOutputs = (activation: Activation): void => {
    for (const [component, entities] of activation.prior) {
      for (const [entity, prior] of entities) {
        if (!world.isAlive(entity)) continue;
        if (prior.present) {
          const current = world.get(entity, component);
          if (current === undefined || !valueEquals(component, current, prior.value)) {
            world.edit(entity).set(component, prior.value);
          }
        } else if (world.has(entity, component)) {
          world.removeComponent(entity, component);
        }
      }
    }
    activation.prior.clear();
  };

  const deactivate = (): void => {
    for (const activation of activations) {
      restoreOutputs(activation);
      activation.collector.dispose();
      for (const unsub of activation.unsubs) unsub();
      activation.controller.abort();
    }
    activations = [];
    activeKey = "";
  };

  const makeActivation = (extension: CanvasRuntimeExtension): Activation => {
    const facets = partition(extension.reads);
    const components = [...new Set<Component>([PrefabId, Position, ...facets.components])];
    const activation: Activation = {
      extension,
      facets,
      collector: world.changes.collect({
        components,
        ...(facets.tags.size === 0 ? {} : { tags: [...facets.tags] }),
        coarse: false,
      }),
      controller: new AbortController(),
      unsubs: [],
      prior: new Map(),
      full: true,
      externalDirty: false,
    };
    for (const relation of facets.relations) {
      const query = defineQuery([Related(relation)]);
      activation.unsubs.push(
        world.reactive.observeQuery(query, () => {
          activation.externalDirty = true;
        }),
      );
    }
    for (const resource of facets.resources) {
      activation.unsubs.push(
        world.reactive.observeResource(resource, () => {
          activation.externalDirty = true;
        }),
      );
    }
    return activation;
  };

  const ensureSession = (): (CanvasSessionValue & { readonly state: "attached" }) | undefined => {
    const current = opts.session();
    const key = sessionKey(current);
    if (key === activeKey) {
      return current.state === "attached"
        ? (current as CanvasSessionValue & { readonly state: "attached" })
        : undefined;
    }
    deactivate();
    activeKey = key;
    if (current.state !== "attached") return undefined;
    activations = catalog.runtimeExtensionsFor(current.typeId).map(makeActivation);
    return current as CanvasSessionValue & { readonly state: "attached" };
  };

  const removeDepartedOutputs = (activation: Activation, scope: ReadonlySet<Entity>): void => {
    for (const [component, entities] of activation.prior) {
      for (const [entity, prior] of [...entities]) {
        if (scope.has(entity)) continue;
        entities.delete(entity);
        if (!world.isAlive(entity)) continue;
        if (prior.present) world.edit(entity).set(component, prior.value);
        else if (world.has(entity, component)) world.removeComponent(entity, component);
      }
    }
  };

  const runActivation = (
    activation: Activation,
    session: CanvasSessionValue & { readonly state: "attached" },
  ): void => {
    const delta = activation.collector.drain();
    const children = world
      .getReverse(session.frame, ChildOf)
      .filter((entity) => world.isAlive(entity) && world.get(entity, PrefabId) !== undefined);
    const scope = new Set<Entity>([session.frame, ...children]);
    removeDepartedOutputs(activation, scope);
    const changed = delta.changed.filter((entity) => scope.has(entity));
    const full = activation.full || delta.reset || delta.coarse.length > 0;
    const shouldRun = full || activation.externalDirty || changed.length > 0 || delta.removed.length > 0;
    activation.full = false;
    activation.externalDirty = false;
    if (!shouldRun) return;

    const { extension, facets } = activation;
    const assertEntity = (entity: Entity): void => {
      if (!scope.has(entity) || !world.isAlive(entity)) {
        throw new Error(
          `ice: CanvasRuntimeExtension "${extension.id}" addressed an entity outside the active direct frame.`,
        );
      }
    };
    const context: CanvasRuntimeExtensionContext = {
      session,
      frame: session.frame,
      children: Object.freeze([...children]),
      changes: { full, changed: Object.freeze([...changed]), removed: Object.freeze([...delta.removed]) },
      signal: activation.controller.signal,
      read(entity, component) {
        assertEntity(entity);
        if (!facets.components.has(component)) {
          throw new Error(`ice: CanvasRuntimeExtension "${extension.id}" read an undeclared component.`);
        }
        return world.read(entity, component);
      },
      get(entity, component) {
        assertEntity(entity);
        if (!facets.components.has(component)) {
          throw new Error(`ice: CanvasRuntimeExtension "${extension.id}" read an undeclared component.`);
        }
        return world.get(entity, component);
      },
      hasTag(entity, tag) {
        assertEntity(entity);
        if (!facets.tags.has(tag)) {
          throw new Error(`ice: CanvasRuntimeExtension "${extension.id}" read an undeclared tag.`);
        }
        return world.hasTag(entity, tag);
      },
      getRelation(entity, relation) {
        assertEntity(entity);
        if (!facets.relations.has(relation)) {
          throw new Error(`ice: CanvasRuntimeExtension "${extension.id}" read an undeclared relation.`);
        }
        const target = world.getRelation(entity, relation);
        return target !== undefined && scope.has(target) ? target : undefined;
      },
      getRelations(entity, relation) {
        assertEntity(entity);
        if (!facets.relations.has(relation)) {
          throw new Error(`ice: CanvasRuntimeExtension "${extension.id}" read an undeclared relation.`);
        }
        return world.getRelations(entity, relation).filter((target) => scope.has(target));
      },
      getReverse(entity, relation) {
        assertEntity(entity);
        if (!facets.relations.has(relation)) {
          throw new Error(`ice: CanvasRuntimeExtension "${extension.id}" read an undeclared relation.`);
        }
        return world.getReverse(entity, relation).filter((source) => scope.has(source));
      },
      getResource(resource) {
        if (!facets.resources.has(resource)) {
          throw new Error(`ice: CanvasRuntimeExtension "${extension.id}" read an undeclared resource.`);
        }
        return world.getResource(resource);
      },
      set(entity, component, value) {
        assertEntity(entity);
        if (!extension.writesRuntime.includes(component)) {
          throw new Error(`ice: CanvasRuntimeExtension "${extension.id}" wrote an undeclared output.`);
        }
        let entities = activation.prior.get(component);
        if (entities === undefined) {
          entities = new Map();
          activation.prior.set(component, entities);
        }
        if (!entities.has(entity)) {
          entities.set(entity, {
            present: world.has(entity, component),
            value: world.get(entity, component),
          });
        }
        const current = world.get(entity, component);
        if (current !== undefined && valueEquals(component, current, value)) return;
        if (current === undefined) world.addComponent(entity, component, value);
        else world.edit(entity).set(component, value);
      },
      remove(entity, component) {
        assertEntity(entity);
        if (!extension.writesRuntime.includes(component)) {
          throw new Error(`ice: CanvasRuntimeExtension "${extension.id}" removed an undeclared output.`);
        }
        if (world.has(entity, component)) world.removeComponent(entity, component);
      },
    };
    const returned: unknown = extension.run(context);
    if (typeof (returned as { then?: unknown } | null | undefined)?.then === "function") {
      throw new Error(`ice: CanvasRuntimeExtension "${extension.id}" returned a thenable.`);
    }
  };

  const removeDispatcher = engine.guests.add({
    id: "canvas-runtime:dispatcher",
    make: () => ({
      run() {
        const session = ensureSession();
        if (session?.state !== "attached") return;
        for (const activation of activations) {
          const breaker = driven.get(activation.extension.id);
          const ok = breaker?.run(() => runActivation(activation, session)) ?? false;
          if (!ok) restoreOutputs(activation);
        }
      },
      dispose: deactivate,
    }),
  });

  return {
    invalidate: deactivate,
    dispose() {
      if (disposed) return;
      disposed = true;
      removeDispatcher();
      deactivate();
      for (const breaker of driven.values()) breaker.remove();
      driven.clear();
    },
  };
}
