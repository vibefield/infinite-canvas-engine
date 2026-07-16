/**
 * Selection pass — SDF rounded-rect rings over the pure `collectSelection`
 * quads (renders above wires, below snap guides: chrome over content, guides
 * stay top). One material for every ring: the fragment evaluates the classic
 * rounded-box SDF at the per-vertex `local`/`halfSize`/`radius` facts and
 * keeps an AA band of `width` px starting `pad` px OUTSIDE the rect boundary —
 * a thin border hugging the card that never scales with the lift (the
 * collector reads ECS rects only).
 */
import { DEFAULT_SELECTION_CHROME_CONFIG, type SelectionChromeConfig, MeasuredSize, Position, Size, type World } from "@ice/core";
import { attribute, smoothstep, uniform, vec4 } from "three/tsl";
import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshBasicNodeMaterial, Vector3, type Node } from "three/webgpu";
import type { GroundFrame, GroundPass } from "../pass";
import { collectSelection, selectionMeasuredQ, selectionQ, type RingSoup } from "./selection-collect";
import { parseCssColor } from "./soup-collect";

export function createSelectionPass(initial: Partial<SelectionChromeConfig> = {}): GroundPass {
  const config: SelectionChromeConfig = { ...DEFAULT_SELECTION_CHROME_CONFIG, ...initial };
  const [cr, cg, cb, ca] = parseCssColor(config.color);
  const uColor = uniform(new Vector3(cr, cg, cb));
  const uAlpha = uniform(ca);
  const uWidth = uniform(config.width);
  const uPad = uniform(config.pad);

  // Signed distance to the rounded-rect boundary (negative inside), then keep
  // an AA stroke centered `pad + width/2` OUTSIDE it (0.75px smoothstep edges,
  // the grid pass's AA idiom).
  // attribute() types as a bare AttributeNode; the Node<T> view carries the
  // operator extensions (the grid pass's `Node<"float">` idiom).
  const local = attribute("local", "vec2") as unknown as Node<"vec2">;
  const halfSize = attribute("halfSize", "vec2") as unknown as Node<"vec2">;
  const cornerR = attribute("radius", "float") as unknown as Node<"float">;
  const q = local.abs().sub(halfSize).add(cornerR);
  const d = q.max(0).length().add(q.x.max(q.y).min(0)).sub(cornerR);
  const centerline = d.sub(uPad).sub(uWidth.mul(0.5)).abs();
  const stroke = smoothstep(uWidth.mul(0.5).sub(0.75), uWidth.mul(0.5).add(0.75), centerline).oneMinus();

  const material = new MeshBasicNodeMaterial();
  material.fragmentNode = vec4(uColor, stroke.mul(uAlpha));
  material.transparent = true;
  material.depthTest = false;
  material.depthWrite = false;
  material.side = DoubleSide; // y-down screen quads are CW in NDC (soup-mesh field find)

  let geometry = new BufferGeometry();
  let capacity = 0;
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1.5; // grid 0 · wires 1 · selection · guides 2
  mesh.visible = false;

  const update = (soup: RingSoup): void => {
    if (soup.vertexCount === 0) {
      mesh.visible = false;
      geometry.setDrawRange(0, 0);
      return;
    }
    if (soup.vertexCount > capacity) {
      capacity = Math.max(soup.vertexCount, capacity * 2, 96);
      const old = geometry;
      geometry = new BufferGeometry();
      geometry.setAttribute("position", new BufferAttribute(new Float32Array(capacity * 3), 3));
      geometry.setAttribute("local", new BufferAttribute(new Float32Array(capacity * 2), 2));
      geometry.setAttribute("halfSize", new BufferAttribute(new Float32Array(capacity * 2), 2));
      geometry.setAttribute("radius", new BufferAttribute(new Float32Array(capacity), 1));
      mesh.geometry = geometry;
      old.dispose();
    }
    for (const [name, data] of [
      ["position", soup.positions],
      ["local", soup.local],
      ["halfSize", soup.halfSize],
      ["radius", soup.radius],
    ] as const) {
      const attr = geometry.getAttribute(name) as BufferAttribute;
      (attr.array as Float32Array).set(data);
      attr.needsUpdate = true;
    }
    geometry.setDrawRange(0, soup.vertexCount);
    mesh.visible = true;
  };

  return {
    name: "selection",
    object: mesh,
    arm(world: World, wake: () => void) {
      return [
        // Membership (select/deselect) + the selected rects moving/resizing.
        world.reactive.observeQuery(selectionQ, wake, { cols: [Position, Size] }),
        // MeasuredSize rides its own observer (readRect-rule; in selectionQ's
        // cols it would REQUIRE the rider and drop fixed-size widgets).
        world.reactive.observeQuery(selectionMeasuredQ, wake, { cols: [MeasuredSize] }),
      ];
    },
    collect(world: World, frame: GroundFrame) {
      update(collectSelection(world, frame, config));
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
