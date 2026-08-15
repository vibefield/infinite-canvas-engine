/**
 * The behavior runtime (design-009 §4.3, §5.1, §5.2) — one delivery loop for
 * every behavior, compiled onto the guest breaker rather than beside it.
 *
 * Delivery order, per frame, at the behavior's phase:
 *
 *     drain → init (appeared) → update → changed → tick → dispose (departed)
 *
 * The instance list is a SNAPSHOT taken at phase entry, so a hook that attaches
 * or detaches affects the NEXT frame — the live-array lesson from the publish
 * and reflector loops, applied before it could bite here.
 *
 * TWO COLLECTORS, not one. Own-component churn and reads churn mean different
 * things to an author — "update is about you, changed is about the world" — and
 * a single collector cannot tell them apart after the drain, because the delta
 * reports ENTITIES, not which component moved. Merging them would fire
 * `changed` on every own-data write, which is exactly the hook authors put
 * expensive whole-graph work in. The cost of honesty is one extra drain.
 *
 * Change delivery rides strata's REAL change detection, which is why every
 * behavior is collaboration-native with zero author code: `applyRemote`
 * journals into collectors exactly like a local write, so `update` fires for a
 * remote peer's edit and for a local undo through the same path.
 */
import { Local, Not, defineQuery, type Query } from "@vibecook/strata-ecs";
import { valueEquals } from "@vibecook/strata-ecs";
import type {
  Batch,
  ChangeCollector,
  Component,
  Entity,
  Relation,
  Resource,
  SystemCtx,
  Tag,
  World,
} from "@vibecook/strata-ecs";
import type { DrivenGuest, GuestRegistry } from "../engine/guests";
import { Captures, Drags, GestureActive } from "../catalog/gesture";
import { FrameInfo } from "../engine/frame-info";
import type { PhaseGroup } from "../engine/pipeline";
import { devGuardsEnabled } from "../guards/dev";
import type { LiveWriter } from "../guards/live-writer";
import { guardedTransaction } from "../guards/guarded-tx";
import type { GuardedTx } from "../guards/guarded-tx";
import type { JsonSpec, PropSpec } from "../widget/props";
import { compileBehavior, type BehaviorSystemHooks, type CompiledBehavior } from "./compile";
import { diffOps, recordDerivedOps, replayOps } from "./differ";
import {
  allowedQueryTerms,
  createBehaviorWorld,
  createQueryScope,
  publishWalker,
  systemWalker,
  type BehaviorWalker,
} from "./world-view";
import type {
  AnyBehaviorDef,
  BehaviorChanges,
  BehaviorCtxBase,
  BehaviorFrame,
  BehaviorTx,
} from "./types";

/** The slice of a doc session the runtime needs (structural: tests fake it). */
export interface BehaviorSession {
  readonly readOnly: boolean;
  readonly liveWriter: LiveWriter;
  readonly store: {
    transaction(fn: (tx: never) => void, opts?: { undoable?: boolean }): void;
    keyOf(e: Entity): unknown;
    resolve(key: never): Entity | undefined;
    getComponent<S>(e: Entity, c: Component<S>): S | undefined;
  };
}

/**
 * The slice of a presence session an ephemeral behavior needs. Structural so
 * tests can fake it, and a FUNCTION on the opts so it can swap with the doc —
 * presence attaches and detaches with `docs.join`, and a behavior installed
 * before either must simply lie dormant until one exists.
 */
export interface BehaviorPresence {
  /** The local peer entity. A GETTER upstream: a world reset re-mints it. */
  readonly localPeer: Entity;
  readonly eph: {
    addComponent(e: Entity, c: Component<unknown>, v: unknown): void;
    removeComponent(e: Entity, c: Component): void;
    edit(e: Entity): { set(c: Component<unknown>, v: unknown): unknown };
  };
}

export interface BehaviorRuntimeOpts {
  readonly world: World;
  readonly engine: {
    addSystems(group: PhaseGroup, ...systems: readonly never[]): () => void;
    readonly guests: GuestRegistry;
    onPublish(hook: (world: World) => void): () => void;
  };
  /** The FORWARDING session seam — the target swaps per doc open/close. */
  readonly session?: () => BehaviorSession | undefined;
  /**
   * The presence seam. Absent (or returning undefined) leaves every ephemeral
   * behavior DORMANT — installed, costing nothing, publishing nothing. That is
   * honest state, not a failure: a presence-less engine has no peer to be.
   */
  readonly presence?: () => BehaviorPresence | undefined;
  readonly onLog?: (behavior: string, message: string, rest: readonly unknown[]) => void;
  /**
   * A contained hook fault. Defaults to `console.error`. Hosts route this: a
   * quarantined instance in a derived behavior means part of the document
   * silently stops updating, which reads to a user as a broken document.
   */
  readonly onFault?: (behavior: string, hook: string, entity: Entity | undefined, err: unknown) => void;
}

export interface BehaviorStatus {
  readonly name: string;
  readonly store: string;
  readonly phase: string;
  readonly instances: number;
  /** Instances quarantined by repeated hook throws (BF-D18). */
  readonly failed: number;
  readonly ticking: number;
  readonly suspended: boolean;
}

export interface BehaviorRuntime {
  /** Compile + install a behavior. Returns an uninstaller. */
  register(b: AnyBehaviorDef): () => void;
  registered(): readonly AnyBehaviorDef[];
  /** Runtime/ephemeral attach from OUTSIDE a hook (the facade surface). */
  attach(e: Entity, b: AnyBehaviorDef, data?: Record<string, unknown>): void;
  detach(e: Entity, b: AnyBehaviorDef): void;
  has(e: Entity, b: AnyBehaviorDef): boolean;
  read(e: Entity, b: AnyBehaviorDef): Record<string, unknown> | undefined;
  list(): readonly BehaviorStatus[];
  dispose(): void;
}

/** One entity's watched state at the moment a commit sealed (see `echo`). */
interface EchoSnapshot {
  readonly cells: readonly [Component, unknown][];
  readonly tags: readonly [Tag, boolean][];
}

/** How many consecutive throws quarantine ONE instance (BF-D18). */
const INSTANCE_THROW_LIMIT = 3;

/** Suppressed frames before the dev-warn names the behavior and the claimant. */
const SUPPRESSION_WARN_FRAMES = 600;

/**
 * Is `e` under a LIVE gesture claim right now?
 *
 * Deliberately NARROWER than `makeDefaultMayDiverge`: a `TransformTween` also
 * grants divergence, but a glide is not a gesture — suppressing derives for the
 * duration of every fly-back would stall exactly the reflow the fly-back is
 * waiting for.
 */
