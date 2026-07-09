/**
 * The paved-road runtime-resource write (design-001 §2 rule 7) — the mirror
 * image of guarded-tx's `tx.setResource` check. A resource declares its write
 * path once at `defineResource` (`durable` vs `runtime`), and the two ends
 * enforce it symmetrically: `tx.setResource` rejects a RUNTIME resource inside
 * a transaction; `writeRuntimeResource` rejects a DURABLE resource on the
 * runtime world. Systems have no `ctx` resource API, so they write runtime
 * resources through the closed-over `world.setResource` (design-002 §3) — this
 * facade is that write, made DEV-checked.
 *
 * Unknown resources — anything not defined through `../schema/meta`'s
 * `defineResource` wrapper — carry no schemaMeta, so the check finds nothing
 * and the write passes untouched. The guard is best-effort by design, exactly
 * like guarded-tx's prefab-eligibility checks.
 */
import type { Resource, World } from "@vibecook/strata-ecs";
import { schemaMeta } from "../schema/meta";
import { devGuardsEnabled } from "./dev";

export function writeRuntimeResource<S>(world: World, res: Resource<S>, v: S): void {
  if (devGuardsEnabled()) {
    const meta = schemaMeta.resource(res as Resource);
    if (meta?.durable) {
      throw new Error(
        `ice: writeRuntimeResource: resource "${meta.name}" is declared durable — durable resources are written in transactions (tx.setResource), not through the runtime world (design-001 §2 rule 7).`,
      );
    }
  }
  world.setResource(res, v);
}
