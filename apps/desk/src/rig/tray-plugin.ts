// rig:tray's PLUGIN fixture (design-017 §8; K5a — K-L2): an object type declared HERE, outside `@ice/objects`, the way a plugin declares
// one — `defineObject` with its own tray entry — and registered on the desk engine only when the rig asks (`?trayPlugin`). The tray shows
// it by that entry alone: no list in the engine names it. Its face borrows the note's kind (a fixture needs something to draw; K8's
// third-party kind brings a kind of its own).
import { p } from "@ice/core";
import { defineObject, type ObjectKind } from "@ice/desk";
import { Note } from "@ice/objects";

export const TRAY_PLUGIN = defineObject({
  type: "rig.swatch",
  version: 1,
  props: { seed: p.number({ default: 5 }) },
  size: { w: 200, h: 200 },
  kind: Note.object as ObjectKind,
  interaction: { selectable: true, movable: true, resizable: false },
  tray: { label: "Swatch", category: "plugin", hang: { w: 80, h: 80, accessory: "clip", pegs: [[0, -0.5]] } },
});
