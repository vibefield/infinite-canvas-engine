Recommendation

Add #1: an opt-in per-entity change journal, but package it as a pull-based ChangeCollector, not as another callback observer and not as always-on bookkeeping.

The important refinement is:

Exact entity journal for writes Strata can identify, plus a conservative archetype fallback for raw typed-array writes.

That would complement Strata’s existing stamping layer rather than duplicate it.

Why this is the missing layer

Strata already implements something close to option 3:

* Each archetype has lastWrittenFrame per component.
* Each archetype has lastStructuralFrame.
* Tags, relations, resources, and components have aggregate stamps.
* Declared system writes conservatively stamp matching archetypes after an attributed query walk.  

Conceptually, Strata currently has:

component + archetype → last changed frame

That answers:

Did something involving Position in this archetype possibly change?

It does not answer:

Which Position entities changed?

observeValue can answer that for individually watched cells, but it is designed for UI-style subscriptions and fires at the settled reactive.notify() boundary after the ticks. It is not an efficient way to watch every spatial entity, nor can a same-frame spatialSync depend on a callback that runs after the pipeline.  

So the clean layering would become:

Stamps
  “might anything have changed?”
  coarse, cheap, multi-consumer
Collectors
  “which entities changed?”
  precise where possible, opt-in, consumer-owned
Value observers
  “did this exact decoded value really differ?”
  equality-checked, callback-based, UI-friendly

Proposed API

I would avoid naming it Changed<T> because that often implies a normal query filter. Instead, make the different performance contract explicit:

const spatialChanges = world.changes.collect({
  components: [Position, Size],
  lifecycle: true,
});

Then:

const SpatialSync = defineTickSystem((ctx) => {
  const delta = spatialChanges.drain();
  if (delta.reset) {
    rebuildSpatialIndex(ctx);
    return;
  }
  for (const entity of delta.removed) {
    spatial.remove(entity);
  }
  for (const entity of delta.changed) {
    if (isSpatiallyIndexable(ctx, entity)) {
      spatial.upsert(entity);
    } else {
      spatial.remove(entity);
    }
  }
});

An initial API could be:

interface ChangeDelta {
  readonly changed: readonly Entity[];
  readonly removed: readonly Entity[];
  readonly coarse: readonly ChangeRegion[];
  readonly reset: boolean;
}
interface ChangeCollector {
  drain(): ChangeDelta;
  clear(): void;
  dispose(): void;
}

I would probably put this on world.changes, not world.reactive, because it has different scheduling semantics:

* reactive.notify() is a settled callback boundary.
* changes.drain() is a pull operation available inside the pipeline.
* The collector can be consumed between systems or phases.
* It has explicit destructive/cursor semantics.

They can share internal mutation hooks without pretending to be the same abstraction.

Exact where possible, conservative where necessary

Strata has two fundamentally different write paths.

Exact sparse writes

For these operations, Strata knows the entity:

ctx.edit(entity).set(Position, value);
world.edit(entity).set(Position, value);
projectComponent(entity, Position, value);
addComponent(entity, Position, value);
removeComponent(entity, Position);
destroy(entity);

The existing doWriteCells and migration chokepoints already receive the entity, so subscribed collectors can add that entity to a deduplicated journal at very low incremental complexity.  

These should produce exact records:

set/add Position       → changed(entity)
remove Position        → removed(entity)
destroy entity         → removed(entity)
reset/import replace   → reset marker

Raw typed-array writes

A system can do this:

const xs = batch.col(Position).x;
for (const row of batch) {
  xs[row] += 10;
}

Strata cannot intercept typed-array index assignments. It currently solves this correctly by stamping the system’s declared access.write components over the query’s matching archetypes.  

For this path, the collector should not lie about exactness. It should receive a coarse record:

Position may have changed in archetype A

Then the consumer scans that region:

for (const region of delta.coarse) {
  region.query.each((batch) => {
    // Re-evaluate current AABBs for this batch.
  });
}

This produces a useful hybrid:

Mutation route	Collector result
edit(e).set(...)	Exact entity
Projection overwrite	Exact entity
Component add/remove	Exact entity and transition
Destroy	Exact removal
Raw batch.col() write	Coarse archetype/query region
Reset	One wholesale-reset marker

This hybrid is important. Forcing all component access through proxies or setter calls would undermine Strata’s typed-array hot path.

Internal representation

Each collector should own its own deduplicated set:

class ChangeCollectorImpl {
  changed: Entity[] = [];
  removed: Entity[] = [];
  // Indexed by entity slot.
  seenEpoch: Uint32Array;
  removedEpoch: Uint32Array;
  epoch = 1;
  // Conservative fallback from raw column writers.
  coarseArchetypes: Archetype[] = [];
  resetPending = false;
}

Deduplication:

function markChanged(collector: ChangeCollectorImpl, entity: Entity): void {
  const slot = slotOf(entity);
  if (collector.seenEpoch[slot] === collector.epoch) {
    return;
  }
  collector.seenEpoch[slot] = collector.epoch;
  collector.changed.push(entity);
}

On drain(), increment the epoch and clear the arrays without clearing a giant bitset.

Be careful about generation reuse: the journal must store the packed entity handle, not only the slot. A removal record should remain usable even after the entity is destroyed, because a spatial index generally removes by its cached entity key rather than reading the dead entity.

Subscription indexing

