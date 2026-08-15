/**
 * `defineBehavior` — the type surface (design-009 §3–§4, the pinned API).
 *
 * ICE's userland surface is a triad: `defineWidget` (faces) · **behaviors**
 * (logic + state) · `defineTool` (input policy). A behavior is the A-Frame-class
 * unit — ONE named declaration carrying a data schema, a REQUIRED store class,
 * and lifecycle hooks the engine runs on a curated phase set.
 *
 * `store:` is the load-bearing word: it routes where data lives, who sees it,
 * what survives, WHICH WRITE VOCABULARY the hooks receive, at which cadence.
 * That last routing is the reason the ctx types below are three interfaces and
 * not one with optional members — a durable behavior must not see `ctx.write`
 * in autocomplete at all, or "store routes everything" is a doc claim rather
 * than a property of the product.
 */
import type { Component, Entity, Relation, Resource, Tag } from "@vibecook/strata-ecs";
import type { GuardedTx } from "../guards/guarded-tx";
import type {
  BooleanSpec,
  EntityKeySpec,
  EnumSpec,
  JsonSpec,
  NumberSpec,
  PropSpec,
  StringSpec,
} from "../widget/props";

// --- store class + phases ----------------------------------------------------

export type BehaviorStore = "durable" | "runtime" | "ephemeral";

/**
 * The CURATED phase set (design-009 §4.4, BF-D8) — a deliberate subset of the
 * eleven pipeline groups. Authors get the four that mean something to logic;
 * the control sweep (`ctl:*`), `input`, `react` and `cleanup` stay engine
 * vocabulary. `publish` is not a pipeline group at all — it is the post-tick
 * slot where ephemeral mutation is legal.
 */
export type BehaviorPhase = "simulate" | "derive" | "present" | "publish";

/** Legal `phase` per store class — the §4.1 validation table, as data. */
export const BEHAVIOR_PHASES: Readonly<Record<BehaviorStore, readonly BehaviorPhase[]>> = {
  // Durable is derive-ONLY and the reason is stated: its sole write path is
  // transactional, and `derive` is the settled-input phase — the one place a
  // commit reads inputs that will not move again this frame.
  durable: ["derive"],
  runtime: ["simulate", "derive", "present", "publish"],
  ephemeral: ["publish"],
};

/** Default phase per store (the one most declarations want). */
export const BEHAVIOR_DEFAULT_PHASE: Readonly<Record<BehaviorStore, BehaviorPhase>> = {
  durable: "derive",
  runtime: "simulate",
  ephemeral: "publish",
};

// --- schema → data typing ----------------------------------------------------

/** A behavior's declared data: the SAME `p.*` DSL `defineWidget` uses. */
export type BehaviorSchema = Readonly<Record<string, PropSpec>>;

type ValueOfSpec<S extends PropSpec> = S extends NumberSpec
  ? number
  : S extends BooleanSpec
    ? boolean
    : S extends EnumSpec
      ? string
      : S extends JsonSpec
        ? unknown
        : S extends StringSpec | EntityKeySpec
          ? string
          : never;

/**
 * The hook-facing data view. `p.json` fields arrive PARSED (the cell is a
 * string; the snapshot carries the value) — parsing happens once per delivery,
 * and delivery only runs on change, so the cost is keyed to churn rather than
 * to frame rate. `ctx.write`/`tx.write` serialize back.
 */
export type DataOf<Sch extends BehaviorSchema> = { readonly [K in keyof Sch]: ValueOfSpec<Sch[K]> };

// --- reads ------------------------------------------------------------------

/**
 * Anything a behavior may declare in `reads:` — components, tags, relations,
 * resources, or another behavior (its data component). Each kind is routed to
 * a different change mechanism by the compiler (§5.2), which is why the
 * partition is compiler work and not an author concern.
 */
export type BehaviorRead = Component | Tag | Relation | Resource | AnyBehaviorDef;

/** The drained journal summary, valid only for the duration of the hook call. */
export interface BehaviorChanges {
  /** Rebuild everything: first run, `world.reset()`, coarse writes, or a poll fired. */
  readonly full: boolean;
  /** Journaled entities — re-read current state to act. */
  readonly changed: readonly Entity[];
  /** DESTROYED entities (packed handles; safe as removal keys). */
  readonly removed: readonly Entity[];
}

