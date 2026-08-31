import type {
  Entity,
  FrameSwitchDescriptor,
  MountEntry,
  PresentationTransitionFrame,
  WidgetMountStore,
} from "@ice/core";
import { Mesh, PlaneGeometry, Scene, Texture } from "three";
import { describe, expect, it } from "vitest";
import { CompositeMaterial } from "../src/composite-material";
import { createRetainedQuadTransitionAdapter } from "../src/retained-quads";

const descriptor = Object.freeze({
  kind: "enter" as const,
  documentEpoch: 1,
  fromFrame: 10 as Entity,
  toFrame: 20 as Entity,
  fromTypeId: "board",
  toTypeId: "whiteboard",
  fromCamera: { x: 0, y: 0, zoom: 1 },
  toCamera: { x: 10, y: 20, zoom: 2 },
  affine: { s: 0.5, ox: 25, oy: 30 },
  requestedMotion: true,
  requiresFullT2: true,
  requiredPlanes: ["gl"] as const,
}) satisfies FrameSwitchDescriptor;

const frame = Object.freeze({
  epoch: 1,
  descriptor,
  motion: "flight" as const,
  camera: descriptor.toCamera,
  outgoingCamera: descriptor.fromCamera,
  progress: 0.5,
  outgoingOpacity: 0.4,
  incomingOpacity: 0.3,
  frozen: false,
}) satisfies PresentationTransitionFrame;

function source(geometry: PlaneGeometry, order: number, opacity: number): Mesh {
  const material = new CompositeMaterial();
  material.setMap(new Texture());
  material.setOpacity(opacity);
  const mesh = new Mesh(geometry, material);
  mesh.position.set(order + 1, -(order + 2), 0);
  mesh.scale.set(100, 80, 1);
  mesh.renderOrder = order;
  return mesh;
}

function setup(
  retainedEntities: readonly Entity[] = [1 as Entity, 2 as Entity],
  opts: { hideDuringRetain?: boolean } = {},
) {
  const scene = new Scene();
  const geometry = new PlaneGeometry(1, 1);
  const first = source(geometry, 20, 0.5);
  const second = source(geometry, 10, 0.75);
  scene.add(first, second);
  const sources = new Map<number, Mesh>([
    [1, first],
    [2, second],
  ]);
  let holdReleases = 0;
  let pinReleases = 0;
  let activeHolds = 0;
  let activePins = 0;
  let requested = 0;
  let incoming = 1;
  let retainedCount = 0;
  let pinned: readonly number[] = [];
  const snapshot: readonly MountEntry[] = [
    { entity: 1 as Entity, hidden: false },
    { entity: 2 as Entity, hidden: false },
  ];
  const store: WidgetMountStore = {
    subscribe: () => () => {},
    getSnapshot: () => snapshot,
    retainForTransition: () => {
      activeHolds += 1;
      if (opts.hideDuringRetain === true) {
        first.visible = false;
        second.visible = false;
      }
      return {
        entities: retainedEntities,
        release: () => {
          holdReleases += 1;
          activeHolds -= 1;
        },
      };
    },
  };
  const adapter = createRetainedQuadTransitionAdapter({
    scene,
    geometry,
    sources,
    store,
    pool: {
      get: () => ({ texture: new Texture() }),
      pin(keys) {
        pinned = [...keys];
        activePins += 1;
        return {
          keys: [...keys],
          release: () => {
            pinReleases += 1;
            activePins -= 1;
          },
        };
      },
    },
    requestFrame: () => {
      requested += 1;
    },
    setIncomingOpacity: (opacity) => {
      incoming = opacity;
    },
    onRetainedCountChange: (count) => {
      retainedCount = count;
    },
  });
  return {
    adapter,
    scene,
    geometry,
    first,
    second,
    pinned: () => pinned,
    holdReleases: () => holdReleases,
    pinReleases: () => pinReleases,
    activeHolds: () => activeHolds,
    activePins: () => activePins,
    requested: () => requested,
    incoming: () => incoming,
    retainedCount: () => retainedCount,
  };
}

