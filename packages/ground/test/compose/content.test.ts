// @vitest-environment node
// The content term's pure parts (card/content.ts, design-013 §10.2–10.4):
// the uv of a written rect, the record's values by name (mode · layer · uv
// as min+size · chalf = the inner box), the z-run builder (a run breaks only
// where the own texture changes), the record's layout, and the test
// residency's numbers — the fixture both hosts build from the same bytes.
import { describe, expect, it } from "vitest";
import { CONTENT_MODE, FULL_UV, PLATE, TEST_PLATE, contentValues, runsOf, uvOf, type FrameContent } from "../../src/card/content";
import { frameStruct, frameValues } from "../../src/card/layout";
import { MATERIAL, PRODUCT, resolve, VF_EXT, VF_REST } from "../../src/packs/vf-frame";

const view = (tag: string) => ({ tag }) as unknown as GPUTextureView;
const G = resolve(PRODUCT, { centre: [100, 50], contentHalf: [64, 32], radius: 12 }, VF_REST, MATERIAL);
// the record struct is BUILT per card program since design-014; this is the vf-frame pack's
const Frame = frameStruct(VF_EXT);

describe("content — the record", () => {
  it("uvOf normalises a written rect; FULL_UV is the whole texture", () => {
    expect(uvOf(256, 128, 128, 128, 512, 512)).toEqual({ u0: 0.5, v0: 0.25, u1: 0.75, v1: 0.5 });
    expect(uvOf(0, 0, 128, 128, 128, 128)).toEqual(FULL_UV);
  });
  it("contentValues: plate is mode 0 with no uv; page carries its layer; own does not; uv is min + size; chalf is the inner box", () => {
    expect(contentValues(G)).toEqual({ mode: 0, layer: 0, uv: [0, 0, 0, 0], chalf: G.ih });
    expect(contentValues(G, PLATE).mode).toBe(CONTENT_MODE.plate);
    const page: FrameContent = { mode: "page", layer: 1, uv: uvOf(256, 128, 128, 128, 512, 512) };
    expect(contentValues(G, page)).toEqual({ mode: 1, layer: 1, uv: [0.5, 0.25, 0.25, 0.25], chalf: G.ih });
    const own: FrameContent = { mode: "own", texture: view("a"), srgb: true, uv: FULL_UV };
    expect(contentValues(G, own)).toEqual({ mode: 2, layer: 0, uv: [0, 0, 1, 1], chalf: G.ih });
    // at rest under the product style the content is pinned: the inner box IS the widget's rect
    expect(G.ih).toEqual([64, 32]);
  });
  it("frameValues packs the content by name, and the record carries the four fields at a 16-byte multiple", () => {
    const v = frameValues(G, [0.1, 0.2, 0.3], { mode: "page", layer: 1, uv: uvOf(256, 128, 128, 128, 512, 512) });
    expect(v.mode).toBe(1); expect(v.layer).toBe(1); expect(v.uv).toEqual([0.5, 0.25, 0.25, 0.25]); expect(v.chalf).toEqual(G.ih);
    const names = Frame.fields.map(([n]) => n);
    for (const f of ["mode", "layer", "uv", "chalf"]) expect(names).toContain(f);
    expect(Frame.slots.mode.type).toBe("u32"); expect(Frame.slots.layer.type).toBe("i32");
    expect(Frame.size % 16).toBe(0);
    // the packer writes the integers as integers
    const b = Frame.alloc(1); b.set(v, 0);
    expect(new Uint32Array(b.bytes, Frame.slots.mode.byte, 1)[0]).toBe(1);
    expect(new Int32Array(b.bytes, Frame.slots.layer.byte, 1)[0]).toBe(1);
    expect(frameValues(G, [0, 0, 0]).mode).toBe(0);   // absent content = the plate
  });
});

describe("content — the z-runs", () => {
  const A = view("A");
  const B = view("B");
  const page: FrameContent = { mode: "page", layer: 0, uv: FULL_UV };
  const ownA: FrameContent = { mode: "own", texture: A, srgb: false, uv: FULL_UV };
  const ownB: FrameContent = { mode: "own", texture: B, srgb: true, uv: FULL_UV };
  it("a board of plate and page cards is ONE run with no own texture", () => {
    expect(runsOf([PLATE, page, undefined, page])).toEqual([{ first: 0, count: 4, own: null, srgb: false }]);
    expect(runsOf([])).toEqual([]);
  });
  it("a run breaks only where the own texture changes; plate and page cards ride whichever run they fall in", () => {
    expect(runsOf([page, ownA, PLATE, ownA, page])).toEqual([{ first: 0, count: 5, own: A, srgb: false }]);
    expect(runsOf([ownA, page, ownB, ownB, PLATE, ownA])).toEqual([
      { first: 0, count: 2, own: A, srgb: false }, { first: 2, count: 3, own: B, srgb: true }, { first: 5, count: 1, own: A, srgb: false },
    ]);
  });
  it("a run that starts on plate cards adopts the first own texture it meets, with its sRGB variant", () => {
    expect(runsOf([PLATE, PLATE, ownB, page])).toEqual([{ first: 0, count: 4, own: B, srgb: true }]);
  });
});

describe("content — the test residency", () => {
  it("the plate sits at layer 0's origin and off-centre in layer 1, both as quarter-size uvs of a 512² page", () => {
    const P = TEST_PLATE.pages;
    const N = TEST_PLATE.size;
    expect(uvOf(P.at[0][0], P.at[0][1], N, N, P.size, P.size)).toEqual({ u0: 0, v0: 0, u1: 0.25, v1: 0.25 });
    expect(uvOf(P.at[1][0], P.at[1][1], N, N, P.size, P.size)).toEqual({ u0: 0.5, v0: 0.25, u1: 0.75, v1: 0.5 });
    expect(P.layers).toBe(2);
  });
});
