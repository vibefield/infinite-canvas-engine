/**
 * T2 outgoing GL presentation. This adapter retains the FBOs the compositor
 * has already painted; it never mounts an island or allocates another target.
 */
import type {
  Entity,
  PresentationRetainer,
  PresentationTransitionAdapter,
  PresentationTransitionFrame,
  WidgetMountStore,
} from "@ice/core";
import { Group, Mesh, type BufferGeometry, type Scene, type Texture } from "three";
import { CompositeMaterial } from "./composite-material";
import type { PoolPin } from "./pool";

export interface RetainedQuadPool {
  get(key: number): { readonly texture: Texture } | null;
  pin(keys: readonly number[]): PoolPin;
}

export interface RetainedQuadTransitionOptions {
  readonly scene: Scene;
  readonly geometry: BufferGeometry;
  readonly sources: ReadonlyMap<number, Mesh>;
  readonly pool: RetainedQuadPool;
  readonly store: WidgetMountStore;
  readonly requestFrame: () => void;
  readonly setIncomingOpacity: (opacity: number) => void;
  /** Diagnostic only: live outgoing quads (and therefore pinned FBO rows). */
  readonly onRetainedCountChange?: (count: number) => void;
}

export function createRetainedQuadTransitionAdapter(
  opts: RetainedQuadTransitionOptions,
): PresentationTransitionAdapter {
  return {
    id: "@ice/r3f/retained-quads",
    plane: "gl",
    prepare(descriptor) {
      const candidates: Array<{
        key: number;
        source: Mesh;
        texture: Texture;
        opacity: number;
      }> = [];
      for (const [key, source] of opts.sources) {
        if (!source.visible || opts.pool.get(key) === null) continue;
        const sourceMaterial = source.material as CompositeMaterial;
        const texture = sourceMaterial.map();
        if (texture === null) continue;
        candidates.push({
          key,
          source,
          texture,
          opacity: sourceMaterial.currentOpacity(),
        });
      }
      // Overflow omission follows deterministic current paint order.
      candidates.sort(
        (a, b) => a.source.renderOrder - b.source.renderOrder || a.key - b.key,
      );
      const retain = opts.store.retainForTransition;
      if (retain === undefined) {
        throw new Error("ice: GL transition retention needs a retainable mount store.");
      }
      const hold = retain(candidates.map((candidate) => candidate.key as Entity));
      const retained = new Set<number>(hold.entities);
      const group = new Group();
      group.name = "ice-departing-gl";
      const rows: Array<{
        source: Mesh;
        material: CompositeMaterial;
        opacity: number;
      }> = [];
      const keys: number[] = [];
      let pin: PoolPin | undefined;
      const orderOffset = descriptor.kind === "enter" ? -1_000_000 : 1_000_000;
      try {
        for (const candidate of candidates) {
          // Mount retention synchronously notifies subscribers. A newer nav
          // may have captured and hidden this source before the call returns;
          // a stale preparation must not clone or claim it afterward.
          if (!retained.has(candidate.key) || !candidate.source.visible) continue;
          const material = new CompositeMaterial();
          material.setMap(candidate.texture);
          material.setOpacity(candidate.opacity);
          const mesh = new Mesh(opts.geometry, material);
          mesh.frustumCulled = false;
          mesh.position.copy(candidate.source.position);
          mesh.scale.copy(candidate.source.scale);
          mesh.quaternion.copy(candidate.source.quaternion);
          mesh.renderOrder = candidate.source.renderOrder + orderOffset;
          group.add(mesh);
          rows.push({
            source: candidate.source,
            material,
            opacity: candidate.opacity,
          });
          keys.push(candidate.key);
          // The retained clone becomes the sole outgoing presentation before
          // the authority cut, avoiding one frame of alpha-doubling.
          candidate.source.visible = false;
        }
        if (rows.length === 0) {
          hold.release();
          opts.onRetainedCountChange?.(0);
          return null;
        }
        pin = opts.pool.pin(keys);
        opts.onRetainedCountChange?.(rows.length);
      } catch (error) {
        for (const row of rows) {
          row.source.visible = true;
          row.material.dispose();
        }
        group.clear();
        pin?.release();
        hold.release();
        opts.onRetainedCountChange?.(0);
        throw error;
      }

      let attached = false;
      let released = false;
      const retainer: PresentationRetainer = {
        update(frame: PresentationTransitionFrame) {
          if (!attached) {
            attached = true;
            opts.scene.add(group);
          }
          // Three composite space is y-up; A is expressed in canvas y-down.
          group.position.set(descriptor.affine.ox, -descriptor.affine.oy, 0);
          group.scale.set(descriptor.affine.s, descriptor.affine.s, 1);
          for (const row of rows) {
            row.material.setOpacity(row.opacity * frame.outgoingOpacity);
          }
          opts.setIncomingOpacity(frame.incomingOpacity);
          opts.requestFrame();
        },
        release(reason) {
          if (released) return;
          released = true;
          opts.setIncomingOpacity(1);
          if (attached) opts.scene.remove(group);
          for (const row of rows) {
            // `cancelled` is the pre-authority-cut inverse. After publication,
            // the compositor's current membership owns live visibility.
            if (reason === "cancelled") row.source.visible = true;
            row.material.dispose();
          }
          group.clear();
          pin?.release();
          hold.release();
          opts.onRetainedCountChange?.(0);
          opts.requestFrame();
        },
      };
      return retainer;
    },
  };
}
