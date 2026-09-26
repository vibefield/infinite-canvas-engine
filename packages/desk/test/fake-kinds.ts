// Fake kinds for the draw tree (the prototype's portal-test pattern, generalised to the registry): a
// slot whose mat and whose every kind's pass log each draw they are asked for — `<slot> mat`,
// `<slot> <kind> <first>..<end>`, `<slot> <kind> over <index>` — and a render pass that logs its
// scissor. No GPU: `drawSlot` and `drawFrame` only ever call these.
import type { DrawSlot, KindPass, SlotKind, StratumName } from "../src/ground";

/** A kind as a slot holds it, its pass logging every range (and, for a sheet that holds a desk, every `drawOver`). */
export function loggingKind(log: string[], slot: string, name: string, stratum: StratumName, over = false): SlotKind {
  const pass = {
    drawRange: (_p: unknown, first: number, end: number) => log.push(`${slot} ${name} ${first}..${end}`),
    ...(over ? { drawOver: (_p: unknown, index: number) => log.push(`${slot} ${name} over ${index}`) } : {}),
  };
  return { name, stratum, pass: pass as unknown as KindPass };
}

export interface FakeSlotSpec {
  /** The registry, in registration order: each kind's name, stratum and whether it draws over a live inside. */
  readonly kinds: readonly (readonly [string, StratumName, boolean?])[];
  /** The slot's objects in paint order, by kind name. */
  readonly objects?: readonly string[];
  readonly present?: DrawSlot["present"];
  readonly children?: DrawSlot["children"];
  /** Layers on the mat (each logs `<slot> underlay <i>`). */
  readonly underlays?: number;
}

/** A slot of logging kinds; its `stats` carry its name (drawFrame hands them back). */
export function fakeSlot(log: string[], name: string, spec: FakeSlotSpec): DrawSlot {
  return {
    mat: { draw: () => log.push(`${name} mat`) } as unknown as DrawSlot["mat"],
    kinds: new Map(spec.kinds.map(([kind, stratum, over]) => [kind, loggingKind(log, name, kind, stratum, over ?? false)])),
    ...(spec.objects ? { objects: spec.objects.map((kind) => ({ kind })) } : {}),
    ...(spec.underlays ? { underlays: Array.from({ length: spec.underlays }, (_, i) => ({ draw: () => log.push(`${name} underlay ${i}`) })) } : {}),
    present: spec.present,
    children: spec.children,
    stats: { name } as unknown as DrawSlot["stats"],
  };
}

/** The desk's shape of slot: mini mats (sheets, their chips over a live inside) and notes (things). */
export const DESK: FakeSlotSpec["kinds"] = [["minimat", "sheets", true], ["paper", "things"]];

/** A render pass that logs its scissor. */
export const scissorPass = (log: string[]) => ({ setScissorRect: (x: number, y: number, w: number, h: number) => log.push(`scissor ${x},${y},${w},${h}`) }) as unknown as GPURenderPassEncoder;
