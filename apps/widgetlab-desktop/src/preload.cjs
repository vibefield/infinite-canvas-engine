/**
 * widgetlab-desktop preload — injects the transport bridge the renderer's ipc ByteChannel
 * (this package's bundled renderer) binds to.
 *
 * The bridge is deliberately TRANSPORT-SHAPED (join/leave/post/onMessage + open/resync lifecycle):
 * no Electron or truffle type reaches the renderer. Bytes cross the contextBridge by structured clone —
 * `Uint8Array` round-trips faithfully — so no base64 framing anywhere; the channel carries RAW BYTES
 * (opaque ICE bootstrap frames), never envelope objects.
 *
 * Each callback slot is single-handler replace-on-set, mirroring `Channel.onMessage`'s contract.
 * `onOpen` registered AFTER the open already arrived fires immediately — the same no-race rule the
 * reference transport's lifecycle documents. `onResync` tells active sessions to re-offer their base
 * after a mesh link comes up (truffle raw streams have no replay, so a link outage drops in-flight
 * frames; the un-addressed SNAPSHOT_OFFER re-converges live sessions with no teardown — `offerBase`,
 * design-005 §6.5 amendment).
 */
const { contextBridge, ipcRenderer } = require("electron");

let onMessage = null;
let onOpen = null;
let onResync = null;
/** Whether the switchboard has opened this window's membership (see main.mjs `ice:open`). */
let opened = false;

ipcRenderer.on("ice:msg", (_event, bytes) => onMessage?.(bytes));
ipcRenderer.on("ice:open", () => {
  opened = true;
  onOpen?.();
});
ipcRenderer.on("ice:resync", () => onResync?.());

contextBridge.exposeInMainWorld("iceDesktop", {
  /** Announce this window's room to the switchboard; it answers with `ice:open`. */
  join: (room) => ipcRenderer.send("ice:join", room),
  /** Withdraw from the switchboard (the channel is closing). */
  leave: () => ipcRenderer.send("ice:leave"),
  /** Ship one ICE bootstrap frame (raw bytes) to the switchboard for room delivery. */
  post: (bytes) => ipcRenderer.send("ice:post", bytes),
  onMessage: (fn) => {
    onMessage = fn;
  },
  onOpen: (fn) => {
    onOpen = fn;
    if (opened) fn(); // late registration cannot race the first open
  },
  onResync: (fn) => {
    onResync = fn;
  },
});
