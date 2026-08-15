/**
 * The behavior compiler (design-009 §7, BF-D16/BF-D17) — declaration → systems.
 *
 * Three things happen here, and each one was broken twice in review before it
 * settled:
 *
 * 1. **The SPLIT rule.** A behavior compiles to UP TO TWO systems per phase.
 *    The DELIVERY system is collector-gated and carries `access.write` = own
 *    component + ALL `writes:` targets, DURABLE ONES INCLUDED (design-002
 *    decision 7 charges in-system commits to the running system's declared
 *    writes — the earlier "runtime targets only" formula would have DEV-thrown
 *    the flagship mind map's very first commit). The TICK system exists only
 *    when an `on.tick` hook does, and carries `access.write` = the own
 *    component ONLY. The split exists because strata blanket-stamps a ran
 *    system's declared writes whether or not it wrote: a ticking system
 *    carrying `writes: [Position]` would stamp Position every single frame and
 *    wake every downstream observer. Say it to authors as the stamping tax —
 *    declare minimally.
 *
 * 2. **The reads PARTITION.** `SystemAccess` is components-only, so tag ids
 *    must never be spread into the component-id set: ids are dense per KIND, so
 *    tag #7 would silently whitelist component #7 (the id-space trap).
 *    Components → `access.read` + the collector; tags → the collector only;
 *    relations and resources → polls, which the runtime arms.
 *
 * 3. **`coarse: false`.** Non-negotiable, and an engine-wide LAW rather than a
 *    local option: strata blanket-marks coarse for every ran system with
 *    declared writes, so without the attestation ANY ticking system with writes
 *    would put every behavior collector on those components into a full rescan
 *    every frame. The attestation says "no raw `batch.col()` writes to
 *    behavior-read components anywhere in ICE" — ICE is the only party that can
 *    make that promise (the engine already attests it at four sites; see
 *    `systems/l1-pick.ts`). A future raw writer of a behavior-read component
 *    silently degrades every behavior's precision.
 *
 * Systems are built ONCE here and registered once — never re-wrapped per
 * assemble, because strata memoizes per-system access in a WeakMap keyed on the
 * system OBJECT: a fresh wrapper each frame would leak entries and defeat the
 * memoization it was leaking into.
 */
import { Not, defineQuery, defineSystem, defineTickSystem } from "@vibecook/strata-ecs";
import type {
  Batch,
  CollectOptions,
  Component,
  Relation,
  Resource,
  System,
  SystemAccess,
  SystemCtx,
  Tag,
  TickSystem,
} from "@vibecook/strata-ecs";
import { Culled } from "../catalog/camera-derived";
import type { AnySystem } from "../engine/pipeline";
import { prefabs } from "../schema/prefab";
import { schemaMeta } from "../schema/meta";
import { behaviors, classifyRead, readComponentOf } from "./define-behavior";
import type { AnyBehaviorDef, BehaviorPhase } from "./types";

/**
 * The bodies the runtime supplies. Compilation owns SHAPE (query, access,
 * runIf, name, registration identity); the runtime owns behavior. Keeping the
 * seam here means the compiler's rules — the split, the partition, the gating —
 * are unit-testable without standing up a delivery loop.
 */
export interface BehaviorSystemHooks {
  /**
   * The delivery `runIf`: drains the collector, stashes the delta for the body,
   * evaluates the polls, and decides. Side-effecting BY DESIGN — there is no
   * non-destructive peek on a `ChangeCollector`, so the drain has to happen
   * in the gate or the gate cannot see the work (the `makeChurnGuard` idiom).
   */
  shouldDeliver(ctx: SystemCtx): boolean;
  deliver(ctx: SystemCtx): void;
  /** The tick `runIf` — cheap: instance count, suspension, freeze. */
  shouldTick(ctx: SystemCtx): boolean;
  tickChunk(batch: Batch, ctx: SystemCtx): void;
  /**
   * Run `body` inside this behavior's breaker bracket + fault domain. Returns
   * false when the breaker is holding the behavior down or the body threw.
   */
  charge(body: () => void): boolean;
  /** Breaker verdict — polled from `runIf`, so it must be cheap and never throw. */
  suspended(): boolean;
  /**
   * A frame the behavior sat out because the breaker suspended it. The runtime
   * DISCARDS its collectors here: a suspended behavior that stops draining
   * still journals, so its collectors would grow for as long as the suspension
   * lasts and then hand the resumed behavior a delta describing a world many
   * frames old.
   */
  onSuspendedFrame(): void;
}

