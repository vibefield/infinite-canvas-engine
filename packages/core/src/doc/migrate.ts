/**
 * The M9 migration runner — read-repair at open (design-005 §6.4).
 *
 * A migration is NOT an offline byte transform: the document is already
 * attached, its old cells projected into the runtime, and we upgrade them in
 * place. For each durable type whose doc-side pack marker is OLDER than the
 * local registry (`report.olderInDoc`) and whose widget carries a `migrate`
 * chain covering the gap, `runMigrations`:
 *   1. reads each entity's current group values from the runtime (already
 *      canonicalised to the LOCAL schema — see the field-tolerance note below),
 *   2. folds the chain `docV → docV+1 → … → localV-1` over a flat prop record,
 *   3. writes the absolute per-group result back in ONE
 *      `store.transaction(fn, { undoable: false })` — the commit never enters
 *      the user's undo stack, history hooks skip it, a pending redo survives,
 *   4. stamps the new `engine.pack.<id>.<localV>` write-once marker via
 *      `store.metaTransaction` (excluded from undo, invisible to observers).
 *
 * WHY NO LEGACY-SCHEMA REGISTRATION (the as-built finding — design-005 §6.4 is
 * conservative here): design-005 says "the compiler keeps legacy group
 * components registered for every version covered by the migrate chain" because
 * "strata skips unknown inbound components at projection." That is TRUE at the
 * COMPONENT-NAME granularity — an unknown component name is never projected
 * (strata-ecs binding.ts:390-392, 804; "unknown component — never projected").
 * But it is field-TOLERANT within a known name: `canon(C, v)` iterates the
 * LOCAL schema's `C.fields` (strata-ecs substrate/canon.ts:57-64), so a stored
 * cell that carries EXTRA fields (a v2 that dropped a field) has them dropped,
 * and one MISSING fields (a v2 that added a field) gets them default-filled by
 * `encodeComponentValue`. Because `defineWidget` gives EVERY generated field a
 * default (define-widget.ts strataFieldOf), a v1 cell projects cleanly into a
 * v2 group component of the SAME name with no legacy registration — the
 * transform reads the already-v2-shaped runtime value. Legacy registration
 * would only be needed to migrate data OUT of a group REMOVED wholesale in v2
 * (its component name unregistered → never projected); that coincides with the
 * cross-schema data movement design-005 §6.4 already defers to vNext, so the
 * `migrate` API stays the doc's `{ fromVersion: (prev) => next }` shape with no
 * parallel legacy field. The `migrate.test.ts` "field tolerance" case proves
 * the v1→v2 projection empirically (a v1 cell missing a v2-added field).
 *
 * Idempotence / convergence: writes are ABSOLUTE (whole-group values computed
 * from v1), so two peers that migrate the same v1 doc independently produce
 * identical cells that merge by last-writer-wins, and the marker is a
 * first-writer-wins ADD. Re-opening an already-migrated doc reads the v2 marker
 * → the type is no longer `olderInDoc` → the runner skips it. The runner must
 * therefore run once per open against the open-time report (the caller re-gates
 * after it, never re-invokes it against the same report).
 */
import type { Component, Entity, World } from "@vibecook/strata-ecs";
import { defineQuery } from "@vibecook/strata-ecs";
import type { DurableStore } from "@vibecook/strata-ecs/durable";
import { PrefabId } from "../schema/prefab";
import { widgets } from "../widget/define-widget";
import type { DocVersionReport } from "./version-gate";

/** Same reserved prefix as version-gate's markers (that module owns the read side). */
const PACK_PREFIX = "engine.pack.";

/** What the runner needs: the doc store to write through, the world to read from. */
export interface MigrationCtx {
  readonly store: DurableStore;
  readonly world: World;
}

export interface MigrationOutcome {
  /** Type ids whose entities were upgraded and whose v-local marker was stamped. */
  readonly migrated: string[];
  /** Type ids left as-is (no widget, no/gappy chain) — they stay read-only per the re-gate. */
  readonly skipped: string[];
}

// One durable-identity query, reused across opens (defineQuery interns; a module
// singleton avoids re-defining per call).
const allDurableQ = defineQuery([PrefabId]);

