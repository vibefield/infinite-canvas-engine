/**
 * The browser entry (index.html → this file). All bootstrapping lives in the
 * side-effect-free `./app` module so the exit tests can import `boot` and the
 * seed helpers without triggering a real mount; this file's only job is to run
 * it against `#app`.
 *
 * Collab is opt-in via URL params (design-005 §6.5):
 *   ?room=<name>&relay=ws://localhost:9301  → WebSocket collab (needs the relay)
 *   ?room=<name>                            → BroadcastChannel collab (two tabs)
 *   (no ?room)                              → the local, localStorage-backed doc
 */
import { type BootOptions, boot } from "./app";

function bootOptions(): BootOptions {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  const room = params.get("room");
  if (room === null || room === "") return {}; // no room ⇒ local mode
  const relay = params.get("relay");
  return { room, ...(relay !== null && relay !== "" ? { relay } : {}) };
}

void boot(bootOptions()).catch((err) => {
  console.error("node-board demo failed to boot:", err);
});