// --- the world wrapper -------------------------------------------------------

/**
 * `ctx.world` is a HOST-BUILT WRAPPER, not a `World` alias and not
 * `ReadonlyWorld` (BF-D19): that type is `Omit<World, WorldMutatorName>`, which
 * keeps `.runtime` — the full mutable store — so it is a naming convention, not
 * a sandbox. This interface exposes exactly the read surface and nothing else.
 *
 * Honesty note: point reads through this wrapper are ATTRIBUTION-ONLY — strata
 * enforces declared reads solely at `batch.col()`, so the compiled delivery
 * walk (`ctx.query`) is where enforcement is real.
 */
export interface BehaviorWorld {
  read<S>(e: Entity, c: Component<S>): S;
  get<S>(e: Entity, c: Component<S>): S | undefined;
  readField<S, K extends keyof S & string>(e: Entity, c: Component<S>, field: K): S[K] | undefined;
  has(e: Entity, c: Component): boolean;
  hasTag(e: Entity, t: Tag): boolean;
  getRelation(e: Entity, r: Relation): Entity | undefined;
  getRelations(e: Entity, r: Relation): Entity[];
  getReverse(e: Entity, r: Relation): Entity[];
  /** Sibling-sequence version for one parent — ordered relations (petition 8). */
  orderStamp(parent: Entity, r: Relation): number;
  getResource<S>(res: Resource<S>): S | undefined;
  componentsOf(e: Entity): readonly Component[];
  tagsOf(e: Entity): readonly Tag[];
  isAlive(e: Entity): boolean;
}

/** A reads-scoped query walk. Terms are restricted to the behavior's `reads`. */
export interface BehaviorQuery {
  /** Every matching entity. The array is FRESH per call — retaining it is legal. */
  entities(): Entity[];
  /** Iterate matches one at a time (no array allocated). */
  each(fn: (e: Entity) => void): void;
  /** First match, or undefined. */
  first(): Entity | undefined;
}

/** Query terms a behavior may build — its declared reads, positively or negatively. */
export interface BehaviorQuerySpec {
  /** Entities must carry ALL of these (components/tags from `reads`). */
  readonly all?: readonly (Component | Tag | AnyBehaviorDef)[];
  /** Entities must carry NONE of these. */
  readonly none?: readonly (Component | Tag | AnyBehaviorDef)[];
}

// --- ctx --------------------------------------------------------------------

/** Frame facts a `tick` hook reads. */
export interface BehaviorFrame {
  readonly dtMs: number;
  readonly tick: number;
  /** Accumulated CLAMPED dt — under-reports across freezes; never wall time. */
  readonly clock: number;
}

/** One remote peer's facet of an ephemeral behavior (`ctx.peers()`). */
export interface PeerFacet<Data> {
  /** The remote presence-peer entity (runtime handle — do not persist). */
  readonly entity: Entity;
  readonly data: Readonly<Data>;
}

export interface BehaviorCtxBase<Data> {
  /** The read wrapper (above). */
  readonly world: BehaviorWorld;
  /**
   * A reads-SCOPED query. The framework compiles and caches one Query per
   * distinct spec and walks it ATTRIBUTED — strata's only enforced read path,
   * and its only zero-allocation bulk path. Without this, navigation was
   * instances-outward only and `changed` got abused as a discovery channel.
   *
   * The navigation model, stated: behaviors navigate from their instances
   * outward via relations, the change journal, and reads-scoped queries. There
   * is no global search.
   */
  query(spec: BehaviorQuerySpec): BehaviorQuery;
  /** This behavior's own instances, this frame (snapshot — do not retain). */
  entities(): readonly Entity[];
  /** The drained journal summary. Meaningful during `changed`; do not retain. */
  changes(): BehaviorChanges;
  /** The journal ∩ this behavior's instances — the exact set. Do not retain. */
  changedEntities(): readonly Entity[];
  /** Durable doc key for an entity (undefined when not doc-bound). */
  keyOf(e: Entity): string | undefined;
  /** The entity for a durable key — undefined while it is not yet projected. */
  entityFor(key: string): Entity | undefined;
  /** Aborts at generation teardown (`world.reset`), detach, or engine dispose. */
  readonly signal: AbortSignal;
  /** Namespaced logging — routed to the host's diagnostics, never raw console. */
  log(message: string, ...rest: readonly unknown[]): void;
}

