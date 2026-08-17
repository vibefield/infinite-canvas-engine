/**
 * Remote-cursor projection (design-001 §5.6; design-003 §7 "remote cursors are
 * always custom nodes" — the §7 PHASE language covers the LOCAL L4 cursor, not
 * this system).
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
 * this system (in the `present` phase — presentation derivation, no in-tick
 * consumers), returning one uninstall.
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

interface RemoteCursorsRig {
  readonly system: TickSystem;
  /**
   * Destroy every pooled cursor entity and forget the pool (between frames —
   * uninstall's slot). The tick body reaps a cursor when its PEER dies, but
   * removing the SYSTEM removes the reaper: detaching presence on a
   * still-open document (petition I18's inverse) would otherwise strand every
   * pooled cursor as a ghost frozen on canvas. The join path never saw this —
   * `docs.close()` follows its presence teardown with an in-place world reset
   * that killed the strands before anyone looked.
   */
  reap(): void;
}

/** The pool + system + reap triple `installPresence` owns (pool lifetime = install lifetime). */
function createRemoteCursorsRig(world: World): RemoteCursorsRig {
  const pool = new Map<Entity, PoolEntry>();

  const system = defineTickSystem(
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

  return {
    system,
    reap() {
      for (const [, entry] of pool) {
        if (world.isAlive(entry.cursor)) world.destroy(entry.cursor);
      }
      pool.clear();
    },
  };
}

/**
 * The tick system that pools + reaps remote cursor entities — standalone
 * export for imperative rigs, which choose their own phase (`installPresence`
 * registers its own copy in `present`, and builds it through a rig so its
 * uninstall can reap the pool too).
 */
export function createRemoteCursorsSystem(world: World): TickSystem {
  return createRemoteCursorsRig(world).system;
}

export type InstallPresenceOpts = PresencePublishOpts;

/**
 * Wire a presence session into an engine: the publish hook (outbound facet
 * derivation) + the remote-cursor system (`present` phase). Returns an
 * uninstall that removes both AND destroys the system's pooled cursor
 * entities — uninstalling on a live document must not leave ghost cursors
 * (a between-frames call, like every teardown here). Does NOT own the
 * session's lifecycle — call `session.detach()` separately.
 */
export function installPresence(
  engine: Engine,
  session: PresenceSession,
  opts: InstallPresenceOpts = {},
): () => void {
  const removePublish = engine.onPublish(createPresencePublish(engine.world, session, opts));
  const rig = createRemoteCursorsRig(engine.world);
  // "present", not "derive" (2026-08-16, with I18): cursor visuals are
  // presentation derivation with NO in-tick consumers — only reflectors read
  // them, post-notify, which sees present-phase writes the same frame. In
  // "derive" the late-installed system co-wrote Position after the stack's
  // readers/writers (selectionChrome, cull) and strata's access advisories
  // fired on every presence-attached facade engine — row-disjoint in truth,
  // but the read-before-write advisory has no attestation opt-out, and the
  // phase that matches the system's meaning is also the one with no
  // neighbours to misread it.
  const removeSystem = engine.addSystems("present", rig.system);
  return () => {
    removePublish();
    removeSystem();
    rig.reap();
  };
}
