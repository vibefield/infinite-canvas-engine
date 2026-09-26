// PERSISTENT RECORDS (design-015 §4.3; D6) — per kind, per slot: a GPU storage buffer of records
// indexed by a SLOT ALLOCATOR (entity → record index, a free list, grown by doubling), written
// when a record CHANGED and never otherwise, and the DRAW LIST — an index buffer of record slots in
// paint order — rewritten only when membership, order or visibility moved. The prototype's passes
// re-packed and re-uploaded every visible record every frame (`prepare(instances[])`, the per-frame
// form); this is the step it did not take, taken under the oracle: a record's BYTES are the same
// whichever slot holds them, and the shader reads `records[order[instance_index]]`, so no pixel
// moves — only the uploads do.
//
// CHANGE is IDENTITY: the builder reuses a record object while nothing that made it changed and
// hands a fresh one when something did (its facts, its flux, its look, its zoom rung), so the store
// need only compare `===` — plus one number a pass folds in (`aux`: the mini mat's live-inside
// presence, the board's raster's wet — facts the ground or the pass knows and the record does not).
// KEYS are the builder's (the entity; a ghost's negative entity); a frame handed NO keys (the Node
// oracle, a bare host) is TRANSIENT: every slot is dealt afresh from 0 in paint order and packed —
// exactly the prototype's form, so the oracle's frames are what they were, byte for byte.
//
// BLOCKS: a kind whose record owns a fixed run of sub-records (the mini mat's chips) gets a second
// buffer with `per` sub-records a slot, at `slot × per` — the record's `chipFirst` — grown with the
// slots; a pack fills the block and says how many it used, and that many upload with the record.
//
// The uploads are coalesced: dirty slots sorted, runs with gaps of at most `GAP` slots merged, one
// `writeBuffer` a run. Growth reallocates the buffers (the pass rebinds — `version` moved) and
// uploads everything once. `stats()` counts what was written — the instrument rig:stress reads.

import { storageBuffer } from "./pipeline";
import type { StructBuffer, StructDef } from "./struct";

/** How the pass packs one record into its slot; `blocks` (when the store has them) and `blockBase` name the slot's block. Returns the block records used (0 without blocks). */
export type RecordPacker<R, F extends string, B extends string> = (record: R, aux: number, into: StructBuffer<F>, slot: number, blocks: StructBuffer<B> | null, blockBase: number) => number;

export interface RecordStoreOptions<R, F extends string, B extends string = never> {
  readonly device: GPUDevice;
  readonly def: StructDef<F>;
  /** Slots at the start; grown by doubling up to `max` (65,536). */
  readonly capacity: number;
  readonly max?: number;
  /** The records buffer's label (`paper/notes`); the draw list is `<label> order`, the blocks `blocks.label`. */
  readonly label: string;
  readonly pack: RecordPacker<R, F, B>;
  /** A fixed block of `per` sub-records of `def` a slot (the mini mat's chips). */
  readonly blocks?: { readonly def: StructDef<B>; readonly per: number; readonly label: string };
}

export interface RecordStoreStats {
  /** Records packed and uploaded since the store was made. */
  readonly written: number;
  /** Bytes those uploads carried (records and blocks). */
  readonly bytes: number;
  /** Draw-list uploads. */
  readonly orderWrites: number;
  /** Slots in use, the capacity, how many times the buffers were remade. */
  readonly slots: number;
  readonly capacity: number;
  readonly grown: number;
}

export interface RecordStore<R> {
  /** The records buffer, the draw list and (with blocks) the blocks buffer — bind them; their identity moves on growth, `version` says when. */
  readonly records: GPUBuffer;
  readonly order: GPUBuffer;
  readonly blocks: GPUBuffer | null;
  readonly version: number;
  /**
   * One frame's records in paint order. `keys`: one per record, stable across frames (absent = transient: slots dealt from 0,
   * everything packed). `aux(i)`: a number per record folded into the change test and handed to the pack. Returns the count
   * that will draw — `order[0 … count)` names each paint index's slot.
   */
  prepare(records: readonly R[], keys: readonly number[] | undefined, aux?: (index: number) => number): number;
  /** The slot drawn at paint index `i` this frame. */
  slotAt(i: number): number;
  /** What the pack folded in at paint index `i`: its aux and the block records it used. */
  entryAt(i: number): { readonly aux: number; readonly blockN: number };
  /** Every live record repacked at the next `prepare` (a law changed under them). */
  invalidate(): void;
  stats(): RecordStoreStats;
  dispose(): void;
}

