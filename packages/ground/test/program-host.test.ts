import {
  Camera,
  ChildOf,
  NavTransition,
  PrefabId,
  Viewport,
  createEngine,
  createGpuAllocationLedger,
  createPresentationTransitionCoordinator,
  createWorld,
  defineCanvasType,
  defineComponent,
  defineResource,
  publishNavCut,
  startNavFlight,
  type CanvasType,
  type FrameSwitchDescriptor,
} from "@ice/core";
import { Object3D, type Camera as ThreeCamera, type Scene } from "three/webgpu";
import { describe, expect, it } from "vitest";
import { groundHost } from "../src/program-host";
import {
  frameChildrenSource,
  type GroundProgramDefinition,
  type GroundProgramInput,
  type GroundProgramInstance,
} from "../src/program";
import type { GroundRendererLike } from "../src/renderer";

const ProgramDirt = defineResource("groundHostTestDirt", { value: "f64" });
const ChildTone = defineComponent("groundHostTestChildTone", { value: "f64" });
const ChildSource = frameChildrenSource([ChildTone], 1);

const CanvasA = defineCanvasType({
  id: "ground-host:test-a",
  semanticVersion: 1,
  semantic: { placement: {} },
  presentation: { ground: { program: "ground-host:a" } },
});
const CanvasB = defineCanvasType({
  id: "ground-host:test-b",
  semanticVersion: 1,
  semantic: { placement: {} },
  presentation: { ground: { program: "ground-host:b", wires: false } },
});
const CanvasAQuiet = defineCanvasType({
  id: "ground-host:test-a-quiet",
  semanticVersion: 1,
  semantic: { placement: {} },
  presentation: { ground: { program: "ground-host:a", wires: false } },
});
const CanvasMissing = defineCanvasType({
  id: "ground-host:test-missing",
  semanticVersion: 1,
  semantic: { placement: {} },
  presentation: { ground: { program: "ground-host:missing" } },
});
const CanvasChildren = defineCanvasType({
  id: "ground-host:test-children",
  semanticVersion: 1,
  semantic: { placement: {} },
  presentation: { ground: { program: "ground-host:children" } },
});
const CanvasSnapshot = defineCanvasType({
  id: "ground-host:test-snapshot",
  semanticVersion: 1,
  semantic: { placement: {} },
  presentation: { ground: { program: "ground-host:snapshot" } },
});
const CanvasOrdered = defineCanvasType({
  id: "ground-host:test-ordered",
  semanticVersion: 1,
  semantic: { placement: {} },
  presentation: { ground: { program: "ground-host:ordered" } },
});

type Counters = {
  creates: number;
  activates: number;
  deactivates: number;
  collects: number;
  disposes: number;
  throwCollect?: boolean;
  freezes?: number;
  frozenCollects?: number;
  frozenReleases?: number;
  throwDeactivate?: boolean;
};

function definition(
  id: string,
  counters: Counters,
  sourced = false,
): GroundProgramDefinition {
  return {
    id,
    transition: sourced ? "freezable" : "procedural",
    sources: sourced ? [{ kind: "resource", resource: ProgramDirt }] : [],
    create(): GroundProgramInstance {
      counters.creates += 1;
      return {
        object: new Object3D(),
        activate() {
          counters.activates += 1;
          return [];
        },
        collect(input) {
          counters.collects += 1;
          if (sourced) input.resource(ProgramDirt);
          if (counters.throwCollect) throw new Error(`${id} collect fault`);
        },
        ...(sourced
          ? {
              freeze: () => {
                counters.freezes = (counters.freezes ?? 0) + 1;
                return {
                  object: new Object3D(),
                  collect: () => {
                    counters.frozenCollects = (counters.frozenCollects ?? 0) + 1;
                  },
                  release: () => {
                    counters.frozenReleases = (counters.frozenReleases ?? 0) + 1;
                  },
                };
              },
            }
          : {}),
        deactivate() {
          counters.deactivates += 1;
          if (counters.throwDeactivate) throw new Error(`${id} deactivate fault`);
        },
        estimateBytes: () => 1024,
        dispose() {
          counters.disposes += 1;
        },
      };
    },
  };
}

