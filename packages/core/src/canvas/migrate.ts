/** CanvasType semantic migrations — bounded, frame-scoped, and view-independent. */
import {
  defineQuery,
  valueEquals,
  type Component,
  type Entity,
  type Relation,
  type Resource,
  type Tag,
  type World,
} from "@vibecook/strata-ecs";
import type { DurableStore } from "@vibecook/strata-ecs/durable";
import { BoardRoot, ChildOf } from "../catalog/scene";
import { guardedTransaction } from "../guards/guarded-tx";
import { PrefabId } from "../schema/prefab";
import { schemaMeta } from "../schema/meta";
import type { DocVersionReport } from "../doc/version-gate";
import {
  ROOT_CANVAS_META_KEY,
  canvasPackId,
  encodeCanvasIdentity,
  type CanvasType,
} from "./define-canvas-type";
import type { EngineCatalog } from "./engine-catalog";
import {
  frameBehaviorPackId,
  type CanvasReadFacet,
  type CanvasSemanticMigration,
} from "./extensions";

const PACK_PREFIX = "engine.pack.";
const durableQ = defineQuery([PrefabId]);

type MigrationOp =
  | { readonly kind: "set"; readonly entity: Entity; readonly component: Component; readonly value: unknown }
  | { readonly kind: "remove"; readonly entity: Entity; readonly component: Component }
  | { readonly kind: "set-relation"; readonly entity: Entity; readonly relation: Relation; readonly target: Entity }
  | { readonly kind: "remove-relation"; readonly entity: Entity; readonly relation: Relation; readonly target?: Entity };

