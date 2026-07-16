/**
 * The three-side half of a triangle-soup pass: a Mesh over a dynamic
 * BufferGeometry (position xyz + color rgba) with an unlit TSL material whose
 * fragment IS the vertex color. Capacity grows geometrically; shrink keeps the
 * buffer and narrows the draw range (guide/wire counts oscillate per frame —
 * reallocating every collect would churn).
 */
import { attribute } from "three/tsl";
import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshBasicNodeMaterial } from "three/webgpu";
import type { TriSoup } from "./soup-collect";

export interface SoupMesh {
  readonly mesh: Mesh;
  update(soup: TriSoup): void;
  dispose(): void;
}

export function createSoupMesh(renderOrder: number): SoupMesh {
  const material = new MeshBasicNodeMaterial();
  material.fragmentNode = attribute("color", "vec4");
  material.transparent = true;
  material.depthTest = false;
  material.depthWrite = false;
  // Screen-px collectors emit y-down geometry, which lands CLOCKWISE in NDC
  // through the top=0/bottom=h ortho camera — front-face culling would drop
  // every triangle (the invisible-guides field find, 2026-07-16).
  material.side = DoubleSide;

  let geometry = new BufferGeometry();
  let capacity = 0;
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = renderOrder;
  mesh.visible = false; // until the first non-empty soup

  return {
    mesh,
    update(soup) {
      if (soup.vertexCount === 0) {
        mesh.visible = false;
        geometry.setDrawRange(0, 0);
        return;
      }
      if (soup.vertexCount > capacity) {
        capacity = Math.max(soup.vertexCount, capacity * 2, 256);
        const old = geometry;
        geometry = new BufferGeometry();
        const pos = new Float32Array(capacity * 3);
        const col = new Float32Array(capacity * 4);
        pos.set(soup.positions);
        col.set(soup.colors);
        geometry.setAttribute("position", new BufferAttribute(pos, 3));
        geometry.setAttribute("color", new BufferAttribute(col, 4));
        mesh.geometry = geometry;
        old.dispose();
      } else {
        const pos = geometry.getAttribute("position") as BufferAttribute;
        const col = geometry.getAttribute("color") as BufferAttribute;
        (pos.array as Float32Array).set(soup.positions);
        (col.array as Float32Array).set(soup.colors);
        pos.needsUpdate = true;
        col.needsUpdate = true;
      }
      geometry.setDrawRange(0, soup.vertexCount);
      mesh.visible = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
