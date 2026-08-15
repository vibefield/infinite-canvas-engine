/**
 * `createBehaviorHarness` — the testing story, shipped WITH the framework
 * rather than after it (design-009 §7).
 *
 * A behavior is frame-cadence, collaboration-native, transaction-writing code.
 * Testing that without a rig means standing up an engine, a document, a
 * pipeline and a hand-driven clock — enough ceremony that most authors would
 * simply not test the interesting parts. The interesting parts are exactly the
 * ones they will get wrong:
 *
 *   - `claim(e)` fakes a live gesture claim, so an author can see their derived
 *     behavior go quiet during a drag and coalesce at the settle. Suppression
 *     is the single most surprising rule in the framework.
 *   - `pair()` gives a SECOND engine on the same document. Convergence bugs are
 *     invisible on one peer by definition, and "it works for me" is what a
 *     collaborative editor's bug reports look like.
 *   - `commits` records what actually reached the store, which is how you tell
 *     "the differ dropped it" from "it never ran".
 */
import { createWorld, defineQuery, type Entity, type Query, type World } from "@vibecook/strata-ecs";
import { Captures, ChildOf, GestureActive, Position, Size } from "../catalog";
import { createEngine, type Engine } from "../engine/engine";
import { createDocSession, openDocSession, type DocSession } from "../doc/doc-kit";
import { guardedTransaction } from "../guards/guarded-tx";
import { definePrefab, init, prefabs, type Prefab } from "../schema/prefab";
import { createBehaviorRuntime, type BehaviorRuntime, type BehaviorSession } from "./runtime";
import type { AnyBehaviorDef } from "./types";

/** One commit the harness observed reaching the store. */
export interface HarnessCommit {
  readonly undoable: boolean;
  /** `{ behavior, label }` for a `ctx.commit`; undefined for anything else. */
  readonly meta: Record<string, unknown> | undefined;
}

export interface BehaviorHarnessOpts {
  /**
   * Attach a document. Default TRUE — durable behaviors need one, and a
   * runtime behavior is unharmed by having it. `false` exercises the doc-less
   * path deliberately (where `ctx.commit` refuses, by design).
   */
  readonly docs?: boolean;
  /** Extra behaviors to register beside the one under test. */
  readonly also?: readonly AnyBehaviorDef[];
}

export interface BehaviorHarness {
  readonly world: World;
  readonly engine: Engine;
  readonly runtime: BehaviorRuntime;
  doc(): DocSession | undefined;
  /** Drive `n` frames (default 1). The clock advances 16ms per frame. */
  step(n?: number): void;
  /** A bare durable node with Position + Size, for behaviors to ride. */
  spawn(x?: number, y?: number): Entity;
  /** Attach the behavior under test — durable through a transaction, else direct. */
  attach(e: Entity, data?: Record<string, unknown>): void;
  detach(e: Entity): void;
  /** The behavior's live instances, as the runtime sees them. */
  instances(): readonly Entity[];
  /** Every commit that reached the store since construction. */
  readonly commits: readonly HarnessCommit[];
  /** Simulate a live gesture claim on `e`. Returns the release. */
  claim(e: Entity): () => void;
  /** A SECOND engine on this document — the two-peer rig. */
  pair(): BehaviorHarness;
  /** Exchange updates with every paired harness, both ways. */
  sync(): void;
  dispose(): void;
}

const HARNESS_PREFAB_ID = "ice.harness.node";

function harnessPrefab(): Prefab {
  return (
    prefabs.get(HARNESS_PREFAB_ID) ??
    definePrefab(HARNESS_PREFAB_ID, {
      store: "durable",
      components: [init(Position, { x: 0, y: 0 }), init(Size, { w: 100, h: 100 })],
      relations: [ChildOf],
    })
  );
}

export function createBehaviorHarness(b: AnyBehaviorDef, opts: BehaviorHarnessOpts = {}): BehaviorHarness {
  const peers: BehaviorHarness[] = [];
  const root = build(b, opts, peers, undefined);
  peers.push(root);
  return root;
}

