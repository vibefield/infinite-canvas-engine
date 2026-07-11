/**
 * Byte-channel adapters for the bootstrap kit (design-005 §6.5: "provided
 * adapters for BroadcastChannel and WebSocket byte relays; anything carrying a
 * Uint8Array works").
 *
 * A `ByteChannel` is the whole transport contract the bootstrap state machine
 * needs: `send(bytes)` out, `subscribe(fn)` in. The engine stays transport-free —
 * the app owns the socket lifecycle and hands the instance in.
 *
 * Both adapters interact through STRUCTURAL types (no DOM lib dependency beyond
 * what core already uses — the broadcast-relay precedent), so a test double or an
 * alternative runtime satisfies them without the platform's exact event types.
 */

/** The transport contract: bytes out, bytes in. Structurally satisfied by both adapters + test fakes. */
export interface ByteChannel {
  send(bytes: Uint8Array): void;
  /** Deliver every inbound frame to `fn`. Returns an unsubscribe. */
  subscribe(fn: (bytes: Uint8Array) => void): () => void;
}

/** A `ByteChannel` that owns a resource (a BroadcastChannel) and can release it. */
export interface OwnedByteChannel extends ByteChannel {
  close(): void;
}

/** The slice of `BroadcastChannel` we use (structural — avoids the DOM event lib). */
interface BroadcastChannelLike {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (ev: { data: unknown }) => void): void;
  removeEventListener(type: "message", listener: (ev: { data: unknown }) => void): void;
  close(): void;
}

/** The slice of `WebSocket` we use (structural — the app supplies the instance). */
export interface WebSocketLike {
  binaryType: string;
  readyState: number;
  send(data: ArrayBufferLike | ArrayBufferView): void;
  addEventListener(type: string, listener: (ev: { data: unknown }) => void): void;
  removeEventListener(type: string, listener: (ev: { data: unknown }) => void): void;
}

/** WebSocket `readyState` OPEN. */
const WS_OPEN = 1;

/** Coerce a received message payload to a `Uint8Array`, or undefined if it is neither bytes nor a buffer. */
function toBytes(data: unknown): Uint8Array | undefined {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return undefined;
}

/**
 * A `ByteChannel` over a `BroadcastChannel` (same-origin tab-to-tab). Uint8Array
 * is structured-cloneable, so it rides `postMessage` directly. A BroadcastChannel
 * never delivers a message to the instance that posted it, so a peer never hears
 * its own frames. `close()` releases the owned channel.
 */
export function broadcastChannelByteChannel(name: string): OwnedByteChannel {
  const bc: BroadcastChannelLike = new BroadcastChannel(name);
  const listeners = new Set<(bytes: Uint8Array) => void>();

  const onMessage = (ev: { data: unknown }): void => {
    const bytes = toBytes(ev.data);
    if (bytes === undefined) return;
    for (const fn of [...listeners]) fn(bytes);
  };
  bc.addEventListener("message", onMessage);

  return {
    send(bytes) {
      bc.postMessage(bytes);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    close() {
      bc.removeEventListener("message", onMessage);
      bc.close();
      listeners.clear();
    },
  };
}

/**
 * A `ByteChannel` over a caller-supplied WebSocket. Sets `binaryType =
 * "arraybuffer"` (so inbound frames arrive as `ArrayBuffer`), and QUEUES outbound
 * frames until the socket is OPEN, flushing on the `open` event. The app owns the
 * socket (construction, reconnection, close).
 */
export function webSocketByteChannel(ws: WebSocketLike): ByteChannel {
  ws.binaryType = "arraybuffer";
  const listeners = new Set<(bytes: Uint8Array) => void>();
  const queue: Uint8Array[] = [];

  const flush = (): void => {
    if (ws.readyState !== WS_OPEN) return;
    for (const bytes of queue.splice(0)) ws.send(bytes);
  };
  ws.addEventListener("open", flush);
  ws.addEventListener("message", (ev) => {
    const bytes = toBytes(ev.data);
    if (bytes === undefined) return;
    for (const fn of [...listeners]) fn(bytes);
  });
  flush(); // already-open sockets flush immediately

  return {
    send(bytes) {
      if (ws.readyState === WS_OPEN) ws.send(bytes);
      else queue.push(bytes); // queue-until-open
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
