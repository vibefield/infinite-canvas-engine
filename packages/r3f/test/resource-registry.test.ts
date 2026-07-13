import { BufferAttribute, BufferGeometry, MeshBasicMaterial, Texture } from "three";
import { describe, expect, it, vi } from "vitest";
import { ResourceRegistry } from "../src/resource-registry";

// Flush the microtask queue so deferred disposals (queueMicrotask) resolve.
const flushMicrotasks = () => Promise.resolve();

describe("ResourceRegistry", () => {
  it("runs the factory once per key and shares the instance across acquires", () => {
    const reg = new ResourceRegistry();
    const factory = vi.fn(() => new BufferGeometry());
    const a = reg.acquireGeometry("card", factory);
    const b = reg.acquireGeometry("card", factory);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(b).toBe(a);
    expect(reg.geometryCount()).toBe(1);
  });

  it("defers disposal by a microtask when the refcount reaches zero", async () => {
    const reg = new ResourceRegistry();
    const geo = new BufferGeometry();
    const disposeSpy = vi.spyOn(geo, "dispose");
    reg.acquireGeometry("card", () => geo);

    reg.releaseGeometry("card");
    // Synchronously the resource is still alive — the defer covers StrictMode's
    // cleanup→remount flap.
    expect(disposeSpy).not.toHaveBeenCalled();
    expect(reg.geometryCount()).toBe(1);

    await flushMicrotasks();
    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(reg.geometryCount()).toBe(0);
  });

  it("cancels the deferred disposal when re-acquired before the microtask runs", async () => {
    const reg = new ResourceRegistry();
    const geo = new BufferGeometry();
    const disposeSpy = vi.spyOn(geo, "dispose");
    const factory = vi.fn(() => geo);

    reg.acquireGeometry("card", factory);
    reg.releaseGeometry("card"); // refCount 0 → schedules microtask dispose
    reg.acquireGeometry("card", factory); // refCount back to 1 before the flush

    await flushMicrotasks();
    expect(disposeSpy).not.toHaveBeenCalled();
    expect(factory).toHaveBeenCalledTimes(1); // still the same shared instance
    expect(reg.geometryCount()).toBe(1);
  });

  it("ref-counts materials and textures the same way", async () => {
    const reg = new ResourceRegistry();
    const mat = new MeshBasicMaterial();
    const tex = new Texture();
    const matDispose = vi.spyOn(mat, "dispose");
    const texDispose = vi.spyOn(tex, "dispose");

    reg.acquireMaterial("m", () => mat);
    reg.acquireMaterial("m", () => mat); // refCount 2
    reg.acquireTexture("t", () => tex);
    expect(reg.materialCount()).toBe(1);
    expect(reg.textureCount()).toBe(1);

    reg.releaseMaterial("m"); // refCount 1 — not yet disposable
    await flushMicrotasks();
    expect(matDispose).not.toHaveBeenCalled();

    reg.releaseMaterial("m"); // refCount 0
    reg.releaseTexture("t"); // refCount 0
    await flushMicrotasks();
    expect(matDispose).toHaveBeenCalledTimes(1);
    expect(texDispose).toHaveBeenCalledTimes(1);
    expect(reg.materialCount()).toBe(0);
    expect(reg.textureCount()).toBe(0);
  });

  it("estimates geometry bytes from attribute + index buffers", () => {
    const reg = new ResourceRegistry();
    reg.acquireGeometry("g", () => {
      const geo = new BufferGeometry();
      geo.setAttribute("position", new BufferAttribute(new Float32Array(12), 3)); // 48 bytes
      geo.setIndex(new BufferAttribute(new Uint16Array(6), 1)); // 12 bytes
      return geo;
    });
    expect(reg.geometryBytes()).toBe(48 + 12);
  });

  it("dispose() sweeps every resource kind and blocks further use", () => {
    const reg = new ResourceRegistry();
    const geo = new BufferGeometry();
    const mat = new MeshBasicMaterial();
    const tex = new Texture();
    const geoDispose = vi.spyOn(geo, "dispose");
    const matDispose = vi.spyOn(mat, "dispose");
    const texDispose = vi.spyOn(tex, "dispose");
    reg.acquireGeometry("g", () => geo);
    reg.acquireMaterial("m", () => mat);
    reg.acquireTexture("t", () => tex);

    reg.dispose();
    expect(geoDispose).toHaveBeenCalledTimes(1);
    expect(matDispose).toHaveBeenCalledTimes(1);
    expect(texDispose).toHaveBeenCalledTimes(1);
    expect(reg.geometryCount()).toBe(0);
    expect(reg.materialCount()).toBe(0);
    expect(reg.textureCount()).toBe(0);
    expect(reg.isDisposed()).toBe(true);

    // Every acquire must throw after dispose, not silently re-insert a resource
    // that would then leak (dispose() will never run again to sweep it).
    expect(() => reg.acquireGeometry("g2", () => new BufferGeometry())).toThrow(/after dispose/);
    expect(() => reg.acquireMaterial("m2", () => new MeshBasicMaterial())).toThrow(/after dispose/);
    expect(() => reg.acquireTexture("t2", () => new Texture())).toThrow(/after dispose/);
    expect(reg.geometryCount()).toBe(0);
    expect(reg.materialCount()).toBe(0);
    expect(reg.textureCount()).toBe(0);
  });
});
