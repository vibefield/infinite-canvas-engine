import { Texture } from "three";
import { describe, expect, it } from "vitest";
import { CompositeMaterial } from "../src/composite-material";

describe("CompositeMaterial", () => {
  it("exposes exactly the neutral uniforms { map, uOpacity } and no app looks", () => {
    const mat = new CompositeMaterial();
    expect(Object.keys(mat.uniforms).sort()).toEqual(["map", "uOpacity"]);
    expect(mat.uniforms.map?.value).toBeNull();
    expect(mat.uniforms.uOpacity?.value).toBe(1);
    // v1's drag-promote / overlap-glow / rim uniforms are DELETED (design-004 §3).
    expect(mat.uniforms.uDraggedRect).toBeUndefined();
    expect(mat.uniforms.uIsDragged).toBeUndefined();
    expect(mat.uniforms.uHotStrength).toBeUndefined();
    expect(mat.uniforms.uGlowColor).toBeUndefined();
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
