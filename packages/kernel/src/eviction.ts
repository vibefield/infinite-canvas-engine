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
