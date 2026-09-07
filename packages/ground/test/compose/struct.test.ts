// @vitest-environment node
import { must } from "./must";
import { describe, expect, it } from "vitest";
import { defineStruct, typeInfo } from "../../src/engine/struct";

// Hand-checked against the WGSL host-shareable layout rules. These are the
// cases that go wrong in hand-packed code: vec3 tails, vec4 realignment, and
// the struct-size round-up that makes the same stride legal in both address spaces.
describe("defineStruct layout", () => {
  it("packs a scalar then a vec2 with the vec2 aligned to 8", () => {
    const s = defineStruct("T", [["a", "f32"], ["b", "vec2f"]] as const);
    expect(s.slots.a.byte).toBe(0);
    expect(s.slots.b.byte).toBe(8);
    expect(s.size).toBe(16);
  });

  it("lets a scalar ride in a vec3's tail", () => {
    const s = defineStruct("T", [["v", "vec3f"], ["s", "f32"]] as const);
    expect(s.slots.v.byte).toBe(0);
    expect(s.slots.s.byte).toBe(12);
    expect(s.size).toBe(16);
  });

  it("realigns a vec3 after a scalar to 16", () => {
    const s = defineStruct("T", [["s", "f32"], ["v", "vec3f"]] as const);
    expect(s.slots.v.byte).toBe(16);
    expect(s.size).toBe(32);
  });

  it("gives ten vec4s a 160-byte block (the field's uniform)", () => {
    const fields = Array.from({ length: 10 }, (_, i) => [`v${i}`, "vec4f"] as const);
    const s = defineStruct("Uniforms", fields);
    expect(s.size).toBe(160);
    expect(must(s.slots.v9).byte).toBe(144);
  });

  it("takes a fixed vec4f array — the portal chain — at stride 16, written as one flat list", () => {
    const s = defineStruct("Chain", [["a", "f32"], ["portals", "array<vec4f, 3>"]] as const);
    expect(typeInfo("array<vec4f, 3>")).toEqual({ align: 16, size: 48, n: 12, scalar: "f" });
    expect(typeInfo("array<vec4f, 0>")).toBeUndefined();
    expect(s.slots.portals.byte).toBe(16); expect(s.size).toBe(64);
    expect(s.wgsl).toContain("portals : array<vec4f, 3>,");
    const b = s.alloc(1); b.set({ portals: Array.from({ length: 12 }, (_, i) => i) });
    expect(new Float32Array(b.bytes, 16, 12)[11]).toBe(11);
    expect(() => b.set({ portals: [1, 2] })).toThrow();
  });
  it("rounds a mixed record up to 16 so it strides in a storage array", () => {
    const s = defineStruct("Frame", [
      ["centre", "vec2f"], ["half", "vec2f"], ["outerR", "f32"], ["nw", "vec4f"],
    ] as const);
    expect(s.slots.centre.byte).toBe(0);
    expect(s.slots.half.byte).toBe(8);
    expect(s.slots.outerR.byte).toBe(16);
    expect(s.slots.nw.byte).toBe(32);
    expect(s.size).toBe(48);
  });

  it("emits WGSL in declaration order", () => {
    const s = defineStruct("Card", [["center_half", "vec4f"], ["shape", "vec4f"]] as const);
    expect(s.wgsl).toBe("struct Card {\n  center_half : vec4f,\n  shape       : vec4f,\n}\n");
  });

  it("rejects duplicates", () => {
    expect(() => defineStruct("T", [["a", "f32"], ["a", "f32"]] as const)).toThrow(/duplicate/);
  });
});

describe("StructBuffer.set", () => {
  const Rec = defineStruct("Rec", [["pos", "vec2f"], ["id", "u32"], ["k", "i32"], ["rgba", "vec4f"]] as const);

  it("writes each field at its byte offset, per element", () => {
    const b = Rec.alloc(3);
    b.set({ pos: [1.5, -2], id: 7, k: -3, rgba: [0.1, 0.2, 0.3, 0.4] }, 2);
    const f = new Float32Array(b.bytes);
    const u = new Uint32Array(b.bytes);
    const i = new Int32Array(b.bytes);
    const base = (2 * Rec.size) / 4;
    expect(f[base + 0]).toBe(1.5);
    expect(f[base + 1]).toBe(-2);
    expect(u[base + 2]).toBe(7);
    expect(i[base + 3]).toBe(-3);
    expect(f[base + 4]).toBeCloseTo(0.1);
    expect(f[base + 7]).toBeCloseTo(0.4);
    expect(Rec.size).toBe(32);
  });

  it("refuses unknown names, wrong arity, and out-of-range elements", () => {
    const b = Rec.alloc(1);
    expect(() => b.set({ nope: 1 } as never)).toThrow(/no field/);
    expect(() => b.set({ pos: [1, 2, 3] })).toThrow(/wants 2/);
    expect(() => b.set({ id: 1 }, 1)).toThrow(/outside/);
  });

  it("trims the upload view to a prefix of elements", () => {
    const b = Rec.alloc(8);
    expect(b.view(3).byteLength).toBe(3 * Rec.size);
    expect(b.view().byteLength).toBe(8 * Rec.size);
  });
});
