/**
 * Matrix-test fixtures (M2 sovereignty exit gate).
 *
 * This suite is the INDEPENDENT write-path matrix for design-001 §2/§3 — it does
 * not import the engine's own catalog (parallel work); it declares its own "mx:*"
 * schema through @ice/core's meta wrappers so the guards see real ComponentMeta.
 *
 * strata's schema registry is process-global and `names.define` THROWS on a
 * duplicate name, so every component/tag/relation/resource is defined ONCE here at
 * module scope. Prefabs, by contrast, live in @ice/core's own registry which
 * `__resetPrefabsForTests()` clears between tests — so prefab definitions belong in the
 * tests (via {@link defineStdPrefabs}), re-registered fresh each run.
 */
import { LoroDoc } from "loro-crdt";
import { createWorld, field } from "@vibecook/strata-ecs";
import type { Entity, Tag, World } from "@vibecook/strata-ecs";
import { attachDurable, createDurableStore } from "@vibecook/strata-ecs/durable";
import type { DurableStore } from "@vibecook/strata-ecs/durable";
import { defineComponent, defineRelation, defineResource, defineTag } from "../src/schema/meta";
import { definePrefab, type ComponentInit, type Prefab } from "../src/schema/prefab";
import { instantiate } from "../src/engine/instantiate";
import type { EphSpawner } from "../src/engine/instantiate";

// --- schema (declared once; "mx:" namespaced so it can't collide with the catalog) ---

/** Essential geometry cell — required x/y (no default), like the real Position (design-001 §5.1). */
export const mxPosition = defineComponent("mx:Position", { x: "f64", y: "f64" });
/** Durable-OPTIONAL eligible cell (attachable later via tx). */
export const mxRotation = defineComponent("mx:Rotation", { r: "f32" });
/** A component with a REQUIRED (no-default) field — for the missing-required-field validation. */
export const mxReq = defineComponent("mx:Req", { v: "f32" });
/** Carries an `eid` field — banned in durable cells (design-001 §2 rule 3). */
export const mxHasEid = defineComponent("mx:HasEid", { ref: "eid" });
/** A runtime rider component (rule 2) AND a non-eligible durable component (rule 3). */
export const mxRider = defineComponent("mx:Rider", { n: field("f32", { default: 0 }) });
/** Ephemeral presence facet (components + tags only). */
export const mxPresenceInfo = defineComponent("mx:PresenceInfo", {
  name: field("string", { default: "" }),
  color: field("string", { default: "" }),
});

/** Essential tag on the durable box prefab. */
export const mxWidgetTag = defineTag("mx:WidgetTag");
/** Runtime rider tag (Selected-like) — never durable. */
export const mxSelected = defineTag("mx:Selected");
/** Essential tag on the ephemeral prefab. */
export const mxPresenceTag = defineTag("mx:PresenceTag");

/** Durable-eligible relation on the box prefab. */
export const mxChildOf = defineRelation("mx:ChildOf", { arity: "one" });
/** A relation the box prefab does NOT declare eligible (rule 3) + illegal on ephemeral (rule 1). */
export const mxFollows = defineRelation("mx:Follows", { arity: "one" });

/** Durable-declared resource (opts.durable = true) — legal in a tx. */
export const mxDurableRes = defineResource("mx:Background", { color: field("string", { default: "" }) }, { durable: true });
/** Runtime-declared resource (durable defaults false) — illegal in a tx. */
export const mxRuntimeRes = defineResource("mx:Camera", { zoom: field("f32", { default: 1 }) });

/** The standard prefab trio, registered fresh (call AFTER `__resetPrefabsForTests()`). */
export interface StdPrefabs {
  box: Prefab;
  cursor: Prefab;
  presence: Prefab;
}

export function defineStdPrefabs(): StdPrefabs {
  const box = definePrefab("mx:box", {
    store: "durable",
    components: [[mxPosition, { x: 0, y: 0 }]],
    tags: [mxWidgetTag],
    optional: [mxRotation],
    relations: [mxChildOf],
  });
  const cursor = definePrefab("mx:cursor", {
    store: "runtime",
    owner: "derive",
    components: [[mxPosition, { x: 0, y: 0 }]],
  });
  const presence = definePrefab("mx:presence", {
    store: "ephemeral",
    components: [[mxPresenceInfo, { name: "me", color: "#fff" }]],
    tags: [mxPresenceTag],
  });
  return { box, cursor, presence };
}

// --- durable plumbing helpers ---

export function makeStore(peerId?: number): DurableStore {
  const doc = new LoroDoc();
  if (peerId !== undefined) doc.setPeerId(peerId);
  return createDurableStore(doc);
}

export interface AttachedWorld {
  world: World;
  store: DurableStore;
  detach: () => void;
}

export function attachWorld(peerId?: number): AttachedWorld {
  const store = makeStore(peerId);
  const world = createWorld();
  const att = attachDurable(world, store);
  return { world, store, detach: att.detach };
}

/** Spawn a durable prefab through the tx route and land its projection — returns the placed handle. */
export function makeDurableBox(world: World, store: DurableStore, box: Prefab, overrides?: readonly ComponentInit[]): Entity {
  const e = store.transaction((tx) => instantiate(box, { into: "tx", tx }, overrides));
  world.sync();
  return e;
}

/** A recording stub for the ephemeral store's write surface (no real presence store needed). */
export interface EphStub {
  eph: EphSpawner;
  calls: { spawn: number; addTag: number; lastComponents: readonly ComponentInit[]; tags: Tag[] };
}

export function makeEphStub(): EphStub {
  const calls: EphStub["calls"] = { spawn: 0, addTag: 0, lastComponents: [], tags: [] };
  const fake = 1 as unknown as Entity; // the stub's identity is never dereferenced
  const eph: EphSpawner = {
    spawn(init) {
      calls.spawn += 1;
      calls.lastComponents = init?.components ?? [];
      return fake;
    },
    addTag(_e, t) {
      calls.addTag += 1;
      calls.tags.push(t);
    },
  };
  return { eph, calls };
}

/** Narrow an optional to its value or throw — keeps tests free of `!` non-null assertions. */
export function must<T>(v: T | undefined, msg = "expected a value, got undefined"): T {
  if (v === undefined) throw new Error(msg);
  return v;
}