interface EntityPlan {
  readonly e: Entity;
  /** The transform's absolute output — a flat prop record spanning every group. */
  readonly next: Record<string, unknown>;
  /** Component ids present on the entity NOW (edit vs add decision at write time). */
  readonly present: ReadonlySet<number>;
}

interface TypePlan {
  readonly id: string;
  readonly widget: NonNullable<ReturnType<typeof widgets.get>>;
  readonly localV: number;
  readonly plans: EntityPlan[];
}

/**
 * Run every applicable per-type migration against an ATTACHED doc. ALL types
 * are planned (read + transform-fold) BEFORE anything is written — a throwing
 * transform on the Nth type therefore aborts with the document untouched,
 * never with types 1..N-1 permanently migrated and the rest old (2026-07-13
 * review). Each type then writes one non-undoable transaction and stamps its
 * marker. Never throws for a merely-un-migratable type (missing widget /
 * gappy chain → skipped); a genuine fault (a throwing transform) propagates so
 * the caller can fall back read-only.
 */
export function runMigrations(ctx: MigrationCtx, report: DocVersionReport): MigrationOutcome {
  const { store, world } = ctx;
  const migrated: string[] = [];
  const skipped: string[] = [];

  // --- plan pass: every type's reads + chain folds, NO writes yet ---
  const typePlans: TypePlan[] = [];
  for (const id of report.olderInDoc) {
    const widget = widgets.get(id);
    const chain = widget?.migrate;
    if (widget === undefined || chain === undefined || Object.keys(chain).length === 0) {
      skipped.push(id); // no widget or no chain → cannot upgrade; the re-gate keeps it read-only
      continue;
    }

    const docV = report.docPacks[id] ?? 1;
    const localV = report.localPacks[id] ?? widget.version;

    // The chain must cover every step fromVersion docV..localV-1. A gap means we
    // cannot reach localV from docV safely — skip the whole type (stays read-only)
    // rather than half-apply. (defineWidget already warns at definition time.)
    let contiguous = true;
    for (let v = docV; v < localV; v++) {
      if (typeof chain[v] !== "function") {
        contiguous = false;
        break;
      }
    }
    if (!contiguous) {
      skipped.push(id);
      continue;
    }

    // Gather each entity's current props + fold the chain (transforms run HERE,
    // pre-write — their throws leave the doc byte-identical).
    const plans: EntityPlan[] = [];
    world.query(allDurableQ).each((batch) => {
      for (const row of batch) {
        const e = batch.entity(row);
        if (world.read(e, PrefabId).id !== id) continue;

        const prev: Record<string, unknown> = {};
        const present = new Set<number>();
        for (const g of widget.groups) {
          const val = world.get(e, g.component);
          if (val === undefined) continue; // an added-in-v2 group has no v1 cell — written fresh below
          present.add(g.component.id);
          Object.assign(prev, val as Record<string, unknown>);
        }

        let cur = prev;
        for (let v = docV; v < localV; v++) {
          const step = chain[v];
          if (typeof step === "function") cur = step(cur); // contiguity checked above
        }
        plans.push({ e, next: cur, present });
      }
    });
    typePlans.push({ id, widget, localV, plans });
  }

  // --- write pass: per type, ONE non-undoable transaction of absolute per-group
  // writes. `edit().set` / `addComponent` canon the value against the group
  // schema, so a flat `next` spanning all groups is picked apart per group
  // (extra keys ignored, missing declared-default keys default-filled).
  for (const { id, widget, localV, plans } of typePlans) {
    store.transaction(
      (tx) => {
        for (const { e, next, present } of plans) {
          for (const g of widget.groups) {
            if (present.has(g.component.id)) {
              tx.edit(e).set(g.component as Component, next);
            } else {
              // Added-in-v2 group: structure rides projection at the next sync().
              tx.addComponent(e, g.component as Component, next);
            }
          }
        }
      },
      { undoable: false },
    );

    // Stamp the reached version as a write-once marker (idempotent; first-writer-wins).
    store.metaTransaction((meta) => {
      const key = `${PACK_PREFIX}${id}.${localV}`;
      if (meta.get(key) === undefined) meta.set(key, true);
    });

    migrated.push(id);
  }

  return { migrated, skipped };
}
