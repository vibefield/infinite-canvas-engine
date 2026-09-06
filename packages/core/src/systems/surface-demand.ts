/**
 * Demand (infra) — the ONE writer of `SurfaceDemand` (design-013 §5, §6 step 3).
 *
 * Demand is two components on purpose: `RequestedDemand` is what the kind ASKS
 * for and the kind's behaviour owns it; `SurfaceDemand` is what it GETS after
 * the engine folds in what it knows, and this system owns that. Keeping the
 * request means a card that goes off-screen and comes back does not have to
 * have its wish reconstructed from a clamped value.
 *
 * The clamp is `foldDemand(wanted, facts)` from `surface/contract.ts`,
 * VERBATIM — the same tested function the old leg's binder throttles on, not a
 * second implementation of it. Its two rules, restated from that module:
 * visibility folds to paused AT THE SOURCE, which is what makes an off-screen
 * animating card genuinely free rather than merely cheap; and interaction
 * outranks a low bucket but never outranks invisibility, because a card being
 * typed into while scrolled off-screen still has no pixels anyone can see.
 *
 * The facts it folds in:
 *   visible      — the `Visible` tag (cull's own answer; `Culled` is its complement)
 *   interactive  — the entity carries `Grab`, i.e. it is under a live claim
 *
 * ── The gate ───────────────────────────────────────────────────────────────
 * A real `runIf` over the churn guard, never a body early-out: this system
 * declares `access.write`, and strata blanket-stamps a declared write for any
 * system that RUNS. `Grab` is a COMPONENT, so its attach at claim and its
 * removal at release both journal the entity through the components list — the
 * grab edges are exactly the frames this must wake on.
 *
 * Writes are change-only over all three fields. A held drag re-runs nothing:
 * `Grab` is written once at claim, and a demand that has not moved is not
 * rewritten.
 */
import type { Entity, TickSystem, World } from "@vibecook/strata-ecs";
import { defineQuery, defineTickSystem } from "@vibecook/strata-ecs";
import { Culled, Visible } from "../catalog/camera-derived";
import { Grab } from "../catalog/gesture";
import { RequestedDemand, SurfaceDemand } from "../catalog/surface";
import { foldDemand, type SurfaceDemandValue, type SurfaceFpsBucket } from "../surface/contract";
import { makeChurnGuard } from "../helpers/churn-guard";

const demandQ = defineQuery([RequestedDemand, SurfaceDemand]);

export function createSurfaceDemandSystem(world: World): TickSystem {
  const guard = makeChurnGuard(
    world,
    { components: [RequestedDemand, Grab], tags: [Visible, Culled], coarse: false },
    undefined,
  );

  return defineTickSystem(
    (ctx) => {
      const work = guard.take();
      if (work === undefined) return; // runIf false — unreachable with the guard wired

      const clamp = (e: Entity): void => {
        const requested = ctx.get(e, RequestedDemand);
        const current = ctx.get(e, SurfaceDemand);
        if (requested === undefined || current === undefined) return;
        const wanted: SurfaceDemandValue = {
          mode: requested.mode as "live" | "paused",
          fpsBucket: requested.fpsBucket as SurfaceFpsBucket,
          interactive: requested.interactive,
        };
        const next = foldDemand(wanted, {
          visible: ctx.hasTag(e, Visible),
          interactive: ctx.has(e, Grab),
        });
        if (
          current.mode !== next.mode ||
          current.fpsBucket !== next.fpsBucket ||
          current.interactive !== next.interactive
        ) {
          ctx.edit(e).set(SurfaceDemand, {
            mode: next.mode,
            fpsBucket: next.fpsBucket,
            interactive: next.interactive,
          });
        }
      };

      if (work.full) {
        ctx.query(demandQ).each((b) => {
          for (const r of b) clamp(b.entity(r));
        });
        return;
      }
      for (const e of work.changed) {
        if (!ctx.isAlive(e)) continue;
        clamp(e);
      }
    },
    { name: "surfaceDemand", access: { write: [SurfaceDemand] }, runIf: guard.runIf },
  );
}
