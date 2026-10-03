// rig:remount's BROKEN GENERATION (petition I25 over I24): two kinds registered on the LAYER (`deskLayer({ objects })` — never the
// engine's catalog, so the next generation can be mounted without them, clean), each broken one of the two ways a kind goes missing:
// the clock whose WGSL does not compile (the fixture's own — REFUSED at create) and a clock whose desk state's `tick` throws — asked at
// every step the desk takes, object or none: three strikes and it is QUARANTINED. The memory ledger is read after that generation's
// unmount: nothing either path made may outlive it.

import { clockKind, DeskClockBroken } from "@ice-examples/desk-clock";
import { defineObject, type KindLocal, type ObjectKind } from "@ice/desk";
import type { WidgetType } from "@ice/core";

const clock = clockKind();
const TICKING_KIND = "rig-ticking-clock";
const ticking: ObjectKind = {
  ...clock,
  name: TICKING_KIND,
  local: (host) => {
    const local = clock.local?.(host) as KindLocal;
    local.tick = () => { throw new Error(`${TICKING_KIND}: its desk state's tick throws on purpose`); };
    return local;
  },
};

/** A clock whose desk state's `tick` throws: quarantined at its third, with no object on the desk. */
export const RIG_TICKING_CLOCK: WidgetType = defineObject({ type: "rig.ticking-clock", version: 1, props: {}, size: { w: 150, h: 150 }, kind: ticking });

/** The layer's broken kinds (`rig.html?kindFaults`): one refused at create, one quarantined at three strikes. */
export const KIND_FAULTS: readonly WidgetType[] = [DeskClockBroken, RIG_TICKING_CLOCK];