function isClaimed(world: World, e: Entity): boolean {
  if (!world.isAlive(e)) return false;
  for (const claimant of world.getReverse(e, Captures)) {
    if (world.hasTag(claimant, GestureActive)) return true;
  }
  for (const claimant of world.getReverse(e, Drags)) {
    if (world.hasTag(claimant, GestureActive)) return true;
  }
  return false;
}

/**
 * A patch → the ABSOLUTE whole-cell value a write commits (Law 5). Fields the
 * patch omits are read back off the entity when it already carries the
 * behavior, and only fall to the declared defaults when it does not — which is
 * what makes attach-when-attached an idempotent no-op that PRESERVES existing
 * data rather than resetting it.
 *
 * Module-scope on purpose: `tx.attach(e, Other)` may name a behavior this
 * engine never registered, and the earlier node-bound version silently fell
 * back to bare defaults there — clobbering the very data the idempotence rule
 * exists to protect.
 */
function cellForBehavior(
  world: World,
  b: AnyBehaviorDef,
  e: Entity | undefined,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const c = b.component as unknown as Component<Record<string, unknown>>;
  const carries = e !== undefined && world.isAlive(e) && world.has(e, c as unknown as Component);
  const out: Record<string, unknown> = {};
  for (const [f, spec] of Object.entries(b.schema)) {
    const given = patch[f];
    if (given !== undefined) {
      out[f] = (spec as PropSpec).kind === "json" ? JSON.stringify(given) : given;
      continue;
    }
    out[f] = carries ? world.readField(e as Entity, c, f) : (b.defaults as Record<string, unknown>)[f];
  }
  return out;
}

interface Instance {
  readonly e: Entity;
  /** The last DELIVERED cell (raw, retained) — `update`'s `prev`. */
  prevCell: Record<string, unknown>;
  inited: boolean;
  /** Quarantined: hooks stop until re-attach. Doctor-visible. */
  failed: boolean;
  consecutiveThrows: number;
}

