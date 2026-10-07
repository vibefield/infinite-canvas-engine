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
 * WHERE A PEER IS (petition I42): a peer whose cursor says `away`, or whose
 * `canvas` is not this receiver's own (`presenceCanvasOf` — its coordinates are
 * frame-local to a canvas this one is not in), has NO hand here: none is
 * spawned, and one already pooled is reaped — so `@ice/dom`'s remote-cursor
 * chips (drawn from these entities) hide it, and a host reading the hands sees
 * the same. The peer entity and its facet stay (a host drawing people itself
 * reads `away`/`canvas` there). A peer with neither field (an older peer) is
 * present, on the root.
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
import { createPresencePublish, type PresencePublishOpts, presenceCanvasOf } from "./publish";
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

/**
 * Where this receiver is, for a remote cursor's `canvas` to be compared with (petition I42): its own peer id (a keyless container's
 * name is per peer) and the doc session's `keyOf`. Absent: "" at the root and a keyless name inside — no remote peer is drawn in a
 * container then.
 */
export interface RemoteCursorsOpts {
  readonly keyOf?: (e: Entity) => string | undefined;
  readonly peerId?: string;
}

/** The pool + system + reap triple `installPresence` owns (pool lifetime = install lifetime). */
function createRemoteCursorsRig(world: World, opts: RemoteCursorsOpts = {}): RemoteCursorsRig {
  const pool = new Map<Entity, PoolEntry>();

  const system = defineTickSystem(
    (ctx) => {
      const live = new Set<Entity>();
      const here = presenceCanvasOf(world, opts.peerId ?? "", opts.keyOf);
      ctx.query(remotePeerCursorsQ).each((b) => {
        for (const r of b) {
          const peer = b.entity(r);
          const pc = ctx.read(peer, PresenceCursor);
          if (pc.away || (pc.canvas ?? "") !== here) continue;   // away, or in another canvas: no hand here (one pooled is reaped below)
          live.add(peer);
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

      // Reap cursors whose peer despawned, dropped its PresenceCursor facet, went away or is in another canvas.
      for (const [peer, entry] of [...pool]) {
        if (!live.has(peer)) {
          ctx.destroy(entry.cursor);
          pool.delete(peer);
        }
      }
    },
    {
      name: "remoteCursors",
      // orderIndependent: every row this system writes is its OWN pool's
      // cursor entity (one per remote peer) — row-disjoint from any other
      // Position writer by construction. The attestation is what lets a
      // userland `present`-phase behavior that co-writes Position silence
      // strata's double-writer advisory from its own side: suppression is
      // conjunctive over ALL co-writers, so an un-attested engine system
      // would make the warning unsilenceable for authors doing it right
      // (0.8.0 review finding).
      access: { write: [Position, CursorVisual], orderIndependent: [Position] },
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
export function createRemoteCursorsSystem(world: World, opts: RemoteCursorsOpts = {}): TickSystem {
  return createRemoteCursorsRig(world, opts).system;
}

export type InstallPresenceOpts = PresencePublishOpts;

/**
 * Wire a presence session into an engine: the publish hook (outbound facet
 * derivation) + the remote-cursor system (`present` phase). Returns an
 * uninstall that removes both AND destroys the system's pooled cursor
 * entities — uninstalling on a live document must not leave ghost cursors
 * (a between-frames call, like every teardown here). Does NOT own the
 * session's lifecycle — call `session.detach()` separately.
 *
 * THE HOST'S AWAY BETWEEN FRAMES (petition I42): `session.setAway` runs the
 * publish once more right after the call — a microtask, so never inside a step,
 * change-only as ever — so the facet reaches the room even while the loop
 * sleeps or the frame gate holds a park (a cover that freezes the desk and says
 * the peer is away, in either order).
 */
export function installPresence(
  engine: Engine,
  session: PresenceSession,
  opts: InstallPresenceOpts = {},
): () => void {
  const publish = createPresencePublish(engine.world, session, opts);
  const removePublish = engine.onPublish(publish);
  let installed = true;
  const stopAway = session.onAway(() => {
    queueMicrotask(() => {
      if (installed && !engine.frame.stepping()) publish(engine.world);
    });
  });
  const rig = createRemoteCursorsRig(engine.world, { peerId: session.peerId, ...(opts.keyOf !== undefined ? { keyOf: opts.keyOf } : {}) });
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
    installed = false;
    stopAway();
    removePublish();
    removeSystem();
    rig.reap();
  };
}