function fakeRenderer(doc: Document): GroundRendererLike & {
  renders: number;
  captures: number;
  snapshotUpdates: number;
  snapshotDisposes: number;
  throwNext: boolean;
  disposed: boolean;
  loseDevice(api?: "WebGPU" | "WebGL"): void;
} {
  let lostApi: "WebGPU" | "WebGL" | undefined;
  const result: GroundRendererLike & {
    renders: number;
    captures: number;
    snapshotUpdates: number;
    snapshotDisposes: number;
    throwNext: boolean;
    disposed: boolean;
    loseDevice(api?: "WebGPU" | "WebGL"): void;
  } = {
    canvas: doc.createElement("canvas"),
    renders: 0,
    captures: 0,
    snapshotUpdates: 0,
    snapshotDisposes: 0,
    throwNext: false,
    disposed: false,
    ready: () => lostApi === undefined,
    failed: () => lostApi !== undefined,
    status: () => lostApi === undefined
      ? { backend: "webgpu", ready: true, failed: false }
      : {
          backend: lostApi === "WebGPU" ? "webgpu" : "webgl2",
          ready: false,
          failed: true,
          failure: {
            kind: "device-lost",
            backend: lostApi === "WebGPU" ? "webgpu" : "webgl2",
            message: "simulated device/context loss",
            api: lostApi,
          },
        },
    onReady: (cb: () => void) => cb(),
    setSize: () => {},
    render(_scene: Scene, _camera: ThreeCamera) {
      if (result.throwNext) {
        result.throwNext = false;
        throw new Error("shader validation fault");
      }
      result.renders += 1;
    },
    capture(_object, _camera, opts) {
      result.captures += 1;
      return {
        object: new Object3D(),
        bytes: opts.pixelWidth * opts.pixelHeight * 4,
        update: () => {
          result.snapshotUpdates += 1;
        },
        dispose: () => {
          result.snapshotDisposes += 1;
        },
      };
    },
    dispose() {
      result.disposed = true;
    },
    loseDevice(api = "WebGPU") {
      lostApi = api;
    },
  };
  return result;
}

function setup(programB: Counters = {
  creates: 0,
  activates: 0,
  deactivates: 0,
  collects: 0,
  disposes: 0,
}, extraPrograms: readonly GroundProgramDefinition[] = [], budgetBytes = 256 * 1024 * 1024) {
  const countersA: Counters = {
    creates: 0,
    activates: 0,
    deactivates: 0,
    collects: 0,
    disposes: 0,
  };
  const world = createWorld();
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  world.setResource(Viewport, { w: 800, h: 600, dpr: 1 });
  world.setResource(ProgramDirt, { value: 0 });
  const canvasFrame = world.spawn();
  let currentFrame = canvasFrame;
  let canvasEpoch = 1;
  const engine = createEngine(world);
  const transitions = createPresentationTransitionCoordinator(world, engine);
  const gpu = createGpuAllocationLedger(budgetBytes);
  const container = document.createElement("div");
  container.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      toJSON: () => ({}),
    }) as DOMRect;
  const contentPlane = document.createElement("div");
  container.appendChild(contentPlane);
  document.body.appendChild(container);
  const renderer = fakeRenderer(document);
  let current: CanvasType = CanvasA;
  const listeners = new Set<() => void>();
  const layer = groundHost({
    programs: [
      definition("ground-host:a", countersA),
      definition("ground-host:b", programB, true),
      ...extraPrograms,
    ],
    fallback: "ground-host:a",
    rendererOverride: renderer,
    onProgramFault: () => {},
  })({
    host: { container, contentPlane },
    world,
    readWirePreview: () => ({ active: false, compatible: false, sx: 0, sy: 0, tx: 0, ty: 0 }),
    readSpatial: () => [],
    transitions,
    gpu,
    canvas: {
      type: () => current,
      current: () => ({
        state: "attached" as const,
        documentEpoch: 1,
        epoch: canvasEpoch,
        frame: currentFrame,
        typeId: current.id,
        depth: 0,
      }),
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  });
  engine.registerReflector(layer.reflector);
  let now = 0;
  const step = () => {
    now += 16;
    engine.step(now);
  };
  const switchTo = (canvas: CanvasType, frame = currentFrame) => {
    current = canvas;
    currentFrame = frame;
    canvasEpoch += 1;
    for (const listener of [...listeners]) listener();
  };
  return {
    world,
    engine,
    layer,
    renderer,
    countersA,
    countersB: programB,
    canvasFrame,
    transitions,
    gpu,
    current: () => current,
    canvasObservers: () => listeners.size,
    step,
    switchTo,
  };
}

