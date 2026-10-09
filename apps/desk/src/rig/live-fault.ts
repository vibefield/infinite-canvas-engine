// THE RIG LIVE KINDS' FAULT DOOR (M24 LT3 — design-019 §8's witness; `rig.html?live` alone, never the product's): `__deskRig.live.fault(
// kind, call)` arms a throw in one of a rig live kind's calls — its pass's `prepare` (after its records are written: its buffers left
// half-made) or `drawRange` (after its pipeline and first group are set: the pass mid-run), its desk state's `held` — so rig:live sees
// the kind quarantined while the desk draws on. `null` disarms it.

/** The calls the door can make throw. */
export type RigFaultCall = "prepare" | "drawRange" | "held";

const armed = new Map<string, RigFaultCall>();

/** Arm `kind`'s `call` to throw from its next call on (`null`: disarmed). */
export function armRigFault(kind: string, call: RigFaultCall | null): void {
  if (call === null) armed.delete(kind);
  else armed.set(kind, call);
}

/** Throws when `kind`'s `call` is armed — a rig kind's call asks it first. */
export function rigFault(kind: string, call: RigFaultCall): void {
  if (armed.size > 0 && armed.get(kind) === call) throw new Error(`rig live: the "${kind}" kind's ${call} throws on purpose (rig:live's fault door)`);
}
