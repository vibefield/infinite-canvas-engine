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
  /**
   * Abort the join: tears the room down (channel unsubscribed, session closed)
   * and rejects the promise if it hasn't resolved yet. The facade aborts its
   * pending join when another document supersedes it — a resolution-time check
   * alone cannot stop a mid-handshake join from attaching to the world.
   */
  readonly signal?: AbortSignal;
  /**
   * Live-session transitions: fired at every activation (including the first,
   * just before the promise resolves) and with `undefined` when an internal
   * re-bootstrap tears the quarantined session down. The facade re-targets its
   * forwarding sink here — without it, callers keep committing into a session
   * `rebootstrap()` already closed.
   */
  readonly onSession?: (session: DocSession | undefined) => void;
}

export interface JoinResult {
  /** "seeder" = we created the doc (timed out); "joiner" = we imported a peer's base. */
  readonly role: "seeder" | "joiner";
  /** LIVE (a getter): after an internal re-bootstrap this is the replacement session. */
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
    // SINGLE-WRITER LAW (petition 8, schema-migrate.ts): a live-room joiner is never the
    // document's sole occupant — structural/pack migration here would split-brain the room
    // (the peers keep writing the old shape; sync never re-gates). An old-schema doc joined
    // live attaches read-only; it migrates on its next SOLO open.
    migrate: false,
  };

  return new Promise<JoinResult>((resolve, reject) => {
    let session: DocSession | undefined;
    let active = false;
    let settled = false;
    let left = false;
    let timeoutHandle: unknown;
    let unsubOutbound: (() => void) | undefined;
    let rebootstrapAttempts = 0;

    // UPDATE frames that arrived while BUFFERING — drained after the base imports.
    const buffered: Uint8Array[] = [];
    // Channel + presence-relay unsubs (filled at wire-up; exists from the start
    // so teardown is safe on every path, including a pre-resolution abort).
    const roomSubs: (() => void)[] = [];

    // EVERY exit — leave(), abort, a failed base import, a throwing seed(), the
    // quarantine give-up — funnels through this one idempotent teardown, so no
    // path can leak the channel/presence/outbound subscriptions or the timer.
    const teardown = (): void => {
      if (left) return;
      left = true;
      clock.clearTimeout(timeoutHandle);
      opts.signal?.removeEventListener("abort", onAbort);
      for (const unsub of roomSubs.splice(0)) unsub();
      unsubOutbound?.();
      unsubOutbound = undefined;
      session?.close();
    };

    /** Failure exit: teardown, then reject (pre-resolve) or surface via onError (post-resolve). */
    const fail = (err: unknown): void => {
      teardown();
      if (!settled) {
        settled = true;
        reject(err instanceof Error ? err : new Error(String(err)));
      } else {
        opts.onError?.(err);
      }
    };

    // EVERY channel write goes through this guard: a transport throw (a socket
    // flipping state between the readiness check and send) must fail the join,
    // not strand a half-attached session — and an outbound-subscription send
    // must never escape into the user's local transaction (2026-07-13 review).
    const send = (bytes: Uint8Array): void => {
      try {
        channel.send(bytes);
      } catch (err) {
        fail(err);
      }
    };

    // A post-resolve abort is the caller closing a live join — leave() semantics,
    // deliberately NOT routed to onError (fail() would report every normal close).
    const onAbort = (): void => {
      const wasSettled = settled;
      teardown();
      if (!wasSettled) {
        settled = true;
        const reason: unknown = opts.signal?.reason ?? new Error("ice: joinDoc aborted");
        reject(reason instanceof Error ? reason : new Error(String(reason)));
      }
    };

    const armTimeout = (): void => {
      timeoutHandle = clock.setTimeout(() => {
        if (!active && !left) becomeSeeder();
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
      unsubOutbound = s.store.subscribeOutbound((bytes) => send(frame(K_UPDATE, bytes)));
      opts.onSession?.(s);
      if (!settled) {
        settled = true;
        resolve({
          role,
          // The getter tracks re-bootstrap: the resolved object never pins the
          // original session (callers would keep a quarantined one otherwise).
          get session() {
            return session as DocSession;
          },
          leave: teardown,
        });
      }
    };

    const becomeSeeder = (): void => {
      if (active || left) return;
      if (rebootstrapAttempts > 0) {
        // A re-bootstrap that finds no peer cannot recover the doc — re-seeding
        // here would present a fresh empty doc as if it were the recovered one.
        teardown();
        opts.onError?.(new Error("ice: re-bootstrap found no peer to rejoin from — document quarantined"));
        return;
      }
      let s: DocSession | undefined;
      try {
        s = createDocSession(world, docOpts);
        opts.seed?.(s); // seed BEFORE going active — the state rides every future snapshot
      } catch (err) {
        // seed() runs inside the hello-timeout timer callback — uncaught, the
        // throw would escape the timer and the join promise would hang forever.
        s?.close();
        fail(err);
        return;
      }
      goActive(s, "seeder");
    };

    const becomeJoiner = (base: Uint8Array): void => {
      if (active || left) return;
      clock.clearTimeout(timeoutHandle);
      const result = openDocSession(world, base, docOpts);
      if (!result.ok) {
        // A corrupt/incompatible base — tear the room down and surface it
        // (reconnect = re-join; the channel must not stay subscribed).
        fail(new Error(`ice: bootstrap base import failed — ${result.reason}`));
        return;
      }
      const s = result.session;
      session = s; // BEFORE the send: a throwing transport must find it in teardown
      // §6.5: import base → re-broadcast own base → drain buffer. Go active before
      // draining so late live UPDATEs (post-drain) apply through the active path.
      send(frame(K_SNAPSHOT_OFFER, s.exportEnvelope())); // envelope-framed (a peer may OPEN it)
      if (left) return; // the offer send failed — teardown already closed s
      goActive(s, "joiner");
      const drained = buffered.splice(0);
      for (let i = 0; i < drained.length; i++) {
        const bytes = drained[i];
        if (bytes === undefined) continue;
        applyRemoteSafe(bytes);
        if (left || !active || session !== s) {
          // A PendingImportError mid-drain re-bootstrapped (or quarantined) the
          // session — the rest of these frames belong to the REPLACEMENT's
          // buffer (they may import cleanly once the fresh base lands), not to
          // the session that just closed under us.
          buffered.push(...drained.slice(i + 1));
          break;
        }
      }
    };

    const rebootstrap = (): void => {
      if (rebootstrapAttempts >= 1) {
        // Second quarantine: give up FOR REAL — leave the room (else every later
        // UPDATE re-fires this error against a session we know is dead) and tell
        // the session listener the doc is gone.
        teardown();
        opts.onSession?.(undefined);
        opts.onError?.(new Error("ice: re-bootstrap after PendingImportError failed — document quarantined"));
        return;
      }
      rebootstrapAttempts++;
      // Tear the quarantined session down, return to BUFFERING, and re-hello. The
      // channel subscription + presence relay stay wired (presence is session-free).
      // `session` keeps pointing at the closed one so the result getter stays
      // non-undefined; `active=false` routes every frame to the buffering path.
      unsubOutbound?.();
      unsubOutbound = undefined;
      session?.close();
      active = false;
      buffered.length = 0;
      opts.onSession?.(undefined); // no live session until the re-join lands
      send(frame(K_HELLO, utf8.encode(joinerId)));
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

    // Abort wiring before anything opens: a pre-aborted signal never joins the room.
    if (opts.signal?.aborted === true) {
      onAbort();
      return;
    }
    opts.signal?.addEventListener("abort", onAbort);

    roomSubs.push(channel.subscribe(onFrame));
    const unsubPresence = opts.presence?.onOutbound((b) => send(frame(K_PRESENCE, b)));
    if (unsubPresence !== undefined) roomSubs.push(unsubPresence);

    // Broadcast hello, buffer inbound, wait for a base (or the silence timeout).
    // A transport that reports readiness GATES both: arming the ~800 ms window
    // while a socket is still CONNECTING lets a slow connect elapse it and seed
    // a divergent second doc offline — whose seeded state (pre-outbound-
    // subscription) would never reach the existing room (2026-07-13 review).
    const begin = (): void => {
      if (left) return; // aborted while the transport was connecting
      send(frame(K_HELLO, utf8.encode(joinerId)));
      if (left) return; // the hello itself failed — already torn down
      armTimeout();
    };
    if (channel.ready !== undefined) {
      channel.ready().then(begin, (err: unknown) => fail(err));
    } else {
      begin();
    }
  });
}
