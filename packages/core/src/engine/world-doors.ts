/**
 * THE WORLD'S OUTSIDE DOORS (2026-09-27, ICE M21 K7a — frame-control.ts's sleep). A write made OUTSIDE a step — an app's
 * command, a rig's camera, the host's viewport sync, a document's transaction projected, a reset or an import — must wake a
 * sleeping loop, or the frame that shows it never comes. Every state-changing method strata names (`WorldMutatorName`,
 * petition 4's exhaustive list, which strata's own devwrite drift test keeps whole) is wrapped ONCE on the world instance
 * to tell its listeners after it returns; the step's own doors (`sync`, `tick`) are not wrapped. A listener decides what a
 * write means — the engine's asks the frame for a wake, which a write INSIDE a step (a system's, a publish hook's, an
 * after-step hook's) never is. The type below fails the build the day strata names a mutator this list does not.
 */
import type { World, WorldMutatorName } from "@vibecook/strata-ecs";

const DOORS = [
  "spawn",
  "destroy",
  "addComponent",
  "removeComponent",
  "addTag",
  "removeTag",
  "setRelation",
  "addRelation",
  "removeRelation",
  "moveRelation",
  "setResource",
  "updateResource",
  "removeResource",
  "edit",
  "import",
  "reset",
] as const satisfies readonly WorldMutatorName[];

/** Every mutator strata names is a door, but the step's own two — `never`, or the build names the one missing. */
type Unwatched = Exclude<WorldMutatorName, (typeof DOORS)[number] | "sync" | "tick">;
const EXHAUSTIVE: [Unwatched] extends [never] ? true : Unwatched = true;
void EXHAUSTIVE;

const watchers = new WeakMap<World, (() => void)[]>();

/** Tell `fn` after every write through one of `world`'s doors. Returns an idempotent unwatch. */
export function watchWrites(world: World, fn: () => void): () => void {
  let list = watchers.get(world);
  if (list === undefined) {
    const own: (() => void)[] = [];
    list = own;
    watchers.set(world, own);
    const w = world as unknown as Record<string, (...args: unknown[]) => unknown>;
    for (const name of DOORS) {
      const door = w[name];
      if (typeof door !== "function") continue;
      w[name] = (...args: unknown[]): unknown => {
        const out = door.apply(world, args);
        for (let i = 0; i < own.length; i++) (own[i] as () => void)();
        return out;
      };
    }
  }
  const live = list;
  live.push(fn);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const i = live.indexOf(fn);
    if (i !== -1) live.splice(i, 1);
  };
}