export interface CompiledBehavior {
  readonly behavior: AnyBehaviorDef;
  readonly phase: BehaviorPhase;
  /** The framework collector's subscription (always `coarse: false`). */
  readonly collect: CollectOptions;
  /** `reads:` partitioned by kind — each routed to a different mechanism. */
  readonly readComponents: readonly Component[];
  readonly readTags: readonly Tag[];
  readonly readRelations: readonly Relation[];
  readonly readResources: readonly Resource[];
  readonly deliveryAccess: SystemAccess;
  readonly tickAccess: SystemAccess | undefined;
  readonly delivery: TickSystem;
  /** Present only when the declaration has an `on.tick` hook. */
  readonly tick: System | undefined;
  /** Registration order: delivery first, then tick. */
  readonly systems: readonly AnySystem[];
}

/**
 * Is `c` a cell the document can hold? Two sources: a durable prefab's
 * eligible set, and (BF-D6) any durable behavior's own data component —
 * registered behavior components are UNIVERSALLY durable-eligible.
 *
 * This is deliberately compile-time and not definition-time. At module-eval
 * time the prefab registry may not yet hold the widget whose Position a
 * behavior writes, so a definition-time answer would depend on import order —
 * and an import-order-dependent refusal is worse than no refusal, because it
 * passes on the developer's machine and fails in the bundle.
 */
export function isDurableEligible(c: Component): boolean {
  if (behaviors.forComponent(c)?.store === "durable") return true;
  for (const p of prefabs.all()) {
    if (p.store === "durable" && p.eligible.has(c)) return true;
  }
  return false;
}

/** Hook names that can open a transaction (the only legal durable write path). */
function hasCommitCapableHook(b: AnyBehaviorDef): boolean {
  return b.on.init !== undefined || b.on.update !== undefined || b.on.changed !== undefined;
}

export function partitionReads(b: AnyBehaviorDef): {
  components: Component[];
  tags: Tag[];
  relations: Relation[];
  resources: Resource[];
} {
  const components: Component[] = [];
  const tags: Tag[] = [];
  const relations: Relation[] = [];
  const resources: Resource[] = [];
  for (const r of b.reads) {
    const kind = classifyRead(r)?.kind;
    switch (kind) {
      case "component":
      case "behavior": {
        const c = readComponentOf(r);
        if (c !== undefined && !components.includes(c)) components.push(c);
        break;
      }
      case "tag":
        if (!tags.includes(r as Tag)) tags.push(r as Tag);
        break;
      case "relation":
        if (!relations.includes(r as Relation)) relations.push(r as Relation);
        break;
      case "resource":
        if (!resources.includes(r as Resource)) resources.push(r as Resource);
        break;
      default:
        // Unclassifiable reads are refused at definition time; a behavior built
        // with dev guards off can still reach here — drop it rather than
        // corrupt the id space.
        break;
    }
  }
  return { components, tags, relations, resources };
}

