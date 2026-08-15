/**
 * The `derived` differ (design-009 §3, BF-D5) — M13c.
 *
 * A derived behavior recomputes from other state, so it re-writes the same
 * values constantly. Left alone that is a CRDT catastrophe: every frame of
 * churn becomes journal entries, undo steps, and wire bytes for values that did
 * not change. The differ makes a derived commit cost nothing when nothing moved.
 *
 * Three protections ride together, and they only make sense together:
 *
 * 1. **Value writes equal to the current projection are dropped.** Equality is
 *    strata's OWN — `valueEquals`, the predicate reconcile itself judges
 *    settlement by. A hand-rolled comparison WOULD drift on exactly the cells
 *    reconcile considers settled (f32 fround, integer wrap, enum labels, ±0
 *    collapse), which is the one place a differ must never disagree.
 * 2. **Structural ops are diffed too** — attach-when-attached falls through to
 *    a value diff, detach-when-absent and destroy-when-dead are dropped, and
 *    `spawn` under `derived` throws outright (a derived behavior that mints
 *    entities has no convergent story; `tx.ensure` is the named seam).
 *    Without this the differ was writable around: one structural op per frame
 *    and the whole protection lapses.
 * 3. **Zero remaining ops opens NO transaction.** Not an empty one — none.
 *
 * The buffering this requires is not a cost, it is the enabler: `undoable` has
 * to be decided BEFORE the transaction opens, and whether a commit is derived
 * OUTPUT (never undoable — ⌘Z must not un-derive) or an authorial config edit
 * (ordinarily undoable) is only knowable once you have seen its ops.
 */
import { valueEquals } from "@vibecook/strata-ecs";
import type { Component, Entity, OrderPlace, Relation, Tag, World } from "@vibecook/strata-ecs";
import { Position } from "../catalog";
import type { GuardedTx } from "../guards/guarded-tx";

export type RecOp =
  | { readonly kind: "set"; readonly e: Entity; readonly c: Component; readonly v: unknown }
  | { readonly kind: "add"; readonly e: Entity; readonly c: Component; readonly v: unknown }
  | { readonly kind: "removeComponent"; readonly e: Entity; readonly c: Component }
  | { readonly kind: "destroy"; readonly e: Entity }
  | { readonly kind: "addTag"; readonly e: Entity; readonly t: Tag }
  | { readonly kind: "removeTag"; readonly e: Entity; readonly t: Tag }
  | { readonly kind: "setRelation"; readonly e: Entity; readonly r: Relation; readonly target: Entity; readonly place?: OrderPlace }
  | { readonly kind: "addRelation"; readonly e: Entity; readonly r: Relation; readonly target: Entity }
  | { readonly kind: "removeRelation"; readonly e: Entity; readonly r: Relation; readonly target?: Entity }
  | { readonly kind: "moveRelation"; readonly e: Entity; readonly r: Relation; readonly place: OrderPlace }
  | { readonly kind: "move"; readonly e: Entity; readonly to: { x: number; y: number }; readonly animateMs: number };

export interface DiffDeps {
  readonly world: World;
  /** The DOC's value for a cell — what a commit would actually be compared to. */
  docValue(e: Entity, c: Component): unknown;
  /** The behavior's declared `writes:` targets (the derived-output test). */
  readonly writeTargets: ReadonlySet<Component>;
}

export interface DiffResult {
  readonly ops: readonly RecOp[];
  /**
   * The commit touches a declared `writes:` target — it is derived OUTPUT, so
   * it is forced non-undoable. A commit that only touches the behavior's OWN
   * data is an authorial config edit and keeps normal undo.
   */
  readonly derivedOutput: boolean;
  /** Entities this commit wrote — the next drain's subtraction set. */
  readonly writtenEntities: readonly Entity[];
  /**
   * The VALUES the surviving ops commit, per entity per component. The echo
   * snapshot needs these rather than a post-seal world read: a durable write
   * lands in the doc now but projects into the world at the NEXT `world.sync()`,
   * so reading the world here would capture the value the commit is replacing.
   */
  readonly writtenValues: ReadonlyMap<Entity, ReadonlyMap<Component, unknown>>;
}

/**
 * Record a DERIVED commit body's ops without performing any of them. Only the
 * derived path buffers: a plain durable behavior commits straight through, so
 * it keeps `tx.spawn` and pays no recording cost.
 */
export function recordDerivedOps(behaviorName: string, build: (rec: GuardedTx) => void): RecOp[] {
  const ops: RecOp[] = [];
  const refuseSpawn = (): never => {
    throw new Error(
      `ice: behavior "${behaviorName}" called tx.spawn under derived: true — a derived behavior may not spawn entities (design-009 §11). Its output must be a function of state that already exists; \`tx.ensure(key, …)\` is the named idempotent-spawn seam.`,
    );
  };
  const editor = (e: Entity) => {
    const chain = {
      set(c: Component, v: unknown) {
        ops.push({ kind: "set", e, c, v });
        return chain;
      },
    };
    return chain;
  };
  const rec = {
    spawnPrefab: refuseSpawn,
    spawn: refuseSpawn,
    destroy: (e: Entity) => ops.push({ kind: "destroy", e }),
    addComponent: (e: Entity, c: Component, v: unknown) => ops.push({ kind: "add", e, c, v }),
    removeComponent: (e: Entity, c: Component) => ops.push({ kind: "removeComponent", e, c }),
    edit: editor,
    addTag: (e: Entity, t: Tag) => ops.push({ kind: "addTag", e, t }),
    removeTag: (e: Entity, t: Tag) => ops.push({ kind: "removeTag", e, t }),
    setRelation: (e: Entity, r: Relation, target: Entity, place?: OrderPlace) =>
      ops.push({ kind: "setRelation", e, r, target, ...(place !== undefined ? { place } : {}) }),
    addRelation: (e: Entity, r: Relation, target: Entity) => ops.push({ kind: "addRelation", e, r, target }),
    removeRelation: (e: Entity, r: Relation, target?: Entity) =>
      ops.push({ kind: "removeRelation", e, r, ...(target !== undefined ? { target } : {}) }),
    moveRelation: (e: Entity, r: Relation, place: OrderPlace) => ops.push({ kind: "moveRelation", e, r, place }),
    setResource: () => {
      throw new Error(`ice: behavior "${behaviorName}" called tx.setResource — behaviors do not write resources.`);
    },
    move: (e: Entity, to: { x: number; y: number }, o?: { animateMs?: number }) =>
      ops.push({ kind: "move", e, to, animateMs: o?.animateMs ?? 0 }),
  };
  build(rec as unknown as GuardedTx);
  return ops;
}

