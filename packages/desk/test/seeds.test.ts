// The hand's SEEDS as a durable cell (design-015 D-D13; D2c): the codec is exact and deterministic,
// its reader tolerant, a glyph with no stored seed writes the note's own `glyphSeed` — which is a new
// note's hand — and an edit CARRIED through the encoded cell keeps every untouched glyph's hand.
import { describe, expect, it } from "vitest";
import { decodeSeeds, encodeSeeds, seedsFor } from "../src/paper/seeds";
import { carrySeeds, glyphSeed } from "../src/paper/text";

describe("the seeds cell (paper/seeds.ts)", () => {
  it("round-trips any i32s exactly, 4 bytes a glyph, deterministic", () => {
    const seeds = [0, 1, -1, 0x7fffffff, -0x80000000, 123456789, -987654321, glyphSeed(7, 3)];
    const s = encodeSeeds(seeds);
    expect(decodeSeeds(s)).toEqual(seeds);
    expect(encodeSeeds(seeds)).toBe(s);
    expect(s).toMatch(/^[A-Za-z0-9+/]*$/);
    expect(s.length).toBe(Math.ceil((seeds.length * 4 * 8) / 6));
    expect(encodeSeeds([])).toBe("");
    expect(decodeSeeds("")).toEqual([]);
    // a pinned value: the codec is the cell's format, so its bytes may never drift
    expect(encodeSeeds([1, 256])).toBe("AQAAAAABAAA");
  });

  it("reads tolerantly: whole seeds only, anything unreadable ends the run", () => {
    const s = encodeSeeds([11, 22, 33]);
    expect(decodeSeeds(s.slice(0, 7))).toEqual([11]);   // 42 bits: one whole seed, the rest dropped
    expect(decodeSeeds(`${s.slice(0, 6)}!${s.slice(6)}`)).toEqual([11]);
    expect(decodeSeeds("not base64 at all ✗")).toEqual([]);
  });

  it("seedsFor: the stored seeds index for index, and the note's own glyphSeed past them — a new note's hand", () => {
    expect(seedsFor("abc", "", 7)).toEqual([glyphSeed(7, 0), glyphSeed(7, 1), glyphSeed(7, 2)]);
    expect(seedsFor("abc", encodeSeeds([5]), 7)).toEqual([5, glyphSeed(7, 1), glyphSeed(7, 2)]);
    expect(seedsFor("a", encodeSeeds([5, 6, 7]), 7)).toEqual([5]);
    expect(seedsFor("", encodeSeeds([5]), 7)).toEqual([]);
  });

  it("an edit carried THROUGH the cell keeps every untouched glyph's hand and gives the inserted run fresh ones", () => {
    let next = 1000;
    const fresh = () => next++;
    const text0 = "buy milk";
    const cell0 = encodeSeeds(seedsFor(text0, "", 7));
    const c1 = carrySeeds(text0, seedsFor(text0, cell0, 7), "buy oat milk", fresh);
    const cell1 = encodeSeeds(c1.seeds);
    const s1 = decodeSeeds(cell1);
    expect([c1.from, c1.to]).toEqual([4, 8]);
    expect(s1.slice(0, 4)).toEqual(seedsFor(text0, "", 7).slice(0, 4));   // the prefix keeps its hand
    expect(s1.slice(4, 8)).toEqual([1000, 1001, 1002, 1003]);              // the inserted run: fresh
    expect(s1.slice(8)).toEqual(seedsFor(text0, "", 7).slice(4));          // the suffix keeps its hand
    // and a second session on the stored cell carries the first one's fresh seeds on
    const c2 = carrySeeds("buy oat milk", seedsFor("buy oat milk", cell1, 7), "buy oat milk!", fresh);
    expect(c2.seeds.slice(0, 12)).toEqual(s1);
  });
});
