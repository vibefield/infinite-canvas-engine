import { Texture } from "three";
import { describe, expect, it } from "vitest";
import { CompositeMaterial } from "../src/composite-material";

describe("CompositeMaterial", () => {
  it("exposes the neutral uniforms + the drag clip, and no app LOOKS", () => {
    const mat = new CompositeMaterial();
    // uDraggedRect/uIsDragged are ENGINE facts again (2026-07-13 amendment:
    // the chrome sandwich makes the clip compositing correctness, not a look).
    expect(Object.keys(mat.uniforms).sort()).toEqual(["map", "uDraggedRect", "uIsDragged", "uOpacity"]);
    expect(mat.uniforms.map?.value).toBeNull();
    expect(mat.uniforms.uOpacity?.value).toBe(1);
    expect(mat.uniforms.uDraggedRect?.value).toEqual([0, 0, 0, 0]); // off at rest
    expect(mat.uniforms.uIsDragged?.value).toBe(0);
    // v1's overlap-glow / rim uniforms stay DELETED — those live in DOM chrome now.
    expect(mat.uniforms.uHotStrength).toBeUndefined();
    expect(mat.uniforms.uGlowColor).toBeUndefined();
  });

  it("setDraggedRect / setIsDragged drive the clip uniforms in place (no allocation)", () => {
    const mat = new CompositeMaterial();
    const cell = mat.uniforms.uDraggedRect?.value as number[];
    mat.setDraggedRect(10, -60, 110, 40);
    expect(mat.uniforms.uDraggedRect?.value).toBe(cell); // same array, mutated
    expect(cell).toEqual([10, -60, 110, 40]);
    mat.setIsDragged(true);
    expect(mat.uniforms.uIsDragged?.value).toBe(1);
    mat.setIsDragged(false);
    expect(mat.uniforms.uIsDragged?.value).toBe(0);
    // The shader tests composite-space position from the model transform —
    // resolution/DPR-free by construction (v1 used gl_FragCoord + Y math).
    expect(mat.vertexShader).toContain("vWorld = (modelMatrix");
    expect(mat.fragmentShader).toContain("uDraggedRect");
    expect(mat.fragmentShader).toContain("uIsDragged < 0.5");
  });

  it("setMap binds and clears the FBO texture", () => {
    const mat = new CompositeMaterial();
    const tex = new Texture();
    mat.setMap(tex);
    expect(mat.uniforms.map?.value).toBe(tex);
    mat.setMap(null);
    expect(mat.uniforms.map?.value).toBeNull();
  });

  it("setOpacity is pass-through with no clamping", () => {
    const mat = new CompositeMaterial();
    mat.setOpacity(0.5);
    expect(mat.uniforms.uOpacity?.value).toBe(0.5);
    mat.setOpacity(2.5);
    expect(mat.uniforms.uOpacity?.value).toBe(2.5);
    mat.setOpacity(-1);
    expect(mat.uniforms.uOpacity?.value).toBe(-1);
  });

  it("carries the sample-and-write GL flags: no tone map, transparent, no depth write", () => {
    const mat = new CompositeMaterial();
    expect(mat.toneMapped).toBe(false);
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
  });

  it("re-encodes to output colour space but never tone-maps (sRGB double-encode trap)", () => {
    const mat = new CompositeMaterial();
    // The FBO holds sRGB values already: keep the colorspace re-encode chunk,
    // drop tone mapping entirely (see composite-material.ts fragment note).
    expect(mat.fragmentShader).toContain("#include <colorspace_fragment>");
    expect(mat.fragmentShader).not.toContain("tonemapping_fragment");
  });

  it("dispose() is callable (inherited from ShaderMaterial)", () => {
    const mat = new CompositeMaterial();
    expect(() => mat.dispose()).not.toThrow();
  });
});