export function compileBehavior(b: AnyBehaviorDef, hooks: BehaviorSystemHooks): CompiledBehavior {
  const own = b.component as Component;
  const { components: readComponents, tags: readTags, relations: readRelations, resources: readResources } =
    partitionReads(b);

  // The static divergence refusal (§3): a durable-eligible target in `writes:`
  // is reachable ONLY through `ctx.commit`, and only init/update/changed can
  // commit. A behavior whose sole hook is `tick` therefore declares a write it
  // has no legal way to make — and the way authors discover that today is a
  // divergence throw at runtime, on someone else's machine.
  if (!hasCommitCapableHook(b)) {
    for (const w of b.writes) {
      if (isDurableEligible(w)) {
        const name = schemaMeta.component(w)?.name ?? "<component>";
        throw new Error(
          `ice: behavior "${b.name}" declares writes: [${name}], a durable-eligible cell, but has no init/update/changed hook — durable cells are written ONLY inside ctx.commit, and a tick hook cannot commit (design-009 §3). Per-frame motion belongs in the behavior's own runtime data, or in tx.move.`,
        );
      }
    }
  }

  const writeSet = new Set<Component>([own, ...(b.writes as readonly Component[])]);
  // `read` is the literal declaration strata stores; a component in `write`
  // must not be repeated here (the write set already grants `col()` access, and
  // duplicating it only makes the diagnostics lie about intent).
  const declaredRead = readComponents.filter((c) => !writeSet.has(c));

  // The two systems of the SPLIT both write the own component, in the same
  // phase, on the same rows — which is exactly strata's same-phase writer-pair
  // advisory (001 §3.3). Here the pair is order-tolerant in the sanctioned
  // sense: the framework FIXES their order (delivery is registered before tick,
  // always), the writes are whole-cell absolute values, and delivery-then-tick
  // is last-write-wins-safe by construction. So both attest — and the
  // attestation is scoped to the own component ONLY. Declared `writes:` targets
  // are never attested: those DO have engine co-writers, and claiming
  // order-tolerance on the engine's behalf is not ours to do.
  //
  // Without this, every ticking behavior would print a strata advisory at
  // registration — a framework must not make its users read a warning that
  // describes its own deliberate design.
  const deliveryAccess: SystemAccess = {
    write: [...writeSet],
    ...(declaredRead.length > 0 ? { read: declaredRead } : {}),
    ...(b.on.tick !== undefined ? { orderIndependent: [own] } : {}),
  };

  const collect: CollectOptions = {
    // Own component FIRST: it is what makes appear/depart detectable at all.
    components: [own, ...readComponents.filter((c) => c !== own)],
    ...(readTags.length > 0 ? { tags: readTags } : {}),
    coarse: false,
  };

  const delivery = defineTickSystem(
    (ctx) => {
      hooks.charge(() => hooks.deliver(ctx));
    },
    {
      name: `behavior:${b.name}:deliver`,
      runIf: (ctx) => {
        if (hooks.suspended()) {
          hooks.onSuspendedFrame();
          return false;
        }
        return hooks.shouldDeliver(ctx);
      },
      access: deliveryAccess,
    },
  );

  let tick: System | undefined;
  let tickAccess: SystemAccess | undefined;
  if (b.on.tick !== undefined) {
    // `tick: { while: "visible" }` — declared suspension, compiled INTO the
    // query so culled instances never reach a chunk, rather than tested per
    // instance in the body. Default is every instance (Law 14).
    const query =
      b.tickWhile === "visible" ? defineQuery([own, Not(Culled)]) : defineQuery([own]);
    tickAccess = {
      write: [own],
      ...(declaredRead.length > 0 ? { read: declaredRead } : {}),
      orderIndependent: [own], // the delivery system's twin — see above
    };
    tick = defineSystem(
      query,
      (batch, ctx) => {
        hooks.charge(() => hooks.tickChunk(batch, ctx));
      },
      {
        name: `behavior:${b.name}:tick`,
        runIf: (ctx) => !hooks.suspended() && hooks.shouldTick(ctx),
        access: tickAccess,
      },
    );
  }

  return {
    behavior: b,
    phase: b.phase,
    collect,
    readComponents,
    readTags,
    readRelations,
    readResources,
    deliveryAccess,
    tickAccess,
    delivery,
    tick,
    systems: tick === undefined ? [delivery] : [delivery, tick],
  };
}