export function diffOps(ops: readonly RecOp[], deps: DiffDeps): DiffResult {
  const kept: RecOp[] = [];
  const written = new Set<Entity>();
  const values = new Map<Entity, Map<Component, unknown>>();
  const noteValue = (e: Entity, c: Component, v: unknown): void => {
    let byComponent = values.get(e);
    if (byComponent === undefined) {
      byComponent = new Map();
      values.set(e, byComponent);
    }
    byComponent.set(c, v);
  };
  let derivedOutput = false;

  for (const op of ops) {
    switch (op.kind) {
      case "set":
      case "add": {
        const current = deps.docValue(op.e, op.c);
        // `undefined` means CELL ABSENT — an add, never a no-op. Present and
        // canonically equal means the CRDT would stage nothing: drop it here so
        // no journal entry, no undo step and no wire bytes are produced either.
        if (current !== undefined && valueEquals(op.c, op.v, current)) continue;
        if (deps.writeTargets.has(op.c)) derivedOutput = true;
        written.add(op.e);
        noteValue(op.e, op.c, op.v);
        kept.push(op);
        break;
      }
      case "removeComponent": {
        if (!deps.world.isAlive(op.e) || !deps.world.has(op.e, op.c)) continue;
        if (deps.writeTargets.has(op.c)) derivedOutput = true;
        written.add(op.e);
        kept.push(op);
        break;
      }
      case "destroy": {
        if (!deps.world.isAlive(op.e)) continue;
        written.add(op.e);
        kept.push(op);
        break;
      }
      case "addTag": {
        if (deps.world.isAlive(op.e) && deps.world.hasTag(op.e, op.t)) continue;
        written.add(op.e);
        kept.push(op);
        break;
      }
      case "removeTag": {
        if (!deps.world.isAlive(op.e) || !deps.world.hasTag(op.e, op.t)) continue;
        written.add(op.e);
        kept.push(op);
        break;
      }
      case "setRelation": {
        // An edge already pointing at the same target with no reorder asked for
        // is the relation twin of a same-value write.
        if (op.place === undefined && deps.world.getRelation(op.e, op.r) === op.target) continue;
        written.add(op.e);
        kept.push(op);
        break;
      }
      case "removeRelation": {
        if (deps.world.getRelations(op.e, op.r).length === 0) continue;
        written.add(op.e);
        kept.push(op);
        break;
      }
      case "move": {
        // `move` IS diffed, and the reason it is safe to diff is petition I15's
        // two chokepoints. The worry was a glide in flight: drop the move and
        // the tween keeps easing toward a stale target. But every path that
        // moves the durable value — a post-seal write, an undo — already
        // retargets live tweens onto doc truth, so "the doc already says `to`"
        // means "any live tween already aims at `to`". There is nothing to
        // strand.
        //
        // Not diffing it was not a small conservatism: the flagship path
        // commits its whole layout through `move`, so an undiffed move meant
        // every peer that merely OPENED a laid-out document immediately wrote
        // the same layout back to it.
        const current = deps.docValue(op.e, Position as Component) as
          | { x: number; y: number }
          | undefined;
        if (current !== undefined && valueEquals(Position as Component, { x: op.to.x, y: op.to.y }, current)) {
          continue;
        }
        if (deps.writeTargets.has(Position as Component)) derivedOutput = true;
        noteValue(op.e, Position as Component, { x: op.to.x, y: op.to.y });
        written.add(op.e);
        kept.push(op);
        break;
      }
      default: {
        written.add(op.e);
        kept.push(op);
        break;
      }
    }
  }

  return { ops: kept, derivedOutput, writtenEntities: [...written], writtenValues: values };
}

/** Replay diffed ops onto the real transaction. */
export function replayOps(ops: readonly RecOp[], tx: GuardedTx): void {
  for (const op of ops) {
    switch (op.kind) {
      case "set":
        tx.edit(op.e).set(op.c as Component<unknown>, op.v);
        break;
      case "add":
        tx.addComponent(op.e, op.c as Component<unknown>, op.v);
        break;
      case "removeComponent":
        tx.removeComponent(op.e, op.c);
        break;
      case "destroy":
        tx.destroy(op.e);
        break;
      case "addTag":
        tx.addTag(op.e, op.t);
        break;
      case "removeTag":
        tx.removeTag(op.e, op.t);
        break;
      case "setRelation":
        tx.setRelation(op.e, op.r, op.target, op.place);
        break;
      case "addRelation":
        tx.addRelation(op.e, op.r, op.target);
        break;
      case "removeRelation":
        tx.removeRelation(op.e, op.r, op.target);
        break;
      case "moveRelation":
        tx.moveRelation(op.e, op.r, op.place);
        break;
      case "move":
        tx.move(op.e, op.to, { animateMs: op.animateMs });
        break;
    }
  }
}
