/**
 * The reflector registry (design-002 §5).
 *
 * Reflectors are the ONLY writers of DOM/GL/R3F, run AFTER `notify()`, and
 * never write ECS (L10). The registry arms strata observers ONCE per reflector
 * at registration; observer fires during `notify()` coalesce into a per-
 * reflector dirty flag; `flushAll()` (called by `engine.step()` post-notify)
 * flushes dirty (or `always`) reflectors in registration order.
 *
 * - **First paint**: every reflector registers dirty, so its first `flushAll`
 *   paints unconditionally — `observeResource` has no `immediate` option and a
 *   world populated before registration never stamps for it (same seed
 *   `observeQuery`'s `immediate` would give, applied uniformly).
 * - **Fault isolation**: a throwing reflector is skipped this frame (its dirty
 *   flag clears — a faulty reflector must not re-fire hot on a static scene);
 *   system throws, by contrast, propagate loudly out of `world.tick()`.
 * - **Write ban**: strata's emit-flag rejects ECS writes inside observer
 *   callbacks, but reflector `flush` runs after the emit window — DEV
 *   enforcement of the reflect write-ban is deferred (design-002 §8);
 *   the contract still binds.
 * - Arming any observer permanently arms reactivity stamping (+17–28% on
 *   write-heavy paths — design-002 §4, budgeted).
 */
import type { Component, Query, Resource, World } from "@vibecook/strata-ecs";

export interface ReflectorQuerySpec {
  readonly q: Query;
  /** Narrow the Tier-1 wake set to these value columns (plus membership). */
  readonly cols?: readonly Component[];
}

export interface ReflectorObserve {
  readonly queries?: readonly ReflectorQuerySpec[];
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous resource list; S is erased at observe time
  readonly resources?: readonly Resource<any>[];
}

export interface ReflectorDef {
  /** Display name (telemetry, fault reports). */
  readonly name: string;
  readonly observe?: ReflectorObserve;
  /** Flush every frame regardless of dirt (cheap-overlay style, v1 lesson). */
  readonly always?: boolean;
  /** Batched output writes; NEVER write ECS, never read layout (L10). */
  readonly flush: (world: World) => void;
}

export interface ReflectorRegistry {
  /** Arm observers and enroll; returns an unregister (unsubscribes, removes). */
  register(def: ReflectorDef): () => void;
  /** Post-notify: flush dirty/`always` reflectors in registration order. */
  flushAll(): void;
  /** Names flushed on the most recent `flushAll` (telemetry). */
  lastFlushed(): readonly string[];
  /** Every registered reflector, registration order (devtools enumeration —
   *  independent of telemetry; a reflector idle since boot still lists). */
  names(): readonly string[];
}

interface Entry {
  readonly def: ReflectorDef;
  dirty: boolean;
  readonly unsubs: (() => void)[];
}

export function createReflectorRegistry(
  world: World,
  opts?: { onFault?: (name: string, err: unknown) => void },
): ReflectorRegistry {
  const entries: Entry[] = [];
  let flushed: string[] = [];
  const onFault =
    opts?.onFault ??
    ((name: string, err: unknown) => {
      console.error(`[ice] reflector "${name}" threw — skipped this frame`, err);
    });

  return {
    register(def) {
      const entry: Entry = { def, dirty: true, unsubs: [] };
      const wake = () => {
        entry.dirty = true;
      };
      for (const spec of def.observe?.queries ?? []) {
        entry.unsubs.push(
          world.reactive.observeQuery(spec.q, wake, spec.cols ? { cols: spec.cols } : undefined),
        );
      }
      for (const res of def.observe?.resources ?? []) {
        entry.unsubs.push(world.reactive.observeResource(res, wake));
      }
      entries.push(entry);
      return () => {
        for (const u of entry.unsubs) u();
        entry.unsubs.length = 0;
        const i = entries.indexOf(entry);
        if (i !== -1) entries.splice(i, 1);
      };
    },

    flushAll() {
      flushed = [];
      for (const entry of entries) {
        if (!entry.dirty && entry.def.always !== true) continue;
        entry.dirty = false;
        try {
          entry.def.flush(world);
          flushed.push(entry.def.name);
        } catch (err) {
          onFault(entry.def.name, err);
        }
      }
    },

    lastFlushed() {
      return flushed;
    },

    names() {
      return entries.map((e) => e.def.name);
    },
  };
}
