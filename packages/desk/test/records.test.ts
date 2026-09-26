// @vitest-environment node
// PERSISTENT RECORDS (design-015 §4.3; D6) — the store behind every per-instance pass, on a device of stubs that
// records each `writeBuffer` by label, offset and length. Pinned: a frame of the same records under the same keys
// writes NOTHING (the change-only law — a camera move hands the pass the same objects); a changed record writes its
// slot alone; the draw list (`<label> order`) is rewritten only when the paint order moved; slots are stable, freed
// when a key leaves and reused (the most recently freed first); the capacity doubles when the slots run out and the
// buffers are remade (the version moves, everything uploads once); a frame with no keys is transient (slots 0 … n−1,
// every record packed — the oracle's form); blocks upload with their record, only the part used.
import { describe, expect, it } from "vitest";
import { createRecordStore } from "../src/engine/records";
import { defineStruct } from "../src/engine/struct";
import { installGpuFlags } from "./fake-gpu";

const Rec = defineStruct("Rec", [["a", "f32"], ["b", "f32"]]);   // 16 bytes a record
const Blk = defineStruct("Blk", [["v", "vec4f"]]);                // 16 bytes a block record

interface Write { label: string; offset: number; bytes: number }

/** A device whose buffers carry a label and whose queue records every `writeBuffer`. */
function device(writes: Write[]) {
  installGpuFlags();
  const bufs = new Set<string>();
  return {
    createBuffer: (d: GPUBufferDescriptor) => { bufs.add(d.label ?? ""); return { label: d.label ?? "", size: d.size, destroy: () => { bufs.delete(d.label ?? ""); }, getMappedRange: () => new ArrayBuffer(0) }; },
    queue: {
      writeBuffer: (b: { label: string }, offset: number, data: ArrayBuffer | ArrayBufferView, dataOffset?: number, size?: number) => {
        const elem = ArrayBuffer.isView(data) ? ((data as { BYTES_PER_ELEMENT?: number }).BYTES_PER_ELEMENT ?? 1) : 1;
        const bytes = size !== undefined ? size * elem : data.byteLength - (dataOffset ?? 0) * elem;
        writes.push({ label: b.label, offset, bytes });
      },
    },
  } as unknown as GPUDevice;
}

type R = { a: number; b: number };
const rec = (a: number, b = 0): R => ({ a, b });

function store(writes: Write[], capacity = 4, blocks = false) {
  return createRecordStore<R, "a" | "b", "v">({
    device: device(writes), def: Rec, capacity, max: 16, label: "t/records",
    pack: (r, aux, into, slot, blk, base) => {
      into.set({ a: r.a, b: r.b + aux }, slot);
      if (blk === null) return 0;
      const n = Math.min(3, Math.max(0, Math.round(r.b)));
      for (let j = 0; j < n; j++) blk.set({ v: [r.a, j, 0, 0] }, base + j);
      return n;
    },
    ...(blocks ? { blocks: { def: Blk, per: 3, label: "t/blocks" } } : {}),
  });
}
const of = (writes: Write[], label: string) => writes.filter((w) => w.label === label);

