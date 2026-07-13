import type { BufferGeometry, Material, Texture } from "three";

/**
 * Ref-counted cache of shared GPU resources keyed by a caller-supplied
 * `cacheKey` (design-004 §3). Geometries, materials, and textures are pooled so
 * many islands of the same archetype share one instance instead of each
 * allocating its own copy.
 *
 * Ported ~verbatim from v1 `ResourceRegistry`
 * (../infinite-canvas .../r3f/compositor/ResourceRegistry.ts). Three's
 * geometries / materials / textures all expose `.dispose()` and are safe to
 * share across scenes; the registry disposes the underlying resource only after
 * every holder has called the matching `release*`.
 */

/** Anything the registry can own — Three resources all satisfy this. */
type Disposable = { dispose: () => void };

interface Entry<T extends Disposable> {
  resource: T;
  refCount: number;
}

export class ResourceRegistry {
  private geometries = new Map<string, Entry<BufferGeometry>>();
  private materials = new Map<string, Entry<Material>>();
  private textures = new Map<string, Entry<Texture>>();
  private disposed = false;

  acquireGeometry<T extends BufferGeometry>(key: string, factory: () => T): T {
    if (this.disposed) {
      throw new Error("ResourceRegistry: cannot acquire after dispose");
    }
    const existing = this.geometries.get(key);
    if (existing) {
      existing.refCount++;
      return existing.resource as T;
    }
    const resource = factory();
    this.geometries.set(key, { resource, refCount: 1 });
    return resource;
  }
  releaseGeometry(key: string): void {
    this.releaseFrom(this.geometries, key);
  }

  acquireMaterial<T extends Material>(key: string, factory: () => T): T {
    if (this.disposed) {
      throw new Error("ResourceRegistry: cannot acquire after dispose");
    }
    const existing = this.materials.get(key);
    if (existing) {
      existing.refCount++;
      return existing.resource as T;
    }
    const resource = factory();
    this.materials.set(key, { resource, refCount: 1 });
    return resource;
  }
  releaseMaterial(key: string): void {
    this.releaseFrom(this.materials, key);
  }

  acquireTexture<T extends Texture>(key: string, factory: () => T): T {
    if (this.disposed) {
      throw new Error("ResourceRegistry: cannot acquire after dispose");
    }
    const existing = this.textures.get(key);
    if (existing) {
      existing.refCount++;
      return existing.resource as T;
    }
    const resource = factory();
    this.textures.set(key, { resource, refCount: 1 });
    return resource;
  }
  releaseTexture(key: string): void {
    this.releaseFrom(this.textures, key);
  }

  /** Number of distinct shared geometries currently held. */
  geometryCount(): number {
    return this.geometries.size;
  }

  /** Number of distinct shared materials currently held. */
  materialCount(): number {
    return this.materials.size;
  }

  /** Number of distinct shared textures currently held. */
  textureCount(): number {
    return this.textures.size;
  }

  /**
   * Estimated GPU bytes for shared geometry attribute buffers. Best-effort —
   * actual footprint depends on driver alignment, but a useful relative metric
   * for the profiler.
   */
  geometryBytes(): number {
    let total = 0;
    for (const { resource } of this.geometries.values()) {
      for (const attr of Object.values(resource.attributes)) {
        if ("array" in attr && (attr.array as ArrayBufferView).byteLength) {
          total += (attr.array as ArrayBufferView).byteLength;
        }
      }
      if (resource.index) {
        total += (resource.index.array as ArrayBufferView).byteLength;
      }
    }
    return total;
  }

  /** Dispose every resource and clear the registry. */
  dispose(): void {
    if (this.disposed) return;
    for (const { resource } of this.geometries.values()) resource.dispose();
    for (const { resource } of this.materials.values()) resource.dispose();
    for (const { resource } of this.textures.values()) resource.dispose();
    this.geometries.clear();
    this.materials.clear();
    this.textures.clear();
    this.disposed = true;
  }

  /** True after `dispose()` — callers should re-create the registry instead of using it. */
  isDisposed(): boolean {
    return this.disposed;
  }

  private releaseFrom<T extends Disposable>(map: Map<string, Entry<T>>, key: string): void {
    const entry = map.get(key);
    if (!entry) return;
    entry.refCount--;
    if (entry.refCount <= 0) {
      // Defer disposal by one microtask. Under React StrictMode the effect
      // cleanup fires immediately, followed by a remount + new acquire — without
      // the defer, the resource is disposed before the remount can re-acquire
      // it. The microtask gives the re-acquire a chance to bump refCount back
      // above 0; if it does not, we dispose for real.
      queueMicrotask(() => {
        const current = map.get(key);
        if (current && current.refCount <= 0) {
          current.resource.dispose();
          map.delete(key);
        }
      });
    }
  }
}
