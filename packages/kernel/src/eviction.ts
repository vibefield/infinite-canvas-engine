/**
 * FBO-pool eviction policy — ported from v1 `eviction.ts` (pure part of the
 * pool). Priority: Cold(0) < Warm(1) < Dormant(2); LRU within a phase;
 * Hot/Waking are never evicted even under an impossible budget.
 */
export type IslandPhase = "Hot" | "Warm" | "Waking" | "Cold" | "Dormant";

export interface EvictionCandidate<Id> {
  id: Id;
  phase: IslandPhase;
  bytes: number;
  lastUsedMs: number;
}

const PHASE_PRIORITY: Record<IslandPhase, number> = {
  Cold: 0,
  Warm: 1,
  Dormant: 2,
  Waking: Number.POSITIVE_INFINITY,
  Hot: Number.POSITIVE_INFINITY,
};

/**
 * The island phase truth table (design-004 §3; v1 `computePhase` verbatim —
 * RFC-002 pinned it with tests). `active` is the nested-canvas membership
 * signal (always true until M8); `hasFbo` splits Warm (retained texture,
 * composite-ready) from Waking (must paint before compositing) — after an
 * eviction a re-entering island comes back as Waking, after a plain cull
 * round-trip it comes back Warm from the retained texture.
 */
export function computeIslandPhase(
  active: boolean,
  visible: boolean,
  animating: boolean,
  hasFbo: boolean,
): IslandPhase {
  if (!active) return "Dormant";
  if (visible) {
    if (animating) return "Hot";
    return hasFbo ? "Warm" : "Waking";
  }
  // Culled OR not yet culled-classified: treat as Cold — never paint a widget
  // the engine hasn't placed in the viewport yet (v1 rule, kept).
  return "Cold";
}

/** Ordered ids to release so total bytes ≤ budget. Pure. */
export function selectEvictions<Id>(
  candidates: EvictionCandidate<Id>[],
  totalBytes: number,
  maxBytes: number,
): Id[] {
  if (totalBytes <= maxBytes) return [];

  const eligible = candidates.filter((c) => Number.isFinite(PHASE_PRIORITY[c.phase]));
  eligible.sort((a, b) => {
    const p = PHASE_PRIORITY[a.phase] - PHASE_PRIORITY[b.phase];
    if (p !== 0) return p;
    return a.lastUsedMs - b.lastUsedMs;
  });

  const toEvict: Id[] = [];
  let remaining = totalBytes;
  for (const c of eligible) {
    if (remaining <= maxBytes) break;
    toEvict.push(c.id);
    remaining -= c.bytes;
  }
  return toEvict;
}
