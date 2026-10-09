// THE RIGS' HARNESS (design-015 D7, D-D7-C.3): `rig.html` loads it beside the desk's own `main.tsx`; it opens the door
// `src/rig-door.ts` declares, so `window.__desk.setScene` and `kinds.print` reach the oracle's scenes and fixtures here —
// the only modules of the app that import `@ice/objects/oracle/*` besides the parity page. The product page never loads it.

import { BROKEN_CLOCK_OBJECTS } from "@ice-examples/desk-clock";
import { LIVE, service } from "@ice/desk/kit";
import type { DeskRig, RigLayer } from "../rig-door";
import { KIND_FAULTS } from "./kind-faults";
import { RIG_LIVE_OBJECTS } from "./live-kind";
import { createRigLive } from "./live-source";
import { printFixture } from "./scene-kinds";
import { type OracleScene, setScene } from "./stage";
import { TRAY_PLUGIN } from "./tray-plugin";
import { DESK_PLUGINS } from "../desk";

// rig:tray's plugin fixture (K5a) joins the desk engine's catalog when the page asks for it — the product never imports it; and the
// APP'S plugin kinds (K8b — the desk clock) when the page asks for them (`?plugins`): without, the rigs' desk is the reference six,
// the desk the golden's reference stills were drawn on (D-K8b.2); and the clock's FAULT FIXTURE (petition I24 — `?broken`: a clock whose
// WGSL does not compile and one whose record throws from its third frame) for rig:clock's fault rows alone
const query = new URLSearchParams(location.search);
// …and the rig's LIVE kind (M24 LT1 — `?live`, rig:live's alone): a lit sheet whose face its desk's `LIVE` source fills, the source
// lent through the layer's services and handed the layer's device (`onDevice`), the rig's to tick or hold still (`__deskRig.live`)
const live = query.has("live") ? createRigLive() : undefined;
const plugins = [...(query.has("trayPlugin") ? [TRAY_PLUGIN] : []), ...(query.has("plugins") ? DESK_PLUGINS : []), ...(query.has("broken") ? BROKEN_CLOCK_OBJECTS : []), ...(live !== undefined ? RIG_LIVE_OBJECTS : [])];
// a HOST's chrome, as VibeField mounts the layer: `?hold=top,band,travelMs` (I20 — rig:open's row; all three named: a number missing
// is NaN, which the mount refuses by its name), `?trayFoot=px` (I21 — rig:world draws the oracle's footed still on it) and
// `?cursors=false` (I26 — a host that draws the room's people itself: rig:collab's third tab); and kinds of the LAYER's own, broken
// (`?kindFaults` — I25's broken generation: one refused at create, one quarantined; rig:remount drops them from `__deskRig.layer`
// before its next remount, and that generation mounts clean)
const hold = query.get("hold")?.split(",").map(Number);
const foot = query.get("trayFoot");
const cursors = query.get("cursors");
const layer: RigLayer = {
  ...(hold !== undefined ? { hold: { top: hold[0] ?? Number.NaN, band: hold[1] ?? Number.NaN, travelMs: hold[2] ?? Number.NaN } } : {}),
  ...(foot !== null ? { tray: { foot: Number(foot) } } : {}),
  ...(cursors !== null ? { cursors: cursors !== "false" } : {}),
  ...(query.has("kindFaults") ? { objects: KIND_FAULTS } : {}),
  ...(live !== undefined ? { services: [service(LIVE, live.sources)], onDevice: (device: GPUDevice) => live.device(device) } : {}),
};
const rig: DeskRig = { setScene: (host, scene) => setScene(host, scene as OracleScene), printFixture, widgets: plugins, layer, ...(live !== undefined ? { live } : {}) };
window.__deskRig = rig;
