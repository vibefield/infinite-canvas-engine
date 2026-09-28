// The DESK CLOCK as an OBJECT — declared through `defineObject` exactly as a built-in is (design-016 K-L2), from the published
// entries alone. Durable props, in ONE group (one cell, one transaction per change): its `style` (the dial), `ring24` (the
// 24-hour ring printed inside the hours), `seconds` (the seconds hand, and with it the desk's cadence: a frame a second or a
// minute) and `zone` (`local`, or a UTC offset — local.ts, law.ts). The time is never a prop: it is the host's clock (flux).
// Things, movable, selectable, snapping both ways. It hangs on the pegboard on a hook (its tray entry); its selection-menu act
// flips the seconds hand; picked up it opens, and its held tools set it; it lies on the desk and goes into a mini mat by what it
// PROVIDES, and there draws as its chip when the face is far.

import { p, type WidgetType } from "@vibecook/ice";
import { CONTAINABLE, DESK_OBJECT, defineObject } from "@vibecook/ice/desk";
import { SECONDS_GLYPH } from "./glyphs";
import { clockKind, flagProp } from "./kind";
import { CLOCK, CLOCK_STYLES } from "./law";

/** The clock's durable type id — namespaced by its package, as a plugin's ids are. */
export const CLOCK_TYPE = "ice-examples.desk-clock";
/** Its selection-menu act (`ops.runMenuAction`): the seconds hand on or off. */
export const CLOCK_SECONDS_ACT = "desk-clock.seconds";

export const DeskClock: WidgetType = defineObject({
  type: CLOCK_TYPE,
  version: 1,
  props: {
    style: p.enum(CLOCK_STYLES, { default: "classic" }),
    ring24: p.boolean({ default: false }),
    seconds: p.boolean({ default: true }),
    zone: p.string({ default: "local" }),
  },
  size: { w: CLOCK.size, h: CLOCK.size },
  kind: clockKind(),
  // on the pegboard tray (design-017 §8 — the entry a plugin declares as a built-in does): a clock on a hook, among the desk's
  // things, showing the shop's 10:10:30 (a specimen is its kind's stateless drawing); one taken off the board shows the desk's time
  tray: { label: "Clock", category: "things", order: 0, hang: { w: 110, h: 110, accessory: "hook", pegs: [[0, -0.5]] } },
  interaction: { selectable: true, movable: true, resizable: false, snap: "both" },
  // it lies on the desk and goes into a mini mat by what it provides (K8a — the SDK's keys, never a list that names it)
  provides: [CLOCK_TYPE, DESK_OBJECT, CONTAINABLE],
  // its act in the selection menu (K8a — `defineObject({ menu })`): the selected clocks' seconds hand flips (the first's decides, so a
  // mixed selection ends alike), each clock one undo step — with its own glyph (a stopwatch)
  menu: [{
    id: CLOCK_SECONDS_ACT, label: "Seconds hand", keys: "S", glyph: { path: SECONDS_GLYPH },
    run: (api) => {
      const first = api.entities[0];
      if (first === undefined) return;
      const next = !flagProp(api.props(first), "seconds", true);
      for (const e of api.entities) api.setProps(e, { seconds: next });
    },
  }],
});

/** The package's object types — what an app registers (`createCanvasEngine({ widgets: [...DESK_ENGINE.widgets, ...DESK_CLOCK_OBJECTS] })`). */
export const DESK_CLOCK_OBJECTS: readonly WidgetType[] = [DeskClock];