function build(
  b: AnyBehaviorDef,
  opts: BehaviorHarnessOpts,
  peers: BehaviorHarness[],
  seed: Uint8Array | undefined,
): BehaviorHarness {
  const world = createWorld();
  const engine = createEngine(world);
  const commits: HarnessCommit[] = [];
  let session: DocSession | undefined;

  if (opts.docs !== false) {
    if (seed === undefined) {
      session = createDocSession(world);
    } else {
      const opened = openDocSession(world, seed);
      if (!opened.ok) throw new Error(`ice: behavior harness pair() could not open the seed doc — ${opened.reason}`);
      session = opened.session;
    }
  }

  // The recording shim: `ctx.commit` is the only way a behavior reaches the
  // document, so wrapping the store's transaction is how the harness can say
  // "nothing was committed" — a claim the differ makes constantly and that no
  // amount of reading final values can confirm.
  const view: BehaviorSession | undefined =
    session === undefined
      ? undefined
      : ({
          get readOnly() {
            return session?.readOnly ?? true;
          },
          get liveWriter() {
            return session?.liveWriter;
          },
          store: {
            transaction: (fn: never, o?: { undoable?: boolean; meta?: Record<string, unknown> }) => {
              commits.push({ undoable: o?.undoable !== false, meta: o?.meta });
              return session?.store.transaction(fn as never, o as never);
            },
            keyOf: (e: Entity) => session?.store.keyOf(e),
            resolve: (k: never) => session?.store.resolve(k),
            getComponent: (e: Entity, c: never) => session?.store.getComponent(e, c),
            get snapshot() {
              // `snapshot` is on the store CLASS, not the published
              // `DurableStore` interface — the behavior marker family reads
              // through it (behavior/migrate.ts), so the harness forwards it.
              return (session?.store as unknown as { snapshot?: unknown } | undefined)?.snapshot;
            },
            metaTransaction: (fn: never) => session?.store.metaTransaction(fn as never),
          },
        } as unknown as BehaviorSession);

  const runtime = createBehaviorRuntime({
    world,
    engine,
    session: () => view,
    onLog: () => {},
  });
  for (const extra of opts.also ?? []) runtime.register(extra);
  runtime.register(b);

  let clock = 0;
  const prefab = harnessPrefab();

  const harness: BehaviorHarness = {
    world,
    engine,
    runtime,
    commits,
    doc: () => session,

    step(n = 1) {
      for (let i = 0; i < n; i++) {
        clock += 16;
        engine.step(clock);
      }
    },

    spawn(x = 0, y = 0) {
      if (session === undefined) {
        return world.spawn({ components: [[Position, { x, y }], [Size, { w: 100, h: 100 }]] });
      }
      let e: Entity | undefined;
      guardedTransaction(
        session.store,
        world,
        (tx) => {
          e = tx.spawnPrefab(prefab, [[Position, { x, y }]]);
        },
        { undoable: false },
      );
      world.sync(); // the spawn projects at the next sync
      return e as Entity;
    },

    attach(e, data) {
      if (b.store !== "durable") {
        runtime.attach(e, b, data);
        return;
      }
      if (session === undefined) throw new Error("ice: behavior harness — a durable behavior needs docs: true.");
      session.store.transaction((tx) => {
        tx.addComponent(e, b.component, { ...(b.defaults as Record<string, unknown>), ...(data ?? {}) });
      });
      world.sync();
    },

    detach(e) {
      if (b.store !== "durable") {
        runtime.detach(e, b);
        return;
      }
      session?.store.transaction((tx) => tx.removeComponent(e, b.component));
      world.sync();
    },

    instances() {
      const out: Entity[] = [];
      // Read through the world rather than the runtime's private registry: a
      // test asserting on instances should see what the WORLD says, or it can
      // pass while the two have quietly disagreed.
      for (const e of allEntitiesWith(world, b)) out.push(e);
      return out;
    },

    claim(e) {
      // The engine's own claim shape: an ACTIVE recognizer that `Captures` the
      // target. Discrete claims deliberately do not count (design-001 §3).
      const recognizer = world.spawn({});
      world.setRelation(recognizer, Captures, e);
      world.addTag(recognizer, GestureActive);
      return () => {
        if (world.isAlive(recognizer)) world.destroy(recognizer);
      };
    },

    pair() {
      if (session === undefined) throw new Error("ice: behavior harness pair() needs a document (docs: true).");
      const bytes = session.exportEnvelope();
      const peer = build(b, opts, peers, bytes);
      peers.push(peer);
      return peer;
    },

    sync() {
      // Full-snapshot exchange, both ways, until every peer has seen every
      // other. Crude next to a real transport and exactly right for a rig: the
      // property under test is convergence, not the wire.
      for (const from of peers) {
        const src = from.doc();
        if (src === undefined) continue;
        const bytes = src.exportSnapshot();
        for (const to of peers) {
          if (to === from) continue;
          to.doc()?.applyRemote(bytes);
        }
      }
      for (const peer of peers) peer.world.sync();
    },

    dispose() {
      runtime.dispose();
      session?.close();
      session = undefined;
      const i = peers.indexOf(harness);
      if (i !== -1) peers.splice(i, 1);
    },
  };

  return harness;
}

function allEntitiesWith(world: World, b: AnyBehaviorDef): Entity[] {
  const out: Entity[] = [];
  world.query(behaviorQuery(b)).each((batch) => {
    for (const row of batch) out.push(batch.entity(row));
  });
  return out;
}

// Cached on the handle: `defineQuery` identity is strata's own cache key for
// the matched-archetype list, so re-compiling per call defeats two caches.
const queryCache = new WeakMap<object, Query>();
function behaviorQuery(b: AnyBehaviorDef): Query {
  let q = queryCache.get(b as object);
  if (q === undefined) {
    q = defineQuery([b.component]);
    queryCache.set(b as object, q);
  }
  return q;
}
