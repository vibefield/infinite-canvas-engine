// THE RASTER BUDGET (design-015 §11.4, plan D6 — "the memory budget: only resident boards keep a raster (evict to their
// strokes, replay on return — they are a cache); notebook ink layers and calendar tiles under ONE budget with LRU"). One
// ledger for every raster a kind keeps as a CACHE of its data: a whiteboard's ink (its strokes are the truth — design-015
// §5.1), a notebook page's CPU raster (its strokes), the calendar's print tiles. Each owner CHARGES what it made with a way to
// EVICT it, TOUCHES it when it is used, RELEASES it when it lets go itself; the ledger evicts the least recently used entries
// beyond its cap — never one the owner says to keep this frame (what is on screen) — and the owner remakes an evicted raster
// from its data when it is next drawn. The numbers are the ledger's own (`stats`): the desk's rig reads them; nothing here
// touches the device.

export interface BudgetStats {
  readonly cap: number;
  /** Bytes charged across every owner. */
  readonly used: number;
  readonly entries: number;
  /** Evictions since the ledger was made. */
  readonly evictions: number;
  readonly byOwner: Readonly<Record<string, { readonly bytes: number; readonly entries: number }>>;
}

export interface RasterBudget {
  readonly cap: number;
  /** An owner's raster `key` of `bytes`, and how to let it go; a second charge of the same key re-sizes it (the old bytes released). Touches it. */
  charge(owner: string, key: string, bytes: number, evict: () => void): void;
  /** The raster was used (drawn, written): it is the most recently used now. */
  touch(owner: string, key: string): void;
  /** The owner let the raster go itself (no eviction). */
  release(owner: string, key: string): void;
  /**
   * Evict least-recently-used entries until the charge is within the cap — never one `keep` says to hold (an owner's word on
   * what is on screen this frame; absent, every entry may go). Returns the bytes freed.
   */
  trim(keep?: (owner: string, key: string) => boolean): number;
  stats(): BudgetStats;
}

interface Entry { readonly owner: string; readonly key: string; bytes: number; used: number; readonly evict: () => void }

const id = (owner: string, key: string): string => `${owner}\u0000${key}`;

export function createRasterBudget(cap: number): RasterBudget {
  const entries = new Map<string, Entry>();
  let used = 0;
  let clock = 0;
  let evictions = 0;
  const drop = (k: string, ent: Entry): void => { entries.delete(k); used -= ent.bytes; };
  return {
    cap,
    charge(owner, key, bytes, evict) {
      const k = id(owner, key);
      const had = entries.get(k);
      if (had !== undefined) drop(k, had);
      clock += 1;
      entries.set(k, { owner, key, bytes, used: clock, evict });
      used += bytes;
    },
    touch(owner, key) {
      const ent = entries.get(id(owner, key));
      if (ent !== undefined) { clock += 1; ent.used = clock; }
    },
    release(owner, key) {
      const k = id(owner, key);
      const ent = entries.get(k);
      if (ent !== undefined) drop(k, ent);
    },
    trim(keep) {
      if (used <= cap) return 0;
      // the candidates, least recently used first
      const order = [...entries.entries()].filter(([, e]) => keep === undefined || !keep(e.owner, e.key)).sort((a, b) => a[1].used - b[1].used);
      let freed = 0;
      for (const [k, ent] of order) {
        if (used <= cap) break;
        drop(k, ent);
        freed += ent.bytes;
        evictions += 1;
        ent.evict();
      }
      return freed;
    },
    stats() {
      const byOwner: Record<string, { bytes: number; entries: number }> = {};
      for (const e of entries.values()) {
        let o = byOwner[e.owner];
        if (o === undefined) { o = { bytes: 0, entries: 0 }; byOwner[e.owner] = o; }
        o.bytes += e.bytes;
        o.entries += 1;
      }
      return { cap, used, entries: entries.size, evictions, byOwner };
    },
  };
}
