// THE RIG LIVE KINDS' FAULT DOOR (M24 LT3 — design-019 §8's witness; `rig.html?live` alone, never the product's): `__deskRig.live.fault(
// kind, call)` arms a throw in one of a rig live kind's calls — its pass's `prepare` (after its records are written, MID-PASS: a pass of
// its own begun on the frame's encoder and a debug group pushed in it, both left open), its `drawRange` (mid-run: its pipeline and first
// group set, a viewport of its own and a debug group pushed in the desk's pass, left so), its desk state's `held` — so rig:live sees the
// kind quarantined while the desk draws on, on WebGPU as it is: a pass or a debug group left open would have the whole frame refused at
// the submit (the layer `degraded`) but for the ground's guard. `null` disarms it.

/** The calls the door can make throw. */
export type RigFaultCall = "prepare" | "drawRange" | "held";

const armed = new Map<string, RigFaultCall>();

/** Arm `kind`'s `call` to throw from its next call on (`null`: disarmed). */
export function armRigFault(kind: string, call: RigFaultCall | null): void {
  if (call === null) armed.delete(kind);
  else armed.set(kind, call);
}

/** Throws when `kind`'s `call` is armed — a rig kind's call asks it first — after `leave` has left what the throw leaves open. */
export function rigFault(kind: string, call: RigFaultCall, leave?: () => void): void {
  if (armed.size === 0 || armed.get(kind) !== call) return;
  leave?.();
  throw new Error(`rig live: the "${kind}" kind's ${call} throws on purpose (rig:live's fault door)`);
}