export interface DurableBehaviorCtx<Data> extends BehaviorCtxBase<Data> {
  /**
   * ONE labeled transaction. The transaction opens INSIDE the hook, in-system
   * (design-002-blessed): values land synchronously and this frame's `notify`
   * sees them — never queued past the tick. `label` is a stable MACHINE id
   * (namespaced), never display text: it feeds undo and in-CRDT provenance.
   *
   * Refuses on a read-only document. `tx.setResource` is MASKED (the §9
   * resource-write fence, made mechanical) — a behavior calling it DEV-throws
   * naming the `singleton` v1.1 seam.
   */
  commit(label: string, fn: (tx: BehaviorTx<Data>) => void, opts?: { undoable?: boolean }): void;
}

export interface RuntimeBehaviorCtx<Data> extends BehaviorCtxBase<Data> {
  /** Write this behavior's OWN data on `e` (immediate; session-local). */
  write(e: Entity, patch: Partial<Data>): void;
  /** Write a declared runtime-store `writes:` target (immediate). */
  set<S>(e: Entity, c: Component<S>, v: S): void;
  attach(e: Entity, data?: Partial<Data>): void;
  detach(e: Entity): void;
  /** A runtime behavior may also commit durable state (a settle writing finals once). */
  commit(label: string, fn: (tx: BehaviorTx<Data>) => void, opts?: { undoable?: boolean }): void;
}

export interface EphemeralBehaviorCtx<Data> extends BehaviorCtxBase<Data> {
  /**
   * Publish THIS PEER's facet. No entity argument — the instance IS the local
   * presence peer, and there is exactly one. Legal here because ephemeral hooks
   * run at the publish slot, post-tick, where eph mutation is allowed.
   */
  write(patch: Partial<Data>): void;
  /** REMOTE peers' facets of this behavior (read-only; `Not(Local)` projections). */
  peers(): readonly PeerFacet<Data>[];
}

export type BehaviorCtxFor<S extends BehaviorStore, Data> = S extends "durable"
  ? DurableBehaviorCtx<Data>
  : S extends "runtime"
    ? RuntimeBehaviorCtx<Data>
    : EphemeralBehaviorCtx<Data>;

/**
 * The door's transaction: `GuardedTx` plus behavior attachment and typed
 * own-data writes. `setResource` is absent by construction (§4.4's mask).
 */
export interface BehaviorTx<Data> extends Omit<GuardedTx, "setResource"> {
  /** Write this behavior's own data on `e` (absolute, whole-value). */
  write(e: Entity, patch: Partial<Data>): void;
  /** Attach a behavior as a DOCUMENT op — syncs, undoes, runs on every peer. */
  attach<D>(e: Entity, behavior: BehaviorHandle<D>, data?: Partial<D>): void;
  detach(e: Entity, behavior: AnyBehaviorDef): void;
}

// --- hooks -------------------------------------------------------------------

export interface BehaviorHooks<S extends BehaviorStore, Data> {
  /**
   * Instance appeared: attached locally, projected in (REMOTE included), or
   * existing at generation start. Runs before that instance's first `tick`.
   * A throw here marks the INSTANCE failed — no further hooks until re-attach.
   */
  init?(e: Entity, data: Readonly<Data>, ctx: BehaviorCtxFor<S, Data>): void;
  /**
   * OWN declared data changed since the last delivery — by ANY writer: this
   * behavior's commit, another plugin's tx, UNDO, or a remote peer.
   * Per-instance; `prev` is the last-delivered snapshot. "update is about you."
   */
  update?(e: Entity, data: Readonly<Data>, prev: Readonly<Data>, ctx: BehaviorCtxFor<S, Data>): void;
  /**
   * The reads-set changed. ONCE PER BEHAVIOR per frame, not per instance —
   * N instances × one tag flip must not mean N journal scans.
   * "changed is about the world."
   */
  changed?(ctx: BehaviorCtxFor<S, Data>): void;
  /**
   * Per frame per instance — OPT-IN cost. Default is ALL instances (Law 14: an
   * off-screen spring still settles); `tick: { while: "visible" }` is the
   * author's DECLARED suspension. `init`/`update`/`changed`/`dispose` never
   * suspend: culling is not lifecycle, and state must be right the moment it
   * becomes visible again.
   */
  tick?(e: Entity, data: Readonly<Data>, frame: BehaviorFrame, ctx: BehaviorCtxFor<S, Data>): void;
  /**
   * Instance gone: detached, despawned, disabled, or generation end. `e` may
   * already be dead (world access is DEV-guarded) — this is for cache cleanup.
   * Runs for ALL instances BEFORE `ctx.signal` aborts.
   */
  dispose?(e: Entity, ctx: BehaviorCtxFor<S, Data>): void;
}