function groundDescriptor(
  rig: ReturnType<typeof setup>,
  to: CanvasType,
): FrameSwitchDescriptor {
  const fromCamera = rig.world.getResource(Camera) ?? { x: 0, y: 0, zoom: 1 };
  return Object.freeze({
    kind: "enter" as const,
    documentEpoch: 1,
    fromFrame: rig.canvasFrame,
    toFrame: rig.canvasFrame,
    fromTypeId: rig.current().id,
    toTypeId: to.id,
    fromCamera: { x: fromCamera.x, y: fromCamera.y, zoom: fromCamera.zoom },
    toCamera: { x: 40, y: 60, zoom: 1.25 },
    affine: { s: 0.5, ox: 20, oy: 30 },
    requestedMotion: true,
    requiresFullT2: true,
    requiredPlanes: ["ground"] as const,
  }) satisfies FrameSwitchDescriptor;
}

function beginGroundFlight(rig: ReturnType<typeof setup>, to: CanvasType) {
  const descriptor = groundDescriptor(rig, to);
  const prepared = rig.transitions.prepare(descriptor);
  if (prepared.allowFlight) {
    startNavFlight(
      rig.world,
      descriptor.kind,
      descriptor.affine,
      descriptor.fromCamera,
      descriptor.toCamera,
      descriptor,
    );
  } else {
    rig.world.setResource(Camera, { ...descriptor.toCamera, gesturing: false });
    publishNavCut(
      rig.world,
      descriptor.kind,
      descriptor.fromCamera,
      descriptor.toCamera,
      descriptor,
      descriptor.affine,
    );
  }
  rig.switchTo(to);
  prepared.commit();
  return { descriptor, prepared };
}

function settleGroundFlight(rig: ReturnType<typeof setup>): void {
  const transition = rig.world.getResource(NavTransition);
  if (transition === undefined) throw new Error("expected a ground transition");
  rig.world.setResource(NavTransition, { ...transition, active: false, p: 1, v: 0 });
  rig.step();
}

