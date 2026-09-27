// rig:tray's PLUGIN fixture (design-017 §8; K5a — K-L2): an object type declared HERE, outside `@ice/objects`, the way a plugin declares
// one — `defineObject` with its own tray entry — and registered on the desk engine only when the rig asks (`?trayPlugin`). The tray shows
// it by that entry alone: no list in the engine names it; it lies on the desk by providing `DESK_OBJECT` (K5b). Its face borrows the note's kind (a fixture needs something to draw; K8's
// third-party kind brings a kind of its own).
import { p } from "@ice/core";
import { defineObject, type ObjectKind } from "@ice/desk";
import { DESK_OBJECT, Note } from "@ice/objects";

export const TRAY_PLUGIN = defineObject({
  type: "rig.swatch",
  version: 1,
  props: { seed: p.number({ default: 5 }) },
  size: { w: 200, h: 200 },
  kind: Note.object as ObjectKind,
  interaction: { selectable: true, movable: true, resizable: false },
  // it lies on the desk by declaring so (K5b — the desk canvas places what provides `DESK_OBJECT`), and so can be taken off the tray onto it
  provides: [DESK_OBJECT],
  tray: { label: "Swatch", category: "plugin", hang: { w: 80, h: 80, accessory: "clip", pegs: [[0, -0.5]] } },
});