// --- the declaration ---------------------------------------------------------

export interface BehaviorSpec<S extends BehaviorStore, Sch extends BehaviorSchema> {
  /** REQUIRED — routes everything (§3). */
  readonly store: S;
  /**
   * This behavior's durable writes are COMPUTED from other state. Durable only.
   * Bundles three protections: non-undoable output, the differ, and
   * claim-scoped delivery suppression (§5.3).
   */
  readonly derived?: boolean;
  /**
   * Opt out of suppression: derive live during gestures (costs accepted).
   * `derived` only.
   */
  readonly deriveDuringGesture?: boolean;
  /** Durable only — the `engine.behavior.<name>.<v>` marker family (§5.6). */
  readonly version?: number;
  readonly schema?: Sch;
  /** Durable only: fromVersion → idempotent absolute transform. */
  readonly migrate?: Readonly<Record<number, (prev: Record<string, unknown>) => Record<string, unknown>>>;
  /** Defaults per store (§4.4); validated against the legal set. */
  readonly phase?: BehaviorPhase;
  /** Per-frame budget request, ms. The breaker caps it at the seam ceiling. */
  readonly budgetMs?: number;
  readonly reads?: readonly BehaviorRead[];
  readonly writes?: readonly Component[];
  /**
   * `tick` scope. `{ while: "visible" }` compiles a `Not(Culled)` term into the
   * chunked tick system — declared suspension, never discovered.
   */
  readonly tick?: { readonly while?: "visible" | "all" };
  readonly on?: BehaviorHooks<S, DataOf<Sch>>;
}

/** A behavior pre-attachment: `Layout.with({ gapX: 32 })`. */
export interface BehaviorAttachSpec<Data = Record<string, unknown>> {
  readonly behavior: BehaviorHandle<Data>;
  readonly data: Partial<Data>;
}

/**
 * The compiled declaration. Usable wherever a behavior is expected —
 * `reads: [Glow]`, `behaviors: [Layout]`, `tx.attach(e, Layout)` — plus
 * `.with(data)` for pre-attachment and `.component` for advanced read paths.
 */
export interface BehaviorHandle<Data> {
  /** `<namespace>:<name>` — the process-global identity. */
  readonly name: string;
  readonly namespace: string;
  readonly store: BehaviorStore;
  readonly derived: boolean;
  readonly deriveDuringGesture: boolean;
  readonly version: number;
  readonly phase: BehaviorPhase;
  readonly budgetMs: number | undefined;
  readonly schema: BehaviorSchema;
  /** The generated data component (`behavior:<name>`). Advanced read paths. */
  readonly component: Component<Record<string, string | number | boolean>>;
  /** Every field at its declared default (the attach fill). */
  readonly defaults: Readonly<Data>;
  readonly reads: readonly BehaviorRead[];
  readonly writes: readonly Component[];
  readonly migrate: Readonly<Record<number, (prev: Record<string, unknown>) => Record<string, unknown>>>;
  readonly tickWhile: "all" | "visible";
  /**
   * The hook set. MUTABLE by design: a same-shape re-definition (hot reload,
   * a test re-importing a module) refreshes these in place, so the cached
   * handle keeps its component and collector identity while the new code
   * actually runs. Stale-hook HMR is the wart this avoids.
   */
  on: BehaviorHooks<BehaviorStore, Data>;
  /** Pre-attachment with data: `behaviors: [Layout.with({ gapX: 32 })]`. */
  with(data: Partial<Data>): BehaviorAttachSpec<Data>;
  /** @internal brand — how `reads:` tells a behavior from a component. */
  readonly __behavior: true;
}

/** A behavior handle of unknown data shape (registries, `reads:` lists). */
// biome-ignore lint/suspicious/noExplicitAny: the registry is data-shape-agnostic by construction.
export type AnyBehaviorDef = BehaviorHandle<any>;