describe("persistent records · change-only writes (design-015 §4.3)", () => {
  it("the same records under the same keys write NOTHING — a camera move hands the pass the same objects (proven red: a per-frame pack would write every slot)", () => {
    const writes: Write[] = [];
    const s = store(writes);
    const a = rec(1);
    const b = rec(2);
    expect(s.prepare([a, b], [10, 20])).toBe(2);
    // the first frame: both records in one run, the draw list once
    expect(of(writes, "t/records")).toEqual([{ label: "t/records", offset: 0, bytes: 32 }]);
    expect(of(writes, "t/records order")).toEqual([{ label: "t/records order", offset: 0, bytes: 8 }]);
    writes.length = 0;
    for (let i = 0; i < 5; i++) expect(s.prepare([a, b], [10, 20])).toBe(2);
    expect(writes).toEqual([]);
    expect(s.stats().written).toBe(2);
    expect(s.stats().orderWrites).toBe(1);
  });

  it("a changed record writes ITS slot alone, at its offset; the draw list stands", () => {
    const writes: Write[] = [];
    const s = store(writes);
    const a = rec(1);
    const b = rec(2);
    const c = rec(3);
    s.prepare([a, b, c], [10, 20, 30]);
    writes.length = 0;
    const b2 = rec(2.5);
    s.prepare([a, b2, c], [10, 20, 30]);
    expect(writes).toEqual([{ label: "t/records", offset: 16, bytes: 16 }]);
    // the aux is part of the identity: the same object with another aux repacks
    writes.length = 0;
    s.prepare([a, b2, c], [10, 20, 30], (i) => (i === 2 ? 1 : 0));
    expect(writes).toEqual([{ label: "t/records", offset: 32, bytes: 16 }]);
    expect(s.entryAt(2).aux).toBe(1);
  });

  it("the paint order moving rewrites the draw list and nothing else; slots are stable", () => {
    const writes: Write[] = [];
    const s = store(writes);
    const a = rec(1);
    const b = rec(2);
    s.prepare([a, b], [10, 20]);
    expect([s.slotAt(0), s.slotAt(1)]).toEqual([0, 1]);
    writes.length = 0;
    s.prepare([b, a], [20, 10]);
    expect(writes).toEqual([{ label: "t/records order", offset: 0, bytes: 8 }]);
    expect([s.slotAt(0), s.slotAt(1)]).toEqual([1, 0]);
  });

  it("a key that leaves frees its slot; the next new key REUSES it (the most recently freed first); the count follows the frame", () => {
    const writes: Write[] = [];
    const s = store(writes);
    const [a, b, c] = [rec(1), rec(2), rec(3)];
    s.prepare([a, b, c], [10, 20, 30]);
    expect(s.stats().slots).toBe(3);
    expect(s.prepare([a, c], [10, 30])).toBe(2);   // b left
    expect(s.stats().slots).toBe(2);
    expect([s.slotAt(0), s.slotAt(1)]).toEqual([0, 2]);
    writes.length = 0;
    const d = rec(4);
    s.prepare([a, c, d], [10, 30, 40]);   // d takes b's slot 1
    expect([s.slotAt(0), s.slotAt(1), s.slotAt(2)]).toEqual([0, 2, 1]);
    expect(of(writes, "t/records")).toEqual([{ label: "t/records", offset: 16, bytes: 16 }]);
    // b returns: a new slot again (its old record is forgotten with the slot), packed afresh
    writes.length = 0;
    s.prepare([a, b, c, d], [10, 20, 30, 40]);
    expect(s.stats().slots).toBe(4);
    expect(of(writes, "t/records").length).toBe(1);
  });

  it("the slots run out: the capacity doubles, the buffers are remade (the version moves) and everything uploads once", () => {
    const writes: Write[] = [];
    const s = store(writes, 2);
    const v0 = s.version;
    s.prepare([rec(1), rec(2)], [1, 2]);
    expect(s.stats().capacity).toBe(2);
    writes.length = 0;
    s.prepare([rec(1), rec(2), rec(3)], [1, 2, 3]);
    expect(s.version).toBe(v0 + 1);
    expect(s.stats().capacity).toBe(4);
    expect(s.stats().grown).toBe(1);
    expect(of(writes, "t/records")).toEqual([{ label: "t/records", offset: 0, bytes: 48 }]);
    expect(of(writes, "t/records order")).toEqual([{ label: "t/records order", offset: 0, bytes: 12 }]);
    // past `max` it refuses rather than grows without end
    const many = Array.from({ length: 17 }, (_, i) => rec(i));
    expect(() => s.prepare(many, many.map((_, i) => 100 + i))).toThrow(/most this store grows to/);
  });

  it("no keys = TRANSIENT (the oracle's form): slots 0 … n−1 in paint order, every record packed, every frame", () => {
    const writes: Write[] = [];
    const s = store(writes);
    const a = rec(1);
    s.prepare([a, rec(2)], undefined);
    expect([s.slotAt(0), s.slotAt(1)]).toEqual([0, 1]);
    writes.length = 0;
    s.prepare([a, rec(2)], undefined);
    expect(of(writes, "t/records")).toEqual([{ label: "t/records", offset: 0, bytes: 32 }]);
    expect(of(writes, "t/records order")).toEqual([]);   // the identity order stood
    // keyed after transient: nothing keyed was live — the store starts afresh from slot 0
    writes.length = 0;
    s.prepare([a], [10]);
    expect(s.slotAt(0)).toBe(0);
    expect(s.stats().slots).toBe(1);
    expect(of(writes, "t/records")).toEqual([{ label: "t/records", offset: 0, bytes: 16 }]);
    expect(of(writes, "t/records order")).toEqual([{ label: "t/records order", offset: 0, bytes: 4 }]);
  });

  it("blocks: a slot's block uploads with its record, the part used only, at slot × per", () => {
    const writes: Write[] = [];
    const s = store(writes, 4, true);
    const a = rec(1, 2);
    s.prepare([a, rec(2, 0)], [10, 20]);   // 2 block records, then none
    expect(of(writes, "t/blocks")).toEqual([{ label: "t/blocks", offset: 0, bytes: 32 }]);
    expect(s.entryAt(0).blockN).toBe(2);
    expect(s.entryAt(1).blockN).toBe(0);
    writes.length = 0;
    s.prepare([a, rec(2, 3)], [10, 20]);   // the second grows a block of 3 at slot 1 × 3 × 16; the first stands
    expect(of(writes, "t/blocks")).toEqual([{ label: "t/blocks", offset: 48, bytes: 48 }]);
    expect(of(writes, "t/records")).toEqual([{ label: "t/records", offset: 16, bytes: 16 }]);
  });

  it("`invalidate` repacks every live record at the next frame (a law changed under them)", () => {
    const writes: Write[] = [];
    const s = store(writes);
    const [a, b] = [rec(1), rec(2)];
    s.prepare([a, b], [10, 20]);
    writes.length = 0;
    s.invalidate();
    s.prepare([a, b], [10, 20]);
    expect(of(writes, "t/records")).toEqual([{ label: "t/records", offset: 0, bytes: 32 }]);
  });
});
