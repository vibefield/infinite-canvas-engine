// THE KIND BOUNDARY (petition I24; VibeField DK-D22 — a plugin's kind runs in the renderer realm, on the host's device, CONTAINED
// PER KIND BY ICE): one kind's fault is that kind's, never the desk's. A kind REFUSED at create — its pass would not compile, its
// pipeline failed validation (ground.ts `createKindPasses`, each kind's create in its own error scope) — or one whose calls threw
// three times — its world half's `resolve`, `record`, `chip`, `hit`, its desk state's `tick` and `due`; in hand its `held` and its
// `cursor` (M24 LT2); its RENDER half and the rest (M24 LT3, ground.ts `RenderBoundary`): its pass's `spawn`, `prepare`, `drawRange`,
// `drawOver`, `cardSlot`, `cardResources`, `endHold`, the tray's `idle`/`idleAt`, a GPU error its `prepare` raised, a driver's
// `follow`, its desk state's `forget` and `keeps`, a raster's eviction it charged — is MISSING: nothing of it is called
// again, its passes are disposed, its desk state is let go, and its objects wear the desk's own missing face (missing/ — a faint
// hatched card the size of the object's box, pickable; the face an object whose type has no kind wears too). The ladder is
// design-009 §16's (I17's words): a throw is a STRIKE, counted per kind; the third QUARANTINES it. Said ONCE: a `console.error`
// naming the kind and why, and the layer's status gains it (`DeskLayerStatus.faults`, host/layer.ts) — `onStatus` hears each kind
// once. A strike before the third is said on the console alone (`console.warn`: the call, the entity, the error), never to the host.
//
// No cost while nothing faults: `missing` is one size test before any lookup, a strike is counted only when a call threw, and the
// call sites' try/catch allocates nothing.

import type { Entity } from "@ice/core";

/** A kind the desk draws as MISSING, and why — what `DeskLayerStatus.faults` lists, in the order the kinds went missing. */
export interface KindFault {
  readonly kind: string;
  readonly reason: string;
}

/** The strikes a kind is allowed: the third throw makes it missing (design-009 §16's ladder — three strikes, then quarantine). */
export const KIND_STRIKES = 3;

/**
 * A missing kind's row in the layer's `due().kinds` (host/layer.ts): no time — a time there is ≥ 0, `Infinity` never on its own —
 * so −1 reads as what it is: this kind is never due again, nothing of it runs.
 */
export const KIND_MISSING = -1;

export interface KindFaults {
  /** How many kinds are missing — 0 while none is (every call site's first and, then, only test). */
  readonly size: number;
  /** Is `kind` missing (refused at create, or quarantined)? Nothing of it is called again. */
  missing(kind: string): boolean;
  /** `kind` was REFUSED at create (ground.ts — `reason` says so): missing from the start. Said once; a second word for it is ignored. */
  refuse(kind: string, reason: string): void;
  /**
   * One of `kind`'s calls threw: a strike, said on the console with the call and the entity. The third makes it MISSING (said once,
   * the listeners told) — returns true then. A strike for a kind already missing is ignored (its last call's throw, still unwinding).
   */
  strike(kind: string, call: string, err: unknown, entity?: Entity): boolean;
  /** The strikes `kind` has taken (0 … `KIND_STRIKES`). */
  strikes(kind: string): number;
  /** The missing kinds, in the order they went — one array until the next goes (a host may hold it). */
  list(): readonly KindFault[];
  /** Told once for each kind that goes missing, after it is in `list()`. Returns the unsubscribe. */
  subscribe(listener: (fault: KindFault) => void): () => void;
}

/**
 * The first line of a fault worth a host's reading: an error's message, its first non-blank line — for the engine's WGSL refusal
 * (`WGSL <label>:` then the compiler's lines, engine/shader.ts `compile`) the compiler's first, with its place.
 */
export function faultText(err: unknown): string {
  const lines = (err instanceof Error ? err.message : typeof err === "object" && err !== null && "message" in err ? String((err as { message: unknown }).message) : String(err))
    .split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  return (lines.length > 1 && lines[0]?.startsWith("WGSL ") ? `${lines[0]} ${lines[1]}` : lines[0]) ?? "refused";
}

export function createKindFaults(): KindFaults {
  const missing = new Set<string>();
  const strikes = new Map<string, number>();
  const listeners = new Set<(fault: KindFault) => void>();
  let list: readonly KindFault[] = [];
  const go = (kind: string, reason: string): void => {
    missing.add(kind);
    faults.size = missing.size;
    const fault: KindFault = { kind, reason };
    list = [...list, fault];
    console.error(`[ice] desk: the kind "${kind}" is MISSING — ${reason}. Its objects are drawn as missing and nothing of it is called again (petition I24).`);
    for (const l of [...listeners]) l(fault);
  };
  // `size` a plain field (no getter): the builder reads it for every object it draws, and while nothing is missing that read is all
  const faults: { -readonly [K in keyof KindFaults]: KindFaults[K] } = {
    size: 0,
    missing: (kind) => missing.size > 0 && missing.has(kind),
    refuse(kind, reason) {
      if (missing.has(kind)) return;
      go(kind, reason);
    },
    strike(kind, call, err, entity) {
      if (missing.has(kind)) return false;
      const n = (strikes.get(kind) ?? 0) + 1;
      strikes.set(kind, n);
      const on = entity === undefined ? "" : ` on entity ${entity as number}`;
      if (n < KIND_STRIKES) {
        console.warn(`[ice] desk: the kind "${kind}" threw in its \`${call}\`${on} — strike ${n} of ${KIND_STRIKES}; the frame goes on without it`, err);
        return false;
      }
      go(kind, `its \`${call}\` threw${on} (strike ${n} of ${KIND_STRIKES}): ${faultText(err)}`);
      return true;
    },
    strikes: (kind) => strikes.get(kind) ?? 0,
    list: () => list,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  return faults;
}
