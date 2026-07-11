/**
 * Remote-cursor projection (design-001 §5.6, design-003 §7; `derive` phase).
 *
 * A tick system that maintains one pooled cursor entity per REMOTE presence peer
 * carrying a `PresenceCursor` (`PresencePeer` + `Not(Local)`): `CursorVisual{kind:
 * "remote"}` + `Position` (from the peer's cursor) + `Follows → peer`. Pooled and
 * change-only (a peer's cursor motion restamps one Position); reaped when the peer
 * dies (TTL/leave despawns the projected peer, so it drops out of the query) or
 * drops its cursor facet. The pool is a derived cache keyed by the peer entity
 * handle — stable while the peer is alive, gone from the query when it despawns.
 *
 * Selection summaries are intentionally NOT drawn here — M9 core keeps the
 * `SelectionSummary` facet queryable and leaves chrome rendering to the demo.
 *
 * `installPresence` is the seam: it registers the publish hook (publish.ts) and
 * this derive system, returning one uninstall.
 */
import { Not, defineQuery, defineTickSystem } from "@vibecook/strata-ecs";
import { Local } from "@vibecook/strata-ecs";
import type { Entity, TickSystem, World } from "@vibecook/strata-ecs";
import { CursorVisual, Follows, Position, PresenceCursor, PresencePeer } from "../catalog";
import type { Engine } from "../engine/engine";
import { createPresencePublish, type PresencePublishOpts } from "./publish";
import type { PresenceSession } from "./presence-kit";

const remotePeerCursorsQ = defineQuery([PresenceCursor, PresencePeer, Not(Local)]);

interface PoolEntry {
  cursor: Entity;
  x: number;
  y: number;
}

/**
 * The derive tick system that pools + reaps remote cursor entities. `world` is
 * unused directly (iteration goes through `ctx`), kept for factory symmetry with
 * the other `create*System(world)` builders.
 */
export function createRemoteCursorsSystem(_world: World): TickSystem {
  const pool = new Map<Entity, PoolEntry>();

  return defineTickSystem(
    (ctx) => {
      const live = new Set<Entity>();
      ctx.query(remotePeerCursorsQ).each((b) => {
        for (const r of b) {
          const peer = b.entity(r);
          live.add(peer);
          const pc = ctx.read(peer, PresenceCursor);
          const entry = pool.get(peer);
          if (entry === undefined) {
            // Spawn with geometry on the payload — identity-only until the phase
            // boundary, so no edit() this frame (the selectionChrome pattern).
            const cursor = ctx.spawn({
              components: [
                [Position, { x: pc.x, y: pc.y }],
                [CursorVisual, { kind: "remote", pressed: false }],
              ],
            });
            ctx.setRelation(cursor, Follows, peer); // arity "one"
            pool.set(peer, { cursor, x: pc.x, y: pc.y });
          } else if (entry.x !== pc.x || entry.y !== pc.y) {
            ctx.edit(entry.cursor).set(Position, { x: pc.x, y: pc.y });
            entry.x = pc.x;
            entry.y = pc.y;
          }
        }
      });

      // Reap cursors whose peer despawned or dropped its PresenceCursor facet.
      for (const [peer, entry] of [...pool]) {
        if (!live.has(peer)) {
          ctx.destroy(entry.cursor);
          pool.delete(peer);
        }
      }
    },
    {
      name: "remoteCursors",
      access: { write: [Position, CursorVisual] },
    },
  );
}

export type InstallPresenceOpts = PresencePublishOpts;

/**
 * Wire a presence session into an engine: the publish hook (outbound facet
 * derivation) + the remote-cursor derive system. Returns an uninstall that
 * removes both. Does NOT own the session's lifecycle — call `session.detach()`
 * separately.
 */
export function installPresence(
  engine: Engine,
  session: PresenceSession,
  opts: InstallPresenceOpts = {},
): () => void {
  const removePublish = engine.onPublish(createPresencePublish(engine.world, session, opts));
  const removeSystem = engine.addSystems("derive", createRemoteCursorsSystem(engine.world));
  return () => {
    removePublish();
    removeSystem();
  };
}
