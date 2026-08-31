/** Lazy, single-active-program ground layer used by typed CanvasTypes. */
import {
  Camera,
  ChildOf,
  PrefabId,
  Related,
  SpatialVersion,
  createCompositorSourceRegistry,
  defineQuery,
  schemaMeta,
  type CanvasSessionValue,
  type CanvasType,
  type CompositorSourceRegistry,
  type Entity,
  type FrameSwitchDescriptor,
  type GridConfig,
  type GpuReservation,
  type PresentationRetainer,
  type PresentationTransitionFrame,
  type SnapGuidesConfig,
  type WiresConfig,
  type World,
} from "@ice/core";
import { visibleRect, worldToScreen } from "@ice/kernel";
import { OrthographicCamera, Object3D, Scene } from "three/webgpu";
import type { GroundContext, GroundLayer } from "./index";
import type { GroundFrame, GroundPass } from "./pass";
import type {
  GroundHostStats,
  GroundFrameChildrenSource,
  GroundProgramCacheOptions,
  GroundProgramDefinition,
  GroundProgramInput,
  GroundProgramInstance,
  GroundProgramStatus,
  GroundSourceDeclaration,
} from "./program";
import {
  GROUND_FRAME_CHILDREN_DEFAULT_LIMIT,
  GROUND_FRAME_CHILDREN_MAX_LIMIT,
} from "./program";
import {
  createGroundRenderer,
  readGroundRendererStatus,
  type GroundGpuSnapshot,
  type GroundRendererLike,
} from "./renderer";
import { createGuidesPass } from "./passes/guides";
import { createWiresPass } from "./passes/wires";
import type { CompositeTarget, CompositorReflector } from "./compositor/compositor-reflector";
import type {
  DomSourceBinder,
  DomSourceBinderOptions,
} from "./compositor/dom-source-binder";
import type { LiftDriver } from "./compositor/lift";
import type { VideoSourceOptions } from "./compositor/video-source";
import { createCompositorWiring } from "./compositor/wiring";

const INTERNAL_NOOP_ID = "@ice/ground/transparent";
const DEFAULT_INACTIVE_COUNT = 3;
const DEFAULT_CACHE_BYTES = 64 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024;

export interface GroundHostOptions {
  readonly programs: readonly GroundProgramDefinition[];
  readonly fallback: string;
  readonly wires?: Partial<WiresConfig>;
  readonly guides?: Partial<SnapGuidesConfig>;
  readonly passes?: readonly GroundPass[];
  readonly cache?: GroundProgramCacheOptions;
  readonly forceWebGL?: boolean;
  /** Query-gated timestamp/CPU evidence; off by default (zero timer/query cost). */
  readonly profile?: boolean;
  readonly rendererOverride?: GroundRendererLike;
  readonly onProgramFault?: (id: string, error: unknown) => void;
  /**
   * THE COMPOSITED PROFILE SWITCH (design-012 §4) — the same options
   * `ground()` takes, because which profile an app runs must not depend on
   * which ground factory it wired. The app-owned GPUDevice: three adopts it
   * instead of creating its own, and the layer additionally builds the
   * compositor, so `compositorReflector`, `sources` and `domSources` appear on
   * the layer.
   *
   * Absent ⇒ the stratified profile, unchanged. There is no runtime toggle.
   *
   * That parity is now KEPT rather than promised: both factories build their
   * compositor through `createCompositorWiring`. This note used to sit above a
   * quad pass with no facts, resolve, order or background and no dom binder at
   * all, so every registered source warned once per composite and nothing was
   * ever drawn — and the shipping app is the one on this path.
   */
  readonly device?: GPUDevice;
  /** The compositor's source registry; omitted ⇒ private, read via `layer.sources`. */
  readonly sources?: CompositorSourceRegistry;
  /** The compositor's swap-chain target. Absent at S1 — ground still presents itself. */
  readonly target?: CompositeTarget;
  /** Paint order for the widget quads, back to front (petition 8). */
  readonly order?: () => readonly Entity[];
  /** Tuning for the dom source atlas (page sizes, gutter, copy budget, demand). */
  readonly atlas?: DomSourceBinderOptions;
  /** The lift/fade driver (design-012 §7's "one lift"), advanced by the compositor. */
  readonly lift?: LiftDriver;
  /** Live-surface options — notably whether this producer's frames are flipped. */
  readonly video?: VideoSourceOptions;
}

export interface GroundProgramControl {
  prepare(id: string): void;
  status(id: string): GroundProgramStatus;
  subscribe(onChange: () => void): () => void;
  active(): string;
  stats(): GroundHostStats;
}

export interface GroundHostLayer extends GroundLayer {
  readonly programs: GroundProgramControl;
}

type ProgramRecord = {
  readonly definition: GroundProgramDefinition;
  readonly instance: GroundProgramInstance;
  lastUsed: number;
};

type ActiveProgram = {
  readonly id: string;
  readonly record?: ProgramRecord;
  readonly instance: GroundProgramInstance;
  readonly sourceUnsubs: (() => void)[];
  readonly externalUnsubs: (() => void)[];
  readonly input: GroundProgramInput;
  readonly closeInput: () => void;
};

type SharedSlot = {
  readonly pass: GroundPass;
  readonly profile: "wires" | "guides" | "always";
  dirty: boolean;
  enabled: boolean;
  armed: boolean;
  unsubs: (() => void)[];
};

