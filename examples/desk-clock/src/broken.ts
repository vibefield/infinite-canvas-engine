// THE FAULT FIXTURE (petition I24) — the desk clock broken ON PURPOSE, the ways a plugin's kind breaks: its WGSL does not compile (the
// kind is refused at create — the desk boots without it and draws its objects as missing), its `record` throws from a given call on
// (three strikes and the desk quarantines it), its `hit` throws (each pick a strike, and the pick misses it). Each broken kind has its
// own name and type, so it stands beside the clock on one desk; it is the clock in every other respect, on the published entries alone.
// ICE's units drive it (packages/desk/test/kind-faults.test.ts), the oracle draws a refused one (scenes.mjs `fault-*`), rig:clock
// boots the desk with both (`rig.html?plugins&broken`), and VibeField's playground v2 (DK-7) registers them as its fault fixture.

import { p, type WidgetType } from "@vibecook/ice";
import { CONTAINABLE, DESK_OBJECT, defineObject, type ObjectKind } from "@vibecook/ice/desk";
import type { ComposeOptions } from "@vibecook/ice/desk/engine";
import type { MatPass } from "@vibecook/ice/desk/kit";
import { type ClockKindOptions, clockKind } from "./kind";
import { CLOCK, CLOCK_STYLES } from "./law";
import type { ClockGeometry, ClockInstance } from "./layout";
import { ClockPass } from "./pass";
import { clockShaders } from "./shaders";
import type { ClockLook } from "./theme";

/** The identifier the broken WGSL uses and nothing declares — what a compiler refuses it by (a fake device's test reads it too). */
export const BROKEN_WGSL_TOKEN = "desk_clock_broken_on_purpose";

/** How a clock breaks. */
export interface ClockBreak {
  /** Its kind's name — unique on a desk (default `desk-clock-broken`). */
  readonly name?: string;
  /** Its WGSL does not compile: a function of its own module names `BROKEN_WGSL_TOKEN` — the engine's `compile` throws, its create rejects. */
  readonly wgsl?: boolean;
  /** Its `record` throws from this call on, 1-based (3: the third record it is asked for, and every one after). Absent: never. */
  readonly recordFrom?: number;
  /** Its `hit` throws, every pick. */
  readonly hit?: boolean;
}

/** The clock's program with one more module that names what nothing declares: the compiler refuses the whole of it. */
export function brokenClockShaders(text?: ClockKindOptions["text"]): ComposeOptions {
  const s = clockShaders(text);
  return { ...s, modules: [...(s.modules ?? []), { label: "desk-clock/broken.wgsl", text: `fn desk_clock_broken() -> f32 { return ${BROKEN_WGSL_TOKEN}; }\n` }] };
}

/** A clock kind broken as `how` says — the clock's own kind in every other respect (it never opens: a fixture is looked at, not set). */
export function brokenClockKind(how: ClockBreak, opts: ClockKindOptions = {}): ObjectKind<ClockGeometry, ClockInstance, ClockLook> {
  const base = clockKind(opts);
  const name = how.name ?? "desk-clock-broken";
  let records = 0;
  const { open: _open, ...rest } = base;
  return {
    ...rest,
    name,
    ...(how.wgsl === true ? { create: async (device: GPUDevice, format: GPUTextureFormat, mat: MatPass) => ClockPass.create(device, format, brokenClockShaders(opts.text), mat) } : {}),
    record(G, ctx) {
      records += 1;
      if (how.recordFrom !== undefined && records >= how.recordFrom) throw new Error(`${name}: its record throws on purpose (call ${records})`);
      return base.record(G, ctx);
    },
    hit: how.hit === true ? () => { throw new Error(`${name}: its hit throws on purpose`); } : base.hit,
  };
}

/** The props and the size every broken clock shares with the clock. */
const clockLike = {
  version: 1,
  props: {
    style: p.enum(CLOCK_STYLES, { default: "classic" }),
    ring24: p.boolean({ default: false }),
    seconds: p.boolean({ default: true }),
    zone: p.string({ default: "local" }),
  },
  size: { w: CLOCK.size, h: CLOCK.size },
  interaction: { selectable: true, movable: true, resizable: false, snap: "both" },
} as const;

/** The type of a clock whose WGSL does not compile. */
export const BROKEN_CLOCK_TYPE = "ice-examples.desk-clock.broken";
/** …and of one whose `record` throws from its third call and whose `hit` throws. */
export const FAULTY_CLOCK_TYPE = "ice-examples.desk-clock.faulty";

/** A clock the desk REFUSES at create (its WGSL does not compile): drawn as missing from the first frame, said once at the boot. */
export const DeskClockBroken: WidgetType = defineObject({ ...clockLike, type: BROKEN_CLOCK_TYPE, kind: brokenClockKind({ name: "desk-clock-broken", wgsl: true }), provides: [BROKEN_CLOCK_TYPE, DESK_OBJECT, CONTAINABLE] });

/** A clock the desk QUARANTINES: its record throws from its third call, its hit on every pick — three strikes, then missing, said once. */
export const DeskClockFaulty: WidgetType = defineObject({ ...clockLike, type: FAULTY_CLOCK_TYPE, kind: brokenClockKind({ name: "desk-clock-faulty", recordFrom: 3, hit: true }), provides: [FAULTY_CLOCK_TYPE, DESK_OBJECT, CONTAINABLE] });

/** The fault fixture's object types — what a host registers beside the clock to see a kind break (`rig.html?plugins&broken`, DK-7). */
export const BROKEN_CLOCK_OBJECTS: readonly WidgetType[] = [DeskClockBroken, DeskClockFaulty];
