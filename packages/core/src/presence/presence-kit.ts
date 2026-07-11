/**
 * The presence attach kit (design-005 §6.5; design-001 §5.6 presence prefab).
 *
 * `attachPresence(world, opts)` stands up ONE ephemeral presence layer per room:
 * a caller-owned Loro `EphemeralStore` → `LoroEphemeralSnapshot` (the one
 * Loro-aware adapter) → `createEphemeralStore` (writer-partitioned Mutator) →
 * `attachEphemeral` (projects every OTHER peer's blobs in as `Not(Local)`
 * entities that self-expire on TTL). The local peer is spawned once with its
 * identity (`PresenceInfo` + `PresencePeer`); `Local` is auto-applied by the
 * store (runtime-only, never transmitted). Its cursor + selection facets are
 * DYNAMIC — the publish hook (publish.ts) adds/updates/removes them per frame,
 * so a peer with no pointer carries no `PresenceCursor` and a peer with an empty
 * selection carries no `SelectionSummary` (facet presence IS the signal).
 *
 * TRANSPORT-FREE (mirrors the doc kit): the engine never owns a socket. The
 * binding's own throttle/keepalive timers hand outbound bytes to `send`, which
 * this kit fans out to `onOutbound` subscribers; inbound bytes arrive through
 * `wire.apply`. The bootstrap kit (doc/bootstrap.ts) binds both to a channel so
 * presence rides the same byte relay as the document.
 *
 * peerId MUST be session-unique (006 B5) — defaults to `crypto.randomUUID()`.
 * `detach()` is leave-then-teardown: it ships tombstones so peers despawn us
 * promptly, THEN tears the binding down (despawns projections, stops timers) and
 * destroys the Loro store we own.
 */
import { EphemeralStore as LoroEphemeralStore } from "loro-crdt";
import type { Entity, World } from "@vibecook/strata-ecs";
import {
  LoroEphemeralSnapshot,
  attachEphemeral,
  createEphemeralStore,
  type EphemeralSource,
  type EphemeralStore,
} from "@vibecook/strata-ecs/ephemeral";
import { PresenceInfo, PresencePeer } from "../catalog";

/** Default per-entry TTL — a presence entity self-expires this long after its last keepalive. */
export const DEFAULT_PRESENCE_TTL_MS = 5000;

export interface PresenceOpts {
  /** SESSION-unique peer id (006 B5). Defaults to `crypto.randomUUID()`. */
  readonly peerId?: string;
  /** Display name — must be real (bare, no default). */
  readonly name: string;
  /** Display color — must be real (bare, no default). */
  readonly color: string;
  /** Per-entry TTL (design §15.3), default {@link DEFAULT_PRESENCE_TTL_MS}. */
  readonly ttlMs?: number;
}

export interface PresenceSession {
  /** This session's peer id (the ephemeral partition prefix). */
  readonly peerId: string;
  /** The writer-partitioned Mutator for this peer's own presence entities. */
  readonly eph: EphemeralStore;
  /** The local peer entity (facets: PresenceInfo + PresencePeer + Local; cursor/selection added by publish). */
  readonly localPeer: Entity;
  /**
   * The LoroEphemeralSnapshot surface. INBOUND presence bytes go through
   * `wire.apply(bytes)`; the encoders (`encodeChanged`/`encodeKeys`/…) are
   * driven by the binding's own timers — do not call them externally.
   */
  readonly wire: EphemeralSource;
  /** Subscribe to the binding's OUTBOUND presence bytes (its two timers). Returns an unsubscribe. */
  onOutbound(fn: (bytes: Uint8Array) => void): () => void;
  /** Leave (ship tombstones) then tear down the binding + destroy the owned Loro store. Idempotent. */
  detach(): void;
}

/**
 * Attach an ephemeral presence layer to `world`. The returned session owns the
 * Loro store; the app (or the bootstrap kit) wires `wire.apply` / `onOutbound`
 * to a byte channel and installs the publish hook + remote-cursor system via
 * {@link installPresence}.
 */
export function attachPresence(world: World, opts: PresenceOpts): PresenceSession {
  const peerId = opts.peerId ?? crypto.randomUUID();
  const ttlMs = opts.ttlMs ?? DEFAULT_PRESENCE_TTL_MS;

  const loro = new LoroEphemeralStore(ttlMs);
  const source = new LoroEphemeralSnapshot(loro);

  // The binding's timers call `send`; fan it out to `onOutbound` subscribers so
  // a transport can bind AFTER attach (the doc-kit precedent — transport-free core).
  const outbound = new Set<(bytes: Uint8Array) => void>();
  const eph = createEphemeralStore(source, {
    peerId,
    ttlMs,
    send: (bytes) => {
      for (const fn of [...outbound]) fn(bytes);
    },
  });
  const attachment = attachEphemeral(world, eph);

  // Identity now; PresenceCursor/SelectionSummary are dynamic facets the publish
  // hook owns. `Local` is auto-applied by eph.spawn (§15.4) — never transmitted.
  const localPeer = eph.spawn({
    components: [[PresenceInfo, { name: opts.name, color: opts.color }]],
    tags: [PresencePeer],
  });

  let detached = false;
  return {
    peerId,
    eph,
    localPeer,
    wire: source,
    onOutbound(fn) {
      outbound.add(fn);
      return () => {
        outbound.delete(fn);
      };
    },
    detach() {
      if (detached) return;
      detached = true;
      // leave() needs the live seam + minted set, so it MUST precede detach:
      // it deletes our keys and flushes tombstones through `send` NOW (peers
      // despawn us immediately rather than waiting the TTL). detach() then
      // despawns projections + stops the timers; the minted set is already empty.
      eph.leave();
      attachment.detach();
      outbound.clear();
      loro.destroy(); // we own the Loro store — clear its wasm cleanup timer
    },
  };
}
