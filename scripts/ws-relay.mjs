/**
 * Dumb WebSocket byte fan-out relay for the ICE collab demos (design-005 §6.5:
 * "provided adapters for BroadcastChannel and WebSocket byte relays"). This is
 * the server the demo's `webSocketByteChannel` talks to.
 *
 * ZERO document awareness: a ROOM is the URL path (`ws://host:9301/my-room`);
 * every binary frame a socket sends is rebroadcast VERBATIM to every OTHER
 * socket in that same room. No parsing, no per-room state beyond membership, no
 * history — a late joiner catches up through the M9 hello/snapshot handshake,
 * not the relay. `PORT` env overrides the 9301 default.
 *
 *   node scripts/ws-relay.mjs            # ws://localhost:9301/<room>
 *   PORT=9999 node scripts/ws-relay.mjs
 */
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT ?? 9301);
const rooms = new Map(); // room name → Set<WebSocket>

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (socket, req) => {
  const room = decodeURIComponent((req.url ?? "/").split("?")[0].replace(/^\/+/, "")) || "default";
  let peers = rooms.get(room);
  if (peers === undefined) {
    peers = new Set();
    rooms.set(room, peers);
  }
  peers.add(socket);
  console.log(`+ connect    room=${JSON.stringify(room)} peers=${peers.size}`);

  socket.on("message", (data, isBinary) => {
    // Fan out verbatim to every OTHER open socket in the room (no parsing).
    for (const peer of peers) {
      if (peer !== socket && peer.readyState === peer.OPEN) peer.send(data, { binary: isBinary });
    }
  });

  socket.on("close", () => {
    peers.delete(socket);
    if (peers.size === 0) rooms.delete(room);
    console.log(`- disconnect room=${JSON.stringify(room)} peers=${peers.size}`);
  });

  socket.on("error", () => socket.close());
});

console.log(`ws-relay listening on ws://localhost:${PORT}  (rooms via URL path; set PORT to override)`);