describe("GroundHost", () => {
  it("lazily instantiates one active program and removes inactive source observers", () => {
    const rig = setup();
    expect(rig.layer.programs.active()).toBe("ground-host:a");
    expect(rig.countersA.creates).toBe(1);
    expect(rig.countersB.creates).toBe(0);
    expect(rig.layer.programs.stats()).toMatchObject({
      instantiatedPrograms: 1,
      inactivePrograms: 0,
      sourceObservers: 0,
    });

    rig.step();
    rig.switchTo(CanvasB);
    expect(rig.layer.programs.active()).toBe("ground-host:b");
    expect(rig.countersB.creates).toBe(1);
    expect(rig.layer.programs.stats()).toMatchObject({
      instantiatedPrograms: 2,
      inactivePrograms: 1,
      sourceObservers: 1,
    });
    rig.step();
    const bCollects = rig.countersB.collects;

    rig.switchTo(CanvasA);
    rig.step();
    const rendersAfterSwitch = rig.renderer.renders;
    rig.world.setResource(ProgramDirt, { value: 2 });
    rig.step();
    expect(rig.countersB.collects).toBe(bCollects);
    expect(rig.renderer.renders).toBe(rendersAfterSwitch);
    expect(rig.layer.programs.stats().sourceObservers).toBe(0);

    rig.layer.dispose();
    expect(rig.countersA.disposes).toBe(1);
    expect(rig.countersB.disposes).toBe(1);
    expect(rig.renderer.disposed).toBe(true);
  });

  it("re-renders shared-pass visibility changes when the program id stays the same", () => {
    const rig = setup();
    rig.step();
    const before = rig.renderer.renders;
    rig.switchTo(CanvasAQuiet);
    rig.step();
    expect(rig.layer.programs.active()).toBe("ground-host:a");
    expect(rig.countersA.creates).toBe(1);
    expect(rig.renderer.renders).toBe(before + 1);
    rig.layer.dispose();
  });

  it("bounds declared direct-child reads, re-arms them per frame, and closes old inputs", () => {
    let latestInput: GroundProgramInput | undefined;
    const snapshots: ReturnType<GroundProgramInput["children"]>[] = [];
    const childrenProgram: GroundProgramDefinition = {
      id: "ground-host:children",
      transition: "snapshot",
      sources: [ChildSource],
      create() {
        return {
          object: new Object3D(),
          activate: () => [],
          collect(input) {
            latestInput = input;
            snapshots.push(input.children(ChildSource));
          },
          deactivate: () => {},
          estimateBytes: () => 1024,
          dispose: () => {},
        };
      },
    };
    const rig = setup(undefined, [childrenProgram]);
    const first = rig.world.spawn({
      components: [
        [PrefabId, { id: "ground-host:test-child" }],
        [ChildTone, { value: 1 }],
      ],
    });
    const overflow = rig.world.spawn({
      components: [
        [PrefabId, { id: "ground-host:test-child" }],
        [ChildTone, { value: 2 }],
      ],
    });
    rig.world.setRelation(first, ChildOf, rig.canvasFrame);
    rig.world.setRelation(overflow, ChildOf, rig.canvasFrame);
    rig.switchTo(CanvasChildren);
    rig.step();
    expect(snapshots.at(-1)).toMatchObject({
      frame: rig.canvasFrame,
      total: 2,
      truncated: true,
      rows: [{ entity: first, widgetType: "ground-host:test-child", values: [{ value: 1 }] }],
    });
    expect(rig.layer.programs.stats().sourceObservers).toBe(1);

    const departedInput = latestInput as GroundProgramInput;
    const nextFrame = rig.world.spawn();
    const next = rig.world.spawn({
      components: [
        [PrefabId, { id: "ground-host:test-child" }],
        [ChildTone, { value: 3 }],
      ],
    });
    rig.world.setRelation(next, ChildOf, nextFrame);
    rig.switchTo(CanvasChildren, nextFrame);
    expect(() => departedInput.children(ChildSource)).toThrow(/after deactivation/);
    rig.step();
    expect(snapshots.at(-1)).toMatchObject({
      frame: nextFrame,
      total: 1,
      truncated: false,
      rows: [{ entity: next, values: [{ value: 3 }] }],
    });

    rig.switchTo(CanvasA);
    expect(rig.layer.programs.stats().sourceObservers).toBe(0);
    rig.layer.dispose();
  });

  it("quarantines a bad program and keeps the physical renderer on fallback", () => {
    const broken: Counters = {
      creates: 0,
      activates: 0,
      deactivates: 0,
      collects: 0,
      disposes: 0,
      throwCollect: true,
    };
    const rig = setup(broken);
    rig.step();
    rig.switchTo(CanvasB);
    rig.step();
    expect(rig.layer.programs.status("ground-host:b")).toMatchObject({ state: "failed" });
    expect(rig.layer.programs.active()).toBe("ground-host:a");
    expect(rig.layer.reflector.available()).toBe(true);
    rig.step();
    expect(rig.renderer.renders).toBeGreaterThan(0);
    rig.layer.dispose();
  });

  it("falls back for missing programs and rejects illegal procedural sources", () => {
    const rig = setup();
    rig.switchTo(CanvasMissing);
    expect(rig.layer.programs.active()).toBe("ground-host:a");
    expect(rig.layer.programs.status("ground-host:missing")).toMatchObject({ state: "failed" });
    rig.layer.dispose();

    expect(() =>
      groundHost({
        programs: [
          {
            ...definition("ground-host:illegal", {
              creates: 0,
              activates: 0,
              deactivates: 0,
              collects: 0,
              disposes: 0,
            }),
            sources: [{ kind: "resource", resource: ProgramDirt }],
          },
        ],
        fallback: "ground-host:illegal",
      }),
    ).toThrow(/procedural.*cannot declare content sources/);
  });

  it("attributes a synchronous render fault to the active program", () => {
    const rig = setup();
    rig.step();
    rig.switchTo(CanvasB);
    rig.renderer.throwNext = true;
    rig.step();
    expect(rig.layer.programs.status("ground-host:b")).toMatchObject({ state: "failed" });
    expect(rig.layer.programs.active()).toBe("ground-host:a");
    expect(rig.layer.reflector.available()).toBe(true);
    rig.layer.dispose();
  });

  it("transfers a procedural program pre-cut and recollects it only through inert input", () => {
    const rig = setup();
    rig.step();
    const collectsBefore = rig.countersA.collects;
    const { prepared } = beginGroundFlight(rig, CanvasAQuiet);
    expect(prepared).toMatchObject({ complete: true, allowFlight: true });
    expect(rig.countersA.deactivates).toBe(1);
    expect(rig.countersA.collects).toBeGreaterThan(collectsBefore);
    expect(rig.layer.programs.stats().sourceObservers).toBe(0);
    settleGroundFlight(rig);
    expect(rig.countersA.disposes).toBe(1);
    rig.layer.dispose();
    rig.transitions.dispose();
    rig.gpu.dispose();
  });

  it("seals a freezable program, removes its observers pre-cut, and releases once", () => {
    const counters: Counters = {
      creates: 0,
      activates: 0,
      deactivates: 0,
      collects: 0,
      disposes: 0,
    };
    const rig = setup(counters);
    rig.switchTo(CanvasB);
    rig.step();
    expect(rig.layer.programs.stats().sourceObservers).toBe(1);
    beginGroundFlight(rig, CanvasA);
    expect(counters.deactivates).toBe(1);
    expect(counters.frozenCollects).toBeGreaterThan(0);
    expect(rig.layer.programs.stats().sourceObservers).toBe(0);
    settleGroundFlight(rig);
    expect(counters.frozenReleases).toBe(1);
    expect(counters.disposes).toBe(1);
    rig.layer.dispose();
    rig.transitions.dispose();
    rig.gpu.dispose();
  });

  it("captures snapshot programs GPU-only under the shared ledger and frees exact bytes", () => {
    const snapshotCounters: Counters = {
      creates: 0,
      activates: 0,
      deactivates: 0,
      collects: 0,
      disposes: 0,
    };
    const snapshotProgram: GroundProgramDefinition = {
      ...definition("ground-host:snapshot", snapshotCounters),
      transition: "snapshot",
    };
    const rig = setup(undefined, [snapshotProgram]);
    rig.switchTo(CanvasSnapshot);
    rig.step();
    beginGroundFlight(rig, CanvasA);
    expect(rig.renderer.captures).toBe(1);
    expect(rig.renderer.snapshotUpdates).toBeGreaterThan(0);
    expect(rig.gpu.stats()).toMatchObject({ reservations: 1, reservedBytes: 800 * 600 * 4 });
    settleGroundFlight(rig);
    expect(rig.renderer.snapshotDisposes).toBe(1);
    expect(rig.gpu.stats()).toMatchObject({ reservations: 0, reservedBytes: 0 });
    rig.layer.dispose();
    rig.transitions.dispose();
    rig.gpu.dispose();
  });

  it("releases an in-flight snapshot after device loss without quarantining its program", () => {
    const snapshotCounters: Counters = {
      creates: 0,
      activates: 0,
      deactivates: 0,
      collects: 0,
      disposes: 0,
    };
    const snapshotProgram: GroundProgramDefinition = {
      ...definition("ground-host:snapshot", snapshotCounters),
      transition: "snapshot",
    };
    const rig = setup(undefined, [snapshotProgram]);
    rig.switchTo(CanvasSnapshot);
    rig.step();
    beginGroundFlight(rig, CanvasA);
    expect(rig.gpu.stats()).toMatchObject({ reservations: 1, reservedBytes: 800 * 600 * 4 });

    const rendersBeforeLoss = rig.renderer.renders;
    rig.renderer.loseDevice("WebGPU");
    rig.step();
    expect(rig.renderer.renders).toBe(rendersBeforeLoss);
    expect(rig.layer.reflector.available()).toBe(false);
    expect(rig.layer.programs.stats().renderer).toMatchObject({
      backend: "webgpu",
      failed: true,
      failure: { kind: "device-lost", api: "WebGPU" },
    });

    settleGroundFlight(rig);
    expect(rig.renderer.snapshotDisposes).toBe(1);
    expect(rig.gpu.stats()).toMatchObject({ reservations: 0, reservedBytes: 0 });
    expect(rig.layer.programs.status("ground-host:snapshot")).toMatchObject({ state: "ready" });
    rig.layer.dispose();
    rig.transitions.dispose();
    rig.gpu.dispose();
  });

  it("leaves no observers, FBOs, or GPU reservations after 120 rapid terminal paths", () => {
    const snapshotCounters: Counters = {
      creates: 0,
      activates: 0,
      deactivates: 0,
      collects: 0,
      disposes: 0,
    };
    const snapshotProgram: GroundProgramDefinition = {
      ...definition("ground-host:snapshot", snapshotCounters),
      transition: "snapshot",
    };
    const rig = setup(undefined, [snapshotProgram]);
    const destinations = [CanvasB, CanvasSnapshot, CanvasA] as const;
    let peakReservations = 0;
    let peakReservedBytes = 0;

    for (let i = 0; i < 120; i += 1) {
      const destination = destinations[i % destinations.length] ?? CanvasA;
      beginGroundFlight(rig, destination);
      const during = rig.gpu.stats();
      peakReservations = Math.max(peakReservations, during.reservations);
      peakReservedBytes = Math.max(peakReservedBytes, during.reservedBytes);

      if (i % 4 === 0) rig.transitions.abort("interrupted");
      else settleGroundFlight(rig);

      expect(rig.transitions.stats()).toMatchObject({ active: false, retainers: 0 });
      expect(rig.gpu.stats()).toMatchObject({ reservations: 0, reservedBytes: 0 });
      expect(rig.renderer.snapshotDisposes).toBe(rig.renderer.captures);
      expect(rig.layer.programs.stats()).toMatchObject({
        sourceObservers: destination === CanvasB ? 1 : 0,
      });
      expect(rig.layer.programs.stats().instantiatedPrograms).toBeLessThanOrEqual(3);
      expect(rig.layer.programs.stats().inactivePrograms).toBeLessThanOrEqual(2);
      expect(rig.canvasObservers()).toBe(1);
    }

    expect(rig.renderer.captures).toBeGreaterThan(0);
    expect(peakReservations).toBe(1);
    expect(peakReservedBytes).toBe(800 * 600 * 4);
    rig.layer.dispose();
    expect(rig.layer.programs.stats().sourceObservers).toBe(0);
    expect(rig.canvasObservers()).toBe(0);
    expect(rig.renderer.disposed).toBe(true);
    rig.transitions.dispose();
    rig.gpu.dispose();
  });

  it("reactivates a transferred procedural program when preparation is cancelled pre-cut", () => {
    const rig = setup();
    rig.step();
    const collectsBefore = rig.countersA.collects;
    const prepared = rig.transitions.prepare(groundDescriptor(rig, CanvasAQuiet));
    expect(prepared).toMatchObject({ complete: true, allowFlight: true });
    expect(rig.countersA.deactivates).toBe(1);
    expect(rig.layer.programs.active()).not.toBe("ground-host:a");

    prepared.cancel();

    expect(rig.layer.programs.active()).toBe("ground-host:a");
    expect(rig.countersA.activates).toBe(2);
    expect(rig.countersA.collects).toBeGreaterThan(collectsBefore);
    expect(rig.countersA.disposes).toBe(0);
    expect(rig.transitions.stats().active).toBe(false);
    rig.layer.dispose();
    rig.transitions.dispose();
    rig.gpu.dispose();
  });

  it("recreates a freezable program instead of implicitly thawing transferred state", () => {
    const counters: Counters = {
      creates: 0,
      activates: 0,
      deactivates: 0,
      collects: 0,
      disposes: 0,
    };
    const rig = setup(counters);
    rig.switchTo(CanvasB);
    rig.step();
    const prepared = rig.transitions.prepare(groundDescriptor(rig, CanvasA));

    prepared.cancel();

    expect(rig.layer.programs.active()).toBe("ground-host:b");
    expect(counters.frozenReleases).toBe(1);
    expect(counters.disposes).toBe(1);
    expect(counters.creates).toBe(2);
    expect(counters.activates).toBe(2);
    expect(rig.layer.programs.stats().sourceObservers).toBe(1);
    rig.layer.dispose();
    rig.transitions.dispose();
    rig.gpu.dispose();
  });

  it("drops a cancelled GPU snapshot and restores its current program and reservation", () => {
    const snapshotCounters: Counters = {
      creates: 0,
      activates: 0,
      deactivates: 0,
      collects: 0,
      disposes: 0,
    };
    const snapshotProgram: GroundProgramDefinition = {
      ...definition("ground-host:snapshot", snapshotCounters),
      transition: "snapshot",
    };
    const rig = setup(undefined, [snapshotProgram]);
    rig.switchTo(CanvasSnapshot);
    rig.step();
    const prepared = rig.transitions.prepare(groundDescriptor(rig, CanvasA));
    expect(rig.gpu.stats()).toMatchObject({ reservations: 1 });

    prepared.cancel();

    expect(rig.layer.programs.active()).toBe("ground-host:snapshot");
    expect(rig.renderer.snapshotDisposes).toBe(1);
    expect(rig.gpu.stats()).toMatchObject({ reservations: 0, reservedBytes: 0 });
    expect(snapshotCounters.disposes).toBe(0);
    expect(snapshotCounters.activates).toBe(2);
    rig.layer.dispose();
    rig.transitions.dispose();
    rig.gpu.dispose();
  });

  it("does not resurrect or double-dispose a snapshot program quarantined during transfer", () => {
    const snapshotCounters: Counters = {
      creates: 0,
      activates: 0,
      deactivates: 0,
      collects: 0,
      disposes: 0,
      throwDeactivate: true,
    };
    const snapshotProgram: GroundProgramDefinition = {
      ...definition("ground-host:snapshot", snapshotCounters),
      transition: "snapshot",
    };
    const rig = setup(undefined, [snapshotProgram]);
    rig.switchTo(CanvasSnapshot);
    rig.step();
    const prepared = rig.transitions.prepare(groundDescriptor(rig, CanvasA));
    expect(snapshotCounters.disposes).toBe(1);

    prepared.cancel();

    expect(snapshotCounters.disposes).toBe(1);
    expect(rig.layer.programs.active()).toBe("ground-host:a");
    expect(rig.renderer.snapshotDisposes).toBe(1);
    expect(rig.gpu.stats()).toMatchObject({ reservations: 0, reservedBytes: 0 });
    rig.layer.dispose();
    rig.transitions.dispose();
    rig.gpu.dispose();
  });

  it("releases a frozen handle even when pre-cut deactivation fails", () => {
    const counters: Counters = {
      creates: 0,
      activates: 0,
      deactivates: 0,
      collects: 0,
      disposes: 0,
      throwDeactivate: true,
    };
    const rig = setup(counters);
    rig.switchTo(CanvasB);
    rig.step();
    const { prepared } = beginGroundFlight(rig, CanvasA);
    expect(prepared).toMatchObject({ complete: false, allowFlight: false });
    expect(counters.freezes).toBe(1);
    expect(counters.frozenReleases).toBe(1);
    expect(counters.disposes).toBe(1);
    expect(rig.layer.programs.stats().sourceObservers).toBe(0);
    rig.layer.dispose();
    rig.transitions.dispose();
    rig.gpu.dispose();
  });

  it("restores outgoing renderOrder exactly when a cancelled rollback reuses the object", () => {
    const counters: Counters = {
      creates: 0,
      activates: 0,
      deactivates: 0,
      collects: 0,
      disposes: 0,
    };
    const object = new Object3D();
    const child = new Object3D();
    child.renderOrder = 7;
    object.add(child);
    const ordered: GroundProgramDefinition = {
      id: "ground-host:ordered",
      transition: "procedural",
      sources: [],
      create: () => ({
        object,
        activate() {
          counters.activates += 1;
          return [];
        },
        collect() {
          counters.collects += 1;
        },
        deactivate() {
          counters.deactivates += 1;
        },
        estimateBytes: () => 1024,
        dispose() {
          counters.disposes += 1;
        },
      }),
    };
    const rig = setup(undefined, [ordered]);
    rig.switchTo(CanvasOrdered);
    rig.step();

    const prepared = rig.transitions.prepare({
      ...groundDescriptor(rig, CanvasA),
      kind: "exit" as const,
    });
    expect(prepared).toMatchObject({ complete: true, allowFlight: true });
    expect(object.renderOrder).toBe(100);
    expect(child.renderOrder).toBe(100);

    prepared.cancel();

    expect(rig.layer.programs.active()).toBe("ground-host:ordered");
    expect(object.renderOrder).toBe(0);
    expect(child.renderOrder).toBe(7);
    expect(counters.disposes).toBe(0);
    rig.layer.dispose();
    rig.transitions.dispose();
    rig.gpu.dispose();
  });

  it("downsamples a GPU snapshot to fit the ledger sub-budget", () => {
    const snapshotCounters: Counters = {
      creates: 0,
      activates: 0,
      deactivates: 0,
      collects: 0,
      disposes: 0,
    };
    const snapshotProgram: GroundProgramDefinition = {
      ...definition("ground-host:snapshot", snapshotCounters),
      transition: "snapshot",
    };
    const budget = 4 * 1024 * 1024;
    const rig = setup(undefined, [snapshotProgram], budget);
    rig.switchTo(CanvasSnapshot);
    rig.step();
    beginGroundFlight(rig, CanvasA);

    const cap = Math.floor(budget / 8);
    const during = rig.gpu.stats();
    expect(rig.renderer.captures).toBe(1);
    expect(during.reservations).toBe(1);
    expect(during.reservedBytes).toBeGreaterThan(0);
    expect(during.reservedBytes).toBeLessThanOrEqual(cap);
    expect(during.reservedBytes).toBeLessThan(800 * 600 * 4);

    settleGroundFlight(rig);
    expect(rig.renderer.snapshotDisposes).toBe(1);
    expect(rig.gpu.stats()).toMatchObject({ reservations: 0, reservedBytes: 0 });
    rig.layer.dispose();
    rig.transitions.dispose();
    rig.gpu.dispose();
  });

  it("retries snapshot allocation at smaller scales when the ledger is nearly full", () => {
    const snapshotCounters: Counters = {
      creates: 0,
      activates: 0,
      deactivates: 0,
      collects: 0,
      disposes: 0,
    };
    const snapshotProgram: GroundProgramDefinition = {
      ...definition("ground-host:snapshot", snapshotCounters),
      transition: "snapshot",
    };
    const rig = setup(undefined, [snapshotProgram]);
    const heldBytes = 256 * 1024 * 1024 - 500_000;
    const hold = rig.gpu.reserve("test:pressure", heldBytes);
    expect(hold).toBeDefined();
    rig.switchTo(CanvasSnapshot);
    rig.step();
    beginGroundFlight(rig, CanvasA);

    const during = rig.gpu.stats();
    expect(rig.renderer.captures).toBe(1);
    expect(during.reservations).toBe(2);
    expect(during.reservedBytes - heldBytes).toBeGreaterThan(0);
    expect(during.reservedBytes - heldBytes).toBeLessThanOrEqual(500_000);
    expect(during.reservedBytes - heldBytes).toBeLessThan(800 * 600 * 4);

    settleGroundFlight(rig);
    expect(rig.renderer.snapshotDisposes).toBe(1);
    expect(rig.gpu.stats()).toMatchObject({ reservations: 1, reservedBytes: heldBytes });
    hold?.release();
    expect(rig.gpu.stats()).toMatchObject({ reservations: 0, reservedBytes: 0 });
    rig.layer.dispose();
    rig.transitions.dispose();
    rig.gpu.dispose();
  });
});
