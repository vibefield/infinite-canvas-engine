// THE RASTER BUDGET (design-015 §11.4, plan D6 — "the memory budget: only resident boards keep a raster (evict to their
// strokes, replay on return — they are a cache); notebook ink layers and calendar tiles under ONE budget with LRU"). One
// ledger for every raster a kind keeps as a CACHE of its data: a whiteboard's ink (its strokes are the truth — design-015
// §5.1), a notebook page's CPU raster (its strokes), the calendar's print tiles. Each owner CHARGES what it made with a way to
// EVICT it, TOUCHES it when it is used, RELEASES it when it lets go itself; the ledger evicts the least recently used entries
// beyond its cap — never one the owner says to keep this frame (what is on screen) — and the owner remakes an evicted raster
// from its data when it is next drawn. The numbers are the ledger's own (`stats`): the desk's rig reads them; nothing here
// touches the device.
//
// RESIDENT charges (K9 R2, design-016 K-L4 "thumbnails always"): what an owner keeps WHOLE — the pictures' and the boards'
// thumbnail arrays — RESIDES: it is never evicted and never in the LRU's way. Before K9 the arrays were charged like caches
// (kept by `keep`, but counted against the cap): past ~128 pictures or boards they alone filled the cap, so the LRU evicted
// every other owner's off-screen raster each tick and the pictures could afford no detail at all. Now the caches' ROOM is what
// the resident charges leave of the cap, never under a FLOOR (a quarter of it — a few details, a board raster or two — however
// many thumbnails stand), and `used` reads the whole honestly: resident and caches together, over the cap when the thumbnails
// alone are (the rig's memory row says so rather than the desk hiding it).

export interface BudgetStats {
  readonly cap: number;
  /** Bytes charged across every owner — the resident arrays and the caches together. */
  readonly used: number;
  /** Bytes that reside (never evicted): the thumbnail arrays. */
  readonly resident: number;
  /** What the caches may hold beside what resides: `cap − resident`, never under the floor. */
  readonly room: number;
  readonly entries: number;
  /** Evictions since the ledger was made. */
  readonly evictions: number;
  readonly byOwner: Readonly<Record<string, { readonly bytes: number; readonly entries: number }>>;
}

export interface RasterBudget {
  readonly cap: number;
  /** The caches' room this moment: `cap − resident`, never under the floor. */
  room(): number;
  /** An owner's raster `key` of `bytes`, and how to let it go; a second charge of the same key re-sizes it (the old bytes released). Touches it. */
  charge(owner: string, key: string, bytes: number, evict: () => void): void;
  /** An owner's `key` kept WHOLE (a thumbnail array): never evicted, outside the caches' room; a second call re-sizes it. */
  reside(owner: string, key: string, bytes: number): void;
  /** The raster was used (drawn, written): it is the most recently used now. */
  touch(owner: string, key: string): void;
  /** The owner let the raster (or the resident array) go itself (no eviction). */
  release(owner: string, key: string): void;
  /**
   * Evict least-recently-used caches until they are within their room — never one `keep` says to hold (an owner's word on
   * what is on screen this frame; absent, every cache may go), never a resident charge. Returns the bytes freed.
   */
  trim(keep?: (owner: string, key: string) => boolean): number;
  stats(): BudgetStats;
}

interface Entry { readonly owner: string; readonly key: string; bytes: number; used: number; readonly resident: boolean; readonly evict: () => void }

const id = (owner: string, key: string): string => `${owner}\u0000${key}`;

/** The caches' floor as a share of the cap: what they may always hold, however much resides (D-K9-d.1). */
export const BUDGET_FLOOR = 1 / 4;

export function createRasterBudget(cap: number, floor: number = Math.floor(cap * BUDGET_FLOOR)): RasterBudget {
  const entries = new Map<string, Entry>();
  let cached = 0;
  let resident = 0;
  let clock = 0;
  let evictions = 0;
  const drop = (k: string, ent: Entry): void => { entries.delete(k); if (ent.resident) resident -= ent.bytes; else cached -= ent.bytes; };
  const room = (): number => Math.max(floor, cap - resident);
  return {
    cap,
    room,
    charge(owner, key, bytes, evict) {
      const k = id(owner, key);
      const had = entries.get(k);
      if (had !== undefined) drop(k, had);
      clock += 1;
      entries.set(k, { owner, key, bytes, used: clock, resident: false, evict });
      cached += bytes;
    },
    reside(owner, key, bytes) {
      const k = id(owner, key);
      const had = entries.get(k);
      if (had !== undefined) drop(k, had);
      clock += 1;
      entries.set(k, { owner, key, bytes, used: clock, resident: true, evict: () => {} });
      resident += bytes;
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
      const limit = room();
      if (cached <= limit) return 0;
      // the candidates, least recently used first
      const order = [...entries.entries()].filter(([, e]) => !e.resident && (keep === undefined || !keep(e.owner, e.key))).sort((a, b) => a[1].used - b[1].used);
      let freed = 0;
      for (const [k, ent] of order) {
        if (cached <= limit) break;
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
      return { cap, used: resident + cached, resident, room: room(), entries: entries.size, evictions, byOwner };
    },
  };
}
