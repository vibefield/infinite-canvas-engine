/**
 * The transport/bootstrap kit (design-005 §6.5) — the engine-provided join state
 * machine; the app provides the byte channel (channels.ts).
 *
 * `joinDoc` runs the LOCKED §6.5 protocol:
 *   join = broadcast hello → buffer inbound → import addressed snapshot as causal
 *   base → re-broadcast own base → drain buffer; ~800 ms silence ⇒ first peer ⇒
 *   seed. Reconnect = the caller calls `joinDoc` again (streams are never
 *   resumed). A strata `PendingImportError` on a live update ⇒ automatic internal
 *   re-bootstrap (one retry, then surfaced via `onError`).
 *
 * ── THE FRAME PROTOCOL (1-byte kind + payload) ──
 *   HELLO(1)          payload = joinerId (UTF-8). "I'm joining; send me a base."
 *   SNAPSHOT_OFFER(2) payload = an ENVELOPE-framed doc snapshot (header + loro
 *                     bytes). An UNaddressed base broadcast — the post-import
 *                     "re-broadcast own base" step; a buffering peer OPENS it (the
 *                     gate runs), an active peer unwraps + merges it (dedupes).
 *   SNAPSHOT(3)       payload = idLen(u16 LE) ++ targetId(UTF-8) ++ ENVELOPE. An
 *                     addressed answer to a HELLO — only the peer whose id ==
 *                     targetId adopts it as its causal base (others unwrap/merge).
 *   UPDATE(4)         payload = a sealed local commit's incremental (raw) loro bytes.
 *   PRESENCE(5)       payload = ephemeral presence bytes — rides the same channel,
 *                     applied immediately (independent of the doc handshake).
 *
 * ── STATES ──
 *   BUFFERING: helloed, no base yet. UPDATE frames are BUFFERED; the first snapshot
 *     (offer, or addressed to us) triggers `becomeJoiner`; the hello-timeout triggers
 *     `becomeSeeder`. PRESENCE flows immediately; HELLOs are ignored (nothing to offer).
 *   ACTIVE: session live (either role). Answers HELLOs with an addressed snapshot,
 *     merges snapshots/offers, applies updates, relays presence. Local commits ride
 *     `store.subscribeOutbound` → UPDATE frames (remote-origin imports never re-fire it,
 *     so an imported change is never rebroadcast — the origin IS the feedback guard).
 *
 * Two cold joiners with no existing doc BOTH time out and seed (split-brain) — the
 * design's "first peer seeds" assumes a joiner arrives after a seeder exists; a
 * simultaneous-cold-start tie-break is out of scope for M9 and noted here.
 */
import type { World } from "@vibecook/strata-ecs";
import { PendingImportError } from "@vibecook/strata-ecs/durable";
import type { ByteChannel } from "./channels";
import { createDocSession, openDocSession, type DocSession, type DocSessionOpts } from "./doc-kit";
import { decodeEnvelope } from "./envelope";
import type { PresenceSession } from "../presence/presence-kit";

const K_HELLO = 1;
const K_SNAPSHOT_OFFER = 2;
const K_SNAPSHOT = 3;
const K_UPDATE = 4;
const K_PRESENCE = 5;

const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder();