export function createBehaviorRuntime(opts: BehaviorRuntimeOpts): BehaviorRuntime {
  const { world } = opts;
  const nodes = new Map<string, Node>();
  const onFault =
    opts.onFault ??
    ((behavior: string, hook: string, entity: Entity | undefined, err: unknown) => {
      console.error(`[ice] behavior "${behavior}" ${hook}${entity === undefined ? "" : ` on entity ${entity}`} threw`, err);
    });
  const onLog =
    opts.onLog ??
    ((behavior: string, message: string, rest: readonly unknown[]) => {
      console.log(`[ice:${behavior}] ${message}`, ...rest);
    });

  // ONE reset watch for the whole runtime. Structural writes are illegal inside
  // an observer emit, so this only MARKS: every node rebuilds at the top of its
  // own delivery body, in its own phase, where writes are legal again.
  const stopResetWatch = world.observe({
    onReset: () => {
      for (const n of nodes.values()) n.markGeneration();
    },
  });

  class Node {
    readonly b: AnyBehaviorDef;
    readonly compiled: CompiledBehavior;
    readonly own: Component;
    /** The same handle, typed for `readField`'s keyof-based field parameter. */
    readonly ownFields: Component<Record<string, unknown>>;
    readonly guest: DrivenGuest;
    readonly ownQuery: Query;
    /** Ephemeral only: REMOTE peers' facets of this behavior (read-only). */
    readonly peersQuery: Query | undefined;
    /** Ephemeral only: the local peer this node last published a facet on. */
    private facetPeer: Entity | undefined;
    readonly instances = new Map<Entity, Instance>();
    readonly fieldNames: readonly string[];
    readonly jsonFields: readonly string[];
    readonly schema: Readonly<Record<string, PropSpec>>;

    private ownCollector: ChangeCollector | undefined;
    private readsCollector: ChangeCollector | undefined;
    private generation = new AbortController();
    private generationDirty = false;
    private seeded = false;
    private removeSystems: (() => void) | undefined;

    /** Stashed by `shouldDeliver` for the body — the drain-and-stash idiom. */
    private stash:
      | { full: boolean; ownChanged: readonly Entity[]; ownRemoved: readonly Entity[]; readsFired: boolean; readsChanged: readonly Entity[]; readsRemoved: readonly Entity[] }
      | undefined;

    /**
     * The ECHO snapshot (§3 own-write subtraction): for every entity this
     * behavior's last commit wrote, the values of every component it watches,
     * captured immediately after the seal.
     *
     * Why it exists: a derived commit journals the entities it just wrote, the
     * next frame reads that as churn, recomputes, diffs everything away and
     * commits nothing. One wasted full recompute per change event. Subtracting
     * the echo makes a derived behavior quiesce in ONE frame.
     *
     * Why it stores VALUES and not just entity ids: the journal reports
     * ENTITIES, not components, so an id-only subtraction cannot tell our own
     * echo from a real write that landed on the same entity inside the same
     * drain window — and it would DROP that real write permanently, since
     * nothing will journal it again. Comparing the watched values answers the
     * question exactly: unchanged everywhere means the entry was ours.
     *
     * "Watched" means EVERY subscription, tags included. Snapshotting only the
     * components left a hole with the same shape as the one this whole memo
     * exists to avoid: a tag in the reads set flipping on an entity we had just
     * written looked identical to our own echo, and was swallowed.
     */
    private echo: Map<Entity, EchoSnapshot> = new Map();

    /** Poll state (relations and resources cannot journal — see §5.2). */
    private readonly resourceStamps = new Map<Resource, number>();
    private readonly parentStamps = new Map<Entity, number>();
    private parentsDirty = true;

    // Scratch — reused between hook calls by DEFAULT (at 10k instances fresh
    // objects are ~600k allocs/sec). The do-not-retain rule in the docs is what
    // pays for this; it applies to `data`, `prev`, `changes()` and
    // `changedEntities()` alike.
    private readonly scratchCell: Record<string, unknown> = {};
    private readonly scratchData: Record<string, unknown>;
    private readonly scratchPrevData: Record<string, unknown>;

    private snapshot: Entity[] = [];
    /** What `ctx.entities()` reports for the CURRENTLY RUNNING pass. */
    private visible: Entity[] = [];
    /** Instances held back by a live claim (§5.3) — instance-scoped, always. */
    private readonly suppressed = new Set<Entity>();
    /** Consecutive suppressed frames per instance (the dev-warn's counter). */
    private readonly suppressedFrames = new Map<Entity, number>();
    /** Churn seen while suppressed — replayed in the coalesced delivery. */
    private readonly carry = new Set<Entity>();
    private changesView: BehaviorChanges = { full: false, changed: [], removed: [] };
    private changedEntitiesCache: Entity[] | undefined;
    /** Set for the duration of a delivery/tick pass; see BehaviorWalker. */
    private walker: BehaviorWalker | undefined;
    private readonly ctx: BehaviorCtxBase<Record<string, unknown>> & Record<string, unknown>;

    constructor(b: AnyBehaviorDef) {
      this.b = b;
      this.own = b.component as Component;
      this.ownFields = b.component as unknown as Component<Record<string, unknown>>;
      this.schema = b.schema;
      this.fieldNames = Object.keys(b.schema);
      this.jsonFields = this.fieldNames.filter((f) => (b.schema[f] as PropSpec).kind === "json");
      // With no json fields the data view IS the raw cell — one object, no copy.
      this.scratchData = this.jsonFields.length === 0 ? this.scratchCell : {};
      this.scratchPrevData = {};
      // An ephemeral behavior is a SINGLETON on the local peer, so remote
      // peers' projected facets must never become instances — they are read
      // through `ctx.peers()` instead. `Local` is strata's own marker for
      // entities THIS peer minted, which is exactly the distinction.
      this.ownQuery =
        b.store === "ephemeral" ? defineQuery([this.own, Local]) : defineQuery([this.own]);
      this.peersQuery = b.store === "ephemeral" ? defineQuery([this.own, Not(Local)]) : undefined;

      const hooks: BehaviorSystemHooks = {
        shouldDeliver: () => this.shouldDeliver(),
        deliver: (ctx) => this.runDeliver(systemWalker(ctx)),
        shouldTick: () => this.instances.size > 0 && !this.generationDirty,
        tickChunk: (batch, ctx) => this.tickChunk(batch, ctx),
        charge: (body) => this.guest.run(body),
        suspended: () => this.guest.suspended(),
        onSuspendedFrame: () => this.discardJournal(),
      };
      this.compiled = compileBehavior(b, hooks);
      this.guest = opts.engine.guests.addDriven({
        id: `behavior:${b.name}`,
        ...(b.budgetMs !== undefined ? { budgetMs: b.budgetMs } : {}),
        busy: () => this.owed(),
      });
      this.ctx = this.buildCtx();
    }

    // --- installation ------------------------------------------------------

    install(): void {
      this.ownCollector = world.changes.collect({ components: [this.own], coarse: false });
      if (this.compiled.readComponents.length > 0 || this.compiled.readTags.length > 0) {
        this.readsCollector = world.changes.collect({
          components: this.compiled.readComponents.filter((c) => c !== this.own),
          ...(this.compiled.readTags.length > 0 ? { tags: this.compiled.readTags } : {}),
          coarse: false,
        });
      }
      // ARM THE POLLS AT REGISTRATION, not at first use. Both stamp families are
      // dormant until their first read: a poll armed late reports its first
      // compare as "unchanged" and silently misses every write before it.
      // (`resourceStamp` arming is WORLD-WIDE — the first read of any resource
      // starts collection for all — so this only matters for the first
      // registration; `orderStamp` is per-relation.)
      for (const res of this.compiled.readResources) this.resourceStamps.set(res, world.resourceStamp(res));
      if (this.compiled.readRelations.length > 0) world.orderStamp(0 as Entity, this.compiled.readRelations[0] as Relation);

      if (this.b.phase === "publish") {
        // The publish slot is not a pipeline phase: it is the post-tick step
        // where ephemeral mutation is legal and there is no iteration bracket.
        // So no systems are registered — the node runs itself from the publish
        // hook, with a walker that goes straight to the world.
        //
        // Accounting note: a driven guest's accrual is closed at the GUEST
        // SLOT, which runs before publish hooks, so a publish behavior's cost
        // lands in the NEXT frame's seam total. The ladder counts invocations,
        // not wall alignment, so every trip rule still fires on schedule — the
        // seam CAP is what sees this one frame late.
        this.removeSystems = opts.engine.onPublish(() => {
          if (this.guest.suspended()) {
            this.discardJournal();
            return;
          }
          this.guest.run(() => {
            if (this.b.store === "ephemeral") this.ensureFacet();
            if (this.shouldDeliver()) this.runDeliver(publishWalker(world));
            this.publishTick();
          });
        });
      } else {
        this.removeSystems = opts.engine.addSystems(
          this.b.phase as PhaseGroup,
          ...(this.compiled.systems as readonly never[]),
        );
      }
    }

    /** Does `e` carry this behavior AS AN INSTANCE? (ephemeral: local peer only) */
    private carries(e: Entity): boolean {
      if (!world.isAlive(e) || !world.has(e, this.own)) return false;
      return this.b.store !== "ephemeral" || world.hasTag(e, Local);
    }

    /**
     * Mint (or re-mint) the local peer's facet. `localPeer` is a getter that a
     * world reset replaces — the fresh peer carries NO facets, so the identity
     * swap is what tells us to attach again rather than edit a dead entity.
     */
    private ensureFacet(): void {
      const presence = opts.presence?.();
      if (presence === undefined) {
        this.facetPeer = undefined;
        return; // dormant: no peer to be
      }
      const peer = presence.localPeer;
      // A world reset kills the minted peer, and presence re-mints it a
      // MICROTASK later (attaching an ephemeral store is illegal inside an
      // observer emit). Between the two there is a window where `localPeer` is
      // a dead handle — writing through it throws inside strata's projector,
      // which the breaker then charges to a behavior that did nothing wrong.
      // Skip the frame; the fresh peer arrives on the next one.
      if (!world.isAlive(peer)) {
        this.facetPeer = undefined;
        return;
      }
      if (peer === this.facetPeer && world.has(peer, this.own)) return;
      this.facetPeer = peer;
      if (!world.has(peer, this.own)) {
        presence.eph.addComponent(
          peer,
          this.own as Component<unknown>,
          { ...(this.b.defaults as Record<string, unknown>) },
        );
      }
    }

    /** Throw away journaled churn nobody will read (see `onSuspendedFrame`). */
    private discardJournal(): void {
      this.ownCollector?.clear();
      this.readsCollector?.clear();
    }

    /** The publish-slot twin of the tick SYSTEM (no query, no chunks). */
    private publishTick(): void {
      const on = this.b.on;
      if (on.tick === undefined || this.snapshot.length === 0) return;
      const info = world.getResource(FrameInfo);
      const frame: BehaviorFrame = { dtMs: info?.dt ?? 0, tick: info?.tick ?? 0, clock: info?.clock ?? 0 };
      const faulted = new Set<Entity>();
      this.walker = publishWalker(world);
      for (const e of this.snapshot) {
        const inst = this.instances.get(e);
        if (inst === undefined || inst.failed || !inst.inited) continue;
        const data = this.dataOf(e);
        this.callHook("tick", inst, faulted, () => {
          on.tick?.(e, data as never, frame, this.ctx as never);
        });
      }
      this.walker = undefined;
    }

    uninstall(): void {
      this.endGeneration();
      this.removeSystems?.();
      this.removeSystems = undefined;
      this.ownCollector?.dispose();
      this.readsCollector?.dispose();
      this.ownCollector = undefined;
      this.readsCollector = undefined;
      this.guest.remove();
    }

    markGeneration(): void {
      this.generationDirty = true;
    }

    /** Owed work for the frame gate — a freeze must not park mid-reflow. */
    owed(): boolean {
      return this.generationDirty;
    }

    // --- the gate ----------------------------------------------------------

    private shouldDeliver(): boolean {
      // The drain is UNCONDITIONAL even when the answer is "no work": a
      // collector nobody drains grows without bound, and the next real drain
      // would hand the body a delta describing a world several frames old.
      const ownDelta = this.ownCollector?.drain();
      const readsDelta = this.readsCollector?.drain();
      const pollFired = this.pollResources() || this.pollOrder();

      const full =
        this.generationDirty ||
        !this.seeded ||
        (ownDelta?.reset ?? false) ||
        (ownDelta?.coarse.length ?? 0) > 0 ||
        (readsDelta?.reset ?? false) ||
        (readsDelta?.coarse.length ?? 0) > 0;

      // The echo memo is consumed by INVALIDATION, not by a frame count.
      // A one-drain window would in fact suffice for the ordinary case — a
      // durable write journals twice (write-through now, batch re-projection at
      // the following `world.sync()`) but both copies land inside one drain —
      // so this is a margin, not a fix: it costs nothing, it does not depend on
      // that timing holding, and the first genuine change on an entity fails
      // the compare, wakes the behavior, and drops the entry anyway.
      const echo = this.echo;
      const isEcho = (e: Entity): boolean => {
        const snap = echo.get(e);
        if (snap === undefined) return false;
        const alive = world.isAlive(e);
        for (const [c, v] of snap.cells) {
          const now = alive && world.has(e, c) ? world.get(e, c) : undefined;
          const same = now === undefined || v === undefined ? now === v : valueEquals(c, now, v);
          if (!same) {
            echo.delete(e);
            return false;
          }
        }
        for (const [t, had] of snap.tags) {
          if ((alive && world.hasTag(e, t)) !== had) {
            echo.delete(e);
            return false;
          }
        }
        return true;
      };
      const keep = (list: readonly Entity[]): readonly Entity[] =>
        echo.size === 0 || list.length === 0 ? list : list.filter((e) => !isEcho(e));

      const ownChanged = keep(ownDelta?.changed ?? []);
      const ownRemoved = ownDelta?.removed ?? [];
      const readsChanged = keep(readsDelta?.changed ?? []);
      const readsRemoved = readsDelta?.removed ?? [];
      const ownWork = ownChanged.length > 0 || ownRemoved.length > 0;
      const readsWork = pollFired || readsChanged.length > 0 || readsRemoved.length > 0;

      // `instances > 0` gates the READS path only. It cannot gate the own path:
      // the very first attach arrives as own-component churn on a behavior that
      // has no instances yet, and gating that is how an installed behavior
      // never wakes up.
      // A claim clearing is WORK even on an otherwise silent frame: the
      // gesture's own commit landed at `ctl:behave`, `derive` runs later the
      // same frame, and the coalesced delivery has to happen against that
      // settled truth or the reflow waits for unrelated churn to wake it.
      const lifted = this.suppressionLifted();
      if (!full && !ownWork && !lifted && !(readsWork && this.instances.size > 0)) {
        if (this.suppressed.size > 0) {
          for (const e of readsChanged) this.carry.add(e);
          for (const e of ownChanged) this.carry.add(e);
        }
        this.stash = undefined;
        return false;
      }
      this.stash = { full, ownChanged, ownRemoved, readsFired: readsWork, readsChanged, readsRemoved };
      return true;
    }

    /** Any suppressed instance whose claim has cleared since last frame. */
    private suppressionLifted(): boolean {
      if (this.suppressed.size === 0) return false;
      for (const e of this.suppressed) {
        if (!this.isSuppressible(e)) return true;
      }
      return false;
    }

    /**
     * Is this instance held by a live claim? Two ways, and the second is what
     * makes the flagship case work: the CARRIER of a mind map is never itself
     * grabbed — its member node is. So a claimed entity that reaches an
     * instance through one of the behavior's own DECLARED read relations
     * suppresses that instance, and only that instance.
     */
    private isSuppressible(e: Entity): boolean {
      if (isClaimed(world, e)) return true;
      for (const r of this.compiled.readRelations) {
        for (const child of world.getReverse(e, r)) {
          if (isClaimed(world, child)) return true;
        }
      }
      return false;
    }

    /** Recompute the suppressed set for this delivery (derived behaviors only). */
    private updateSuppression(): void {
      const gone: Entity[] = [];
      for (const e of this.suppressed) if (!this.instances.has(e)) gone.push(e);
      for (const e of gone) {
        this.suppressed.delete(e);
        this.suppressedFrames.delete(e);
      }
      for (const e of this.snapshot) {
        if (this.isSuppressible(e)) {
          this.suppressed.add(e);
          const n = (this.suppressedFrames.get(e) ?? 0) + 1;
          this.suppressedFrames.set(e, n);
          if (n === SUPPRESSION_WARN_FRAMES) {
            onLog(
              this.b.name,
              `derive suppressed for ${n} frames on entity ${e} — a gesture claim on it (or on one of its members) has not cleared. Derived state for that instance is frozen until it does.`,
              [],
            );
          }
          continue;
        }
        this.suppressed.delete(e);
        this.suppressedFrames.delete(e);
      }
    }

    private pollResources(): boolean {
      let fired = false;
      for (const [res, last] of this.resourceStamps) {
        // A per-WRITE counter, not a frame stamp: same-frame rewrites each bump
        // it, so a poller can never miss a value that was written and
        // overwritten inside one frame. It also never moves backward — a
        // `world.reset()` bumps every held resource, which presents to this
        // poll as an ordinary change to everything, correctly.
        const now = world.resourceStamp(res);
        if (now !== last) {
          this.resourceStamps.set(res, now);
          fired = true;
        }
      }
      return fired;
    }

    private pollOrder(): boolean {
      const rels = this.compiled.readRelations;
      if (rels.length === 0) return false;
      if (this.parentsDirty) this.rebuildParents();
      let fired = false;
      for (const [parent, last] of this.parentStamps) {
        let now = 0;
        for (const r of rels) now += world.orderStamp(parent, r);
        if (now !== last) {
          this.parentStamps.set(parent, now);
          fired = true;
        }
      }
      // A fired stamp usually means the membership under that parent moved, so
      // the parent SET itself may be stale — rebuild next frame.
      if (fired) this.parentsDirty = true;
      return fired;
    }

    private rebuildParents(): void {
      this.parentsDirty = false;
      this.parentStamps.clear();
      for (const e of this.instances.keys()) {
        if (!world.isAlive(e)) continue;
        for (const r of this.compiled.readRelations) {
          const parent = world.getRelation(e, r);
          if (parent === undefined) continue;
          let total = 0;
          for (const rr of this.compiled.readRelations) total += world.orderStamp(parent, rr);
          this.parentStamps.set(parent, total);
        }
      }
    }

    // --- delivery ----------------------------------------------------------

    private runDeliver(walker: BehaviorWalker): void {
      this.walker = walker;
      if (this.generationDirty) {
        this.generationDirty = false;
        this.endGeneration();
        this.generation = new AbortController();
        this.seeded = false;
      }
      const work = this.stash;
      this.stash = undefined;
      const full = work?.full ?? true;

      const appeared: Entity[] = [];
      const departed: Instance[] = [];

      if (full) {
        // Rebuild: every carrier is an instance, every non-carrier is not.
        const carriers = new Set<Entity>();
        walker.each(this.ownQuery, (e) => carriers.add(e));
        for (const e of carriers) if (!this.instances.has(e)) appeared.push(e);
        for (const [e, inst] of this.instances) if (!carriers.has(e)) departed.push(inst);
        this.seeded = true;
      } else {
        // O(changed), never O(instances): structural changes arrive as
        // over-reporting archetype records, so the exact question — "does this
        // entity carry my component NOW?" — is one `has` per journaled entity.
        for (const e of work?.ownChanged ?? []) {
          const carries = this.carries(e);
          const known = this.instances.get(e);
          if (carries && known === undefined) appeared.push(e);
          else if (!carries && known !== undefined) departed.push(known);
        }
        for (const e of work?.ownRemoved ?? []) {
          const known = this.instances.get(e);
          if (known !== undefined) departed.push(known);
        }
      }

      for (const inst of departed) this.instances.delete(inst.e);
      for (const e of appeared) {
        this.instances.set(e, {
          e,
          prevCell: this.readCell(e, {}),
          inited: false,
          failed: false,
          consecutiveThrows: 0,
        });
      }
      if (appeared.length > 0 || departed.length > 0) this.parentsDirty = true;

      // The instance SNAPSHOT: hooks below may attach or detach, and those
      // land next frame. Nothing after this line re-reads `this.instances` for
      // iteration.
      this.snapshot = [...this.instances.keys()];

      // Claim-scoped delivery suppression (§5.3). It REPLACED a deferred-commit
      // queue that re-ran a stale closure after the gesture's own commit — two
      // commits, the first gliding to the pre-drag layout. Here the hook simply
      // does not run while a claim is live, so closure freshness is structural
      // and `ctx.commit` stays a plain write-now call.
      const suppressing = this.b.derived && !this.b.deriveDuringGesture;
      const wasSuppressed = suppressing ? new Set(this.suppressed) : undefined;
      if (suppressing) this.updateSuppression();
      this.visible =
        suppressing && this.suppressed.size > 0
          ? this.snapshot.filter((e) => !this.suppressed.has(e))
          : this.snapshot;
      // A claim CLEARING is itself the trigger for the coalesced delivery. On
      // that frame there is usually no fresh churn at all — the gesture's last
      // write landed frames ago — so without this the settle would sit waiting
      // for unrelated churn to wake it.
      const lifted =
        wasSuppressed !== undefined && [...wasSuppressed].some((e) => !this.suppressed.has(e));

      let changedList = work?.readsChanged ?? [];
      if (this.carry.size > 0) {
        // Churn that arrived while suppressed, replayed ONCE at the settle so
        // the coalesced delivery's `ctx.changes()` describes the whole gesture,
        // not just its final frame.
        const merged = new Set<Entity>(changedList);
        for (const e of this.carry) merged.add(e);
        this.carry.clear();
        changedList = [...merged];
      }
      if (this.suppressed.size > 0) for (const e of changedList) this.carry.add(e);
      this.changesView = { full, changed: changedList, removed: work?.readsRemoved ?? [] };
      this.changedEntitiesCache = undefined;

      const on = this.b.on;
      const faultedEntities = new Set<Entity>();

      // 1. init — appeared instances, before their first tick.
      if (on.init !== undefined) {
        for (const e of appeared) {
          const inst = this.instances.get(e);
          if (inst === undefined || inst.failed) continue;
          if (this.callHook("init", inst, faultedEntities, () => {
            on.init?.(e, this.dataOf(e) as never, this.ctx as never);
          })) {
            inst.inited = true;
          }
        }
      } else {
        for (const e of appeared) {
          const inst = this.instances.get(e);
          if (inst !== undefined) inst.inited = true;
        }
      }

      // 2. update — own data changed since the last delivery, by ANY writer.
      if (on.update !== undefined) {
        const candidates = full ? this.snapshot : (work?.ownChanged ?? []);
        for (const e of candidates) {
          const inst = this.instances.get(e);
          if (inst === undefined || inst.failed || !inst.inited) continue;
          if (this.suppressed.has(e)) continue; // held by a live claim
          // Just-appeared instances got current data in `init`; `prev` would be
          // that same value, so there is nothing to report.
          if (appeared.includes(e)) continue;
          if (!world.isAlive(e)) continue;
          this.readCell(e, this.scratchCell);
          // The journal OVER-REPORTS (an archetype migration reports every
          // carried component), so a real value compare is what keeps `update`
          // meaning "your data changed". strata's own equality, never a
          // hand-rolled one: a local comparison drifts on exactly the cells
          // reconcile considers settled (f32 fround, enum labels, ±0).
          if (valueEquals(this.own, this.scratchCell, inst.prevCell)) continue;
          const data = this.viewOf(this.scratchCell, this.scratchData);
          const prev = this.viewOf(inst.prevCell, this.scratchPrevData);
          this.callHook("update", inst, faultedEntities, () => {
            on.update?.(e, data as never, prev as never, this.ctx as never);
          });
          // Bank the delivered value even when the hook threw: re-delivering
          // the same change to an instance that failed on it is a loop.
          this.copyInto(this.scratchCell, inst.prevCell);
        }
      }

      // 3. changed — ONCE per behavior, not per instance. N instances × one tag
      //    flip must not mean N journal scans.
      const anyVisible = this.visible.length > 0;
      if (on.changed !== undefined && (full || (work?.readsFired ?? false) || lifted) && anyVisible) {
        try {
          on.changed(this.ctx as never);
        } catch (err) {
          // No entity to quarantine — this one is the behavior's.
          onFault(this.b.name, "changed", undefined, err);
          this.guest.fault(err);
        }
      }

      // 4. dispose — departed instances. Runs before the tick SYSTEM in this
      //    phase, which is unobservable: a departed instance no longer carries
      //    the component the tick query matches on.
      if (on.dispose !== undefined) {
        for (const inst of departed) {
          try {
            on.dispose(inst.e, this.ctx as never);
          } catch (err) {
            // Swallowed by contract (§4.3): teardown must not stop teardown.
            onFault(this.b.name, "dispose", inst.e, err);
          }
        }
      }

      this.walker = undefined;
    }

    private tickChunk(batch: Batch, ctx: SystemCtx): void {
      const on = this.b.on;
      if (on.tick === undefined) return;
      this.walker = systemWalker(ctx);
      const info = world.getResource(FrameInfo);
      const frame: BehaviorFrame = {
        dtMs: info?.dt ?? 0,
        tick: info?.tick ?? 0,
        clock: info?.clock ?? 0,
      };
      const faulted = new Set<Entity>();
      this.visible = this.snapshot;
      for (const row of batch) {
        const e = batch.entity(row);
        const inst = this.instances.get(e);
        // A carrier the delivery pass has not adopted yet (attached this frame
        // after delivery ran) has had no `init`; ticking it would violate
        // "init runs before that instance's first tick".
        if (inst === undefined || inst.failed || !inst.inited) continue;
        const data = this.dataOf(e);
        this.callHook("tick", inst, faulted, () => {
          on.tick?.(e, data as never, frame, this.ctx as never);
        });
      }
      this.walker = undefined;
    }

    /**
     * Per-(behavior, hook, entity) fault attribution (BF-D18): three
     * consecutive throws on ONE entity quarantine that INSTANCE; the behavior
     * itself is only struck when throws SPAN instances. One bad node must not
     * kill a 1000-node layout.
     */
    private callHook(hook: string, inst: Instance, faulted: Set<Entity>, body: () => void): boolean {
      try {
        body();
        inst.consecutiveThrows = 0;
        return true;
      } catch (err) {
        inst.consecutiveThrows++;
        onFault(this.b.name, hook, inst.e, err);
        if (inst.consecutiveThrows >= INSTANCE_THROW_LIMIT) inst.failed = true;
        faulted.add(inst.e);
        if (faulted.size > 1) this.guest.fault(err);
        return false;
      }
    }

    // --- generation --------------------------------------------------------

    private endGeneration(): void {
      const on = this.b.on;
      if (on.dispose !== undefined) {
        for (const inst of this.instances.values()) {
          try {
            on.dispose(inst.e, this.ctx as never);
          } catch (err) {
            onFault(this.b.name, "dispose", inst.e, err);
          }
        }
      }
      this.instances.clear();
      this.facetPeer = undefined;
      this.suppressed.clear();
      this.suppressedFrames.clear();
      this.carry.clear();
      this.parentStamps.clear();
      this.parentsDirty = true;
      // dispose FIRST, abort SECOND: a teardown that guards on
      // `signal.aborted` would otherwise skip its own cleanup.
      this.generation.abort();
    }

    // --- data views --------------------------------------------------------

    /** Fill `target` with `e`'s raw cell, field by field — no intermediate object. */
    private readCell(e: Entity, target: Record<string, unknown>): Record<string, unknown> {
      for (const f of this.fieldNames) target[f] = world.readField(e, this.ownFields, f);
      return target;
    }

    /** The hook-facing view of a raw cell (json fields parsed). */
    private viewOf(cell: Record<string, unknown>, target: Record<string, unknown>): Record<string, unknown> {
      if (this.jsonFields.length === 0) return cell;
      for (const f of this.fieldNames) target[f] = cell[f];
      for (const f of this.jsonFields) {
        const raw = cell[f];
        target[f] = typeof raw === "string" ? safeParse(raw) : raw;
      }
      return target;
    }

    private dataOf(e: Entity): Record<string, unknown> {
      this.readCell(e, this.scratchCell);
      return this.viewOf(this.scratchCell, this.scratchData);
    }

    private copyInto(src: Record<string, unknown>, dst: Record<string, unknown>): void {
      for (const f of this.fieldNames) dst[f] = src[f];
    }

    cellFor(e: Entity | undefined, patch: Record<string, unknown>): Record<string, unknown> {
      return cellForBehavior(world, this.b, e, patch);
    }

    // --- ctx ---------------------------------------------------------------

    private buildCtx(): BehaviorCtxBase<Record<string, unknown>> & Record<string, unknown> {
      const scopedQuery = createQueryScope(
        this.b,
        allowedQueryTerms(this.b, this.compiled.readComponents, this.compiled.readTags),
      );
      const behaviorWorld = createBehaviorWorld(world);
      const node = this;

      const requireWalker = (what: string): BehaviorWalker => {
        const w = node.walker;
        if (w === undefined) {
          throw new Error(
            `ice: behavior "${node.b.name}" called ctx.${what} outside a hook — the ctx is valid only for the duration of the hook call (its walks are attributed to the running system, and there is none here).`,
          );
        }
        return w;
      };

      const base: BehaviorCtxBase<Record<string, unknown>> = {
        world: behaviorWorld,
        query: (spec) => scopedQuery(requireWalker("query"), spec),
        entities: () => node.visible,
        changes: () => node.changesView,
        changedEntities: () => {
          if (node.changedEntitiesCache === undefined) {
            const out: Entity[] = [];
            for (const e of node.changesView.changed) if (node.instances.has(e)) out.push(e);
            node.changedEntitiesCache = out;
          }
          return node.changedEntitiesCache;
        },
        keyOf: (e) => {
          const key = opts.session?.()?.store.keyOf(e);
          return typeof key === "string" ? key : undefined;
        },
        entityFor: (key) => opts.session?.()?.store.resolve(key as never),
        get signal() {
          return node.generation.signal;
        },
        log: (message, ...rest) => onLog(node.b.name, message, rest),
      };

      // The store class routes the WRITE VOCABULARY. Assembling it here — one
      // object per behavior, built once — is what makes "you cannot misuse the
      // two-worlds model" a property of the object rather than a doc promise.
      const extra: Record<string, unknown> = {};
      if (this.b.store === "runtime") {
        extra.write = (e: Entity, patch: Record<string, unknown>) => node.writeOwn(e, patch);
        extra.set = (e: Entity, c: Component, v: unknown) => node.writeTarget(e, c, v);
        extra.attach = (e: Entity, data?: Record<string, unknown>) => {
          requireWalker("attach").addComponent(e, node.own, node.cellFor(undefined, data ?? {}));
        };
        extra.detach = (e: Entity) => {
          requireWalker("detach").removeComponent(e, node.own);
        };
      }
      if (this.b.store === "ephemeral") {
        // No entity argument: the instance IS the local peer, and there is
        // exactly one. Legal without a queue because ephemeral hooks run at the
        // publish slot — post-tick, where eph mutation is allowed.
        extra.write = (patch: Record<string, unknown>) => node.writeFacet(patch);
        extra.peers = () => node.readPeers();
      }
      if (this.b.store === "durable" || this.b.store === "runtime") {
        extra.commit = (label: string, fn: (tx: BehaviorTx<Record<string, unknown>>) => void, o?: { undoable?: boolean }) =>
          node.commit(label, fn, o);
      }
      return Object.assign(base, extra) as BehaviorCtxBase<Record<string, unknown>> & Record<string, unknown>;
    }

    /** `ctx.write(patch)` for the ephemeral class — publish THIS peer's facet. */
    private writeFacet(patch: Record<string, unknown>): void {
      const presence = opts.presence?.();
      if (presence === undefined) return; // dormant
      const peer = presence.localPeer;
      if (!world.isAlive(peer)) return; // mid re-mint (see ensureFacet)
      const cell = cellForBehavior(world, this.b, peer, patch);
      if (world.has(peer, this.own)) presence.eph.edit(peer).set(this.own as Component<unknown>, cell);
      else presence.eph.addComponent(peer, this.own as Component<unknown>, cell);
    }

    /** `ctx.peers()` — REMOTE peers' facets, read-only. The read side of presence. */
    private readPeers(): { entity: Entity; data: Record<string, unknown> }[] {
      const q = this.peersQuery;
      if (q === undefined) return [];
      const out: { entity: Entity; data: Record<string, unknown> }[] = [];
      world.query(q).each((b) => {
        for (const row of b) {
          const e = b.entity(row);
          const cell = this.readCell(e, {});
          out.push({ entity: e, data: this.viewOf(cell, {}) });
        }
      });
      return out;
    }

    /** `ctx.write` — own runtime data, immediate, through the armed guard. */
    private writeOwn(e: Entity, patch: Record<string, unknown>): void {
      if (!world.isAlive(e) || !world.has(e, this.own)) return;
      this.writeTarget(e, this.own, this.cellFor(e, patch));
    }

    /**
     * `ctx.set` — a declared `writes:` target, immediate. Routed through the
     * session's LiveWriter, which is what makes the divergence law ARMED rather
     * than aspirational: a per-frame write to a DURABLE-eligible cell without a
     * gesture claim or tween grant throws here, naming the law. Doc-less
     * engines write direct — nothing is doc-sovereign without a document.
     */
    private writeTarget(e: Entity, c: Component, v: unknown): void {
      if (devGuardsEnabled() && c !== this.own && !this.b.writes.includes(c)) {
        throw new Error(
          `ice: behavior "${this.b.name}" wrote a component it did not declare in writes: — declared writes are what the compiler derives access from (design-009 §7).`,
        );
      }
      const live = opts.session?.()?.liveWriter;
      if (live !== undefined) live.set(e, c as Component<unknown>, v);
      else world.edit(e).set(c as Component<unknown>, v);
    }

    /** `ctx.commit` — ONE labeled transaction, opened INSIDE the hook. */
    private commit(
      label: string,
      fn: (tx: BehaviorTx<Record<string, unknown>>) => void,
      o?: { undoable?: boolean },
    ): void {
      const session = opts.session?.();
      if (session === undefined) {
        throw new Error(
          `ice: behavior "${this.b.name}" called ctx.commit("${label}") with no document attached — durable writes need a doc (engine.docs.create()/open()/join()).`,
        );
      }
      if (session.readOnly) {
        throw new Error(
          `ice: behavior "${this.b.name}" called ctx.commit("${label}") on a READ-ONLY document (version gate) — writes are disabled.`,
        );
      }
      const store = session.store as unknown as Parameters<typeof guardedTransaction>[0];
      const keyOf = (e: Entity): string | undefined => {
        const key = session.store.keyOf(e);
        return typeof key === "string" ? key : undefined;
      };
      // `label` is a stable MACHINE id, never display text: it rides in-CRDT as
      // provenance (strata 0.12.0 petition 9) and a receiving peer reads it.
      const meta = { behavior: this.b.name, label };

      if (!this.b.derived) {
        guardedTransaction(store, world, (tx) => fn(this.wrapTx(tx)), {
          ...(o?.undoable !== undefined ? { undoable: o.undoable } : {}),
          live: session.liveWriter,
          keyOf,
          meta,
        });
        return;
      }

      // The derived path BUFFERS: `undoable` has to be decided before the
      // transaction opens, and whether this commit is derived output or an
      // authorial config edit is only knowable from its ops.
      const recorded = recordDerivedOps(this.b.name, (rec) => fn(this.wrapTx(rec)));
      const diff = diffOps(recorded, {
        world,
        docValue: (e, c) => session.store.getComponent(e, c),
        writeTargets: new Set(this.b.writes as readonly Component[]),
      });
      if (diff.ops.length === 0) return; // zero ops opens NO transaction
      guardedTransaction(store, world, (tx) => replayOps(diff.ops, tx), {
        // ⌘Z must never un-derive. Output rides non-undoable; a commit that
        // only touches the behavior's OWN data is authorial and keeps undo.
        undoable: diff.derivedOutput ? false : (o?.undoable ?? true),
        live: session.liveWriter,
        keyOf,
        meta,
      });
      this.captureEcho(diff.writtenEntities, diff.writtenValues);
    }

    /**
     * Snapshot what the world will look like once this commit projects.
     *
     * Committed components take the value the COMMIT wrote — a durable write
     * lands in the doc now and projects at the next `world.sync()`, so reading
     * the world here would snapshot the value being replaced and every echo
     * would then look like a real change. Everything else the behavior watches
     * is read from the world, where it is already current.
     */
    private captureEcho(
      entities: readonly Entity[],
      committed: ReadonlyMap<Entity, ReadonlyMap<Component, unknown>>,
    ): void {
      const watched: Component[] = [this.own, ...this.compiled.readComponents];
      this.echo = new Map();
      for (const e of entities) {
        const wrote = committed.get(e);
        const alive = world.isAlive(e);
        const cells: [Component, unknown][] = [];
        for (const c of watched) {
          const v = wrote?.get(c);
          cells.push([c, v !== undefined ? v : alive && world.has(e, c) ? world.get(e, c) : undefined]);
        }
        const tags: [Tag, boolean][] = [];
        for (const t of this.compiled.readTags) tags.push([t, alive && world.hasTag(e, t)]);
        this.echo.set(e, { cells, tags });
      }
    }

    /**
     * The door's transaction. `setResource` is MASKED — the §9 resource-write
     * fence made mechanical rather than doctrinal: `GuardedTx` structurally
     * carries it, so leaving it reachable would make the fence a comment.
     */
    private wrapTx(tx: GuardedTx): BehaviorTx<Record<string, unknown>> {
      const node = this;
      const wrapped = {
        ...tx,
        spawnPrefab: tx.spawnPrefab.bind(tx),
        spawn: tx.spawn.bind(tx),
        destroy: tx.destroy.bind(tx),
        addComponent: tx.addComponent.bind(tx),
        removeComponent: tx.removeComponent.bind(tx),
        edit: tx.edit.bind(tx),
        addTag: tx.addTag.bind(tx),
        removeTag: tx.removeTag.bind(tx),
        setRelation: tx.setRelation.bind(tx),
        addRelation: tx.addRelation.bind(tx),
        removeRelation: tx.removeRelation.bind(tx),
        moveRelation: tx.moveRelation.bind(tx),
        move: tx.move.bind(tx),
        setResource: () => {
          throw new Error(
            `ice: behavior "${node.b.name}" called tx.setResource — behaviors do not write resources (design-009 §4.4). A resource-backed behavior is the named "singleton" v1.1 shape.`,
          );
        },
        write(e: Entity, patch: Record<string, unknown>) {
          tx.edit(e).set(node.own as Component<unknown>, node.cellFor(e, patch));
        },
        attach(e: Entity, behavior: { component: unknown; defaults: unknown; name: string }, data?: Record<string, unknown>) {
          const other = behavior as unknown as AnyBehaviorDef;
          const cell = cellForBehavior(world, other, e, data ?? {});
          // Attach-when-attached is an IDEMPOTENT no-op that preserves existing
          // data (§6) — expressed as a value write, which the differ then sees
          // as an ordinary value diff rather than a structural op.
          if (world.has(e, other.component as Component)) {
            tx.edit(e).set(other.component as Component<unknown>, cell);
          } else {
            tx.addComponent(e, other.component as Component<unknown>, cell);
          }
        },
        detach(e: Entity, behavior: AnyBehaviorDef) {
          tx.removeComponent(e, behavior.component as Component);
        },
      };
      return wrapped as unknown as BehaviorTx<Record<string, unknown>>;
    }

    status(): BehaviorStatus {
      let failed = 0;
      for (const inst of this.instances.values()) if (inst.failed) failed++;
      return {
        name: this.b.name,
        store: this.b.store,
        phase: this.b.phase,
        instances: this.instances.size,
        failed,
        ticking: this.b.on.tick === undefined ? 0 : this.instances.size - failed,
        suspended: this.guest.suspended(),
      };
    }
  }

  function safeParse(raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }

  return {
    register(b) {
      if (nodes.has(b.name)) {
        throw new Error(`ice: behavior "${b.name}" is already registered with this engine.`);
      }
      const node = new Node(b);
      nodes.set(b.name, node);
      node.install();
      return () => {
        if (nodes.get(b.name) !== node) return;
        nodes.delete(b.name);
        node.uninstall();
      };
    },

    registered() {
      return [...nodes.values()].map((n) => n.b);
    },

    attach(e, b, data) {
      if (b.store === "durable") {
        throw new Error(
          `ice: engine.behaviors.attach("${b.name}") — durable attachment is a DOCUMENT op: use tx.attach inside a transaction so it syncs and undoes.`,
        );
      }
      const cell = cellForBehavior(world, b, e, data ?? {});
      if (world.has(e, b.component as Component)) world.edit(e).set(b.component as Component<unknown>, cell);
      else world.addComponent(e, b.component as Component<unknown>, cell);
    },

    detach(e, b) {
      if (b.store === "durable") {
        throw new Error(
          `ice: engine.behaviors.detach("${b.name}") — durable detachment is a DOCUMENT op: use tx.detach inside a transaction.`,
        );
      }
      if (world.has(e, b.component as Component)) world.removeComponent(e, b.component as Component);
    },

    has: (e, b) => world.isAlive(e) && world.has(e, b.component as Component),

    read(e, b) {
      if (!world.isAlive(e) || !world.has(e, b.component as Component)) return undefined;
      const cell = world.get(e, b.component as Component) as Record<string, unknown> | undefined;
      if (cell === undefined) return undefined;
      for (const [f, spec] of Object.entries(b.schema)) {
        if ((spec as JsonSpec).kind !== "json") continue;
        const raw = cell[f];
        if (typeof raw === "string") cell[f] = safeParse(raw);
      }
      return cell;
    },

    list() {
      return [...nodes.values()].map((n) => n.status());
    },

    dispose() {
      stopResetWatch();
      for (const n of nodes.values()) n.uninstall();
      nodes.clear();
    },
  };
}