function validateDefinition(definition: GroundProgramDefinition): void {
  if (
    typeof definition.id !== "string" ||
    definition.id.length === 0 ||
    /\s/.test(definition.id)
  ) {
    throw new Error("ice: GroundProgram id must be a stable non-empty id without whitespace.");
  }
  const sources = definition.sources ?? [];
  if (definition.transition === "procedural" && sources.length > 0) {
    throw new Error(
      `ice: procedural GroundProgram "${definition.id}" cannot declare content sources.`,
    );
  }
  if (definition.transition === "freezable") {
    // Instance-level validation happens before activation; this message keeps
    // the definition rule visible even though create remains lazy.
  }
  const seen = new Set<unknown>();
  for (const source of sources) {
    const key =
      source.kind === "resource"
        ? source.resource
        : source.kind === "poles"
          ? source.source
          : source.kind === "frame-children"
            ? `frame-children:${source.components
                .map((component) => schemaMeta.component(component)?.name ?? "<unknown>")
                .join(",")}:${source.limit ?? GROUND_FRAME_CHILDREN_DEFAULT_LIMIT}`
            : source.kind;
    if (seen.has(key)) {
      throw new Error(`ice: GroundProgram "${definition.id}" repeats a source declaration.`);
    }
    seen.add(key);
    if (source.kind === "resource" && schemaMeta.resource(source.resource) === undefined) {
      throw new Error(`ice: GroundProgram "${definition.id}" declares an unknown resource.`);
    }
    if (source.kind === "frame-children") {
      const limit = source.limit ?? GROUND_FRAME_CHILDREN_DEFAULT_LIMIT;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > GROUND_FRAME_CHILDREN_MAX_LIMIT) {
        throw new Error(
          `ice: GroundProgram "${definition.id}" frame-child limit must be between 1 and ${GROUND_FRAME_CHILDREN_MAX_LIMIT}.`,
        );
      }
      if (source.components.length > 16 || new Set(source.components).size !== source.components.length) {
        throw new Error(
          `ice: GroundProgram "${definition.id}" frame-child source must declare at most 16 unique components.`,
        );
      }
      for (const component of source.components) {
        if (schemaMeta.component(component) === undefined) {
          throw new Error(
            `ice: GroundProgram "${definition.id}" frame-child source declares an unknown component.`,
          );
        }
      }
    }
  }
}

const EMPTY_FRAME_CHILDREN = Object.freeze({
  documentEpoch: 0,
  canvasEpoch: 0,
  frame: 0 as Entity,
  total: 0,
  truncated: false,
  rows: Object.freeze([]),
});

function inertInput(): GroundProgramInput {
  return {
    resource: () => undefined,
    spatial: () => [],
    poles: () => [],
    children: () => EMPTY_FRAME_CHILDREN,
  };
}

function noopInstance(): GroundProgramInstance {
  return {
    object: new Object3D(),
    activate: () => [],
    collect: () => {},
    deactivate: () => {},
    estimateBytes: () => 0,
    dispose: () => {},
  };
}

function cacheLimit(label: string, value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new Error(`ice: GroundHost ${label} cache budget must be a non-negative integer.`);
  }
  return resolved;
}