/** Injectable timer surface (autosave's clock precedent) so the hello-timeout is deterministic in tests. */
export interface BootstrapClock {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const defaultClock: BootstrapClock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface JoinDocOpts {
  /** Passed to create/open (maxUndoSteps, etc.). */
  readonly docOpts?: DocSessionOpts;
  /** Version-gate override, forwarded to `openDocSession` (a non-"ok" verdict ⇒ a read-only joiner). */
  readonly onGate?: DocSessionOpts["onGate"];
  /** Injected timer surface (tests). Default: global setTimeout/clearTimeout. */
  readonly clock?: BootstrapClock;
  /** Silence window before the lone/first peer seeds (design §6.5, default 800 ms). */
  readonly helloTimeoutMs?: number;
  /** Populate the fresh document — runs on the SEEDER path only, before it goes active. */
  readonly seed?: (session: DocSession) => void;
  /** Presence session to relay over the same channel (kind PRESENCE). Optional. */
  readonly presence?: PresenceSession;
  /** Surfaced when a re-bootstrap (after a PendingImportError) itself fails, or a base import fails post-join. */
  readonly onError?: (err: unknown) => void;
}

export interface JoinResult {
  /** "seeder" = we created the doc (timed out); "joiner" = we imported a peer's base. */
  readonly role: "seeder" | "joiner";
  readonly session: DocSession;
  /** Stop relaying, unsubscribe the channel, and close the session. Idempotent. */
  leave(): void;
}

/** Prefix `payload` with a 1-byte `kind`. */
function frame(kind: number, payload?: Uint8Array): Uint8Array {
  const len = payload?.length ?? 0;
  const out = new Uint8Array(1 + len);
  out[0] = kind;
  if (payload !== undefined) out.set(payload, 1);
  return out;
}

/** Build an addressed SNAPSHOT frame: kind ++ idLen(u16 LE) ++ id ++ snapshot. */
function frameSnapshot(targetId: string, snapshot: Uint8Array): Uint8Array {
  const id = utf8.encode(targetId);
  const out = new Uint8Array(1 + 2 + id.length + snapshot.length);
  out[0] = K_SNAPSHOT;
  out[1] = id.length & 0xff;
  out[2] = (id.length >> 8) & 0xff;
  out.set(id, 3);
  out.set(snapshot, 3 + id.length);
  return out;
}

/** Parse a SNAPSHOT payload (the bytes AFTER the kind byte) into its target id + snapshot. */
function parseSnapshot(payload: Uint8Array): { targetId: string; snapshot: Uint8Array } {
  const idLen = (payload[0] ?? 0) | ((payload[1] ?? 0) << 8);
  const targetId = fromUtf8.decode(payload.subarray(2, 2 + idLen));
  const snapshot = payload.subarray(2 + idLen);
  return { targetId, snapshot };
}

/**
 * Join (or found) the room's document over `channel`. Resolves once we go active —
 * as a "joiner" (imported a peer's base) or a "seeder" (timed out and created one).
 */
export function joinDoc(world: World, channel: ByteChannel, opts: JoinDocOpts = {}): Promise<JoinResult> {
  const clock = opts.clock ?? defaultClock;
  const helloTimeoutMs = opts.helloTimeoutMs ?? 800;
  const joinerId = crypto.randomUUID();
  const docOpts: DocSessionOpts = {
    ...(opts.docOpts ?? {}),
    ...(opts.onGate !== undefined ? { onGate: opts.onGate } : {}),
  };

  return new Promise<JoinResult>((resolve, reject) => {
    let session: DocSession | undefined;
    let active = false;
    let settled = false;
    let timeoutHandle: unknown;
    let unsubOutbound: (() => void) | undefined;
    let rebootstrapAttempts = 0;

    // UPDATE frames that arrived while BUFFERING — drained after the base imports.
    const buffered: Uint8Array[] = [];

    const armTimeout = (): void => {
      timeoutHandle = clock.setTimeout(() => {
        if (!active && !settled) becomeSeeder();
      }, helloTimeoutMs);
    };

    const applyRemoteSafe = (bytes: Uint8Array): void => {
      if (session === undefined) return;
      try {
        session.applyRemote(bytes);
      } catch (err) {
        if (err instanceof PendingImportError) rebootstrap();
        else opts.onError?.(err); // corrupt bytes must not brick the channel
      }
    };

    // An active peer MERGES a snapshot/offer (envelope-framed) — unwrap to raw
    // loro bytes, then apply. A buffering peer instead OPENS it (openDocSession
    // decodes the envelope itself + runs the gate).
    const mergeSnapshotEnvelope = (envelope: Uint8Array): void => {
      let payload: Uint8Array;
      try {
        payload = decodeEnvelope(envelope).payload;
      } catch (err) {
        opts.onError?.(err); // a corrupt envelope must not brick the channel
        return;
      }
      applyRemoteSafe(payload);
    };

    const goActive = (s: DocSession, role: "seeder" | "joiner"): void => {
      session = s;
      active = true;
      // Local commits → UPDATE frames. Remote-origin imports never fire this
      // (durable's onLocalBatch origin filter), so an import is never rebroadcast.
      unsubOutbound = s.store.subscribeOutbound((bytes) => channel.send(frame(K_UPDATE, bytes)));
      if (!settled) {
        settled = true;
        resolve({ role, session: s, leave });
      }
    };

    const becomeSeeder = (): void => {
      if (active || settled) return;
      const s = createDocSession(world, docOpts);
      opts.seed?.(s); // seed BEFORE going active — the state rides every future snapshot
      goActive(s, "seeder");
    };

    const becomeJoiner = (base: Uint8Array): void => {
      if (active) return;
      clock.clearTimeout(timeoutHandle);
      const result = openDocSession(world, base, docOpts);
      if (!result.ok) {
        // A corrupt/incompatible base — surface and give up (reconnect = re-join).
        if (!settled) {
          settled = true;
          reject(new Error(`ice: bootstrap base import failed — ${result.reason}`));
        }
        return;
      }
      const s = result.session;
      // §6.5: import base → re-broadcast own base → drain buffer. Go active before
      // draining so late live UPDATEs (post-drain) apply through the active path.
      channel.send(frame(K_SNAPSHOT_OFFER, s.exportEnvelope())); // envelope-framed (a peer may OPEN it)
      goActive(s, "joiner");
      for (const bytes of buffered.splice(0)) applyRemoteSafe(bytes);
    };

    const rebootstrap = (): void => {
      if (rebootstrapAttempts >= 1) {
        opts.onError?.(new Error("ice: re-bootstrap after PendingImportError failed — document quarantined"));
        return;
      }
      rebootstrapAttempts++;
      // Tear the quarantined session down, return to BUFFERING, and re-hello. The
      // channel subscription + presence relay stay wired (presence is session-free).
      unsubOutbound?.();
      unsubOutbound = undefined;
      session?.close();
      session = undefined;
      active = false;
      buffered.length = 0;
      channel.send(frame(K_HELLO, utf8.encode(joinerId)));
      armTimeout();
    };

    const onFrame = (bytes: Uint8Array): void => {
      if (bytes.length === 0) return;
      const kind = bytes[0];
      const payload = bytes.subarray(1);

      if (kind === K_PRESENCE) {
        opts.presence?.wire.apply(payload); // independent of the doc handshake
        return;
      }

      if (active) {
        if (kind === K_HELLO) {
          if (session !== undefined) {
            channel.send(frameSnapshot(fromUtf8.decode(payload), session.exportEnvelope()));
          }
        } else if (kind === K_UPDATE) {
          applyRemoteSafe(payload); // raw loro increment
        } else if (kind === K_SNAPSHOT_OFFER) {
          mergeSnapshotEnvelope(payload);
        } else if (kind === K_SNAPSHOT) {
          mergeSnapshotEnvelope(parseSnapshot(payload).snapshot);
        }
        return;
      }

      // BUFFERING (joiner-in-progress / pre-seed).
      if (kind === K_SNAPSHOT_OFFER) {
        becomeJoiner(payload);
      } else if (kind === K_SNAPSHOT) {
        const { targetId, snapshot } = parseSnapshot(payload);
        if (targetId === joinerId) becomeJoiner(snapshot); // "import ADDRESSED snapshot as causal base"
      } else if (kind === K_UPDATE) {
        buffered.push(payload); // buffer then drain (order preserved)
      }
      // HELLO while buffering: ignore (we have nothing to offer yet).
    };

    const unsubChannel = channel.subscribe(onFrame);
    const unsubPresence = opts.presence?.onOutbound((b) => channel.send(frame(K_PRESENCE, b)));

    const leave = (): void => {
      clock.clearTimeout(timeoutHandle);
      unsubChannel();
      unsubPresence?.();
      unsubOutbound?.();
      session?.close();
    };

    // Broadcast hello, buffer inbound, wait for a base (or the silence timeout).
    channel.send(frame(K_HELLO, utf8.encode(joinerId)));
    armTimeout();
  });
}