describe("retained GL quads", () => {
  it("pins only the capped painted set and applies the y-flipped portal affine", () => {
    const rig = setup([2 as Entity]);
    const retainer = rig.adapter.prepare(descriptor);
    if (retainer === null) throw new Error("expected a retained quad");
    expect(rig.first.visible).toBe(true);
    expect(rig.second.visible).toBe(false);
    expect(rig.pinned()).toEqual([2]);

    retainer.update(frame);
    const group = rig.scene.getObjectByName("ice-departing-gl");
    expect(group).toBeDefined();
    expect(group?.position.toArray()).toEqual([25, -30, 0]);
    expect(group?.scale.toArray()).toEqual([0.5, 0.5, 1]);
    const retained = group?.children[0] as Mesh;
    expect(retained.renderOrder).toBe(10 - 1_000_000);
    expect((retained.material as CompositeMaterial).currentOpacity()).toBeCloseTo(0.3);
    expect(rig.incoming()).toBe(0.3);

    retainer.release("settled");
    expect(rig.scene.getObjectByName("ice-departing-gl")).toBeUndefined();
    expect(rig.second.visible).toBe(false); // current compositor truth owns it now
    expect(rig.holdReleases()).toBe(1);
    expect(rig.pinReleases()).toBe(1);
    expect(rig.incoming()).toBe(1);
    expect(rig.requested()).toBe(2);
    retainer.release("settled");
    expect(rig.holdReleases()).toBe(1);
    rig.geometry.dispose();
  });

  it("restores source visibility when navigation cancels before the authority cut", () => {
    const rig = setup([1 as Entity, 2 as Entity]);
    const retainer = rig.adapter.prepare(descriptor);
    if (retainer === null) throw new Error("expected retained quads");
    expect(rig.first.visible).toBe(false);
    expect(rig.second.visible).toBe(false);
    retainer.release("cancelled");
    expect(rig.first.visible).toBe(true);
    expect(rig.second.visible).toBe(true);
    expect(rig.holdReleases()).toBe(1);
    expect(rig.pinReleases()).toBe(1);
    rig.geometry.dispose();
  });

  it("declines sources captured by a newer navigation during synchronous hold notification", () => {
    const rig = setup([1 as Entity, 2 as Entity], { hideDuringRetain: true });

    expect(rig.adapter.prepare(descriptor)).toBeNull();
    expect(rig.pinned()).toEqual([]);
    expect(rig.holdReleases()).toBe(1);
    expect(rig.first.visible).toBe(false);
    expect(rig.second.visible).toBe(false);
    rig.geometry.dispose();
  });

  it("leaves no mount holds, FBO pins, or departing groups after 200 rapid releases", () => {
    const rig = setup([1 as Entity, 2 as Entity]);

    for (let i = 0; i < 200; i += 1) {
      // This is the compositor's current-membership repaint between navs.
      rig.first.visible = true;
      rig.second.visible = true;
      const retainer = rig.adapter.prepare(descriptor);
      if (retainer === null) throw new Error(`missing GL retainer at cycle ${i}`);
      retainer.update({ ...frame, epoch: i + 1 });

      expect(rig.activeHolds()).toBe(1);
      expect(rig.activePins()).toBe(1);
      expect(rig.retainedCount()).toBe(2);
      expect(rig.scene.children.filter((child) => child.name === "ice-departing-gl")).toHaveLength(1);
      retainer.release(i % 3 === 0 ? "cancelled" : i % 3 === 1 ? "interrupted" : "settled");
      retainer.release("settled");

      expect(rig.activeHolds()).toBe(0);
      expect(rig.activePins()).toBe(0);
      expect(rig.retainedCount()).toBe(0);
      expect(rig.scene.getObjectByName("ice-departing-gl")).toBeUndefined();
      expect(rig.incoming()).toBe(1);
    }

    expect(rig.holdReleases()).toBe(200);
    expect(rig.pinReleases()).toBe(200);
    rig.geometry.dispose();
  });
});
