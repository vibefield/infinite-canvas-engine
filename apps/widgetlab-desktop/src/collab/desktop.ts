/**
 * The renderer-side widgetlab-desktop transport seam — a
 * `ByteChannel` over the Electron preload bridge `window.iceDesktop`, plus the
 * boot policy that swaps `docs.create()` for `docs.join()` when the shell is
 * present.
 *
 * The bridge is deliberately TRANSPORT-SHAPED (join/leave/post/onMessage +
 * open/resync): no Electron or truffle type reaches the renderer, so widgetlab
 * stays a plain browser app that happens to find `window.iceDesktop` present.
 * Bytes cross the contextBridge by structured clone — `Uint8Array` round-trips
 * faithfully, so the engine's §6.5 bootstrap frames ride verbatim.
 *
 * LIFECYCLE (the StrictMode rule, same as App's debug probe): `startDesktopCollab`
 * must be called from an EFFECT on the COMMITTED engine, never from the memo
 * factory — an orphaned twin engine joining the room would steal the bridge's
 * single replace-on-set `onMessage` handler from the real one.
 *
 * RESYNC: truffle raw streams have no replay, so a mesh link outage may have
 * dropped frames. Main signals `ice:resync` when a link comes up; every ACTIVE
 * session answers by re-offering its base (`offerBase` → un-addressed
 * SNAPSHOT_OFFER) — active peers merge it (loro dedupes), buffering peers adopt
 * it. No teardown, no re-join.
 */
import { offerBase, type ByteChannel, type CanvasEngine, type DocSession } from "@ice/core";

/** The preload-injected bridge (widgetlab-desktop/src/preload.cjs). */
export interface IceDesktopBridge {
  /** Announce this window to the switchboard; it answers with the open signal. */
  join(room: string): void;
  /** Withdraw from the switchboard (the channel is closing). */
  leave(): void;
  /** Ship one opaque frame to the switchboard for room-wide delivery. */
  post(bytes: Uint8Array): void;
  /** Single handler, replace-on-set — the bridge mirrors `ByteChannel.subscribe`'s spirit, not its fan-out. */
  onMessage(fn: (bytes: Uint8Array) => void): void;
  /** Registering after the open already happened fires immediately. */
  onOpen(fn: () => void): void;
  /** The mesh link-change repair signal (see header). */
  onResync(fn: () => void): void;
}

declare global {
  interface Window {
    /** Present only under the widgetlab-desktop Electron shell (its preload script). */
    iceDesktop?: IceDesktopBridge;
  }
}

/** Whether this renderer runs under the desktop shell — the boot path's doc-source pick. */
export const hasDesktopBridge = (): boolean =>
  typeof window !== "undefined" && window.iceDesktop !== undefined;

/**
 * Wrap the preload bridge as a `ByteChannel`. `ready()` resolves on the
 * switchboard's open ack — `joinDoc` gates its hello + the seed-silence window
 * on it, so a slow membership registration can never elapse the 800ms window
 * and seed a divergent doc into an already-live room.
 */
function ipcByteChannel(bridge: IceDesktopBridge, room: string): ByteChannel & { close(): void } {
  const listeners = new Set<(bytes: Uint8Array) => void>();
  bridge.onMessage((bytes) => {
    for (const fn of [...listeners]) fn(bytes);
  });
  const ready = new Promise<void>((resolve) => bridge.onOpen(resolve));
  bridge.join(room);
  return {
    send: (bytes) => bridge.post(bytes),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    ready: () => ready,
    close() {
      listeners.clear();
      bridge.leave();
    },
  };
}

// --- presence identity (nodeboard's fun-name pattern) -------------------------

const PRESENCE_NAMES = ["Otter", "Heron", "Marmot", "Lynx", "Falcon", "Badger", "Gecko", "Wren", "Vole", "Puffin"];
const PRESENCE_ADJECTIVES = ["Swift", "Calm", "Bright", "Bold", "Keen", "Quiet", "Merry", "Deft"];
const PRESENCE_PALETTE = ["#e5484d", "#0090ff", "#30a46c", "#f76b15", "#8e4ec6", "#e2a336", "#12a594", "#d6409f"];

const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)] as T;

/**
 * Join the desktop room: the switchboard-relayed document becomes this window's
 * doc (first peer seeds via `seed`; every later window/instance imports). Runs
 * fire-and-forget — the engine is usable immediately and entities stream in
 * through projection when the join lands. Returns the disposer for the caller's
 * effect cleanup: aborts/leaves the join (presence tombstones ship first) and
 * withdraws the switchboard membership.
 */
export function startDesktopCollab(ce: CanvasEngine, seed: (session: DocSession) => void): () => void {
  const bridge = window.iceDesktop;
  if (bridge === undefined) return () => {};
  const room = new URLSearchParams(window.location.search).get("collab") ?? "widgetlab";
  const channel = ipcByteChannel(bridge, room);
  // Probe marker (smoke harness): windows of one Electron instance share an
  // origin, so a broken bridge pick could silently fall back to local-doc mode
  // and a convergence smoke would test nothing — assert the transport taken.
  (window as unknown as { __ICE_TRANSPORT?: string }).__ICE_TRANSPORT = "ipc";

  let disposed = false;
  bridge.onResync(() => {
    if (disposed) return;
    const s = ce.docs.current();
    if (s !== undefined) offerBase(channel, s);
  });

  void ce.docs
    .join(channel, {
      seed,
      presence: { name: `${pick(PRESENCE_ADJECTIVES)} ${pick(PRESENCE_NAMES)}`, color: pick(PRESENCE_PALETTE) },
    })
    .then((res) => {
      if (!disposed) console.log(`[widgetlab] desktop collab: ${res.role} in room "${room}"`);
    })
    .catch((err) => {
      // A superseded join (the disposer ran mid-handshake) is a normal close.
      if (!disposed) console.warn("[widgetlab] desktop collab join failed:", err);
    });

  return () => {
    disposed = true;
    ce.docs.close(); // aborts an in-flight join / leaves the room; tombstones ship through the still-wired channel
    channel.close(); // then withdraw the switchboard membership
  };
}
