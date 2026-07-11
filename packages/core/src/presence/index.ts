/**
 * @ice/core presence layer (design-005 §6.5, design-001 §5.6) — attach, publish,
 * remote-cursor projection, and the install seam.
 */
export {
  attachPresence,
  DEFAULT_PRESENCE_TTL_MS,
  type PresenceOpts,
  type PresenceSession,
} from "./presence-kit";
export { createPresencePublish, type PresencePublishOpts } from "./publish";
export {
  createRemoteCursorsSystem,
  installPresence,
  type InstallPresenceOpts,
} from "./remote-cursors";