function createProgramHostLayer(
  ctx: GroundContext,
  opts: GroundHostOptions,
  definitions: ReadonlyMap<string, GroundProgramDefinition>,
): GroundHostLayer {
  const { world } = ctx;
  const doc = ctx.host.container.ownerDocument;
  // S6b, exactly as in `ground()`: with a compositor TARGET present the host's
  // programs render into an offscreen buffer the compositor draws first,
  // instead of presenting onto this renderer's own canvas.
  const groundOffscreen = opts.device !== undefined && opts.target !== undefined;
  const renderer =
    opts.rendererOverride ??
    createGroundRenderer(doc, {
      forceWebGL: opts.forceWebGL === true,
      profile: opts.profile === true,
      ...(opts.device !== undefined ? { device: opts.device } : {}),
      ...(groundOffscreen ? { offscreen: true } : {}),
    });
  // The compositor exists only on the composited profile — no device, no
  // compositor, and everything below is the host as it always was.
  let compositor: CompositorReflector | undefined;
  let compositorSources: CompositorSourceRegistry | undefined;
  let domSources: DomSourceBinder | undefined;
  if (opts.device !== undefined) {
    compositorSources = opts.sources ?? createCompositorSourceRegistry();
    // ONE wiring, shared with `ground()` — the seams, the binder and the
    // prepare all live in compositor/wiring.ts so the two factories cannot
    // drift into building different compositors again.
    const wired = createCompositorWiring({
      world,
      device: opts.device,
      registry: compositorSources,
      ...(groundOffscreen ? { groundTexture: () => renderer.targetTexture?.() } : {}),
      ...(opts.target !== undefined ? { target: opts.target } : {}),
      ...(opts.order !== undefined ? { order: opts.order } : {}),
      ...(opts.atlas !== undefined ? { atlas: opts.atlas } : {}),
      ...(opts.lift !== undefined ? { lift: opts.lift } : {}),
      ...(opts.video !== undefined ? { video: opts.video } : {}),
    });
    compositor = wired.compositor;
    domSources = wired.domSources;
  }
  const canvas = renderer.canvas;
  Object.assign(canvas.style, {
    position: "absolute",
    left: "0",
    top: "0",
    width: "100%",
    height: "100%",
    display: "block",
    pointerEvents: "none",
  });
  ctx.host.container.insertBefore(canvas, ctx.host.contentPlane);

  const scene = new Scene();
  const camera = new OrthographicCamera(0, 1, 0, 1, -1000, 1000);
  const shared: SharedSlot[] = [
    { pass: createWiresPass(opts.wires ?? {}, ctx.readWirePreview), profile: "wires", dirty: true, enabled: true, armed: false, unsubs: [] },
    { pass: createGuidesPass(opts.guides ?? {}), profile: "guides", dirty: true, enabled: true, armed: false, unsubs: [] },
    ...(opts.passes ?? []).map((pass) => ({
      pass,
      profile: "always" as const,
      dirty: true,
      enabled: true,
      armed: false,
      unsubs: [],
    })),
  ];
  for (const slot of shared) scene.add(slot.pass.object);

  const statuses = new Map<string, GroundProgramStatus>();
  for (const id of definitions.keys()) statuses.set(id, Object.freeze({ id, state: "cold" }));
  const statusListeners = new Set<() => void>();
  const preparation = new Map<string, AbortController>();
  const records = new Map<string, ProgramRecord>();
  const noop = noopInstance();
  const inactiveLimit = cacheLimit("inactive-count", opts.cache?.inactiveCount, DEFAULT_INACTIVE_COUNT);
  const byteLimit = cacheLimit("byte", opts.cache?.bytes, DEFAULT_CACHE_BYTES);
  let active: ActiveProgram = {
    id: INTERNAL_NOOP_ID,
    instance: noop,
    sourceUnsubs: [],
    externalUnsubs: [],
    input: inertInput(),
    closeInput: () => {},
  };
  scene.add(noop.object);
  let desired = opts.fallback;
  let useCounter = 0;
  let sourceObservers = 0;
  let redraws = 0;
  let anyDirty = true;
  let programDirty = true;
  let incomingOpacity = 1;
  let fatalRenderFault = false;
  let disposed = false;

  const setStatus = (id: string, state: GroundProgramStatus["state"], message?: string): void => {
    const previous = statuses.get(id);
    if (previous?.state === state && previous.message === message) return;
    statuses.set(id, Object.freeze({ id, state, ...(message === undefined ? {} : { message }) }));
    for (const listener of [...statusListeners]) {
      try {
        listener();
      } catch {
        // One inspection subscriber cannot block readiness or fallback.
      }
    }
  };

  const wakeProgram = (): void => {
    programDirty = true;
    anyDirty = true;
  };

  const wakeShared = (slot: SharedSlot): void => {
    if (!slot.enabled) return;
    slot.dirty = true;
    anyDirty = true;
  };

  const reportFault = (id: string, error: unknown): void => {
    setStatus(id, "failed", error instanceof Error ? error.message : String(error));
    try {
      opts.onProgramFault?.(id, error);
    } catch {
      // Reporting is never allowed to break fallback activation.
    }
  };

  const disposeRecord = (record: ProgramRecord): void => {
    // A retained record can outlive its cache slot. Never let disposal of a
    // stale transfer delete a newer instance installed under the same id.
    if (records.get(record.definition.id) === record) records.delete(record.definition.id);
    try {
      record.instance.dispose();
    } catch (error) {
      reportFault(record.definition.id, error);
    }
  };

  const estimate = (record: ProgramRecord): number | undefined => {
    if (record.instance.estimateBytes === undefined) return undefined;
    try {
      const value = record.instance.estimateBytes();
      return Number.isFinite(value) && value >= 0 ? value : undefined;
    } catch (error) {
      reportFault(record.definition.id, error);
      return undefined;
    }
  };

  const evict = (): void => {
    const inactive = [...records.values()]
      .filter((record) => record !== active.record)
      .sort((a, b) => a.lastUsed - b.lastUsed || a.definition.id.localeCompare(b.definition.id));
    let total = inactive.reduce((sum, record) => sum + (estimate(record) ?? byteLimit + 1), 0);
    while (inactive.length > inactiveLimit || total > byteLimit) {
      const record = inactive.shift();
      if (record === undefined) break;
      total -= estimate(record) ?? byteLimit + 1;
      disposeRecord(record);
    }
  };

  const detachActive = (retain: boolean): void => {
    const departing = active;
    let shouldRetain = retain;
    scene.remove(departing.instance.object);
    active = {
      id: INTERNAL_NOOP_ID,
      instance: noop,
      sourceUnsubs: [],
      externalUnsubs: [],
      input: inertInput(),
      closeInput: () => {},
    };
    departing.closeInput();
    for (const unsub of departing.sourceUnsubs.splice(0)) {
      try {
        unsub();
      } catch (error) {
        reportFault(departing.id, error);
        shouldRetain = false;
      }
      sourceObservers -= 1;
    }
    for (const unsub of departing.externalUnsubs.splice(0)) {
      try {
        unsub();
      } catch (error) {
        reportFault(departing.id, error);
        shouldRetain = false;
      }
    }
    if (departing.record === undefined) return;
    departing.record.lastUsed = ++useCounter;
    try {
      departing.instance.deactivate();
    } catch (error) {
      reportFault(departing.id, error);
      shouldRetain = false;
    }
    if (!shouldRetain || estimate(departing.record) === undefined) {
      disposeRecord(departing.record);
    }
  };

  /**
   * Pre-cut ownership transfer. The instance leaves the active cache and all
   * source observers close synchronously, but its GPU object remains available
   * to the bounded transition retainer until exact release.
   */
  const takeActiveForTransition = (): ProgramRecord | undefined => {
    const departing = active;
    if (departing.record === undefined) return undefined;
    active = {
      id: INTERNAL_NOOP_ID,
      instance: noop,
      sourceUnsubs: [],
      externalUnsubs: [],
      input: inertInput(),
      closeInput: () => {},
    };
    departing.closeInput();
    for (const unsub of departing.sourceUnsubs.splice(0)) {
      try {
        unsub();
      } catch (error) {
        reportFault(departing.id, error);
      } finally {
        sourceObservers -= 1;
      }
    }
    for (const unsub of departing.externalUnsubs.splice(0)) {
      try {
        unsub();
      } catch (error) {
        reportFault(departing.id, error);
      }
    }
    let deactivateError: unknown;
    try {
      departing.instance.deactivate();
    } catch (error) {
      reportFault(departing.id, error);
      deactivateError = error;
    }
    records.delete(departing.id);
    departing.record.lastUsed = ++useCounter;
    programDirty = true;
    if (deactivateError !== undefined) {
      scene.remove(departing.instance.object);
      try {
        departing.instance.dispose();
      } catch (error) {
        reportFault(departing.id, error);
      }
      throw deactivateError;
    }
    return departing.record;
  };

  const sourceInput = (
    definition: GroundProgramDefinition,
  ): { input: GroundProgramInput; arm: () => (() => void)[]; close: () => void } => {
    const resources = new Set(
      (definition.sources ?? [])
        .filter((source): source is Extract<GroundSourceDeclaration, { kind: "resource" }> =>
          source.kind === "resource",
        )
        .map((source) => source.resource),
    );
    const spatial = (definition.sources ?? []).some((source) => source.kind === "active-spatial");
    const poles = new Set(
      (definition.sources ?? [])
        .filter((source): source is Extract<GroundSourceDeclaration, { kind: "poles" }> =>
          source.kind === "poles",
        )
        .map((source) => source.source),
    );
    const childSources = new Set(
      (definition.sources ?? []).filter(
        (source): source is GroundFrameChildrenSource => source.kind === "frame-children",
      ),
    );
    let open = true;
    const assertOpen = (): void => {
      if (!open) {
        throw new Error(`GroundProgram "${definition.id}" used an input after deactivation.`);
      }
    };
    const input: GroundProgramInput = {
      resource(resource) {
        assertOpen();
        if (!resources.has(resource)) {
          throw new Error(`GroundProgram "${definition.id}" read an undeclared resource.`);
        }
        return world.getResource(resource);
      },
      spatial(bounds) {
        assertOpen();
        if (!spatial) {
          throw new Error(`GroundProgram "${definition.id}" read undeclared active spatial data.`);
        }
        return (ctx.readSpatial?.(bounds) ?? []).filter(
          (entry) => world.isAlive(entry.id) && world.get(entry.id, PrefabId) !== undefined,
        );
      },
      poles(source) {
        assertOpen();
        if (!poles.has(source)) {
          throw new Error(`GroundProgram "${definition.id}" read an undeclared pole source.`);
        }
        return source.read(world);
      },
      children(source) {
        assertOpen();
        if (!childSources.has(source)) {
          throw new Error(`GroundProgram "${definition.id}" read an undeclared child source.`);
        }
        const session = ctx.canvas?.current?.();
        if (session === undefined || session.state !== "attached") {
          return EMPTY_FRAME_CHILDREN;
        }
        const all = world
          .getReverse(session.frame, ChildOf)
          .filter(
            (entity) => world.isAlive(entity) && world.get(entity, PrefabId) !== undefined,
          );
        const limit = source.limit ?? GROUND_FRAME_CHILDREN_DEFAULT_LIMIT;
        const rows = all.slice(0, limit).map((entity) => {
          const values = source.components.map((component) => {
            const value = world.get(entity, component) as Record<string, unknown> | undefined;
            return value === undefined ? undefined : Object.freeze({ ...value });
          });
          return Object.freeze({
            entity,
            widgetType: world.get(entity, PrefabId)?.id ?? "",
            values: Object.freeze(values),
          });
        });
        return Object.freeze({
          documentEpoch: session.documentEpoch,
          canvasEpoch: session.epoch,
          frame: session.frame,
          total: all.length,
          truncated: all.length > rows.length,
          rows: Object.freeze(rows),
        });
      },
    };
    return {
      input,
      arm: () => {
        const unsubs: (() => void)[] = [];
        const releaseAll = (): void => {
          for (const unsub of unsubs.splice(0)) {
            try {
              unsub();
            } catch {
              // Continue removing every partially armed source.
            }
          }
        };
        try {
          for (const resource of resources) {
            unsubs.push(world.reactive.observeResource(resource, wakeProgram));
          }
          if (spatial) unsubs.push(world.reactive.observeResource(SpatialVersion, wakeProgram));
          for (const source of poles) unsubs.push(source.subscribe(world, wakeProgram));
          for (const source of childSources) {
            const session = ctx.canvas?.current?.();
            if (session === undefined || session.state !== "attached") continue;
            const membershipObserver: { unsub?: () => void } = {};
            const valueUnsubs: (() => void)[] = [];
            const cleanup = (): void => {
              try {
                membershipObserver.unsub?.();
              } catch {
                // Continue removing the per-child observers.
              }
              for (const unsub of valueUnsubs.splice(0)) {
                try {
                  unsub();
                } catch {
                  // Continue removing the exact bounded observer set.
                }
              }
            };
            unsubs.push(cleanup);
            const rewire = (): void => {
              for (const unsub of valueUnsubs.splice(0)) {
                try {
                  unsub();
                } catch {
                  // Continue the bounded rewire.
                }
              }
              const limit = source.limit ?? GROUND_FRAME_CHILDREN_DEFAULT_LIMIT;
              const children = world
                .getReverse(session.frame, ChildOf)
                .filter((entity) => world.isAlive(entity))
                .slice(0, limit);
              for (const child of children) {
                valueUnsubs.push(
                  world.reactive.observeValue(child, PrefabId, wakeProgram),
                );
                for (const component of source.components) {
                  valueUnsubs.push(
                    world.reactive.observeValue(child, component, wakeProgram),
                  );
                }
              }
            };
            rewire();
            const membership = defineQuery([PrefabId, Related(ChildOf, session.frame)]);
            membershipObserver.unsub = world.reactive.observeQuery(
              membership,
              () => {
                rewire();
                wakeProgram();
              },
              { cols: [] },
            );
          }
          if (unsubs.some((unsub) => typeof unsub !== "function")) {
            throw new Error(`GroundProgram "${definition.id}" source returned no inverse.`);
          }
          return unsubs;
        } catch (error) {
          releaseAll();
          throw error;
        }
      },
      close: () => {
        open = false;
      },
    };
  };

  const activate = (id: string): boolean => {
    if (active.id === id) return true;
    const definition = definitions.get(id);
    if (definition === undefined || statuses.get(id)?.state !== "ready") return false;
    let record = records.get(id);
    try {
      if (record === undefined) {
        const instance = definition.create();
        if (
          definition.transition === "freezable" &&
          typeof instance.freeze !== "function"
        ) {
          throw new Error(`freezable GroundProgram "${id}" did not implement freeze()`);
        }
        record = { definition, instance, lastUsed: ++useCounter };
        records.set(id, record);
      }
      detachActive(true);
      const source = sourceInput(definition);
      const sourceUnsubs = source.arm();
      sourceObservers += sourceUnsubs.length;
      let externalUnsubs: (() => void)[] = [];
      try {
        externalUnsubs = [...record.instance.activate({ input: source.input }, wakeProgram)];
      } catch (error) {
        source.close();
        for (const unsub of sourceUnsubs) {
          try {
            unsub();
          } catch {
            // Activation will be quarantined; continue removing every source.
          } finally {
            sourceObservers -= 1;
          }
        }
        throw error;
      }
      if (externalUnsubs.some((unsub) => typeof unsub !== "function")) {
        source.close();
        for (const unsub of sourceUnsubs) {
          try {
            unsub();
          } catch {
            // Activation will be quarantined; continue removing every source.
          } finally {
            sourceObservers -= 1;
          }
        }
        for (const unsub of externalUnsubs) {
          if (typeof unsub === "function") {
            try {
              unsub();
            } catch {
              // The activation is already being rejected and disposed.
            }
          }
        }
        throw new Error(`GroundProgram "${id}" activate() returned a non-function inverse.`);
      }
      active = {
        id,
        record,
        instance: record.instance,
        sourceUnsubs,
        externalUnsubs,
        input: source.input,
        closeInput: source.close,
      };
      scene.add(record.instance.object);
      record.lastUsed = ++useCounter;
      wakeProgram();
      evict();
      return true;
    } catch (error) {
      if (record !== undefined) disposeRecord(record);
      reportFault(id, error);
      return false;
    }
  };

  const activateNoop = (): void => {
    if (active.id === INTERNAL_NOOP_ID) {
      if (noop.object.parent !== scene) scene.add(noop.object);
      return;
    }
    detachActive(true);
    active = {
      id: INTERNAL_NOOP_ID,
      instance: noop,
      sourceUnsubs: [],
      externalUnsubs: [],
      input: inertInput(),
      closeInput: () => {},
    };
    scene.add(noop.object);
    wakeProgram();
    evict();
  };

  let reconcileActive = (): void => {};

  const prepare = (id: string): void => {
    const definition = definitions.get(id);
    if (definition === undefined) {
      setStatus(id, "failed", `GroundProgram "${id}" is not registered.`);
      return;
    }
    const state = statuses.get(id)?.state;
    if (state === "ready" || state === "loading" || state === "failed") return;
    if (definition.load === undefined && definition.prepare === undefined) {
      setStatus(id, "ready");
      return;
    }
    setStatus(id, "loading");
    const controller = new AbortController();
    preparation.set(id, controller);
    void Promise.resolve()
      .then(() => definition.load?.())
      .then(() => definition.prepare?.({ signal: controller.signal }))
      .then(() => {
        if (disposed || controller.signal.aborted || preparation.get(id) !== controller) return;
        preparation.delete(id);
        setStatus(id, "ready");
        reconcileActive();
      })
      .catch((error: unknown) => {
        if (disposed || controller.signal.aborted || preparation.get(id) !== controller) return;
        preparation.delete(id);
        reportFault(id, error);
        reconcileActive();
      });
  };

  reconcileActive = (): void => {
    if (disposed) return;
    prepare(desired);
    if (statuses.get(desired)?.state === "ready" && activate(desired)) return;
    prepare(opts.fallback);
    if (statuses.get(opts.fallback)?.state === "ready" && activate(opts.fallback)) return;
    activateNoop();
  };

  const currentType = (): CanvasType | undefined => {
    try {
      return ctx.canvas?.type();
    } catch {
      return undefined;
    }
  };

  const currentSession = (): CanvasSessionValue | undefined => {
    try {
      return ctx.canvas?.current?.();
    } catch {
      return undefined;
    }
  };

  const reconcileShared = (): void => {
    const ground = currentType()?.presentation?.ground;
    for (const slot of shared) {
      const shouldEnable =
        slot.profile === "always" ||
        (slot.profile === "wires" ? ground?.wires !== false : ground?.guides !== false);
      if (slot.enabled === shouldEnable && slot.armed) continue;
      const visibilityChanged = slot.enabled !== shouldEnable;
      slot.enabled = shouldEnable;
      slot.armed = true;
      slot.pass.object.visible = shouldEnable;
      for (const unsub of slot.unsubs.splice(0)) {
        try {
          unsub();
        } catch {
          // Shared built-in inverse failure must not pin the other passes.
        }
      }
      if (visibilityChanged) anyDirty = true;
      if (shouldEnable) {
        slot.unsubs.push(...slot.pass.arm(world, () => wakeShared(slot)));
        slot.dirty = true;
        anyDirty = true;
      }
    }
  };

  let canvasScopeKey = "";
  const switchForCanvas = (): void => {
    const type = currentType();
    const session = currentSession();
    const nextScopeKey =
      session === undefined
        ? type?.id ?? ""
        : `${session.documentEpoch}:${session.epoch}:${session.frame}`;
    if (nextScopeKey !== canvasScopeKey && active.record !== undefined) {
      // Frame-child capabilities and every other input token are activation-
      // scoped. Re-arm even when two CanvasTypes share one program id.
      detachActive(true);
    }
    canvasScopeKey = nextScopeKey;
    desired = type?.presentation?.ground?.program ?? opts.fallback;
    reconcileShared();
    reconcileActive();
  };

  const unsubs: (() => void)[] = [
    world.reactive.observeResource(Camera, () => {
      wakeProgram();
      for (const slot of shared) wakeShared(slot);
    }),
  ];
  if (ctx.canvas !== undefined) unsubs.push(ctx.canvas.subscribe(switchForCanvas));

  let cssW = 0;
  let cssH = 0;
  let dpr = 1;
  const applySize = (width: number, height: number): void => {
    dpr = doc.defaultView?.devicePixelRatio ?? 1;
    cssW = width;
    cssH = height;
    renderer.setSize(width, height, dpr);
    camera.left = 0;
    camera.right = Math.max(1, width);
    camera.top = 0;
    camera.bottom = Math.max(1, height);
    camera.updateProjectionMatrix();
    wakeProgram();
    for (const slot of shared) wakeShared(slot);
  };
  const initialRect = ctx.host.container.getBoundingClientRect();
  applySize(initialRect.width, initialRect.height);
  let resizeObserver: ResizeObserver | undefined;
  try {
    resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) applySize(entry.contentRect.width, entry.contentRect.height);
    });
    resizeObserver.observe(ctx.host.container);
  } catch {
    resizeObserver = undefined;
  }
  renderer.onReady(() => {
    if (!disposed) {
      anyDirty = true;
      programDirty = true;
    }
  });

  /** Returns the exact inverse; a cancelled rollback reuses the same object. */
  const transitionOrder = (object: Object3D, kind: "enter" | "exit"): (() => void) => {
    const order = kind === "enter" ? -100 : 100;
    const saved: [Object3D, number][] = [];
    object.traverse((child) => {
      saved.push([child, child.renderOrder]);
      child.renderOrder = order;
    });
    return () => {
      for (const [child, previous] of saved) child.renderOrder = previous;
    };
  };

  /** Restore the pre-cut program when navigation itself rolls back. */
  const restoreTransferred = (
    record: ProgramRecord,
    frame: GroundFrame,
    disposition: "reuse" | "dispose" | "already-disposed",
  ): void => {
    const incumbent = records.get(record.definition.id);
    if (disposition === "reuse" && incumbent === undefined) {
      records.set(record.definition.id, record);
    } else if (
      disposition === "dispose" ||
      (disposition === "reuse" && incumbent !== record)
    ) {
      // A freezable handle may transfer instance-owned buffers, so its source
      // instance is never implicitly thawed. Recreate it through normal lazy
      // activation. Also never overwrite a newer re-entrant instance.
      try {
        record.instance.dispose();
      } catch (error) {
        reportFault(record.definition.id, error);
      }
    }
    if (desired !== record.definition.id) {
      reconcileActive();
      return;
    }
    if (!activate(record.definition.id)) reconcileActive();
    if (active.id === record.definition.id) {
      try {
        active.instance.collect(active.input, frame, { opacity: 1 });
        programDirty = false;
      } catch (error) {
        reportFault(record.definition.id, error);
        reconcileActive();
      }
    }
  };

  const snapshotFor = (
    descriptor: FrameSwitchDescriptor,
    object: Object3D,
  ): {
    snapshot: GroundGpuSnapshot;
    reservation: GpuReservation;
    sourceRect: { x: number; y: number; width: number; height: number };
  } => {
    if (renderer.capture === undefined || cssW <= 0 || cssH <= 0) {
      throw new Error("ice: GroundHost cannot capture this snapshot on the active renderer.");
    }
    const ledgerBudget = ctx.gpu?.budgetBytes ?? MAX_SNAPSHOT_BYTES * 8;
    const cap = Math.min(MAX_SNAPSHOT_BYTES, Math.floor(ledgerBudget / 8));
    if (cap < 4) throw new Error("ice: GroundHost snapshot sub-budget is empty.");
    const fullPixelWidth = Math.max(1, Math.round(cssW * dpr));
    const fullPixelHeight = Math.max(1, Math.round(cssH * dpr));
    const fullBytes = fullPixelWidth * fullPixelHeight * 4;
    let scale = Math.min(1, Math.sqrt(cap / Math.max(1, fullBytes)));
    let reservation: GpuReservation | undefined;
    let pixelWidth = 0;
    let pixelHeight = 0;
    while (scale > 0.01 && reservation === undefined) {
      pixelWidth = Math.max(1, Math.floor(fullPixelWidth * scale));
      pixelHeight = Math.max(1, Math.floor(fullPixelHeight * scale));
      const bytes = pixelWidth * pixelHeight * 4;
      reservation =
        ctx.gpu?.reserve(
          `ground-transition:${descriptor.documentEpoch}:${descriptor.fromFrame}`,
          bytes,
        ) ??
        (ctx.gpu === undefined
          ? {
              id: "ground-transition:local",
              bytes,
              release: () => {},
            }
          : undefined);
      if (reservation === undefined) scale *= 0.75;
    }
    if (reservation === undefined) {
      throw new Error("ice: GroundHost could not reserve a bounded GPU snapshot.");
    }
    try {
      const snapshot = renderer.capture(object, camera, {
        cssWidth: cssW,
        cssHeight: cssH,
        pixelWidth,
        pixelHeight,
      });
      if (snapshot.bytes > reservation.bytes) {
        snapshot.dispose();
        throw new Error("ice: GroundHost snapshot exceeded its GPU reservation.");
      }
      return {
        snapshot,
        reservation,
        sourceRect: visibleRect(descriptor.fromCamera, cssW, cssH),
      };
    } catch (error) {
      reservation.release();
      throw error;
    }
  };

  const transitionAdapter = {
    id: "@ice/ground/host",
    plane: "ground" as const,
    prepare(descriptor: FrameSwitchDescriptor): PresentationRetainer | null {
      const departing = active;
      const record = departing.record;
      if (record === undefined) return null;

      const collectedFrame: GroundFrame = {
        width: cssW,
        height: cssH,
        dpr,
        camera: descriptor.fromCamera,
      };
      try {
        // Capture the complete current presentation even when camera/config
        // dirt landed after the last reflector flush.
        departing.instance.collect(departing.input, collectedFrame, { opacity: 1 });
        programDirty = false;
      } catch (error) {
        reportFault(departing.id, error);
        throw error;
      }

      let outgoingObject: Object3D;
      let updateOutgoing: (frame: PresentationTransitionFrame) => void;
      let releaseOutgoing: (reason: Parameters<PresentationRetainer["release"]>[0]) => void;

      if (record.definition.transition === "procedural") {
        const transferred = takeActiveForTransition();
        if (transferred === undefined) return null;
        outgoingObject = transferred.instance.object;
        const restoreOrder = transitionOrder(outgoingObject, descriptor.kind);
        updateOutgoing = (frame) => {
          try {
            transferred.instance.collect(
              inertInput(),
              { width: cssW, height: cssH, dpr, camera: frame.outgoingCamera },
              { opacity: frame.outgoingOpacity },
            );
          } catch (error) {
            reportFault(transferred.definition.id, error);
            throw error;
          }
        };
        releaseOutgoing = (reason) => {
          scene.remove(outgoingObject);
          restoreOrder();
          if (reason === "cancelled") {
            restoreTransferred(transferred, collectedFrame, "reuse");
          } else {
            transferred.instance.dispose();
          }
        };
      } else if (record.definition.transition === "freezable") {
        const frozen = departing.instance.freeze?.();
        if (
          frozen === undefined ||
          frozen.object === undefined ||
          typeof frozen.collect !== "function" ||
          typeof frozen.release !== "function"
        ) {
          throw new Error(
            `ice: freezable GroundProgram "${record.definition.id}" returned an invalid frozen handle.`,
          );
        }
        let transferred: ProgramRecord | undefined;
        try {
          transferred = takeActiveForTransition();
        } catch (error) {
          try {
            frozen.release();
          } catch (releaseError) {
            reportFault(record.definition.id, releaseError);
          }
          throw error;
        }
        if (transferred === undefined) {
          frozen.release();
          return null;
        }
        if (frozen.object !== transferred.instance.object) {
          scene.remove(transferred.instance.object);
          scene.add(frozen.object);
        }
        outgoingObject = frozen.object;
        const restoreOrder = transitionOrder(outgoingObject, descriptor.kind);
        updateOutgoing = (frame) => {
          try {
            frozen.collect(
              { width: cssW, height: cssH, dpr, camera: frame.outgoingCamera },
              { opacity: frame.outgoingOpacity },
            );
          } catch (error) {
            reportFault(transferred.definition.id, error);
            throw error;
          }
        };
        releaseOutgoing = (reason) => {
          scene.remove(outgoingObject);
          restoreOrder();
          try {
            frozen.release();
          } finally {
            if (reason === "cancelled") {
              restoreTransferred(transferred, collectedFrame, "dispose");
            } else {
              transferred.instance.dispose();
            }
          }
        };
      } else {
        const captured = snapshotFor(descriptor, departing.instance.object);
        detachActive(true);
        const reusableRecord = records.get(record.definition.id) === record;
        outgoingObject = captured.snapshot.object;
        const restoreOrder = transitionOrder(outgoingObject, descriptor.kind);
        scene.add(outgoingObject);
        updateOutgoing = (frame) => {
          const topLeft = worldToScreen(
            descriptor.affine.ox + captured.sourceRect.x * descriptor.affine.s,
            descriptor.affine.oy + captured.sourceRect.y * descriptor.affine.s,
            frame.camera,
          );
          captured.snapshot.update(
            {
              x: topLeft.x,
              y: topLeft.y,
              width:
                captured.sourceRect.width * descriptor.affine.s * frame.camera.zoom,
              height:
                captured.sourceRect.height * descriptor.affine.s * frame.camera.zoom,
            },
            frame.outgoingOpacity,
          );
        };
        releaseOutgoing = (reason) => {
          scene.remove(outgoingObject);
          restoreOrder();
          try {
            captured.snapshot.dispose();
          } finally {
            captured.reservation.release();
            if (reason === "cancelled") {
              restoreTransferred(
                record,
                collectedFrame,
                reusableRecord ? "reuse" : "already-disposed",
              );
            }
          }
        };
      }

      let released = false;
      return {
        update(frame) {
          incomingOpacity = frame.incomingOpacity;
          updateOutgoing(frame);
          programDirty = true;
          anyDirty = true;
        },
        release(reason) {
          if (released) return;
          released = true;
          incomingOpacity = 1;
          releaseOutgoing(reason);
          programDirty = true;
          anyDirty = true;
          evict();
        },
      };
    },
  };
  const detachTransitionAdapter = ctx.transitions?.register(transitionAdapter);

  switchForCanvas();

  const reflector = {
    name: "ground-host",
    always: true,
    flush(w: World) {
      if (disposed || !anyDirty || fatalRenderFault || renderer.failed() || !renderer.ready()) return;
      const cam = w.getResource(Camera);
      if (cam === undefined) return;
      anyDirty = false;
      const frame: GroundFrame = { width: cssW, height: cssH, dpr, camera: cam };
      for (const slot of shared) {
        if (!slot.enabled || !slot.dirty) continue;
        slot.dirty = false;
        slot.pass.collect(w, frame);
      }
      if (programDirty) {
        programDirty = false;
        try {
          active.instance.collect(active.input, frame, { opacity: incomingOpacity });
        } catch (error) {
          const failedId = active.id;
          if (active.record !== undefined) {
            detachActive(false);
            reportFault(failedId, error);
            reconcileActive();
          } else {
            fatalRenderFault = true;
          }
          return;
        }
      }
      try {
        renderer.render(scene, camera);
        redraws += 1;
      } catch (error) {
        const failedId = active.id;
        if (active.record !== undefined) {
          detachActive(false);
          reportFault(failedId, error);
          reconcileActive();
        } else {
          // With only the internal no-op attached, the fault cannot belong to
          // a program. Treat it as physical/shared-renderer failure.
          fatalRenderFault = true;
        }
      }
    },
    available: () => renderer.ready() && !renderer.failed() && !fatalRenderFault,
    redraws: () => redraws,
    rendererStatus: () => readGroundRendererStatus(renderer),
    rendererProfile: () => renderer.profile?.() ?? Object.freeze({ enabled: false, samples: [] }),
  };

  const programControl: GroundProgramControl = {
    prepare,
    status(id) {
      return (
        statuses.get(id) ??
        Object.freeze({ id, state: "failed", message: `GroundProgram "${id}" is not registered.` })
      );
    },
    subscribe(onChange) {
      statusListeners.add(onChange);
      return () => statusListeners.delete(onChange);
    },
    active: () => active.id,
    stats: () => ({
      activeProgram: active.id,
      instantiatedPrograms: records.size,
      inactivePrograms: [...records.values()].filter((record) => record !== active.record).length,
      sourceObservers,
      redraws,
      renderer: readGroundRendererStatus(renderer),
    }),
  };

  return {
    reflector,
    programs: programControl,
    ...(compositor !== undefined ? { compositorReflector: compositor } : {}),
    ...(compositorSources !== undefined ? { sources: compositorSources } : {}),
    ...(domSources !== undefined ? { domSources } : {}),
    device: () => renderer.device?.(),
    groundTargetLive: () => renderer.targetTexture?.() !== undefined,
    configureGrid(config: Partial<GridConfig>) {
      for (const definition of definitions.values()) definition.configureGrid?.(config);
      wakeProgram();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const controller of preparation.values()) controller.abort();
      preparation.clear();
      detachTransitionAdapter?.();
      detachActive(false);
      for (const unsub of unsubs) {
        try {
          unsub();
        } catch {
          // Continue the exact host disposal sweep.
        }
      }
      for (const slot of shared) {
        for (const unsub of slot.unsubs) {
          try {
            unsub();
          } catch {
            // Continue the exact disposal sweep.
          }
        }
        slot.unsubs.length = 0;
        slot.pass.dispose();
      }
      for (const record of [...records.values()]) disposeRecord(record);
      noop.dispose();
      compositor?.dispose();
      domSources?.dispose();
      resizeObserver?.disconnect();
      renderer.dispose();
      canvas.remove();
      statusListeners.clear();
    },
  };
}

/**
 * Compile an explicit program set into one GroundFactory. Definitions remain
 * inert factories until their CanvasType is selected (or prepare is hinted).
 */
export function groundHost(opts: GroundHostOptions): (ctx: GroundContext) => GroundHostLayer {
  const definitions = new Map<string, GroundProgramDefinition>();
  for (const definition of opts.programs) {
    validateDefinition(definition);
    if (definitions.has(definition.id)) {
      throw new Error(`ice: GroundHost repeats GroundProgram "${definition.id}".`);
    }
    definitions.set(definition.id, definition);
  }
  if (!definitions.has(opts.fallback)) {
    throw new Error(`ice: GroundHost fallback "${opts.fallback}" is not registered.`);
  }
  return (ctx) => createProgramHostLayer(ctx, opts, definitions);
}