Do not walk every collector on every write. Keep dense opt-in subscriber tables:

componentCollectors[componentId]
tagCollectors[tagId]
relationCollectors[relationId]
lifecycleCollectors

The write chokepoint becomes approximately:

private markComponentCollectors(
  componentId: ComponentId,
  entity: Entity,
): void {
  const collectors = this.componentCollectors[componentId];
  if (collectors === undefined) {
    return;
  }
  for (const collector of collectors) {
    collector.markChanged(entity);
  }
}

This preserves Strata’s existing design principle:

Features that have not been attached should not tax the hot path.

Strata’s current stamping is similarly dormant until an observer is registered because the always-on version measured significantly worse on migration-heavy workloads.  

I would give exact collectors their own gate rather than assuming reactiveOn means journals are active. A user might use one React value observer without wanting collector checks on every component write.

Query membership

For the first implementation, I would not immediately build a fully general exact query-delta engine.

Start with component and lifecycle collection:

world.changes.collect({
  components: [Position, Size],
  tags: [Spatial],
  lifecycle: true,
});

The consumer rechecks whether each changed entity currently satisfies the indexable query:

if (indexable.matches(entity)) {
  upsert(entity);
} else {
  remove(entity);
}

Later, you could offer:

world.changes.collectQuery(indexable, {
  changed: [Position, Size],
});

with:

delta.entered
delta.changed
delta.exited

But exact query transitions become substantially more complicated because Strata queries can depend on:

* Components
* Tags
* Relations
* Concrete relation targets
* Any
* Negation
* Structural migration

The existing query compiler already exposes membership dependency IDs for stamps, which provides a good foundation, but query-delta collection should be a separate milestone.  

For spatialSync, a component/lifecycle collector plus a current isIndexable(entity) check is likely sufficient.

An optional precision upgrade for raw writers

Later, add an explicit row-touch operation for systems that mutate only a sparse subset through raw arrays:

for (const row of batch) {
  if (!shouldMove(row)) continue;
  px[row] += dx;
  py[row] += dy;
  batch.touch(row, Position);
}

Or:

ctx.touch(batch.entity(row), Position);

This would upgrade the collector record from coarse to exact.

The rule should be:

No explicit touch:
    declared raw write → conservative coarse invalidation
Explicit touch:
    exact entities recorded
    optionally suppress coarse invalidation for that component/walk

I would make this an optimization, not a correctness requirement. Forgetting touch must produce over-work, never stale derived state.

That is better than a SpatialDirty tag, where forgetting the tag causes incorrectness.

Why I would not add the other options now

Per-chunk versions

Strata does not currently have fixed-size storage chunks in the Unity sense. Its archetype itself is the contiguous storage unit, so its existing per-archetype component stamp is effectively its current chunk-version mechanism. Unity’s change filters work at physical archetype-chunk granularity and can therefore skip some chunks while conservatively processing every entity in changed chunks.  

Adding true chunk versions to Strata would mean first dividing archetypes into fixed-size pages/chunks. That is a major storage and query-dispatch redesign. It may eventually be valuable for:

* Parallel iteration
* Bounded migrations
* Better incremental scans
* Very large homogeneous archetypes

But I would not introduce chunking primarily to solve spatialSync.

Per-chunk changed-row lists

This is a possible internal implementation of collectors, but it is not the first public abstraction I would add.

A global entity-slot dedup set is simpler for editor workloads because entities can migrate between archetypes during the collection window. Row numbers and archetype-local positions are unstable under swap-and-pop migration; packed entity handles are stable until destruction.

SpatialDirty tag

Keep that as an application-level option, not a Strata primitive. It makes spatial invalidation structurally visible but depends on every writer remembering to add it, and adding/removing a normal tag creates its own membership bookkeeping.

Full query scan

Keep it as:

* The default when no collector exists
* A fallback for coarse raw writes
* A development validator
* A rebuild route after reset/import

It remains valuable even after collectors exist.

Avoid a generic Changed(Position) query filter

I would resist adding:

defineQuery([Position, Changed(Position)])

unless Strata can guarantee that it iterates actual changes.

Bevy exposes Changed<T>, but its official documentation warns that it still iterates every entity matching the underlying query and checks each entity’s tick, even if none changed.  

That syntax looks like O(changed) while potentially behaving like O(all matches). A named collector makes the cost and lifetime more obvious.

EnTT’s observer model is a closer precedent: observers collect a reduced set of entities that matched update rules and can later be iterated and cleared. Flecs similarly separates periodic systems from event-driven observers.  

My concrete recommendation for Strata

Add this next:

Opt-in ChangeCollector
├── exact component set/add/remove events
├── exact entity destruction
├── reset marker
├── per-collector deduplication
├── independent drain cursor
└── conservative archetype fallback for raw column writes

Do not add fixed-size chunks or universally maintained changed-row lists yet.

For the spatial-index case, the resulting architecture would be:

Position / Size sparse writes
        ↓ exact entities
Raw typed-array writers
        ↓ coarse archetypes
Structural add/remove/destroy
        ↓ exact transitions
        ChangeCollector
              ↓
         spatialSync
              ↓
      RBush + SpatialVersion

So the direct choice from the earlier list is option 1, implemented as an opt-in, pull-based, hybrid exact/coarse collector. Strata already has the useful part of option 3; the collector is what would add a genuinely new capability.
