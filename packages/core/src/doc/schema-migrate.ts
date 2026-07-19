/**
 * STRUCTURAL schema migrations (petition 8; engineSchema 1 → 2).
 *
 * The per-prefab runner (migrate.ts) folds per-entity group values — it cannot spawn entities,
 * see siblings, write relations, or stamp `engine.schema`, so a schema-version bump used to
 * leave old docs read-only FOREVER (the gate re-ran, saw docSchema < local, and nothing ever
 * advanced it). This module is the missing half: whole-document transforms keyed by the schema
 * version they migrate FROM, run at open on a "migrate" verdict BEFORE the pack runner, each
 * stamping `engine.schema.<n+1>` on success.
 *
 * SINGLE-WRITER LAW: a structural migration may only run when this peer is the document's sole
 * occupant — the local open path (autosave restore, file open). A LIVE-ROOM JOINER MUST NOT
 * migrate (bootstrap passes `migrate: false`): the room's peers are still writing the old
 * shape, sync never re-gates, and a mid-room migration split-brains the doc (old peers write
 * scalar z the new shape ignores, and vice versa). An old-schema doc joined live is read-only
 * until it is opened solo by a current build.
 *
 * Step 1→2 — ordered relations:
 *  1. BOARD ROOT: mint the componentless durable entity root-level widgets hang `ChildOf` on
 *     ({@link ensureBoardRoot}); its key is recorded first-writer-wins in the meta map.
 *  2. StackZ → sibling order: every durable widget is grouped by parent scope (existing
 *     `ChildOf` target, else the board root), each group sorted by `(z asc, entityKey asc)`,
 *     and re-linked in that order with `tx.setRelation(e, ChildOf, parent, "last")` — a
 *     same-target re-set WITH a place is a move, so applying in sorted order lands the sorted
 *     sequence; root-level widgets gain their first edge the same way. ONE non-undoable
 *     transaction; absolute, idempotent, convergent (same doc → same sort → same sequence).
 *  3. The legacy `StackZ` CELLS ARE KEPT: an old build opening the migrated doc read-only
 *     (docSchema newer than local) still paints z-correct from them. New entities never write
 *     StackZ; the cells are simply never read by current builds outside the legacy fallback.
 */
import type { Entity, EntityKey, World } from "@vibecook/strata-ecs";
import { defineQuery } from "@vibecook/strata-ecs";
import type { DurableStore } from "@vibecook/strata-ecs/durable";
import { ChildOf, StackZ } from "../catalog/scene";
import { PrefabId } from "../schema/prefab";
import type { MigrationCtx } from "./migrate";
import { ENGINE_SCHEMA_VERSION } from "./envelope";
import type { DocVersionReport } from "./version-gate";

const SCHEMA_PREFIX = "engine.schema.";
/** Meta key holding the board-root's EntityKey (a VALUE key, unlike the presence markers). */
const BOARD_ROOT_META = "engine.boardRoot";

// Durable-identity + legacy-z queries (module singletons; defineQuery interns).
const allDurableQ = defineQuery([PrefabId]);

/**
 * Resolve the document's board root, minting it if absent (create path + step 1→2). The mint
 * is a componentless `tx.spawn()` in a non-undoable transaction; the key is recorded in meta
 * first-writer-wins and re-read after the write so a raced winner is honored (the single-writer
 * law makes a race unreachable in practice — belt and braces). Returns the LIVE handle.
 */
export function ensureBoardRoot(world: World, store: DurableStore): Entity {
  let recorded: string | undefined;
  store.metaTransaction((meta) => {
    const v = meta.get(BOARD_ROOT_META);
    if (typeof v === "string") recorded = v;
  });
  if (recorded !== undefined) {
    const e = store.resolve(recorded as EntityKey);
    if (e !== undefined && world.isAlive(e)) return e;
  }
  const minted = store.transaction((tx) => tx.spawn(), { undoable: false });
  const mintedKey = store.keyOf(minted);
  if (mintedKey === undefined) throw new Error("ice: board-root mint failed to bind a key.");
  store.metaTransaction((meta) => {
    if (meta.get(BOARD_ROOT_META) === undefined) meta.set(BOARD_ROOT_META, mintedKey as unknown as string);
  });
  let winner: string = mintedKey as unknown as string;
  store.metaTransaction((meta) => {
    const v = meta.get(BOARD_ROOT_META);
    if (typeof v === "string") winner = v;
  });
  return store.resolve(winner as EntityKey) ?? minted;
}

/** Read the board-root handle WITHOUT minting — read-only opens and post-attach lookups. */
export function resolveBoardRoot(world: World, store: DurableStore): Entity | undefined {
  let recorded: string | undefined;
  store.metaTransaction((meta) => {
    const v = meta.get(BOARD_ROOT_META);
    if (typeof v === "string") recorded = v;
  });
  if (recorded === undefined) return undefined;
  const e = store.resolve(recorded as EntityKey);
  return e !== undefined && world.isAlive(e) ? e : undefined;
}

/** Step 1→2: board root + StackZ→sibling-order rewrite (header). */
function migrateToOrderedRelations(ctx: MigrationCtx): void {
  const { store, world } = ctx;
  const root = ensureBoardRoot(world, store);

  // Group every durable widget by parent scope; sort each group (z asc, entityKey asc).
  const groups = new Map<Entity, { e: Entity; z: number; key: string }[]>();
  world.query(allDurableQ).each((batch) => {
    for (const row of batch) {
      const e = batch.entity(row);
      if (e === root) continue;
      const key = store.keyOf(e);
      if (key === undefined) continue;
      const parent = world.getRelation(e, ChildOf) ?? root;
      const z = world.get(e, StackZ)?.z ?? 0; // legacy cell; absent (post-flip spawns) sorts at 0
      let g = groups.get(parent);
      if (g === undefined) {
        g = [];
        groups.set(parent, g);
      }
      g.push({ e, z, key: key as unknown as string });
    }
  });
  for (const g of groups.values()) {
    g.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  // ONE non-undoable transaction: re-link in sorted order. Same-target re-set WITH a place is
  // a move (never a duplicate), so this is exact for already-parented children and appends
  // root-level widgets in sorted order.
  store.transaction(
    (tx) => {
      for (const [parent, g] of groups) {
        for (const { e } of g) tx.setRelation(e, ChildOf, parent, "last");
      }
    },
    { undoable: false },
  );
}

/** Structural steps keyed by the schema version they migrate FROM. */
const STEPS: Record<number, (ctx: MigrationCtx) => void> = {
  1: migrateToOrderedRelations,
};

/**
 * Run the structural chain `docSchema → … → localSchema`, stamping `engine.schema.<n+1>` after
 * each step. A gap (missing step) stops the walk — the caller's re-gate keeps the doc
 * read-only, exactly like a gappy pack chain. A docSchema of 0 is the gate's "reject" domain
 * and never reaches here. Returns true when the doc reached the local schema version.
 */
export function runSchemaMigrations(ctx: MigrationCtx, report: DocVersionReport): boolean {
  let v = report.docSchema;
  while (v < ENGINE_SCHEMA_VERSION) {
    const step = STEPS[v];
    if (step === undefined) return false;
    step(ctx);
    const reached = v + 1;
    ctx.store.metaTransaction((meta) => {
      const key = `${SCHEMA_PREFIX}${reached}`;
      if (meta.get(key) === undefined) meta.set(key, true);
    });
    v = reached;
  }
  return true;
}