interface Entry { readonly key: number; readonly slot: number; record: unknown; aux: number; gen: number; blockN: number }

const DEFAULT_MAX = 65_536;
/** Dirty slots this close are uploaded as one run. */
const GAP = 4;
const NONE: { readonly aux: number; readonly blockN: number } = { aux: 0, blockN: 0 };

export function createRecordStore<R, F extends string, B extends string = never>(opts: RecordStoreOptions<R, F, B>): RecordStore<R> {
  const { device, def, label, pack } = opts;
  const max = opts.max ?? DEFAULT_MAX;
  const blocksDef = opts.blocks;
  const per = blocksDef?.per ?? 0;
  let capacity = Math.max(1, Math.min(opts.capacity, max));
  let cpu = def.alloc(capacity);
  let gpu = storageBuffer(device, def.size * capacity, label);
  let blockCpu: StructBuffer<B> | null = blocksDef ? blocksDef.def.alloc(capacity * per) : null;
  let blockGpu: GPUBuffer | null = blocksDef ? storageBuffer(device, blocksDef.def.size * capacity * per, blocksDef.label) : null;
  let orderCpu = new Uint32Array(capacity);
  let orderGpu = storageBuffer(device, 4 * capacity, `${label} order`);
  let version = 0;
  let grown = 0;
  const byKey = new Map<number, Entry>();
  let bySlot: (Entry | null)[] = new Array<Entry | null>(capacity).fill(null);
  const free: number[] = [];
  let next = 0;
  let gen = 0;
  /** The keys of the last frame (null: it was transient). */
  let lastKeys: number[] | null = null;
  /** The draw list as last uploaded. */
  let prevOrder: number[] = [];
  let count = 0;
  const dirty: number[] = [];
  let written = 0;
  let bytes = 0;
  let orderWrites = 0;

  const grow = (): void => {
    if (capacity >= max) throw new Error(`${label}: ${capacity} record slots is the most this store grows to`);
    const was = capacity;
    capacity = Math.min(capacity * 2, max);
    const nextCpu = def.alloc(capacity);
    new Uint8Array(nextCpu.bytes).set(new Uint8Array(cpu.bytes));
    cpu = nextCpu;
    gpu.destroy();
    gpu = storageBuffer(device, def.size * capacity, label);
    if (blocksDef && blockCpu && blockGpu) {
      const nextBlocks = blocksDef.def.alloc(capacity * per);
      new Uint8Array(nextBlocks.bytes).set(new Uint8Array(blockCpu.bytes));
      blockCpu = nextBlocks;
      blockGpu.destroy();
      blockGpu = storageBuffer(device, blocksDef.def.size * capacity * per, blocksDef.label);
    }
    const nextOrder = new Uint32Array(capacity);
    nextOrder.set(orderCpu);
    orderCpu = nextOrder;
    orderGpu.destroy();
    orderGpu = storageBuffer(device, 4 * capacity, `${label} order`);
    const nextBySlot = new Array<Entry | null>(capacity).fill(null);
    for (let i = 0; i < was; i++) nextBySlot[i] = bySlot[i] ?? null;
    bySlot = nextBySlot;
    version += 1;
    grown += 1;
  };
  let grew = false;
  const alloc = (): number => {
    const reused = free.pop();
    if (reused !== undefined) return reused;
    if (next === capacity) { grow(); grew = true; }
    return next++;
  };
  const release = (ent: Entry): void => {
    byKey.delete(ent.key);
    bySlot[ent.slot] = null;
    free.push(ent.slot);
  };
  /** Every slot given back: the store starts afresh from slot 0 (a transient frame, or the first keyed one after it). */
  const resetAll = (): void => { bySlot.fill(null); byKey.clear(); free.length = 0; next = 0; };
  const packInto = (ent: Entry, record: R, aux: number): void => {
    ent.record = record;
    ent.aux = aux;
    ent.blockN = pack(record, aux, cpu, ent.slot, blockCpu, ent.slot * per);
    dirty.push(ent.slot);
  };
  /** The dirty slots as runs [a, b], sorted and merged where the gap is small. */
  const runs = (): [number, number][] => {
    dirty.sort((a, b) => a - b);
    const out: [number, number][] = [];
    for (const s of dirty) {
      const last = out[out.length - 1];
      if (last !== undefined && s <= last[1] + 1 + GAP) { if (s > last[1]) last[1] = s; } else out.push([s, s]);
    }
    return out;
  };
  const upload = (n: number, orderMoved: boolean): void => {
    let rewriteOrder = orderMoved;
    if (grew) {
      grew = false;
      // everything once: the buffers are new
      if (next > 0) { device.queue.writeBuffer(gpu, 0, cpu.bytes, 0, next * def.size); bytes += next * def.size; }
      if (blocksDef && blockCpu && blockGpu && next > 0) { device.queue.writeBuffer(blockGpu, 0, blockCpu.bytes, 0, next * per * blocksDef.def.size); bytes += next * per * blocksDef.def.size; }
      written += dirty.length;
      dirty.length = 0;
      rewriteOrder = true;
    } else if (dirty.length > 0) {
      for (const [a, b] of runs()) {
        const n0 = b - a + 1;
        device.queue.writeBuffer(gpu, a * def.size, cpu.bytes, a * def.size, n0 * def.size);
        bytes += n0 * def.size;
      }
      if (blocksDef && blockCpu && blockGpu) {
        const bsize = blocksDef.def.size;
        for (const s of dirty) {
          const ent = bySlot[s];
          if (!ent || ent.blockN === 0) continue;
          device.queue.writeBuffer(blockGpu, s * per * bsize, blockCpu.bytes, s * per * bsize, ent.blockN * bsize);
          bytes += ent.blockN * bsize;
        }
      }
      written += dirty.length;
      dirty.length = 0;
    }
    if (rewriteOrder) {
      if (n > 0) device.queue.writeBuffer(orderGpu, 0, orderCpu, 0, n);
      orderWrites += 1;
      prevOrder = Array.from(orderCpu.subarray(0, n));
    }
  };

  return {
    get records() { return gpu; },
    get order() { return orderGpu; },
    get blocks() { return blockGpu; },
    get version() { return version; },
    prepare(records, keys, aux) {
      gen += 1;
      const n = records.length;
      let orderChanged = n !== prevOrder.length;
      if (keys === undefined) {
        // TRANSIENT: the prototype's form — every slot dealt afresh from 0 in paint order, every record packed
        resetAll();
        lastKeys = null;
        for (let i = 0; i < n; i++) {
          const slot = alloc();
          // a transient key is no entity's: a half, never an integer (a ghost's key is its entity negated)
          const ent: Entry = { key: -0.5 - i, slot, record: undefined, aux: 0, gen, blockN: 0 };
          bySlot[slot] = ent;
          packInto(ent, records[i] as R, aux ? aux(i) : 0);
          if (!orderChanged && prevOrder[i] !== slot) orderChanged = true;
          orderCpu[i] = slot;
        }
      } else {
        if (keys.length !== n) throw new Error(`${label}: ${keys.length} keys for ${n} records`);
        // after a transient frame (or none) nothing keyed is live: the store starts afresh, its slots dealt from 0 again
        if (lastKeys === null) resetAll();
        const same = lastKeys !== null && lastKeys.length === n && lastKeys.every((k, i) => k === keys[i]);
        for (let i = 0; i < n; i++) {
          const key = keys[i] as number;
          let ent = byKey.get(key);
          if (ent === undefined) {
            const slot = alloc();
            ent = { key, slot, record: undefined, aux: 0, gen, blockN: 0 };
            byKey.set(key, ent);
            bySlot[slot] = ent;
          }
          ent.gen = gen;
          const a = aux ? aux(i) : 0;
          if (ent.record !== records[i] || ent.aux !== a) packInto(ent, records[i] as R, a);
          if (!orderChanged && prevOrder[i] !== ent.slot) orderChanged = true;
          orderCpu[i] = ent.slot;
        }
        if (!same) {
          // what left: the last frame's keys not seen this frame give their slots back
          if (lastKeys !== null) for (const k of lastKeys) { const ent = byKey.get(k); if (ent !== undefined && ent.gen !== gen) release(ent); }
          lastKeys = keys.slice();
        }
      }
      upload(n, orderChanged);
      count = n;
      return n;
    },
    slotAt: (i) => (i < count ? (orderCpu[i] as number) : -1),
    entryAt(i) {
      if (i >= count) return NONE;
      const ent = bySlot[orderCpu[i] as number];
      return ent === null || ent === undefined ? NONE : { aux: ent.aux, blockN: ent.blockN };
    },
    invalidate() { for (const ent of byKey.values()) ent.record = undefined; },
    stats: () => ({ written, bytes, orderWrites, slots: next - free.length, capacity, grown }),
    dispose() { gpu.destroy(); orderGpu.destroy(); blockGpu?.destroy(); byKey.clear(); },
  };
}