function partitionFacets(facets: readonly CanvasReadFacet[]): {
  components: Set<Component>;
  tags: Set<Tag>;
  relations: Set<Relation>;
  resources: Set<Resource>;
} {
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

function framesFor(
  store: DurableStore,
  world: World,
  catalog: EngineCatalog,
  report: DocVersionReport,
  canvas: CanvasType,
): Entity[] {
  const frames: Entity[] = [];
  const root = world.getResource(BoardRoot)?.root;
  if (root !== undefined && report.rootCanvas?.id === canvas.id) frames.push(root);
  // Migrations are solo-open, one-shot work; a full durable walk here is
  // deliberately outside every steady-state path.
  world.query(durableQ).each((batch) => {
    for (const row of batch) {
      const entity = batch.entity(row);
      const typeId = world.read(entity, PrefabId).id;
      if (
        typeof typeId === "string" &&
        catalog.widget(typeId)?.container?.canvasTypeId === canvas.id
      ) {
        frames.push(entity);
      }
    }
  });
  const unique = [...new Set(frames)];
  unique.sort((a, b) => {
    const ka = String(store.keyOf(a) ?? a);
    const kb = String(store.keyOf(b) ?? b);
    return ka.localeCompare(kb);
  });
  return unique;
}

function validFrame(world: World, catalog: EngineCatalog, entity: Entity): boolean {
  const root = world.getResource(BoardRoot)?.root;
  if (entity === root) return true;
  const typeId = world.get(entity, PrefabId)?.id;
  return typeof typeId === "string" && catalog.widget(typeId)?.container !== undefined;
}

function planFrame(
  world: World,
  catalog: EngineCatalog,
  canvas: CanvasType,
  migration: CanvasSemanticMigration,
  frame: Entity,
): MigrationOp[] {
  const children = world
    .getReverse(frame, ChildOf)
    .filter((entity) => world.isAlive(entity) && world.get(entity, PrefabId) !== undefined);
  const scope = new Set<Entity>([frame, ...children]);
  const reads = partitionFacets(migration.reads ?? []);
  const writeComponents = new Set<Component>();
  const writeRelations = new Set<Relation>();
  for (const output of migration.writes ?? []) {
    if (schemaMeta.component(output as Component) !== undefined) writeComponents.add(output as Component);
    else if (schemaMeta.relation(output as Relation) !== undefined) writeRelations.add(output as Relation);
  }
  const ops: MigrationOp[] = [];
  const assertScoped = (entity: Entity): void => {
    if (!scope.has(entity) || !world.isAlive(entity)) {
      throw new Error(
        `ice: CanvasType "${canvas.id}" migration addressed an entity outside its direct frame scope.`,
      );
    }
  };
  const assertComponentRead = (component: Component): void => {
    if (!reads.components.has(component)) {
      throw new Error(`ice: CanvasType "${canvas.id}" migration read an undeclared component.`);
    }
  };
  const assertRelationRead = (relation: Relation): void => {
    if (!reads.relations.has(relation)) {
      throw new Error(`ice: CanvasType "${canvas.id}" migration read an undeclared relation.`);
    }
  };
  migration.migrate({
    canvasTypeId: canvas.id,
    from: migration.from,
    to: migration.to,
    frame,
    children: Object.freeze([...children]),
    read(entity, component) {
      assertScoped(entity);
      assertComponentRead(component);
      return world.read(entity, component);
    },
    get(entity, component) {
      assertScoped(entity);
      assertComponentRead(component);
      return world.get(entity, component);
    },
    hasTag(entity, tag) {
      assertScoped(entity);
      if (!reads.tags.has(tag)) {
        throw new Error(`ice: CanvasType "${canvas.id}" migration read an undeclared tag.`);
      }
      return world.hasTag(entity, tag);
    },
    getRelation(entity, relation) {
      assertScoped(entity);
      assertRelationRead(relation);
      const target = world.getRelation(entity, relation);
      return target !== undefined && scope.has(target) ? target : undefined;
    },
    getRelations(entity, relation) {
      assertScoped(entity);
      assertRelationRead(relation);
      return world.getRelations(entity, relation).filter((target) => scope.has(target));
    },
    getReverse(entity, relation) {
      assertScoped(entity);
      assertRelationRead(relation);
      return world.getReverse(entity, relation).filter((source) => scope.has(source));
    },
    getResource(resource) {
      if (!reads.resources.has(resource)) {
        throw new Error(`ice: CanvasType "${canvas.id}" migration read an undeclared resource.`);
      }
      return world.getResource(resource);
    },
    set(entity, component, value) {
      assertScoped(entity);
      if (entity === world.getResource(BoardRoot)?.root) {
        throw new Error("ice: CanvasType migrations cannot add mutable settings to BoardRoot.");
      }
      if (!writeComponents.has(component)) {
        throw new Error(`ice: CanvasType "${canvas.id}" migration wrote an undeclared component.`);
      }
      ops.push({ kind: "set", entity, component, value });
    },
    remove(entity, component) {
      assertScoped(entity);
      if (!writeComponents.has(component)) {
        throw new Error(`ice: CanvasType "${canvas.id}" migration removed an undeclared component.`);
      }
      ops.push({ kind: "remove", entity, component });
    },
    setRelation(entity, relation, target) {
      assertScoped(entity);
      if (!scope.has(target) || !writeRelations.has(relation)) {
        throw new Error(`ice: CanvasType "${canvas.id}" migration wrote an undeclared/cross-frame relation.`);
      }
      ops.push({ kind: "set-relation", entity, relation, target });
    },
    removeRelation(entity, relation, target) {
      assertScoped(entity);
      if (!writeRelations.has(relation) || (target !== undefined && !scope.has(target))) {
        throw new Error(`ice: CanvasType "${canvas.id}" migration removed an undeclared/cross-frame relation.`);
      }
      ops.push({ kind: "remove-relation", entity, relation, ...(target === undefined ? {} : { target }) });
    },
    reparent(entity, targetFrame) {
      assertScoped(entity);
      if (!writeRelations.has(ChildOf) || !world.isAlive(targetFrame) || !validFrame(world, catalog, targetFrame)) {
        throw new Error(`ice: CanvasType "${canvas.id}" migration attempted an undeclared/invalid frame repair.`);
      }
      ops.push({ kind: "set-relation", entity, relation: ChildOf, target: targetFrame });
    },
  });
  return ops;
}

function applyOps(store: DurableStore, world: World, ops: readonly MigrationOp[]): void {
  guardedTransaction(
    store,
    world,
    (tx) => {
      for (const op of ops) {
        switch (op.kind) {
          case "set": {
            const current = world.get(op.entity, op.component);
            if (current !== undefined && valueEquals(op.component, current, op.value)) break;
            if (current === undefined) tx.addComponent(op.entity, op.component, op.value);
            else tx.edit(op.entity).set(op.component, op.value);
            break;
          }
          case "remove":
            if (world.has(op.entity, op.component)) tx.removeComponent(op.entity, op.component);
            break;
          case "set-relation":
            if (world.getRelation(op.entity, op.relation) !== op.target) {
              tx.setRelation(op.entity, op.relation, op.target);
            }
            break;
          case "remove-relation":
            if (
              op.target === undefined
                ? world.getRelation(op.entity, op.relation) !== undefined
                : world.getRelations(op.entity, op.relation).includes(op.target)
            ) {
              tx.removeRelation(op.entity, op.relation, op.target);
            }
            break;
        }
      }
    },
    { undoable: false, meta: { origin: "canvas-migration" } },
  );
}

export interface CanvasMigrationOutcome {
  readonly migrated: readonly string[];
  readonly skipped: readonly string[];
}

/**
 * Run semantic steps after structural/prefab normalization. Each step plans
 * every bound frame before writing, then stamps its reached version last.
 */
export function runCanvasSemanticMigrations(
  store: DurableStore,
  world: World,
  catalog: EngineCatalog,
  initialReport: DocVersionReport,
): CanvasMigrationOutcome {
  const migrated: string[] = [];
  const skipped: string[] = [];
  let report = initialReport;

  for (const canvas of catalog.canvasTypeDefs()) {
    const packId = canvasPackId(canvas.id);
    let version = report.docPacks[packId];
    if (version === undefined || version >= canvas.semanticVersion) continue;
    const byFrom = new Map((canvas.migrations ?? []).map((step) => [step.from, step] as const));
    let contiguous = true;
    for (let cursor = version; cursor < canvas.semanticVersion; cursor++) {
      if (byFrom.get(cursor)?.to !== cursor + 1) {
        contiguous = false;
        break;
      }
    }
    if (!contiguous) {
      skipped.push(canvas.id);
      continue;
    }

    while (version < canvas.semanticVersion) {
      const migration = byFrom.get(version) as CanvasSemanticMigration;
      world.sync();
      const frames = framesFor(store, world, catalog, report, canvas);
      const ops = frames.flatMap((frame) => planFrame(world, catalog, canvas, migration, frame));
      applyOps(store, world, ops);
      world.sync();

      const reached = migration.to;
      store.metaTransaction((meta) => {
        const marker = `${PACK_PREFIX}${packId}.${reached}`;
        if (meta.get(marker) === undefined) meta.set(marker, true);
        if (report.rootCanvas?.id === canvas.id) {
          meta.set(
            ROOT_CANVAS_META_KEY,
            encodeCanvasIdentity({ id: canvas.id, semanticVersion: reached }),
          );
        }
        if (reached === canvas.semanticVersion) {
          for (const behavior of catalog.frameBehaviorsFor(canvas.id)) {
            const behaviorMarker =
              `${PACK_PREFIX}${frameBehaviorPackId(behavior.id)}.${behavior.version}`;
            if (meta.get(behaviorMarker) === undefined) meta.set(behaviorMarker, true);
          }
        }
      });
      version = reached;
      report = {
        ...report,
        docPacks: { ...report.docPacks, [packId]: reached },
        ...(report.rootCanvas?.id === canvas.id
          ? { rootCanvas: { id: canvas.id, semanticVersion: reached } }
          : {}),
      };
    }
    migrated.push(canvas.id);
  }
  return { migrated, skipped };
}
