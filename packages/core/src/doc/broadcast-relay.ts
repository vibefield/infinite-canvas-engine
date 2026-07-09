/**
 * The dumb snapshot relay (design-005 §6.5 M5 stopgap; §6, decision "relay is
 * dumb — inventory §1.3).
 *
 * M5 ONLY: broadcasts the WHOLE converged document on every local change and
 * imports whole documents it receives. Loro imports dedupe, so a full snapshot
 * is a valid (if wasteful) relay — this is deliberately the simplest thing that
 * converges two tabs. M9 REPLACES it with the transport/bootstrap protocol
 * (hello → addressed-snapshot base → increment stream); do not grow this into
 * that — it is the throwaway.
 *
 * CHANGE-SUBSCRIPTION SURFACE + FEEDBACK GUARD: rides the same
 * `DurableStore.subscribeOutbound` as the autosave kit, which fires ONLY on
 * sealed LOCAL commits (durable-store.ts `onLocalBatch` early-returns on
 * `origin !== "local"`). That origin filter IS the feedback-loop guard: applying
 * a peer's snapshot via `applyRemote` produces remote-origin batches, which do
 * NOT re-fire `subscribeOutbound`, so an imported change is never rebroadcast.
 * No `applying` flag is needed — the subscription tells us the origin.
 *
 * LATE-JOINER SEED: on attach we post our snapshot (best-effort seed) AND a
 * `hello`; peers answer a `hello` with their snapshot, so a tab opened second
 * converges up to the first. BroadcastChannel never delivers a message to the
 * instance that posted it, so hello/answer never self-loops.
 */
import type { DocSession } from "./doc-kit";

/**
 * The minimal channel surface the relay needs — structurally satisfied by the
 * global `BroadcastChannel` and by test fakes. Anything carrying a `Uint8Array`
 * through `postMessage` works (design-005 §6.5).
 */
export interface RelayChannel {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (ev: { data: unknown }) => void): void;
  removeEventListener(type: "message", listener: (ev: { data: unknown }) => void): void;
  close?(): void;
}

export interface BroadcastRelayOpts {
  /** Channel name; used to construct a `BroadcastChannel` when `channel` is absent. */
  readonly channelName: string;
  /** Injected channel (tests). When omitted, a `new BroadcastChannel(channelName)` is created and owned. */
  readonly channel?: RelayChannel;
}

export interface BroadcastRelay {
  /** Unsubscribe from the store, detach the listener, and close an owned channel. Idempotent. */
  stop(): void;
}

type RelayMessage =
  | { readonly kind: "snapshot"; readonly bytes: Uint8Array }
  | { readonly kind: "hello" };

function asRelayMessage(data: unknown): RelayMessage | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const kind = (data as { kind?: unknown }).kind;
  if (kind === "hello") return { kind: "hello" };
  if (kind === "snapshot") {
    const bytes = (data as { bytes?: unknown }).bytes;
    if (bytes instanceof Uint8Array) return { kind: "snapshot", bytes };
  }
  return undefined;
}

/** Attach a dumb snapshot relay to `session` over a `BroadcastChannel` (or injected channel). */
export function attachBroadcastRelay(session: DocSession, opts: BroadcastRelayOpts): BroadcastRelay {
  const ownsChannel = opts.channel === undefined;
  const channel: RelayChannel = opts.channel ?? new BroadcastChannel(opts.channelName);

  const broadcastSnapshot = (): void => {
    channel.postMessage({ kind: "snapshot", bytes: session.exportSnapshot() } satisfies RelayMessage);
  };

  const onMessage = (ev: { data: unknown }): void => {
    const msg = asRelayMessage(ev.data);
    if (msg === undefined) return;
    if (msg.kind === "hello") {
      broadcastSnapshot(); // answer a late joiner with our converged document
    } else {
      // Remote import: dedupes in loro and does NOT re-fire subscribeOutbound
      // (remote origin), so no rebroadcast — the feedback guard is the origin.
      session.applyRemote(msg.bytes);
    }
  };

  channel.addEventListener("message", onMessage);
  const unsub = session.store.subscribeOutbound(() => broadcastSnapshot());

  // Seed peers with our current document, and ask them for theirs.
  broadcastSnapshot();
  channel.postMessage({ kind: "hello" } satisfies RelayMessage);

  let stopped = false;
  return {
    stop(): void {
      if (stopped) return;
      stopped = true;
      unsub();
      channel.removeEventListener("message", onMessage);
      if (ownsChannel) channel.close?.();
    },
  };
}
