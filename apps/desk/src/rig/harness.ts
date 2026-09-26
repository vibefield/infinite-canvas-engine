// THE RIGS' HARNESS (design-015 D7, D-D7-C.3): `rig.html` loads it beside the desk's own `main.tsx`; it opens the door
// `src/rig-door.ts` declares, so `window.__desk.setScene` and `kinds.print` reach the oracle's scenes and fixtures here —
// the only modules of the app that import `@ice/desk/oracle/*` besides the parity page. The product page never loads it.

import type { DeskRig } from "../rig-door";
import { printFixture } from "./scene-kinds";
import { type OracleScene, setScene } from "./stage";

const rig: DeskRig = { setScene: (host, scene) => setScene(host, scene as OracleScene), printFixture };
window.__deskRig = rig;
